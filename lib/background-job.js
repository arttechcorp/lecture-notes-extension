// 유료 백그라운드 경로의 작업 오케스트레이터 (docs/architecture-v2.md §5.2, §6.1, §7, §8).
// 게이트(네트워크 전) → 재생목록·보호 검사 → 세그먼트 수신 → 디먹스 → 키프레임 디코드 → VisualGate → 마스크 → 비전,
// 오디오는 롤링 창 → VAD 청크 → STT. 끝나면 deps.runNote로 넘긴다. 원본 미디어는 메모리에서만 다루고 어디에도 쓰지 않는다(AGENTS.md §2).
//
// runBackground(job, source, deps) → {status, code?, reason?, suggest?, note?, notices?, stats}
//   source: {playlistUrl, pageUrl} — HLS만. pageUrl은 사용자가 보던 강의 탭 주소.
//   deps:   {fetch?, decode:{keyframeImages, audioEnergy}, paint(blob, boxes)→Blob, vision:{recognize}, stt:{stt}, store, events?,
//            settings, features, models:{plan, write, writeAlt?, judge, stt}, runNote(job, input, {signal, events, concurrency, sleep}), signal?, now?, sleep?, budget?:{bytes, stallMs},
//            options?:{lastFrame?, visionLanes?}, cropInk?(blob, boxes, ctx)→[Blob]} // lastFrame: mis-sol-hai "직전 프레임" 캡처(기본은 종전 동작). cropInk: 미판독 필기 영역을 메모리 근거로 자르는 브라우저 쪽 함수.
//   decode·paint는 브라우저 몫이라 주입한다. vision은 createVisionEngine의 엔진, stt는 ServiceClient 모양({stt(args)}), features는 /v1/me 응답 그대로,
//   settings는 사용자 설정(동의 기록). runNote는 service·katex를 미리 묶어 둔 stages.runNote다.
//   status: runNote의 결과("complete"|"partial"|"recognition-only"|…) 또는 "paused"|"failed"|"cancelled". 일시정지·실패는 code가 있고, 미지원 호스트만 suggest:"live"(보호·DRM은 제안 없음).
//   stats: {segments, slides, chunks, gaps, peakBytes, heldBytes}. 내용 없는 수치뿐이다. heldBytes는 끝났을 때 아직 점유 중이던 바이트(정상 종료면 0).
//   호출자는 일시정지한 작업을 다시 부르면 된다(스스로 resume()한다): 수신은 체크포인트에서, 이미 끝난 수신은 건너뛰고 runNote부터 이어 간다.
//
// 불변식: 키 URI는 가져오지 않는다. 동의·플랜이 없으면 네트워크 전에 멈춘다. 로컬 엔진·실시간 모드로 조용히 넘어가지 않는다 — 멈추고 묻는다.
// 이벤트에는 코드·수치·번호만 싣는다. 파생물(슬라이드·전사)만 암호화 패키지 저장소에 둔다.
//
// ponytail: HLS 전체 세그먼트 수신만. DASH·mp4·I-frame 재생목록·Range 부분 수신은 없다(Phase 0 측정 뒤 소스 쪽에 추가).
//   BYTERANGE를 무시하는 서버는 SRC_RANGE_UNSUPPORTED로 실패한다(전체 내려받기 대체는 없다).
// ponytail: 비교 순서를 지키려고 디코드 레인은 스트림당 1개다. 원격 설정의 decode>1은 무시한다.
(() => {
  const need = (name, path) => globalThis[name] || (typeof require !== "undefined" ? require(path) : null);
  const Pipeline = need("Pipeline", "./pipeline.js"), Media = need("LectureMedia", "./media-source.js"), Demux = need("LectureDemux", "./media-demux.js");
  const Stt = need("SttClient", "./stt-client.js"), Boilerplate = need("Boilerplate", "./boilerplate.js"), Vision = need("VisionClient", "./vision-client.js"), Figures = need("Figures", "./figures.js");
  const gateClass = () => globalThis.VisualGate || require("./visual-gate.js").VisualGate;
  const Ink = need("InkDiff", "./ink-diff.js");
  // settings.js는 전역 함수(확장 페이지)로도 CommonJS(Node)로도 노출된다. 로드 순서에 기대지 않도록 호출 시점에 찾는다.
  const settingsApi = () => typeof backgroundAllowed === "function" ? { backgroundAllowed, cloudRecognitionAllowed } : require("./settings.js");

  const MEM_BYTES = 300 * 2 ** 20, STALL_MS = 120000; // 메모리 예산, 수신이 이만큼 멈춰 있으면 MEM_BUDGET_EXCEEDED
  const KEY_EVERY = 2; // 키프레임 표본 간격(초): 전환 판정 해상도
  const LEARN = 5; // 마스크를 배우는 슬라이드 수(§6.3 규칙 6)
  const REVISIT_MAX = 0.03; // lastFrame 모드 재방문 대조 임계 — 중복 판정 수준. 같은 템플릿에 줄 하나만 더한 "다른" 슬라이드도 타일 차이 ~0.08이 나므로, 이 이하일 때만 같은 슬라이드로 합친다. 애매하면 합치지 않는다(중복이 손실보다 낫다).
  const STT_PCM_RATE = 16000; // 클라우드 STT로 보내는 WAV의 샘플레이트(모노 16비트)
  const FRAME_MS = 30, WIN_SEC = 350; // 오디오 창: targetSec 300 + 2·searchSec 20 + 2·overlap 2 이상이어야 내부 컷이 생긴다
  const END = new Set(["done", "failed", "cancelled"]);
  const YOUTUBE = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|googlevideo\.com)$/i; // §19: 약관·서명 URL 때문에 백그라운드 제외
  const NET = /^SRC_(NETWORK|HTTP_(429|5\d\d))$/; // 수신기의 백오프가 끝난 뒤의 실패 → 멈추고 묻는다
  const SOFT = new Set(["DEMUX_BAD_MEDIA", "DEMUX_TRUNCATED", "DECODE_FAILED", "DECODE_TOO_BIG"]); // 그 구간만 공백으로 두고 계속 가는 오류
  const BAD_OUTPUT = new Set(["provider_failed_or_invalid_output", "invalid_audio", "VIS_BAD_SCHEMA", "STT_BAD_RESPONSE"]); // 그 슬라이드·청크만 미인식으로 고지
  const SUGGEST = { SRC_UNSUPPORTED_HOST: "live" }; // 보호(AES-128)·DRM 영상은 중단만 하고 다른 길을 안내하지 않는다
  const range = n => new Set(Array.from({ length: n }, (_, i) => i));
  const bad = cause => Pipeline.pipelineError("SRC_BAD_PLAYLIST", { cause });
  const evCode = (e, area = "SRC") => Pipeline.codeOf(e, area) ?? "UNKNOWN";
  const hostOf = u => { try { return new URL(u).hostname; } catch { return null; } };

  // 오류 → {code, pause?}. pause가 있으면 일시정지(사유), 없으면 실패. 코드가 없는 오류(버그)는 null이라 호출자가 다시 던진다.
  function classify(e, area) {
    const c = e?.code;
    if (c === "SRC_DRM" || c === "DEMUX_PROTECTED") return { code: "SRC_DRM" };
    if (c === "SRC_PROTECTED") return { code: "SRC_PROTECTED" };
    let code = NET.test(c) ? "NET_UNREACHABLE" : Pipeline.codeOf(e, area);
    // 서비스의 소문자 오류 코드는 stages.js처럼 <영역>_<원인>으로 접는다
    if (!code && typeof c === "string") { const up = c.toUpperCase().replace(/\W/g, "_"); code = (up.startsWith(area + "_") ? up : `${area}_${up}`).slice(0, 64); }
    if (!code) return null;
    const pause = Pipeline.CODES[code]?.pause;
    return pause ? { code, pause } : { code };
  }

  // 네트워크 전에 막는다. 첫 위반을 돌려준다: 동의는 일시정지(사용자 사유), 플랜·호스트는 실패.
  function gate(source, { settings, features }) {
    const s = settingsApi(), have = features?.features ?? [];
    if (!s.backgroundAllowed(settings)) return { code: "CONSENT_REQUIRED", pause: "user" };
    if (!have.includes("background")) return { code: "SRC_NOT_IN_PLAN" };
    if (!s.cloudRecognitionAllowed(settings)) return { code: "CONSENT_CLOUD_REQUIRED", pause: "user" };
    if (!have.includes("stt") || !have.includes("vision")) return { code: "SRC_NOT_IN_PLAN" };
    for (const u of [source?.pageUrl, source?.playlistUrl]) {
      const host = hostOf(u) ?? ""; // 주소 오류는 수신기가 SRC_BAD_URL로 거절한다
      if (YOUTUBE.test(host)) return { code: "SRC_UNSUPPORTED_HOST" };
    }
    return null;
  }

  // 바이트 회계. hold(n)은 점유를 하나 잡고, set으로 크기를 고치고, free로 푼다(두 번 풀어도 안전).
  // reserve는 예산에 들어갈 때까지 기다린다 = 수신 일시정지. 아무것도 쥐지 않았는데 안 들어가거나 stallMs 넘게 멈춰 있으면 MEM_BUDGET_EXCEEDED.
  function budget(max, stallMs) {
    let used = 0, peak = 0, wake = [];
    const all = new Set();
    const hold = n => {
      let cur = 0;
      const h = {
        set(v) { used += v - cur; if (v < cur) wake.splice(0).forEach(f => f()); cur = v; peak = Math.max(peak, used); v ? all.add(h) : all.delete(h); return h; },
        free: () => h.set(0),
      };
      return h.set(n);
    };
    return {
      hold,
      get used() { return used; },
      get peak() { return peak; },
      release: () => { for (const h of [...all]) h.free(); },
      async reserve(n, signal, onWait) {
        while (used + n > max) {
          if (!used) throw Pipeline.pipelineError("MEM_BUDGET_EXCEEDED"); // 하나만으로도 예산보다 크다
          onWait?.();
          let stalled = false;
          await new Promise(res => {
            const done = () => { clearTimeout(t); signal.removeEventListener("abort", done); res(); };
            const t = setTimeout(() => { stalled = true; done(); }, stallMs);
            signal.addEventListener("abort", done, { once: true }); wake.push(done);
          });
          signal.throwIfAborted();
          if (stalled && used + n > max) throw Pipeline.pipelineError("MEM_BUDGET_EXCEEDED");
        }
        return hold(n);
      },
    };
  }

  async function runBackground(job, source, deps = {}) {
    const { settings, features, decode, paint, vision, stt, store = job.store } = deps, models = deps.models ?? {};
    // 프로그래머 오류는 네트워크 전에, 수신이 끝난 뒤가 아니라 처음에 드러낸다
    if (!models.stt || !models.plan || !models.write || !models.judge || typeof deps.runNote !== "function" || typeof paint !== "function") throw new TypeError("models(stt·plan·write·judge), paint, runNote가 필요합니다.");
    const now = deps.now ?? Date.now, pkg = job.packageId, id = k => `${pkg}:${k}`, lang = ["ko", "en"].includes(settings?.whisperLang) ? settings.whisperLang : "auto"; // auto·미지정은 서비스가 언어를 감지한다
    const bus = deps.events ?? job.events, ev = { emit: e => bus.emit({ jobId: job.jobId, ...e }), span: f => bus.span({ jobId: job.jobId, ...f }) };
    const halt = new AbortController(), sig = deps.signal ? AbortSignal.any([deps.signal, halt.signal]) : halt.signal;
    // 원격 설정의 수신 레인 이름은 download다(pipeline.LANES는 recv)
    // options.visionLanes: 프로파일이 비전 레인을 줄인다 — mis-sol-hai 의 Mistral OCR 은 초당 요청 한도가 낮아 3레인이면 전부 429(실행 mis-sol-hai-16).
    const conc = features?.config?.concurrency, laneOf = n => Pipeline.laneCount(n, { recv: conc?.download, ...conc });
    const lane = n => n === "vision" && deps.options?.visionLanes >= 1 ? Math.min(Math.floor(deps.options.visionLanes), laneOf(n)) : laneOf(n);
    const mem = budget(deps.budget?.bytes ?? MEM_BYTES, deps.budget?.stallMs ?? STALL_MS);
    const breaker = Pipeline.createBreaker({ now });
    const sttBackoff = { until: 0 };
    const service = { stt: a => breaker.run("stt", () => stt.stt({ ...a, jobId: job.jobId }), { area: "STT" }) };
    // vision.recognize는 호출별 signal을 받지 않는다. 취소·중단되면 응답을 기다리지 않고 풀려 나온다(진행 중이던 요청의 결과는 버린다).
    const until = p => new Promise((res, rej) => {
      if (sig.aborted) return rej(sig.reason);
      const f = () => rej(sig.reason);
      sig.addEventListener("abort", f, { once: true });
      p.then(res, rej).finally(() => sig.removeEventListener("abort", f));
    });
    const recognize = (blob, meta) => Pipeline.withRetry(() => until(breaker.run("vision", () => vision.recognize(blob, meta), { area: "VIS" })), { signal: sig, sleep: deps.sleep });
    const bySeq = [], chunkRecs = [], gaps = new Map(), inits = new Map(), streams = [];
    const LAST = deps.options?.lastFrame === true; // mis-sol-hai §4.1: 전환 직전 프레임을 캡처한다(기본은 종전 동작)
    const inkBlobs = new Map(), slideHolds = []; // inkBlobs: "sK" → [{x,y,w,h,blob}] — 작성 단계의 메모리 근거뿐, 저장소·노트에 싣지 않는다
    // 도표·수식 크롭(6-6): 키는 "<slideId>/<영역 id>", 바이트는 blobs 의 "<pkg>:c:<slideId>_<영역 id>" 에 암호화해 둔다(ID_RE 에 맞지 않는 문자는 _ 로). 해시는 도표 중복 제거용.
    // ocr 은 크롭 비트맵을 기기 안에서 읽은 도표 숫자 대조용 텍스트다(§14) — 암호화 패키지 상태와 runNote 입력에만 둔다.
    // lowRes 는 소스 픽셀이 부족해 판독을 믿을 수 없는 크롭 키다(내용 없는 품질 표시) — 그 키의 OCR은 검증에서 뺀다.
    const fdata = { hashes: {}, crops: [], formulaCrops: [], ocr: {}, lowRes: [] };
    let gapTail = Promise.resolve(), segCount = 0, frames = 0, accepted = 0;

    // 이어받기용 파생물: 슬라이드(sd:n)와 전사 청크(tr:n)는 번호가 끊기지 않은 앞부분만 쓴다. 구멍 뒤의 기록은 버리고 다시 만든다.
    async function load() {
      const seq = async kind => {
        const out = [], pre = id(kind + ":");
        for (let r; (r = await store.getJson("packages", pre + out.length).catch(() => null)) !== null;) out.push(r);
        for (const k of await store.ids("packages")) if (k.startsWith(pre) && +k.slice(pre.length) >= out.length) await store.delete("packages", k);
        return out;
      };
      bySeq.push(...await seq("sd")); chunkRecs.push(...await seq("tr"));
      for (const g of await store.getJson("packages", id("gaps")).catch(() => null) ?? []) gaps.set(`${g.reason}@${g.t0}`, g);
      Object.assign(fdata, await store.getJson("packages", id("fd")).catch(() => null) ?? {});
      // 재시도·이어받기로 같은 키가 겹치지 않게 체크포인트에서 온 목록도 중복을 지운다.
      fdata.crops = [...new Set(fdata.crops ?? [])]; fdata.formulaCrops = [...new Set(fdata.formulaCrops ?? [])]; fdata.lowRes = [...new Set(fdata.lowRes ?? [])];
    }
    // 슬라이드 하나의 크롭을 저장한다. 실패해도 작업은 계속한다 — 크롭이 없으면 그 도표·수식은 "확인 필요"로 표시된다(§14).
    let fdTail = Promise.resolve();
    async function keepCrops(blob, doc) {
      // 취소는 삼키지 않고 다시 던진다 — 취소가 아닌 크롭 실패만 생략 가능한 결함으로 남긴다(§14).
      const got = await deps.crop(blob, doc, { jobId: job.jobId, signal: sig }).catch(e => { sig.throwIfAborted(); return null; });
      if (!got) return;
      const low = new Set([...(fdata.lowRes ?? []), ...(got.lowRes ?? [])]);
      fdata.lowRes = [...low];
      const figByKey = new Map((doc.figures ?? []).filter(f => f && f.id != null).map(f => [`${doc.slideId}/${f.id}`, f]));
      for (const [k, bytes] of Object.entries(got.crops ?? {})) {
        await store.putBytes("blobs", id("c:" + k.replace(/[^A-Za-z0-9_.:-]/g, "_")), bytes);
        const list = got.formulas?.includes(k) ? fdata.formulaCrops : fdata.crops;
        if (!list.includes(k)) list.push(k);
        // 글자 없는 다이어그램은 figure 근거가 안 돼 노트 레지스트리에 오르지 않는다 — 자른 크롭만 남기고 누락이 보이도록 내용 없는 코드를 둔다.
        const f = figByKey.get(k);
        if (f?.kind === "diagram" && Figures?.figureHasText?.(f) === false) ev.emit({ stage: "crop", level: "warn", code: "CROP_TEXTLESS", unit: k });
      }
      Object.assign(fdata.hashes, got.hashes ?? {});
      // OCR은 실제로 자른 도표 크롭의 것만, 저해상도 표시된 키는 뺀다 — 크롭이 없거나 못 믿는 판독으로 검증을 통과시키지 않는다.
      for (const [k, text] of Object.entries(got.ocr ?? {})) {
        const t = String(text ?? "").trim();
        if (t && (got.crops ?? {})[k] && !(got.formulas ?? []).includes(k) && !low.has(k)) fdata.ocr[k] = t.slice(0, 4000);
      }
      const w = fdTail.then(() => store.putJson("packages", id("fd"), fdata));
      fdTail = w.catch(() => {});
      await w;
    }
    // 공백 구간 고지(내용 없음: 이유·시각만). 쓰기는 한 줄로 세워 마지막 쓰기가 항상 전체 목록이다.
    async function gap(reason, t0, t1, code) {
      gaps.set(`${reason}@${t0}`, { reason, t0, t1 });
      ev.emit({ stage: "ingest", level: "warn", code, msg: "gap:" + reason, unit: String(Math.floor(t0)) });
      const w = gapTail.then(() => store.putJson("packages", id("gaps"), [...gaps.values()]));
      gapTail = w.catch(() => {});
      await w;
    }

    async function ingest() {
      if (job.state === "created") await job.transition("acquiring_source");
      const fetcher = Media.createFetcher({ fetch: deps.fetch, perHost: lane("recv"), maxMbps: features?.config?.throughputMbps, sleep: deps.sleep, now });

      // ── acquiring_source: 재생목록만 가져온다. 키 URI는 어떤 경우에도 요청하지 않는다. ──
      const playlist = async url => {
        let pl;
        try { pl = Media.parseM3U8(new TextDecoder().decode(await fetcher.get(url, { signal: sig })), url); } catch (e) { throw e.code ? e : bad(e); }
        // AES-128은 플레이어가 JS로 풀어 실시간 캡처가 되므로 실시간 모드를 권한다. 그 밖의 키(SAMPLE-AES 등)는 DRM이다.
        const prot = Media.detectProtection({ playlists: [pl] });
        if (prot.protected) throw Pipeline.pipelineError(/:AES-128$/.test(prot.reason) ? "SRC_PROTECTED" : "SRC_DRM");
        return pl;
      };
      const top = await playlist(source.playlistUrl);
      let vUrl = source.playlistUrl, aUrl = null;
      if (top.kind === "master") { const r = Media.selectRenditions(top); if (!r.video) throw bad(); vUrl = r.video.uri; aUrl = r.audio; }
      const v = top.kind === "media" ? top : await playlist(vUrl), a = aUrl ? await playlist(aUrl) : null;
      for (const m of [v, a]) if (m && (!m.endList || !m.segments.length)) throw bad(); // 끝나지 않은(라이브) 목록은 부분 결과를 조용히 낼 수 있다
      const mk = (name, media, video, audio) => ({ name, media, video, audio, next: 0, est: 0, pend: new Map(), tracks: [], lastKey: -Infinity, anchor: {} }); // anchor: demux의 DISCONTINUITY 구간 시간 기준(스트림마다)
      // 분리된 오디오 렌디션이 있으면 영상 목록의 음성은 쓰지 않는다(§6.1 3)
      streams.push(...(a ? [mk("v", v, true, false), mk("a", a, false, true)] : [mk("av", v, true, true)]));
      if (job.state === "acquiring_source") await job.transition("ingesting");

      // ── 이어받기 지점: 아직 끝나지 않은 작업이 있는 가장 앞 세그먼트부터 다시 받는다 ──
      let saved = null; try { saved = JSON.parse(job.record.completed?.ingest); } catch { /* 처음이거나 "done" */ }
      for (const st of streams) {
        const [c, n] = saved?.[st.name] ?? [0, st.media.segments.length];
        if (n !== st.media.segments.length) throw bad(); // 목록이 바뀌었으면 번호가 어긋난다
        st.next = c;
      }
      const cursorOf = st => Math.min(st.next, ...st.pend.values(), st.tracks[0]?.seg ?? Infinity);
      let lastCk = "";
      const ckpt = async () => {
        // ponytail: 커서는 job 기록의 completed.ingest에 둔다(공개 API complete()). 일급 필드가 필요하면 Pipeline에 job.patch()를 더한다.
        const s = JSON.stringify(Object.fromEntries(streams.map(st => [st.name, [cursorOf(st), st.media.segments.length]])));
        if (s !== lastCk) { lastCk = s; await job.complete("ingest", s); }
      };
      const hold = (st, seg) => { const k = Symbol(); st.pend.set(k, seg); return () => st.pend.delete(k); };
      const audioFrom = chunkRecs.length ? chunkRecs.at(-1).next ?? Infinity : 0; // 전사된 구간의 끝: 이 앞의 오디오는 다시 보내지 않는다
      // ponytail: 재개하면 마지막 슬라이드 한 장을 다시 보낸다(게이트가 처음부터 시작). 합치기는 preprocess.mergeProgressive가 한다.
      const skipT = bySeq.length ? bySeq.at(-1).t1 : -Infinity;
      let nextSlide = bySeq.length, nextChunk = chunkRecs.length, settled = bySeq.length, nextSlot = bySeq.length;

      // ── 마스크: 처음 LEARN장은 그대로 올리고, 그 결과로 위치가 고정된 반복 영역을 배운 뒤의 슬라이드부터 칠한다 ──
      // ponytail: 위치가 바뀌는 워터마크(maskBoxes)는 로컬 OCR이 있어야 해서 잇지 않았다.
      let openMask; const masks = new Promise(r => { openMask = r; });
      const learn = () => { const first = bySeq.slice(0, LEARN).filter(Boolean); openMask(first.length < LEARN ? [] : Boilerplate.maskRegions(Boilerplate.detect(first).slides, { learnSlides: LEARN })); };
      if (settled >= LEARN) learn();
      sig.addEventListener("abort", () => openMask([]), { once: true });

      // ── 큐: 가득 차면 생산자가 기다린다(백프레셔). 비전이 밀리면 수신이 멈춘다. ──
      const q = cap => Pipeline.createQueue({ capacity: cap, signal: sig });
      const vq = q(lane("vision")), sq = q(3);
      for (const st of streams) st.rq = q(lane("recv"));
      const gate = new (gateClass())({ mode: "vision", minGapMs: KEY_EVERY * 2000 - 500, lastFrame: LAST }); // 수락 상한은 표본 두 장 간격(키프레임 시각 오차만큼 여유) — 잡음·영상 구간의 연속 호출만 막는다

      // ── 직전 프레임 모드 상태: 슬라이드당 첫 정지 프레임의 저해상도 썸네일 한 장 + 게이트가 쥐는 마지막 후보 ──
      // canon = 같은 슬라이드의 방문을 하나로 묶는 표 {thumb(256×144 회색조), h, slot, t0(첫 방문 시작), visits:[{t0,t1}]}.
      // 재방문이면 썸네일로 알아보고 새 캡처는 원래 자리(slot)에 덮어쓴다.
      const canons = [];
      let cur = null, candTag = null, candH = null;
      const syncCand = tag => {
        if (tag === candTag) return;
        candH?.free(); candTag = tag;
        candH = tag ? mem.hold(tag.blob.size) : null; // 제출되면 큐 항목으로 넘어가고, 아니면 다음 후보가 갈아 끼울 때 푼다 — slideHolds에 쌓지 않는다
      };
      function enterSlide(entered, mask) {
        const arr = entered.sample.high, TC = gateClass().tilesChanged;
        let canon = null, best = REVISIT_MAX;
        for (const c of canons) { const d = TC(c.thumb, arr, mask); if (d <= best) { best = d; canon = c; } }
        if (canon) canon.thumb = arr; // 첫 정지 표본을 최신으로 갈아 끼운다
        else { const h = mem.hold(arr.length); slideHolds.push(h); canons.push(canon = { thumb: arr, h, slot: null, t0: (entered.t0ms ?? 0) / 1000, visits: [] }); }
        cur = canon;
      }
      // 수락 = 직전 슬라이드의 마지막 정지 후보. 첫 썸네일과의 차이로 필기 영역(ink)을 달고 비전 큐에 넣는다.
      // 후보의 blob 점유는 큐 항목의 h로 넘겨 이중 회계를 피한다. 방문 구간(t0~다음 슬라이드 시작)을 visits에 쌓는다 — 귀속은 L7의 몫.
      async function enqueueAccepted(c, st, idx) {
        accepted++;
        const ent = cur, t1 = Math.max(0, c.tag.t), t0 = Math.max(0, Math.min(c.t0ms / 1000, t1));
        const ink = Ink?.diff(ent?.thumb, c.sample.high, { exclude: c.mask }) ?? { mask: [], area: 0 };
        if (ent) { if (ent.slot == null) ent.slot = nextSlot++; ent.visits.push({ t0, t1: Math.max(t0, c.entered ? c.entered.t0ms / 1000 : t1) }); }
        gate.complete(c.sample);
        const h = candH ?? mem.hold(c.tag.blob.size);
        candH = null; candTag = null;
        await vq.put({ n: nextSlide++, slot: ent?.slot ?? nextSlot++, blob: c.tag.blob, t0, t1, h, rel: st ? hold(st, idx) : () => {}, ink, replace: (ent?.visits.length ?? 0) > 1, keepT0: ent?.t0 ?? null, visits: ent ? ent.visits.map(v => ({ ...v })) : null });
        syncCand(c.candidateTag);
      }

      const initOf = async seg => {
        if (!seg.map) return null;
        const k = seg.map.uri + (seg.map.byterange ? `#${seg.map.byterange.offset}+${seg.map.byterange.length}` : "");
        return inits.get(k) ?? inits.set(k, fetcher.get(seg.map.uri, { range: seg.map.byterange, signal: sig })).get(k); // 약속을 담아 두 스트림이 한 번만 받게 한다
      };
      const fetchSeg = async (st, idx, h) => {
        const seg = st.media.segments[idx], span = ev.span({ stage: "recv", unit: `${st.name}-${idx}` });
        try {
          const b = await fetcher.get(seg.uri, { range: seg.byterange, signal: sig });
          h.set(b.length); st.est = Math.max(st.est, b.length); span.done({ bytes: b.length });
          return b;
        } catch (e) { h.free(); sig.aborted ? span.skip({ msg: "aborted" }) : span.fail(evCode(e)); throw e; }
      };

      // 수신: 세그먼트 순서대로 요청을 시작하고(레인은 수신기의 호스트 슬롯), 순서 있는 큐로 소비자에게 넘긴다.
      // ponytail: 크기는 요청 전에 모른다. 예약은 지금까지 본 가장 큰 세그먼트(BYTERANGE가 있으면 그 길이)로 하고 받은 뒤 실제 크기로 고친다 — 더 큰 세그먼트가 나오면 한 번 넘칠 수 있다.
      async function produce(st) {
        for (const idx of Media.remaining(st.media, range(st.next))) {
          const seg = st.media.segments[idx];
          const h = await mem.reserve(seg.byterange?.length ?? st.est, sig, () => ev.emit({ stage: "recv", level: "warn", unit: `${st.name}-${idx}`, msg: "mem-wait", bytes: mem.used }));
          const p = fetchSeg(st, idx, h);
          p.catch(() => {}); // 소비자가 아직 안 기다려도 미처리 거절이 되지 않게
          await st.rq.put({ idx, p, h });
          if (!st.est) await p.catch(() => {}); // 첫 세그먼트로 크기를 알기 전에는 더 시작하지 않는다
        }
        st.rq.close();
      }

      // 전환 판정은 순차다: 프레임이 들어오는 순서대로 게이트에 넣고, 받아들여진 장만 비전 큐로 간다.
      async function onFrame(st, idx, f) {
        if (!Number.isFinite(f.t) || f.t <= skipT) return; // 시각 없는 프레임은 버린다. 재개: 이미 인식한 구간
        frames++; const c = gate.inspect(f.sample, f.t * 1000, false, f);
        if (LAST) {
          if (c.accept) await enqueueAccepted(c, st, idx); else syncCand(c.candidateTag);
          if (c.entered) enterSlide(c.entered, c.mask);
          return;
        }
        if (!c.accept) return;
        accepted++;
        // complete()가 지우기 전에 읽는다. 전환을 처음 본 시각이 이 프레임보다 늦을 수 없게 자른다 — 세그먼트 경계에서 키프레임 시각이
        // 수십 ms 거꾸로 갈 수 있고, t1 < t0 인 요청은 서버가 invalid_vision_params 로 거절해 작업 전체가 멈춘다(필드: VIS_INVALID_VISION_PARAMS).
        const t1 = Math.max(0, f.t), t0 = Math.max(0, Math.min(gate.changedAt ? gate.changedAt / 1000 : t1, t1));
        gate.complete(c.sample); // 인식은 병렬이라 응답을 기다리지 않고 기준 프레임을 바꾼다
        await vq.put({ n: nextSlide++, blob: f.blob, t0, t1, h: mem.hold(f.blob.size), rel: hold(st, idx) });
      }

      // 오디오는 세그먼트마다 샘플 바이트만 복사해 쥔다 — 세그먼트 버퍼(영상 포함)는 바로 풀린다.
      function addAudio(st, tr, seg) {
        const keep = tr.samples.filter(s => s.t >= audioFrom);
        if (!keep.length) return;
        const buf = new Uint8Array(keep.reduce((n, s) => n + s.size, 0));
        let o = 0;
        const samples = keep.map(s => { buf.set(tr.buf.subarray(s.off, s.off + s.size), o); const c = { ...s, off: o }; o += s.size; return c; });
        const last = samples.at(-1);
        // stsd·description은 세그먼트 바이트의 뷰일 수 있어 복사한다(안 그러면 세그먼트 전체가 풀리지 않는다)
        st.tracks.push({ tr: { ...tr, buf, samples, stsd: tr.stsd?.slice(), description: tr.description?.slice() }, seg, end: last.t + last.dur, h: mem.hold(buf.length) });
      }
      // 창을 계획해 내부 컷까지의 청크를 STT 큐로 보낸다. 마지막 청크는 컷이 정해지지 않아 다음 창의 머리로 넘기고(final이면 전부 보낸다),
      // 그 앞의 오디오만 버린다. 무음 청크는 보내지 않는다.
      // ponytail: 일시정지하면 이 창(최대 ~350초)을 다시 받는다. 창을 비우고 끊으면 이음새에서 단어가 잘린다.
      async function flush(st, final) {
        const tr = st.tracks;
        if (!tr.length) return;
        const e = await decode.audioEnergy(tr.map(x => x.tr), { frameMs: FRAME_MS, signal: sig, pcmRate: STT_PCM_RATE });
        const plan = Stt.planChunks(e.energy, { frameMs: FRAME_MS }).map(c => ({ ...c, t0: c.t0 + e.t0, t1: c.t1 + e.t0 }));
        if (!final && plan.length < 2) return;
        const cut = final ? plan : plan.slice(0, -1), carry = final ? null : plan.at(-1).t0;
        // 경계·크기는 m4a 청크로 정하고, 디코더가 PCM을 줬으면 같은 구간을 WAV로 보낸다(MAI-Transcribe 2가 문서화한 형식). PCM이 없으면 m4a 그대로.
        const items = cut.filter(c => !c.skip).flatMap(c => Demux.audioChunks(tr.map(x => x.tr), [c]))
          .map(c => e.pcm && decode.wavSlice ? { ...c, mime: "audio/wav", bytes: decode.wavSlice(e.pcm, c.t0, c.t1) } : c);
        for (const [i, c] of items.entries()) await sq.put({ n: nextChunk++, c, e, next: items[i + 1]?.t0 ?? carry, h: mem.hold(c.bytes.length), rel: hold(st, tr[0].seg) });
        for (const x of tr.splice(0)) if (!final && x.end > carry) tr.push(x); else x.h.free();
      }

      // 소비(디코드 레인 1개): 수신 순서대로 한 세그먼트씩. 끝나면 버퍼를 바로 푼다.
      async function consume(st) {
        for (;;) {
          const r = await st.rq.take();
          if (r.done) break;
          const { idx, p, h } = r.value, seg = st.media.segments[idx], span = ev.span({ stage: "decode", unit: `${st.name}-${idx}` });
          try {
            const bytes = await p, init = await initOf(seg);
            let dm = null;
            // ponytail: 이어받기로 구간 중간에서 시작하면 그 세그먼트가 anchor의 기준이라 앞 실행과 시각이 수십~수백 ms 다를 수 있다. 정확히 하려면 구간 첫 세그먼트부터 다시 읽는다.
            try { dm = Demux.demuxSegment(bytes, { init, start: seg.start, discontinuity: seg.discontinuity, anchor: st.anchor }); }
            catch (e) { if (!SOFT.has(e?.code)) throw e; await gap("decode", seg.start, seg.start + seg.duration, "SRC_DECODE_FAILED"); }
            if (dm?.video && st.video) {
              try {
                for await (const f of decode.keyframeImages(Demux.keyframes(dm.video, { interval: KEY_EVERY, after: st.lastKey }), { signal: sig })) { st.lastKey = f.t; await onFrame(st, idx, f); }
              } catch (e) { if (!SOFT.has(e?.code)) throw e; await gap("decode", seg.start, seg.start + seg.duration, "SRC_DECODE_FAILED"); }
            }
            if (dm?.audio && st.audio) {
              addAudio(st, dm.audio, idx);
              if (st.tracks.length && st.tracks.at(-1).end - st.tracks[0].tr.samples[0].t >= WIN_SEC) await flush(st, false);
            }
            span.done({ bytes: bytes.length });
          } catch (e) { sig.aborted ? span.skip({ msg: "aborted" }) : span.fail(evCode(e)); throw e; }
          finally { h.free(); }
          segCount++; st.next = idx + 1;
          await ckpt();
        }
        if (st.audio) await flush(st, true);
      }

      const hints = (t0, t1) => Stt.extractTerms(bySeq.filter(d => d && d.t0 < t1 && d.t0 >= t0 - 300).map(Vision.slideDocText));

      // 같은 자리(slot)의 쓰기는 직렬로 — 병렬 비전 레인에서 재방문 대체가 이전 인식보다 먼저 끝나 덮이는 일이 없게 한다.
      const slotTails = new Map();
      // 재방문 대체 시 이전 캡처의 크롭·판독을 지운다 — 새 인식 결과가 그 자리를 완전히 대신한다.
      async function dropSlotData(slot) {
        inkBlobs.delete("s" + slot); // 이전 방문의 필기 영역 크롭도 지운다 — 새 방문에 필기가 없으면 남아서 엉뚱한 근거가 붙는다
        const pre = `s${slot}/`, san = k => k.replace(/[^A-Za-z0-9_.:-]/g, "_");
        for (const k of [...(fdata.crops ?? []), ...(fdata.formulaCrops ?? []), ...(fdata.lowRes ?? [])]) if (k.startsWith(pre)) await store.delete("blobs", id("c:" + san(k)));
        for (const k of ["crops", "formulaCrops", "lowRes"]) fdata[k] = (fdata[k] ?? []).filter(k => !k.startsWith(pre));
        for (const m of [fdata.ocr, fdata.hashes]) for (const k of Object.keys(m ?? {})) if (k.startsWith(pre)) delete m[k];
        const w = fdTail.then(() => store.putJson("packages", id("fd"), fdata));
        fdTail = w.catch(() => {});
        await w;
      }
      // 필기 메타: 마스크와 겹치는 인식 블록에 ink:true. 어느 블록에도 읽히지 않은 영역은 그 영역 이미지만
      // 메모리 근거로 남긴다(deps.cropInk) — 저장소·노트에는 싣지 않고 작성 단계에서 쓰고 버린다(§4.2).
      // 전제: 이 경로는 gate()에서 backgroundAllowed·cloudRecognitionAllowed 동의와 vision/stt 플랜이 확인된
      // 유료 클라우드 인식 작업에만 있다 — cropInk가 만드는 영역 이미지를 작성 모델에 넘기는 것도 그 동의가 뒷받침한다.
      async function attachInk(doc, ink, slot, blob, unit) {
        doc.ink = { mask: ink.mask, area: ink.area };
        if (!ink.mask?.length) return;
        const cov = Ink.coverage(ink.mask, doc.blocks);
        for (const b of doc.blocks ?? []) if (cov.blockIds.has(String(b.id))) b.ink = true;
        const unread = cov.regions.filter(r => r.unread);
        if (!unread.length) return;
        const boxes = unread.map(({ x, y, w, h }) => ({ x, y, w, h }));
        const got = typeof deps.cropInk === "function" ? await deps.cropInk(blob, boxes, { jobId: job.jobId, signal: sig }).catch(e => { sig.throwIfAborted(); return null; }) : null;
        const list = (got ?? []).map((b, i) => b && { ...boxes[i], blob: b }).filter(Boolean);
        if (list.length) { for (const r of list) slideHolds.push(mem.hold(r.blob.size)); inkBlobs.set("s" + slot, list); }
        else ev.emit({ stage: "vision", level: "warn", code: "INK_UNREAD", unit: `slide-${unit}` });
      }
      // 재방문 슬라이드는 자리(t0·번호)를 첫 방문 것으로 지키고 캡처·인식만 새 것으로 갈아 끼운다. 발화 귀속은 여기서 건드리지 않는다 — 방문 구간 목록(visits)만 남기고 다중 구간 정렬은 L7이 한다.
      async function storeSlide(it, doc, blob) {
        const slot = it.slot ?? it.n;
        const run = (slotTails.get(slot) ?? Promise.resolve()).then(async () => {
          if (it.replace) await dropSlotData(slot);
          if (it.keepT0 != null || it.visits != null) doc = { ...doc, slideId: "s" + slot, ...(it.keepT0 != null && { t0: it.keepT0 }), ...(it.visits != null && { visits: it.visits }) };
          if (it.ink) await attachInk(doc, it.ink, slot, blob, it.n);
          bySeq[slot] = doc;
          await store.putJson("packages", id("sd:" + slot), doc);
          if (deps.crop) await keepCrops(blob, doc);
        });
        slotTails.set(slot, run.catch(() => {}));
        await run;
      }

      async function visionTask(it) {
        const span = ev.span({ stage: "vision", unit: `slide-${it.n}` });
        try {
          const boxes = it.n >= LEARN ? await masks : [];
          sig.throwIfAborted();
          let blob = it.blob, doc = null;
          if (boxes.length) it.h.set((blob = await paint(blob, boxes)).size);
          // 응답 시간 초과(클라이언트 120초)는 같은 슬라이드를 한 번 더 읽고, 또 넘기면 그 슬라이드만 미인식으로 두고 강의를 계속한다
          // (필드: 22장 중 1장이 120초를 넘겨 강의 전체가 network 일시정지). 연결 끊김·한도·취소는 지금처럼 멈춘다.
          const meta = { slideId: "s" + (it.slot ?? it.n), t0: it.t0, t1: it.t1, jobId: job.jobId };
          const timedOut = e => !sig.aborted && (e?.name === "AbortError" || e?.code === "request_cancelled_or_timed_out");
          for (let attempt = 0; !doc; attempt++) {
            try { doc = (await recognize(blob, meta)).data.slideDoc; }
            catch (e) {
              if (sig.aborted || !(BAD_OUTPUT.has(e?.code) || timedOut(e))) throw e;
              if (timedOut(e) && attempt === 0) { ev.emit({ stage: "vision", unit: `slide-${it.n}`, level: "warn", code: "VIS_TIMEOUT", msg: "retry" }); continue; }
              await gap("vision", it.t0, it.t1, timedOut(e) ? "VIS_TIMEOUT" : "VIS_BAD_SCHEMA");
              break;
            }
          }
          if (doc) await storeSlide(it, doc, blob);
          it.rel(); span.done({ bytes: blob.size });
          if (++settled === LEARN) learn();
        } catch (e) { sig.aborted ? span.skip({ msg: "aborted" }) : span.fail(evCode(e, "VIS")); throw e; }
        finally { it.h.free(); }
      }

      async function sttTask(it) {
        const { c, e } = it, span = ev.span({ stage: "stt", unit: `chunk-${it.n}`, model: models.stt });
        let o = null;
        try {
          let segments = [], engine = null;
          try {
            [o] = await Stt.transcribeChunks([{ t0: c.t0, t1: c.t1, mime: c.mime, audio: c.bytes }], { service, concurrency: 1, signal: sig, lang, model: models.stt, termsFor: () => hints(c.t0, c.t1), sleep: deps.sleep, backoff: sttBackoff });
            if (o.status !== "ok") throw o.error;
            const at = Stt.makeEnergyAt(e.energy, e.frameMs);
            engine = o.transcript.engine;
            segments = Stt.filterSegments(o.transcript.segments, { energyAt: (x, y) => at(x - e.t0, y - e.t0) }); // 환각 필터: 저에너지 구간의 알려진 상투어
          } catch (err) { if (sig.aborted || !BAD_OUTPUT.has(err?.code)) throw err; await gap("stt", c.t0, c.t1, "STT_BAD_RESPONSE"); }
          chunkRecs[it.n] = { t0: c.t0, t1: c.t1, next: it.next, engine, segments };
          await store.putJson("packages", id("tr:" + it.n), chunkRecs[it.n]);
          it.rel(); span.done({ bytes: c.bytes.length });
        } catch (err) {
          const raw = (typeof err?.code === "string" ? err.code.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 48) : "") || "-";
          sig.aborted ? span.skip({ msg: "aborted" }) : span.fail(evCode(err, "STT"), { msg: `${raw} attempts=${o?.attempts ?? "?"}` });
          throw err;
        }
        finally { it.h.free(); }
      }

      // ── ingesting: 모든 단계를 한꺼번에 돌린다. 첫 치명 오류가 전체를 멈춘다(나머지는 취소로 정리). ──
      let fatal = null;
      const guard = (area, fn) => fn().catch(e => { fatal ??= { e, area }; halt.abort(); });
      const drain = (queue, fn) => async () => { for (;;) { const r = await queue.take(); if (r.done) return; await fn(r.value); } };
      const consumers = Promise.all(streams.map(st => guard("SRC", () => consume(st)))).then(async () => {
        // 직전 프레임 모드에서는 마지막 슬라이드가 아직 큐에 들어가지 않았다 — 영상이 끝나면 후보를 낸다
        const tail = LAST && !sig.aborted ? gate.flush() : null;
        if (tail?.accept) await enqueueAccepted(tail, null, 0);
        vq.close(); sq.close();
      });
      await Promise.all([
        ...streams.map(st => guard("SRC", () => produce(st))),
        consumers,
        ...Array.from({ length: lane("vision") }, () => guard("VIS", drain(vq, visionTask))),
        ...Array.from({ length: lane("stt") }, () => guard("STT", drain(sq, sttTask))),
      ]);
      if (fatal) {
        if (deps.signal?.aborted) throw fatal.e; // 사용자 취소는 바깥에서 cancelled로 처리한다
        const o = classify(fatal.e, fatal.area);
        if (!o) throw fatal.e; // 코드 없는 오류는 버그다 — 체크포인트는 마지막 정상 상태에 남는다
        await ckpt();
        return o;
      }
      await job.complete("ingest", "done");
      return null;
    }

    // 수신·인식 결과 → runNote 입력. 슬라이드 t1은 다음 슬라이드의 시작으로, 전사는 청크 사이 겹침을 지워 잇는다.
    function assemble() {
      const docs = bySeq.filter(Boolean).sort((a, b) => a.t0 - b.t0);
      let segments = [], end = 0;
      for (const r of chunkRecs.filter(Boolean).sort((a, b) => a.t0 - b.t0)) {
        segments = segments.length ? Stt.dedupeOverlap(segments, r.segments, (r.t0 + end) / 2) : r.segments;
        end = r.t1;
      }
      const low = new Set(fdata.lowRes ?? []); // 저해상도 표시 크롭의 판독은 검증 근거가 아니다 — 혹시 섞여 들어온 ocr 항목도 여기서 뺀다
      return {
        // inkImages는 메모리 근거뿐이라 체크포인트에서 복원되지 않는다 — 이어받은 슬라이드에는 없다.
        slides: docs.map((d, i) => ({ ...d, t1: Math.max(d.t0, docs[i + 1]?.t0 ?? d.t1), ...(inkBlobs.has(d.slideId) ? { inkImages: inkBlobs.get(d.slideId) } : {}) })),
        transcript: { schemaVersion: 1, engine: chunkRecs.find(r => r?.engine)?.engine ?? "none", model: models.stt, lang, segments },
        gaps: [...gaps.values()].sort((a, b) => a.t0 - b.t0),
        tier: "paid", models: { plan: models.plan, write: models.write, writeAlt: models.writeAlt ?? null, judge: (features?.features ?? []).includes("judge") ? models.judge : null }, consent: { summary: settings?.remoteSummaryConsent === true },
        recognition: "cloud", options: deps.options ?? {}, meta: { title: source.title ?? null, course: source.course ?? null, lang }, host: hostOf(source?.pageUrl),
        figureData: { hashes: fdata.hashes, ocr: Object.fromEntries(Object.entries(fdata.ocr ?? {}).filter(([k]) => !low.has(k))), crops: [...new Set(fdata.crops)] },
        formulaCrops: [...new Set(fdata.formulaCrops)],
      };
    }

    const end = async o => {
      await (o.pause ? job.transition("paused", { reason: o.pause, code: o.code }) : job.transition("failed", { code: o.code }));
      return { status: job.state, code: o.code, reason: o.pause ?? null, ...(SUGGEST[o.code] && { suggest: SUGGEST[o.code] }) };
    };
    async function main() {
      if (END.has(job.state)) return { status: job.state, code: job.record.code ?? null };
      if (job.state === "paused") await job.resume();
      // 출처 한 줄 요약: 목록 종류와 페이지 호스트만 — 경로·쿼리·제목은 싣지 않는다. 배속은 이 경로에 없다.
      let host = "-"; try { host = new URL(source?.pageUrl).hostname || "-"; } catch { /* 주소가 없거나 깨져 있으면 "-" */ }
      ev.emit({ stage: "source", msg: `kind=bg media=${Media.classifyRequest({ url: source?.playlistUrl }) ?? "other"} host=${host}` });
      const blocked = gate(source, deps);
      if (blocked) return end(blocked);
      await load();
      if (job.record.completed?.ingest !== "done") { const stop = await ingest(); if (stop) return end(stop); }
      return deps.runNote(job, assemble(), { signal: sig, events: deps.events, concurrency: conc, sleep: deps.sleep });
    }

    let res, fault = null;
    try { res = await main(); } catch (e) { fault = e; }
    // 어떤 결말이든 큐·오디오 창·점유를 비워 버퍼를 놓는다
    for (const h of slideHolds) h.free(); // 썸네일·후보·필기 근거는 runNote 입력이 만들어지고 나면 필요 없다
    const held = mem.used; // 정상 종료면 0이어야 한다. 중단·취소면 큐에 남아 있던 버퍼의 바이트다.
    halt.abort(); for (const st of streams) st.tracks.length = 0; inits.clear(); mem.release();
    if (fault) {
      if (deps.signal?.aborted) { if (!END.has(job.state)) await job.transition("cancelled"); res = { status: "cancelled" }; }
      else { const o = classify(fault, "SRC"); if (!o) throw fault; res = await end(o); }
    }
    ev.emit({ stage: "ingest", level: "info", code: "GATE_STATS", msg: `frames=${frames} accepted=${accepted}` }); // 게이트 효율 수치 — 내용 없음
    return { ...res, stats: { segments: segCount, slides: bySeq.filter(Boolean).length, chunks: chunkRecs.filter(Boolean).length, gaps: gaps.size, peakBytes: mem.peak, heldBytes: held } };
  }

  const api = { runBackground };
  globalThis.BackgroundJob = api;
  if (typeof module !== "undefined") module.exports = api;
})();
