// 파이프라인 v2 단계 오케스트레이션(docs/architecture-v2.md §5.2, §6.3~6.7, §7, §8; docs/note-contract.md §8·§10·§12·§17 6-3~6-6):
// 정제 → 판정 → 계획 → 작성 → 검증·조립 → 렌더를 Pipeline.runStages 로 돌린다. 단계 결과는 단계 캐시에 남아 같은 입력의 재실행은 서비스를 다시 부르지 않는다.
// 노트 계약(슬롯·검증·조립)은 lib/note-contract.js 한 곳에 있다. 여기서는 그 함수만 부른다.
// 서비스(plan·write·judge)·KaTeX·이벤트·렌더러·시계는 전부 deps 로 주입한다. 이벤트와 알림에는 코드·수치·id·시각 구간만 싣고 강의 내용은 싣지 않는다.
//
// runNote(job, input, deps) → {status, note, notices, rendered?, cropMap?}
//   input: {slides:[SlideDoc], transcript:Transcript, gaps:[{reason,t0,t1}], tier:"free"|"paid", models:{plan,write,judge}, consent:{summary},
//           recognition?:"local"|"cloud", options?:{syntheticExamples, externalAugmentation}, meta?:{title, course, lectureDate, session, lang},
//           figureData?:{hashes:{"<slideId>/<figId>":hex}, ocr:{key:text}, crops:[key]}, formulaCrops?:[ "<slideId>/<formulaId>" ], rerun?, host?}
//   deps:  {service:{plan,write,judge}, katex, events?, render?(note,{signal}), signal?, breaker?, sleep?, concurrency?, now?}
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
  const VERSION = "stages-2";
  // 계획 호출 상한(ms): 무료 Supabase Edge 의 150초 안. 1차(추론형) 100초 + 대체(작성 모델) 140초.
  const PLAN_PRIMARY_MS = 100000, PLAN_FALLBACK_MS = 140000;
  const SPEC = NoteContract.NOTE_SPEC_VERSION;
  // /v1/judge 상한: 요청당 항목 200, items JSON 64KiB(server/index.js). 한글은 글자당 3바이트라 개수만으로는 부족해 바이트도 센다.
  const JUDGE_ITEMS = 200, JUDGE_BYTES = 60000, JUDGE_CHARS = 8000;
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
    for (const [perBlock, chars] of [[12, 600], [6, 300], [3, 200], [1, 160]]) {
      const sections = survivors.map(s => ({
        sectionId: s.sectionId, title: s.title, gist: s.gist ? { text: s.gist.text.slice(0, chars), evidenceIds: s.gist.evidenceIds, basis: s.gist.basis } : null,
        blocks: s.blocks.map(b => ({
          blockId: b.id, type: b.type,
          claims: claimsIn(b.envelope.content).slice(0, perBlock).map(({ claim }) => ({ text: claim.text.slice(0, chars), evidenceIds: claim.evidenceIds, basis: claim.basis })),
        })),
      }));
      if (bytes(sections) <= limit) return sections;
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
    const ctx = { signal, out: {} };
    const R = () => ctx.out.refining;

    let scored;
    const units = () => scored ??= R().ir.units.map(u => {
      const s = ctx.out.judging.importance[u.unitId];
      return typeof s === "number" ? { ...u, judge: { ...u.judge, importance: s } } : u;
    });
    // 섹션 Writer 입력: 섹션 유닛과 허용된 교차 유닛의 근거, 그 유닛에 나온 수식(서버 상한 200건)·도표.
    const ownUnits = sec => new Set([...sec.unitIds, ...sec.crossUnitIds]);
    const evidenceFor = sec => { const us = ownUnits(sec); return R().evidence.filter(e => us.has(e.unitId)); };
    const regFor = sec => { const us = ownUnits(sec); return R().registry.filter(e => (R().formulaUnits[e.id] || []).some(u => us.has(u))).slice(0, 200).map(e => ({ id: e.id, latex: e.latex ?? null, status: e.status })); };
    const figsFor = sec => { const us = ownUnits(sec); return R().figures.filter(f => us.has(f.unitId)).slice(0, 50).map(f => ({ id: f.id, kind: f.kind, title: f.title ?? null, cells: f.cells ? f.cells.slice(0, 30).map(r => r.slice(0, 6).map(c => String(c).slice(0, 200))) : null })); };
    const K = async (value, model = null, schemaVersion = SPEC) => ({ inputDigest: await Pipeline.digest(value), model, promptVersion: VERSION, schemaVersion });
    const stage = (state, area, key, run) => ({ state, area, key, run: async c => { try { return await run(c); } catch (e) { throw asCoded(e, area); } } });

    // 서비스 호출 한 건. 본문 해시가 같으면 패키지 캐시의 결과를 다시 쓴다 — 서버는 같은 requestId 를 409 로 막고 결과를 저장하지 않으므로,
    // 일시정지 뒤 재개나 취소 뒤 재실행에서 이미 돈을 낸 호출을 다시 보내면 안 된다. requestId = 본문 해시 + rerun, 재시도마다 retryId.
    async function call(method, label, model, body, area, shape, extra = {}) {
      const inputDigest = await Pipeline.digest({ label, model, body });
      const key = await Pipeline.stageKey({ stage: "call." + label, inputDigest, model, promptVersion: VERSION, schemaVersion: SPEC });
      // 실행마다 다른 runTag 를 섞는다: 이어 하기·다시 시도가 앞선 실행이 쓴 requestId(서버에 예약이 남은)와 겹치지 않게. 끝난 호출은 위 캐시가 막아 다시 결제하지 않는다.
      const base = `${label}-${(await Pipeline.digest({ inputDigest, rerun, runTag })).slice(0, 32)}`;
      return Pipeline.cached(job.store, key, async () => shape(await Pipeline.withRetry(
        n => breaker.run(model, () => deps.service[method]({ ...body, model, requestId: Pipeline.retryId(base, n), signal, jobId: job.jobId, ...extra }), { area }),
        { signal, sleep: deps.sleep },
      )), { packageId: job.packageId, signal });
    }
    const settle = (results, area) => {
      signal?.throwIfAborted();
      const bad = results.find(r => r.status === "failed");
      if (bad) throw asCoded(bad.error, area);
      return results.map(r => r.value);
    };
    const lanes = name => Pipeline.laneCount(name, deps.concurrency);
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
        return { ir: { units: ir.units, stats: ir.stats }, evidence: ir.evidence, registry, formulaUnits, figures, cropMap };
      });

    // ── D. 판정: 유료만. Free 는 호출 없이 지나가는 빈 단계다 ──
    // ponytail: T2 유닛 중요도만 호출한다. T1·T3·T4 는 범위 밖이다. T5(근거 지지)는 검증 단계가 주장 단위로 부른다.
    const judging = stage("judging", "JDG", () => K({ paid: judged, units: R().ir.units }, judged ? models.judge : null), async () => {
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
      () => K({ units: units(), registry: R().registry.map(({ id, status }) => ({ id, status })), figures: R().figures.map(({ id, unitId, kind, title }) => ({ id, unitId, kind, title })), options, recognition }, models.plan),
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
    const writeBody = sec => ({ noteSpecVersion: SPEC, section: sec, concepts: ctx.out.planning.plan.concepts, evidence: evidenceFor(sec), registry: regFor(sec), figures: figsFor(sec), options });
    async function writeSection(sec) {
      const send = (s, withGist) => call("write", "section", models.write, { stage: "section", ...writeBody(s), section: s, withGist }, "LLM",
        asOutput(NoteContract.sectionOutputSchemaFor(s, { gist: withGist, policy: options })));
      try { return await send(sec, true); } catch (e) {
        if (!SPLIT.has(e?.code) || sec.blocks.length < 2) throw e;
        // §12.4: 잘리면 계획 블록을 반으로 나눠 두 번 요청한다. 근거 입력은 같다. gist 는 첫 반쪽에만, checks 는 합친다. 반쪽도 잘리면 섹션 실패다.
        ev.emit({ stage: "write", unit: sec.sectionId, level: "warn", code: codeFor(e, "LLM"), msg: "split" });
        const h = Math.ceil(sec.blocks.length / 2);
        const a = await send({ ...sec, blocks: sec.blocks.slice(0, h) }, true), b = await send({ ...sec, blocks: sec.blocks.slice(h) }, false);
        return { gist: a.gist, blocks: { ...a.blocks, ...b.blocks }, checks: [...a.checks, ...b.checks].slice(0, 6) };
      }
    }
    const writing = stage("writing", "LLM",
      () => K({ plan: ctx.out.planning.plan, units: units(), evidence: R().evidence.length, registry: R().registry.map(({ id, latex, status }) => ({ id, latex, status })), figures: R().figures.map(f => f.id), options, rerun }, models.write),
      async () => {
        const secs = ctx.out.planning.plan.sections;
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
      () => K({ writing: ctx.out.writing, plan: ctx.out.planning.plan, judge: judged ? models.judge : null, gaps, rerun, meta: input?.meta ?? null, crops: Object.keys(R().cropMap) }, models.write),
      async () => {
        const plan = ctx.out.planning.plan, planOf = new Map(plan.sections.map(s => [s.sectionId, s]));
        const base = { plan, evidence: R().evidence, registry: R().registry, formulaUnits: R().formulaUnits, figures: R().figures, katex: deps.katex };
        const check = (sectionId, output) => NoteContract.validateSection({ ...base, sectionId, output });

        // 1차 검증 → 실패 블록만 다시 쓴다(§12.1). Writer 가 null 로 보류한 블록과 섹션 단위 오류(커버리지)는 다시 쓰지 않는다.
        // 재생성 호출이 실패하면 실패 블록은 그대로 빠진다(한도·네트워크 오류는 작업을 멈춘다).
        let repaired = 0;
        const fix = async ({ sectionId, output }) => {
          if (!output) return { sectionId, output };
          const v = check(sectionId, output), sec = planOf.get(sectionId);
          const bad = v.blocks.filter(b => b.errors.length && !b.errors.every(e => e.code === "VAL_BLOCK_DECLINED") && b.envelope);
          if (!bad.length || v.errors.length) return { sectionId, output };
          ev.emit({ stage: "validate", unit: sectionId, msg: `repair=${bad.length}` });
          const repair = bad.map(b => ({ blockId: b.id, previous: b.envelope, errors: b.errors.slice(0, 20).map(e => ({ code: e.code, detail: e.detail.map(String).map(d => d.slice(0, 64)).slice(0, 20) })) }));
          try {
            const r = await call("write", "repair", models.write, { stage: "repair", ...writeBody(sec), repair }, "LLM",
              asOutput(NoteContract.repairOutputSchemaFor(sec, repair.map(x => x.blockId), options)));
            repaired += repair.length;
            return { sectionId, output: { ...output, blocks: { ...output.blocks, ...r.blocks } } };
          } catch (e) { if (halting(e, "LLM")) throw e; return { sectionId, output }; }
        };
        let sections = settle(await Pipeline.pool(ctx.out.writing.sections, fix, { lanes: lanes("write"), signal, events: ev, stage: "validate" }), "LLM");

        // 6-5 T5: 통과한 블록의 강의 근거 주장을 /v1/judge support 로 확인한다. 가상·보강·교육용 주장은 대상이 아니다.
        // 지지 점수가 낮은 주장이 있는 블록은 null(보류)로 바꿔 조립이 빼게 하고, 건수는 고지로 남긴다(내용 없음).
        let unsupported = 0;
        if (judged) {
          const judge = async items => { const out = []; for (const b of batches(items)) out.push(...await call("judge", "support", models.judge, { task: "support", items: b }, "JDG", asResults)); return out; };
          sections = settle(await Pipeline.pool(sections, async s => {
            if (!s.output) return s;
            const v = check(s.sectionId, s.output), claims = [];
            for (const b of v.blocks) if (!b.errors.length)
              for (const { claim } of claimsIn(b.envelope)) if (claim.basis === "lecture") claims.push([b.id, { text: claim.text, evidenceIds: claim.evidenceIds }]);
            if (!claims.length) return s;
            const r = await Verify.checkSupport(claims.map(c => c[1]), R().evidence, { judge });
            const low = new Set(r.blocks.map(x => claims[x.index][0]));
            if (!low.size) return s;
            unsupported += low.size;
            return { ...s, output: { ...s.output, blocks: Object.fromEntries(Object.entries(s.output.blocks).map(([k, env]) => [k, low.has(k) ? null : env])) } };
          }, { lanes: lanes("judge"), signal, events: ev, stage: "support" }), "JDG");
        }

        // 전역 Writer(6-4): 살아남은 섹션 블록만, 주장 텍스트와 참조로 줄여 보낸다. 실패하면 노트는 전역 블록 없이 간다(알림).
        let global = null, globalFailed = false;
        if (plan.global.length) {
          const survivors = [];
          for (const s of sections) if (s.output) {
            const v = check(s.sectionId, s.output), blocks = v.blocks.filter(b => !b.errors.length);
            if (!v.errors.length && blocks.length) survivors.push({ sectionId: s.sectionId, title: planOf.get(s.sectionId).title, gist: v.gist, blocks });
          }
          const gs = survivors.length ? globalSections(survivors) : null;
          if (gs) {
            try {
              global = await call("write", "global", models.write, { stage: "global", noteSpecVersion: SPEC, plan: { concepts: plan.concepts, global: plan.global }, sections: gs, options }, "LLM",
                asOutput(NoteContract.globalOutputSchemaFor(plan.global)));
            } catch (e) { if (halting(e, "LLM")) throw e; globalFailed = true; }
          } else globalFailed = true;
        }

        const systemNotices = [...gapNotices];
        if (unsupported) systemNotices.push({ code: "NOTE_CLAIMS_UNSUPPORTED", count: unsupported });
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
          ...base, sections, global, units: allUnits, crops: Object.keys(R().cropMap), tier, systemNotices, promptVersion: ctx.out.planning.promptVersion ?? null,
          meta: {
            title: m.title ?? null, course: m.course ?? null, lectureDate: m.lectureDate ?? null, session: m.session ?? null, lang: m.lang ?? "ko",
            generatedAt: now().toISOString(), processed: allUnits.length ? { t0: Math.min(...allUnits.map(u => u.t0)), t1: Math.max(...allUnits.map(u => u.t1)) } : { t0: 0, t1: 0 },
          },
        });
        ev.emit({ stage: "validate", msg: `sections=${note.sections.length} dropped=${note.dropped.length} repaired=${repaired}` });
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
