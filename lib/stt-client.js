// 유료 클라우드 STT 경로의 클라이언트: 자르는 위치·전송 분량·환각 필터·중첩 병합을 결정한다.
// 모든 시각은 강의 타임라인 기준 초(float). 서비스 결과의 세그먼트/단어 시각도 절대 초다.
(() => {
  const norm = s => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

  function energyFrames(pcm, sampleRate, frameMs = 30) {
    if (!Array.isArray(pcm) && !(pcm instanceof Float32Array)) throw new TypeError("PCM 데이터가 올바르지 않습니다.");
    if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(frameMs) || frameMs <= 0) throw new TypeError("샘플레이트가 올바르지 않습니다.");
    const step = sampleRate * frameMs / 1000;
    if (!Number.isFinite(step) || step < 1) throw new TypeError("샘플레이트가 올바르지 않습니다.");
    const L = pcm.length;
    let n = 0;
    while (Math.round(n * step) < L) n++;
    const out = new Float32Array(n);
    // 경계를 누적이 아니라 매번 정확한 식으로 계산한다 — 스텝이 소수일 때 드리프트가 생긴다
    for (let i = 0; i < n; i++) {
      const a = Math.round(i * step), b = Math.min(Math.round((i + 1) * step), L);
      let s = 0;
      for (let j = a; j < b; j++) s += pcm[j] * pcm[j];
      out[i] = b > a ? Math.sqrt(s / (b - a)) : 0;
    }
    return out;
  }

  function vadSegments(energy, {frameMs = 30, k = 3, minSpeechMs = 300, hangoverMs = 500, minThreshold = 0.001} = {}) {
    const n = energy.length;
    if (!n) return [];
    // ponytail: 바닥값은 녹음 전체의 전역값이다. 노이즈가 시간에 따라 드리프트하면 롤링 바닥이 업그레이드 경로.
    const sorted = Array.from(energy).sort((a, b) => a - b);
    const thr = Math.max(sorted[Math.floor(0.1 * (n - 1))] * k, minThreshold);
    const runs = [];
    let s = -1;
    for (let i = 0; i < n; i++) {
      if (energy[i] >= thr) { if (s < 0) s = i; }
      else if (s >= 0) { runs.push([s, i - 1]); s = -1; }
    }
    if (s >= 0) runs.push([s, n - 1]);
    // 단어 사이의 짧은 멈춤(hangover 이하)은 세그먼트를 쪼개지 않도록 인접 런을 잇는다
    const hang = Math.floor(hangoverMs / frameMs + 1e-9), minF = Math.ceil(minSpeechMs / frameMs - 1e-9);
    const merged = [];
    for (const [a, b] of runs) {
      const last = merged[merged.length - 1];
      if (last && a - last[1] - 1 <= hang) last[1] = b;
      else merged.push([a, b]);
    }
    return merged.filter(([a, b]) => b - a + 1 >= minF)
      .map(([a, b]) => ({t0: a * frameMs / 1000, t1: (b + 1) * frameMs / 1000}));
  }

  function planChunks(energy, {frameMs = 30, targetSec = 300, searchSec = 20, overlapSec = 2, maxSec = 330, speech} = {}) {
    if (!(targetSec > 0) || !(searchSec >= 0) || !(overlapSec >= 0)) throw new RangeError("청크 옵션이 올바르지 않습니다.");
    if (!(targetSec + 2 * overlapSec <= maxSec)) throw new RangeError("청크 길이 상한이 올바르지 않습니다.");
    const frameSec = frameMs / 1000, n = energy.length, total = n * frameSec;
    if (!n) return [];
    // 상한 증명(서비스는 330s 초과 오디오를 거절, 빌링 최소 10s):
    // 내부 청크 <= targetSec+2*searchSec+2*overlapSec <= maxSec (searchSec 캡 덕분),
    // 마지막 청크는 마지막 컷이 k*targetSec+searchSec>=total 일 때만 생략되므로 <= targetSec+2*searchSec+overlapSec,
    // 첫 청크 <= targetSec+searchSec+overlapSec, 단일 청크 < targetSec+searchSec.
    searchSec = Math.min(searchSec, targetSec / 4, (maxSec - targetSec - 2 * overlapSec) / 2); // 탐색 창이 서로 닿지 않게
    speech ??= vadSegments(energy, {frameMs});
    const cuts = [];
    for (let k = 1; k * targetSec + searchSec < total; k++) {
      const center = k * targetSec;
      const lo = Math.max(0, Math.ceil((center - searchSec) / frameSec));
      const hi = Math.min(n - 1, Math.floor((center + searchSec) / frameSec));
      if (lo > hi) continue;
      let best = lo;
      for (let i = lo + 1; i <= hi; i++) {
        // 최저 에너지, 동률이면 프레임 중심이 목표 시각에 가장 가까운 쪽, 그래도 같으면 작은 인덱스
        if (energy[i] < energy[best] ||
            (energy[i] === energy[best] &&
             Math.abs((i + 0.5) * frameSec - center) < Math.abs((best + 0.5) * frameSec - center))) best = i;
      }
      cuts.push((best + 0.5) * frameSec);
    }
    const bounds = [0, ...cuts, total];
    return bounds.slice(0, -1).map((coreT0, j) => {
      const coreT1 = bounds[j + 1], last = j === bounds.length - 2;
      // skip 판정은 패딩 [t0,coreT0]이 아니라 코어 기준 — 패딩에만 걸치는 음성은 이웃 청크 코어 소유라
      // 패딩 겹침이 무음 청크를 유성처럼 보이게 하면 안 된다
      const skip = !speech.some(x => x.t0 < coreT1 && x.t1 > coreT0);
      return {
        t0: j === 0 ? 0 : Math.max(0, coreT0 - overlapSec),
        t1: last ? total : Math.min(total, coreT1 + overlapSec),
        skip, coreT0, coreT1,
      };
    });
  }

  function dedupeOverlap(prev, next, boundary) {
    const mid = x => (x.t0 + x.t1) / 2;
    // 중점 규칙: 경계에 걸친 단어는 정확히 한쪽만 가져간다 — 잃지도 중복되지도 않는다.
    // ponytail: 단어 타임스탬프가 없는 세그먼트는 텍스트 중복 제거도 불가 — 세그먼트 중점으로만 자른다.
    const kept = (segs, isPrev) => segs.flatMap(seg => {
      const take = x => (mid(x) < boundary) === isPrev;
      if (!seg.words || !seg.words.length) return take(seg) ? [{seg, words: null}] : [];
      const words = seg.words.filter(take);
      return words.length ? [{seg, words}] : [];
    });
    const P = kept(prev, true), N = kept(next, false);
    // 시간 절단만으로는 중복이 남는다 — 같은 중첩 구간의 두 디코딩은 타임스탬프가 단어 하나까지도 안 맞아
    // 이음새에 같은 단어가 양쪽에 생긴다. 앞쪽(prev) 사본을 살리고 뒤쪽 앞단어 m개를 버린다.
    const A = P.flatMap(e => e.words ?? []), B = N.flatMap(e => e.words ?? []);
    let m = Math.min(8, A.length, B.length);
    for (; m > 0; m--) {
      let ok = true;
      for (let j = 0; j < m; j++) {
        const a = norm(A[A.length - m + j].w);
        if (!a || a !== norm(B[j].w)) { ok = false; break; }
      }
      if (ok) break;
    }
    let drop = m;
    const out = [];
    const emit = (seg, words) => {
      if (!seg.words) return out.push({...seg}); // 단어 정보 없음 — 통째로 유지
      if (words.length === seg.words.length) return out.push({...seg, words: seg.words.map(x => ({...x}))}); // 잃은 게 없으면 text 그대로
      if (words.length) out.push({...seg, words: words.map(x => ({...x})), t0: words[0].t0, t1: words[words.length - 1].t1, text: words.map(x => x.w).join(" ")});
    };
    for (const e of P) emit(e.seg, e.words ?? []);
    for (const e of N) {
      let words = e.words;
      if (words && drop) { const d = Math.min(drop, words.length); words = words.slice(d); drop -= d; }
      emit(e.seg, words ?? []);
    }
    return out;
  }

  // Whisper가 무음/음악 구간에서 만들어내는 상투어. 실제 강의 음성은 에너지가 높으므로
  // 저에너지 조건이 "감사합니다" 같은 진짜 발화를 지우는 것을 막는다.
  const HALLUCINATION_PHRASES = Object.freeze([
    "시청해주셔서 감사합니다",
    "시청해 주셔서 감사합니다",
    "구독과 좋아요",
    "좋아요와 구독",
    "구독과 좋아요 부탁드립니다",
    "MBC 뉴스",
    "다음 영상에서 만나요",
    "한글자막 by",
    "자막 제공",
    "Thanks for watching",
    "Thank you for watching",
    "Please subscribe",
    "Subtitles by the Amara.org community",
  ]);

  function filterSegments(segments, {energyAt, silenceRms = 0.01, phrases = HALLUCINATION_PHRASES} = {}) {
    const pats = phrases.map(norm).filter(Boolean);
    return segments.map(seg => {
      const {noSpeechProb: p, avgLogprob: lp, compressionRatio: cr} = seg;
      let flagged = (typeof p === "number" && p > 0.6 && typeof lp === "number" && lp < -1.0) ||
                    (typeof cr === "number" && cr > 2.4);
      // energyAt이 없으면 문구 규칙은 발동하지 않는다 — 오디오 증거 없이 텍스트를 지울 수 없다
      if (!flagged && pats.length && typeof energyAt === "function") {
        const t = norm(seg.text);
        if (t && pats.some(x => t.includes(x))) {
          const e = energyAt(seg.t0, seg.t1);
          if (Number.isFinite(e) && e < silenceRms) flagged = true;
        }
      }
      return {...seg, status: flagged ? "filtered" : seg.status ?? "kept"};
    });
  }

  function makeEnergyAt(energy, frameMs = 30) {
    const fs = frameMs / 1000, n = energy.length;
    return (t0, t1) => {
      if (!n) return Infinity; // 증거 없음은 무음이 아니다
      const a = Math.min(n - 1, Math.max(0, Math.floor(t0 / fs)));
      const b = Math.min(n - 1, Math.max(a, Math.ceil(t1 / fs) - 1));
      let s = 0;
      for (let i = a; i <= b; i++) s += energy[i];
      return s / (b - a + 1);
    };
  }

  const TOKEN_RE = /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*(?:\+\+|#)?|[가-힣]+/gu;
  const ENGLISH_STOPWORDS = new Set(("the and for are was were with that this from have has will would what which when where then than into also each other about such using used not but you your can may is it of in to by or as at be an on if so we do no " +
    "a i he she they them their our us me him her its his my who whom how why all any some only very just now out up off over under too " +
    "page slide slides chapter figure fig table example examples contents agenda overview summary introduction lecture week part section copyright reserved rights www http https com pdf ppt pptx").split(" "));
  const KOREAN_STOPWORDS = new Set(("있는 있다 없는 하는 되는 대한 대해 통해 위한 위해 따라 따라서 그리고 하지만 그러나 또는 경우 때문 때문에 다음 이상 이하 관련 가장 매우 우리 이것 그것 여기 오늘 사용 " +
    "같은 이런 그런 저런 여러분 그래서 그러면 것은 입니다 합니다").split(" "));
  // 긴 조사부터 검사해야 "에서는"이 "에서"+"는"으로 잘못 쪼개지지 않는다.
  const PARTICLES = ["에서는", "에서", "으로", "에게", "까지", "부터", "보다", "처럼", "은", "는", "이", "가", "을", "를", "의", "에", "로", "와", "과"];

  function extractTerms(slides, {max = 40} = {}) {
    if (!Array.isArray(slides) || !(max > 0)) return [];
    const terms = new Map(); // key -> {count,title,first,display,best,surfaces,ko}
    let order = 0;
    const add = (tok, inTitle) => {
      const ko = /[가-힣]/.test(tok[0]);
      const key = ko ? tok : tok.toLowerCase();
      if (ko) {
        if (tok.length < 2 || tok.length > 20 || KOREAN_STOPWORDS.has(tok) || tok.endsWith("다")) return;
      } else if (tok.length > 30 || ENGLISH_STOPWORDS.has(key) ||
                 (!/^[A-Z][A-Z0-9]{1,5}$/.test(tok) && tok.replace(/-/g, "").length < 3)) return;
      let e = terms.get(key);
      if (!e) terms.set(key, e = {count: 0, title: false, first: order++, display: tok, best: 0, surfaces: ko ? null : new Map(), ko});
      e.count++;
      if (inTitle) e.title = true;
      if (!ko) { // 표기는 최다 표면형 — 예: npv보다 NPV가 많으면 NPV로 출력
        const sc = (e.surfaces.get(tok) ?? 0) + 1;
        e.surfaces.set(tok, sc);
        if (sc > e.best) { e.best = sc; e.display = tok; }
      }
    };
    for (const slide of slides) {
      if (typeof slide === "string") { for (const m of slide.matchAll(TOKEN_RE)) add(m[0], false); continue; }
      if (!slide || typeof slide !== "object") continue;
      if (typeof slide.title === "string") for (const m of slide.title.matchAll(TOKEN_RE)) add(m[0], true);
      if (typeof slide.text === "string") for (const m of slide.text.matchAll(TOKEN_RE)) add(m[0], false);
    }
    // 활용형을 어간에 합친다. 단, 어간이 실제로 단독 출현할 때만 — 회로·정밀도처럼
    // 조사 같은 음절로 끝나는 기술명사를 잘못 자르지 않기 위해서다.
    for (const [key, e] of [...terms].sort((a, b) => b[0].length - a[0].length)) {
      if (!e.ko || key.length < 3 || !terms.has(key)) continue;
      for (const p of PARTICLES) {
        if (!key.endsWith(p)) continue;
        const stem = key.slice(0, -p.length), s = terms.get(stem);
        if (stem.length >= 2 && s && s.ko) {
          s.count += e.count;
          s.first = Math.min(s.first, e.first);
          if (e.title) s.title = true;
          terms.delete(key);
          break;
        }
      }
    }
    return [...terms.values()]
      .filter(e => !e.ko || e.count >= 2 || e.title) // 한글은 1회 출현만으로는 용어로 못 친다 — 제목 출현은 예외
      .sort((a, b) => b.count - a.count || b.title - a.title || a.first - b.first)
      .slice(0, max)
      .map(e => e.display);
  }

  // 서비스가 받는 형식: m4a(AAC 재포장)와 16 kHz 모노 WAV. 330초 WAV가 약 10.6 MB라 상한은 12 MiB다(server/index.js STT_MAX_BYTES와 같다).
  const STT_MIMES = new Set(["audio/mp4", "audio/wav"]), STT_MAX_BYTES = 12 * 1024 * 1024;
  const sttErr = (code, message) => {
    const e = new Error(message);
    e.code = code; e.retryable = false; e.retryAfterMs = null;
    return e;
  };
  const defaultSleep = (ms, signal) => new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(t); reject(new DOMException("취소됨", "AbortError")); };
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, {once: true});
  });
  const buildAudioUrl = async (audio, mime = "audio/mp4") => {
    const prefix = `data:${mime};base64,`;
    if (typeof audio === "string") {
      if (![...STT_MIMES].some(m => audio.startsWith(`data:${m};base64,`))) throw sttErr("STT_BAD_CHUNK", "오디오 데이터 형식이 올바르지 않습니다.");
      // 패딩(=)은 바이트가 아니므로 빼야 정확히 8 MiB인 입력이 거짓으로 거절되지 않는다
      const pad = audio.endsWith("==") ? 2 : audio.endsWith("=") ? 1 : 0;
      if (Math.floor((audio.length - audio.indexOf(",") - 1) * 3 / 4) - pad > STT_MAX_BYTES) throw sttErr("STT_CHUNK_TOO_LARGE", "오디오 청크가 너무 큽니다.");
      return audio;
    }
    let bytes;
    if (audio instanceof ArrayBuffer) bytes = new Uint8Array(audio);
    else if (ArrayBuffer.isView(audio)) bytes = new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength); // 뷰의 바이트만 — 뒤쪽 버퍼가 새면 안 된다
    else if (typeof Blob !== "undefined" && audio instanceof Blob) bytes = new Uint8Array(await audio.arrayBuffer());
    else throw sttErr("STT_BAD_CHUNK", "오디오 데이터 형식이 올바르지 않습니다.");
    if (bytes.length > STT_MAX_BYTES) throw sttErr("STT_CHUNK_TOO_LARGE", "오디오 청크가 너무 큽니다.");
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return prefix + btoa(s);
  };

  // 라이브 캡처는 Float32 PCM을 쥐고 있다 — 서비스가 받는 두 형식 중 WAV(16비트 모노 little-endian)로 감싼다.
  function encodeWav(samples, sampleRate = 16000) {
    if (!Array.isArray(samples) && !(samples instanceof Float32Array)) throw new TypeError("PCM 데이터가 올바르지 않습니다.");
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new TypeError("샘플레이트가 올바르지 않습니다.");
    const n = samples.length, out = new Uint8Array(44 + n * 2), view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const tag = (offset, s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
    tag(0, "RIFF"); view.setUint32(4, 36 + n * 2, true); tag(8, "WAVE");
    tag(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    tag(36, "data"); view.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, Math.round(s * (s < 0 ? 0x8000 : 0x7FFF)), true);
    }
    return out;
  }

  // 간이 추정치 — Phase 0에서 실제 토크나이저로 koTokens/asciiPerToken을 보정한다
  function estimateTokens(str, {koTokens = 1, asciiPerToken = 4} = {}) {
    let n = 0;
    for (const ch of String(str ?? "")) n += ch.codePointAt(0) > 127 ? koTokens : 1 / asciiPerToken;
    return Math.ceil(n);
  }

  // Whisper는 프롬프트의 마지막 224토큰만 읽는다 — 모델이 자르기 전에 우리가 예산 안에서 끊는다
  function buildPrompt(terms, {maxTokens = 224, koTokens = 1, asciiPerToken = 4} = {}) {
    if (!Array.isArray(terms)) return "";
    const seen = new Set();
    let out = "";
    for (const raw of terms) {
      if (typeof raw !== "string") continue;
      const term = raw.trim();
      if (!term) continue;
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const candidate = out ? out + ", " + term : term;
      if (estimateTokens(candidate, {koTokens, asciiPerToken}) > maxTokens) {
        if (!out) continue; // 이 한 개는 절대 못 넣는다 — 다음 후보를 본다
        break;
      }
      out = candidate;
    }
    return out;
  }

  async function transcribeChunks(chunks, {service, concurrency = 4, signal, lang = "ko", model, timeoutMs, termsFor, newId, sleep = defaultSleep, random = Math.random, baseDelayMs = 1000, maxRetries = 3} = {}) {
    if (!Array.isArray(chunks) || typeof service?.stt !== "function" || (lang !== "ko" && lang !== "en" && lang !== "auto")) throw new TypeError("STT 호출 인자가 올바르지 않습니다.");
    if (signal?.aborted) throw new DOMException("취소됨", "AbortError");
    const outcomes = Array.from({length: chunks.length}, (_, i) => ({index: i, status: "pending"}));
    let next = 0, stopped = false;
    const runChunk = async (chunk, index) => {
      if (chunk === null || typeof chunk !== "object") return {index, status: "failed", error: sttErr("STT_BAD_CHUNK", "오디오 청크가 올바르지 않습니다."), attempts: 0};
      const durationSec = Math.round((chunk.t1 - chunk.t0) * 1000) / 1000;
      if (!Number.isFinite(chunk.t0) || chunk.t0 < 0 || !(durationSec > 0) || durationSec > 330 ||
          (chunk.mime !== undefined && !STT_MIMES.has(chunk.mime)))
        return {index, status: "failed", error: sttErr("STT_BAD_CHUNK", "오디오 청크가 올바르지 않습니다."), attempts: 0};
      let audio;
      try { audio = await buildAudioUrl(chunk.audio, chunk.mime); }
      catch (e) { return {index, status: "failed", error: e, attempts: 0}; }
      const prompt = (termsFor ? buildPrompt(termsFor(chunk, index) || []) : "").slice(0, 1000); // 서비스 프롬프트 상한
      // 재시도마다 새 requestId — 실패 뒤 서비스는 예약을 uncertain으로 보고 같은 id를 거절한다
      const base = newId ? String(newId()) : "stt-" + crypto.randomUUID().replace(/-/g, "");
      for (let a = 0; a <= maxRetries; a++) {
        const args = {audio, t0: chunk.t0, durationSec, lang, prompt, requestId: a ? `${base}-r${a}` : base, signal};
        if (model !== undefined) args.model = model;
        if (timeoutMs !== undefined) args.timeoutMs = timeoutMs;
        try {
          const res = await service.stt(args);
          if (!res || typeof res !== "object" || !res.transcript || typeof res.transcript !== "object" || !Array.isArray(res.transcript.segments))
            return {index, status: "failed", error: sttErr("STT_BAD_RESPONSE", "STT 응답 형식이 올바르지 않습니다."), attempts: a + 1};
          return {index, status: "ok", transcript: res.transcript, usage: res.usage ?? null, attempts: a + 1};
        } catch (e) {
          if (signal?.aborted || e?.name === "AbortError") throw e?.name === "AbortError" ? e : new DOMException("취소됨", "AbortError");
          if (e?.retryable && a < maxRetries) {
            await sleep(Math.max(baseDelayMs * 2 ** a * (0.8 + 0.4 * random()), Number(e.retryAfterMs) || 0), signal);
            continue;
          }
          return {index, status: "failed", error: e, attempts: a + 1};
        }
      }
    };
    const worker = async () => {
      while (!stopped && !signal?.aborted) {
        const i = next++;
        if (i >= chunks.length) return;
        if (chunks[i]?.skip === true) { outcomes[i] = {index: i, status: "skipped"}; continue; }
        const outcome = await runChunk(chunks[i], i);
        outcomes[i] = outcome;
        if (outcome.status === "failed") stopped = true; // 실패 후 새 청크는 시작하지 않는다 — 완료분은 재개용으로 남긴다
      }
    };
    const nWorkers = Math.min(Math.max(1, Math.floor(concurrency) || 1), chunks.length);
    await Promise.all(Array.from({length: nWorkers}, () => worker()));
    if (signal?.aborted) throw new DOMException("취소됨", "AbortError");
    return outcomes;
  }

  const api = {energyFrames, vadSegments, planChunks, dedupeOverlap, filterSegments, makeEnergyAt, extractTerms, estimateTokens, buildPrompt, encodeWav, transcribeChunks, HALLUCINATION_PHRASES};
  globalThis.SttClient = api;
  if (typeof module !== "undefined") module.exports = api;
})();
