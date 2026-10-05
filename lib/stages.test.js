const test = require("node:test");
const assert = require("node:assert/strict");
const katex = require("./vendor/katex/katex.min.js");
const P = require("./pipeline.js");
const S = require("./stages.js");
const NoteContract = require("./note-contract.js");
const Contracts = require("./contracts.js");
const Prompts = require("../server/prompts.js");
const { createStore, memoryAdapter } = require("./package-store.js");
const { EventBus } = require("./events.js");
const INPUT = require("../tools/note-fixture/input.json");
const PLANNER = require("../tools/note-fixture/planner-output.json");
const WRITER = require("../tools/note-fixture/writer-outputs.json");

// 합성 픽스처 강의(tools/note-fixture)로 runNote 를 끝까지 돌린다. 픽스처 문장(슬라이드·발화·생성 문장,
// 학번 워터마크)은 이벤트와 알림 어디에도 나오면 안 된다.
const clock = (t = 1000) => () => t++;
const svcErr = (code, extra) => Object.assign(new Error(code), { code, retryable: false, retryAfterMs: null }, extra);
const deep = o => JSON.parse(JSON.stringify(o));
const codes = notices => notices.map(n => n.code);
const noticeOf = (res, code) => res.notices.find(n => n.code === code);
const GAPS = [{ reason: "asr-failed", t0: 14, t1: 20 }, { reason: "asr-failed", t0: 10, t1: 12 }, { reason: "user-paused", t0: 30, t1: 31 }];
const inputOf = (over = {}) => ({
  slides: INPUT.slides, transcript: INPUT.transcript, gaps: [], tier: "paid",
  models: { plan: "m-plan", write: "m-write", judge: null },
  consent: { summary: true }, meta: INPUT.meta, ...over,
});

// 서버 계약(server/prompts.js 요청 스키마·/v1/judge 상한)을 가짜 서비스가 그대로 지킨다 — 요청 모양이 어긋나면 여기서 실패한다.
const ENVELOPE = new Set(["model", "requestId", "noteSpecVersion", "stage", "signal", "jobId", "host", "timeoutMs", "sourceLang"]); // sourceLang 은 서버 라우트의 선택 필드다
function assertRequest(o) {
  const stage = o.stage ?? "plan";
  const r = Contracts.validate(Prompts.REQUEST[stage], Object.fromEntries(Object.entries(o).filter(([k]) => !ENVELOPE.has(k))));
  assert.ok(r.ok, stage + " " + JSON.stringify(r.errors));
  assert.match(o.requestId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
  assert.equal(o.noteSpecVersion, NoteContract.NOTE_SPEC_VERSION);
}
function assertJudge(o) {
  assert.ok(["importance", "support"].includes(o.task));
  assert.ok(o.items.length >= 1 && o.items.length <= 200, "items " + o.items.length);
  assert.equal(new Set(o.items.map(i => i.itemId)).size, o.items.length);
  assert.ok(Buffer.byteLength(JSON.stringify(o.items)) <= 65536);
  for (const i of o.items) {
    assert.ok(i.text.length >= 1 && i.text.length <= 8000);
    assert.ok(i.context === undefined || i.context.length <= 8000);
    assert.deepEqual(Object.keys(i).filter(k => !["itemId", "text", "context"].includes(k)), []);
  }
  assert.match(o.requestId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
}

// 픽스처 응답(.e2e-reference.cjs 와 같은 모양): 작성은 sections.<id>.first, 재작성은 sections.<id>.repair.blocks, 전체 글은 global.
// 요청한 blockId 만 골라 담는다 — 반으로 나뉜 작성 요청도 같은 픽스처에서 채운다. gist:false 이면 키 자체가 없어야 한다.
const pickOut = o => {
  const first = WRITER.sections[o.section.sectionId].first;
  const out = { blocks: Object.fromEntries(o.section.blocks.map(b => [b.blockId, first.blocks[b.blockId] ?? null])), checks: first.checks ?? [] };
  if (o.withGist !== false) out.gist = first.gist;
  return { output: out };
};
const DEFAULTS = {
  plan: () => ({ plan: PLANNER, promptVersion: "note-v2" }),
  section: o => ({ output: WRITER.sections[o.section.sectionId].first }),
  repair: o => ({ output: { blocks: Object.fromEntries(o.repair.map(r => [r.blockId, WRITER.sections[o.section.sectionId].repair?.blocks?.[r.blockId] ?? null])) } }),
  global: () => ({ output: WRITER.global }),
  judge: o => ({ results: o.items.map(i => ({ itemId: i.itemId, task: o.task, probs: [{ label: "yes", p: .9 }], score: o.task === "support" ? .9 : 3, confidence: null, model: o.model })) }),
};
// 서버처럼 성공한 requestId 를 다시 받으면 409 를 준다 — 이미 낸 돈의 호출을 다시 보내는 버그가 여기서 드러난다.
function fakeService(over = {}) {
  const calls = { plan: [], section: [], repair: [], global: [], judge: [] }, done = new Set();
  const run = async (kind, o) => {
    calls[kind].push(o);
    if (done.has(o.requestId)) throw svcErr("request_already_reserved_or_processed");
    const res = await (over[kind] ?? DEFAULTS[kind])(o, calls[kind].length - 1);
    done.add(o.requestId);
    return res;
  };
  return {
    calls, all: () => Object.values(calls).flat(),
    plan: o => (assertRequest(o), run("plan", o)),
    write: o => (assertRequest(o), run(o.stage, o)),
    judge: o => (assertJudge(o), run("judge", o)),
  };
}
async function setup({ jobId = "j1", packageId = "pkg", store } = {}) {
  store ??= await createStore(memoryAdapter());
  const bus = new EventBus({ now: clock(), limit: 100000 });
  return { store, bus, job: await P.createJob({ jobId, packageId, store, events: bus, now: clock() }) };
}
const depsOf = (service, bus, over = {}) => ({ service, katex, events: bus, sleep: async () => {}, ...over });
// ── 정상 경로 ──
test("paid without judge: fixture end to end, repair for S2·S3, only S3_B4 dropped", async () => {
  const { job, bus } = await setup(), svc = fakeService();
  const res = await S.runNote(job, inputOf({ gaps: GAPS }), depsOf(svc, bus));
  assert.equal(job.state, "done");
  assert.equal(res.status, "partial"); // S3_B4 는 재작성해도 근거에 없는 "1937"이 남아 빠진다
  assert.deepEqual([svc.calls.judge.length, svc.calls.plan.length, svc.calls.section.length, svc.calls.global.length], [0, 1, 5, 1]);
  const nv = Contracts.validate(NoteContract.schemas.note, res.note);
  assert.ok(nv.ok, JSON.stringify(nv.errors));
  assert.equal(res.note.noteSpecVersion, NoteContract.NOTE_SPEC_VERSION);
  assert.deepEqual(res.note.sections.map(s => [s.sectionId, s.blocks.length]), [["S1", 3], ["S2", 5], ["S3", 3], ["S4", 2], ["S5", 1]]);
  assert.deepEqual(res.note.global.map(b => b.id), ["GB1", "GB2"]);
  assert.deepEqual(res.note.dropped, [{ blockId: "S3_B4", type: "B07", codes: ["VAL_NUMBER_MISSING"] }]);
  assert.deepEqual(res.note.pruned.map(p => p.id).sort(), ["GB1/I3", "S4_B2/Q3"]); // 끊어진 대상만 정리된다
  assert.deepEqual(res.note.notices, res.notices);
  assert.equal(res.rendered, null); // 렌더러가 없으면 건너뛴다
  assert.deepEqual(res.cropMap, {});

  // 실패 블록만 blockId 로 다시 쓴다 — S2 와 S3 뿐, 딱 그 블록들만
  assert.equal(svc.calls.repair.length, 2);
  assert.deepEqual(Object.fromEntries(svc.calls.repair.map(c => [c.section.sectionId, c.repair.map(r => r.blockId)])), { S2: ["S2_B3", "S2_B5"], S3: ["S3_B4"] });
  assert.equal(svc.calls.repair.find(c => c.section.sectionId === "S3").repair[0].errors[0].code, "VAL_NUMBER_MISSING");

  // 고지는 코드·건수·id·구간만 — 순서까지 계약이다(gaps 가 있으면 NOTE_CAPTURE_GAP 가 맨 앞에 온다)
  assert.deepEqual(codes(res.notices), ["NOTE_CAPTURE_GAP", "NOTE_JUDGE_SKIPPED", "NOTE_BLOCKS_DROPPED", "NOTE_ITEMS_PRUNED", "NOTE_FORMULAS_CHECK", "NOTE_FIGURES_CHECK"]);
  assert.deepEqual(noticeOf(res, "NOTE_CAPTURE_GAP"), { code: "NOTE_CAPTURE_GAP", count: 2, ids: null, ranges: [{ t0: 10, t1: 20 }, { t0: 30, t1: 31 }] }); // 이유는 계약 스키마가 받지 않는다
  assert.deepEqual(noticeOf(res, "NOTE_BLOCKS_DROPPED"), { code: "NOTE_BLOCKS_DROPPED", count: 1, ids: ["S3_B4"], ranges: null });
  assert.deepEqual(noticeOf(res, "NOTE_FORMULAS_CHECK").ids, ["F3"]); // 미검증 수식 참조
  assert.deepEqual(noticeOf(res, "NOTE_FIGURES_CHECK").ids, ["G2"]); // 못 읽은 차트 참조
  assert.deepEqual(svc.calls.global[0].sections.map(s => s.sectionId), ["S1", "S2", "S3", "S4", "S5"]);
  assert.ok(svc.calls.section.every(c => c.withGist === true));
});

test("every service call carries the job id; only the plan request carries the input host", async () => {
  const { job, bus } = await setup(), svc = fakeService();
  await S.runNote(job, inputOf({ host: "lms.example.edu" }), depsOf(svc, bus));
  assert.ok(svc.all().every(c => c.jobId === "j1"), "모든 호출에 작업 번호");
  assert.equal(svc.calls.plan[0].host, "lms.example.edu");
  assert.ok(svc.all().filter(c => c !== svc.calls.plan[0]).every(c => c.host === undefined), "host는 계획 요청만 받는다");
  const b = await setup({ jobId: "j2" }), svcB = fakeService();
  await S.runNote(b.job, inputOf(), depsOf(svcB, b.bus));
  assert.equal(svcB.calls.plan[0].jobId, "j2");
  assert.ok(!("host" in svcB.calls.plan[0]), "host가 없으면 키 자체를 보내지 않는다");
});

test("free: the fixture plan's G1/G2 references are unbuildable — repair drops them and the note finishes", async () => {
  const { job, bus } = await setup(), svc = fakeService();
  const res = await S.runNote(job, inputOf({ tier: "free" }), depsOf(svc, bus));
  assert.equal(job.state, "done");
  assert.equal(res.status, "partial"); // S3_B4 는 무료에서도 빠진다
  const rep = bus.recent().find(e => e.code === "PLAN_REPAIRED");
  assert.ok(rep, "PLAN_REPAIRED 이벤트 — 도표가 없는 free 에서 참조를 뗐다");
  assert.ok((rep.msg ?? "").includes("ref-drop:S3:G1"), rep.msg);
  assert.ok((rep.msg ?? "").includes("ref-drop:S4:G2"), rep.msg);
  assert.deepEqual(res.note.figures, []);
  assert.ok(codes(res.notices).includes("NOTE_FIGURES_NOT_DETECTED"));
});

test("free: with figure references stripped the note finishes with NOTE_FIGURES_NOT_DETECTED", async () => {
  const plan = deep(PLANNER);
  for (const s of plan.sections) for (const b of s.blocks) b.figureIds = [];
  const { job, bus } = await setup(), svc = fakeService({ plan: () => ({ plan }) });
  const res = await S.runNote(job, inputOf({ tier: "free" }), depsOf(svc, bus));
  assert.equal(job.state, "done");
  assert.equal(res.status, "partial"); // S3_B4 는 무료에서도 빠진다
  assert.equal(res.note.tier, "free");
  assert.deepEqual(res.note.figures, []); // Free 는 도표를 만들지 않는다
  assert.ok(codes(res.notices).includes("NOTE_FIGURES_NOT_DETECTED"));
  assert.ok(codes(res.notices).includes("NOTE_JUDGE_SKIPPED"));
  assert.equal(svc.calls.judge.length, 0);
});

test("paid+judged: importance in batches, support only for lecture claims, a low score nulls the block", async () => {
  const { job, bus } = await setup(), svc = fakeService({
    judge: o => ({ results: o.items.map(i => ({ itemId: i.itemId, task: o.task, probs: [{ label: "yes", p: .9 }], score: o.task === "importance" ? 3 : i.text.includes("함께 기억해 두면 좋다") ? .1 : .9, confidence: null, model: o.model })) }),
  });
  const res = await S.runNote(job, inputOf({ models: { plan: "m-plan", write: "m-write", judge: "m-judge" } }), depsOf(svc, bus));
  assert.equal(res.status, "partial");
  const importance = svc.calls.judge.filter(c => c.task === "importance");
  assert.equal(importance.length, 1); // 유닛 6개 — 200건 상한 안이라 한 묶음
  assert.deepEqual(importance[0].items.map(i => i.itemId), ["U1", "U2", "U3", "U4", "U5", "U6"]);
  assert.equal(importance[0].model, "m-judge");
  assert.ok(svc.calls.plan[0].ir.units.every(u => u.judge.importance === 3)); // 점수는 계획 요청으로 흘러간다

  const support = svc.calls.judge.filter(c => c.task === "support");
  assert.equal(support.length, 5); // 주장이 있는 섹션마다 한 번
  // 강의 근거 주장만 보낸다 — 교육용(일부러 틀린)·파생 주장 문장은 항목에 없다
  const texts = support.flatMap(c => c.items.map(i => i.text));
  assert.ok(texts.length > 0);
  assert.ok(texts.some(t => t.includes("함께 기억해 두면 좋다"))); // 낮은 점수를 맞은 주장은 확실히 나갔다
  assert.ok(texts.every(t => !["공헌이익은 판매가격에서 고정비를 뺀 값이다", "거래 빈도와 무관하게", "판매량은 500개", "판매량은 400개"].some(x => t.includes(x))));
  assert.deepEqual(noticeOf(res, "NOTE_CLAIMS_UNSUPPORTED"), { code: "NOTE_CLAIMS_UNSUPPORTED", count: 1, ids: null, ranges: null });
  const d = res.note.dropped.find(x => x.blockId === "S1_B3");
  assert.ok(d && d.codes.includes("VAL_BLOCK_DECLINED")); // 지지 점수 부족 → 보류 블록
  assert.deepEqual(res.note.sections.find(s => s.sectionId === "S1").blocks.map(b => b.id), ["S1_B1", "S1_B2"]);
  assert.ok(!codes(res.notices).includes("NOTE_JUDGE_SKIPPED"));
  assert.ok(svc.calls.section.every(c => c.sourceLang === undefined), "한국어 강의는 sourceLang 을 싣지 않는다");
  assert.match(bus.recent().find(e => e.code === "SUPPORT_SCORES").msg, /low=1 blocks=1 trimmed=0 bins<\.1,<\.3,<\.5,<\.7,>=\.7=0\/1\/0\/0\/\d+$/);
});
test("English lecture: requests carry sourceLang en, the judge reads each claim's English src, the note never holds src", async () => {
  const { job, bus } = await setup();
  const en = deep(INPUT.transcript);
  for (const sg of en.segments) sg.text += " " + "so the validation error is what we use to pick the model ".repeat(20);
  const addSrc = o => { (function walk(v) { if (Array.isArray(v)) return v.forEach(walk); if (!v || typeof v !== "object") return;
    if (typeof v.text === "string" && Array.isArray(v.evidenceIds) && typeof v.basis === "string") { v.src = v.basis === "lecture" ? "EN: " + v.text : null; return; }
    Object.values(v).forEach(walk); })(o); return o; };
  const svc = fakeService({
    section: o => addSrc({ output: deep(WRITER.sections[o.section.sectionId].first) }),
    repair: o => addSrc(DEFAULTS.repair(o)),
  });
  const res = await S.runNote(job, inputOf({ transcript: en, models: { plan: "m-plan", write: "m-write", judge: "m-judge" } }), depsOf(svc, bus));
  assert.ok(res.note, res.status);
  assert.ok([...svc.calls.section, ...svc.calls.repair, ...svc.calls.global].every(c => c.sourceLang === "en"));
  assert.equal(svc.calls.plan[0].sourceLang, undefined);
  assert.equal(bus.recent().find(e => e.code === "SOURCE_LANG").msg, "en");
  const texts = svc.calls.judge.filter(c => c.task === "support").flatMap(c => c.items.map(i => i.text));
  assert.ok(texts.length && texts.every(t => t.startsWith("EN: ")), "판정은 영어 src 로");
  assert.ok(!JSON.stringify(res.note).includes('"src"'), "노트에는 src 가 없다");
});
test("support: a low claim in a claim list is cut and the block stays; a low claim in a single required slot still holds the block", async () => {
  const { job, bus } = await setup(), svc = fakeService({
    judge: o => ({ results: o.items.map(i => ({ itemId: i.itemId, task: o.task, probs: [{ label: "yes", p: .9 }], score: o.task === "importance" ? 3 : /일정 기간을 기준으로 한 분류다|함께 기억해 두면 좋다/.test(i.text) ? .1 : .9, confidence: null, model: o.model })) }),
  });
  const res = await S.runNote(job, inputOf({ models: { plan: "m-plan", write: "m-write", judge: "m-judge" } }), depsOf(svc, bus));
  const b1 = res.note.sections.find(s => s.sectionId === "S1").blocks.find(b => b.id === "S1_B1");
  assert.ok(b1, "scope 항목 하나만 빠지고 개념 블록은 남는다");
  assert.ok(!JSON.stringify(b1).includes("일정 기간을 기준으로 한 분류다"));
  assert.ok(res.note.dropped.some(d => d.blockId === "S1_B3"), "B12 note 는 대신할 칸이 없어 블록째 보류");
  assert.deepEqual(noticeOf(res, "NOTE_CLAIMS_UNSUPPORTED"), { code: "NOTE_CLAIMS_UNSUPPORTED", count: 2, ids: null, ranges: null });
  assert.match(bus.recent().find(e => e.code === "SUPPORT_SCORES").msg, / low=2 blocks=1 trimmed=1 /);
});
// ── 동의 ──
test("consent.summary false: recognition-only result, the job pauses for the user, no service call", async () => {
  const { job, bus } = await setup();
  const boom = () => { throw new Error("서비스를 부르면 안 된다"); };
  const res = await S.runNote(job, inputOf({ gaps: GAPS, consent: { summary: false } }), { service: { plan: boom, write: boom, judge: boom }, events: bus }); // katex 도 필요 없다
  assert.equal(res.status, "recognition-only");
  assert.equal(res.note, null);
  assert.deepEqual([job.state, job.record.reason, job.record.code], ["paused", "user", "CONSENT_SUMMARY_REQUIRED"]);
  assert.deepEqual(codes(res.notices), ["NOTE_CAPTURE_GAP", "CONSENT_SUMMARY_REQUIRED"]);
  assert.deepEqual(res.counts, { slides: 6, segments: 19 }); // status:"filtered" 세그먼트는 빠진다
  assert.deepEqual(res.recognition.slides.map(s => s.slideId), ["sl-1", "sl-2", "sl-3", "sl-4", "sl-5", "sl-6"]);
  assert.ok(res.recognition.slides.every(s => s.text.length > 0));
  assert.ok(res.recognition.segments.every(s => s.text.length > 0));
  const seen = JSON.stringify(res.recognition);
  assert.ok(seen.includes("변동비")); // 인식 결과 텍스트는 그대로 보여 준다
  assert.equal(seen.includes("2026123456"), false); // 학번 워터마크는 걸러진다
  assert.deepEqual(await job.store.ids("packages"), []); // 인식 결과만 보여 주는 동안 단계 캐시도 만들지 않는다
});

// ── 작성: 잘림 ──
test("truncation: a ≥2-block section is written in two halves; a single-block section just fails", async () => {
  const { job, bus } = await setup(), svc = fakeService({
    section: o => {
      if (o.section.sectionId === "S5") throw svcErr("llm_output_truncated"); // 블록 하나라 나눌 수 없다
      if (o.section.sectionId === "S1" && o.section.blocks.length > 2) throw svcErr("llm_output_truncated");
      return pickOut(o);
    },
  });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.equal(res.status, "partial");
  const s1 = svc.calls.section.filter(c => c.section.sectionId === "S1");
  assert.deepEqual(s1.map(c => [c.withGist, c.section.blocks.map(b => b.blockId)]), [
    [true, ["S1_B1", "S1_B2", "S1_B3"]],
    [true, ["S1_B1", "S1_B2"]], // gist 는 첫 반쪽에만
    [false, ["S1_B3"]],
  ]);
  assert.deepEqual(res.note.sections.find(s => s.sectionId === "S1").blocks.map(b => b.id), ["S1_B1", "S1_B2", "S1_B3"]); // 반쪽 출력은 합쳐진다
  assert.deepEqual(res.note.sections.map(s => s.sectionId), ["S1", "S2", "S3", "S4"]); // S5 만 실패
  assert.deepEqual(noticeOf(res, "NOTE_SECTIONS_FAILED"), { code: "NOTE_SECTIONS_FAILED", count: 1, ids: ["S5"], ranges: [{ t0: 1140, t1: 1260 }] });
  assert.deepEqual(svc.calls.global[0].sections.map(s => s.sectionId), ["S1", "S2", "S3", "S4"]);
  const split = bus.recent().find(e => e.msg?.startsWith("split"));
  assert.equal(split.code, "LLM_TRUNCATED");
  assert.equal(split.unit, "S1");
});

test("timeout: a section whose request times out is split like a truncated one, so one slow section no longer pauses the job", async () => {
  const { job, bus } = await setup(), svc = fakeService({
    section: o => {
      if (o.section.sectionId === "S1" && o.section.blocks.length > 2) throw new DOMException("취소됨", "AbortError"); // 서비스 클라이언트 120초 타임아웃
      return pickOut(o);
    },
  });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.equal(job.state, "done");
  assert.deepEqual(svc.calls.section.filter(c => c.section.sectionId === "S1").map(c => c.section.blocks.length), [3, 2, 1]);
  assert.deepEqual(res.note.sections.find(s => s.sectionId === "S1").blocks.map(b => b.id), ["S1_B1", "S1_B2", "S1_B3"]);
  assert.equal(bus.recent().find(e => e.msg?.startsWith("split")).code, "WRITE_TIMEOUT");
});

test("truncation: a half that is still cut off is split again, down to single blocks; a single block that still cuts off is held (null) and the section survives", async () => {
  const { job, bus } = await setup(), svc = fakeService({
    section: o => {
      if (o.section.sectionId === "S1" && o.section.blocks.length > 1) throw svcErr("llm_output_truncated");
      return pickOut(o);
    },
  });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  const s1 = svc.calls.section.filter(c => c.section.sectionId === "S1");
  assert.deepEqual(s1.map(c => [c.withGist, c.section.blocks.map(b => b.blockId)]), [
    [true, ["S1_B1", "S1_B2", "S1_B3"]],
    [true, ["S1_B1", "S1_B2"]],
    [true, ["S1_B1"]], // gist 는 맨 앞 조각에만
    [false, ["S1_B2"]],
    [false, ["S1_B3"]],
  ]);
  assert.deepEqual(res.note.sections.find(s => s.sectionId === "S1").blocks.map(b => b.id), ["S1_B1", "S1_B2", "S1_B3"]);
  assert.equal(noticeOf(res, "NOTE_SECTIONS_FAILED"), undefined);
});

// ── 오류 ──
test("quota_exceeded during writing pauses the job instead of producing a partial note", async () => {
  const { job, bus } = await setup(), svc = fakeService({
    section: o => { if (o.section.sectionId === "S5") throw svcErr("quota_exceeded"); return DEFAULTS.section(o); },
  });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.deepEqual([job.state, job.stage, res.status, res.reason, res.code, res.note], ["paused", "writing", "paused", "quota", "QUOTA_EXCEEDED", null]);
  assert.deepEqual(res.notices, []);
});

// ── 캐시·재실행 ──
test("same input on the same store makes no new calls; rerun re-sends failed writes but never the plan", async () => {
  const { store, job, bus } = await setup(), svc = fakeService();
  const fixed = { now: () => new Date("2026-10-03T00:00:00.000Z") };
  const first = await S.runNote(job, inputOf(), depsOf(svc, bus, fixed));
  const before = svc.all().length;
  assert.ok(before > 0);
  const j2 = await P.createJob({ jobId: "j2", packageId: "pkg", store, events: bus, now: clock() });
  const second = await S.runNote(j2, inputOf(), depsOf(svc, bus, fixed));
  assert.equal(svc.all().length, before); // 같은 입력은 단계·호출 캐시에서만 나온다
  assert.equal(j2.state, "done");
  assert.deepEqual(second.note, first.note);

  // 실패한 호출만 캐시에 없다 — rerun 을 올리면 그 호출만 새 requestId 로 다시 나간다
  const b = await setup({ jobId: "k1" });
  let broken = true;
  const svcB = fakeService({ section: o => { if (broken && o.section.sectionId === "S5") throw svcErr("request_rejected"); return DEFAULTS.section(o); } });
  assert.equal((await S.runNote(b.job, inputOf(), depsOf(svcB, b.bus))).status, "partial");
  const n = svcB.all().length;
  broken = false;
  const k2 = await P.createJob({ jobId: "k2", packageId: "pkg", store: b.store, events: b.bus, now: clock() });
  const res = await S.runNote(k2, inputOf({ rerun: 1 }), depsOf(svcB, b.bus));
  assert.equal(res.status, "partial"); // S3_B4 는 여전히 빠진다
  assert.equal(svcB.all().length, n + 2); // 새 호출은 실패했던 S5 작성과 — S5 가 살아나 입력이 달라진 — 전역 글
  const extra = svcB.calls.section.at(-1);
  assert.equal(extra.section.sectionId, "S5");
  assert.notEqual(extra.requestId, svcB.calls.section.find(c => c.section.sectionId === "S5").requestId);
  assert.equal(svcB.calls.plan.length, 1); // 계획은 다시 부르지 않는다
  assert.equal(svcB.calls.global.length, 2); // 전역 입력은 생존 섹션의 주장이라 S5 가 더해지면 본문이 달라진다
  assert.deepEqual(svcB.calls.global.at(-1).sections.map(s => s.sectionId), ["S1", "S2", "S3", "S4", "S5"]);
});
// ── 전역 글 ──
test("a failing global write keeps the note without global blocks (NOTE_GLOBAL_FAILED)", async () => {
  const { job, bus } = await setup(), svc = fakeService({ global: () => { throw svcErr("request_rejected"); } });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.equal(job.state, "done"); // 전역 실패는 멈추는 오류가 아니다
  assert.deepEqual(res.note.global, []);
  assert.ok(codes(res.notices).includes("NOTE_GLOBAL_FAILED"));
  assert.equal(svc.calls.global.length, 1);
});

test("globalSections: shrinks claims per block until the byte limit fits and gives up at the floor", () => {
  const claim = t => ({ text: t, evidenceIds: ["U1.s1"], basis: "lecture" });
  const surv = [{ sectionId: "S1", title: "t", gist: null, blocks: [{ id: "S1_B1", type: "B05", envelope: { content: { c: Array.from({ length: 8 }, (_, i) => claim("x".repeat(2000))) } } }] }];
  assert.equal(S.globalSections(surv, 3000)[0].blocks[0].claims.length, 6); // 상한에 맞는 첫 묶음으로 내린다
  assert.equal(S.globalSections(surv, 1100)[0].blocks[0].claims.length, 3);
  const one = S.globalSections(surv, 450);
  assert.equal(one[0].blocks[0].claims.length, 1);
  assert.ok(one[0].blocks[0].claims[0].text.length <= 160);
  assert.equal(S.globalSections(surv, 200), null); // 아무것도 안 들어가면 전역 글을 포기한다
});

// ── 생성 옵션 ──
test("options: syntheticExamples is forwarded, the output schema accepts synthetic basis, policy is recorded", async () => {
  const s4 = deep(WRITER.sections.S4.first);
  s4.gist = { text: "가상의 사례를 요지로 띄운다", evidenceIds: [], basis: "synthetic" }; // 요지는 허용 위치가 아니다 — 스키마는 받고 코드 검사가 조용히 떨군다
  s4.blocks.S4_B2.content.items[1].premise = { text: "가상의 비교 사례다", evidenceIds: [], basis: "synthetic" }; // B14 전제는 허용 위치
  const sec4 = o => o.section.sectionId === "S4" ? { output: s4 } : DEFAULTS.section(o);
  const { job, bus } = await setup(), svc = fakeService({ section: sec4 });
  const res = await S.runNote(job, inputOf({ options: { syntheticExamples: true } }), depsOf(svc, bus));
  assert.equal(job.state, "done");
  assert.deepEqual(svc.calls.plan[0].options, { syntheticExamples: true, externalAugmentation: false });
  assert.ok(svc.calls.section.every(c => c.options.syntheticExamples === true));
  assert.equal(res.note.policy.syntheticExamples, true); // 계획이 실은 정책이 노트로 간다
  const s4n = res.note.sections.find(s => s.sectionId === "S4");
  assert.ok(s4n); // 클라이언트가 검증하는 출력 스키마가 거절하지 않는다
  assert.equal(s4n.gist, null); // 허용 위치가 아니면 요지는 조용히 떨어진다
  assert.ok(codes(res.notices).includes("NOTE_AUGMENTED")); // 남은 가상 주장은 머리에 고지

  const b = await setup({ jobId: "j2" }), svcB = fakeService({ section: sec4 });
  const resB = await S.runNote(b.job, inputOf(), depsOf(svcB, b.bus));
  assert.ok(!resB.note.sections.some(s => s.sectionId === "S4")); // 옵션 없으면 같은 출력이 스키마에서 거절된다
  assert.deepEqual(noticeOf(resB, "NOTE_SECTIONS_FAILED").ids, ["S4"]);
});

// ── 크롭 ──
test("figureData + formulaCrops: cropMap links registry ids to crop keys and decides display", async () => {
  const { job, bus } = await setup(), svc = fakeService();
  const res = await S.runNote(job, inputOf({
    figureData: { hashes: {}, ocr: {}, crops: ["sl-4/g1", "sl-5/g1"] },
    formulaCrops: ["sl-2/f1", "sl-4/f1"],
  }), depsOf(svc, bus));
  assert.equal(job.state, "done");
  assert.deepEqual(res.cropMap, { F1: "sl-2/f1", F3: "sl-4/f1", G1: "sl-4/g1", G2: "sl-5/g1" });
  // 검증 통과 LaTeX 은 크롭보다 먼저, 미검증은 크롭, 간단한 표는 다시 그리고 그래프는 크롭으로
  assert.deepEqual(Object.fromEntries(res.note.registry.map(e => [e.id, e.display])), { F1: "latex", F2: "latex", F3: "crop" });
  assert.deepEqual(Object.fromEntries(res.note.figures.map(f => [f.id, f.display])), { G1: "table", G2: "crop" });
  assert.deepEqual(noticeOf(res, "NOTE_FORMULAS_IMAGE").ids, ["F3"]); // 크롭으로 내린 참조 수식
});

// ── 내용 없는 텔레메트리 ──
test("events and notices never carry lecture or generated text", async () => {
  const { job, bus } = await setup(), svc = fakeService();
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.equal(res.status, "partial");
  const seen = JSON.stringify([bus.recent(), res.notices, await job.store.getJson("jobs", "j1")]);
  assert.ok(bus.recent().length > 20);
  for (const secret of ["학번 2026123456", "공장 임차료처럼", "생산량과 관계없이 일정 기간 동안 발생하는 비용", "기업의 경계를 설명하는 세 관점"])
    assert.equal(seen.includes(secret), false, secret);
  assert.ok(bus.recent().some(e => /^sections=\d+ failed=\d+$/.test(e.msg ?? ""))); // 코드·수치는 남는다
});

// ── 순수 함수 ──
test("gapRanges: orders by time, merges consecutive same-reason gaps, ignores broken entries", () => {
  assert.deepEqual(S.gapRanges(GAPS), [{ reason: "asr-failed", t0: 10, t1: 20 }, { reason: "user-paused", t0: 30, t1: 31 }]);
  assert.deepEqual(S.gapRanges([{ reason: "a", t0: 5 }, { reason: "b", t0: 7, t1: 9 }, { reason: "a", t0: 12, t1: 10 }, null, { reason: "a" }]),
    [{ reason: "a", t0: 5, t1: 5 }, { reason: "b", t0: 7, t1: 9 }, { reason: "a", t0: 12, t1: 12 }]);
  assert.deepEqual(S.gapRanges(undefined), []);
});

test("batches: stays within 200 items and the byte limit and keeps order", () => {
  const items = Array.from({ length: 450 }, (_, i) => ({ itemId: "U" + i, text: "가" }));
  assert.deepEqual(S.batches(items).map(b => b.length), [200, 200, 50]);
  const wide = Array.from({ length: 5 }, (_, i) => ({ itemId: "U" + i, text: "가".repeat(8000) }));
  const out = S.batches(wide);
  assert.deepEqual(out.map(b => b.length), [2, 2, 1]);
  assert.ok(out.every(b => Buffer.byteLength(JSON.stringify(b)) <= 65536));
  assert.deepEqual(out.flat(), wide);
});
test("a 409 duplicate left by a timed-out earlier attempt retries the call with the next requestId", async () => {
  const { job, bus } = await setup(), svc = fakeService({ plan: (o, i) => { if (i === 0) throw svcErr("request_already_reserved_or_processed"); return DEFAULTS.plan(o); } });
  const res = await S.runNote(job, inputOf({ gaps: GAPS }), depsOf(svc, bus));
  assert.equal(job.state, "done");
  assert.ok(["complete", "partial"].includes(res.status));
  assert.equal(svc.calls.plan.length, 2);
  assert.notEqual(svc.calls.plan[0].requestId, svc.calls.plan[1].requestId);
});
test("a planning model that cannot answer inside the free edge window falls back once to the writing model", async () => {
  const { job, bus } = await setup(), seen = [];
  bus.subscribe?.(e => seen.push(e));
  const svc = fakeService({ plan: (o, i) => { if (i === 0) throw new DOMException("timeout", "AbortError"); return DEFAULTS.plan(o); } });
  const res = await S.runNote(job, inputOf({ gaps: GAPS }), depsOf(svc, bus));
  assert.ok(["complete", "partial"].includes(res.status));
  assert.deepEqual(svc.calls.plan.map(c => [c.model, c.timeoutMs]), [["m-plan", 100000], ["m-write", 140000]]);
});
test("a user cancel during planning does not fall back", async () => {
  const { job, bus } = await setup(), ctl = new AbortController();
  const svc = fakeService({ plan: () => { ctl.abort(); throw new DOMException("cancel", "AbortError"); } });
  await S.runNote(job, inputOf({ gaps: GAPS }), depsOf(svc, bus, { signal: ctl.signal })).catch(() => {});
  assert.equal(svc.calls.plan.length, 1);
});
test("a second run after a failed plan sends new requestIds instead of the ones the first run left reserved", async () => {
  const { job, bus } = await setup();
  const fail = fakeService({ plan: () => { throw svcErr("provider_failed_or_invalid_output"); } });
  await S.runNote(job, inputOf({ gaps: GAPS }), depsOf(fail, bus)).catch(() => {});
  const ok = fakeService();
  const { job: job2 } = await setup({ jobId: "j2", store: job.store });
  await S.runNote(job2, inputOf({ gaps: GAPS }), depsOf(ok, bus));
  const first = new Set(fail.calls.plan.map(c => c.requestId));
  assert.ok(ok.calls.plan.every(c => !first.has(c.requestId)));
});
// ── 계획 보정 ──
test("a schema-valid plan that breaks a semantic rule is repaired and the run proceeds (PLAN_REPAIRED)", async () => {
  const { job, bus } = await setup();
  const plan = deep(PLANNER);
  plan.sections[4].blocks[0].formulaIds = ["F1"]; // S5(U6)는 F1 을 갖지 않는다 — 떼면 픽스처 계획과 같아진다
  const svc = fakeService({ plan: () => ({ plan }) });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.equal(job.state, "done");
  assert.equal(res.status, "partial"); // S3_B4 는 정상 경로처럼 빠진다
  const rep = bus.recent().find(e => e.code === "PLAN_REPAIRED");
  assert.ok(rep, "PLAN_REPAIRED 이벤트");
  assert.equal(rep.stage, "planning");
  assert.equal(rep.level, "warn");
  assert.ok((rep.msg ?? "").includes("ref-drop:S5:F1"), rep.msg);
  assert.deepEqual([svc.calls.plan.length, svc.calls.section.length, svc.calls.global.length], [1, 5, 1]);
});
test("an unrepairable plan is logged with its VAL_PLAN_INVALID detail and is not cached", async () => {
  const { store, job, bus } = await setup();
  const plan = deep(PLANNER);
  plan.sections[0].blocks = [{ ...plan.sections[0].blocks[0], type: "B12", conceptIds: [] }]; // 곁설명 하나뿐인 섹션 — 붙을 앞 블록이 없어 코드가 못 고친다
  const svc = fakeService({ plan: () => ({ plan }) });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.equal(res.status, "failed");
  assert.equal(res.code, "VAL_PLAN_INVALID");
  assert.equal(svc.calls.plan.length, 1);
  const err = bus.recent().find(e => e.code === "VAL_PLAN_INVALID" && e.stage === "planning");
  assert.ok(err, "VAL_PLAN_INVALID 이벤트");
  assert.equal(err.level, "error");
  assert.ok((err.msg ?? "").includes("side:S1_B1"), err.msg);
  // 실패한 계획은 캐시에 남지 않는다 — 유효한 계획을 주는 두 번째 실행은 계획을 다시 부른다
  const ok = fakeService();
  const j2 = await P.createJob({ jobId: "j2", packageId: "pkg", store, events: bus, now: clock() });
  const res2 = await S.runNote(j2, inputOf(), depsOf(ok, bus));
  assert.equal(ok.calls.plan.length, 1);
  assert.equal(j2.state, "done");
  assert.equal(res2.status, "partial");
});
test("a section whose writer output keeps failing (provider_failed_or_invalid_output, retryable) drops only that section — the job does not pause as LLM_UNAVAILABLE", async () => {
  const { job, bus } = await setup();
  const svc = fakeService({ section: (o, i) => o.section.sectionId === "S2" ? (() => { throw svcErr("provider_failed_or_invalid_output", { retryable: true }); })() : DEFAULTS.section(o, i) });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.equal(job.state, "done");
  assert.equal(res.status, "partial");
  assert.ok(svc.calls.section.filter(c => c.section.sectionId === "S2").length >= 1);
});

test("a block the server nulled for a format error (salvaged) is sent to repair with its original envelope; a writer null is not; hold sources are logged", async () => {
  const { job, bus } = await setup();
  let target = null;
  const svc = fakeService({
    section: o => {
      const r = pickOut(o);
      if (o.section.sectionId !== "S2") return r;
      target = Object.keys(r.output.blocks).find(k => r.output.blocks[k]);
      const original = r.output.blocks[target];
      r.output.blocks[target] = null;
      return { ...r, salvaged: { [target]: original, S9_B9: { x: 1 } } }; // 계획에 없는 id 는 버린다
    },
    repair: o => ({ output: { blocks: Object.fromEntries(o.repair.map(x => [x.blockId, x.previous])) } }),
  });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  const sent = svc.calls.repair.flatMap(c => c.repair).find(x => x.blockId === target);
  assert.ok(sent, "서버가 비운 블록을 repair 로 보낸다");
  assert.deepEqual(sent.errors, [{ code: "VAL_SCHEMA", detail: ["format"] }]);
  assert.ok(sent.previous && typeof sent.previous === "object");
  assert.ok(res.note.sections.find(s => s.sectionId === "S2").blocks.some(b => b.id === target), "고친 블록이 노트에 남는다");
  const held = bus.recent().find(e => e.code === "BLOCKS_HELD");
  assert.match(held.msg, /server=1/);
  assert.match(bus.recent().find(e => e.code === "REPAIR_RESULT" && e.unit === "S2").msg, /^fixed=\d+ null=0 held_null=0 still_bad=\d+$/);
});
