const test = require("node:test");
const assert = require("node:assert/strict");
const katex = require("./vendor/katex/katex.min.js");
const P = require("./pipeline.js");
const S = require("./stages.js");
const NoteSpec = require("./note-spec.js");
const Contracts = require("./contracts.js");
const Prompts = require("../server/prompts.js");
const { createStore, memoryAdapter } = require("./package-store.js");
const { EventBus } = require("./events.js");

// 합성 강의. 표식 문자열은 강의·생성 내용을 대신한다 — 이벤트와 알림 어디에도 나오면 안 된다.
const MARK = "강의본문표식", GEN = "생성문장표식";
const clock = (t = 1000) => () => t++;
const svcErr = (code, extra) => Object.assign(new Error(code), { code, retryable: false, retryAfterMs: null }, extra);
const abortErr = () => new DOMException("취소됨", "AbortError");
const uniq = list => [...new Set(list)];
// 서로 다른 두 음절 낱말(i < 4000). 반복 텍스트 판정·접기에 걸리지 않는 합성 본문용이다.
const word = i => String.fromCharCode(0xAC00 + (i % 2000), 0xAC00 + 2000 + Math.floor(i / 2000));

// 노트 양식은 note-spec.js 가 정한다. 테스트도 블록 필드 이름을 쓰지 않고 스키마에서 채운다(evidenceIds 만 계약이다).
const fill = (s, text) => s.enum ? s.enum[0] : s.type === "string" ? text : s.type === "array" ? [] : s.type === "object" ? Object.fromEntries(Object.entries(s.properties).map(([k, p]) => [k, fill(p, text)])) : 0;
// long 은 길이 상한이 가장 큰 문자열 칸에만 들어간다(원문 재현 테스트용). 칸 이름은 양식이 정한다.
const roomiest = Object.entries(NoteSpec.blockSchema.properties).filter(([, p]) => p.type === "string" && !p.enum).sort((a, z) => z[1].maxLength - a[1].maxLength)[0][0];
const blockOf = (ids, text = GEN, long = text) => ({ ...fill(NoteSpec.blockSchema, text), [roomiest]: long, evidenceIds: ids });
const planBlock = fill(NoteSpec.planSectionSchema.properties.blocks.items, "계획");
const section = (n, unitIds, blocks = 1) => ({ sectionId: `S${n}`, title: `섹션${n}`, unitIds, blocks: Array(blocks).fill(planBlock) });
const planOf = (units, per = 2) => ({ sections: Array.from({ length: Math.ceil(units.length / per) }, (_, i) => section(i + 1, units.slice(i * per, (i + 1) * per).map(u => u.unitId))) });
const ids = o => o.units.map(u => u.unitId);
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));
const allIds = o => o.ir.units.map(u => u.unitId);

const box = (y) => ({ x: .1, y, w: .8, h: .08 });
const slide = (i, formulas = [], text = `${word(i)} 개념 설명`) => ({
  schemaVersion: 1, slideId: `s${i}`, t0: i * 60, t1: i * 60 + 60, engine: "test", model: null, formulas, figures: [],
  blocks: [{ id: `s${i}-t`, text: `${i === 0 ? MARK : ""}${word(i + 500)} 제목`, role: "title", bbox: box(.1), conf: .9 }, { id: `s${i}-b`, text, role: "body", bbox: box(.3), conf: .9 }],
});
const seg = (i, text) => ({ id: `g${i}`, t0: i * 60 + 5, t1: i * 60 + 55, text, words: [], noSpeechProb: null, avgLogprob: null, compressionRatio: null, status: "kept" });
const formula = (id, latex, text, y) => ({ id, latex, text, bbox: { x: .1, y, w: .3, h: .1 }, conf: .9, status: "unverified" });
const FORMULAS = [formula("f1", "E = mc^2", "E = mc^2", .5), formula("f2", "\\frac{", "1/2", .6), formula("f3", null, "x+y", .7)];
const lecture = (n = 4, speechOf = i => `${MARK} ${word(i + 900)} ${word(i + 901)} 발화`) => ({
  slides: Array.from({ length: n }, (_, i) => slide(i, i === 1 ? FORMULAS : [])),
  transcript: { schemaVersion: 1, engine: "test", model: null, lang: "ko", segments: Array.from({ length: n }, (_, i) => seg(i, speechOf(i))) },
});
const GAPS = [{ reason: "asr-failed", t0: 14, t1: 20 }, { reason: "asr-failed", t0: 10, t1: 12 }, { reason: "user-paused", t0: 30, t1: 31 }];
const inputOf = (over = {}) => ({ ...lecture(), gaps: [], tier: "free", models: { plan: "m-plan", write: "m-write", judge: "m-judge" }, consent: { summary: true }, ...over });

// 서버 계약(server/prompts.js 요청 스키마·/v1/judge 상한)을 가짜 서비스가 그대로 지킨다 — 요청 모양이 어긋나면 여기서 실패한다.
const ENVELOPE = new Set(["model", "requestId", "noteSpecVersion", "stage", "signal"]);
function assertRequest(o) {
  const stage = o.stage ?? "plan";
  const r = Contracts.validate(Prompts.REQUEST[stage], Object.fromEntries(Object.entries(o).filter(([k]) => !ENVELOPE.has(k))));
  assert.ok(r.ok, stage + " " + JSON.stringify(r.errors));
  assert.match(o.requestId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
  assert.equal(o.noteSpecVersion, NoteSpec.NOTE_SPEC_VERSION);
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
const DEFAULTS = {
  plan: o => ({ plan: planOf(o.ir.units) }),
  section: o => ({ blocks: chunks(ids(o), NoteSpec.limits.maxEvidenceIds).map(c => blockOf(c)) }),
  repair: o => ({ blocks: o.repair.map(() => blockOf(ids(o), GEN + "수정")) }),
  global: o => ({ blocks: [blockOf(uniq(o.sections.flatMap(s => s.blocks.flatMap(b => b.evidenceIds))).slice(0, 1))] }),
  judge: o => ({ results: o.items.map(i => ({ itemId: i.itemId, task: o.task, probs: [], score: o.task === "importance" ? 3.5 : .9, model: o.model })) }),
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
const codes = notices => notices.map(n => n.code);
const noticeOf = (res, code) => res.notices.find(n => n.code === code);

// ── 정상 경로 ──
test("free: runs every stage end to end without calling the judge", async () => {
  const { job, bus } = await setup(), svc = fakeService();
  const res = await S.runNote(job, inputOf({ gaps: GAPS }), depsOf(svc, bus));
  assert.equal(job.state, "done");
  assert.equal(res.status, "complete");
  assert.deepEqual([svc.calls.judge.length, svc.calls.plan.length, svc.calls.section.length, svc.calls.repair.length, svc.calls.global.length], [0, 1, 2, 0, 1]);
  const { note } = res;
  assert.equal(note.noteSpecVersion, NoteSpec.NOTE_SPEC_VERSION);
  assert.deepEqual(note.sections.map(s => [s.sectionId, s.title, s.blocks.length]), [["S1", "섹션1", 1], ["S2", "섹션2", 1]]);
  assert.deepEqual(note.plan, planOf(svc.calls.plan[0].ir.units));
  assert.equal(note.global.length, 1);
  assert.deepEqual(note.notices, res.notices);
  assert.equal(res.rendered, null); // 렌더러가 없으면 건너뛴다

  // 수식: 검증 통과 / 문법 오류 → 원본 크롭 / LaTeX 없음 → 미검증
  assert.deepEqual(note.registry.map(e => [e.id, e.status]), [["F1", "verified"], ["F2", "image"], ["F3", "unverified"]]);
  assert.deepEqual(noticeOf(res, "NOTE_FORMULAS_UNVERIFIED"), { code: "NOTE_FORMULAS_UNVERIFIED", count: 1, ids: ["F3"] });
  assert.deepEqual(noticeOf(res, "NOTE_FORMULAS_IMAGE"), { code: "NOTE_FORMULAS_IMAGE", count: 1, ids: ["F2"] });
  // 공백 구간: summary.js gapRanges 처럼 시각 순으로 세워 같은 이유를 합친다
  assert.deepEqual(noticeOf(res, "NOTE_CAPTURE_GAP"), { code: "NOTE_CAPTURE_GAP", count: 2, ranges: [{ reason: "asr-failed", t0: 10, t1: 20 }, { reason: "user-paused", t0: 30, t1: 31 }] });
  assert.ok(codes(res.notices).includes("NOTE_JUDGE_SKIPPED"));
  assert.ok(!codes(res.notices).includes("NOTE_UNITS_UNCITED"));

  // 요청 모양: 계획은 유닛과 {id,status}, 작성기에는 {id,latex,status} 만, 수식은 나온 섹션에만
  const plan = svc.calls.plan[0];
  assert.equal(plan.ir.units.length, 4);
  assert.ok(plan.ir.units.every(u => u.judge.importance === null));
  assert.deepEqual(plan.formulas, [{ id: "F1", status: "verified" }, { id: "F2", status: "image" }, { id: "F3", status: "unverified" }]);
  const s1 = svc.calls.section.find(c => c.section.sectionId === "S1"), s2 = svc.calls.section.find(c => c.section.sectionId === "S2");
  assert.deepEqual(s1.registry, [{ id: "F1", latex: "E = mc^2", status: "verified" }, { id: "F2", latex: "\\frac{", status: "image" }, { id: "F3", latex: null, status: "unverified" }]);
  assert.deepEqual(s2.registry, []);
  assert.deepEqual(s1.units.map(u => u.unitId), ["U1", "U2"]);

  // 판정은 호출 없는 빈 단계로 지나가고, 섹션마다 작성 스팬이 남는다
  assert.ok(bus.recent().some(e => e.stage === "judging" && e.status === "done"));
  assert.deepEqual(bus.recent().filter(e => e.stage === "write" && e.status === "done").map(e => e.unit).sort(), ["0", "1"]);

  // 상태 기계: created 에서 시작해도 ingesting 부터 done 까지 한 칸씩
  const life = bus.recent().filter(e => e.stage === "job").map(e => e.msg);
  assert.deepEqual(life, ["created", ...P.STATES.slice(1).map((s, i) => `${P.STATES[i]}>${s}`)]);
});

test("paid: judges unit importance in batches of at most 200 items and stores the score", async () => {
  const { job, bus } = await setup(), svc = fakeService({
    judge: o => ({ results: o.items.map(i => ({ itemId: i.itemId, task: o.task, probs: [], model: o.model, score: o.task === "support" ? .9 : i.itemId === "U3" ? null : { U1: 5.0000001, U2: .2 }[i.itemId] ?? 4 })) }),
    plan: o => ({ plan: planOf(o.ir.units, 60) }),
  });
  const res = await S.runNote(job, inputOf({ ...lecture(450), tier: "paid" }), depsOf(svc, bus));
  assert.equal(res.status, "complete", res.code);
  const importance = svc.calls.judge.filter(c => c.task === "importance");
  assert.deepEqual(importance.map(c => c.items.length).sort((a, b) => b - a), [200, 200, 50]);
  assert.ok(importance.every(c => c.model === "m-judge"));
  assert.ok(!codes(res.notices).includes("NOTE_JUDGE_SKIPPED"));
  // 계약 범위(1~5)로 누르고, 점수 없음은 null 로 둔다 — 계획과 작성 요청이 같은 점수를 본다
  const units = svc.calls.plan[0].ir.units;
  assert.equal(units.length, 450);
  assert.deepEqual(units.slice(0, 4).map(u => u.judge.importance), [5, 1, null, 4]);
  assert.equal(svc.calls.section.find(c => c.section.sectionId === "S1").units[0].judge.importance, 5);
  // 근거 지지(T5)도 유료에서만 부른다: 섹션마다 한 번 + 전체 글
  assert.equal(svc.calls.judge.filter(c => c.task === "support").length, 9);
});

test("paid: judge batches also respect the 64 KiB items limit (Korean is 3 bytes per char)", async () => {
  const { job, bus } = await setup(), svc = fakeService();
  const big = lecture(3, i => Array.from({ length: 1700 }, (_, k) => word(k + i * 1700) + word(k + 4000 + i * 1700)).join(" "));
  const res = await S.runNote(job, inputOf({ ...big, tier: "paid" }), depsOf(svc, bus));
  assert.equal(res.status, "complete");
  // 판정 묶음은 lane 2개로 동시에 나가 기록 순서가 매번 다르다 — 크기만 본다.
  assert.deepEqual(svc.calls.judge.filter(c => c.task === "importance").map(c => c.items.length).sort(), [1, 2]);
});

// ── 작성: 잘림 ──
test("truncation: the section is split in half, each half is written once and the blocks are concatenated", async () => {
  const { job, bus } = await setup(), svc = fakeService({
    plan: o => ({ plan: { sections: [section(1, allIds(o), 2)] } }),
    section: o => { if (o.units.length > 2) throw svcErr("llm_output_truncated"); return { blocks: [blockOf(ids(o))] }; },
  });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.equal(res.status, "complete");
  assert.deepEqual(svc.calls.section.map(c => c.units.map(u => u.unitId)), [["U1", "U2", "U3", "U4"], ["U1", "U2"], ["U3", "U4"]]);
  // 출력 크기는 블록 계획이 정하므로 블록 계획도 같이 나뉜다
  assert.deepEqual(svc.calls.section.map(c => c.section.blocks.length), [2, 1, 1]);
  assert.deepEqual(res.note.sections[0].blocks.map(b => b.evidenceIds), [["U1", "U2"], ["U3", "U4"]]);
  const split = bus.recent().find(e => e.msg === "split");
  assert.equal(split.code, "LLM_TRUNCATED");
  assert.equal(split.unit, "S1");
});

test("truncation: a half that still truncates fails the section, not the note", async () => {
  const { job, bus } = await setup(), svc = fakeService({
    plan: o => ({ plan: { sections: [section(1, allIds(o).slice(0, 4)), section(2, allIds(o).slice(4))] } }),
    section: o => { if (o.units.length > 1) throw svcErr("llm_output_truncated"); return { blocks: [blockOf(ids(o))] }; },
  });
  const res = await S.runNote(job, inputOf(lecture(5)), depsOf(svc, bus));
  assert.equal(job.state, "done");
  assert.equal(res.status, "partial");
  // S1: 전체 한 번 + 앞 반 한 번(뒤 반은 시도하지 않는다), S2: 한 번
  assert.deepEqual(svc.calls.section.filter(c => c.section.sectionId === "S1").map(c => c.units.length), [4, 2]);
  assert.equal(svc.calls.section.filter(c => c.section.sectionId === "S2").length, 1);
  assert.deepEqual(res.note.sections.map(s => s.sectionId), ["S2"]);
  assert.deepEqual(noticeOf(res, "NOTE_SECTIONS_FAILED"), { code: "NOTE_SECTIONS_FAILED", count: 1, ids: ["S1"], ranges: [{ t0: 0, t1: 240 }] });
  assert.deepEqual(svc.calls.global[0].sections.map(s => s.sectionId), ["S2"]);
});

test("an oversized section request (request_too_large) is split the same way", async () => {
  const { job, bus } = await setup(), svc = fakeService({
    section: o => { if (o.units.length > 1) throw svcErr("request_too_large"); return DEFAULTS.section(o); },
  });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.equal(res.status, "complete");
  for (const id of ["S1", "S2"]) assert.deepEqual(svc.calls.section.filter(c => c.section.sectionId === id).map(c => c.units.length), [2, 1, 1]);
  assert.equal(bus.recent().find(e => e.msg === "split").code, "LLM_REQUEST_TOO_LARGE");
});

// ── 검증 ──
const withBadBlock = extra => ({
  section: o => o.section.sectionId === "S1" ? { blocks: [blockOf(["U1", "U2"]), blockOf(["U999"], GEN + "나쁨")] } : DEFAULTS.section(o),
  ...extra,
});

test("repair: a failing block gets one repair call and is replaced", async () => {
  const { job, bus } = await setup(), svc = fakeService(withBadBlock());
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.equal(res.status, "complete");
  assert.equal(svc.calls.repair.length, 1);
  const [r] = svc.calls.repair[0].repair;
  assert.deepEqual([r.index, r.block.evidenceIds, r.errors.map(e => [e.code, e.detail])], [1, ["U999"], [["VAL_EVIDENCE_UNKNOWN", "U999"]]]);
  assert.deepEqual(res.note.sections[0].blocks.map(b => b.evidenceIds), [["U1", "U2"], ["U1", "U2"]]);
  assert.ok(!codes(res.notices).includes("NOTE_BLOCKS_DROPPED"));
});

test("repair: a block that still fails is dropped and counted in a notice", async () => {
  const { job, bus } = await setup(), svc = fakeService(withBadBlock({ repair: o => ({ blocks: o.repair.map(() => blockOf(["U999"])) }) }));
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.equal(res.status, "complete");
  assert.equal(svc.calls.repair.length, 1); // 재생성은 한 번뿐
  assert.deepEqual(res.note.sections[0].blocks.map(b => b.evidenceIds), [["U1", "U2"]]);
  assert.deepEqual(noticeOf(res, "NOTE_BLOCKS_DROPPED"), { code: "NOTE_BLOCKS_DROPPED", count: 1 });
});

test("repair: a failed repair call drops the failing blocks; a quota error halts the job instead", async () => {
  const a = await setup(), svcA = fakeService(withBadBlock({ repair: () => { throw svcErr("request_rejected"); } }));
  const resA = await S.runNote(a.job, inputOf(), depsOf(svcA, a.bus));
  assert.equal(resA.status, "complete");
  assert.equal(noticeOf(resA, "NOTE_BLOCKS_DROPPED").count, 1);

  const b = await setup(), svcB = fakeService(withBadBlock({ repair: () => { throw svcErr("quota_exceeded"); } }));
  const resB = await S.runNote(b.job, inputOf(), depsOf(svcB, b.bus));
  assert.deepEqual([resB.status, resB.reason, resB.code, resB.note], ["paused", "quota", "QUOTA_EXCEEDED", null]);
});

test("non-substitutive: a block that copies the lecture text is sent to repair and dropped if it still copies", async () => {
  const long = lecture(4, i => Array.from({ length: 100 }, (_, k) => word(k + i * 100)).join(" "));
  const { job, bus } = await setup(), svc = fakeService({
    section: o => ({ blocks: [blockOf(ids(o)), blockOf(ids(o), GEN, o.units[0].speech)] }),
    repair: o => ({ blocks: o.repair.map(() => blockOf(ids(o), GEN, o.units[0].speech)) }),
  });
  const res = await S.runNote(job, inputOf(long), depsOf(svc, bus));
  assert.deepEqual(svc.calls.repair[0].repair[0].errors.map(e => e.code), ["VAL_VERBATIM"]);
  assert.equal(svc.calls.repair.length, 2); // 섹션마다 한 번
  assert.equal(noticeOf(res, "NOTE_BLOCKS_DROPPED").count, 2);
  assert.ok(res.note.sections.every(s => s.blocks.length === 1));
});

test("paid: low-support blocks are dropped with a notice, a missing score is kept", async () => {
  const text = o => o.items.map(i => i.text);
  const { job, bus } = await setup(), svc = fakeService({
    section: o => o.section.sectionId === "S1"
      ? { blocks: [blockOf(["U1"], "높은지지"), blockOf(["U2"], "낮은지지")] }
      : { blocks: [blockOf(["U3"], "점수없음"), blockOf(["U4"], "높은지지")] },
    judge: o => ({ results: o.items.map(i => ({ itemId: i.itemId, task: o.task, probs: [], model: o.model, score: o.task === "importance" ? 3 : i.text.includes("낮은지지") ? .1 : i.text.includes("점수없음") ? null : .9 })) }),
  });
  const res = await S.runNote(job, inputOf({ tier: "paid" }), depsOf(svc, bus));
  assert.equal(res.status, "complete");
  assert.deepEqual(res.note.sections.map(s => s.blocks.map(b => b.evidenceIds)), [[["U1"]], [["U3"], ["U4"]]]);
  assert.deepEqual(noticeOf(res, "NOTE_BLOCKS_DROPPED"), { code: "NOTE_BLOCKS_DROPPED", count: 1 });
  assert.ok(svc.calls.judge.some(c => c.task === "support" && text(c).length));
});

test("uncited units are reported with ids and time ranges; collapsed coverage fails the section like v1", async () => {
  const { job, bus } = await setup(), svc = fakeService({
    plan: o => ({ plan: { sections: [section(1, allIds(o).slice(0, 4)), section(2, allIds(o).slice(4))] } }),
    section: o => o.section.sectionId === "S1" ? { blocks: [blockOf(["U1", "U2", "U3"])] } : { blocks: [blockOf(["U5"])] },
  });
  const res = await S.runNote(job, inputOf(lecture(6)), depsOf(svc, bus));
  // S1 은 4개 중 3개를 인용(≥ 50%)하므로 남고 U4 가 미인용이다. S2 는 2개 중 1개(= 50%)라 남고 U6 이 미인용이다.
  assert.equal(res.status, "complete");
  assert.deepEqual(noticeOf(res, "NOTE_UNITS_UNCITED"), { code: "NOTE_UNITS_UNCITED", count: 2, ids: ["U4", "U6"], ranges: [{ t0: 180, t1: 240 }, { t0: 300, t1: 355 }] });

  const b = await setup(), svcB = fakeService({
    plan: o => ({ plan: { sections: [section(1, allIds(o).slice(0, 4)), section(2, allIds(o).slice(4))] } }),
    section: o => o.section.sectionId === "S1" ? { blocks: [blockOf(["U1"])] } : { blocks: [blockOf(["U5", "U6"])] },
  });
  const resB = await S.runNote(b.job, inputOf(lecture(6)), depsOf(svcB, b.bus));
  assert.equal(resB.status, "partial");
  assert.deepEqual(noticeOf(resB, "NOTE_SECTIONS_FAILED").ids, ["S1"]);
});

test("one failed section keeps the rest of the note and adds a notice", async () => {
  const { job, bus } = await setup(), svc = fakeService({
    section: o => { if (o.section.sectionId === "S2") throw svcErr("request_rejected"); return DEFAULTS.section(o); },
  });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.equal(job.state, "done");
  assert.equal(res.status, "partial");
  assert.deepEqual(res.note.sections.map(s => s.sectionId), ["S1"]);
  assert.deepEqual(noticeOf(res, "NOTE_SECTIONS_FAILED"), { code: "NOTE_SECTIONS_FAILED", count: 1, ids: ["S2"], ranges: [{ t0: 120, t1: 235 }] });
  assert.deepEqual(svc.calls.global[0].sections.map(s => s.sectionId), ["S1"]); // 전체 글은 남은 섹션 위에서
  assert.ok(!codes(res.notices).includes("NOTE_UNITS_UNCITED")); // 실패 섹션의 유닛은 미인용이 아니라 실패 구간이다
  const failed = bus.recent().find(e => e.stage === "write" && e.status === "failed");
  assert.equal(failed.code, "REQUEST_REJECTED");
});

test("retries are exhausted and the circuit opens: the job pauses and asks instead of writing a partial note", async () => {
  const { job, bus } = await setup(), svc = fakeService({ section: () => { throw svcErr("provider_busy", { retryable: true }); } });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.deepEqual([res.status, res.reason, job.state, job.stage], ["paused", "network", "paused", "writing"]);
  assert.ok(["LLM_UNAVAILABLE", "LLM_CIRCUIT_OPEN"].includes(res.code), res.code);
  assert.equal(res.note, null);
});

test("every section failing is a coded failure, not an empty note", async () => {
  const { job, bus } = await setup(), svc = fakeService({ section: () => { throw svcErr("request_rejected"); } });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.deepEqual([job.state, res.status, res.code, res.note], ["failed", "failed", "LLM_REQUEST_REJECTED", null]);
});

test("a quota error pauses the job; resuming reuses the sections already paid for (no 409 re-sends)", async () => {
  const { job, bus } = await setup();
  let quota = true;
  const svc = fakeService({ section: o => { if (quota && o.section.sectionId === "S2") throw svcErr("quota_exceeded"); return DEFAULTS.section(o); } });
  const first = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.deepEqual([first.status, first.reason, first.code, job.state, job.stage], ["paused", "quota", "QUOTA_EXCEEDED", "paused", "writing"]);
  quota = false;
  await job.resume();
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.equal(res.status, "complete");
  assert.equal(job.state, "done");
  assert.deepEqual(svc.calls.section.map(c => c.section.sectionId).sort(), ["S1", "S2", "S2"]); // S1 은 다시 부르지 않는다(섹션은 lane 으로 동시에 나가 순서는 보지 않는다)
  assert.equal(svc.calls.plan.length, 1);
});

test("rerun: a partial note stays cached for the same input; a new rerun number retries only the failed section", async () => {
  const { store, job, bus } = await setup();
  let broken = true;
  const svc = fakeService({ section: o => { if (broken && o.section.sectionId === "S2") throw svcErr("request_rejected"); return DEFAULTS.section(o); } });
  assert.equal((await S.runNote(job, inputOf(), depsOf(svc, bus))).status, "partial");
  broken = false;
  const sections = () => svc.calls.section.map(c => c.section.sectionId).sort(); // 섹션은 동시에 나가 기록 순서가 매번 다르다

  const j2 = await P.createJob({ jobId: "j2", packageId: "pkg", store, events: bus });
  assert.equal((await S.runNote(j2, inputOf(), depsOf(svc, bus))).status, "partial"); // 같은 입력은 캐시된 결과 그대로
  assert.deepEqual(sections(), ["S1", "S2"]);

  const j3 = await P.createJob({ jobId: "j3", packageId: "pkg", store, events: bus });
  const res = await S.runNote(j3, inputOf({ rerun: 1 }), depsOf(svc, bus));
  assert.equal(res.status, "complete");
  assert.deepEqual(sections(), ["S1", "S2", "S2"]); // 성공한 S1 은 다시 보내지 않고 실패한 S2 만 새 requestId 로
  assert.equal(svc.calls.plan.length, 1);
  assert.equal(res.note.sections.length, 2);
});

// ── 계획 ──
test("a bad plan fails the job with a coded error before any section is written", async () => {
  const bads = {
    unknown: p => (p.sections[0].unitIds[0] = "U9", p),
    missing: p => (p.sections[1].unitIds.pop(), p),
    duplicate: p => (p.sections[1].unitIds.push("U1"), p),
    empty: p => (p.sections.push(section(3, [])), p),
  };
  for (const [name, mutate] of Object.entries(bads)) {
    const { job, bus } = await setup(), svc = fakeService({ plan: o => ({ plan: mutate(planOf(o.ir.units)) }) });
    const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
    assert.deepEqual([job.state, job.record.code, res.status, res.code, res.note], ["failed", "VAL_PLAN_INVALID", "failed", "VAL_PLAN_INVALID", null], name);
    assert.equal(svc.calls.section.length, 0, name);
  }
  assert.throws(() => S.checkPlan({ sections: [section(1, ["U1"]), section(1, ["U2"])] }, [{ unitId: "U1" }, { unitId: "U2" }]), { code: "VAL_PLAN_INVALID" });
});

test("a plan or block response that breaks the contract is rejected at the trust boundary", async () => {
  const { job, bus } = await setup(), svc = fakeService({ plan: () => ({ plan: { sections: "nope" } }) });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.deepEqual([res.status, res.code], ["failed", "VAL_OUTPUT_INVALID"]);
  const b = await setup(), svcB = fakeService({ section: () => ({ blocks: [{ evidenceIds: ["U1"] }] }) });
  const resB = await S.runNote(b.job, inputOf(), depsOf(svcB, b.bus));
  assert.deepEqual([resB.status, resB.code], ["failed", "VAL_OUTPUT_INVALID"]);
});

test("a judge failure for a paid job halts it instead of silently skipping the judge", async () => {
  const { job, bus } = await setup(), svc = fakeService({ judge: () => { throw svcErr("feature_not_in_account_plan"); } });
  const res = await S.runNote(job, inputOf({ tier: "paid" }), depsOf(svc, bus));
  assert.deepEqual([job.state, res.code, svc.calls.plan.length], ["failed", "JDG_FEATURE_NOT_IN_ACCOUNT_PLAN", 0]);
});

// ── 동의 ──
test("consent denied: no service call, a recognition-only result, and the job waits for the user", async () => {
  const { job, bus } = await setup();
  const boom = () => { throw new Error("서비스를 부르면 안 된다"); };
  const service = { plan: boom, write: boom, judge: boom };
  for (const consent of [{ summary: false }, {}, undefined]) {
    const j = consent === undefined ? await P.createJob({ jobId: "x", store: job.store, events: bus }) : job;
    const res = await S.runNote(j, inputOf({ gaps: GAPS, consent }), { service, events: bus }); // katex 도 필요 없다
    assert.equal(res.status, "recognition-only");
    assert.equal(res.note, null);
    assert.deepEqual(codes(res.notices), ["NOTE_CAPTURE_GAP", "CONSENT_SUMMARY_REQUIRED"]);
    assert.deepEqual(res.counts, { slides: 4, segments: 4 });
    assert.deepEqual([j.state, j.record.reason, j.record.code], ["paused", "user", "CONSENT_SUMMARY_REQUIRED"]);
  }
  assert.deepEqual(await job.store.ids("packages"), []); // 인식 결과만 보여 주는 동안 단계 캐시도 만들지 않는다
  // 동의하면 같은 작업을 이어서 끝낼 수 있다
  const svc = fakeService();
  await job.resume();
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.deepEqual([res.status, job.state], ["complete", "done"]);
});

test("missing dependencies are a programmer error, not a silent downgrade", async () => {
  const { job } = await setup(), svc = fakeService();
  await assert.rejects(S.runNote(job, inputOf(), { service: svc }), TypeError); // katex 없음
  await assert.rejects(S.runNote(job, inputOf({ models: { plan: "m" } }), { service: svc, katex }), TypeError); // 작성 모델 없음
  assert.equal(svc.all().length, 0);
});

// ── 캐시·재시도·취소 ──
test("rerun with the same input reuses every stage from the cache", async () => {
  const { store, job, bus } = await setup(), svc = fakeService();
  const first = await S.runNote(job, inputOf(), depsOf(svc, bus));
  const before = svc.all().length;
  assert.ok(before > 0);

  const j2 = await P.createJob({ jobId: "j2", packageId: "pkg", store, events: bus, now: clock() });
  const second = await S.runNote(j2, inputOf(), depsOf(svc, bus));
  assert.equal(svc.all().length, before);
  assert.equal(j2.state, "done");
  assert.deepEqual(second.note, first.note);
  const skips = bus.recent().filter(e => e.jobId === "j2" && e.status === "skipped" && e.msg === "cache");
  assert.equal(skips.length, 6);

  // 입력이 바뀌면 바뀐 단계부터 다시 돈다
  const j3 = await P.createJob({ jobId: "j3", packageId: "pkg", store, events: bus, now: clock() });
  const changed = lecture();
  changed.transcript.segments[3].text += " 추가 발화";
  await S.runNote(j3, inputOf(changed), depsOf(svc, bus));
  assert.equal(svc.calls.plan.length, 2);
});

test("render hook: runs once for the same note and again when its version changes", async () => {
  const { store, job, bus } = await setup(), svc = fakeService();
  let renders = 0;
  const render = Object.assign(note => (renders++, `<html>${note.sections.length}</html>`), { version: "r1" });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus, { render }));
  assert.deepEqual([res.rendered, renders], ["<html>2</html>", 1]);
  const j2 = await P.createJob({ jobId: "j2", packageId: "pkg", store, events: bus });
  assert.equal((await S.runNote(j2, inputOf(), depsOf(svc, bus, { render }))).rendered, "<html>2</html>");
  assert.equal(renders, 1);
  const j3 = await P.createJob({ jobId: "j3", packageId: "pkg", store, events: bus });
  await S.runNote(j3, inputOf(), depsOf(svc, bus, { render: Object.assign(render, { version: "r2" }) }));
  assert.equal(renders, 2);
});

test("abort during writing cancels the job and caches no partial writing stage", async () => {
  const { job, bus } = await setup(), ac = new AbortController();
  let started;
  const running = new Promise(r => { started = r; });
  // S1 은 끝나고 S2 만 매달려 있다 — 취소가 부분 결과(S1 만 있는 단계)를 캐시에 남기면 안 된다
  const svc = fakeService({ section: o => o.section.sectionId === "S1" ? DEFAULTS.section(o) : new Promise((_, rej) => { started(); o.signal.addEventListener("abort", () => rej(abortErr()), { once: true }); }) });
  const run = S.runNote(job, inputOf(), depsOf(svc, bus, { signal: ac.signal }));
  run.catch(() => {});
  await running;
  ac.abort();
  await assert.rejects(run, { name: "AbortError" });
  assert.deepEqual([job.state, job.stage], ["cancelled", "writing"]);
  assert.equal("writing" in job.record.completed, false);
  assert.equal((await job.store.getJson("jobs", "j1")).state, "cancelled");
});

test("requestIds: deterministic per input, new per retry attempt, new for a different input or rerun", async () => {
  const run = async (input, over = {}) => {
    const { job, bus } = await setup(), delays = [], svc = fakeService(over);
    await S.runNote(job, input, depsOf(svc, bus, { sleep: async ms => { delays.push(ms); } }));
    return { svc, delays };
  };
  const bases = svc => svc.all().map(c => c.requestId.replace(/-r\d+$/, "")).sort();
  const a = await run(inputOf());
  const b = await run(inputOf());
  assert.deepEqual(a.svc.all().map(c => c.requestId).sort(), b.svc.all().map(c => c.requestId).sort());
  assert.equal(new Set(a.svc.all().map(c => c.requestId)).size, a.svc.all().length); // 호출마다 다르다

  // 첫 시도가 일시 오류로 실패하면 같은 호출이 base-r1 로 다시 나간다(서버가 같은 id 를 409 로 막기 때문)
  let failed = false;
  const c = await run(inputOf(), { section: o => { if (!failed && o.section.sectionId === "S1") { failed = true; throw svcErr("provider_busy", { retryable: true }); } return DEFAULTS.section(o); } });
  const s1 = c.svc.calls.section.filter(x => x.section.sectionId === "S1").map(x => x.requestId);
  assert.equal(s1.length, 2);
  assert.equal(s1[1], s1[0] + "-r1");
  assert.deepEqual(uniq(bases(c.svc)), bases(a.svc));
  assert.equal(c.delays.length, 1);
  assert.ok(c.delays[0] >= 800 && c.delays[0] <= 1200);

  const changed = lecture();
  changed.transcript.segments[0].text += " 추가 발화";
  const d = await run(inputOf(changed));
  assert.notEqual(d.svc.calls.plan[0].requestId, a.svc.calls.plan[0].requestId);
  const e = await run(inputOf({ rerun: 1 }));
  assert.equal(e.svc.all().filter(x => a.svc.all().some(y => y.requestId === x.requestId)).length, 0);
});

// ── 내용 없는 텔레메트리 ──
test("events and notices never carry lecture or generated text", async () => {
  const { job, bus } = await setup(), svc = fakeService({
    ...withBadBlock({ repair: o => ({ blocks: o.repair.map(() => blockOf(["U999"])) }) }),
    section: o => {
      if (o.section.sectionId === "S2") throw Object.assign(new Error(MARK + " 서버가 돌려준 메시지 " + GEN), { code: "request_rejected", retryable: false });
      return { blocks: [blockOf(["U1", "U2"]), blockOf(["U999"], GEN)] };
    },
  });
  const res = await S.runNote(job, inputOf({ gaps: GAPS, tier: "paid" }), depsOf(svc, bus));
  assert.equal(res.status, "partial");
  const seen = JSON.stringify([bus.recent(), res.notices, await job.store.getJson("jobs", "j1")]);
  assert.ok(bus.recent().length > 20);
  for (const secret of [MARK, GEN, "서버가 돌려준", word(0), "개념 설명"]) assert.equal(seen.includes(secret), false, secret);
  // 같은 이벤트에서 코드·수치는 남는다
  assert.ok(bus.recent().some(e => e.code === "REQUEST_REJECTED"));
  assert.ok(bus.recent().some(e => /^sections=\d+ failed=\d+ dropped=\d+$/.test(e.msg ?? "")));
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
