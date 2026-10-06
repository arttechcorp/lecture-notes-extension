// 파이프라인 v2 단계 오케스트레이션(docs/architecture-v2.md §5.2, §6.3~6.7, §7, §8; docs/note-contract.md §8·§10·§12·§17 6-3~6-6):
// 정제 → 판정 → 계획 → 작성 → 검증·조립 → 렌더를 Pipeline.runStages 로 돌린다. 단계 결과는 단계 캐시에 남아 같은 입력의 재실행은 서비스를 다시 부르지 않는다.
// 노트 계약(슬롯·검증·조립)은 lib/note-contract.js 한 곳에 있다. 여기서는 그 함수만 부른다.
// 서비스(plan·write·judge)·KaTeX·이벤트·렌더러·시계는 전부 deps 로 주입한다. 이벤트와 알림에는 코드·수치·id·시각 구간만 싣고 강의 내용은 싣지 않는다.
//
// runNote(job, input, deps) → {status, note, notices, rendered?, cropMap?}
//   input: {slides:[SlideDoc], transcript:Transcript, gaps:[{reason,t0,t1}], tier:"free"|"paid", models:{plan,write,judge}, consent:{summary},
//           recognition?:"local"|"cloud", options?:{syntheticExamples, externalAugmentation}, meta?:{title, course, lectureDate, session, lang},
//           figureData?:{hashes:{"<slideId>/<figId>":hex}, ocr:{key:text}, crops:[key]}, formulaCrops?:[ "<slideId>/<formulaId>" ], rerun?, host?}
//   deps:  {service:{plan,write,judge}, katex, events?, render?(note,{signal}), signal?, breaker?, sleep?, concurrency?, now?,
//           promptVersions?:{plan,section,repair,global,judge}(/v1/me, 단계·호출 캐시 키에 섞는다 — 없으면 서버 호출은 캐시를 안 쓴다),
//           cacheStats?:{hits,misses}(로컬 캐시 적중 수를 누적한다 — 호출자가 run 끝에 /v1/runs 로 보고)}
//   status "complete" | "partial" | "recognition-only"(요약 동의 없음, 서비스 호출 없이 일시정지) | job 상태("failed"·"paused"·"cancelled")
//   note: NoteContract Note(schemas.note). cropMap: { "F3"|"G1": "<slideId>/<localId>" } — 호출자가 크롭 바이트를 F#·G# 키로 옮긴다.
//   recognition-only 일 때는 note 대신 recognition:{slides:[{slideId,t0,t1,text}], segments:[{t0,t1,text}]} 를 돌려준다(인식 결과 보기).
//   rerun: 같은 입력을 다시 돌릴 때(실패 섹션 재시도·재생성) 올리는 번호. requestId 와 쓰기 이후 단계 캐시 키에 들어간다.
(() => {
  const need = (name, path) => globalThis[name] || (typeof require !== "undefined" ? require(path) : null);
  const Pipeline = need("Pipeline", "./pipeline.js"), Verify = need("Verify", "./verify.js"), Boilerplate = need("Boilerplate", "./boilerplate.js");
  const Formulas = need("Formulas", "./formulas.js"), Preprocess = need("Preprocess", "./preprocess.js"), Contracts = need("Contracts", "./contracts.js");
  const NoteContract = need("NoteContract", "./note-contract.js"), Figures = need("Figures", "./figures.js");

  // 단계 로직이나 알림 모양을 바꾸면 올린다. 단계 캐시 키(promptVersion 자리)에 들어간다.
  const VERSION = "stages-5";
  // 계획 호출 상한(ms): 무료 Supabase Edge 의 150초 안. 1차(추론형) 100초 + 대체(작성 모델) 140초.
  const PLAN_PRIMARY_MS = 100000, PLAN_FALLBACK_MS = 140000;
  const SPEC = NoteContract.NOTE_SPEC_VERSION;
  // /v1/judge 상한: 요청당 항목 200, items JSON 64KiB(server/index.js). 한글은 글자당 3바이트라 개수만으로는 부족해 바이트도 센다.
  const JUDGE_ITEMS = 200, JUDGE_BYTES = 60000, JUDGE_CHARS = 8000;
  // T5 복구의 전역 작업 예산: 근거 재연결 판정 항목 수 + 문장 수정 호출 수의 합계 상한(측정 전 제안값).
  // 넘으면 그 주장은 삭제가 아니라 확인 필요(pending)로 둔다.
  const SUPPORT_BUDGET = 40;
  // 전역 Writer 입력 상한(server/prompts.js globalInput 24k 토큰 × 4바이트)보다 넉넉히 작게 잡는다(6-4).
  const GLOBAL_BYTES = 80000;
  // 섹션을 나눠 다시 보내면 풀리는 서버 오류(§12.4): 출력 잘림, 입력 상한 초과.
  const SPLIT = new Set(["llm_output_truncated", "request_too_large"]);
  const ALIAS = { llm_output_truncated: "LLM_TRUNCATED" };
  const enc = new TextEncoder();
  const uniq = list => [...new Set(list)];
  const kept = s => s.status == null || s.status === "kept";
  const bytes = v => enc.encode(JSON.stringify(v)).length;

  // summary.js gapRanges 이식: 시각 순으로 세워 같은 이유가 연달아 이어진 것은 한 구간으로 합친다. 없는 구간을 지어내지 않도록 기록된 시각만 쓴다.
  // ponytail: 이유가 같으면 사이가 멀어도 한 구간이다(v1 과 같다). 멀리 떨어진 같은 이유 구간을 따로 보여 주려면 여기서 t0 <= last.t1 을 요구한다.
  function gapRanges(gaps) {
    const out = [];
    for (const g of (gaps || []).filter(g => Number.isFinite(g?.t0)).sort((a, b) => a.t0 - b.t0)) {
      const reason = String(g.reason || "unknown").slice(0, 40), t1 = Math.max(g.t0, Number.isFinite(g.t1) ? g.t1 : g.t0), last = out.at(-1);
      if (last?.reason === reason) last.t1 = Math.max(last.t1, t1);
      else out.push({ reason, t0: g.t0, t1 });
    }
    return out;
  }

  // 판정 항목을 개수와 바이트 상한 안의 묶음으로 나눈다. 항목 하나가 상한을 넘는 일은 없다(항목당 8000자 ≤ 24KB).
  function batches(items) {
    const out = [];
    let cur = [], size = 2;
    for (const it of items) {
      const n = bytes(it) + 1;
      if (cur.length && (cur.length >= JUDGE_ITEMS || size + n > JUDGE_BYTES)) { out.push(cur); cur = []; size = 2; }
      cur.push(it); size += n;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  // 봉투 안의 주장({text, evidenceIds, basis})을 경로와 함께 모은다. 근거 지지(T5)와 전역 입력 요약이 쓴다.
  function claimsIn(node, path = "", out = []) {
    if (node && typeof node === "object" && !Array.isArray(node) && typeof node.text === "string" && Array.isArray(node.evidenceIds) && typeof node.basis === "string") {
      out.push({ path, claim: node }); return out;
    }
    if (Array.isArray(node)) node.forEach((v, i) => claimsIn(v, `${path}/${i}`, out));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) claimsIn(v, `${path}/${k}`, out);
    return out;
  }
  // 전역 Writer 입력(6-4): 근거 원문 대신 살아남은 블록의 주장 텍스트와 참조. 크면 블록당 주장 수와 길이를 줄여 상한 안에 둔다.
  function globalSections(survivors, limit = GLOBAL_BYTES) {
    const steps = [[12, 600], [6, 300], [3, 200], [1, 160]];
    for (let i = 0; i < steps.length; i++) {
      const [perBlock, chars] = steps[i];
      const sections = survivors.map(s => ({
        sectionId: s.sectionId, title: s.title, gist: s.gist ? { text: s.gist.text.slice(0, chars), evidenceIds: s.gist.evidenceIds, basis: s.gist.basis } : null,
        blocks: s.blocks.map(b => ({
          blockId: b.id, type: b.type,
          claims: claimsIn(b.envelope.content).slice(0, perBlock).map(({ claim }) => ({ text: claim.text.slice(0, chars), evidenceIds: claim.evidenceIds, basis: claim.basis })),
        })),
      }));
      const sz = bytes(sections);
      if (sz <= limit) {
        Object.defineProperty(sections, "shrink", {
          value: { step: i + 1, perBlock, chars, bytes: sz, limit },
          writable: true, configurable: true, enumerable: false,
        });
        return sections;
      }
    }
    return null;
  }

  // 서비스 오류 코드(소문자)를 파이프라인 코드(영역_원인)로 접는다. 이미 코드가 있는 오류는 그대로, 코드가 없는 오류(버그)는 null.
  function codeFor(e, area) {
    const c = Pipeline.codeOf(e, area);
    if (c || typeof e?.code !== "string") return c;
    const up = e.code.toUpperCase().replace(/\W/g, "_");
    return ALIAS[e.code] ?? (up.startsWith(area + "_") ? up : `${area}_${up}`).slice(0, 64);
  }
  const asCoded = (e, area) => Pipeline.codeOf(e, area) || typeof e?.code !== "string" ? e : Pipeline.pipelineError(codeFor(e, area), { cause: e });
  // 이 오류는 섹션 하나가 아니라 작업 전체를 멈춘다: 일시정지 사유가 있는 코드(한도·네트워크·차단기 등)와 버그. 완료된 호출은 캐시에 남아 재개가 싸다.
  // 제공자의 형식 실패(provider_failed_or_invalid_output)는 그 요청만의 문제다 — 재시도를 다 써도 LLM_UNAVAILABLE(일시정지)로 작업 전체를 멈추지 않고 그 섹션만 뺀다.
  // 정말로 제공자가 죽었다면 모든 섹션이 실패하고 "한 섹션도 못 썼다"에서 멈춘다.
  const halting = (e, area) => { if (e?.code === "provider_failed_or_invalid_output") return false; const c = codeFor(e, area); return !c || Boolean(Pipeline.CODES[c]?.pause); };
  const scoped = (events, jobId) => ({ emit: e => events.emit({ jobId, ...e }), span: f => events.span({ jobId, ...f }) });
  const must = ok => { if (!ok) throw Pipeline.pipelineError("VAL_OUTPUT_INVALID"); };
  const policyOf = o => NoteContract.policyOf(o);

  async function runNote(job, input, deps = {}) {
    const { slides = [], transcript, gaps = [], tier, models = {}, consent } = input ?? {};
    const options = policyOf(input?.options), recognition = input?.recognition === "cloud" ? "cloud" : "local";
    // 판정은 유료이면서 판정 모델이 있을 때만 한다. 서버가 judge 기능을 끄면(/v1/me features) 호출자가 모델을 비워 판정 없이 진행한다(설계 §17 기능 스위치).
    const runTag = deps.runTag ?? Math.random().toString(36).slice(2, 10);
    const judged = tier === "paid" && Boolean(models.judge), signal = deps.signal, ev = scoped(deps.events ?? job.events, job.jobId);
    // T5 평가 경로(§4.4): judgeShadow 면 판정·계측만 하고 본문을 바꾸지 않는다. supportBudget 은 복구 작업 전역 상한 재정의다.
    const judgeShadow = deps.judgeShadow === true || input?.options?.judgeShadow === true;
    const supportBudget = Number.isInteger(deps.supportBudget) && deps.supportBudget >= 0 ? deps.supportBudget : SUPPORT_BUDGET;
    const rerun = Number.isInteger(input?.rerun) && input.rerun > 0 ? input.rerun : 0;
    const segments = transcript?.segments ?? [];
    if (job.state === "created") await job.transition("acquiring_source");
    if (job.state === "acquiring_source") await job.transition("ingesting");
    // 고지의 ranges 는 {t0,t1} 만 받는다(note 계약) — 이유는 구간 머지에만 쓰고 여기서 벗긴다.
    const ranges = gapRanges(gaps), gapNotices = ranges.length ? [{ code: "NOTE_CAPTURE_GAP", count: ranges.length, ranges: ranges.map(({ t0, t1 }) => ({ t0, t1 })) }] : [];

    // 요약 동의가 없으면 서비스를 부르지 않고 인식 결과만 돌려준다(§5.2, recognitionResult 이식). 다른 엔진·경로로 조용히 넘어가지 않는다 —
    // 작업은 사용자 사유로 일시정지하고, 동의한 뒤 job.resume() 과 같은 입력의 runNote 로 이어 간다.
    if (consent?.summary !== true) {
      if (!["paused", "done", "failed", "cancelled"].includes(job.state)) await job.transition("paused", { reason: "user", code: "CONSENT_SUMMARY_REQUIRED" });
      const usable = Boilerplate.detect(slides).slides;
      const recognition = {
        slides: usable.map(s => ({ slideId: String(s.slideId), t0: s.t0, t1: s.t1 ?? null, text: Preprocess.slideText(s) })).filter(s => s.text),
        segments: segments.filter(kept).map(({ t0, t1, text }) => ({ t0, t1: t1 ?? t0, text: String(text ?? "").trim() })).filter(s => s.text),
      };
      return { status: "recognition-only", note: null, recognition, notices: [...gapNotices, { code: "CONSENT_SUMMARY_REQUIRED" }], counts: { slides: slides.length, segments: recognition.segments.length } };
    }
    if (!deps.service || typeof deps.katex?.renderToString !== "function") throw new TypeError("service 와 katex 가 필요합니다.");
    if (!models.plan || !models.write) throw new TypeError("계획·작성 모델이 필요합니다.");
    const breaker = deps.breaker ?? Pipeline.createBreaker();
    const wait = ms => deps.sleep ? deps.sleep(ms, signal) : new Promise((res, rej) => {
      const t = setTimeout(res, ms);
      signal?.addEventListener("abort", () => { clearTimeout(t); rej(signal.reason); }, { once: true });
    });
    const ctx = { signal, out: {}, cacheStats: deps.cacheStats ?? null };
    const R = () => ctx.out.refining;

    let scored;
    const units = () => scored ??= R().ir.units.map(u => {
      const s = ctx.out.judging.importance[u.unitId];
      return typeof s === "number" ? { ...u, judge: { ...u.judge, importance: s } } : u;
    });
    // 강의 원어: 발화(없으면 슬라이드 글)에서 라틴 글자가 한글 음절의 4배를 넘으면 영어 강의다. 영어 강의는 작성 요청에 sourceLang "en" 을 싣는다.
    // ponytail: 글자 수 비율만 본다 — 한국어 발화에 영어 슬라이드인 강의는 한국어로 친다. 다른 언어가 필요해지면 STT 감지 언어를 쓴다.
    let lang;
    const sourceLang = () => lang ??= (() => {
      const speech = R().ir.units.map(u => u.speech).join(" "), text = speech.trim().length >= 200 ? speech : R().ir.units.map(u => `${u.slideText} ${u.speech}`).join(" ");
      const ko = (text.match(/[가-힣]/g) || []).length, latin = (text.match(/[A-Za-z]/g) || []).length;
      return latin > 4 * ko ? "en" : "ko";
    })();
    const langBody = () => sourceLang() === "en" ? { sourceLang: "en" } : {};
    // 영어 강의 출력의 주장 src 를 떼어 {경로: src} 로 돌려준다(노트 검증·조립은 src 없는 주장만 안다). 경로는 /blocks/<id><봉투 안 경로>.
    const splitSrc = out => {
      const src = {};
      for (const { path, claim } of claimsIn(out)) if (Object.hasOwn(claim, "src")) { if (typeof claim.src === "string" && claim.src.trim()) src[path] = claim.src; delete claim.src; }
      return src;
    };
    // 섹션 Writer 입력: 섹션 유닛과 허용된 교차 유닛의 근거, 그 유닛에 나온 수식(서버 상한 200건)·도표.
    const ownUnits = sec => new Set([...sec.unitIds, ...sec.crossUnitIds]);
    const evidenceFor = sec => { const us = ownUnits(sec); return R().evidence.filter(e => us.has(e.unitId)); };
    const regFor = sec => { const us = ownUnits(sec); return R().registry.filter(e => (R().formulaUnits[e.id] || []).some(u => us.has(u))).slice(0, 200).map(e => ({ id: e.id, latex: e.latex ?? null, status: e.status })); };
    const figsFor = sec => { const us = ownUnits(sec); return R().figures.filter(f => us.has(f.unitId)).slice(0, 50).map(f => ({ id: f.id, kind: f.kind, title: f.title ?? null, cells: f.cells ? f.cells.slice(0, 30).map(r => r.slice(0, 6).map(c => String(c).slice(0, 200))) : null })); };
    // deps.promptVersions(=/v1/me 응답의 작업별 서버 프롬프트 버전)를 단계·호출 캐시 키에 섞는다 — 서버 프롬프트만 바뀌어도
    // 같은 입력의 낡은 결과를 재사용하지 않는다(§7). 버전을 모르면(구 서버·오프라인) 캐시를 쓰지 않는 쪽이 안전하다.
    const pv = deps.promptVersions && typeof deps.promptVersions === "object" ? deps.promptVersions : null;
    const srvV = task => { const v = pv?.[task]; return typeof v === "string" && v ? v.slice(0, 32) : null; };
    // tasks: 이 단계가 기대는 서버 작업. 하나라도 버전을 모르면 이번 실행만의 태그를 붙여 재사용을 막는다(실패 안전).
    const K = async (value, model = null, schemaVersion = SPEC, tasks = []) => {
      const missing = tasks.some(t => srvV(t) === null);
      const tag = tasks.length ? "|" + tasks.map(t => srvV(t) ?? "?").join("|") : "";
      return { inputDigest: await Pipeline.digest(value), model, promptVersion: VERSION + tag + (missing ? "?" + runTag : ""), schemaVersion };
    };
    const stage = (state, area, key, run) => ({ state, area, key, run: async c => { try { return await run(c); } catch (e) { throw asCoded(e, area); } } });

    // 서비스 호출 한 건. 본문 해시가 같으면 패키지 캐시의 결과를 다시 쓴다 — 서버는 같은 requestId 를 409 로 막고 결과를 저장하지 않으므로,
    // 일시정지 뒤 재개나 취소 뒤 재실행에서 이미 돈을 낸 호출을 다시 보내면 안 된다. requestId = 본문 해시 + rerun, 재시도마다 retryId.
    async function call(method, label, model, body, area, shape, extra = {}) {
      const inputDigest = await Pipeline.digest({ label, model, body });
      // 호출 캐시의 프롬프트 버전은 단계 버전 + 그 작업의 서버 프롬프트 버전이다(write 는 stage 별 버전). 서버 버전을 모르면
      // 캐시를 읽지도 쓰지도 않는다 — 낡은 프롬프트의 결과를 재사용할 수 없으므로 안전한 쪽(§7).
      const promptVersion = srvV(method === "write" && typeof body?.stage === "string" ? body.stage : method);
      const stats = ctx.cacheStats;
      const key = promptVersion === null ? null
        : await Pipeline.stageKey({ stage: "call." + label, inputDigest, model, promptVersion: `${VERSION}+${promptVersion}`, schemaVersion: SPEC });
      // 실행마다 다른 runTag 를 섞는다: 이어 하기·다시 시도가 앞선 실행이 쓴 requestId(서버에 예약이 남은)와 겹치지 않게. 끝난 호출은 위 캐시가 막아 다시 결제하지 않는다.
      const base = `${label}-${(await Pipeline.digest({ inputDigest, rerun, runTag })).slice(0, 32)}`;
      const attempt = () => Pipeline.withRetry(
        n => breaker.run(model, () => deps.service[method]({ ...body, model, requestId: Pipeline.retryId(base, n), signal, jobId: job.jobId, ...extra }), { area }),
        { signal, sleep: deps.sleep },
      );
      // 제공자가 바쁘면(재시도를 다 쓴 429·5xx, 열린 차단기) 조금 기다렸다 다시 한다. 열린 차단기는 닫힐 때까지, 반열림 시험 호출은 한 건뿐이라 동시 호출은 몇 번 더 본다.
      // 필드: 429 는 1분 안에 풀렸는데 열린 차단기 오류가 곧바로 작업 전체를 일시정지시켰다. 끝내 바쁘면 호출자가 대체 모델·일시정지를 고른다.
      const patient = async () => {
        for (let k = 0; ; k++) {
          try { return await attempt(); } catch (e) {
            // 제공자의 형식 실패는 그 요청만의 문제라 기다려도 같다(halting 참고).
            if (!((e?.retryable === true && e.code !== "provider_failed_or_invalid_output") || e?.code === `${area}_CIRCUIT_OPEN`) || k >= 4) throw e;
            await wait(Math.max(e.retryAfterMs ?? 0, 5000));
          }
        }
      };
      const compute = async () => shape(await patient());
      if (key === null) { if (stats) stats.misses++; return compute(); }
      return Pipeline.cached(job.store, key, compute, { packageId: job.packageId, signal, stats });
    }
    const settle = (results, area) => {
      signal?.throwIfAborted();
      const bad = results.find(r => r.status === "failed");
      if (bad) throw asCoded(bad.error, area);
      return results.map(r => r.value);
    };
    const lanes = name => Pipeline.laneCount(name, deps.concurrency);
    // 응답 시간 초과(클라이언트 120초·서버 150초). 사용자 취소(작업 signal)는 아니다. 섹션은 나눠 다시 쓰고, repair·전역 글은 그 부분만 빼고 노트를 마친다.
    const timedOut = e => !signal?.aborted && (e?.name === "AbortError" || e?.code === "request_cancelled_or_timed_out");
    // 대체 작성 모델(models.writeAlt, 다른 제공자): 주 모델이 시간 초과·잘림·형식/제공자 오류로 못 한 일을 한 번 더 맡는다.
    // 한도·인증·연결 끊김·취소처럼 작업을 멈춰야 하는 오류는 넘기지 않는다.
    const ALT = models.writeAlt && models.writeAlt !== models.write ? models.writeAlt : null;
    const recoverable = e => timedOut(e) || SPLIT.has(e?.code) || !halting(e, "LLM");
    // 주 모델이 바쁨(재시도를 다 쓴 429·5xx, 열린 차단기)이면 작업을 멈추지 않고 대체 모델에 넘긴다 — 차단기는 모델별이라 대체 모델은 따로 센다.
    // 필드: 작성 모델 429 여섯 번에 차단기가 열려 작업 전체가 network 일시정지했다. 대체 모델도 바쁘면 그때 멈춘다.
    const busy = e => ["LLM_UNAVAILABLE", "LLM_CIRCUIT_OPEN"].includes(codeFor(e, "LLM"));
    const toAlt = (e, model) => !!ALT && model !== ALT && (recoverable(e) || busy(e));
    const altNote = (stage, unit, e, what) => ev.emit({ stage, ...(unit ? { unit } : {}), level: "warn", code: "ALT_MODEL", msg: `${what} ${timedOut(e) ? "timeout" : String(e?.code ?? "-")}`.slice(0, 80) });
    // 서버 응답은 쓰기 전에 다시 검증하고(§5.4) 캐시에는 검증을 통과한 부분만 넣는다.
    const asOutput = schema => r => (must(Contracts.validate(schema, r?.output).ok), r.output);
    const asResults = r => (must(Array.isArray(r.results) && r.results.every(x => Contracts.validate(Contracts.SCHEMAS.judgeResult, x).ok)), r.results);

    // ── C. 정제: 로컬, 순수 함수 ──
    const fd = input?.figureData ?? {};
    const refining = stage("refining", "LLM",
      () => K({ slides, segments: segments.map(({ t0, t1, text, status }) => ({ t0, t1, text, status })), katex: deps.katex.version ?? null, fd, fc: input?.formulaCrops ?? [], tier }, null, Contracts.CONTRACT_VERSION),
      async () => {
        const bp = Boilerplate.detect(slides); // 비파괴: 걸러낸 블록은 selection:"filtered" 로 남는다
        // ponytail: 재판독(reread)은 연결하지 않았다 — 검증에 실패한 수식은 바로 image(원본 크롭)로 내린다.
        const registry = Formulas.buildRegistry(bp.slides).map(e => Formulas.verify(e, { katex: deps.katex, reread: true }));
        const ir = Preprocess.buildIR(bp.slides, segments);
        // 병합된 슬라이드는 mergedFrom 으로 거슬러 올라간다(레지스트리·도표는 병합 전 슬라이드 id 를 쓴다).
        const owner = new Map();
        for (const m of Preprocess.mergeProgressive(bp.slides)) for (const id of [...(m.mergedFrom ?? []), m.slideId]) owner.set(String(id), String(m.slideId));
        const unitBySlide = new Map(ir.units.filter(u => u.slideId != null).map(u => [String(u.slideId), u.unitId]));
        const unitOf = s => unitBySlide.get(owner.get(String(s))) ?? null;
        const formulaUnits = Object.fromEntries(registry.map(e => [e.id, uniq([e.slideId, ...e.seenOn].map(unitOf).filter(Boolean))]));
        // Free 는 도표를 찾지 않는다(§14). 유료는 도표 레지스트리가 G# 와 표시 방식을 정한다(6-6).
        const figs = tier === "paid" ? Figures.buildFigureRegistry(bp.slides, { unitOf, evidence: ir.evidence, hashes: fd.hashes ?? {}, ocr: fd.ocr ?? {}, crops: fd.crops ?? [] }) : [];
        const cropMap = {};
        const fc = new Set(input?.formulaCrops ?? []);
        for (const e of registry) if (e.sourceId != null && fc.has(`${e.slideId}/${e.sourceId}`)) cropMap[e.id] = `${e.slideId}/${e.sourceId}`;
        for (const f of figs) if (f.cropKey && (fd.crops ?? []).includes(f.cropKey)) cropMap[f.id] = f.cropKey;
        const figures = figs.map(({ cropKey, ...f }) => f);
        if (ir.stats) {
          const s = ir.stats, rep = s.repeats ?? {};
          const msg = `raw=${s.rawChars} ir=${s.irChars} ratio=${s.ratio} filter=${s.filteredBlocks} dropSeg=${s.droppedSegments} mergeSlide=${s.mergedSlides} repFill=${rep.fillers ?? "-"} repStut=${rep.stutters ?? "-"} repWhisp=${rep.whisperRepeats ?? "-"}`;
          ev.emit({ stage: "refining", level: "info", code: "PREPROCESS_STATS", msg: msg.slice(0, 200) });
        }
        return { ir: { units: ir.units, stats: ir.stats }, evidence: ir.evidence, registry, formulaUnits, figures, cropMap };
      });

    // ── D. 판정: 유료만. Free 는 호출 없이 지나가는 빈 단계다 ──
    // ponytail: T2 유닛 중요도만 호출한다. T1·T3·T4 는 범위 밖이다. T5(근거 지지)는 검증 단계가 주장 단위로 부른다.
    const judging = stage("judging", "JDG", () => K({ paid: judged, units: R().ir.units }, judged ? models.judge : null, SPEC, judged ? ["judge"] : []), async () => {
      if (!judged) return { importance: {} };
      const items = R().ir.units.map(u => ({ itemId: u.unitId, text: `${u.slideText}\n${u.speech}`.trim().slice(0, JUDGE_CHARS) })).filter(i => i.text);
      const rs = settle(await Pipeline.pool(batches(items),
        b => call("judge", "importance", models.judge, { task: "importance", items: b }, "JDG", asResults),
        { lanes: lanes("judge"), signal, events: ev, stage: "judge" }), "JDG");
      const importance = {};
      for (const r of rs.flat()) if (Number.isFinite(r.score)) importance[r.itemId] = Math.min(5, Math.max(1, r.score));
      return { importance };
    });

    // ── E. 계획: 1회. 코드가 blockId·버전·정책을 붙여 Plan 으로 정규화한다(§8.2) ──
    const planning = stage("planning", "LLM",
      () => K({ units: units(), registry: R().registry.map(({ id, status }) => ({ id, status })), figures: R().figures.map(({ id, unitId, kind, title }) => ({ id, unitId, kind, title })), options, recognition }, models.plan, SPEC, ["plan"]),
      async () => {
        if (!units().length) throw Pipeline.pipelineError("VAL_NO_CONTENT");
        const formulas = R().registry.map(({ id, status }) => ({ id, status, unitIds: (R().formulaUnits[id] || []).slice(0, 20) }));
        const figures = R().figures.map(({ id, unitId, kind, title }) => ({ id, unitId, kind, title: title ?? null }));
        const planBody = { noteSpecVersion: SPEC, ir: { units: units() }, formulas, figures, recognition, options, ...(input?.host ? { host: input.host } : {}) };
        // 스키마를 통과한 계획도 의미 규칙을 깰 수 있다 — 코드가 고치고(PLAN_REPAIRED), 못 고치면 detail 을
        // 로그에 남기고 VAL_PLAN_INVALID 로 멈춘다. 보정·정규화까지 shape 안에서 끝내므로 호출 캐시에는
        // 정규화를 통과한 계획만 남는다 — shape 이 던지면 Pipeline.cached 는 아무것도 쓰지 않아 "다시 시도" 가 같은 계획을 재생하지 않는다.
        const scope = { units: units(), formulaUnits: R().formulaUnits, figures: R().figures };
        const planShape = r => {
          must(Contracts.validate(NoteContract.schemas.plannerOutput, r?.plan).ok);
          const { output, fixes } = NoteContract.repairPlan(r.plan, scope);
          if (fixes.length) ev.emit({ stage: "planning", level: "warn", code: "PLAN_REPAIRED", msg: fixes.join(",").slice(0, 200) });
          const n = NoteContract.normalizePlan(output, { ...scope, policy: options });
          if (!n.ok) {
            const detail = n.errors[0].detail.slice(0, 20);
            ev.emit({ stage: "planning", level: "error", code: "VAL_PLAN_INVALID", msg: detail.join(",").slice(0, 200) });
            throw Pipeline.pipelineError("VAL_PLAN_INVALID", { detail });
          }
          return { plan: n.plan, promptVersion: typeof r.promptVersion === "string" ? r.promptVersion.slice(0, 32) : null };
        };
        // 서버(Supabase Edge 무료)는 요청 하나를 150초 안에 끝내야 한다. 추론형 계획 모델이 그 안에 못 끝내면 작성 모델로 한 번 다시 계획한다 — 사용자 취소는 그대로 멈춘다.
        // ponytail: 시간 초과 판정은 클라이언트 타임아웃·서버 타임아웃·네트워크 끊김을 한데 본다. 유료 Supabase(400초)로 옮기면 PLAN_PRIMARY_MS 만 올린다.
        const slow = e => !signal?.aborted && (e?.name === "AbortError" || e?.code === "request_cancelled_or_timed_out" || Pipeline.codeOf(e) === "NET_UNREACHABLE");
        let out;
        if (models.plan === models.write) out = await call("plan", "plan", models.plan, planBody, "LLM", planShape, { timeoutMs: PLAN_FALLBACK_MS });
        else {
          try { out = await call("plan", "plan", models.plan, planBody, "LLM", planShape, { timeoutMs: PLAN_PRIMARY_MS }); }
          catch (e) {
            if (!slow(e)) throw e;
            ev.emit({ stage: "planning", level: "warn", code: "PLAN_FALLBACK_MODEL", msg: `${models.plan} 시간 초과 → ${models.write}`.slice(0, 200) });
            out = await call("plan", "plan", models.write, planBody, "LLM", planShape, { timeoutMs: PLAN_FALLBACK_MS });
          }
        }
        return out; // {plan: 정규화된 Plan, promptVersion} — 같은 shape 라 캐시 적중 때도 같은 모양이다
      });

    // ── F. 작성: 섹션 병렬. 섹션 하나의 실패는 노트를 죽이지 않는다 ──
    // 유효 참조 목록(allowedRefs): 정규화된 전체 계획에서 한 번 만든다 — 나눠 쓰는 조각이나 살아남은 섹션이 아니다.
    // 대상은 섹션 id·모든 블록 id(섹션·전역)·defined 개념·B08/B09 의 단서 위치(P1..P6), 복습 위치는 섹션 블록 id(S#_B#)뿐이다
    // — 전역 블록과 지도 노드 키는 어느 칸의 참조도 아니다. 서버는 실린 목록으로 출력 스키마의 대상·복습 칸을 enum 으로 좁힌다.
    let arefs;
    const allowedRefs = () => arefs ??= (() => {
      const p = ctx.out.planning.plan, targetIds = [], reviewIds = [];
      for (const s of p.sections) {
        targetIds.push(s.sectionId);
        for (const b of s.blocks) {
          targetIds.push(b.blockId); reviewIds.push(b.blockId);
          if (b.type === "B08" || b.type === "B09") for (let i = 1; i <= 6; i++) targetIds.push(`${b.blockId}/P${i}`);
        }
      }
      for (const g of p.global) targetIds.push(g.blockId);
      for (const c of p.concepts) if (c.depth === "defined") targetIds.push(c.conceptId);
      return { targetIds: uniq(targetIds).slice(0, 3500), reviewIds: uniq(reviewIds).slice(0, 500) };
    })();
    const writeBody = sec => ({ noteSpecVersion: SPEC, section: sec, concepts: ctx.out.planning.plan.concepts, evidence: evidenceFor(sec), registry: regFor(sec), figures: figsFor(sec), options, allowedRefs: allowedRefs(), ...langBody() });
    const outSchema = sch => sourceLang() === "en" ? NoteContract.withSource(sch) : sch;
    async function writeSection(sec) {
      // 서버가 형식 오류로 비운 블록의 원래 봉투(salvaged)는 출력 옆에 실어 둔다 — 검증 단계가 repair 로 고친다. 계획에 없는 id·객체 아닌 값은 버린다.
      const send = (s, withGist, model) => call("write", "section", model, { stage: "section", ...writeBody(s), section: s, withGist }, "LLM", r => {
        const out = asOutput(outSchema(NoteContract.sectionOutputSchemaFor(s, { gist: withGist, policy: options, allowedRefs: allowedRefs() })))(r), ids = new Set(s.blocks.map(b => b.blockId));
        const src = splitSrc(out);
        const sv = Object.fromEntries(Object.entries(r?.salvaged ?? {}).filter(([k, v]) => ids.has(k) && out.blocks[k] === null && v && typeof v === "object" && !Array.isArray(v)));
        if (sourceLang() === "en") for (const v of Object.values(sv)) splitSrc(v);
        // 서버가 찾은 스키마 오류(블록 안 경로 + 사유, 내용 없음) — repair 지시에 싣는다.
        const why = Object.fromEntries(Object.keys(sv).map(k => [k, (Array.isArray(r?.salvagedErrors?.[k]) ? r.salvagedErrors[k] : []).filter(x => typeof x === "string").map(x => x.slice(0, 64)).slice(0, 20)]));
        return { ...out, ...(Object.keys(sv).length ? { salvaged: sv, why } : {}), ...(Object.keys(src).length ? { src } : {}) };
      });
      // §12.4: 잘리면 계획 블록을 반으로 나눠 다시 요청하고, 반쪽도 잘리면 또 나눈다. 근거 입력은 같다. gist 는 맨 앞 조각에만, checks 는 합친다.
      // 블록 하나만으로도 잘리면 그 블록만 null(보류)로 두고 섹션은 살린다 — 필드: 14k 상한에서도 두 반쪽이 다 잘려 단원 하나가 통째로 빠졌다.
      // 실패 사다리: (잘림·시간 초과) 같은 모델로 반씩 나눠 다시 → 더 못 나누면(블록 하나) 대체 모델 → 그래도 안 되면 그 블록만 null.
      // 형식·제공자 오류처럼 나눠도 소용없는 실패는 바로 대체 모델로 같은 조각을 다시 쓴다.
      const parts = async (s, withGist, model = models.write) => {
        try { return await send(s, withGist, model); } catch (e) {
          // 응답 시간 초과(클라이언트 120초·서버 150초)도 잘림처럼 나눈다 — 제공자가 느린 날 큰 섹션 하나가 작업 전체를 network 일시정지로 멈췄다.
          // 사용자 취소(작업 signal)는 그대로 던진다. 연결 자체가 끊긴 오류(NET_UNREACHABLE)는 나눠도 소용없어 그대로 멈춘다.
          const timeout = timedOut(e), splittable = SPLIT.has(e?.code) || timeout;
          if (!recoverable(e) && !toAlt(e, model)) throw e;
          if (!splittable || s.blocks.length < 2) {
            if (toAlt(e, model)) { altNote("write", sec.sectionId, e, `blocks=${s.blocks.length}`); return parts(s, withGist, ALT); }
            if (!splittable) throw e;
            ev.emit({ stage: "write", unit: sec.sectionId, level: "warn", code: timeout ? "WRITE_TIMEOUT" : codeFor(e, "LLM"), msg: "held 1" });
            return { gist: null, blocks: { [s.blocks[0].blockId]: null }, checks: [] };
          }
          ev.emit({ stage: "write", unit: sec.sectionId, level: "warn", code: timeout ? "WRITE_TIMEOUT" : codeFor(e, "LLM"), msg: `split ${s.blocks.length}` });
          const h = Math.ceil(s.blocks.length / 2);
          const a = await parts({ ...s, blocks: s.blocks.slice(0, h) }, withGist, model), b = await parts({ ...s, blocks: s.blocks.slice(h) }, false, model);
          const sv = { ...a.salvaged, ...b.salvaged }, why = { ...a.why, ...b.why }, src = { ...a.src, ...b.src };
          return { gist: withGist ? a.gist : null, blocks: { ...a.blocks, ...b.blocks }, checks: [...a.checks, ...b.checks].slice(0, 6), ...(Object.keys(sv).length ? { salvaged: sv, why } : {}), ...(Object.keys(src).length ? { src } : {}) };
        }
      };
      return parts(sec, true);
    }
    const writing = stage("writing", "LLM",
      () => K({ plan: ctx.out.planning.plan, units: units(), evidence: R().evidence.length, registry: R().registry.map(({ id, latex, status }) => ({ id, latex, status })), figures: R().figures.map(f => f.id), options, rerun }, models.write, SPEC, ["section"]),
      async () => {
        const secs = ctx.out.planning.plan.sections;
        ev.emit({ stage: "write", level: "info", code: "SOURCE_LANG", msg: sourceLang() });
        const rs = await Pipeline.pool(secs, writeSection, { lanes: lanes("write"), signal, events: ev, stage: "write" });
        signal?.throwIfAborted();
        // 한도·네트워크·차단기처럼 모든 섹션을 막을 오류는 부분 노트로 덮지 않고 작업을 멈춘다. 쓴 섹션은 호출 캐시에 남아 재개가 싸다.
        const stop = rs.find(r => r.status === "failed" && halting(r.error, "LLM"));
        if (stop) throw stop.error;
        const sections = rs.map((r, i) => ({ sectionId: secs[i].sectionId, output: r.status === "ok" ? r.value : null }));
        if (!sections.some(s => s.output)) throw rs.find(r => r.status === "failed").error; // 한 섹션도 못 썼다면 부분 노트가 아니라 실패다
        const failed = sections.filter(s => !s.output).map(s => s.sectionId);
        ev.emit({ stage: "write", msg: `sections=${sections.length - failed.length} failed=${failed.length}` });
        return { sections, failed };
      });

    // ── G. 검증·조립: 섹션 검증 → 실패 블록만 blockId repair 1회 → (유료) 주장 단위 근거 지지 → 전역 Writer → assembleNote ──
    const validating = stage("validating", "LLM",
      () => K({ writing: ctx.out.writing, plan: ctx.out.planning.plan, judge: judged ? models.judge : null, gaps, rerun, meta: input?.meta ?? null, crops: Object.keys(R().cropMap), judgeShadow, supportBudget: deps.supportBudget ?? null }, models.write, SPEC, ["repair", "global", ...(judged ? ["judge"] : [])]),
      async () => {
        const plan = ctx.out.planning.plan, planOf = new Map(plan.sections.map(s => [s.sectionId, s]));
        const base = { plan, evidence: R().evidence, registry: R().registry, formulaUnits: R().formulaUnits, figures: R().figures, katex: deps.katex };
        const check = (sectionId, output) => NoteContract.validateSection({ ...base, sectionId, output });

        // 1차 검증 → 실패 블록만 다시 쓴다(§12.1). Writer 가 null 로 보류한 블록과 섹션 단위 오류(커버리지)는 다시 쓰지 않는다.
        // 재생성 호출이 실패하면 실패 블록은 그대로 빠진다(한도·네트워크 오류는 작업을 멈춘다).
        // 서버가 형식 오류로 비운 블록(salvaged)도 원래 봉투를 previous 로 repair 한다. 모델이 스스로 null 로 둔 블록은 그대로 보류다.
        let repaired = 0, serverHeld = 0, writerHeld = 0;
        const heldWhy = {};
        // repair 출력 shape — fix() 와 T5 회복이 같은 strict 출력 스키마를 쓴다. 영어 강의면 주장의 src 를 뗀다.
        const repairShape = (sec, list) => x => { const o = asOutput(outSchema(NoteContract.repairOutputSchemaFor(sec, list.map(y => y.blockId), options, allowedRefs())))(x), s2 = splitSrc(o); return Object.keys(s2).length ? { ...o, src: s2 } : o; };
        const fix = async ({ sectionId, output: raw }) => {
          if (!raw) return { sectionId, output: raw };
          const { salvaged = {}, why = {}, src = {}, ...output } = raw;
          const v = check(sectionId, output), sec = planOf.get(sectionId);
          const bad = v.blocks.filter(b => b.errors.length && !b.errors.every(e => e.code === "VAL_BLOCK_DECLINED") && b.envelope);
          const held = v.blocks.filter(b => b.envelope == null && Object.hasOwn(salvaged, b.id));
          serverHeld += held.length;
          // 서버가 비운 사유의 종류(마지막 칸 이름 + 메시지, 내용 없음)를 모아 진단에 남긴다.
          for (const b of held) for (const d of why[b.id] ?? []) { const [p, ...m] = d.split(" "); const k = `${p.split("/").filter(x => !/^\d+$/.test(x)).pop() ?? "-"} ${m.join(" ")}`; heldWhy[k] = (heldWhy[k] ?? 0) + 1; }
          writerHeld += v.blocks.filter(b => b.errors.some(e => e.code === "VAL_BLOCK_DECLINED") && !Object.hasOwn(salvaged, b.id)).length;
          if ((!bad.length && !held.length) || v.errors.length) return { sectionId, output, src };
          ev.emit({ stage: "validate", unit: sectionId, msg: `repair=${bad.length + held.length}` });
          const repair = [
            ...bad.map(b => ({ blockId: b.id, previous: b.envelope, errors: b.errors.slice(0, 20).map(e => ({ code: e.code, detail: e.detail.map(String).map(d => d.slice(0, 64)).slice(0, 20) })) })),
            ...held.map(b => ({ blockId: b.id, previous: salvaged[b.id], errors: [{ code: "VAL_SCHEMA", detail: why[b.id]?.length ? why[b.id] : ["format"] }] })),
          ].slice(0, 12);
          // 실패 사다리: 주 모델 → 대체 모델 → (잘림·시간 초과면) 반씩 나눠 다시. 나눈 조각 하나의 실패는 그 조각만 버린다.
          const repairWith = async (list, model) => {
            try { return await call("write", "repair", model, { stage: "repair", ...writeBody(sec), repair: list }, "LLM", repairShape(sec, list)); } catch (e) {
              if (toAlt(e, model)) { altNote("validate", sectionId, e, `repair=${list.length}`); return repairWith(list, ALT); }
              if (!recoverable(e)) throw e;
              if (!(SPLIT.has(e?.code) || timedOut(e)) || list.length < 2) throw e;
              const h = Math.ceil(list.length / 2), one = l => repairWith(l, model).catch(err => { if (!recoverable(err)) throw err; return { blocks: {} }; });
              const [a, b] = [await one(list.slice(0, h)), await one(list.slice(h))];
              return { blocks: { ...a.blocks, ...b.blocks }, src: { ...a.src, ...b.src } };
            }
          };
          // 결과를 섹션에 합친다: 고친 블록의 src 는 새 출력의 것으로 바꾼다. onlyFilled 면 null 로 돌아온 블록은 앞 결과를 그대로 둔다.
          const mergeIn = (base, baseSrc, r, onlyFilled) => {
            const got = Object.fromEntries(Object.entries(r.blocks ?? {}).filter(([, v]) => !onlyFilled || v != null)), ids = Object.keys(got);
            const keep = Object.fromEntries(Object.entries(baseSrc).filter(([k]) => !ids.some(id => k.startsWith(`/blocks/${id}/`))));
            const rsrc = Object.fromEntries(Object.entries(r.src ?? {}).filter(([k]) => ids.some(id => k.startsWith(`/blocks/${id}/`))));
            return [{ ...base, blocks: { ...base.blocks, ...got } }, { ...keep, ...rsrc }];
          };
          let merged = output, msrc = src, second = 0;
          try {
            [merged, msrc] = mergeIn(output, src, await repairWith(repair, models.write), false);
            repaired += repair.length;
          } catch (e) {
            if (halting(e, "LLM") && !timedOut(e) && !busy(e)) throw e;
            ev.emit({ stage: "validate", unit: sectionId, level: "warn", code: "REPAIR_RESULT", msg: `call_failed=${repair.length} ${timedOut(e) ? "timeout" : e?.code ?? "-"}`.slice(0, 80) });
          }
          // 2차: 아직 null(포기)이거나 검증에 걸리는 블록은 대체 모델이 한 번 더 고친다 — 같은 모델이 못 고친 것을 다른 모델이 고치는 일이 많다.
          const sent = new Set(repair.map(x => x.blockId)), first = new Map(repair.map(x => [x.blockId, x]));
          const left = check(sectionId, merged).blocks.filter(b => sent.has(b.id) && (b.envelope == null || b.errors.length));
          if (ALT && left.length) {
            const list2 = left.map(b => b.envelope == null ? first.get(b.id)
              : { blockId: b.id, previous: b.envelope, errors: b.errors.slice(0, 20).map(e => ({ code: e.code, detail: e.detail.map(String).map(d => d.slice(0, 64)).slice(0, 20) })) });
            try {
              [merged, msrc] = mergeIn(merged, msrc, await repairWith(list2, ALT), true);
              second = list2.length;
            } catch (e) {
              if (halting(e, "LLM") && !timedOut(e) && !busy(e)) throw e;
              altNote("validate", sectionId, e, `repair2_failed=${list2.length}`);
            }
          }
          // 재작성 결과(내용 없음): 고쳐짐·null(포기)·여전히 검증 실패. 서버가 비웠던 블록은 held 로 따로 센다. alt = 2차로 다시 맡긴 블록 수.
          const heldIds = new Set(held.map(b => b.id)), n = { ok: 0, null: 0, bad: 0, heldNull: 0 };
          for (const b of check(sectionId, merged).blocks) if (sent.has(b.id)) {
            if (b.envelope == null) { n.null++; if (heldIds.has(b.id)) n.heldNull++; } else if (b.errors.length) n.bad++; else n.ok++;
          }
          ev.emit({ stage: "validate", unit: sectionId, level: "info", code: "REPAIR_RESULT", msg: `fixed=${n.ok} null=${n.null} held_null=${n.heldNull} still_bad=${n.bad} alt=${second}` });
          return { sectionId, output: merged, src: msrc };
        };
        let sections = settle(await Pipeline.pool(ctx.out.writing.sections, fix, { lanes: lanes("write"), signal, events: ev, stage: "validate" }), "LLM");

        // 6-5 T5(제안서 §4): 통과한 블록의 강의 근거 주장을 /v1/judge support 로 확인한다. 가상·보강·교육용 주장은 대상이 아니다.
        // 판정과 조치를 분리한다 — 첫 점수는 검토 우선순위이지 삭제 근거가 아니다. 낮은 주장은 순서대로 한 번씩만 복구한다:
        //   안전한 코드 정규화 → 근거 재연결 1회 → 문장 수정 repair 1회(T5 전용 예산, 형식 repair 와 별개).
        // 끝내 불명확하면 삭제가 아니라 확인 필요(pending)로 보존한다: 뺄 수 있는 칸(null 허용·목록 항목)이면 그 주장만
        // 빼서 pending 에 싣고 블록은 살리고, 필수 칸이거나 뺀 뒤 계약이 깨지면 블록째 보류하되 봉투 전체를 pending 에 남겨
        // 정상 조건·사례가 저장 구조에서 파괴되지 않게 한다. pending 은 확정 본문이 아니라서 렌더에 나오지 않고 데이터에만 남는다.
        // 전역 작업 예산(supportBudget)을 넘으면 더 호출하지 않고 보류한다. deps.judgeShadow 면 판정·계측만 하고 본문은 그대로다.
        // 지지 점수 분포(내용 없음): 주장 수·판정 수·점수 구간별 건수, 낮은 주장 수와 그 때문에 빠진 블록 수.
        let unsupported = 0, nulled = 0, trimmed = 0, supportOps = 0;
        const sup = { claims: 0, judged: 0, low: 0, bins: [0, 0, 0, 0, 0] };
        // 주장 단위 결과(내용 없음): kept 유지 / relinked 재연결 / fixed 수정 / direct 직접 보류 / collateral 동반 손실 / unjudged 미판정.
        const outcomes = new Map(), claimsByBlock = new Map(), heldIds = new Set(), fixedBlocks = new Set(), pendings = [];
        // 복구 호출 결과(내용 없음): 재연결·재작성 시도 대비 수락, 예산 초과로 건너뛴 수, 재판정 누락, 호출 실패.
        const recovery = { relink: [0, 0], repair: [0, 0], budgetSkip: 0, rejudgeMiss: 0, callFailed: 0 };
        const schemaAt = (sch, segs) => segs.reduce((x, k) => x && (x.properties ? x.properties[k] : x.items), sch);
        const nodeAt = (o, segs) => segs.reduce((x, k) => x?.[k], o);
        // 주장을 뺄 수 있는 가장 깊은 경로 — null 허용 칸이면 그 칸, 목록 항목 안의 주장이면 그 항목. 없으면 null.
        const cutPath = (type, path) => {
          const sch = NoteContract.envelopeSchema(type, options), segs = path.split("/").slice(1);
          for (let d = segs.length; d >= 1; d--) {
            const pre = segs.slice(0, d), up = pre.slice(0, -1);
            if (schemaAt(sch, up)?.type === "array" || [].concat(schemaAt(sch, pre)?.type).includes("null")) return { path: "/" + pre.join("/"), segs: pre };
          }
          return null;
        };
        // 블록에서 주어진 봉투 안 경로들을 뺀 봉투, 뺄 수 없으면 null.
        const withoutClaims = (type, env, paths) => {
          const out = JSON.parse(JSON.stringify(env)), sch = NoteContract.envelopeSchema(type, options), cuts = [];
          for (const p of paths) {
            const segs = p.split("/").slice(1), up = segs.slice(0, -1);
            if ([].concat(schemaAt(sch, segs)?.type).includes("null")) nodeAt(out, up)[segs.at(-1)] = null;
            else if (schemaAt(sch, up)?.type === "array") cuts.push([up, +segs.at(-1)]);
            else return null;
          }
          for (const [up, i] of cuts.sort((a, b) => b[1] - a[1])) nodeAt(out, up).splice(i, 1);
          return out;
        };
        if (judged) {
          const judge = async items => { const out = []; for (const b of batches(items)) out.push(...await call("judge", "support", models.judge, { task: "support", items: b }, "JDG", asResults)); return out; };
          const evById = new Map(R().evidence.map(e => [e.id, e]));
          sections = settle(await Pipeline.pool(sections, async s => {
            if (!s.output) return s;
            const v = check(s.sectionId, s.output), claims = [];
            // 영어 강의는 주장의 영어 src 로 판정한다(영어 근거와 같은 언어). src 가 없으면 한국어 text 그대로.
            for (const b of v.blocks) if (!b.errors.length)
              for (const { path, claim } of claimsIn(b.envelope)) if (claim.basis === "lecture") {
                claims.push({ bid: b.id, type: b.type, path, claim, jt: { text: s.src?.[`/blocks/${b.id}${path}`] ?? claim.text, evidenceIds: claim.evidenceIds } });
                (claimsByBlock.get(b.id) ?? claimsByBlock.set(b.id, []).get(b.id)).push(claims.at(-1));
              }
            if (!claims.length) return s;
            const r = await Verify.checkSupport(claims.map(c => c.jt), R().evidence, { judge });
            sup.claims += claims.length; sup.low += r.blocks.length;
            for (const x of r.scores ?? []) if (typeof x === "number") { sup.judged++; sup.bins[x < .1 ? 0 : x < .3 ? 1 : x < .5 ? 2 : x < .7 ? 3 : 4]++; }
            const lowIdx = new Set(r.blocks.map(x => x.index)), unj = new Set(r.unjudged);
            claims.forEach((c, i) => outcomes.set(c.claim, lowIdx.has(i) ? "low" : unj.has(i) ? "unjudged" : "kept"));
            if (!lowIdx.size) return s;
            const sec = planOf.get(s.sectionId);
            // 쓰기는 복사본에 한다 — 받아들인 변경만 마지막에 출력에 반영한다(judgeShadow 면 아무것도 반영하지 않는다).
            const work = {}, merged = () => ({ ...s.output.blocks, ...work });
            const envOf = id => Object.hasOwn(work, id) ? work[id] : (work[id] = JSON.parse(JSON.stringify(s.output.blocks[id])));
            const claimAt = (id, path) => nodeAt(envOf(id), path.split("/").slice(1));
            // 후보 봉투 env 를 넣은 상태로 대상 블록이 코드 검증을 지나는가 — 섹션 ok 가 아니라 블록 오류만 본다.
            const blockOk = (id, env) => !check(s.sectionId, { ...s.output, blocks: { ...merged(), [id]: env } }).blocks.find(b => b.id === id).errors.length;
            const lows = () => claims.filter(c => outcomes.get(c.claim) === "low");

            // (a) 안전한 코드 정규화 — 모델 없이 인용 id 의 중복·모름·상한만 다듬는다. 계산 참조(S#_B#.c#)는 근거 맵에 없어도 유효하니 남긴다.
            const CALC_ID = /^(S[0-9]{1,3}_B[0-9]{1,2}|GB[0-9])\.[ic][0-9]{1,2}$/;
            for (const c of lows()) {
              const live = claimAt(c.bid, c.path);
              const ids = uniq((live?.evidenceIds ?? []).filter(id => evById.has(id) || CALC_ID.test(id))).slice(0, 8);
              if (live && ids.length && ids.join() !== live.evidenceIds.join()) live.evidenceIds = ids;
            }
            // (b) 근거 재연결 1회 — 인용 근거만으로 낮으면 인용된 유닛(인접 발화·같은 슬라이드)과 계획이 허용한
            //     교차 유닛(crossUnitIds)의 나머지 근거만 묶어 다시 판정한다. 전체 강의를 붙이지 않는다.
            //     지지되면 이긴 묶음의 근거를 인용에 붙이고 블록을 다시 검증한다 — 검증이 깨지면 인용을 되돌린다.
            for (const c of lows()) {
              const cited = new Set(c.claim.evidenceIds);
              const units = new Set(c.claim.evidenceIds.map(id => evById.get(id)?.unitId).filter(Boolean));
              for (const u of sec.crossUnitIds ?? []) units.add(u);
              const pool = R().evidence.filter(e => units.has(e.unitId) && !cited.has(e.id)).sort((a, b) => (a.t0 ?? 0) - (b.t0 ?? 0));
              const bundles = Verify.evidenceBundles(pool, JUDGE_CHARS);
              if (!bundles.length) continue;
              if (supportOps + bundles.length > supportBudget) { recovery.budgetSkip++; continue; }
              supportOps += bundles.length; recovery.relink[0]++;
              let rs;
              try {
                rs = await judge(bundles.map((b, i) => ({ itemId: String(i), text: c.jt.text, context: b.map(e => String(e.text ?? "")).join("\n").trim() })));
              } catch (e) { if (halting(e, "JDG")) throw e; recovery.callFailed++; continue; }
              const got = new Map((Array.isArray(rs) ? rs : rs?.results ?? []).map(x => [x?.itemId, x?.score]));
              const scores = bundles.map((_, i) => got.get(String(i)));
              // 묶음 하나라도 점수가 없으면 미판정으로 둔다 — 일부 묶음의 최고점만으로 통과시키지 않는다(모순 확인).
              if (scores.some(x => typeof x !== "number" || Number.isNaN(x))) { recovery.rejudgeMiss++; continue; }
              const win = scores.indexOf(Math.max(...scores));
              if (scores[win] < .5 || Math.min(...scores) < Verify.CONTRA_FLOOR) continue;
              const live = claimAt(c.bid, c.path);
              if (!live) continue;
              const before = [...(live.evidenceIds ?? [])];
              live.evidenceIds = uniq([...bundles[win].map(e => e.id), ...before]).slice(0, 8);
              if (blockOk(c.bid, envOf(c.bid))) { outcomes.set(c.claim, "relinked"); recovery.relink[1]++; }
              else live.evidenceIds = before;
            }
            // (c) 문장 수정 repair — 블록당 한 번, 형식 repair 와 예산을 공유하지 않는다.
            //     대체 모델·분할 사다리·재시도는 없다(call 안의 전송 재시도·멱등은 그대로).
            const lowByBlock = new Map();
            for (const c of lows()) { const g = lowByBlock.get(c.bid) ?? { type: c.type, paths: [] }; g.paths.push(c.path); lowByBlock.set(c.bid, g); }
            let src = s.src, t5 = 0, t5ok = 0;
            for (const [id, g] of lowByBlock) {
              if (supportOps >= supportBudget) { recovery.budgetSkip += g.paths.length; continue; }
              supportOps++; recovery.repair[0]++; t5++;
              try {
                const entry = { blockId: id, previous: merged()[id], errors: [{ code: "VAL_SUPPORT_LOW", detail: g.paths.map(p => p.slice(0, 64)).slice(0, 20) }] };
                const rr = await call("write", "repair", models.write, { stage: "repair", ...writeBody(sec), repair: [entry] }, "LLM", repairShape(sec, [entry]));
                const got = rr?.blocks?.[id];
                // 받는 조건: 섹션 단위 오류 없음 + 대상 블록이 살아 있고 블록 오류 없음 + 강의 근거 주장(새 주장 포함) 전부가
                // 새 src 로 다시 판정돼 .5 이상 — 판정 누락도 실패다. 섹션 ok 는 요구하지 않는다 — 무관한 보류 블록
                // (VAL_BLOCK_DECLINED)은 블록 오류라 회복을 막지 않고, 커버리지 같은 경고는 오류로 세지 않는다.
                const rv = got == null ? null : check(s.sectionId, { ...s.output, blocks: { ...merged(), [id]: got } });
                const rb = rv?.blocks.find(b => b.id === id);
                if (!rv || rv.errors.length || rb?.envelope == null || rb.errors.length) continue;
                const m = { ...(src ?? {}) };
                for (const k of Object.keys(m)) if (k.startsWith(`/blocks/${id}/`)) delete m[k];
                for (const [k, t] of Object.entries(rr.src ?? {})) if (k.startsWith(`/blocks/${id}/`)) m[k] = t;
                const qc = claimsIn(got).filter(({ claim }) => claim.basis === "lecture").map(({ path, claim }) => ({ text: m[`/blocks/${id}${path}`] ?? claim.text, evidenceIds: claim.evidenceIds }));
                const jr = await Verify.checkSupport(qc, R().evidence, { judge });
                if (!jr.ok || jr.unjudged.length) { recovery.rejudgeMiss++; continue; }
                work[id] = got; src = m; recovery.repair[1]++; t5ok++; fixedBlocks.add(id);
                for (const c of lows().filter(x => x.bid === id)) outcomes.set(c.claim, "fixed");
              } catch (e) { if (halting(e, "LLM") && !timedOut(e) && !busy(e)) throw e; recovery.callFailed++; }
            }
            if (t5) ev.emit({ stage: "support", unit: s.sectionId, level: "info", code: "T5_REPAIR", msg: `repaired=${t5ok} of=${t5}` });
            // (d) 끝내 불명확한 주장은 확정 본문에서 빼되 데이터로 보존한다. 뺄 수 있는 가장 깊은 조상 — null 허용 칸이나
            //     목록 항목 — 을 빼고, 그 노드 안의 주장은 모두 pending 에 보존한다(동반 손실분의 글자도 남는다).
            //     뺄 곳이 없거나 뺀 뒤 계약이 깨지면 블록째 보류하되 봉투 전체를 pending 에 남긴다 — 정상 조건·사례를
            //     저장 구조에서 파괴하지 않기 위해서다. 그 정의·칸에 기대는 내용은 조립의 의존 정리(§12.2)가 걸러 낸다.
            const held = [];
            for (const [id, g] of lowByBlock) {
              const left = lows().filter(c => c.bid === id);
              if (!left.length) continue;
              unsupported += left.length;
              for (const c of left) outcomes.set(c.claim, "direct");
              const env = envOf(id), byCut = new Map();
              for (const c of left) {
                const cut = cutPath(g.type, c.path);
                if (!cut) { byCut.clear(); break; }
                (byCut.get(cut.path) ?? byCut.set(cut.path, { cut, cs: [] }).get(cut.path)).cs.push(c);
              }
              const env2 = byCut.size ? withoutClaims(g.type, env, [...byCut.keys()]) : null;
              if (env2 && blockOk(id, env2)) {
                work[id] = env2; trimmed += left.length;
                for (const { cut, cs } of byCut.values())
                  held.push({ sectionId: s.sectionId, blockId: id, type: g.type, paths: cs.map(c => c.path),
                    claims: claimsIn(nodeAt(env, cut.segs)).map(x => JSON.parse(JSON.stringify(x.claim))), envelope: null });
              } else {
                // 블록째 보류 — 정규화·재연결까지 반영된 작업 봉투를 통째로 보존한다.
                held.push({ sectionId: s.sectionId, blockId: id, type: g.type, paths: left.map(c => c.path), claims: left.map(c => JSON.parse(JSON.stringify(c.claim))), envelope: env });
                work[id] = null; heldIds.add(id); nulled++;
              }
            }
            for (const p of held) pendings.push(p);
            if (judgeShadow) return s;
            return { ...s, output: { ...s.output, blocks: merged() }, ...(src ? { src } : {}), ...(held.length ? { pending: held } : {}) };
          }, { lanes: lanes("judge"), signal, events: ev, stage: "support" }), "JDG");
        }

        // 전역 Writer(6-4): 살아남은 섹션 블록만, 주장 텍스트와 참조로 줄여 보낸다. 실패하면 노트는 전역 블록 없이 간다(알림).
        let global = null, globalFailed = false, gs = null;
        if (plan.global.length) {
          const survivors = [];
          for (const s of sections) if (s.output) {
            const v = check(s.sectionId, s.output), blocks = v.blocks.filter(b => !b.errors.length);
            if (!v.errors.length && blocks.length) survivors.push({ sectionId: s.sectionId, title: planOf.get(s.sectionId).title, gist: v.gist, blocks });
          }
          gs = survivors.length ? globalSections(survivors) : null;
          if (gs) {
            const globalWith = model => call("write", "global", model, { stage: "global", noteSpecVersion: SPEC, plan: { concepts: plan.concepts, global: plan.global }, sections: gs, options, allowedRefs: allowedRefs(), ...langBody() }, "LLM",
              asOutput(NoteContract.globalOutputSchemaFor(plan.global, allowedRefs())));
            try {
              try { global = await globalWith(models.write); } catch (e) {
                if (!toAlt(e, models.write)) throw e;
                altNote("validate", null, e, "global");
                global = await globalWith(ALT);
              }
            } catch (e) {
              if (halting(e, "LLM") && !timedOut(e) && !busy(e)) throw e;
              globalFailed = true;
              ev.emit({ stage: "validate", level: "warn", code: "GLOBAL_FAILED", msg: timedOut(e) ? "timeout" : String(e?.code ?? "-").slice(0, 60) });
            }
          } else globalFailed = true;
        }

        if (judged) ev.emit({ stage: "validate", level: "info", code: "SUPPORT_SCORES", msg: `claims=${sup.claims} judged=${sup.judged} low=${sup.low} blocks=${nulled} trimmed=${trimmed} bins<.1,<.3,<.5,<.7,>=.7=${sup.bins.join("/")}` });
        const systemNotices = [...gapNotices];
        if (unsupported && !judgeShadow) systemNotices.push({ code: "NOTE_CLAIMS_UNSUPPORTED", count: unsupported });
        // 빈 블록의 출처(내용 없음): 모델이 보류(writer), 서버가 형식 오류로 비움(server, repair 전 건수), 근거 판정 보류(judge)
        ev.emit({ stage: "validate", level: "info", code: "BLOCKS_HELD", msg: `writer=${writerHeld} server=${serverHeld} judge=${nulled}` });
        if (serverHeld) ev.emit({ stage: "validate", level: "info", code: "HELD_WHY", msg: Object.entries(heldWhy).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(", ").slice(0, 200) || "-" });
        if (globalFailed) systemNotices.push({ code: "NOTE_GLOBAL_FAILED" });
        if (!judged) systemNotices.push({ code: "NOTE_JUDGE_SKIPPED" });
        const now = deps.now ?? (() => new Date());
        // 조립이 통째로 뺄 섹션의 사유를 남긴다(코드·개수뿐, 내용 없음): 섹션 오류(커버리지 등), 살아남은 블록 수, 블록 오류 코드.
        for (const s of sections) {
          if (!s.output) { ev.emit({ stage: "validate", unit: s.sectionId, level: "warn", code: "SECTION_DROPPED", msg: "no-output" }); continue; }
          const v = check(s.sectionId, s.output), ok = v.blocks.filter(b => !b.errors.length).length;
          if (v.warnings?.length) ev.emit({ stage: "validate", unit: s.sectionId, level: "info", code: "SECTION_COVERAGE_LOW", msg: v.warnings.map(e => e.detail.join("|")).join(",").slice(0, 60) });
          if (!v.errors.length && ok) continue;
          const codes = [...new Set(v.blocks.flatMap(b => b.errors.map(e => e.code)))].slice(0, 6);
          ev.emit({ stage: "validate", unit: s.sectionId, level: "warn", code: "SECTION_DROPPED",
            msg: `sec=${v.errors.map(e => e.code + (e.detail?.length ? ":" + e.detail.join("|") : "")).join(",") || "-"} blocks=${ok}/${v.blocks.length} codes=${codes.join(",")}`.slice(0, 200) });
        }
        const allUnits = R().ir.units, m = input?.meta ?? {};
        const note = NoteContract.assembleNote({
          // units(): 판정 중요도가 실린 유닛 — 잡담 유닛은 미인용 고지에서 빠진다
          ...base, sections, global, units: units(), crops: Object.keys(R().cropMap), tier, systemNotices, promptVersion: ctx.out.planning.promptVersion ?? null,
          meta: {
            title: m.title ?? null, course: m.course ?? null, lectureDate: m.lectureDate ?? null, session: m.session ?? null, lang: m.lang ?? "ko",
            generatedAt: now().toISOString(), processed: allUnits.length ? { t0: Math.min(...allUnits.map(u => u.t0)), t1: Math.max(...allUnits.map(u => u.t1)) } : { t0: 0, t1: 0 },
          },
        });
        ev.emit({ stage: "validate", msg: `sections=${note.sections.length} dropped=${note.dropped.length} repaired=${repaired}` });
        if (note.stats) ev.emit({ stage: "validate", level: "info", code: "LOSS_CASCADE", msg: `direct=${note.stats.directBlocks} cascade=${note.stats.cascadeBlocks} prunedItems=${note.stats.prunedItems} prunedQuestions=${note.stats.prunedQuestions}` });
        if (plan?.caps) ev.emit({ stage: "validate", level: "info", code: "PLAN_CAPS", msg: `secCut=${plan.caps.sectionsCut} concCut=${plan.caps.conceptsCut} globCut=${plan.caps.globalCut} total=${plan.caps.totalCut}` });
        if (gs?.shrink) ev.emit({ stage: "validate", level: "info", code: "GLOBAL_SECTIONS_SHRINK", msg: `step=${gs.shrink.step} perBlock=${gs.shrink.perBlock} chars=${gs.shrink.chars} bytes=${gs.shrink.bytes}` });
        else if (plan?.global?.length) ev.emit({ stage: "validate", level: "info", code: "GLOBAL_SECTIONS_SHRINK", msg: "step=- perBlock=- chars=- bytes=-" });
        const funnel = Figures.figureFunnelStats({ slides, figures: R().figures, crops: fd.crops ?? [], plan, note, cropMap: R().cropMap });
        if (tier === "paid" || funnel.cropExist > 0 || funnel.selected > 0) {
          ev.emit({ stage: "validate", level: "info", code: "FIGURE_FUNNEL", msg: `cropExist=${funnel.cropExist} selected=${funnel.selected} rejQuality=${funnel.rejectedQuality} planAssigned=${funnel.planAssigned} textRef=${funnel.textReferenced} renderOk=${funnel.renderSuccess}` });
        }
        // 주장 단위 결과 집계(내용 없음). 동반 손실: 직접 저점수가 아닌데 블록 보류·의존 연쇄·목록 가지치기로 본문을 잃은
        // 주장 — judge_low_rate(=low/judged)와 collateral_loss_rate(=collateral/claims)가 여기서 나온다. 본문 잔존은
        // 경로가 아니라 주장 글자로 확인한다(가지치기로 목록 경로는 밀린다). T5 repair 로 통째로 바뀐 블록은 블록 단위로만 본다.
        // judgeShadow 에서는 본문이 안 바뀌어 의존 연쇄는 계산되지 않는다 — collateral 은 보류 블록 동반분만 담는다.
        if (judged) {
          const liveText = new Map();
          for (const sec of note.sections) for (const b of sec.blocks) liveText.set(b.id, new Set(claimsIn(b.content).map(x => x.claim.text)));
          for (const b of note.global) liveText.set(b.id, new Set(claimsIn(b.content).map(x => x.claim.text)));
          for (const [bid, list] of claimsByBlock) {
            const texts = liveText.get(bid), held = heldIds.has(bid), rewritten = fixedBlocks.has(bid);
            for (const c of list) {
              if (outcomes.get(c.claim) === "direct") continue;
              if (held || (rewritten ? texts === undefined : !texts?.has(c.claim.text))) outcomes.set(c.claim, "collateral");
            }
          }
          const tally = {};
          for (const s2 of outcomes.values()) tally[s2] = (tally[s2] ?? 0) + 1;
          const keptPending = pendings.reduce((n, p) => n + (p.envelope ? claimsIn(p.envelope).length : p.claims.length), 0);
          ev.emit({ stage: "validate", level: "info", code: "SUPPORT_OUTCOMES",
            msg: `claims=${sup.claims} kept=${tally.kept ?? 0} relinked=${tally.relinked ?? 0} fixed=${tally.fixed ?? 0} direct=${tally.direct ?? 0} collateral=${tally.collateral ?? 0} unjudged=${tally.unjudged ?? 0} pending=${keptPending}`.slice(0, 200) });
          ev.emit({ stage: "validate", level: "info", code: "SUPPORT_RECOVERY",
            msg: `relink=${recovery.relink[1]}/${recovery.relink[0]} repair=${recovery.repair[1]}/${recovery.repair[0]} budget_skip=${recovery.budgetSkip} rejudge_miss=${recovery.rejudgeMiss} call_failed=${recovery.callFailed}` });
        }
        // 뺀 블록의 사유 코드별 건수(내용 없음) — 어느 검증이 노트를 얇게 만드는지 진단에서 바로 보이게. 판정 보류(null)는 VAL_BLOCK_DECLINED 로 센다.
        if (note.dropped.length) {
          const by = {};
          for (const d of note.dropped) for (const c of d.codes.length ? d.codes : ["-"]) by[c] = (by[c] ?? 0) + 1;
          ev.emit({ stage: "validate", level: "info", code: "BLOCKS_DROPPED", msg: Object.entries(by).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}=${n}`).join(",").slice(0, 200) });
        }
        return { note };
      });

    // ── H. 렌더: 렌더러는 따로 만든다. 없으면 건너뛴다 ──
    // ponytail: 렌더 결과는 JSON 으로 단계 캐시에 들어간다(HTML 문자열 등). 템플릿이 바뀌면 render.version 을 올려야 캐시가 비켜 간다.
    const rendering = stage("rendering", "LLM",
      () => K({ note: ctx.out.validating.note, render: deps.render ? (deps.render.version ?? "") : null }),
      async () => ({ rendered: deps.render ? await deps.render(ctx.out.validating.note, { signal }) : null }));

    await Pipeline.runStages(job, [refining, judging, planning, writing, validating, rendering], ctx);
    if (job.state !== "done" || !ctx.out.validating) {
      const { state, code = null, reason = null } = job.record;
      return { status: state, code, reason, note: null, notices: [] };
    }
    const { note } = ctx.out.validating;
    return { status: note.status, note, notices: note.notices, rendered: ctx.out.rendering.rendered, cropMap: R().cropMap };
  }

  const api = { runNote, gapRanges, batches, claimsIn, globalSections, VERSION };
  globalThis.NoteStages = api;
  if (typeof module !== "undefined") module.exports = api;
})();
