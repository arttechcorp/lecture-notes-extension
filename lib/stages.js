// 파이프라인 v2 단계 오케스트레이션(docs/architecture-v2.md §5.2, §6.3~6.5, §7, §8):
// 정제 → 판정 → 계획 → 작성 → 검증 → 렌더를 Pipeline.runStages 로 돌린다. 단계 결과는 단계 캐시에 남아 같은 입력의 재실행은 서비스를 다시 부르지 않는다.
// 노트 양식(블록 필드)은 lib/note-spec.js 한 곳에만 있다. 여기서는 블록을 `evidenceIds` 를 가진 불투명 객체로만 다룬다(verify.js 와 같다).
// 서비스(plan·write·judge)·KaTeX·이벤트·렌더러·시계는 전부 deps 로 주입한다. 이벤트와 알림에는 코드·수치·id·시각 구간만 싣고 강의 내용은 싣지 않는다.
//
// runNote(job, input, deps) → {status, note, notices, rendered?}
//   input: {slides:[SlideDoc], transcript:Transcript, gaps:[{reason,t0,t1}], tier:"free"|"paid", models:{plan,write,judge}, consent:{summary}, rerun?}
//   deps:  {service:{plan,write,judge}, katex, events?, render?(note,{signal}), signal?, breaker?, sleep?, concurrency?}
//   status "complete" | "partial"(실패 섹션이 있다) | "recognition-only"(요약 동의 없음, 서비스 호출 없이 일시정지) | job 상태("failed"·"paused"·"cancelled")
//   note: {noteSpecVersion, plan, sections:[{sectionId,title,blocks}], global:[blocks], registry, notices}
//   notices: [{code, count?, ranges?:[{t0,t1}], ids?}] — 가능한 코드는 NOTE_* 와 CONSENT_SUMMARY_REQUIRED.
//   rerun: 같은 입력을 다시 돌릴 때(실패 섹션 재시도 등) 올리는 번호. requestId 와 쓰기 이후 단계 캐시 키에 들어가고, 이미 성공한 호출은 캐시에서 다시 쓴다.
(() => {
  const need = (name, path) => globalThis[name] || (typeof require !== "undefined" ? require(path) : null);
  const Pipeline = need("Pipeline", "./pipeline.js"), Verify = need("Verify", "./verify.js"), Boilerplate = need("Boilerplate", "./boilerplate.js");
  const Formulas = need("Formulas", "./formulas.js"), Preprocess = need("Preprocess", "./preprocess.js"), Contracts = need("Contracts", "./contracts.js"), NoteSpec = need("NoteSpec", "./note-spec.js");

  // 단계 로직이나 알림 모양을 바꾸면 올린다. 단계 캐시 키(promptVersion 자리)에 들어간다.
  const VERSION = "stages-1";
  // /v1/judge 상한: 요청당 항목 200, items JSON 64KiB(server/index.js). 한글은 글자당 3바이트라 개수만으로는 부족해 바이트도 센다.
  const JUDGE_ITEMS = 200, JUDGE_BYTES = 60000, JUDGE_CHARS = 8000;
  // 섹션을 나눠 다시 보내면 풀리는 서버 오류(§6.5): 출력 잘림, 입력 상한 초과.
  const SPLIT = new Set(["llm_output_truncated", "request_too_large"]);
  const ALIAS = { llm_output_truncated: "LLM_TRUNCATED" };
  const enc = new TextEncoder();
  const uniq = list => [...new Set(list)];
  const kept = s => s.status == null || s.status === "kept";
  const rangeOf = us => ({ t0: Math.min(...us.map(u => u.t0)), t1: Math.max(...us.map(u => u.t1)) });

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

  // 계획 검증: 모든 유닛이 정확히 한 섹션에 있어야 하고 모르는 유닛 id·빈 섹션·겹친 섹션 id 는 거절한다.
  // ponytail: 고쳐 쓰지 않고 코드를 붙여 작업을 실패시킨다. 모델 계획은 temp 0 이라 같은 계획 재요청은 소용없고, 빠진 유닛을 앞 섹션에 붙이는 식의 결정적 보정은 필요해지면 여기에 둔다.
  function checkPlan(plan, units) {
    const known = new Set(units.map(u => u.unitId)), seen = new Set(), sections = new Set(), bad = [];
    for (const s of plan.sections) {
      if (sections.has(s.sectionId)) bad.push("section:" + s.sectionId);
      sections.add(s.sectionId);
      if (!s.unitIds.length) bad.push("empty:" + s.sectionId);
      for (const id of s.unitIds) {
        if (!known.has(id)) bad.push("unknown:" + id);
        else if (seen.has(id)) bad.push("duplicate:" + id);
        seen.add(id);
      }
    }
    for (const id of known) if (!seen.has(id)) bad.push("missing:" + id);
    if (bad.length) throw Pipeline.pipelineError("VAL_PLAN_INVALID", { detail: bad.slice(0, 20) });
  }

  // 판정 항목을 개수와 바이트 상한 안의 묶음으로 나눈다. 항목 하나가 상한을 넘는 일은 없다(항목당 8000자 ≤ 24KB).
  function batches(items) {
    const out = [];
    let cur = [], size = 2;
    for (const it of items) {
      const n = enc.encode(JSON.stringify(it)).length + 1;
      if (cur.length && (cur.length >= JUDGE_ITEMS || size + n > JUDGE_BYTES)) { out.push(cur); cur = []; size = 2; }
      cur.push(it); size += n;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  // 서비스 오류 코드(소문자)를 파이프라인 코드(영역_원인)로 접는다. 이미 코드가 있는 오류는 그대로, 코드가 없는 오류(버그)는 null.
  function codeFor(e, area) {
    const c = Pipeline.codeOf(e, area);
    if (c || typeof e?.code !== "string") return c;
    const up = e.code.toUpperCase().replace(/\W/g, "_");
    return ALIAS[e.code] ?? (up.startsWith(area + "_") ? up : `${area}_${up}`).slice(0, 64);
  }
  // runStages 가 코드로 실패·일시정지시킬 수 있게 서비스 오류에 코드를 붙인다. 버그(코드 없는 오류)는 그대로 던져진다.
  const asCoded = (e, area) => Pipeline.codeOf(e, area) || typeof e?.code !== "string" ? e : Pipeline.pipelineError(codeFor(e, area), { cause: e });
  // 이 오류는 섹션 하나가 아니라 작업 전체를 멈춘다: 일시정지 사유가 있는 코드(한도·네트워크·차단기 등)와 버그. 완료된 호출은 캐시에 남아 재개가 싸다.
  const halting = (e, area) => { const c = codeFor(e, area); return !c || Boolean(Pipeline.CODES[c]?.pause); };
  const scoped = (events, jobId) => ({ emit: e => events.emit({ jobId, ...e }), span: f => events.span({ jobId, ...f }) });
  const must = ok => { if (!ok) throw Pipeline.pipelineError("VAL_OUTPUT_INVALID"); };

  async function runNote(job, input, deps = {}) {
    const { slides = [], transcript, gaps = [], tier, models = {}, consent } = input ?? {};
    // 판정은 유료이면서 판정 모델이 있을 때만 한다. 서버가 judge 기능을 끄면(/v1/me features) 호출자가 모델을 비워 판정 없이 진행한다(설계 §17 기능 스위치).
    const judged = tier === "paid" && Boolean(models.judge), signal = deps.signal, ev = scoped(deps.events ?? job.events, job.jobId);
    const rerun = Number.isInteger(input?.rerun) && input.rerun > 0 ? input.rerun : 0;
    const segments = transcript?.segments ?? [];
    // 수신·인식은 앞 단계 몫이다. 갓 만든 작업이면 빈 전이로 ingesting 까지 데려온다.
    if (job.state === "created") await job.transition("acquiring_source");
    if (job.state === "acquiring_source") await job.transition("ingesting");
    const ranges = gapRanges(gaps), gapNotices = ranges.length ? [{ code: "NOTE_CAPTURE_GAP", count: ranges.length, ranges }] : [];

    // 요약 동의가 없으면 서비스를 부르지 않고 인식 결과만 보여 준다(§5.2, recognitionResult 이식). 다른 엔진·경로로 조용히 넘어가지 않는다 —
    // 작업은 사용자 사유로 일시정지하고, 동의한 뒤 job.resume() 과 같은 입력의 runNote 로 이어 간다.
    if (consent?.summary !== true) {
      if (!["paused", "done", "failed", "cancelled"].includes(job.state)) await job.transition("paused", { reason: "user", code: "CONSENT_SUMMARY_REQUIRED" });
      return { status: "recognition-only", note: null, notices: [...gapNotices, { code: "CONSENT_SUMMARY_REQUIRED" }], counts: { slides: slides.length, segments: segments.filter(kept).length } };
    }
    if (!deps.service || typeof deps.katex?.renderToString !== "function") throw new TypeError("service 와 katex 가 필요합니다.");
    if (!models.plan || !models.write) throw new TypeError("계획·작성 모델이 필요합니다.");
    const breaker = deps.breaker ?? Pipeline.createBreaker();
    const ctx = { signal, out: {} };
    const R = () => ctx.out.refining;

    // 판정 점수를 합친 유닛. 판정 단계가 끝난 뒤 처음 부를 때 만든다(캐시에서 복원돼도 같다).
    let scored, index;
    const units = () => scored ??= R().ir.units.map(u => {
      const s = ctx.out.judging.importance[u.unitId];
      return typeof s === "number" ? { ...u, judge: { ...u.judge, importance: s } } : u;
    });
    const unit = id => (index ??= new Map(units().map(u => [u.unitId, u]))).get(id);
    const forWriter = e => ({ id: e.id, latex: e.latex ?? null, status: e.status });
    // 서버 registry 상한이 200건이라 섹션 유닛에 나온 수식만 보낸다. 검증기도 같은 목록으로 참조를 확인한다.
    const regFor = us => { const ids = new Set(us.map(u => u.unitId)); return R().registry.filter(e => R().formulaUnits[e.id]?.some(id => ids.has(id))).map(forWriter); };
    const evidenceOf = us => us.map(u => ({ id: u.unitId, text: u.slideText + "\n" + u.speech }));
    const K = async (value, model = null, schemaVersion = NoteSpec.NOTE_SPEC_VERSION) => ({ inputDigest: await Pipeline.digest(value), model, promptVersion: VERSION, schemaVersion });
    const stage = (state, area, key, run) => ({ state, area, key, run: async c => { try { return await run(c); } catch (e) { throw asCoded(e, area); } } });

    // 서버 응답은 쓰기 전에 다시 검증하고(§5.4) 캐시에는 검증을 통과한 부분만 넣는다.
    const asPlan = r => (must(Contracts.validate(NoteSpec.planSchema, r.plan).ok), r.plan);
    const asBlocks = schema => r => (must(Contracts.validate(schema, { blocks: r.blocks }).ok), r.blocks);
    const asResults = r => (must(Array.isArray(r.results) && r.results.every(x => Contracts.validate(Contracts.SCHEMAS.judgeResult, x).ok)), r.results);

    // 서비스 호출 한 건. 본문 해시가 같으면 패키지 캐시의 결과를 다시 쓴다 — 서버는 같은 requestId 를 409 로 막고 결과를 저장하지 않으므로,
    // 일시정지 뒤 재개나 취소 뒤 재실행에서 이미 돈을 낸 호출을 다시 보내면 안 된다. requestId = 본문 해시 + rerun, 재시도마다 retryId.
    async function call(method, label, model, body, area, shape) {
      const inputDigest = await Pipeline.digest({ label, model, body });
      const key = await Pipeline.stageKey({ stage: "call." + label, inputDigest, model, promptVersion: VERSION, schemaVersion: NoteSpec.NOTE_SPEC_VERSION });
      const base = `${label}-${(await Pipeline.digest({ inputDigest, rerun })).slice(0, 32)}`;
      return Pipeline.cached(job.store, key, async () => shape(await Pipeline.withRetry(
        n => breaker.run(model, () => deps.service[method]({ ...body, model, requestId: Pipeline.retryId(base, n), signal }), { area }),
        { signal, sleep: deps.sleep },
      )), { packageId: job.packageId, signal });
    }
    // pool 결과의 첫 실패를 던진다(취소가 먼저). worker 안에서 거를 수 있는 오류는 이미 거른 뒤라 남은 실패는 모두 단계를 멈춘다.
    const settle = (results, area) => {
      signal?.throwIfAborted();
      const bad = results.find(r => r.status === "failed");
      if (bad) throw asCoded(bad.error, area);
      return results.map(r => r.value);
    };
    const lanes = name => Pipeline.laneCount(name, deps.concurrency);

    // ── C. 정제: 로컬, 순수 함수 ──
    const refining = stage("refining", "LLM",
      () => K({ slides, segments: segments.map(({ t0, t1, text, status }) => ({ t0, t1, text, status })), katex: deps.katex.version ?? null }, null, Contracts.CONTRACT_VERSION),
      async () => {
        const bp = Boilerplate.detect(slides); // 비파괴: 걸러낸 블록은 selection:"filtered" 로 남는다
        // ponytail: 재판독(reread)은 연결하지 않았다 — 검증에 실패한 수식은 바로 image(원본 크롭)로 내린다. 더 강한 모델로 한 번 다시 읽으려면 여기서 reread 없이 먼저 verify 하고 실패분만 다시 읽는다.
        const registry = Formulas.buildRegistry(bp.slides).map(e => Formulas.verify(e, { katex: deps.katex, reread: true }));
        const ir = Preprocess.buildIR(bp.slides, segments);
        // 수식 id → 그 수식이 나오는 유닛. 병합된 슬라이드는 mergedFrom 으로 거슬러 올라간다(레지스트리는 병합 전 슬라이드 id 를 쓴다).
        const owner = new Map();
        for (const m of Preprocess.mergeProgressive(bp.slides)) for (const id of [...(m.mergedFrom ?? []), m.slideId]) owner.set(String(id), String(m.slideId));
        const unitOf = new Map(ir.units.filter(u => u.slideId != null).map(u => [u.slideId, u.unitId]));
        const formulaUnits = Object.fromEntries(registry.map(e => [e.id, uniq([e.slideId, ...e.seenOn].map(s => unitOf.get(owner.get(String(s)))).filter(Boolean))]));
        return { ir: { units: ir.units, stats: ir.stats }, registry, formulaUnits };
      });

    // ── D. 판정: 유료만. Free 는 호출 없이 지나가는 빈 단계다 ──
    // ponytail: T2 유닛 중요도만 호출한다. T1(발화 분류)·T3(반복 텍스트 애매 후보)·T4(도표 분류)는 범위 밖이다 — 필요해지면 이 단계에 과제를 더한다.
    // T5(근거 지지)는 검증 단계가 부른다. 판정 실패는 조용히 건너뛰지 않고 작업을 멈춘다(JDG_*).
    const judging = stage("judging", "JDG", () => K({ paid: judged, units: R().ir.units }, judged ? models.judge : null), async () => {
      if (!judged) return { importance: {} };
      // 항목 한 건은 8000자까지만 보낸다(서버 상한). 긴 유닛은 앞부분으로 중요도를 가늠한다.
      const items = R().ir.units.map(u => ({ itemId: u.unitId, text: `${u.slideText}\n${u.speech}`.trim().slice(0, JUDGE_CHARS) })).filter(i => i.text);
      const rs = settle(await Pipeline.pool(batches(items),
        b => call("judge", "importance", models.judge, { task: "importance", items: b }, "JDG", asResults),
        { lanes: lanes("judge"), signal, events: ev, stage: "judge" }), "JDG");
      const importance = {};
      // 점수는 기댓값(1~5)이다. 계약 범위로 눌러 둔다(부동소수 오차가 요청 검증에 걸리지 않게).
      for (const r of rs.flat()) if (Number.isFinite(r.score)) importance[r.itemId] = Math.min(5, Math.max(1, r.score));
      return { importance };
    });

    // ── E. 계획: 1회 ──
    const planning = stage("planning", "LLM",
      () => K({ units: units(), formulas: R().registry.map(({ id, status }) => ({ id, status })) }, models.plan),
      async () => {
        if (!units().length) throw Pipeline.pipelineError("VAL_NO_CONTENT");
        const formulas = R().registry.map(({ id, status }) => ({ id, status }));
        const plan = await call("plan", "plan", models.plan, { noteSpecVersion: NoteSpec.NOTE_SPEC_VERSION, ir: { units: units() }, formulas }, "LLM", asPlan);
        checkPlan(plan, units());
        return { plan };
      });

    // ── F. 작성: 섹션 병렬. 섹션 하나의 실패는 노트를 죽이지 않는다 ──
    async function writeSection(section) {
      const send = (p, us) => call("write", "section", models.write,
        { stage: "section", noteSpecVersion: NoteSpec.NOTE_SPEC_VERSION, section: p, units: us, registry: regFor(us) }, "LLM", asBlocks(NoteSpec.sectionOutputSchema));
      const us = section.unitIds.map(unit);
      try { return await send(section, us); } catch (e) {
        if (!SPLIT.has(e?.code) || us.length < 2) throw e;
        // 출력 잘림은 한도를 올리지 않고 섹션을 반으로 나눠 반마다 한 번씩 쓴다. 출력 크기는 계획의 블록 수가 정하므로 블록 계획도 같이 나눈다(블록이 하나뿐이면 둘 다 그 계획을 쓴다).
        // 반도 잘리면 그 섹션은 실패다. 같은 섹션 안에서 레인을 더 쓰지 않도록 반은 차례로 보낸다.
        ev.emit({ stage: "write", unit: section.sectionId, level: "warn", code: codeFor(e, "LLM"), msg: "split" });
        const h = Math.ceil(us.length / 2), b = section.blocks.length > 1 ? Math.ceil(section.blocks.length / 2) : 0;
        const halves = [[us.slice(0, h), b ? section.blocks.slice(0, b) : section.blocks], [us.slice(h), b ? section.blocks.slice(b) : section.blocks]];
        const out = [];
        for (const [hu, hb] of halves) out.push(...await send({ ...section, unitIds: hu.map(u => u.unitId), blocks: hb }, hu));
        return out;
      }
    }
    const writing = stage("writing", "LLM",
      () => K({ plan: ctx.out.planning.plan, units: units(), registry: R().registry.map(forWriter), formulaUnits: R().formulaUnits, rerun }, models.write),
      async () => {
        const sections = ctx.out.planning.plan.sections;
        const rs = await Pipeline.pool(sections, writeSection, { lanes: lanes("write"), signal, events: ev, stage: "write" });
        signal?.throwIfAborted();
        // 한도·네트워크·차단기처럼 모든 섹션을 막을 오류는 부분 노트로 덮지 않고 작업을 멈춘다. 쓴 섹션은 호출 캐시에 남아 재개가 싸다.
        const stop = rs.find(r => r.status === "failed" && halting(r.error, "LLM"));
        if (stop) throw stop.error;
        const done = [], failed = [];
        rs.forEach((r, i) => r.status === "ok" ? done.push({ sectionId: sections[i].sectionId, blocks: r.value }) : failed.push(sections[i].sectionId));
        if (!done.length) throw rs.find(r => r.status === "failed").error; // 한 섹션도 못 썼다면 부분 노트가 아니라 실패다
        ev.emit({ stage: "write", msg: `sections=${done.length} failed=${failed.length}` });
        return { sections: done, failed };
      });

    // ── G. 검증: 섹션별 검증 → 실패 블록 1회 재생성 → (유료) 근거 지지 → 전체 글 ──
    const validating = stage("validating", "LLM",
      () => K({ writing: ctx.out.writing, plan: ctx.out.planning.plan, units: units(), registry: R().registry, gaps, paid: judged, judge: judged ? models.judge : null, rerun }, models.write),
      async () => {
        const plan = ctx.out.planning.plan, planOf = new Map(plan.sections.map(s => [s.sectionId, s]));
        const view = id => { const p = planOf.get(id), us = p.unitIds.map(unit); return { plan: p, units: us, evidence: evidenceOf(us), registry: regFor(us) }; };
        const check = (blocks, c) => Verify.verifySection({ blocks, evidence: c.evidence, registry: c.registry, katex: deps.katex });
        const support = async (blocks, evidence) => {
          // 점수가 없는 블록은 유지한다(checkSupport 계약). 묶음은 서버 상한 안에서 차례로 보낸다.
          const judge = async items => { const out = []; for (const b of batches(items)) out.push(...await call("judge", "support", models.judge, { task: "support", items: b }, "JDG", asResults)); return out; };
          const low = new Set((await Verify.checkSupport(blocks, evidence, { judge })).blocks.map(b => b.index));
          return blocks.filter((_, i) => !low.has(i));
        };

        // 1차: 검증하고 실패 블록만 한 번 다시 쓴다. 다시 써도 실패한 블록은 뺀다. 재생성 호출이 실패하면 실패 블록은 그대로 빠진다(한도·네트워크 오류는 작업을 멈춘다).
        const fix = async ({ sectionId, blocks }) => {
          const c = view(sectionId);
          let v = check(blocks, c);
          if (v.blocks.length) {
            const repair = v.blocks.map(({ index, errors }) => ({ index, block: blocks[index], errors: errors.slice(0, 20).map(e => ({ code: e.code, detail: e.detail.map(String).join(", ").slice(0, 300) })) }));
            ev.emit({ stage: "validate", unit: sectionId, msg: `repair=${repair.length}` });
            try {
              const fixed = await call("write", "repair", models.write,
                { stage: "repair", noteSpecVersion: NoteSpec.NOTE_SPEC_VERSION, section: c.plan, units: c.units, registry: c.registry, repair }, "LLM", asBlocks(NoteSpec.sectionOutputSchema));
              if (fixed.length === repair.length) {
                blocks = blocks.slice();
                repair.forEach((r, i) => { blocks[r.index] = fixed[i]; });
                v = check(blocks, c);
              }
            } catch (e) { if (halting(e, "LLM")) throw e; }
          }
          const bad = new Set(v.blocks.map(b => b.index));
          return { sectionId, blocks: blocks.filter((_, i) => !bad.has(i)), dropped: bad.size };
        };
        let rs = settle(await Pipeline.pool(ctx.out.writing.sections, fix, { lanes: lanes("write"), signal, events: ev, stage: "validate" }), "LLM");
        if (judged) {
          rs = settle(await Pipeline.pool(rs, async s => {
            const blocks = await support(s.blocks, view(s.sectionId).evidence);
            return { ...s, blocks, dropped: s.dropped + s.blocks.length - blocks.length };
          }, { lanes: lanes("judge"), signal, events: ev, stage: "support" }), "JDG");
        }

        // 남은 블록으로 다시 검증해 미인용 유닛과 커버리지를 정한다. 블록이 없거나 인용률이 무너진 섹션은 실패 섹션이다(v1 의 커버리지 차단 이식).
        let dropped = 0;
        const survivors = [], failedIds = new Set(ctx.out.writing.failed);
        for (const s of rs) {
          const c = view(s.sectionId), v = check(s.blocks, c);
          if (!s.blocks.length || v.section.errors.length) { failedIds.add(s.sectionId); continue; }
          dropped += s.dropped;
          survivors.push({ sectionId: s.sectionId, title: c.plan.title, blocks: s.blocks, uncited: v.section.uncitedIds });
        }
        if (!survivors.length) throw Pipeline.pipelineError("VAL_NO_SECTIONS");

        // 전체 글: 살아남은 섹션 위에서 한 번. 실패하면 노트는 전체 글 없이 간다(알림). 전체 글 블록도 같은 검증(재생성 없이)과 근거 지지를 거친다.
        // ponytail: 입력은 섹션 블록 전부라 큰 노트는 서버 입력 상한(request_too_large)에 걸려 전체 글이 빠진다. 줄여 보내려면 여기서 섹션 블록을 요약해 넣는다.
        let global = [], globalFailed = false;
        try {
          global = await call("write", "global", models.write,
            { stage: "global", noteSpecVersion: NoteSpec.NOTE_SPEC_VERSION, sections: survivors.map(({ sectionId, title, blocks }) => ({ sectionId, title, blocks })) }, "LLM", asBlocks(NoteSpec.globalOutputSchema));
        } catch (e) { if (halting(e, "LLM")) throw e; globalFailed = true; }
        if (global.length) {
          const evidence = evidenceOf(survivors.flatMap(s => view(s.sectionId).units)), bad = new Set(check(global, { evidence, registry: R().registry.map(forWriter) }).blocks.map(b => b.index));
          let keep = global.filter((_, i) => !bad.has(i));
          if (judged) keep = await support(keep, evidence).catch(e => { throw asCoded(e, "JDG"); });
          dropped += global.length - keep.length;
          global = keep;
        }

        // 알림은 내용 없이 코드·개수·id·시각 구간만 싣는다.
        const notices = [...gapNotices], failed = plan.sections.map(s => s.sectionId).filter(id => failedIds.has(id));
        if (failed.length) notices.push({ code: "NOTE_SECTIONS_FAILED", count: failed.length, ids: failed, ranges: failed.map(id => rangeOf(view(id).units)) });
        if (dropped) notices.push({ code: "NOTE_BLOCKS_DROPPED", count: dropped });
        const uncited = survivors.flatMap(s => s.uncited.map(unit)).sort((a, b) => a.t0 - b.t0);
        if (uncited.length) notices.push({ code: "NOTE_UNITS_UNCITED", count: uncited.length, ids: uncited.map(u => u.unitId), ranges: uncited.map(({ t0, t1 }) => ({ t0, t1 })) });
        for (const [code, status] of [["NOTE_FORMULAS_UNVERIFIED", "unverified"], ["NOTE_FORMULAS_IMAGE", "image"]]) {
          const ids = R().registry.filter(e => e.status === status).map(e => e.id);
          if (ids.length) notices.push({ code, count: ids.length, ids });
        }
        if (globalFailed) notices.push({ code: "NOTE_GLOBAL_FAILED" });
        if (!judged) notices.push({ code: "NOTE_JUDGE_SKIPPED" });
        ev.emit({ stage: "validate", msg: `sections=${survivors.length} failed=${failed.length} dropped=${dropped}` });
        const note = {
          noteSpecVersion: NoteSpec.NOTE_SPEC_VERSION, plan,
          sections: survivors.map(({ sectionId, title, blocks }) => ({ sectionId, title, blocks })),
          global, registry: R().registry, notices,
        };
        return { note, partial: failed.length > 0 };
      });

    // ── H. 렌더: 렌더러는 따로 만든다. 없으면 건너뛴다 ──
    // ponytail: 렌더 결과는 JSON 으로 단계 캐시에 들어간다(HTML 문자열 등). Blob 이 필요하면 호출자가 id 만 돌려주게 한다. 템플릿이 바뀌면 render.version 을 올려야 캐시가 비켜 간다.
    const rendering = stage("rendering", "LLM",
      () => K({ note: ctx.out.validating.note, render: deps.render ? (deps.render.version ?? "") : null }),
      async () => ({ rendered: deps.render ? await deps.render(ctx.out.validating.note, { signal }) : null }));

    await Pipeline.runStages(job, [refining, judging, planning, writing, validating, rendering], ctx);
    if (job.state !== "done" || !ctx.out.validating) {
      const { state, code = null, reason = null } = job.record;
      return { status: state, code, reason, note: null, notices: [] };
    }
    const { note, partial } = ctx.out.validating;
    return { status: partial ? "partial" : "complete", note, notices: note.notices, rendered: ctx.out.rendering.rendered };
  }

  const api = { runNote, gapRanges, checkPlan, batches };
  globalThis.NoteStages = api;
  if (typeof module !== "undefined") module.exports = api;
})();
