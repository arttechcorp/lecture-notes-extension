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
const ENVELOPE = new Set(["model", "requestId", "noteSpecVersion", "stage", "signal", "jobId", "host", "timeoutMs", "sourceLang", "noteSession", "noteMode"]); // sourceLang·noteSession 은 서버 라우트의 선택 필드다
// v2 칸(editorialPlan, repair 항목 mode, review 단계)은 계약 워커가 prompts.js 에 넣는다 — 병합 전 스냅샷에서는
// 스키마가 아직 그 칸을 모르면 검사에서만 뺀다(병합 뒤에는 스키마가 받아 검증된다). 단계 스키마 자체가 없으면 건너뛴다.
const V2_FIELDS = new Set(["editorialPlan"]);
function assertRequest(o) {
  const stage = o.stage ?? "plan", sch = Prompts.REQUEST[stage];
  if (sch) {
    const known = new Set(Object.keys(sch.properties ?? {}));
    const body = Object.fromEntries(Object.entries(o).filter(([k]) => !ENVELOPE.has(k) && (known.has(k) || !V2_FIELDS.has(k))));
    if (Array.isArray(body.repair) && sch.properties?.repair?.items?.properties && !("mode" in sch.properties.repair.items.properties))
      body.repair = body.repair.map(r => { const { mode, ...rest } = r; return rest; });
    const r = Contracts.validate(sch, body);
    assert.ok(r.ok, stage + " " + JSON.stringify(r.errors));
  }
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
// ── 의미 초안 경로(W2-A) — 작성 서비스가 stage:"draft" 로 불리면 블록 봉투가 아니라 주장+typed 관계를 돌려준다.
// 컴파일(lib/section-draft.js)이 계획 블록으로 조판한다. 검증·repair·T5·조립은 blocks 경로와 같다.
const REL0 = () => ({ comparisons: [], arguments: [], cases: [], materials: [], calcs: [], pitfalls: [], notes: [], links: [], notices: [], maps: [] });
const dclaim = (claimId, role, text, evidenceIds, conceptIds = []) => ({ claimId, role, text, basis: "lecture", evidenceIds, conceptIds, dependsOn: [], emphasis: null });
const draftOf = (sectionId, claims, relations = {}, gist = null) => ({ sectionId, gist, claims, relations: { ...REL0(), ...relations }, checks: [] });
// S3 의 초안 — 컴파일되면 검증을 통과하는 네 블록이 된다(나머지 섹션은 빈 초안 — 전부 보류).
const DRAFT_S3 = draftOf("S3", [
  dclaim("c1", "definition", "시장 거래 비용과 내부 조직 비용을 비교해 기업의 경계를 정한다는 관점이다", ["U4.s2", "U4.t2"], ["C5"]),
  dclaim("c2", "definition", "고유 자원과 역량이 있는 활동을 기업 내부에 둔다는 관점이다", ["U4.s3", "U4.t3"], ["C6"]),
  dclaim("c3", "comparison", "거래를 분석 단위로 삼는다", ["U4.g1"], ["C5"]),
  dclaim("c4", "comparison", "자원과 역량을 분석 단위로 삼는다", ["U4.g1"], ["C6"]),
  dclaim("c5", "argument", "기업의 경계는 시장 거래 비용과 내부 조직 비용의 비교로 정한다", ["U4.s2"], ["C5"]),
  dclaim("c6", "argument", "거래가 자주 일어나고 전용 자산이 필요할수록 내부에서 하는 편이 낫다", ["U4.t2"], ["C5"]),
], {
  comparisons: [{ status: null, importance: null, title: "세 관점을 같은 기준으로 비교", entities: [{ label: "거래비용 관점", conceptId: "C5" }, { label: "자원기반 관점", conceptId: "C6" }], criteria: [{ label: "분석 단위", cells: ["c3", "c4"] }], common: [], discriminator: null }],
  arguments: [{ status: null, importance: null, title: "거래비용 관점의 논거", relationType: "argument", question: null, steps: [{ role: "premise", claim: "c5" }, { role: "claim", claim: "c6" }], missingLinks: [] }],
}, { text: "기업의 경계를 설명하는 관점들을 같은 기준으로 비교한다", evidenceIds: ["U4.s1", "U4.t1"], basis: "lecture" });
// 반으로 나뉜 뒷반 요청(withGist:false)은 gist 칸 자체가 스키마에 없다 — 응답에서도 뺀다.
const draftFor = o => {
  const out = o.section.sectionId === "S3" ? deep(DRAFT_S3) : draftOf(o.section.sectionId, [], {});
  if (o.withGist === false) delete out.gist;
  return { output: out };
};
const DEFAULTS = {
  plan: () => ({ plan: PLANNER, promptVersion: "note-v2" }),
  section: o => ({ output: WRITER.sections[o.section.sectionId].first }),
  draft: draftFor,
  repair: o => ({ output: { blocks: Object.fromEntries(o.repair.map(r => [r.blockId, WRITER.sections[o.section.sectionId].repair?.blocks?.[r.blockId] ?? null])) } }),
  global: () => ({ output: WRITER.global }),
  link: () => ({ output: { edits: [] } }),
  review: () => ({ output: { edits: [], unresolved: [] } }),
  questions: o => ({ output: { blocks: { [o.blockId]: null } } }),
  judge: o => ({ results: o.items.map(i => ({ itemId: i.itemId, task: o.task, probs: [{ label: "yes", p: .9 }], score: o.task === "support" ? .9 : 3, confidence: null, model: o.model })) }),
};
// 서버처럼 성공한 requestId 를 다시 받으면 409 를 준다 — 이미 낸 돈의 호출을 다시 보내는 버그가 여기서 드러난다.
function fakeService(over = {}) {
  const calls = { plan: [], section: [], repair: [], global: [], judge: [], draft: [], link: [], review: [], questions: [], editorial: [] }, done = new Set();
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
// /v1/me 의 작업별 서버 프롬프트 버전 — 단계·호출 캐시 키에 들어간다. 없으면 캐시를 안 쓰는 게 맞다.
const PV = { plan: "note-v5", section: "note-v5", repair: "note-v5", global: "note-v5", draft: "note-v5", link: "note-v5", review: "note-v5", editorial: "note-v5", questions: "note-v5", judge: "v1" };
const depsOf = (service, bus, over = {}) => ({ service, katex, events: bus, sleep: async () => {}, promptVersions: PV, ...over });
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
  assert.deepEqual(res.note.dropped, [{ blockId: "S3_B4", type: "B07", codes: ["VAL_NUMBER_MISSING"], cause: "direct" }]);
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

test("paid+judged: importance in batches, support only for lecture claims, a low score holds the block as pending", async () => {
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
  assert.equal(support.length, 6); // 주장이 있는 섹션마다 한 번 + S1 의 낮은 주장 근거 재연결 1회
  // 강의 근거 주장만 보낸다 — 교육용(일부러 틀린)·파생 주장 문장은 항목에 없다
  const texts = support.flatMap(c => c.items.map(i => i.text));
  assert.ok(texts.length > 0);
  assert.ok(texts.some(t => t.includes("함께 기억해 두면 좋다"))); // 낮은 점수를 맞은 주장은 확실히 나갔다
  assert.ok(texts.every(t => !["공헌이익은 판매가격에서 고정비를 뺀 값이다", "거래 빈도와 무관하게", "판매량은 500개", "판매량은 400개"].some(x => t.includes(x))));
  assert.deepEqual(noticeOf(res, "NOTE_CLAIMS_UNSUPPORTED"), { code: "NOTE_CLAIMS_UNSUPPORTED", count: 1, ids: null, ranges: null });
  assert.ok(!res.note.dropped.some(x => x.blockId === "S1_B3"), "보류 블록은 탈락이 아니라 pending 에 남는다");
  const p = res.note.pending.find(x => x.blockId === "S1_B3");
  assert.ok(p?.envelope, "필수 칸의 낮은 주장 — 블록째 보류되지만 봉투는 보존");
  assert.equal(p.envelope.content.note.basis, "lecture");
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
test("support: a low claim in a claim list is cut and kept pending; a low claim in a required slot holds the block as pending", async () => {
  const { job, bus } = await setup(), svc = fakeService({
    judge: o => ({ results: o.items.map(i => ({ itemId: i.itemId, task: o.task, probs: [{ label: "yes", p: .9 }], score: o.task === "importance" ? 3 : /일정 기간을 기준으로 한 분류다|함께 기억해 두면 좋다/.test(i.text) ? .1 : .9, confidence: null, model: o.model })) }),
  });
  const res = await S.runNote(job, inputOf({ models: { plan: "m-plan", write: "m-write", judge: "m-judge" } }), depsOf(svc, bus));
  const b1 = res.note.sections.find(s => s.sectionId === "S1").blocks.find(b => b.id === "S1_B1");
  assert.ok(b1, "scope 항목 하나만 빠지고 개념 블록은 남는다");
  assert.ok(!JSON.stringify(b1).includes("일정 기간을 기준으로 한 분류다"));
  const pend = res.note.pending ?? [];
  assert.equal(pend.find(x => x.blockId === "S1_B1")?.claims?.[0]?.text, "일정 기간을 기준으로 한 분류다", "뺀 주장은 pending 에 보존");
  assert.equal(pend.find(x => x.blockId === "S1_B1")?.envelope, null, "칸을 뺄 수 있는 주장은 블록째 보류하지 않는다");
  const p3 = pend.find(x => x.blockId === "S1_B3");
  assert.ok(p3?.envelope?.content?.note?.text?.includes("함께 기억해 두면 좋다"), "B12 note 는 대신할 칸이 없어 봉투째 보류·보존");
  assert.ok(!res.note.dropped.some(d => d.blockId === "S1_B3"), "보류는 탈락이 아니다 — dropped 에 없다");
  assert.deepEqual(noticeOf(res, "NOTE_CLAIMS_UNSUPPORTED"), { code: "NOTE_CLAIMS_UNSUPPORTED", count: 2, ids: null, ranges: null });
  assert.match(bus.recent().find(e => e.code === "SUPPORT_SCORES").msg, / low=2 blocks=1 trimmed=1 /);
});

// ── 지지 회복(T5) ──
// 지지 점수가 낮은 블록은 VAL_SUPPORT_LOW 오류를 단 repair 로 한 번만 다시 쓴다. 받는 조건: 섹션 단위 오류 없음 +
// 대상 블록이 살아 있고 오류 없음 + 강의 근거 주장 전부가 새 src 로 다시 판정돼 .5 이상. 안 되면 낮은 주장만 뺀다.
const JUDGED = { models: { plan: "m-plan", write: "m-write", judge: "m-judge" } };
const isT5 = o => o.repair?.some(r => r.errors?.[0]?.code === "VAL_SUPPORT_LOW");
const lowJudge = (low, skip) => o => ({ results: o.items.filter(i => !(o.task === "support" && skip?.test(i.text))).map(i => ({ itemId: i.itemId, task: o.task, probs: [{ label: "yes", p: .9 }], score: o.task === "importance" ? 3 : low.test(i.text) ? .1 : .9, confidence: null, model: o.model })) });
const fixedB3 = text => { const b = deep(WRITER.sections.S1.first.blocks.S1_B3); b.content.note = { text, evidenceIds: ["U1.s2"], basis: "lecture" }; return b; };

test("support repair: a low claim's block is repaired once with VAL_SUPPORT_LOW, the new claim is rejudged and survives", async () => {
  const { job, bus } = await setup();
  const svc = fakeService({
    repair: o => isT5(o) ? { output: { blocks: { S1_B3: fixedB3("고정비에는 일정 기간 조건이 붙는다는 점이 핵심이다") } } } : DEFAULTS.repair(o),
    judge: lowJudge(/함께 기억해 두면 좋다/),
  });
  const res = await S.runNote(job, inputOf(JUDGED), depsOf(svc, bus));
  assert.equal(job.state, "done");
  // 대상 블록·VAL_SUPPORT_LOW 오류 하나짜리 repair 가 딱 한 번 나간다 — 형식·서버 repair(S2·S3)와는 별도다
  const t5 = svc.calls.repair.filter(isT5);
  assert.equal(t5.length, 1);
  assert.equal(t5[0].section.sectionId, "S1");
  assert.deepEqual(t5[0].repair.map(r => [r.blockId, r.errors[0].code]), [["S1_B3", "VAL_SUPPORT_LOW"]]);
  assert.ok(t5[0].repair[0].previous.content.note.text.includes("함께 기억해 두면 좋다"), "previous 는 원래 봉투");
  const b3 = res.note.sections.find(s => s.sectionId === "S1").blocks.find(b => b.id === "S1_B3");
  assert.equal(b3?.content.note.text, "고정비에는 일정 기간 조건이 붙는다는 점이 핵심이다", "고친 봉투가 노트에 산다");
  // 고친 주장은 다시 판정된다 — 재판정 호출에는 새 주장이 실린다
  const rejudge = svc.calls.judge.filter(c => c.task === "support").find(c => c.items.some(i => i.text.includes("일정 기간 조건이 붙는다는 점이 핵심이다")));
  assert.ok(rejudge, "고친 주장을 다시 판정한다");
  assert.equal(bus.recent().find(e => e.code === "T5_REPAIR" && e.unit === "S1").msg, "repaired=1 of=1");
  assert.equal(noticeOf(res, "NOTE_CLAIMS_UNSUPPORTED"), undefined, "회복됐으니 보류 고지가 없다");
});

test("support repair: an unrelated writer-held block does not block recovery — whole-section ok is not required", async () => {
  const { job, bus } = await setup();
  const svc = fakeService({
    section: o => { const r = pickOut(o); if (o.section.sectionId === "S1") r.output.blocks.S1_B1 = null; return r; }, // S1_B1 은 모델 보류(VAL_BLOCK_DECLINED)
    repair: o => isT5(o) ? { output: { blocks: { S1_B3: fixedB3("고정비의 기간 조건이 정의의 일부다") } } } : DEFAULTS.repair(o),
    judge: lowJudge(/함께 기억해 두면 좋다/),
  });
  const res = await S.runNote(job, inputOf(JUDGED), depsOf(svc, bus));
  assert.equal(job.state, "done");
  // S1_B1 은 끝까지 보류다 — 섹션 ok 가 false 여도 S1_B3 회복은 받아들인다
  assert.ok(res.note.dropped.some(d => d.blockId === "S1_B1"), "무관한 보류 블록은 그대로 빠진다");
  const s1 = res.note.sections.find(s => s.sectionId === "S1");
  assert.deepEqual(s1.blocks.map(b => b.id), ["S1_B2", "S1_B3"]);
  assert.equal(s1.blocks.find(b => b.id === "S1_B3").content.note.text, "고정비의 기간 조건이 정의의 일부다");
  assert.equal(bus.recent().find(e => e.code === "T5_REPAIR" && e.unit === "S1").msg, "repaired=1 of=1");
});

test("support repair: a repaired claim still low or coming back unjudged is excluded — the block is not counted as recovered", async () => {
  for (const [tag, text, low, skip] of [
    ["still low", "고정비의 조건을 다시 쓴 문장", /함께 기억해 두면 좋다|다시 쓴 문장/, null],
    ["unjudged", "재판정에서 빠진 주장", /함께 기억해 두면 좋다/, /재판정에서 빠진/],
  ]) {
    const { job, bus } = await setup();
    const svc = fakeService({
      repair: o => isT5(o) ? { output: { blocks: { S1_B3: fixedB3(text) } } } : DEFAULTS.repair(o),
      judge: lowJudge(low, skip),
    });
    const res = await S.runNote(job, inputOf(JUDGED), depsOf(svc, bus));
    assert.equal(job.state, "done", tag);
    assert.equal(bus.recent().find(e => e.code === "T5_REPAIR" && e.unit === "S1").msg, "repaired=0 of=1", tag);
    assert.ok(!res.note.sections.find(s => s.sectionId === "S1").blocks.some(b => b.id === "S1_B3"), tag + ": 회복이 안 되면 낮은 주장을 확정 본문에 두지 않는다");
    assert.ok(res.note.pending?.some(p => p.blockId === "S1_B3" && p.envelope), tag + ": 삭제가 아니라 pending 보존이다");
    assert.equal(noticeOf(res, "NOTE_CLAIMS_UNSUPPORTED").count, 1, tag);
  }
});

test("support repair: T5 예산은 형식 repair 와 별개다 — 형식으로 이미 고친 블록도 지지 repair 를 한 번 받는다", async () => {
  const { job, bus } = await setup();
  const svc = fakeService({ judge: lowJudge(/슬라이드 예시의 값을 그대로/) }); // S2_B3 는 형식 repair 로 이미 다시 쓴 블록이다
  const res = await S.runNote(job, inputOf(JUDGED), depsOf(svc, bus));
  assert.equal(job.state, "done");
  assert.ok(svc.calls.repair.some(isT5), "형식 repair 예산을 쓴 블록이라도 T5 회복은 나간다");
  assert.equal(bus.recent().filter(e => e.code === "T5_REPAIR").length, 1);
  const b3 = res.note.sections.find(s => s.sectionId === "S2").blocks.find(b => b.id === "S2_B3");
  assert.ok(b3, "낮은 주장 하나만 빠지고 계산 블록은 남는다");
  assert.ok(!JSON.stringify(b3).includes("슬라이드 예시의 값을 그대로"), "회복이 안 된 낮은 주장은 확정 본문에서 빠진다");
  assert.ok(res.note.pending?.some(p => p.blockId === "S2_B3" && !p.envelope), "빠진 주장은 pending 에 보존");
  assert.equal(noticeOf(res, "NOTE_CLAIMS_UNSUPPORTED").count, 1);
  assert.match(bus.recent().find(e => e.code === "SUPPORT_SCORES").msg, / low=1 blocks=0 trimmed=1 /);
});

test("support relink: a claim low on its cited evidence is rejudged on adjacent units and relinked when supported", async () => {
  const { job, bus } = await setup();
  // 인용 근거(U1.s2)만으로는 낮지만 같은 유닛의 인접 발화가 보이면 지지한다 — 재연결로 살아남아야 한다.
  const svc = fakeService({
    judge: o => ({ results: o.items.map(i => ({ itemId: i.itemId, task: o.task, probs: [{ label: "yes", p: .9 }], score: o.task === "importance" ? 3 : i.text.includes("함께 기억해 두면 좋다") ? (i.context.includes("똑같이 나가는 돈을 고정비라고") ? .9 : .3) : .9, confidence: null, model: o.model })) }),
  });
  const res = await S.runNote(job, inputOf(JUDGED), depsOf(svc, bus));
  assert.equal(job.state, "done");
  const b3 = res.note.sections.find(s => s.sectionId === "S1").blocks.find(b => b.id === "S1_B3");
  assert.ok(b3, "확장 근거가 지지하면 주장은 확정 본문에 남는다");
  assert.ok(b3.content.note.evidenceIds.length > 1 && b3.content.note.evidenceIds.includes("U1.s2"), "이긴 묶음의 근거가 인용에 붙는다");
  assert.ok(!svc.calls.repair.some(isT5), "재연결로 회복됐으니 문장 수정은 나가지 않는다");
  assert.equal(noticeOf(res, "NOTE_CLAIMS_UNSUPPORTED"), undefined, "보류가 없으니 고지도 없다");
  const outcomes = bus.recent().find(e => e.code === "SUPPORT_OUTCOMES");
  assert.match(outcomes.msg, /relinked=1/);
  assert.match(outcomes.msg, /direct=0/);
});

test("judgeShadow: 판정·계측은 하지만 본문을 바꾸지 않는다", async () => {
  const { job, bus } = await setup();
  const svc = fakeService({ judge: lowJudge(/함께 기억해 두면 좋다/) });
  const res = await S.runNote(job, inputOf(JUDGED), depsOf(svc, bus, { judgeShadow: true }));
  assert.equal(job.state, "done");
  const s1 = res.note.sections.find(s => s.sectionId === "S1");
  assert.equal(s1.blocks.find(b => b.id === "S1_B3")?.content.note.text.includes("함께 기억해 두면 좋다"), true, "shadow 는 본문을 바꾸지 않는다");
  assert.equal(res.note.pending, undefined, "shadow 는 보존 필드도 쓰지 않는다");
  assert.equal(noticeOf(res, "NOTE_CLAIMS_UNSUPPORTED"), undefined, "본문이 안 바뀌었으니 보류 고지도 없다");
  const outcomes = bus.recent().find(e => e.code === "SUPPORT_OUTCOMES");
  assert.ok(outcomes, "판정·계측 이벤트는 나간다");
  assert.match(outcomes.msg, /low=|direct=1/, "shadow 도 뭐가 보류됐을지 계측한다");
});

test("support outcomes: a required-slot low claim holds the whole block as pending and dependents count as collateral", async () => {
  const { job, bus } = await setup();
  // S4_B1(B09)의 필수 칸 gist 를 낮게 판정 — 블록째 보류되고, 그 블록을 복습하는 S4_B2 항목들이 함께 가지치기된다.
  const svc = fakeService({ judge: lowJudge(/응답 점포가 전체 상권을 대표하는지는 확인되지 않는다/) });
  const res = await S.runNote(job, inputOf(JUDGED), depsOf(svc, bus));
  assert.equal(job.state, "done");
  const p = res.note.pending.find(x => x.blockId === "S4_B1");
  assert.ok(p?.envelope, "필수 칸이 불명확하면 블록째 보류 — 봉투 전체가 pending 에 보존");
  assert.ok(p.envelope.content.points.length === 2 && p.envelope.content.limits.length === 2, "같은 블록의 정상 조건·사례가 저장 구조에 남는다");
  assert.ok(!res.note.dropped.some(d => d.blockId === "S4_B1"), "보류는 탈락이 아니다");
  const outcomes = bus.recent().find(e => e.code === "SUPPORT_OUTCOMES");
  assert.ok(outcomes, "SUPPORT_OUTCOMES 이벤트");
  assert.match(outcomes.msg, /direct=1/, "저점수 주장 자체는 직접 보류");
  assert.match(outcomes.msg, /collateral=[1-9]/, "함께 빠진 형제·의존 주장은 동반 손실로 센다");
  assert.match(outcomes.msg, /pending=[1-9]/, "pending 에는 보존된 주장 수가 센다");
  assert.ok(bus.recent().some(e => e.code === "SUPPORT_RECOVERY"), "복구 회계 이벤트");
});

test("support pending: a low claim nested in a list item removes the item, keeps the block, and preserves every claim in it", async () => {
  const { job, bus } = await setup();
  // S4_B2(B14) 항목 0 의 prompt 주장을 낮게 판정 — prompt 는 필수 칸이라 주장만 못 빼지만 항목째 빼면 블록은 산다.
  const svc = fakeService({ judge: lowJudge(/대형 유통점 입점이 골목 상권 매출을 늘렸다는 주장을 뒷받침하는지 논하라/) });
  const res = await S.runNote(job, inputOf(JUDGED), depsOf(svc, bus));
  assert.equal(job.state, "done");
  const b2 = res.note.sections.find(s => s.sectionId === "S4").blocks.find(b => b.id === "S4_B2");
  assert.ok(b2, "목록 항목 하나만 빠지고 자기 점검 블록은 남는다");
  assert.equal(b2.content.items.length, 1, "원래 3항목 — Q3 은 죽은 복습 위치로 정리되고 여기서 항목 0 이 빠진다");
  const p = (res.note.pending ?? []).find(x => x.blockId === "S4_B2");
  assert.ok(p && !p.envelope, "항목 제거는 블록 보류가 아니다");
  assert.ok(p.claims.length >= 4, "빠진 항목 안의 주장(prompt·해설·루브릭)이 전부 pending 에 보존된다");
  const outcomes = bus.recent().find(e => e.code === "SUPPORT_OUTCOMES");
  assert.match(outcomes.msg, /direct=1/);
  assert.match(outcomes.msg, /collateral=[1-9]/, "같이 빠진 항목 내 주장은 동반 손실로 센다");
});

test("support budget: the global recovery budget skips relink and repair — claims are held pending, not deleted", async () => {
  const { job, bus } = await setup();
  const svc = fakeService({ judge: lowJudge(/함께 기억해 두면 좋다|일정 기간을 기준으로 한 분류다/) });
  const res = await S.runNote(job, inputOf(JUDGED), depsOf(svc, bus, { supportBudget: 0 }));
  assert.equal(job.state, "done");
  assert.ok(!svc.calls.repair.some(isT5), "예산 0 이면 문장 수정 호출이 나가지 않는다");
  assert.ok(bus.recent().filter(e => e.code === "T5_REPAIR").length === 0, "T5_REPAIR 도 없다");
  assert.match(bus.recent().find(e => e.code === "SUPPORT_RECOVERY").msg, /budget_skip=[1-9]/);
  assert.equal(noticeOf(res, "NOTE_CLAIMS_UNSUPPORTED").count, 2, "보류 건수는 고지로 나간다");
  assert.ok((res.note.pending ?? []).length >= 2, "낮은 주장은 삭제가 아니라 보존");
});

test("support repair: English src is replaced for the repaired block and the rejudge reads the new src, not the stale one", async () => {
  const { job, bus } = await setup();
  const en = deep(INPUT.transcript);
  for (const sg of en.segments) sg.text += " " + "so the validation error is what we use to pick the model ".repeat(20);
  const addSrc = o => { (function walk(v) { if (Array.isArray(v)) return v.forEach(walk); if (!v || typeof v !== "object") return;
    if (typeof v.text === "string" && Array.isArray(v.evidenceIds) && typeof v.basis === "string") { v.src = v.basis === "lecture" ? "EN: " + v.text : null; return; }
    Object.values(v).forEach(walk); })(o); return o; };
  const fixed = fixedB3("고정비의 기간 조건이 정의의 일부다");
  fixed.content.note.src = "EN REPAIRED SRC";
  const svc = fakeService({
    section: o => addSrc({ output: deep(WRITER.sections[o.section.sectionId].first) }),
    repair: o => isT5(o) ? { output: { blocks: { S1_B3: fixed } } } : addSrc(DEFAULTS.repair(o)),
    judge: lowJudge(/함께 기억해 두면 좋다/),
  });
  const res = await S.runNote(job, inputOf({ transcript: en, ...JUDGED }), depsOf(svc, bus));
  assert.equal(job.state, "done");
  const t5 = svc.calls.repair.filter(isT5);
  assert.equal(t5.length, 1);
  assert.equal(t5[0].sourceLang, "en");
  // 재판정은 새 src 로 — 낡은 src 문장은 다시 보내지 않는다
  const rejudge = svc.calls.judge.filter(c => c.task === "support").find(c => c.items.some(i => i.text === "EN REPAIRED SRC"));
  assert.ok(rejudge, "고친 주장의 새 src 로 다시 판정한다");
  assert.deepEqual(rejudge.items.map(i => i.text), ["EN REPAIRED SRC"], "재판정 항목은 새 src 뿐이다");
  const s1 = res.note.sections.find(s => s.sectionId === "S1");
  assert.equal(s1.blocks.find(b => b.id === "S1_B3").content.note.text, "고정비의 기간 조건이 정의의 일부다");
  assert.ok(!JSON.stringify(res.note).includes('"src"'), "노트에는 src 가 없다");
});

test("support repair: a busy provider skips the optional repair and drops the claim, while quota and cancellation still stop the job", async () => {
  // provider_busy(재시도를 다 쓴 429·열린 차단기)는 선택적 회복을 건너뛰고 낮은 주장만 뺀다 — 작업은 끝난다
  {
    const { job, bus } = await setup();
    const svc = fakeService({
      repair: o => { if (isT5(o)) throw svcErr("provider_busy", { retryable: true }); return DEFAULTS.repair(o); },
      judge: lowJudge(/함께 기억해 두면 좋다/),
    });
    const res = await S.runNote(job, inputOf(JUDGED), depsOf(svc, bus));
    assert.equal(job.state, "done", "바쁜 제공자는 일시정지가 아니다");
    assert.ok(svc.calls.repair.some(isT5), "T5 회복 호출은 나간다");
    assert.ok(!res.note.sections.find(s => s.sectionId === "S1").blocks.some(b => b.id === "S1_B3"), "회복이 없으면 낮은 주장은 확정 본문에서 빠진다");
    assert.ok(res.note.pending?.some(p => p.blockId === "S1_B3" && p.envelope), "빠진 내용은 삭제가 아니라 pending 보존이다");
    assert.equal(noticeOf(res, "NOTE_CLAIMS_UNSUPPORTED").count, 1);
    assert.ok(codes(res.notices).includes("NOTE_GLOBAL_FAILED"), "차단기가 열린 뒤 전역 글만 빠진다");
  }
  // 한도 오류는 선택적 회복이 삼키지 않는다 — 작업을 멈춘다
  {
    const { job, bus } = await setup();
    const svc = fakeService({
      repair: o => { if (isT5(o)) throw svcErr("quota_exceeded"); return DEFAULTS.repair(o); },
      judge: lowJudge(/함께 기억해 두면 좋다/),
    });
    const res = await S.runNote(job, inputOf(JUDGED), depsOf(svc, bus));
    assert.deepEqual([job.state, res.status, res.code], ["paused", "paused", "QUOTA_EXCEEDED"]);
  }
  // 사용자 취소도 그대로 올라간다
  {
    const { job, bus } = await setup(), ctl = new AbortController();
    const svc = fakeService({
      repair: o => { if (isT5(o)) { ctl.abort(); throw new DOMException("cancel", "AbortError"); } return DEFAULTS.repair(o); },
      judge: lowJudge(/함께 기억해 두면 좋다/),
    });
    await assert.rejects(S.runNote(job, inputOf(JUDGED), depsOf(svc, bus, { signal: ctl.signal })), { name: "AbortError" });
    assert.equal(job.state, "cancelled");
  }
});
test("timeout: a repair or global-writer call that times out drops only that part; the note still finishes", async () => {
  const { job, bus } = await setup(), abort = () => { throw new DOMException("취소됨", "AbortError"); };
  const svc = fakeService({ repair: abort, global: abort });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  assert.equal(job.state, "done");
  assert.ok(res.note);
  assert.ok(codes(res.notices).includes("NOTE_GLOBAL_FAILED"));
  assert.ok(svc.calls.repair.length > 0);
  assert.match(bus.recent().find(e => e.code === "REPAIR_RESULT").msg, /^call_failed=\d+ timeout$/);
  assert.equal(bus.recent().find(e => e.code === "GLOBAL_FAILED").msg, "timeout");
});
test("fallback model: a single block the main writer cannot finish, a failed repair and a timed-out global writer are all retried on models.writeAlt", async () => {
  const { job, bus } = await setup(), alt = "m-alt";
  const svc = fakeService({
    section: o => { if (o.section.sectionId === "S5" && o.model !== alt) throw svcErr("llm_output_truncated"); return pickOut(o); },
    repair: o => { if (o.model !== alt) throw svcErr("provider_failed_or_invalid_output"); return DEFAULTS.repair(o); },
    global: o => { if (o.model !== alt) throw new DOMException("취소됨", "AbortError"); return DEFAULTS.global(o); },
  });
  const res = await S.runNote(job, inputOf({ models: { plan: "m-plan", write: "m-write", writeAlt: alt, judge: null } }), depsOf(svc, bus));
  assert.equal(job.state, "done");
  assert.ok(res.note.sections.some(s => s.sectionId === "S5"), "블록 하나도 잘리던 S5 를 대체 모델이 썼다");
  assert.ok(!codes(res.notices).includes("NOTE_SECTIONS_FAILED"));
  assert.ok(svc.calls.repair.some(c => c.model === alt), "실패한 repair 는 대체 모델로");
  assert.deepEqual(svc.calls.global.map(c => c.model), ["m-write", alt]);
  assert.ok(!codes(res.notices).includes("NOTE_GLOBAL_FAILED"));
  assert.ok(bus.recent().filter(e => e.code === "ALT_MODEL").length >= 3);
});

test("fallback model: a rate-limited main writer (429 until the breaker opens) hands sections, repair and global to writeAlt instead of pausing; both down still pauses", async () => {
  // 필드: OpenRouter 가 작성 모델에 429 를 6번 연달아 돌려 차단기가 열렸고, LLM_CIRCUIT_OPEN 으로 작업 전체가 network 일시정지했다.
  const busy = () => { throw svcErr("provider_busy", { retryable: true }); };
  for (const altDown of [false, true]) {
    const { job, bus } = await setup(), alt = "m-alt";
    const svc = fakeService({
      section: (o, i) => o.model !== alt || altDown ? busy() : DEFAULTS.section(o, i),
      repair: o => o.model !== alt || altDown ? busy() : DEFAULTS.repair(o),
      global: o => o.model !== alt || altDown ? busy() : DEFAULTS.global(o),
    });
    const res = await S.runNote(job, inputOf({ models: { plan: "m-plan", write: "m-write", writeAlt: alt, judge: null } }), depsOf(svc, bus));
    if (altDown) { assert.deepEqual([job.state, res.reason], ["paused", "network"]); continue; }
    assert.equal(job.state, "done");
    assert.equal(res.note.sections.length, 5, "모든 섹션을 대체 모델이 썼다");
    assert.ok(!codes(res.notices).includes("NOTE_GLOBAL_FAILED"));
    assert.ok(svc.calls.repair.some(c => c.model === alt));
    assert.ok(bus.recent().some(e => e.code === "ALT_MODEL" && /LLM_(UNAVAILABLE|CIRCUIT_OPEN)|provider_busy/.test(e.msg)));
  }
});

test("busy providers: an open breaker is waited out instead of pausing, and a busy fallback model only skips the optional second repair and global writer", async () => {
  // 필드: 작성 모델 429 → 차단기 열림 → 일시정지, 이어서 대체 모델(Sol)도 429 라 2차 repair 에서 또 일시정지했다.
  const { job, bus } = await setup(), alt = "m-alt";
  let clock = 0, fails = 6;
  const breaker = P.createBreaker({ now: () => clock });
  const busy = () => { throw svcErr("provider_busy", { retryable: true }); };
  const svc = fakeService({
    // 주 모델은 처음 6번 429(차단기가 열린다) 뒤 회복, 대체 모델은 끝까지 429
    section: (o, i) => o.model === alt ? busy() : fails-- > 0 ? busy() : DEFAULTS.section(o, i),
    repair: o => o.model === alt ? busy() : { output: { blocks: Object.fromEntries(o.repair.map(r => [r.blockId, r.previous])) } },
    global: o => o.model === alt ? busy() : busy(),
  });
  const sleep = async ms => { clock += ms; };
  const res = await S.runNote(job, inputOf({ models: { plan: "m-plan", write: "m-write", writeAlt: alt, judge: null } }), depsOf(svc, bus, { breaker, sleep }));
  assert.equal(job.state, "done", "일시정지하지 않는다");
  assert.equal(res.note.sections.length > 0, true);
  assert.ok(codes(res.notices).includes("NOTE_GLOBAL_FAILED"), "전역 글만 빠진다");
  assert.ok(bus.recent().some(e => e.code === "ALT_MODEL" && /repair2_failed/.test(e.msg)));
});

test("fallback model: without writeAlt nothing changes, and a block still failing after repair gets a second repair on the fallback model", async () => {
  const { job, bus } = await setup(), alt = "m-alt";
  // 주 모델 repair 는 고치지 못하고(같은 봉투를 그대로 돌려줌) 대체 모델은 픽스처의 고친 봉투를 돌려준다
  const svc = fakeService({
    repair: o => o.model === alt ? DEFAULTS.repair(o) : { output: { blocks: Object.fromEntries(o.repair.map(r => [r.blockId, r.previous])) } },
  });
  const res = await S.runNote(job, inputOf({ models: { plan: "m-plan", write: "m-write", writeAlt: alt, judge: null } }), depsOf(svc, bus));
  assert.equal(job.state, "done");
  const second = svc.calls.repair.filter(c => c.model === alt);
  assert.ok(second.length > 0, "2차 repair 는 대체 모델");
  assert.ok(bus.recent().some(e => e.code === "REPAIR_RESULT" && / alt=[1-9]/.test(e.msg)));
  assert.ok(res.note);
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

// ── allowedRefs: 모든 작성 호출이 같은 계획 전체 참조 목록을 싣는다 ──
test("allowedRefs: section·split·repair·T5·global calls all carry the same full-plan reference list", async () => {
  const { job, bus } = await setup();
  const svc = fakeService({
    section: o => { if (o.section.sectionId === "S1" && o.section.blocks.length > 2) throw svcErr("llm_output_truncated"); return pickOut(o); },
    repair: o => isT5(o) ? { output: { blocks: { S1_B3: fixedB3("고정비에는 일정 기간 조건이 붙는다는 점이 핵심이다") } } } : DEFAULTS.repair(o),
    judge: lowJudge(/함께 기억해 두면 좋다/),
  });
  const res = await S.runNote(job, inputOf(JUDGED), depsOf(svc, bus));
  assert.equal(job.state, "done");
  assert.equal(res.status, "partial"); // S3_B4 는 평소처럼 빠진다 — 이 테스트는 목록만 본다

  // 기대 목록은 요청에 실린 정규화 계획에서 만든다 — 섹션 첫 호출(조각이 아닌 전체)·전역 요청의 plan·개념 목록.
  const full = new Map();
  for (const c of svc.calls.section) if (!full.has(c.section.sectionId)) full.set(c.section.sectionId, c.section);
  const secs = [...full.values()].sort((a, b) => +a.sectionId.slice(1) - +b.sectionId.slice(1));
  const want = { targetIds: [], reviewIds: [] };
  for (const s of secs) {
    want.targetIds.push(s.sectionId);
    for (const b of s.blocks) {
      want.targetIds.push(b.blockId); want.reviewIds.push(b.blockId);
      if (b.type === "B08" || b.type === "B09") for (let i = 1; i <= 6; i++) want.targetIds.push(`${b.blockId}/P${i}`);
    }
  }
  for (const g of svc.calls.global[0].plan.global) want.targetIds.push(g.blockId);
  for (const c of svc.calls.section[0].concepts) if (c.depth === "defined") want.targetIds.push(c.conceptId);
  assert.deepEqual(want.targetIds.filter(id => id.includes("/P")), ["S4_B1/P1", "S4_B1/P2", "S4_B1/P3", "S4_B1/P4", "S4_B1/P5", "S4_B1/P6"], "단서 위치는 B09 블록뿐");
  assert.ok(want.targetIds.includes("C1") && !want.targetIds.includes("C7"), "defined 개념만 — mentioned(C7) 제외");
  assert.ok(want.targetIds.includes("GB1") && want.targetIds.includes("S3"), "전역 블록·섹션 id 는 대상 칸에 온다");
  assert.ok(!want.reviewIds.some(id => id.startsWith("GB")), "복습 위치에 전역 블록은 없다");
  assert.deepEqual(want.reviewIds, want.targetIds.filter(id => /^S\d+_B\d+$/.test(id)), "복습 위치는 섹션 블록 id 뿐");

  // 계획 요청에는 없다(계획이 아직 없다) — 작성·재작성·전역 호출은 모두 같은 목록을 싣는다.
  assert.ok(!("allowedRefs" in svc.calls.plan[0]), "plan 요청에는 allowedRefs 가 없다");
  const s1 = svc.calls.section.filter(c => c.section.sectionId === "S1");
  assert.deepEqual(s1.map(c => c.section.blocks.map(b => b.blockId)), [["S1_B1", "S1_B2", "S1_B3"], ["S1_B1", "S1_B2"], ["S1_B3"]], "S1 은 반으로 나눠 쓴다");
  assert.ok(svc.calls.repair.some(isT5), "T5(지지 부족) repair 도 나간다");
  for (const c of writersOf(svc)) assert.deepEqual(c.allowedRefs, want, `${c.stage} ${c.section?.sectionId ?? "global"}`);
});
function writersOf(svc) { return [...svc.calls.section, ...svc.calls.repair, ...svc.calls.global]; }

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
test("server promptVersions join the cache keys: a version change recomputes, an unknown version never caches", async () => {
  const { store, job, bus } = await setup(), svc = fakeService();
  const fixed = { now: () => new Date("2026-10-03T00:00:00.000Z") };
  await S.runNote(job, inputOf(), depsOf(svc, bus, fixed));
  const n = svc.all().length;
  const next = async (jobId, promptVersions) => {
    const j = await P.createJob({ jobId, packageId: "pkg", store, events: bus, now: clock() });
    await S.runNote(j, inputOf(), depsOf(svc, bus, { ...fixed, promptVersions }));
  };
  await next("j2", PV); // 같은 입력 + 같은 버전 — 호출 하나도 없다
  assert.equal(svc.all().length, n);
  // 서버 프롬프트만 바뀌어도 같은 입력의 낡은 결과를 재사용하면 안 된다 — 단계·호출 캐시 둘 다 갈린다
  await next("j3", { plan: "note-v6", section: "note-v6", repair: "note-v6", global: "note-v6", judge: "v2" });
  assert.equal(svc.calls.plan.length, 2, "계획도 다시 부른다");
  assert.equal(svc.calls.section.length, 10, "섹션도 전부 다시 쓴다");
  // 버전을 모르면(구 서버·오프라인) 캐시를 읽지도 쓰지도 않는다 — 두 실행이 서로에게도 재사용하지 않는다
  await next("j4", null);
  const n4 = svc.all().length;
  await next("j5", null);
  assert.ok(svc.all().length > n4, "버전 미보고 실행은 서로의 결과를 재사용하지 않는다");
});
test("a model or option change is a distinct cache key; consent flips pause the same run", async () => {
  const { store, job, bus } = await setup(), svc = fakeService();
  await S.runNote(job, inputOf(), depsOf(svc, bus));
  // 작성 모델만 바뀌면 계획·판정은 재사용하고 쓰기 이후만 다시 계산한다
  const j2 = await P.createJob({ jobId: "j2", packageId: "pkg", store, events: bus, now: clock() });
  await S.runNote(j2, inputOf({ models: { plan: "m-plan", write: "m-other", judge: null } }), depsOf(svc, bus));
  assert.equal(svc.calls.plan.length, 1, "계획은 재사용");
  assert.equal(svc.calls.section.length, 10, "섹션은 다시 쓴다");
  // 생성 옵션이 바뀌면 입력이 달라져 계획부터 다시 부른다
  const j3 = await P.createJob({ jobId: "j3", packageId: "pkg", store, events: bus, now: clock() });
  const res3 = await S.runNote(j3, inputOf({ options: { syntheticExamples: true } }), depsOf(svc, bus));
  assert.equal(svc.calls.plan.length, 2, "옵션 변경은 계획부터 새로");
  assert.equal(res3.status, "partial");
});
test("cacheStats counts local stage/call cache hits and misses", async () => {
  const { store, job, bus } = await setup(), svc = fakeService();
  const s1 = { hits: 0, misses: 0 };
  await S.runNote(job, inputOf(), depsOf(svc, bus, { cacheStats: s1 }));
  assert.equal(s1.hits, 0);
  assert.ok(s1.misses > 0);
  const j2 = await P.createJob({ jobId: "j2", packageId: "pkg", store, events: bus, now: clock() });
  const s2 = { hits: 0, misses: 0 };
  await S.runNote(j2, inputOf(), depsOf(svc, bus, { cacheStats: s2 }));
  assert.deepEqual(s2, { hits: 6, misses: 0 }, "6개 단계가 전부 캐시에서 나온다 — 호출은 하나도 없다");
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
      return { ...r, salvaged: { [target]: original, S9_B9: { x: 1 } }, salvagedErrors: { [target]: ["/content/scope/0/evidenceIds/1 패턴과 다릅니다"] } }; // 계획에 없는 id 는 버린다
    },
    repair: o => ({ output: { blocks: Object.fromEntries(o.repair.map(x => [x.blockId, x.previous])) } }),
  });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus));
  const sent = svc.calls.repair.flatMap(c => c.repair).find(x => x.blockId === target);
  assert.ok(sent, "서버가 비운 블록을 repair 로 보낸다");
  assert.deepEqual(sent.errors, [{ code: "VAL_SCHEMA", detail: ["/content/scope/0/evidenceIds/1 패턴과 다릅니다"] }], "서버가 찾은 오류 위치·사유를 그대로 싣는다");
  assert.ok(sent.previous && typeof sent.previous === "object");
  assert.ok(res.note.sections.find(s => s.sectionId === "S2").blocks.some(b => b.id === target), "고친 블록이 노트에 남는다");
  const held = bus.recent().find(e => e.code === "BLOCKS_HELD");
  assert.match(held.msg, /server=1/);
  assert.equal(bus.recent().find(e => e.code === "HELD_WHY").msg, "evidenceIds 패턴과 다릅니다=1");
  assert.match(bus.recent().find(e => e.code === "REPAIR_RESULT" && e.unit === "S2").msg, /^fixed=\d+ null=0 held_null=0 still_bad=\d+ alt=0$/);
});

test("support map: 주장별 첫 점수·최종 결과가 validating 단계 캐시에 보존된다", async () => {
  const { job, bus, store } = await setup();
  const svc = fakeService({ judge: lowJudge(/함께 기억해 두면 좋다/) });
  const res = await S.runNote(job, inputOf(JUDGED), depsOf(svc, bus));
  assert.equal(job.state, "done");
  // 단계 캐시에서 validating 결과({note, support})를 찾는다 — 평가 하네스·비교 화면이 같은 데이터를 읽는다.
  let support = null;
  for (const id of await store.ids("packages")) {
    const v = await store.getJson("packages", id).catch(() => null);
    if (v?.value?.note && v.value.support) support = v.value.support;
  }
  assert.ok(support, "support 맵이 단계 캐시에 있다");
  assert.ok(Object.keys(support.scores).every(k => /^S\d+_B\d+#\//.test(k)), "키는 블록id#경로");
  const lowKey = Object.entries(support.scores).find(([, s]) => s === 0.1)?.[0];
  assert.ok(lowKey, "낮은 주장의 첫 점수가 보존됐다");
  assert.equal(support.outcomes[lowKey], "direct", "복구 실패 저점수는 직접 보류 결과로 남는다");
  assert.ok(Object.values(support.outcomes).includes("kept"), "유지 주장도 결과에 있다");
  assert.ok(Object.values(support.outcomes).every(s => ["kept", "relinked", "fixed", "direct", "collateral", "unjudged"].includes(s)));
  // 캐시에 내용(주장 텍스트)이 아니라 구조 id 와 수치만 들어간다
  assert.ok(!JSON.stringify(support).includes("함께 기억해 두면 좋다"), "점수 맵에 강의 문장이 없다");
  void res;
});

// ── W2-D: 연결 편집(link)과 본문 확정 뒤 문항(questions) — draft 경로(deps.writer==="draft") + deps.linkEditor ──
// W2-A 계약: draft 경로에서는 B14 계획 블록이 작성 출력에서 null 로 온다.
const DRAFT_B14 = o => { const r = pickOut(o); for (const b of o.section.blocks) if (b.type === "B14") r.output.blocks[b.blockId] = null; return r; };
// draft 경로용 가짜 — 작성 픽스처 봉투를 초안(주장+typed 관계)으로 되돌려 보내 compileDraft 가 같은 봉투로 다시
// 조판하게 한다. B14 는 초안이 표현하지 못한다 — compileDraft 가 그 계획 블록을 null 로 둔다(위 계약 그대로).
// 계획에 있는데 픽스처에 없는 타입(B03·B08·B13)은 초안을 못 만든다 — 이 픽스처 계획에는 없다.
const draftFixture = o => {
  const first = WRITER.sections[o.section.sectionId].first, claims = [], rels = {};
  let n = 0, em = null;
  const put = (c, role, conceptIds = []) => { // 블록의 첫 주장이 봉투 emphasis(있으면)를 물려받는다
    claims.push({ claimId: "c" + ++n, role, text: c.text, basis: c.basis, evidenceIds: [...c.evidenceIds], conceptIds, dependsOn: [], emphasis: em });
    em = null; return "c" + n;
  };
  const add = (kind, env, r) => (rels[kind] ??= []).push({ status: null, importance: env.importance ?? null, ...r });
  for (const pb of o.section.blocks) {
    const env = first.blocks[pb.blockId], c = env?.content;
    if (!c || pb.type === "B14") continue;
    em = env.emphasis?.[0] ?? null;
    switch (pb.type) {
      case "B05":
        put(c.definition, "definition", [c.conceptId]);
        if (c.explanation) put(c.explanation, "intuition", [c.conceptId]);
        if (c.mechanism) put(c.mechanism, "mechanism", [c.conceptId]);
        for (const x of c.scope ?? []) put(x, "condition", [c.conceptId]);
        for (const x of c.examples ?? []) put(x, "example", [c.conceptId]);
        break;
      case "B06": add("comparisons", env, { title: c.title,
        entities: c.entities.map(e => ({ label: e.label, conceptId: e.conceptId ?? null })),
        criteria: c.criteria.map(r => ({ label: r.label, cells: r.cells.map(x => x ? put(x, "comparison") : null) })),
        common: (c.common ?? []).map(x => put(x, "comparison")),
        discriminator: c.discriminator ? put(c.discriminator, "comparison") : null }); break;
      case "B07": add("arguments", env, { title: c.title, relationType: c.relationType,
        question: c.question ? put(c.question, "argument") : null,
        steps: c.steps.map(s => ({ role: s.role, claim: put(s.claim, "argument") })),
        missingLinks: (c.missingLinks ?? []).map(x => put(x, "argument")) }); break;
      case "B09": add("materials", env, { sourceTitle: c.sourceTitle, sourceKind: c.sourceKind, gist: put(c.gist, "notice"),
        quote: c.quote ? { text: c.quote.text, evidenceIds: [...c.quote.evidenceIds] } : null,
        points: (c.points ?? []).map(p => ({ clue: put(p.clue, "notice"), reading: put(p.reading, "notice") })),
        authorClaim: c.authorClaim ? put(c.authorClaim, "notice") : null,
        lecturerReading: c.lecturerReading ? put(c.lecturerReading, "notice") : null,
        limits: (c.limits ?? []).map(x => put(x, "notice")) }); break;
      case "B10": add("calcs", env, { title: c.title, kind: c.kind, goal: c.goal ? put(c.goal, "calculation") : null,
        formulaIds: [...c.formulaIds ?? []], figureIds: [...c.figureIds ?? []],
        variables: (c.variables ?? []).map(v => ({ symbol: v.symbol, meaning: put(v.meaning, "calculation"), unit: v.unit ?? null })),
        assumptions: (c.assumptions ?? []).map(x => put(x, "calculation")),
        inputs: (c.inputs ?? []).map(x => ({ label: x.label, value: x.value, unit: x.unit ?? null, evidenceIds: [...x.evidenceIds] })),
        steps: (c.steps ?? []).map(x => ({ label: x.label, op: x.op, a: x.a, b: x.b, value: x.value, unit: x.unit ?? null, digits: x.digits ?? null })),
        derived: [...c.derived ?? []], reading: (c.reading ?? []).map(x => put(x, "calculation")),
        result: c.result ? put(c.result, "calculation") : null, limits: (c.limits ?? []).map(x => put(x, "calculation")),
        withheld: c.withheld ? put(c.withheld, "calculation") : null }); break;
      case "B11": add("pitfalls", env, { misconception: put(c.misconception, "notice"), correction: put(c.correction, "notice"),
        conditions: (c.conditions ?? []).map(x => put(x, "notice")), origin: c.origin }); break;
      case "B12": add("notes", env, { kind: c.kind, note: put(c.note, "notice") }); break;
      case "B18": add("notices", env, { items: c.items.map(i => ({ topic: i.topic, claim: put(i.claim, "notice"), due: i.due ?? null })) }); break;
    }
    em = null;
  }
  const out = { sectionId: o.section.sectionId, gist: first.gist ? { text: first.gist.text, evidenceIds: [...first.gist.evidenceIds], basis: first.gist.basis } : null, claims, relations: { ...REL0(), ...rels }, checks: first.checks ?? [] };
  if (o.withGist === false) delete out.gist;
  return { output: out };
};
const LINK_ON = { writer: "draft", linkEditor: true };
const PVL = { ...PV, link: "note-v5", questions: "note-v5" };
const linkEdits = bus => bus.recent().find(e => e.code === "LINK_EDITS");

test("linkEditor gate: link/questions need BOTH the flag and the draft path; blocks path is untouched", async () => {
  for (const [tag, over] of [["플래그 없음", { writer: "draft" }], ["draft 아님", { linkEditor: true }]]) {
    const { job, bus } = await setup(), svc = fakeService({ section: DRAFT_B14, draft: draftFixture });
    const res = await S.runNote(job, inputOf(), depsOf(svc, bus, over));
    assert.equal(job.state, "done", tag);
    assert.deepEqual([svc.calls.link.length, svc.calls.questions.length], [0, 0], tag);
    assert.ok(!bus.recent().some(e => e.code === "LINK_EDITS" || e.code === "QUESTIONS_FILL"), tag);
    assert.deepEqual(res.note.dropped.map(d => d.blockId).sort(), ["S2_B5", "S3_B4", "S4_B2"], tag + ": null B14 는 기존 보류 그대로");
  }
  const { job, bus } = await setup(), svc = fakeService({ draft: draftFixture });
  await S.runNote(job, inputOf(), depsOf(svc, bus, LINK_ON));
  assert.equal(svc.calls.link.length, 1, "link 한 번");
  assert.deepEqual(svc.calls.questions.map(c => c.blockId).sort(), ["S2_B5", "S4_B2"], "null B14 마다 questions");
  assert.ok(linkEdits(bus), "LINK_EDITS 이벤트");
  assert.ok(bus.recent().some(e => e.code === "QUESTIONS_FILL"));
  // link 입력은 살아남은 주장의 축약이다 — 주장마다 봉투 경로가 붙고 근거 원문은 없다
  const linkReq = svc.calls.link[0];
  assert.ok(linkReq.sections.every(s => s.blocks.every(b => b.claims.every(c => typeof c.path === "string" && c.path.startsWith("/")))), "주장 경로");
  assert.ok(!JSON.stringify(linkReq).includes("이 구분은 시험에 꼭 나옵니다"), "근거 원문은 싣지 않는다");
});

test("link edits: rename/drop/flag apply surgically; bad targets and failed re-verification are rejected", async () => {
  const { job, bus } = await setup();
  const svc = fakeService({
    draft: draftFixture,
    link: () => ({ output: { edits: [
      { kind: "term", targets: ["S1_B3/content/note"], action: "rename_term", text: "고정비의 기간 조건은 정의의 일부로 함께 기억한다" },
      { kind: "term", targets: ["S2_B1/content/definition"], action: "rewrite", text: "손익분기점은 1937년에 정해졌다" }, // 인용 근거에 없는 숫자 → 재검증 실패 → 원복
      { kind: "duplicate", targets: ["S1_B2/content/definition", "S1_B1/content/scope/0"], action: "drop_duplicate", text: null },
      { kind: "contradiction", targets: ["S1_B1/content/definition", "S1_B2"], action: "flag", text: null },
      { kind: "term", targets: ["S9_B9/content/note"], action: "rename_term", text: "없는 블록" },
      { kind: "term", targets: ["S1_B1/content/definition", "S1_B2/content/definition"], action: "rename_term", text: "여러 대상" },
    ] } }),
  });
  const res = await S.runNote(job, inputOf(JUDGED), depsOf(svc, bus, LINK_ON));
  assert.equal(job.state, "done");
  const s1 = res.note.sections.find(s => s.sectionId === "S1");
  // rename_term — 그 주장의 문장만 바뀐다
  assert.equal(s1.blocks.find(b => b.id === "S1_B3").content.note.text, "고정비의 기간 조건은 정의의 일부로 함께 기억한다");
  // rewrite 가 근거 없는 숫자를 넣으면 재검증에서 튄다 — 원래 문장 그대로
  const s2b1 = res.note.sections.find(s => s.sectionId === "S2").blocks.find(b => b.id === "S2_B1");
  assert.ok(!s2b1.content.definition.text.includes("1937"), "재검증 실패 제안은 원복");
  // drop_duplicate — 첫 target 을 남기고 나머지 주장만 뺀다
  const s1b1 = s1.blocks.find(b => b.id === "S1_B1");
  assert.equal(s1b1.content.scope.length, 0, "중복 주장 하나만 빠진다");
  assert.equal(s1.blocks.find(b => b.id === "S1_B2").content.definition.text, "생산량에 비례해 늘어나는 비용을 변동비라고 한다", "keeper 는 그대로");
  // contradiction — 본문을 바꾸지 않고 확인 항목(input_conflict)으로 남는다
  assert.equal(s1.blocks.find(b => b.id === "S1_B1").content.definition.text.includes("고정비"), true, "모순 표시는 본문을 바꾸지 않는다");
  const conflict = s1.checks.filter(c => c.kind === "input_conflict");
  assert.equal(conflict.length, 1);
  assert.deepEqual(conflict[0].targetIds.sort(), ["S1_B1", "S1_B2"]);
  assert.equal(conflict[0].claim.text, s1.blocks.find(b => b.id === "S1_B1").content.definition.text, "확인 항목은 대상 주장을 가리킨다");
  assert.match(linkEdits(bus).msg, /term=4\/1\/3/, "term: rename 적용 + 나쁜 rewrite·없는 블록·다중 대상 거절");
  assert.match(linkEdits(bus).msg, /duplicate=1\/1\/0/);
  assert.match(linkEdits(bus).msg, /contradiction=1\/1\/0/);
  assert.ok(!/[가-힣]/.test(linkEdits(bus).msg), "이벤트는 수치만 — 내용 없음");
});

test("link rewrite rolls back when the T5 re-judgment of the edited claim fails", async () => {
  const { job, bus } = await setup();
  const svc = fakeService({
    draft: draftFixture,
    judge: lowJudge(/근거 밖의 주장/), // 재판정에서 새 문장만 낮게 나온다
    link: () => ({ output: { edits: [{ kind: "term", targets: ["S1_B3/content/note"], action: "rewrite", text: "근거 밖의 주장으로 바꿔 쓴다" }] } }),
  });
  const res = await S.runNote(job, inputOf(JUDGED), depsOf(svc, bus, LINK_ON));
  assert.equal(job.state, "done");
  const note = res.note.sections.find(s => s.sectionId === "S1").blocks.find(b => b.id === "S1_B3").content.note;
  assert.ok(note.text.includes("함께 기억해 두면 좋다"), "재판정 실패는 원래 문장을 유지한다");
  assert.match(linkEdits(bus).msg, /term=1\/0\/1/);
  // 재판정이 실제로 나갔다 — 마지막 support 호출이 새 문장이다
  const last = svc.calls.judge.filter(c => c.task === "support").at(-1);
  assert.ok(last.items.some(i => i.text.includes("근거 밖의 주장")), "바뀐 주장만 재판정");
});

test("questions fills deferred B14 from surviving claims only; refs are narrowed to live blocks; failure keeps null", async () => {
  const { job, bus } = await setup();
  // S4 의 살아남은 본문은 S4_B1 뿐 — 문항의 대상·복습 참조가 그 안에서 나와야 한다.
  const S4_Q = { status: "supported", importance: "supporting", emphasis: [], content: { items: [{ kind: "ox", prompt: { text: "응답 점포 62%가 매출이 늘었다고 답했다", evidenceIds: ["U5.s3"], basis: "lecture" }, premise: null, level: "basic", targetIds: ["S4_B1"], answer: { verdict: "O", explanation: { text: "자료에 응답 점포의 62%가 매출이 늘었다고 답했다고 적혀 있다", evidenceIds: ["U5.s3"], basis: "lecture" }, correction: null, rubric: [], alternatives: [], reviewIds: ["S4_B1"] } }] } };
  const svc = fakeService({
    draft: draftFixture,
    questions: o => ({ output: { blocks: { [o.blockId]: o.blockId === "S2_B5" ? WRITER.sections.S2.repair.blocks.S2_B5 : S4_Q } } }),
  });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus, LINK_ON));
  assert.equal(job.state, "done");
  const s2 = res.note.sections.find(s => s.sectionId === "S2");
  assert.ok(s2.blocks.some(b => b.id === "S2_B5" && b.type === "B14"), "B14 가 본문 확정 뒤 채워진다");
  const s4 = res.note.sections.find(s => s.sectionId === "S4");
  assert.ok(s4.blocks.some(b => b.id === "S4_B2"), "S4 의 B14 도 채워진다");
  // questions 요청: 채울 블록 id · 계획 섹션 · 살아남은 주장 목록 · 좁힌 참조
  for (const c of svc.calls.questions) {
    assert.ok(["S2_B5", "S4_B2"].includes(c.blockId));
    assert.ok(c.sections.every(s => s.blocks.every(b => b.claims.every(cl => !("path" in cl)))), "문항 입력에는 경로 없음");
    assert.ok(!c.allowedRefs.reviewIds.includes("S3_B4"), "죽은 블록은 복습 목록에 없다");
    assert.ok(!c.allowedRefs.reviewIds.includes("S4_B2"), "아직 null 인 B14 도 목록에 없다");
  }
  assert.ok(svc.calls.questions.find(c => c.blockId === "S4_B2").allowedRefs.reviewIds.includes("S4_B1"), "살아남은 본문 블록만 목록에 있다");
  assert.ok(!JSON.stringify(svc.calls.questions.map(c => c.sections)).includes("이 구분은 시험에 꼭 나옵니다"), "문항 입력도 근거 원문 없이");
  assert.match(bus.recent().find(e => e.code === "QUESTIONS_FILL").msg, /filled=2 of=2/);
  // 답·해설이 살아남은 본문을 가리키고 기존 문항 검증을 그대로 통과한다
  const q = s4.blocks.find(b => b.id === "S4_B2").content.items[0];
  assert.deepEqual(q.answer.reviewIds, ["S4_B1"]);
  const nv = Contracts.validate(NoteContract.schemas.note, res.note);
  assert.ok(nv.ok, JSON.stringify(nv.errors));

  // questions 호출 실패 → 그 블록은 null(기존 보류)로 남는다
  const { job: job2, bus: bus2 } = await setup({ jobId: "j2" });
  const svc2 = fakeService({ draft: draftFixture, questions: () => { throw svcErr("request_rejected"); } });
  const res2 = await S.runNote(job2, inputOf(), depsOf(svc2, bus2, LINK_ON));
  assert.equal(job2.state, "done");
  for (const bid of ["S2_B5", "S4_B2"]) assert.ok(res2.note.dropped.some(d => d.blockId === bid), bid + " 보류 유지");
});

// QUESTIONS_SKIP은 오류 코드와 HTTP 상태만 싣는다(내용 없음) — 서비스가 error 봉투 없는 본문을 돌려줄 때
// 코드가 "unknown_error"로 뭉개지는데(2026-10-07 실황 S2_B8), 상태가 있어야 400·429·500을 구분한다.
test("QUESTIONS_SKIP carries the error code and HTTP status, and a halting error still stops the job", async () => {
  const { job, bus } = await setup();
  const svc = fakeService({ draft: draftFixture, questions: () => { throw svcErr("unknown_error", { status: 400 }); } });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus, LINK_ON));
  assert.equal(job.state, "done");
  const skips = bus.recent().filter(e => e.code === "QUESTIONS_SKIP");
  assert.ok(skips.length >= 2);
  for (const e of skips) assert.match(e.msg, /^S\d_B\d+ unknown_error http=400$/);
  assert.ok(res.note.dropped.some(d => d.blockId === "S2_B5"), "건너뛴 블록은 보류 그대로");

  // 한도처럼 멈춰야 하는 오류는 건너뛰지 않고 작업이 멈춘다
  const { job: job2, bus: bus2 } = await setup({ jobId: "j2" });
  const svc2 = fakeService({ draft: draftFixture, questions: () => { throw svcErr("quota_exceeded"); } });
  const res2 = await S.runNote(job2, inputOf(), depsOf(svc2, bus2, LINK_ON));
  assert.equal(job2.state, "paused");
  assert.equal(res2.status, "paused");
  assert.equal(res2.code, "QUOTA_EXCEEDED");
});

// devNoteMode 실험 스위치: 켜져 있는데 네 모드가 아니면 읽기 실패다 — 기본 경로로 조용히 넘어가지 않는다.
test("an unknown noteMode fails closed instead of silently running the production path", async () => {
  const { job, bus } = await setup(), svc = fakeService();
  await assert.rejects(() => S.runNote(job, inputOf(), depsOf(svc, bus, { noteMode: "bogus" })), e => e?.code === "NOTE_MODE_INVALID");
  assert.equal(svc.all().length, 0, "서비스 호출 없이 멈춘다");
  // 일곱 모드는 그대로 받는다 — NOTE_MODE 이벤트가 나가는 것이 스위치 판정 통과의 증거다(그 뒤 계약·픽스처 오류는 무관).
  for (const m of ["independent", "sol-session", "sol-luna-tool", "sol-fork", "sol-luna-2", "sol-luna-3", "sol-fork-2"]) {
    const b = await setup({ jobId: "ok-" + m }), s2 = fakeService();
    let threw = null;
    await S.runNote(b.job, inputOf(), depsOf(s2, b.bus, { noteMode: m })).catch(e => { threw = e; });
    assert.notEqual(threw?.code, "NOTE_MODE_INVALID", m);
    assert.ok(b.bus.recent().some(e => e.code === "NOTE_MODE" && e.msg === m), m + ": 모드가 켜졌다");
  }
});

test("linkEditor toggling changes the validating cache key — same input recomputes with the flag", async () => {
  const { store, job, bus } = await setup(), svc = fakeService({ draft: draftFixture });
  const fixed = { now: () => new Date("2026-10-03T00:00:00.000Z") };
  await S.runNote(job, inputOf(), depsOf(svc, bus, { ...fixed, writer: "draft" })); // 플래그 꺼짐
  assert.equal(svc.calls.link.length, 0);
  const j2 = await P.createJob({ jobId: "j2", packageId: "pkg", store, events: bus, now: clock() });
  await S.runNote(j2, inputOf(), depsOf(svc, bus, { ...fixed, writer: "draft", linkEditor: true, promptVersions: PVL }));
  assert.equal(svc.calls.plan.length, 1, "계획은 재사용 — 플래그는 입력이 아니라 단계 키에 섞는다");
  assert.equal(svc.calls.draft.length, 5, "작성도 재사용");
  assert.equal(svc.calls.link.length, 1, "플래그가 바뀌면 validating 은 다른 키 — 다시 계산한다");
  assert.equal(svc.calls.questions.length, 2);
});

// ── 의미 초안 작성 경로(W2-A) ──
test("writer \"draft\": sections are written as claims + typed relations, then compiled to envelopes", async () => {
  const { job, bus } = await setup(), svc = fakeService({ draft: draftFor });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus, { writer: "draft" }));
  assert.equal(job.state, "done");
  assert.equal(svc.calls.draft.length, 5, "섹션마다 draft 호출");
  assert.equal(svc.calls.section.length, 0, "blocks 경로는 호출되지 않는다");
  assert.ok(svc.calls.draft.every(c => c.stage === "draft"));
  // S3 초안이 봉투로 컴파일돼 검증·조립을 통과했다 — 나머지 섹션은 빈 초안이라 전부 보류(부분 노트)
  const nv = Contracts.validate(NoteContract.schemas.note, res.note);
  assert.ok(nv.ok, JSON.stringify(nv.errors));
  assert.equal(res.status, "partial");
  const s3 = res.note.sections.find(s => s.sectionId === "S3");
  assert.equal(s3.blocks.length, 4, "S3 의 네 블록이 살아남는다");
});

test("writer mode joins the writing-stage cache key — switching writers recomputes writing but reuses planning", async () => {
  const { store, job, bus } = await setup(), svc = fakeService();
  await S.runNote(job, inputOf(), depsOf(svc, bus)); // 기본 blocks 경로
  const j2 = await P.createJob({ jobId: "j2", packageId: "pkg", store, events: bus, now: clock() });
  await S.runNote(j2, inputOf(), depsOf(svc, bus, { writer: "draft" }));
  assert.equal(svc.calls.plan.length, 1, "계획은 재사용한다 — writer 는 쓰기 단계 키에만 든다");
  assert.equal(svc.calls.draft.length, 5, "같은 입력도 draft 경로로 다시 쓴다(A/B 비교)");
});

test("writer \"draft\": truncation splits a section into plan-block parts, each part's draft compiled separately", async () => {
  const { job, bus } = await setup(), svc = fakeService({
    draft: o => { if (o.section.sectionId === "S3" && o.section.blocks.length > 2) throw svcErr("llm_output_truncated"); return draftFor(o); },
  });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus, { writer: "draft" }));
  assert.equal(job.state, "done");
  // S3(4블록)이 잘리면 반씩 나눠 두 조각으로 다시 쓴다 — 1회 실패 + 2회 성공
  assert.equal(svc.calls.draft.filter(c => c.section.sectionId === "S3").length, 3);
  assert.equal(bus.recent().find(e => e.msg?.startsWith("split"))?.code, "LLM_TRUNCATED");
  const s3 = res.note.sections.find(s => s.sectionId === "S3");
  assert.equal(s3.blocks.length, 4, "두 조각의 초안이 합쳐져 네 블록이 살아남는다");
});

// ── v2 오케스트레이션(sol-luna-2 / sol-fork-2) ──
// v2 는 plan 응답(plan+이어 쓸 history)과 editorial 응답(editorialPlan+앵커로 끝나는 history=고정 접두 P)이 따로 온다 — 한 호출에 합치면 Sol 출력이 Edge 150초를 넘는다.
const ANCHOR = { role: "user", content: [{ type: "input_text", text: "v2-anchor" }] };
const epOf = deps => ({ v: 1, glossary: [{ conceptId: "C1", preferredTerm: "고정비", aliases: ["고정 비용"], evidenceIds: ["U1.s2"] }],
  sections: PLANNER.sections.map(s => ({ sectionId: s.sectionId, learningQuestion: s.title, learningItemIds: [], prerequisiteSectionIds: deps?.[s.sectionId] ?? [],
    mustExplain: [], owns: [], referencesOnly: [], visuals: [], targetOutputTokens: 1200 })) });
// v2 가짜 서비스: plan 응답은 이어 쓸 history, editorial 응답은 편집 계획+고정 접두 P. 세션 호출은 받은 history 를 그대로 돌려준다(포크 규칙 — 응답이 접두를 대체하지 않는다).
const v2Service = (over = {}) => {
  const svc = fakeService(over), innerWrite = svc.write, env = (o, history) => ({ v: 1, id: o.noteSession.id, mode: o.noteSession.mode, history });
  svc.plan = o => { assertRequest(o); svc.calls.plan.push(o);
    return Promise.resolve({ plan: deep(PLANNER), promptVersion: "note-v2", noteSession: env(o, [...(o.noteSession?.history ?? []), { task: "plan" }]) }); };
  svc.write = o => {
    if (o.stage === "editorial") {
      assertRequest(o); svc.calls.editorial.push(o);
      const P = [...o.noteSession.history, { task: "editorial" }, deep(ANCHOR)];
      svc.prefix = () => P;
      return Promise.resolve({ editorialPlan: "editorialPlan" in over ? over.editorialPlan : epOf(), noteSession: env(o, P) });
    }
    assertRequest(o);
    return innerWrite(o).then(r => o.noteSession ? { ...r, noteSession: env(o, o.noteSession.history) } : r);
  };
  return svc;
};
// S1·S2·S3 를 살리는 초안 — S1 의 B05(core)는 선행 핵심 주장 재료, S2 는 B14 문항이 비는 생존 섹션이다. S4·S5 는 빈 초안(전부 보류).
const DRAFT_V2_S1 = () => draftOf("S1", [
  dclaim("c1", "definition", "생산량과 관계없이 일정 기간 동안 발생하는 비용을 고정비라고 한다", ["U1.s2", "U1.t2"], ["C1"]),
  dclaim("c2", "definition", "생산량에 비례해 늘어나는 비용을 변동비라고 한다", ["U1.s3", "U1.t3"], ["C2"]),
]);
const DRAFT_V2_S2 = () => draftOf("S2", [
  dclaim("c1", "definition", "판매가격에서 단위당 변동비를 뺀 값을 공헌이익이라고 한다", ["U2.s4", "U2.t1"], ["C3"]),
  dclaim("c2", "definition", "고정비를 개당 공헌이익으로 나눈 판매량을 손익분기점이라고 한다", ["U2.t3"], ["C4"]),
  dclaim("c3", "example", "정정된 고정비로 계산한 손익분기 판매량 사례가 나온다", ["U3.t2"], ["C3"]),
]);
// v2 모드의 초안 스키마는 nullReasons(필수·null 허용)를 갖는다 — 사유를 안 채운 초안은 null 이다.
// review 수정 제안의 change 는 strict 스키마라 다섯 칸을 모두 가진다 — op 가 안 쓰는 칸은 null/빈 배열이다.
const chg = o => ({ text: null, claim: null, keepTargetId: null, assetIds: [], note: null, ...o });
const withNullReasons = d => ({ nullReasons: null, ...d });
const v2Draft = o => ({ output: withNullReasons(o.section.sectionId === "S1" ? deep(DRAFT_V2_S1()) : o.section.sectionId === "S2" ? deep(DRAFT_V2_S2()) : o.section.sectionId === "S3" ? deep(DRAFT_S3) : draftOf(o.section.sectionId, [], {})) });

for (const lunaMode of ["sol-luna-2", "sol-luna-3"]) test(`${lunaMode}: 단계→모델 표 — Sol 은 plan·review·global·repair, Luna High 는 draft·questions(독립 호출)`, async () => {
  const { job, bus } = await setup(), svc = v2Service({ draft: v2Draft });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus, { writer: "draft", noteMode: lunaMode, noteV3: { repair: "full-p", resume: true } }));
  assert.equal(job.state, "done");
  assert.equal(svc.calls.plan[0].model, "openai/gpt-6.1-sol");
  for (const c of svc.calls.draft) assert.equal(c.model, "openai/gpt-6-luna@high", c.stage);
  assert.ok(svc.calls.questions.length >= 1, "S2 의 B14 를 채우는 문항 호출이 있다");
  for (const c of svc.calls.questions) assert.equal(c.model, "openai/gpt-6-luna@high");
  for (const c of [...svc.calls.review, ...svc.calls.global, ...svc.calls.repair]) assert.equal(c.model, "openai/gpt-6.1-sol", c.stage);
  // Luna 호출은 세션 봉투를 싣지 않고, Sol 단계는 계획이 남긴 고정 접두 P 만 싣는다 — 응답 history 가 P 를 대체하지 않는다.
  assert.ok([...svc.calls.draft, ...svc.calls.questions].every(c => !("noteSession" in c)), "Luna 호출에 noteSession 없음");
  for (const c of [...svc.calls.review, ...svc.calls.global, ...svc.calls.repair]) assert.deepEqual(c.noteSession.history, svc.prefix(), c.stage + " — 고정 접두 P");
  assert.equal(svc.calls.link.length, 0, "link 단계는 두 v2 모드에서 실행되지 않는다");
  assert.equal(svc.calls.review.length, 1, "통합 검수는 정확히 한 번");
  // 계획→편집 계획은 같은 세션의 두 번째 Sol 턴이다: editorial 은 plan 응답의 history 를 이어 쓰고 그 응답이 P 가 된다.
  assert.equal(svc.calls.editorial.length, 1, "편집 계획은 정확히 한 번");
  assert.equal(svc.calls.editorial[0].model, "openai/gpt-6.1-sol");
  assert.deepEqual(svc.calls.editorial[0].noteSession.history, [{ task: "plan" }], "plan 응답의 history 를 이어 쓴다");
  assert.deepEqual(svc.calls.plan[0].noteSession.history, [], "계획 호출은 빈 이력으로 시작");
  const nv = Contracts.validate(NoteContract.schemas.note, res.note);
  assert.ok(nv.ok, JSON.stringify(nv.errors));
});

test("sol-fork-2: 모든 쓰기 호출이 Sol 이고 고정 접두 P 를 싣는다 — 응답이 P 를 대체하지 않는다", async () => {
  const { job, bus } = await setup(), svc = v2Service({ draft: v2Draft });
  await S.runNote(job, inputOf(), depsOf(svc, bus, { writer: "draft", noteMode: "sol-fork-2" }));
  assert.equal(job.state, "done");
  const writes = [...svc.calls.draft, ...svc.calls.review, ...svc.calls.global, ...svc.calls.repair, ...svc.calls.questions];
  assert.ok(writes.length >= 8, "draft×5 + review + repair + global");
  for (const c of writes) {
    assert.equal(c.model, "openai/gpt-6.1-sol", c.stage);
    assert.deepEqual(c.noteSession.history, svc.prefix(), c.stage + " — 고정 접두만 싣는다");
  }
  assert.equal(svc.calls.link.length, 0);
});

test("v2 작성은 초기 동시성 4 — 풀이 그 상한을 넘지 않는다", async () => {
  let inflight = 0, max = 0;
  const svc = v2Service({ draft: async o => { inflight++; max = Math.max(max, inflight); await new Promise(r => setTimeout(r, 15)); inflight--; return { output: withNullReasons(draftOf(o.section.sectionId, [], {})) }; } });
  const { job, bus } = await setup();
  await S.runNote(job, inputOf(), depsOf(svc, bus, { writer: "draft", noteMode: "sol-luna-2" }));
  assert.equal(job.state, "done");
  assert.ok(max <= 4 && max >= 2, `max=${max} — 5개 섹션이 병렬로 나가되 상한은 4`);
});

test("sol-fork-2 웜업 게이트: 첫 Sol 쓰기 호출이 끝난 뒤에만 다음 호출이 시작한다", async () => {
  const order = [];
  const svc = v2Service({ draft: async o => { const id = o.section.sectionId; order.push("s" + id); await new Promise(r => setTimeout(r, 5)); order.push("e" + id); return { output: withNullReasons(draftOf(id, [], {})) }; } });
  const { job, bus } = await setup();
  await S.runNote(job, inputOf(), depsOf(svc, bus, { writer: "draft", noteMode: "sol-fork-2" }));
  assert.equal(job.state, "done");
  const fi = order.findIndex(x => x.startsWith("s")), fid = order[fi].slice(1);
  const next = order.findIndex((x, i) => i > fi && x.startsWith("s"));
  assert.ok(next === -1 || order.indexOf("e" + fid) < next, "첫 호출 종료 전에 두 번째가 시작했다: " + order.join(","));
});

test("sol-luna-2 Luna 패킷: 용어·이 섹션 명세·검증된 선행 핵심 주장만 — history·다른 섹션 명세 없음", async () => {
  const { job, bus } = await setup(), svc = v2Service({ draft: v2Draft, editorialPlan: epOf({ S3: ["S1"] }) });
  await S.runNote(job, inputOf(), depsOf(svc, bus, { writer: "draft", noteMode: "sol-luna-2" }));
  assert.equal(job.state, "done");
  const s3 = svc.calls.draft.find(c => c.section.sectionId === "S3"), ep = s3.editorialPlan;
  assert.equal(ep.v, 1);
  assert.equal(ep.section.sectionId, "S3");
  assert.deepEqual(ep.section.prerequisiteSectionIds, ["S1"]);
  assert.ok(ep.glossary[0].conceptId === "C1");
  // 검증을 통과한 S1 의 핵심(B05=core) 주장만 실린다 — 선행이 아닌 섹션의 주장은 없다
  assert.ok(Array.isArray(ep.prerequisites) && ep.prerequisites.length > 0);
  assert.ok(ep.prerequisites.every(c => c.sectionId === "S1"), "선행 섹션의 주장만");
  assert.ok(ep.prerequisites.some(c => c.text === "생산량과 관계없이 일정 기간 동안 발생하는 비용을 고정비라고 한다"));
  for (const c of svc.calls.draft) {
    assert.ok(!("noteSession" in c), "세션 봉투 없음");
    assert.ok(!("sections" in c.editorialPlan), "전체 편집 계획을 싣지 않는다 — 이 섹션 명세뿐");
  }
  assert.equal(svc.calls.draft.find(c => c.section.sectionId === "S2").editorialPlan.prerequisites, undefined, "독립 섹션은 선행 없이 병렬");
  // 의존 게이트: S3 는 S1 작성이 끝난 뒤에만 발송된다 — 호출 시각이 아니라 패킷 내용으로도 증명됐지만 둘 다 본다
  const ended = [];
  const svc2 = v2Service({ editorialPlan: epOf({ S3: ["S1"] }), draft: async o => { await new Promise(r => setTimeout(r, o.section.sectionId === "S1" ? 20 : 0)); ended.push(o.section.sectionId); return { output: draftOf(o.section.sectionId, [], {}) }; } });
  const b = await setup({ jobId: "dep" });
  await S.runNote(b.job, inputOf(), depsOf(svc2, b.bus, { writer: "draft", noteMode: "sol-luna-2" }));
  assert.ok(ended.indexOf("S1") < ended.indexOf("S3"), "S3 는 S1 완료 뒤에 쓴다");
});

test("v2 검수: claim_edit 은 재검증 통과분만 반영하고 실패분은 원복된다 — 미해결 목록은 코드로 남는다", async () => {
  const { job, bus } = await setup();
  const svc = v2Service({ draft: v2Draft, review: o => {
    const b = o.sections.flatMap(s => s.blocks).find(x => x.claims.length), c = b.claims[0];
    return { output: { edits: [
      { op: "claim_edit", targetId: `${b.blockId}${c.path}`, reasonCode: "clarity", evidenceIds: [], change: chg({ text: `${c.text.slice(0, 200)}.` }) },
      { op: "claim_edit", targetId: `${b.blockId}${c.path}`, reasonCode: "fabricated", evidenceIds: [], change: chg({ text: `${c.text.slice(0, 180)} 그리고 9999원이라는 수치를 둔다` }) },
      { op: "claim_edit", targetId: "S99_B1/content/term", reasonCode: "unknown_target", evidenceIds: [], change: chg({ text: "없는 대상" }) },
      { op: "bogus_op", targetId: "S1_B1", reasonCode: "x", change: {} },
    ], unresolved: [{ targetId: "S2_B3", reasonCode: "needs_section_redo" }] } };
  } });
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus, { writer: "draft", noteMode: "sol-fork-2" }));
  assert.equal(job.state, "done");
  assert.equal(svc.calls.review.length, 1, "검수는 한 번");
  const ev = bus.recent().find(e => e.code === "REVIEW_EDITS");
  assert.ok(ev && /claim_edit=3\/1\/2/.test(ev.msg), "제안 3·채택 1·거절 2: " + ev?.msg);
  assert.ok(bus.recent().some(e => e.code === "REVIEW_UNRESOLVED" && e.msg.includes("S2_B3:needs_section_redo")), "미해결 표면화");
  const nv = Contracts.validate(NoteContract.schemas.note, res.note);
  assert.ok(nv.ok, JSON.stringify(nv.errors));
});

test("v2: 편집 계획이 없거나 계획 섹션 범위와 어긋나면 코드로 멈춘다 — 구 계획 폴백 없음", async () => {
  for (const [tag, bad] of [["누락", null], ["빈 sections", { v: 1, sections: [] }], ["버전", { v: 2, sections: epOf().sections }],
    ["섹션 누락", { v: 1, sections: epOf().sections.slice(1) }], ["모르는 섹션", { v: 1, sections: [...epOf().sections, { sectionId: "S9" }] }]]) {
    const { job, bus } = await setup(), svc = v2Service({ editorialPlan: bad });
    const res = await S.runNote(job, inputOf(), depsOf(svc, bus, { writer: "draft", noteMode: "sol-luna-2" }));
    assert.equal(res.status, "failed", tag);
    assert.equal(res.code, "EDITORIAL_PLAN_INVALID", tag);
    assert.ok(bus.recent().some(e => e.code === "EDITORIAL_PLAN_INVALID"), tag);
    assert.equal(svc.calls.draft.length, 0, tag + ": 계획 단계에서 멈춘다");
  }
});

test("v2 사전검사: writer=draft·review 지원이 없는 서버면 NOTE_V2_UNSUPPORTED 로 멈춘다", async () => {
  for (const [tag, over] of [["writer 미지원", { writer: "blocks" }], ["review 버전 없음", { writer: "draft", promptVersions: { ...PV, review: undefined } }], ["promptVersions 없음", { writer: "draft", promptVersions: null }]]) {
    const { job, bus } = await setup(), svc = v2Service();
    await assert.rejects(() => S.runNote(job, inputOf(), depsOf(svc, bus, { ...over, noteMode: "sol-luna-2" })), e => e?.code === "NOTE_V2_UNSUPPORTED", tag);
    assert.ok(bus.recent().some(e => e.code === "NOTE_V2_UNSUPPORTED"), tag);
    assert.equal(svc.all().length, 0, tag + ": 서비스 호출 없이 멈춘다");
  }
});

test("v2: 작성자 null 블록은 regenerate_missing 1회 후보다 — 근거 부족 사유는 우회 호출 없이 보류", async () => {
  const { job, bus } = await setup();
  const svc = v2Service({ draft: o => ({ output: { ...draftOf(o.section.sectionId, [], {}), nullReasons: Object.fromEntries(o.section.blocks.map((b, i) => [b.blockId, i === 0 ? "insufficient_evidence" : "unsupported_format"])) } }) });
  await S.runNote(job, inputOf(), depsOf(svc, bus, { writer: "draft", noteMode: "sol-fork-2" }));
  assert.equal(job.state, "done");
  const entries = svc.calls.repair.flatMap(c => c.repair);
  assert.ok(entries.length > 0, "작성자 null 블록도 repair 후보다");
  for (const r of entries) {
    assert.equal(r.mode, "regenerate_missing");
    assert.equal(r.previous, null);
    assert.equal(r.errors[0].code, "VAL_BLOCK_DECLINED");
  }
  // 각 섹션 첫 블록(insufficient_evidence)은 우회 호출 없이 보류로 둔다 — 모델 사유를 그대로 믿지 않고 분류한다
  assert.ok(!entries.some(r => r.errors[0].detail[0] === "insufficient_evidence"), "근거 부족 사유는 재생성하지 않는다");
  assert.ok(svc.calls.repair.every(c => c.model === "openai/gpt-6.1-sol" && c.noteSession), "선택적 복구는 Sol(P)");
});

// 선행 합계 상한 회귀: 선행 섹션이 2개 이상이면 prerequisites 가 서버 계약(lunaPacket ≤12)을 넘겨 거절됐다(필드: S4·S5 no-output).
test("sol-luna-2 draft: prerequisites from 2+ predecessor sections are capped at 12 and include every predecessor", async () => {
  // 선행 S1·S2 각각에 core(B05) 주장이 12개 이상 나오는 초안 — 합계가 상한을 넘는다.
  const ROLES = [["definition", "정의"], ["intuition", "직관"], ["mechanism", "작동 원리"], ["condition", "성립 조건 첫째"], ["condition", "성립 조건 둘째"], ["example", "사례 첫째"], ["example", "사례 둘째"], ["example", "사례 셋째"]];
  const big = (sectionId, pairs) => draftOf(sectionId, pairs.flatMap(([cid, word, evs], g) => ROLES.map(([role, w], i) => dclaim(`c${g * 8 + i + 1}`, role, `${word}의 ${w}를 설명한다`, evs, [cid]))));
  const svc = v2Service({ editorialPlan: epOf({ S3: ["S1", "S2"] }), draft: o => ({ output: withNullReasons(
    o.section.sectionId === "S1" ? big("S1", [["C1", "고정비", ["U1.s2", "U1.t2"]], ["C2", "변동비", ["U1.s3", "U1.t3"]]])
      : o.section.sectionId === "S2" ? big("S2", [["C3", "공헌이익", ["U2.s4", "U2.t1"]], ["C4", "손익분기점", ["U2.t3", "U3.t2"]]])
      : draftOf(o.section.sectionId, [], {})) }) });
  const { job, bus } = await setup();
  const res = await S.runNote(job, inputOf(), depsOf(svc, bus, { writer: "draft", noteMode: "sol-luna-2" }));
  assert.equal(res.status, "partial");
  const s3 = svc.calls.draft.find(c => c.section.sectionId === "S3");
  assert.ok(s3, "S3 초안 요청이 나갔다 — prereq 가 상한을 넘으면 서버가 거절해 이 호출이 없다");
  const pre = s3.editorialPlan.prerequisites;
  assert.ok(Array.isArray(pre) && pre.length <= 12, `합계 ${pre.length} — lunaPacket 상한은 12`);
  assert.ok(pre.some(c => c.sectionId === "S1") && pre.some(c => c.sectionId === "S2"), "선행 섹션마다 최소 한 개는 실린다");
});
