const test = require("node:test");
const assert = require("node:assert/strict");
const Contracts = require("./contracts.js");
const NC = require("./note-contract.js");

const C = (text = "주장입니다") => ({ text, evidenceIds: ["U1.s1"], basis: "lecture" });
const env = content => ({ status: "supported", importance: "core", emphasis: [], content });
const clone = o => JSON.parse(JSON.stringify(o));

// 타입별 최소 유효 content — 모든 필수 슬롯을 채운다.
const contents = {
  B02: { question: C(), mode: "conclusions", items: [{ claim: C(), reason: null, targetIds: ["S1"] }] },
  B03: {
    title: "지도",
    nodes: [{ key: "n1", label: "정의", targetId: null }, { key: "n2", label: "예시", targetId: "S1" }],
    edges: [{ from: "n1", to: "n2", relation: "includes", claim: null }],
  },
  B05: { conceptId: "C1", term: "한계비용", original: null, definition: C(), explanation: null, mechanism: null, scope: [], examples: [] },
  B06: {
    title: "비교",
    entities: [{ label: "A", conceptId: null }, { label: "B", conceptId: "C1" }],
    criteria: [{ label: "기준", cells: [C(), null] }],
    common: [], discriminator: null,
  },
  B07: {
    title: "논증", relationType: "argument", question: null,
    steps: [{ role: "premise", claim: C() }, { role: "claim", claim: C() }],
    missingLinks: [],
  },
  B08: {
    caseTitle: "사례", source: "lecture_case", situation: C(),
    points: [{ clue: C(), reading: C() }],
    appliedConceptIds: [], judgment: null, limits: [], decision: null,
  },
  B09: {
    sourceTitle: "자료", sourceKind: "text", gist: C(), quote: null,
    points: [], authorClaim: null, lecturerReading: null, limits: [],
  },
  B10: {
    title: "계산", kind: "calc", goal: null, formulaIds: [], figureIds: [],
    variables: [], assumptions: [], inputs: [], steps: [],
    derived: [], reading: [], result: null, limits: [], withheld: null,
  },
  B11: { misconception: C(), correction: C(), conditions: [], origin: "lecture_correction" },
  B12: { kind: "term", note: C() },
  B13: { title: "연결", propositions: [{ relation: "common", claim: C(), targetIds: ["C1"] }] },
  B14: {
    items: [{
      kind: "recall", prompt: C(), premise: null, level: "basic", targetIds: ["S1_B1"],
      answer: { verdict: null, explanation: C(), correction: null, rubric: [], alternatives: [], reviewIds: ["S1_B1"] },
    }],
  },
  B18: { items: [{ topic: "exam", claim: C(), due: null }] },
};

const planSection = {
  sectionId: "S1", title: "비용 구조", question: null, stage: "understand",
  unitIds: ["U1", "U2"], crossUnitIds: [],
  blocks: [
    { blockId: "S1_B1", type: "B05", purpose: "개념 정의", conceptIds: ["C1"], formulaIds: [], figureIds: [] },
    { blockId: "S1_B2", type: "B10", purpose: "계산", conceptIds: ["C1"], formulaIds: ["F1"], figureIds: [] },
  ],
};
const planGlobal = [{ blockId: "GB1", type: "B02", purpose: "한눈에", conceptIds: ["C1"] }];

test("모든 스키마가 strict 호환이고 lint 를 통과한다", () => {
  assert.deepEqual(Object.keys(NC.schemas.content).sort(), NC.WRITER_TYPES);
  const all = {
    claim: NC.schemas.claim, check: NC.schemas.check,
    plannerOutput: NC.schemas.plannerOutput,
    sectionOutput: NC.sectionOutputSchemaFor(planSection),
    repairOutput: NC.repairOutputSchemaFor(planSection, ["S1_B2"]),
    globalOutput: NC.globalOutputSchemaFor(planGlobal),
  };
  for (const t of NC.WRITER_TYPES) {
    all["content." + t] = NC.schemas.content[t];
    all["envelope." + t] = NC.envelopeSchema(t);
  }
  for (const [name, s] of Object.entries(all)) {
    assert.equal(Contracts.isStrictCompatible(s), true, name + " strict");
    assert.doesNotThrow(() => Contracts.validate(s, null), name + " lint");
  }
  assert.doesNotThrow(() => Contracts.validate(NC.schemas.plan, null), "plan lint");
  assert.doesNotThrow(() => Contracts.validate(NC.schemas.note, null), "note lint");
  assert.throws(() => NC.envelopeSchema("B01"), /B01/, "Writer 슬롯이 없는 타입");
});

test("타입별 유효 봉투는 통과하고 위반은 경로와 함께 거절한다", () => {
  for (const t of NC.WRITER_TYPES)
    assert.deepEqual(Contracts.validate(NC.envelopeSchema(t), env(contents[t])), { ok: true }, t);

  const paths = (type, c) => Contracts.validate(NC.envelopeSchema(type), env(c)).errors.map(e => e.path);
  const b05 = clone(contents.B05); b05.definition.basis = "synthetic";
  assert.ok(paths("B05", b05).includes("/content/definition/basis"), "synthetic basis 는 enum 에 없다");
  const b08 = clone(contents.B08); b08.source = "synthetic";
  assert.ok(paths("B08", b08).includes("/content/source"), "synthetic 사례 출처 없음");
  const b12 = clone(contents.B12); b12.html = "<b>x</b>";
  assert.ok(paths("B12", b12).includes("/content/html"), "추가 속성 거절");
  const b06 = clone(contents.B06); b06.entities = [b06.entities[0]];
  assert.ok(paths("B06", b06).includes("/content/entities"), "대상 최소 2개");
  const b14v = clone(contents.B14); b14v.items[0].answer.verdict = "maybe";
  assert.ok(paths("B14", b14v).includes("/content/items/0/answer/verdict"), "O·X·null 만 허용");
  const b10 = clone(contents.B10);
  b10.steps = [{ label: "계산", op: "add", a: "i1", b: "i2", value: 3, unit: null, digits: 7 }];
  assert.ok(paths("B10", b10).includes("/content/steps/0/digits"), "digits 는 0..6");
  const b02 = clone(contents.B02); b02.items[0].targetIds = ["S2-B3"];
  assert.ok(paths("B02", b02).includes("/content/items/0/targetIds/0"), "대상 id 형식");
  const b14ok = clone(contents.B14); b14ok.items[0].answer.reviewIds = ["S2_B3"];
  assert.deepEqual(Contracts.validate(NC.envelopeSchema("B14"), env(b14ok)), { ok: true }, "S2_B3 허용");
  const b14bad = clone(contents.B14); b14bad.items[0].answer.reviewIds = ["GB10"];
  assert.ok(paths("B14", b14bad).includes("/content/items/0/answer/reviewIds/0"), "전역 id 는 한 자리");
});

test("출력 스키마는 계획의 blockId 를 순서대로 키로 쓴다", () => {
  const s = NC.sectionOutputSchemaFor(planSection);
  assert.deepEqual(Object.keys(s.properties.blocks.properties), ["S1_B1", "S1_B2"]);
  assert.ok("gist" in s.properties && "checks" in s.properties);
  const noGist = NC.sectionOutputSchemaFor(planSection, { gist: false });
  assert.ok(!("gist" in noGist.properties));
  // null 은 Writer 의 보류다(§8.3)
  assert.deepEqual(Contracts.validate(s, { gist: null, blocks: { S1_B1: null, S1_B2: env(contents.B10) }, checks: [] }), { ok: true });
  assert.throws(() => NC.sectionOutputSchemaFor(planSection, { blockIds: ["S1_B9"] }), /S1_B9/);
  const r = NC.repairOutputSchemaFor(planSection, ["S1_B2"]);
  assert.deepEqual(Object.keys(r.properties.blocks.properties), ["S1_B2"]);
  assert.ok(!("checks" in r.properties));
  assert.throws(() => NC.repairOutputSchemaFor(planSection, []));
  const g = NC.globalOutputSchemaFor(planGlobal);
  assert.deepEqual(Object.keys(g.properties.blocks.properties), ["GB1"]);
});

test("출력 스키마는 요청이 아는 참조 id 만 enum 으로 좁힌다", () => {
  const s = NC.sectionOutputSchemaFor(planSection);
  const tids = s.properties.checks.items.properties.targetIds.items;
  assert.deepEqual(tids, { type: "string", enum: ["S1_B1", "S1_B2"] }, "확인 항목 대상은 이 요청의 계획 블록");
  const withChecks = checks => ({ gist: null, blocks: { S1_B1: null, S1_B2: null }, checks });
  const chk = targetIds => ({ kind: "recognition_uncertain", claim: C(), targetIds, before: null, after: null, hold: null });
  assert.deepEqual(Contracts.validate(s, withChecks([chk(["S1_B2"])])), { ok: true }, "계획 블록 대상은 통과");
  assert.deepEqual(Contracts.validate(s, withChecks([chk([])])), { ok: true }, "빈 대상도 기존처럼 허용");
  for (const t of [["n1"], ["S1_B9"], ["S2_B1"], ["GB1"], ["C1"]])
    assert.ok(!Contracts.validate(s, withChecks([chk(t)])).ok, t[0] + " 은 이 요청의 대상이 아니다");
  assert.equal(Contracts.isStrictCompatible(s), true);
  // 블록 안의 참조는 교차 섹션도 유효하므로 enum 이 아니라 패턴이다 — 복습 위치는 전역 블록(GB)·지도 키(n1)를 뺀 섹션 블록 패턴.
  const revIds = NC.envelopeSchema("B14").properties.content.properties.items.items.properties.answer.properties.reviewIds.items;
  assert.equal(revIds.pattern, NC.IDS.secBlock);
  const re = new RegExp(NC.IDS.secBlock);
  assert.ok(re.test("S2_B3") && !re.test("GB1") && !re.test("n1") && !re.test("S2"));
  const bad = clone(contents.B14); bad.items[0].answer.reviewIds = ["GB1"];
  assert.ok(!Contracts.validate(NC.envelopeSchema("B14"), env(bad)).ok, "전역 블록은 복습 위치가 아니다");
  const rep = NC.repairOutputSchemaFor({ ...planSection, blocks: [{ blockId: "S1_B1", type: "B14", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] }] }, ["S1_B1"]);
  const repRev = rep.properties.blocks.properties.S1_B1.properties.content.properties.items.items.properties.answer.properties.reviewIds.items;
  assert.equal(repRev.pattern, NC.IDS.secBlock, "repair 출력도 같은 참조 제약");
  // 문항 targetIds 는 문서 참조 도메인(섹션·블록·개념·단서·전역)이라 복습 칸보다 넓다 — 지도 키는 어느 칸에도 못 온다.
  const qTgt = NC.envelopeSchema("B14").properties.content.properties.items.items.properties.targetIds.items;
  assert.equal(qTgt.pattern, NC.IDS.target);
  const tg = new RegExp(NC.IDS.target);
  assert.ok(tg.test("S2") && tg.test("C1") && tg.test("S2_B3/P1") && tg.test("GB1") && !tg.test("n1"));
  const sameSec = clone(contents.B14); sameSec.items[0].answer.reviewIds = ["S1_B2"];
  assert.deepEqual(Contracts.validate(NC.envelopeSchema("B14"), env(sameSec)), { ok: true }, "같은 섹션 다른 블록도 복습 위치");
});

test("allowedRefs: 대상·복습 칸을 요청의 참조 목록 enum 으로 좁히고 확인 항목은 그대로다", () => {
  // B03(nullable targetId)·B13·B14 둘 — 자기 배제가 블록마다 다른지 보려고 B14 를 둘 둔다.
  const secRefs = {
    sectionId: "S1", title: "t", question: null, stage: "understand", unitIds: ["U1"], crossUnitIds: [],
    blocks: [
      { blockId: "S1_B1", type: "B03", purpose: "지도", conceptIds: [], formulaIds: [], figureIds: [] },
      { blockId: "S1_B2", type: "B13", purpose: "연결", conceptIds: [], formulaIds: [], figureIds: [] },
      { blockId: "S1_B3", type: "B14", purpose: "점검", conceptIds: [], formulaIds: [], figureIds: [] },
      { blockId: "S1_B4", type: "B14", purpose: "점검", conceptIds: [], formulaIds: [], figureIds: [] },
    ],
  };
  const refs = {
    targetIds: ["S1", "S2", "S1_B1", "S1_B2", "S1_B3", "S1_B4", "S2_B1", "GB1", "C1", "S2_B1/P2"],
    reviewIds: ["S1_B1", "S1_B2", "S1_B3", "S1_B4", "S2_B1"],
  };
  const s = NC.sectionOutputSchemaFor(secRefs, { allowedRefs: refs });
  const envProps = id => s.properties.blocks.properties[id].properties;
  // 일반 대상 칸은 allowedRefs.targetIds 그대로다
  const b13t = envProps("S1_B2").content.properties.propositions.items.properties.targetIds.items;
  assert.deepEqual(b13t, { type: "string", enum: refs.targetIds }, "B13 명제 대상");
  const b14 = envProps("S1_B3").content.properties.items.items.properties;
  assert.deepEqual(b14.targetIds.items, { type: "string", enum: refs.targetIds }, "B14 문항 대상");
  // 복습 위치는 allowedRefs.reviewIds 에서 자기 블록만 뺀다 — GB 는 애초에 목록에 없다
  assert.deepEqual(b14.answer.properties.reviewIds.items, { type: "string", enum: ["S1_B1", "S1_B2", "S1_B4", "S2_B1"] }, "S1_B3 은 자신 제외");
  assert.deepEqual(envProps("S1_B4").content.properties.items.items.properties.answer.properties.reviewIds.items.enum,
    ["S1_B1", "S1_B2", "S1_B3", "S2_B1"], "S1_B4 도 자신 제외 — 블록마다 다른 enum");
  // B03 노드 targetId 는 nullable 을 유지한다
  const nodeT = envProps("S1_B1").content.properties.nodes.items.properties.targetId;
  assert.deepEqual(nodeT, { type: ["string", "null"], pattern: NC.IDS.target, enum: [...refs.targetIds, null] });
  // checks 대상은 이 요청 섹션의 계획 블록 enum 그대로 — allowedRefs 가 아니라 요청의 블록 목록에서 만든다
  assert.deepEqual(s.properties.checks.items.properties.targetIds.items, { type: "string", enum: ["S1_B1", "S1_B2", "S1_B3", "S1_B4"] });
  const half = NC.sectionOutputSchemaFor(secRefs, { blockIds: ["S1_B1", "S1_B2"], allowedRefs: refs });
  assert.deepEqual(Object.keys(half.properties.blocks.properties), ["S1_B1", "S1_B2"], "조각 출력은 그 블록만");
  assert.deepEqual(half.properties.checks.items.properties.targetIds.items.enum, ["S1_B1", "S1_B2", "S1_B3", "S1_B4"], "조각이어도 확인 대상은 섹션 전체");
  // 스키마 행동: 목록 밖 id·GB 복습·자기 블록 복습은 거절, null targetId 는 통과
  const b03env = env(clone(contents.B03));
  b03env.content.nodes[1].targetId = "S9_B9";
  assert.ok(!Contracts.validate(s.properties.blocks.properties.S1_B1, b03env).ok, "목록 밖 대상 거절");
  b03env.content.nodes[1].targetId = null;
  assert.deepEqual(Contracts.validate(s.properties.blocks.properties.S1_B1, b03env), { ok: true }, "null 은 여전히 허용");
  b03env.content.nodes[1].targetId = "S2_B1/P2";
  assert.deepEqual(Contracts.validate(s.properties.blocks.properties.S1_B1, b03env), { ok: true }, "목록에 있는 단서 위치 허용");
  const q = env(clone(contents.B14)); // contents.B14 는 targetIds·reviewIds 모두 S1_B1 — 목록에 있다
  assert.deepEqual(Contracts.validate(s.properties.blocks.properties.S1_B3, q), { ok: true });
  const qSelf = env(clone(contents.B14)); qSelf.content.items[0].answer.reviewIds = ["S1_B3"];
  assert.ok(!Contracts.validate(s.properties.blocks.properties.S1_B3, qSelf).ok, "자기 B14 복습 거절");
  const qGb = env(clone(contents.B14)); qGb.content.items[0].answer.reviewIds = ["GB1"];
  assert.ok(!Contracts.validate(s.properties.blocks.properties.S1_B3, qGb).ok, "GB 복습 거절");
  // repair·전역 출력도 같은 목록으로 좁힌다
  const rep = NC.repairOutputSchemaFor(secRefs, ["S1_B4"], NC.POLICY, refs);
  assert.deepEqual(rep.properties.blocks.properties.S1_B4.properties.content.properties.items.items.properties.answer.properties.reviewIds.items.enum,
    ["S1_B1", "S1_B2", "S1_B3", "S2_B1"], "repair 출력도 자기 B14 를 뺀다");
  const gPlan = [{ blockId: "GB1", type: "B13", purpose: "연결", conceptIds: ["C1"] }];
  const g = NC.globalOutputSchemaFor(gPlan, refs);
  assert.deepEqual(g.properties.blocks.properties.GB1.properties.content.properties.propositions.items.properties.targetIds.items,
    { type: "string", enum: refs.targetIds }, "전역 출력도 목록으로 좁힌다");
  assert.equal(Contracts.isStrictCompatible(s), true, "좁힌 스키마도 strict");
  // 영어 src 변환은 좁힌 enum 을 그대로 지닌다
  const enSch = NC.withSource(s);
  assert.ok(JSON.stringify(enSch).includes('"src"'), "src 칸 유지");
  assert.deepEqual(enSch.properties.blocks.properties.S1_B2.properties.content.properties.propositions.items.properties.targetIds.items, b13t);
  // 기본 스키마는 얼려 있어 바뀌지 않는다
  const baseT = NC.schemas.content.B13.properties.propositions.items.properties.targetIds.items;
  assert.equal(baseT.enum, undefined, "기본 스키마 무결");
  assert.throws(() => { "use strict"; baseT.pattern = "x"; }, TypeError);
});

test("allowedRefs: 없거나 비면 enum 을 두지 않고 기존 패턴·코드 검사에 맡긴다", () => {
  const sec = {
    sectionId: "S1", title: "t", question: null, stage: "understand", unitIds: ["U1"], crossUnitIds: [],
    blocks: [{ blockId: "S1_B1", type: "B14", purpose: "점검", conceptIds: [], formulaIds: [], figureIds: [] }],
  };
  const legacy = NC.sectionOutputSchemaFor(sec);
  const items = legacy.properties.blocks.properties.S1_B1.properties.content.properties.items.items.properties;
  assert.equal(items.targetIds.items.pattern, NC.IDS.target);
  assert.ok(!("enum" in items.targetIds.items), "allowedRefs 없으면 enum 없음");
  assert.equal(items.answer.properties.reviewIds.items.pattern, NC.IDS.secBlock);
  assert.ok(!("enum" in items.answer.properties.reviewIds.items));
  const empty = NC.sectionOutputSchemaFor(sec, { allowedRefs: { targetIds: [], reviewIds: [] } });
  const eItems = empty.properties.blocks.properties.S1_B1.properties.content.properties.items.items.properties;
  assert.equal(eItems.targetIds.items.pattern, NC.IDS.target);
  assert.ok(!("enum" in eItems.targetIds.items), "빈 목록은 빈 enum 이 아니라 패턴으로 둔다");
  assert.ok(!("enum" in eItems.answer.properties.reviewIds.items));
  // checks 는 빈 allowedRefs 와 무관하게 계획 블록 enum 을 유지한다
  assert.deepEqual(empty.properties.checks.items.properties.targetIds.items.enum, ["S1_B1"]);
  const g = NC.globalOutputSchemaFor([{ blockId: "GB1", type: "B13", purpose: "p", conceptIds: [] }]);
  assert.equal(g.properties.blocks.properties.GB1.properties.content.properties.propositions.items.properties.targetIds.items.pattern,
    NC.IDS.target, "전역도 없으면 패턴");
});

test("POLICY 기본값은 둘 다 꺼짐이고, 꺼진 옵션의 basis 는 출력 스키마에 없다", () => {
  assert.deepEqual(NC.POLICY, { externalAugmentation: false, syntheticExamples: false });
  assert.throws(() => { "use strict"; NC.POLICY.syntheticExamples = true; }, TypeError);
  const plan = {
    schemaVersion: 1, noteSpecVersion: NC.NOTE_SPEC_VERSION, policy: { ...NC.POLICY }, concepts: [],
    sections: [{
      sectionId: "S1", title: "t", question: null, stage: "understand",
      unitIds: ["U1"], crossUnitIds: [],
      blocks: [{ blockId: "S1_B1", type: "B05", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] }],
    }],
    global: [],
  };
  assert.deepEqual(Contracts.validate(NC.schemas.plan, plan), { ok: true });
  assert.deepEqual(Contracts.validate(NC.schemas.plan, { ...plan, policy: { externalAugmentation: true, syntheticExamples: true } }), { ok: true });
  const basisEnums = s => JSON.stringify(s).match(/"basis":\{"type":"string","enum":\[[^\]]*\]/g);
  const off = NC.sectionOutputSchemaFor(plan.sections[0]);
  assert.ok(basisEnums(off).every(e => !e.includes("synthetic") && !e.includes("external")));
  const syn = NC.sectionOutputSchemaFor(plan.sections[0], { policy: { syntheticExamples: true } });
  assert.ok(basisEnums(syn).every(e => e.includes("synthetic") && !e.includes("external")));
  assert.ok(Contracts.isStrictCompatible ? Contracts.isStrictCompatible(syn) : true);
});

// §8.2 계획 검사용 fixture: U1..U6 를 S1·S2·S3 이 순서대로 나눠 갖는다.
const units = ["U1", "U2", "U3", "U4", "U5", "U6"].map(unitId => ({ unitId }));
const ctx = { units, formulaUnits: { F1: ["U2"] }, figures: [{ id: "G1", unitId: "U1" }] };
const mkOutput = () => ({
  concepts: [
    { conceptId: "C1", name: "고정비", homeSectionId: "S1", depth: "defined" },
    { conceptId: "C2", name: "기업의 경계", homeSectionId: "S3", depth: "defined" },
    { conceptId: "C3", name: "한계", homeSectionId: "S2", depth: "mentioned" },
  ],
  sections: [
    {
      sectionId: "S1", title: "비용 구조", question: null, stage: "understand",
      unitIds: ["U1", "U2"], crossUnitIds: ["U6"],
      blocks: [
        { type: "B05", purpose: "정의", conceptIds: ["C1"], formulaIds: [], figureIds: [] },
        { type: "B12", purpose: "곁설명", conceptIds: [], formulaIds: [], figureIds: [] },
        { type: "B10", purpose: "계산", conceptIds: ["C1"], formulaIds: ["F1"], figureIds: ["G1"] },
      ],
    },
    {
      sectionId: "S2", title: "손익분기", question: "얼마나 팔아야 하나?", stage: "apply",
      unitIds: ["U3", "U4"], crossUnitIds: [],
      blocks: [{ type: "B07", purpose: "논리", conceptIds: ["C3"], formulaIds: [], figureIds: [] }],
    },
    {
      sectionId: "S3", title: "기업의 경계", question: null, stage: "relate",
      unitIds: ["U5", "U6"], crossUnitIds: [],
      blocks: [{ type: "B05", purpose: "정의", conceptIds: ["C2"], formulaIds: [], figureIds: [] }],
    },
  ],
  global: [
    { type: "B02", purpose: "한눈에", conceptIds: ["C1"] },
    { type: "B13", purpose: "연결", conceptIds: ["C2", "C3"] },
  ],
});
const badPlan = mutate => { const o = mkOutput(); mutate(o); return NC.normalizePlan(o, ctx); };
const has = (r, s) => {
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, "VAL_PLAN_INVALID");
  assert.ok(r.errors[0].detail.includes(s), s + " ∈ " + r.errors[0].detail.join(", "));
};

test("normalizePlan: 유효한 계획은 blockId 를 부여하고 Plan 스키마를 통과한다", () => {
  const out = mkOutput(), snapshot = clone(out);
  const r = NC.normalizePlan(out, ctx);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.plan.sections[0].blocks.map(b => b.blockId), ["S1_B1", "S1_B2", "S1_B3"]);
  assert.deepEqual(r.plan.global.map(g => g.blockId), ["GB1", "GB2"]);
  assert.equal(r.plan.noteSpecVersion, "lecture-note-2");
  assert.equal(r.plan.policy.syntheticExamples, false);
  assert.deepEqual(Contracts.validate(NC.schemas.plan, r.plan), { ok: true });
  assert.deepEqual(out, snapshot, "입력을 바꾸지 않는다");
});

test("normalizePlan: 스키마 위반은 schema: 경로로 멈춘다", () => {
  const r = badPlan(o => { o.sections[0].title = ""; });
  assert.ok(r.errors[0].detail.every(d => d.startsWith("schema:")));
  assert.ok(r.errors[0].detail.includes("schema:/sections/0/title"));
});

test("normalizePlan: 유닛 커버리지와 IR 순서", () => {
  has(badPlan(o => { o.sections[1].unitIds = ["U4"]; }), "missing:U3");
  has(badPlan(o => { o.sections[1].unitIds = ["U3", "U4", "U3"]; }), "duplicate:U3");
  has(badPlan(o => { o.sections[1].unitIds = ["U3", "U4", "U9"]; }), "unknown:U9");
  // 빈 unitIds 는 스키마(minItems)가 먼저 거른다 — empty 는 도달 불가
  const empty = badPlan(o => { o.sections[1].unitIds = []; });
  assert.ok(empty.errors[0].detail.includes("schema:/sections/1/unitIds"));
  has(badPlan(o => { o.sections[2].unitIds = ["U6", "U5"]; }), "order:S3");   // 섹션 안 유닛이 IR 순서가 아님
  has(badPlan(o => { o.sections[2].sectionId = "S4"; }), "order:S4");         // 섹션 id 가 S1..Sn 이 아님
  has(badPlan(o => { o.sections[1].crossUnitIds = ["U9"]; }), "cross:S2:U9"); // 모르는 교차 유닛
  has(badPlan(o => { o.sections[1].crossUnitIds = ["U3"]; }), "cross:S2:U3"); // 자기 섹션 유닛과 겹침
});

test("normalizePlan: 개념 선언과 B05 홈", () => {
  has(badPlan(o => { o.sections[1].blocks[0].conceptIds = ["C4"]; }), "concept:C4");
  has(badPlan(o => { o.concepts.push({ conceptId: "C1", name: "중복", homeSectionId: "S2", depth: "mentioned" }); }), "concept:C1");
  has(badPlan(o => { o.concepts[0].homeSectionId = "S9"; }), "concept:C1");
  has(badPlan(o => { o.sections[0].blocks[0].conceptIds = ["C1", "C3"]; }), "home:S1_B1"); // B05 는 개념 하나만
  has(badPlan(o => { o.sections[0].blocks[0].conceptIds = ["C3"]; }), "home:C1");          // defined 의 단일 B05 부재
  has(badPlan(o => {
    o.sections[2].blocks.push({ type: "B05", purpose: "p", conceptIds: ["C3"], formulaIds: [], figureIds: [] });
  }), "home:C3"); // mentioned 개념에 B05 가 있음
});

test("normalizePlan: 수식·도표 참조는 섹션(교차 포함) 유닛 안이어야 한다", () => {
  has(badPlan(o => { o.sections[1].blocks[0].formulaIds = ["F12"]; }), "ref:S2:F12"); // 레지스트리에 없는 수식
  has(badPlan(o => { o.sections[1].blocks[0].formulaIds = ["F1"]; }), "ref:S2:F1");   // F1 은 U2(S1)에만 나옴
  has(badPlan(o => { o.sections[1].blocks[0].figureIds = ["G3"]; }), "ref:S2:G3");    // 없는 도표
  // 교차 유닛에 있는 도표는 허용
  const ok = badPlan(o => { o.sections[0].blocks[2].figureIds = ["G2"]; });
  const c2 = { ...ctx, figures: [...ctx.figures, { id: "G2", unitId: "U6" }] }; // U6 은 S1 의 crossUnitIds
  assert.equal(NC.normalizePlan(mkOutput(), c2).ok, true);
  assert.equal(ok.ok, false); // G2 는 figures 에 없으면 거절
});

test("normalizePlan: B12 는 첫 블록이 될 수 없고 전역 타입은 하나씩이다", () => {
  has(badPlan(o => { o.sections[1].blocks.unshift({ type: "B12", purpose: "곁설명", conceptIds: [], formulaIds: [], figureIds: [] }); }), "side:S2_B1");
  has(badPlan(o => { o.global.push({ type: "B02", purpose: "둘째", conceptIds: [] }); }), "global:B02");
});

// §8.2 보정: 스키마는 맞지만 의미 규칙을 깬 계획을 코드가 고친다 — 깨기 → 거절 확인 → 보정 → 통과.
const repPlan = mutate => {
  const o = mkOutput(); mutate(o);
  const snap = clone(o), before = NC.normalizePlan(o, ctx);
  assert.equal(before.ok, false, "먼저 거절돼야 한다");
  const r = NC.repairPlan(o, ctx);
  assert.deepEqual(o, snap, "입력을 바꾸지 않는다");
  const after = NC.normalizePlan(r.output, ctx);
  assert.equal(after.ok, true, "보정 후 통과: " + JSON.stringify(after.errors) + " / fixes=" + r.fixes.join(","));
  return r;
};

test("repairPlan: 유효한 계획은 fixes 없이 같은 계획을 돌려주고 입력을 바꾸지 않는다", () => {
  const o = mkOutput(), snap = clone(o);
  const r = NC.repairPlan(o, ctx);
  assert.deepEqual(r.fixes, []);
  assert.deepEqual(JSON.parse(JSON.stringify(r.output)), o);
  assert.deepEqual(o, snap);
});

test("repairPlan(a): 모르는·중복·빠진 유닛을 고치고 유닛 없는 섹션은 합친다", () => {
  let r = repPlan(o => { o.sections[1].unitIds = ["U3", "U9", "U4"]; });
  assert.ok(r.fixes.includes("drop-unit:U9"));
  r = repPlan(o => { o.sections[1].unitIds = ["U3", "U4", "U3"]; });
  assert.ok(r.fixes.includes("dup-unit:U3"));
  r = repPlan(o => { o.sections[2].unitIds = ["U6"]; }); // U5 는 아무도 안 잡는다 — 앞 유닛의 섹션으로
  assert.ok(r.fixes.includes("missing:U5"));
  assert.deepEqual(r.output.sections.map(s => s.unitIds), [["U1", "U2"], ["U3", "U4", "U5"], ["U6"]]);
  // 유닛을 다 잃은 섹션은 버리고 블록은 앞 섹션이 흡수한다
  r = repPlan(o => { o.sections[1].unitIds = ["U9"]; });
  for (const c of ["drop-unit:U9", "missing:U3", "missing:U4", "drop-sec:S2", "renumber"]) assert.ok(r.fixes.includes(c), c);
  assert.deepEqual(r.output.sections.map(s => [s.sectionId, s.unitIds]), [["S1", ["U1", "U2", "U3", "U4"]], ["S2", ["U5", "U6"]]]);
  assert.equal(r.output.sections[0].blocks.length, 4); // S2 의 B07 이 흡수됐다
  assert.equal(r.output.concepts.find(c => c.conceptId === "C3").homeSectionId, "S1"); // 홈도 흡수한 쪽으로
});

test("repairPlan(b): 섹션 번호를 S1..Sn 으로 다시 매긴다", () => {
  const r = repPlan(o => { o.sections[0].sectionId = "S9"; });
  assert.ok(r.fixes.includes("renumber"));
  assert.deepEqual(r.output.sections.map(s => s.sectionId), ["S1", "S2", "S3"]);
});

test("repairPlan(c): 교차 유닛은 모르거나 자기 섹션 것을 뺀다", () => {
  let r = repPlan(o => { o.sections[1].crossUnitIds = ["U9"]; });
  assert.ok(r.fixes.includes("cross-drop:S2:U9"));
  r = repPlan(o => { o.sections[1].crossUnitIds = ["U3"]; });
  assert.ok(r.fixes.includes("cross-drop:S2:U3"));
});

test("repairPlan(d): 중복·홈 없는 개념과 선언 밖 참조를 정리한다", () => {
  let r = repPlan(o => { o.concepts.push({ conceptId: "C1", name: "중복", homeSectionId: "S2", depth: "mentioned" }); });
  assert.ok(r.fixes.includes("concept-drop:C1"));
  r = repPlan(o => { o.concepts[2].homeSectionId = "S9"; }); // 블록이 언급하는 개념은 그 섹션으로 홈을 옮긴다
  assert.ok(r.fixes.includes("concept-home:C3"));
  assert.equal(r.output.concepts.find(c => c.conceptId === "C3").homeSectionId, "S2");
  r = repPlan(o => { o.concepts[2].homeSectionId = "S9"; o.sections[1].blocks[0].conceptIds = []; }); // 언급도 없으면 버린다
  assert.ok(r.fixes.includes("concept-drop:C3"));
  r = repPlan(o => { o.sections[1].blocks[0].conceptIds = ["C4"]; });
  assert.ok(r.fixes.includes("concept-drop:C4"));
});

test("repairPlan(e): B05 는 개념 하나·defined 는 홈에 정의 하나", () => {
  let r = repPlan(o => { o.sections[0].blocks[0].conceptIds = ["C1", "C3"]; });
  assert.ok(r.fixes.includes("def-trim:S1_B1"));
  assert.deepEqual(r.output.sections[0].blocks[0].conceptIds, ["C1"]);
  r = repPlan(o => { o.concepts[0].homeSectionId = "S2"; }); // 홈에 정의가 없다 — 홈을 정의가 있는 섹션으로
  assert.ok(r.fixes.includes("def-home:C1"));
  assert.equal(r.output.concepts[0].homeSectionId, "S1");
  r = repPlan(o => { o.sections[0].blocks[2].type = "B05"; }); // 홈에 정의가 둘 — 나중 것을 버린다
  assert.ok(r.fixes.includes("def-drop:S1_B3"));
  assert.equal(r.output.sections[0].blocks.length, 2);
  r = repPlan(o => { o.sections[1].blocks[0].type = "B05"; }); // mentioned 개념에 정의가 있으면 defined 로 올린다
  assert.ok(r.fixes.includes("promote:C3"));
  assert.equal(r.output.concepts[2].depth, "defined");
  r = repPlan(o => { o.sections[0].blocks[0].type = "B07"; }); // defined 개념의 정의 블록이 없으면 mentioned 로 내린다
  assert.ok(r.fixes.includes("demote:C1"));
  assert.equal(r.output.concepts[0].depth, "mentioned");
});

test("repairPlan(f): 섹션이 갖지 않은 수식·도표 참조를 뺀다", () => {
  let r = repPlan(o => { o.sections[1].blocks[0].formulaIds = ["F1"]; });
  assert.ok(r.fixes.includes("ref-drop:S2:F1"));
  r = repPlan(o => { o.sections[1].blocks[0].figureIds = ["G3"]; });
  assert.ok(r.fixes.includes("ref-drop:S2:G3"));
});

test("repairPlan(g): 첫 블록이 B12 이면 비-B12 를 앞으로 댄다", () => {
  const r = repPlan(o => { o.sections[1].blocks.unshift({ type: "B12", purpose: "곁설명", conceptIds: [], formulaIds: [], figureIds: [] }); });
  assert.ok(r.fixes.includes("side:S2"));
  assert.equal(r.output.sections[1].blocks[0].type, "B07");
});

test("repairPlan(h): 근거 없는 숫자는 질문을 비우고 제목·개념 이름에서 지운다", () => {
  let r = repPlan(o => { o.sections[0].title = "비용 300만 구조"; });
  assert.ok(r.fixes.includes("number:S1"));
  assert.equal(r.output.sections[0].title, "비용 구조");
  r = repPlan(o => { o.sections[1].question = "500개를 팔면?"; });
  assert.ok(r.fixes.includes("number:S2"));
  assert.equal(r.output.sections[1].question, null);
  r = repPlan(o => { o.concepts[2].name = "한계 300"; });
  assert.ok(r.fixes.includes("number:C3"));
  assert.equal(r.output.concepts[2].name, "한계");
  r = repPlan(o => { o.concepts[2].name = "300"; }); // 지우면 빈 이름 — 개념과 참조를 버린다
  assert.ok(r.fixes.includes("number:C3"));
  assert.ok(r.fixes.includes("concept-drop:C3"));
  assert.ok(!r.output.concepts.some(c => c.conceptId === "C3"));
});

test("repairPlan(i): 같은 타입 전역 블록의 나중 중복은 버린다", () => {
  const r = repPlan(o => { o.global.push({ type: "B02", purpose: "둘째", conceptIds: [] }); });
  assert.ok(r.fixes.includes("global-dup:B02"));
  assert.deepEqual(r.output.global.map(g => g.type), ["B02", "B13"]);
});

// §7 계산 검산
const inp = (value, unit = null) => ({ label: "입력", value, unit, evidenceIds: ["U1.s1"] });
const stp = (op, a, b, value, unit = null, digits = null) => ({ label: "단계", op, a, b, value, unit, digits });
const calc = (inputs, steps, withheld = null) => ({ inputs, steps, withheld });
const codes = r => r.errors.map(e => e.code);

test("checkCalc: 정상 체인은 입력·단계의 기재값을 values 에 남긴다", () => {
  const r = NC.checkCalc(calc(
    [inp(15000, "원"), inp(9000, "원"), inp(3000000, "원")],
    [stp("sub", "i1", "i2", 6000, "원"), stp("div", "i3", "c1", 500, "개")],
  ));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.values, { i1: 15000, i2: 9000, i3: 3000000, c1: 6000, c2: 500 });
});

test("checkCalc: 참조·분모·값·단위·보류 오류 코드", () => {
  const refs = r => r.errors.flatMap(e => e.detail);
  const r1 = NC.checkCalc(calc([inp(1, "원"), inp(0, "원")], [stp("div", "i1", "i2", 0, "원")]));
  assert.ok(codes(r1).includes("VAL_CALC_DIV_ZERO") && refs(r1).includes("c1"));
  const r2 = NC.checkCalc(calc([inp(15000, "원"), inp(9000, "원")], [stp("sub", "i1", "i2", 6001, "원")]));
  assert.ok(codes(r2).includes("VAL_CALC_MISMATCH") && refs(r2).includes("c1"));
  // digits 2: 1/3 은 0.33 까지 허용, 0.34 는 불일치
  assert.equal(NC.checkCalc(calc([inp(1), inp(3)], [stp("div", "i1", "i2", 0.33, null, 2)])).ok, true);
  assert.ok(codes(NC.checkCalc(calc([inp(1), inp(3)], [stp("div", "i1", "i2", 0.34, null, 2)]))).includes("VAL_CALC_MISMATCH"));
  // 단위: 원+개 불가, %−% 는 %p 만
  assert.ok(codes(NC.checkCalc(calc([inp(1, "원"), inp(2, "개")], [stp("add", "i1", "i2", 3, "개")]))).includes("VAL_CALC_UNIT"));
  assert.ok(codes(NC.checkCalc(calc([inp(30, "%"), inp(25, "%")], [stp("sub", "i1", "i2", 5, "%")]))).includes("VAL_CALC_UNIT"));
  assert.equal(NC.checkCalc(calc([inp(30, "%"), inp(25, "%")], [stp("sub", "i1", "i2", 5, "%p")])).ok, true);
  // 아직 계산되지 않은 단계(c3)는 참조할 수 없다
  const r3 = NC.checkCalc(calc([inp(1), inp(2)], [
    stp("add", "i1", "i2", 3), stp("add", "c3", "i1", 4), stp("add", "i1", "i2", 3),
  ]));
  assert.ok(codes(r3).includes("VAL_CALC_REF") && refs(r3).includes("c2"));
  // 보류와 단계는 공존할 수 없다
  assert.ok(codes(NC.checkCalc(calc([inp(1), inp(2)], [stp("add", "i1", "i2", 3)], C("분모가 0이라 보류")))).includes("VAL_CALC_WITHHELD"));
  assert.equal(NC.checkCalc(calc([inp(1), inp(2)], [], C("근거 없는 숫자라 보류"))).ok, true);
});

test("checkCalc: 다음 단계는 앞 단계의 반올림 기재값으로 계산한다", () => {
  // c1 = 1/3 을 0.33(digits 2)으로 기재하면 c2 = 0.99. 진값 1/3 으로 계산하면 1.0 이라 걸린다.
  const r = NC.checkCalc(calc([inp(1), inp(3)], [
    stp("div", "i1", "i2", 0.33, null, 2), stp("mul", "c1", "i2", 0.99, null, 2),
  ]));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.values.c2, 0.99);
});

test("displayOf: 수식은 verified+latex 일 때만 latex, 도표는 크롭 유무만", () => {
  assert.equal(NC.displayOf("formula", { status: "verified", latex: "x^2" }, false), "latex");
  assert.equal(NC.displayOf("formula", { status: "verified", latex: "  " }, true), "crop"); // 빈 LaTeX 는 없는 것과 같다
  assert.equal(NC.displayOf("formula", { status: "image", latex: null }, true), "crop");
  assert.equal(NC.displayOf("formula", { status: "unverified", latex: null }, false), "check");
  assert.equal(NC.displayOf("figure", { kind: "table" }, true), "crop");
  assert.equal(NC.displayOf("figure", { kind: "chart" }, false), "check");
  assert.throws(() => NC.displayOf("blob", {}, true), /표시 종류/);
});

test("citedRefs: 깊이 무관하게 evidenceIds 문자열을 중복 없이 모은다", () => {
  const node = {
    blocks: {
      S1_B1: {
        content: { definition: { evidenceIds: ["U1.s1", "U1.t2"] }, inputs: [{ evidenceIds: ["U1.s1"] }] },
        emphasis: [{ evidenceIds: ["U1.t2", "U1.s3"] }],
      },
      S1_B2: { content: { quote: { evidenceIds: ["U2.s1"] } } },
    },
  };
  assert.deepEqual(NC.citedRefs(node), ["U1.s1", "U1.t2", "U1.s3", "U2.s1"]);
  assert.deepEqual(NC.citedRefs(null), []);
});

test("보낸 객체는 깊게 동결돼 있다", () => {
  assert.throws(() => { "use strict"; NC.schemas.claim.properties.extra = {}; }, TypeError);
  assert.throws(() => { "use strict"; NC.schemas.claim.properties.text.maxLength = 1; }, TypeError);
  assert.throws(() => { "use strict"; NC.TYPES.B01.writer = "model"; }, TypeError);
  assert.equal(globalThis.NoteContract, NC, "UMD 전역 노출");
});

// ===== §10 validateSection / §12 assembleNote 테스트용 소형 합성 입력 =====
const katex = require("./vendor/katex/katex.min.js");
const ev = (id, unitId, text, kind = "slide", t0 = 0, t1 = 60) => ({
  id, unitId, kind, t0, t1, slideId: "s1", sourceId: id, role: "body", text,
});
const EV = [
  ev("U1.s1", "U1", "고정비는 300만 원이고 한계비용은 9000원이다"),
  ev("U1.t1", "U1", "여기가 중요하니 꼭 기억하자", "speech"),
  ev("U2.s1", "U2", "가격은 15000원이고 다음 시험에 나온다", "slide", 60, 120),
  ev("U2.t1", "U2", "발표 과제는 10월 15일까지다", "speech", 60, 120),
];
const UNITS = [{ unitId: "U1", t0: 0, t1: 60 }, { unitId: "U2", t0: 60, t1: 120 }];
const META = {
  title: "가상 강의", course: "경영학원론", lectureDate: null, session: "1",
  lang: "ko", generatedAt: "2026-10-02T00:00:00Z", processed: { t0: 0, t1: 120 },
};
const C1DEF = { conceptId: "C1", name: "고정비", homeSectionId: "S1", depth: "defined" };
const C2MEN = { conceptId: "C2", name: "언급 개념", homeSectionId: "S1", depth: "mentioned" };

const vPlan = (secs, { concepts = [], global = [], units = UNITS, formulaUnits = {}, figures = [] } = {}) => {
  const r = NC.normalizePlan({ concepts, sections: secs, global }, { units, formulaUnits, figures });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.plan;
};
// 단일 섹션 계획: 블록 타입 배열 → S1_B1.. 부여. B05 가 있으면 C1 을 defined 로 둔다.
const vSec = (types, over = {}) => ({
  sectionId: "S1", title: "단원", question: null, stage: "understand",
  unitIds: ["U1", "U2"], crossUnitIds: [],
  blocks: (types || []).map(t => ({ type: t, purpose: "p", conceptIds: t === "B05" ? ["C1"] : [], formulaIds: [], figureIds: [] })),
  ...over,
});
const vPlan1 = (types, opts = {}) => vPlan([vSec(types, opts.sec || {})], {
  concepts: opts.concepts ?? (types.includes("B05") ? [C1DEF] : []),
  ...opts,
});
// contentList 항목은 content 객체(→ env 로 감쌈) 또는 null(보류). 출력 전체를 바꾸려면 opts.output.
const vRun = (types, contentList, opts = {}) => NC.validateSection({
  plan: opts.plan || vPlan1(types, opts),
  sectionId: "S1",
  output: opts.output ?? {
    gist: opts.gist ?? null,
    blocks: Object.fromEntries(types.map((t, i) => [`S1_B${i + 1}`, contentList[i] == null ? null : env(contentList[i])])),
    checks: opts.checks || [],
  },
  evidence: opts.evidence || EV, registry: opts.registry || [], formulaUnits: opts.formulaUnits || {},
  figures: opts.figures || [], katex, superseded: opts.superseded || {},
});
const bErrs = (r, id) => (r.blocks.find(b => b.id === id) || { errors: [] }).errors;
const hasErr = (r, id, code) => bErrs(r, id).some(e => e.code === code);
const secErr = (r, code) => r.errors.some(e => e.code === code);
const noHangul = r => {
  for (const e of [...r.errors, ...r.blocks.flatMap(b => b.errors)])
    assert.ok(!/[가-힣]/.test(JSON.stringify(e.detail)), `${e.code}: ${JSON.stringify(e.detail)}`);
};
const b10Calc = () => clone(contents.B10);
b10Calc.set = c => {
  c.inputs = [{ label: "고정비", value: 3000000, unit: "원", evidenceIds: ["U1.s1"] }];
  c.steps = [stp("add", "i1", "i1", 6000000, "원")];
  return c;
};

test("validateSection: 통과하는 섹션은 ok·인용·계산 색인·요지를 돌려준다", () => {
  const gist = { text: "고정비는 300만 원이다", evidenceIds: ["U1.s1"], basis: "lecture" };
  const r = vRun(["B05", "B10"], [contents.B05, b10Calc.set(b10Calc())], { gist });
  assert.equal(r.ok, true, JSON.stringify({ errors: r.errors, blocks: r.blocks.map(b => [b.id, b.errors]) }));
  assert.deepEqual(r.calc, { "S1_B2.i1": 3000000, "S1_B2.c1": 6000000 });
  assert.deepEqual(r.gist, gist);
  assert.ok(r.cited.includes("U1.s1") && r.cited.length === [...new Set(r.cited)].length);
  assert.throws(() => NC.validateSection({ plan: vPlan1(["B05"]), sectionId: "S1", output: {}, evidence: EV, katex: {} }), TypeError);
  assert.throws(() => NC.validateSection({ plan: vPlan1(["B05"]), sectionId: "S9", output: {}, evidence: EV, katex }), /S9/);
});

test("validateSection: 스키마 위반(§10 a,b)", () => {
  // output.blocks 가 객체가 아니면 섹션 + 계획된 전 블록 VAL_SCHEMA
  let r = vRun(["B05"], [], { output: { gist: null, checks: [] } });
  assert.ok(secErr(r, "VAL_SCHEMA") && hasErr(r, "S1_B1", "VAL_SCHEMA"));
  // 계획에 없는 키는 섹션 오류로 경로를 단다
  r = vRun(["B05"], null, {
    output: { gist: null, blocks: { S1_B1: env(contents.B05), S1_B9: env(contents.B05) }, checks: [] },
  });
  assert.ok(r.errors.find(e => e.code === "VAL_SCHEMA")?.detail.includes("/blocks/S1_B9"));
  assert.ok(!hasErr(r, "S1_B1", "VAL_SCHEMA"), "있는 블록은 계속 검사한다");
  // 계획된 키가 빠지면 그 블록만 VAL_SCHEMA
  r = vRun(["B05", "B10"], null, { output: { gist: null, blocks: { S1_B1: env(contents.B05) }, checks: [] } });
  assert.ok(hasErr(r, "S1_B2", "VAL_SCHEMA") && !hasErr(r, "S1_B1", "VAL_SCHEMA"));
  // 봉투 스키마 위반은 경로 detail — 그 블록은 더 검사하지 않는다
  const bad = clone(contents.B05); bad.definition.basis = "synthetic";
  r = vRun(["B05"], [bad]);
  const e = bErrs(r, "S1_B1").find(x => x.code === "VAL_SCHEMA");
  assert.ok(e && e.detail.includes("/content/definition/basis"));
  // null 은 Writer 보류
  assert.ok(hasErr(vRun(["B05"], [null]), "S1_B1", "VAL_BLOCK_DECLINED"));
  noHangul(r);
});

test("validateSection: 주장 근거·근거 종류(§10 f)", () => {
  const c1 = clone(contents.B05); c1.definition.evidenceIds = ["U9.s1"];
  assert.ok(hasErr(vRun(["B05"], [c1]), "S1_B1", "VAL_EVIDENCE_UNKNOWN"));
  const c2 = clone(contents.B05); c2.definition.evidenceIds = ["S1_B9.c1"];
  assert.ok(hasErr(vRun(["B05"], [c2]), "S1_B1", "VAL_EVIDENCE_UNKNOWN")); // 없는 계산 참조
  const c3 = clone(contents.B05); c3.definition.evidenceIds = [];
  assert.ok(hasErr(vRun(["B05"], [c3]), "S1_B1", "VAL_EVIDENCE_MISSING")); // lecture 인데 근거 없음
  const c4 = clone(contents.B05); c4.definition.basis = "derived"; // derived 인데 계산 참조 없음
  assert.ok(hasErr(vRun(["B05"], [c4]), "S1_B1", "VAL_EVIDENCE_MISSING"));
  const c5 = clone(contents.B05); c5.definition.basis = "pedagogical"; // 허용 위치 밖
  assert.ok(hasErr(vRun(["B05"], [c5]), "S1_B1", "VAL_BASIS_PLACEMENT"));
  // B11: structural_check 의 misconception 만 pedagogical 을 허용한다
  const b11 = clone(contents.B11); b11.misconception = { text: "틀린 문장", evidenceIds: [], basis: "pedagogical" };
  b11.origin = "structural_check";
  assert.ok(!hasErr(vRun(["B11"], [b11]), "S1_B1", "VAL_BASIS_PLACEMENT"), "구조 점검 오해는 허용");
  const b11b = clone(b11); b11b.origin = "lecture_correction";
  assert.ok(hasErr(vRun(["B11"], [b11b]), "S1_B1", "VAL_BASIS_PLACEMENT"));
  noHangul(vRun(["B05"], [c5]));
});

test("validateSection: 숫자·수식 참조·재타이핑·원문 재현·강조(§10 g)", () => {
  const c1 = clone(contents.B05); c1.definition.text = "고정비는 77777원이다";
  let r = vRun(["B05"], [c1]);
  const det = bErrs(r, "S1_B1").find(e => e.code === "VAL_NUMBER_MISSING");
  assert.ok(det && det.detail.includes("77777") && !/[가-힣]/.test(JSON.stringify(det.detail)));
  // 제목 같은 비주장 문자열도 숫자 검사를 받는다 — 블록이 인용한 근거 안이어야 한다
  const c2 = clone(contents.B10); c2.title = "판매량 88888개";
  assert.ok(hasErr(vRun(["B10"], [c2]), "S1_B1", "VAL_NUMBER_MISSING"));
  // {{F#}} 는 허용 수식만
  const c3 = clone(contents.B05); c3.term = "식 {{F9}}";
  assert.ok(hasErr(vRun(["B05"], [c3]), "S1_B1", "VAL_FORMULA_REF_UNKNOWN"));
  const reg = [{ id: "F1", slideId: "s1", t0: 0, latex: "\\alpha+\\beta=\\gamma", text: null, status: "unverified" }];
  const c4 = clone(contents.B05); c4.term = "식 {{F1}}";
  r = vRun(["B05"], [c4], { registry: reg, formulaUnits: { F1: ["U1"] } });
  assert.ok(!hasErr(r, "S1_B1", "VAL_FORMULA_REF_UNKNOWN"), "허용 수식은 통과");
  // 같은 LaTeX 를 다시 쓰면 재타이핑
  const c5 = clone(contents.B05); c5.term = "\\alpha+\\beta=\\gamma";
  r = vRun(["B05"], [c5], { registry: reg, formulaUnits: { F1: ["U1"] } });
  assert.ok(bErrs(r, "S1_B1").find(e => e.code === "VAL_FORMULA_RETYPED")?.detail.includes("F1"));
  // 새 유도식은 KaTeX 검증
  const c6 = clone(contents.B10); c6.derived = ["\\frac{1}{"];
  assert.ok(hasErr(vRun(["B10"], [c6]), "S1_B1", "VAL_DERIVED_INVALID"));
  // 180자 원문 창을 통째로 옮기면 재현
  const c7 = clone(contents.B05); c7.definition.text = "가".repeat(200);
  r = vRun(["B05"], [c7], { evidence: [...EV, ev("U2.s9", "U2", "가".repeat(200), "speech", 60, 120)] });
  assert.ok(bErrs(r, "S1_B1").find(e => e.code === "VAL_VERBATIM")?.detail.includes("U2.s9"));
  // 강조 표시는 인용 근거에 강조어가 있어야 한다 (U2.s1 은 시험어는 있지만 강조어는 없다)
  r = vRun(["B05"], null, {
    output: { gist: null, checks: [], blocks: {
      S1_B1: { ...env(contents.B05), emphasis: [{ kind: "stress", evidenceIds: ["U2.s1"] }] },
    } },
  });
  assert.ok(hasErr(r, "S1_B1", "VAL_EMPHASIS_UNSUPPORTED"));
  r = vRun(["B05"], null, {
    output: { gist: null, checks: [], blocks: {
      S1_B1: { ...env(contents.B05), emphasis: [{ kind: "exam", evidenceIds: ["U2.s1"] }] },
    } },
  });
  assert.ok(!hasErr(r, "S1_B1", "VAL_EMPHASIS_UNSUPPORTED"), "시험 근거가 있으면 exam 허용");
  // 영어 강의: 영어 강조어도 근거가 된다. "test set" 의 test 는 시험어가 아니다
  const enEv = [...EV, ev("U2.s8", "U2", "This is really important, it will be on the midterm.", "speech", 60, 70), ev("U2.s7", "U2", "We hold out a test set.", "speech", 70, 80)];
  for (const [kind, id, ok] of [["stress", "U2.s8", true], ["exam", "U2.s8", true], ["exam", "U2.s7", false]]) {
    r = vRun(["B05"], null, { evidence: enEv, output: { gist: null, checks: [], blocks: { S1_B1: { ...env(contents.B05), emphasis: [{ kind, evidenceIds: [id] }] } } } });
    assert.equal(!hasErr(r, "S1_B1", "VAL_EMPHASIS_UNSUPPORTED"), ok, kind + " " + id);
  }
  noHangul(r);
});

test("validateSection: 타입별 구조 규칙(§10 h)", () => {
  // B06 — 표 모양과 개념 참조 (B06 에 쓰는 C1 은 mentioned 도 허용)
  const opt06 = { concepts: [C2MEN, { conceptId: "C1", name: "고정비", homeSectionId: "S1", depth: "mentioned" }] };
  // 셀 수는 스키마 범위(2..6) 안이지만 대상 수(2)와 다르다 — 스키마가 아니라 모양 규칙이 잡아야 한다.
  const t1 = clone(contents.B06); t1.criteria[0].cells = [C(), C(), C()];
  assert.ok(hasErr(vRun(["B06"], [t1], opt06), "S1_B1", "VAL_TABLE_SHAPE"));
  const t2 = clone(contents.B06); t2.criteria[0].cells = [null, null];
  assert.ok(hasErr(vRun(["B06"], [t2], opt06), "S1_B1", "VAL_TABLE_EMPTY_ROW"));
  const t3 = clone(contents.B06); t3.entities[0].conceptId = "C9";
  assert.ok(hasErr(vRun(["B06"], [t3], opt06), "S1_B1", "VAL_CONCEPT_REF"));
  // B03 — 노드 키 중복, 없는 끝점, 근거 없는 causes
  const m1 = clone(contents.B03); m1.nodes[1].key = "n1";
  assert.ok(hasErr(vRun(["B03"], [m1]), "S1_B1", "VAL_MAP_REF"));
  const m2 = clone(contents.B03); m2.edges[0].to = "n9";
  assert.ok(hasErr(vRun(["B03"], [m2]), "S1_B1", "VAL_MAP_REF"));
  const m3 = clone(contents.B03); m3.edges[0].relation = "causes";
  assert.ok(hasErr(vRun(["B03"], [m3]), "S1_B1", "VAL_MAP_EDGE_UNSUPPORTED"));
  // B08 — pointRefs 범위와 적용 개념
  const p1 = clone(contents.B08); p1.judgment = { pointRefs: [2], claim: C() };
  const rp = vRun(["B08"], [p1]);
  assert.ok(bErrs(rp, "S1_B1").find(e => e.code === "VAL_POINT_REF")?.detail.includes(2));
  const p2 = clone(contents.B08); p2.appliedConceptIds = ["C9"];
  assert.ok(hasErr(vRun(["B08"], [p2]), "S1_B1", "VAL_CONCEPT_REF"));
  // B09 — 인용 원문 대조
  const q1 = clone(contents.B09); q1.quote = { text: "없는 문장", evidenceIds: ["U1.s1"] };
  assert.ok(hasErr(vRun(["B09"], [q1]), "S1_B1", "VAL_QUOTE_NOT_FOUND"));
  const q2 = clone(contents.B09); q2.quote = { text: "없는 문장", evidenceIds: ["U9.s1"] };
  assert.ok(hasErr(vRun(["B09"], [q2]), "S1_B1", "VAL_QUOTE_NOT_FOUND"));
  const q3 = clone(contents.B09); q3.quote = { text: "가격은 15000원이고", evidenceIds: ["U2.s1"] };
  assert.ok(!hasErr(vRun(["B09"], [q3]), "S1_B1", "VAL_QUOTE_NOT_FOUND"), "원문 그대로면 통과");
  // B05 — 계획 개념과 원어 대조
  const o1 = clone(contents.B05); o1.conceptId = "C9";
  assert.ok(hasErr(vRun(["B05"], [o1]), "S1_B1", "VAL_CONCEPT_REF"));
  const o2 = clone(contents.B05); o2.original = "없는 원어 XYZ";
  assert.ok(hasErr(vRun(["B05"], [o2]), "S1_B1", "VAL_ORIGINAL_UNSUPPORTED"));
  const o3 = clone(contents.B05); o3.original = "한계비용";
  assert.ok(!hasErr(vRun(["B05"], [o3]), "S1_B1", "VAL_ORIGINAL_UNSUPPORTED"), "인용 근거에 있는 원어는 통과");
  // B18 — 기한은 그 항목 주장이 인용한 근거 안
  const d1 = clone(contents.B18); d1.items[0].due = "12월 25일";
  assert.ok(hasErr(vRun(["B18"], [d1]), "S1_B1", "VAL_DUE_NOT_FOUND"));
  const d2 = clone(contents.B18); d2.items[0].due = "10월 15일"; d2.items[0].claim.evidenceIds = ["U2.t1"];
  assert.ok(!hasErr(vRun(["B18"], [d2]), "S1_B1", "VAL_DUE_NOT_FOUND"), "근거에 있는 기한은 통과");
  // B13 — 대상이 계획에 있어야 한다
  const s13 = clone(contents.B13); s13.propositions[0].targetIds = ["S9"];
  assert.ok(hasErr(vRun(["B13"], [s13]), "S1_B1", "VAL_REF_UNKNOWN"));
  // B10 — 입력 근거·수치·레지스트리 참조
  const i1 = b10Calc(); i1.inputs = [{ label: "x", value: 77777, unit: "원", evidenceIds: ["U1.s1"] }];
  const ri = vRun(["B10"], [i1]);
  assert.ok(bErrs(ri, "S1_B1").find(e => e.code === "VAL_CALC_INPUT_UNSUPPORTED")?.detail.includes("i1"));
  const i2 = b10Calc(); i2.inputs = [{ label: "x", value: 3000000, unit: "원", evidenceIds: ["U9.s1"] }];
  assert.ok(hasErr(vRun(["B10"], [i2]), "S1_B1", "VAL_EVIDENCE_UNKNOWN"));
  const i3 = b10Calc(); i3.formulaIds = ["F9"]; i3.figureIds = ["G9"];
  const ri3 = vRun(["B10"], [i3]);
  assert.ok(hasErr(ri3, "S1_B1", "VAL_REF_UNKNOWN"));
  const i4 = b10Calc.set(b10Calc()); i4.steps = [stp("add", "i1", "i1", 999, "원")];
  assert.ok(hasErr(vRun(["B10"], [i4]), "S1_B1", "VAL_CALC_MISMATCH"));
});

test("validateSection: 문항 규칙과 대상·복습 위치(§10 h B14)", () => {
  const item = (over = {}, ans = {}) => ({
    kind: "recall", prompt: C(), premise: null, level: "basic", targetIds: ["S1_B2"],
    answer: { verdict: null, explanation: C(), correction: null, rubric: [], alternatives: [], reviewIds: ["S1_B2"], ...ans },
    ...over,
  });
  const sec14 = (items, extraPlan = {}) => vRun(["B14", "B05"], [{ items }, contents.B05], extraPlan);
  // OX: verdict 필수
  assert.ok(hasErr(sec14([item({ kind: "ox" })]), "S1_B1", "VAL_ANSWER_SHAPE"));
  // X: prompt=pedagogical + 근거 있는 correction
  const xBad = item({ kind: "ox" }, { verdict: "X" });
  assert.ok(hasErr(sec14([xBad]), "S1_B1", "VAL_ANSWER_SHAPE"));
  const xOk = item({ kind: "ox", prompt: { text: "틀린 문장", evidenceIds: ["U1.s1"], basis: "pedagogical" } },
    { verdict: "X", correction: C() });
  const rx = sec14([xOk]);
  assert.ok(!hasErr(rx, "S1_B1", "VAL_ANSWER_SHAPE"), JSON.stringify(bErrs(rx, "S1_B1")));
  // O: prompt 는 근거 주장이고 correction 은 null
  const oBad = item({ kind: "ox" }, { verdict: "O", correction: C() });
  assert.ok(hasErr(sec14([oBad]), "S1_B1", "VAL_ANSWER_SHAPE"));
  const oPed = item({ kind: "ox", prompt: { text: "틀린 문장", evidenceIds: [], basis: "pedagogical" } }, { verdict: "O" });
  const roPed = sec14([oPed]);
  assert.ok(hasErr(roPed, "S1_B1", "VAL_ANSWER_SHAPE") && hasErr(roPed, "S1_B1", "VAL_BASIS_PLACEMENT"));
  const oOk = item({ kind: "ox" }, { verdict: "O" });
  assert.ok(!hasErr(sec14([oOk]), "S1_B1", "VAL_ANSWER_SHAPE"));
  // 비 OX: verdict·correction 은 null, prompt 는 근거 주장
  const nBad = item({}, { verdict: "O" });
  assert.ok(hasErr(sec14([nBad]), "S1_B1", "VAL_ANSWER_SHAPE"));
  // argue: rubric 필수 / calc: 이 섹션 B10 의 검산 참조
  assert.ok(hasErr(sec14([item({ kind: "argue" })]), "S1_B1", "VAL_ANSWER_SHAPE"));
  assert.ok(hasErr(sec14([item({ kind: "argue" }, { rubric: [C()] })]), "S1_B1", "VAL_ANSWER_SHAPE") === false);
  const calcQ = item({ kind: "calc" }, { explanation: { text: "해설", evidenceIds: ["S1_B9.c1"], basis: "derived" } });
  const rc = sec14([calcQ]);
  assert.ok(hasErr(rc, "S1_B1", "VAL_ANSWER_SHAPE") && hasErr(rc, "S1_B1", "VAL_EVIDENCE_UNKNOWN"));
  // 대상: 없는 블록, mentioned 개념, 자기 블록/전역/미계획 복습 위치
  const noTgt = item(); noTgt.targetIds = ["S9_B1"];
  assert.ok(hasErr(sec14([noTgt]), "S1_B1", "VAL_REF_UNKNOWN"));
  const men = sec14([item()], { concepts: [C1DEF, C2MEN] });
  assert.ok(!hasErr(men, "S1_B1", "VAL_REF_UNKNOWN"), "S1_B2 대상은 통과");
  const menBad = sec14([(() => { const it = item(); it.targetIds = ["C2"]; return it; })()], { concepts: [C1DEF, C2MEN] });
  assert.ok(hasErr(menBad, "S1_B1", "VAL_REF_UNKNOWN"), "mentioned 개념은 문항 대상 불가");
  const own = sec14([item({}, { reviewIds: ["S1_B1"] })]);
  assert.ok(hasErr(own, "S1_B1", "VAL_REF_UNKNOWN"), "자기 블록 복습 위치 불가");
  const gb = sec14([item({}, { reviewIds: ["S9_B1"] })]);
  assert.ok(hasErr(gb, "S1_B1", "VAL_REF_UNKNOWN"), "계획에 없는 복습 위치 불가(전역 id 는 스키마가 이미 거른다)");
  const same = sec14([item({}, { reviewIds: ["S1_B2"] })]);
  assert.ok(!hasErr(same, "S1_B1", "VAL_REF_UNKNOWN"), "같은 섹션의 다른 블록도 복습 위치가 된다");
  const ok14 = sec14([item()]);
  assert.deepEqual(bErrs(ok14, "S1_B1"), [], "정상 문항은 통과");
});

test("validateSection: 계산 색인 연쇄 — 깨진 B10 의 참조는 VAL_EVIDENCE_UNKNOWN", () => {
  // B10 이 모든 검사를 통과해야 같은 섹션 블록이 그 계산값을 참조할 수 있다.
  const good = b10Calc.set(b10Calc());
  const citing = clone(contents.B05);
  citing.definition = { text: "계산은 6000000이다", evidenceIds: ["S1_B1.c1"], basis: "derived" };
  const ok = vRun(["B10", "B05"], [good, citing]);
  assert.ok(!hasErr(ok, "S1_B2", "VAL_EVIDENCE_UNKNOWN"), JSON.stringify(bErrs(ok, "S1_B2")));
  assert.ok(ok.calc["S1_B1.c1"] === 6000000);
  // 검산이 깨진 B10 의 참조는 인용 불가 — 인용한 블록도 같은 회차에 걸린다
  const bad = b10Calc.set(b10Calc()); bad.steps = [stp("add", "i1", "i1", 7, "원")];
  const r = vRun(["B10", "B05"], [bad, citing]);
  assert.ok(hasErr(r, "S1_B1", "VAL_CALC_MISMATCH") && hasErr(r, "S1_B2", "VAL_EVIDENCE_UNKNOWN"));
  // 다른 섹션의 계산은 참조할 수 없다 (병렬 작성이라 서로를 보지 못한다, §7)
  const r2 = vRun(["B05"], [(() => { const c = clone(contents.B05); c.definition = { text: "x", evidenceIds: ["S2_B1.c1"], basis: "derived" }; return c; })()]);
  assert.ok(hasErr(r2, "S1_B1", "VAL_EVIDENCE_UNKNOWN"));
});

test("validateSection: 정정 지도와 상태·커버리지(§10 d,i,j)", () => {
  const chk = {
    kind: "correction", claim: C(), targetIds: ["S1_B1"],
    before: { text: "옛 문장", evidenceIds: ["U1.s1"], basis: "lecture" },
    after: { text: "새 문장", evidenceIds: ["U1.t1"], basis: "lecture" },
    hold: null,
  };
  // before 근거만 인용하면 VAL_SUPERSEDED — 주장과 비주장 근거 목록 둘 다
  const alone = vRun(["B05"], [contents.B05], { checks: [chk] });
  assert.ok(hasErr(alone, "S1_B1", "VAL_SUPERSEDED"));
  const both = clone(contents.B05); both.definition.evidenceIds = ["U1.s1", "U1.t1"];
  const rb = vRun(["B05"], [both], { checks: [chk] });
  assert.ok(!hasErr(rb, "S1_B1", "VAL_SUPERSEDED") && rb.checks.length === 1);
  const inp = b10Calc.set(b10Calc()); // input 이 옛 근거만 인용
  const ri = vRun(["B10"], [inp], { checks: [{ ...chk, targetIds: ["S1_B1"] }] });
  assert.ok(hasErr(ri, "S1_B1", "VAL_SUPERSEDED"), "B10 입력도 정정 규칙을 받는다");
  // 형식이 어긋난 정정 항목은 조용히 버려진다 — 지도에도 오르지 않는다
  const badChk = { ...chk, after: null };
  const rd = vRun(["B05"], [contents.B05], { checks: [badChk] });
  assert.ok(!hasErr(rd, "S1_B1", "VAL_SUPERSEDED") && rd.checks.length === 0);
  const offSec = { ...chk, targetIds: ["S9_B1"] };
  assert.equal(vRun(["B05"], [contents.B05], { checks: [offSec] }).checks.length, 0);
  // 상태: supported 가 아니면 유효한 확인 항목이 가리켜야 한다
  const unc = { ...env(contents.B05), status: "uncertain" };
  const ru = vRun(["B05"], null, { output: { gist: null, blocks: { S1_B1: unc }, checks: [] } });
  assert.ok(hasErr(ru, "S1_B1", "VAL_STATUS_UNEXPLAINED"));
  const miss = { kind: "missing", claim: C(), targetIds: ["S1_B1"], before: null, after: null, hold: null };
  const re = vRun(["B05"], null, { output: { gist: null, blocks: { S1_B1: unc }, checks: [miss] } });
  assert.ok(!hasErr(re, "S1_B1", "VAL_STATUS_UNEXPLAINED") && re.checks.length === 1);
  // 커버리지: 자기 유닛의 절반이 인용돼야 한다 — 1/4 은 경고(섹션을 버리지 않는다)
  const big = vPlan([{ ...vSec(["B05"]), unitIds: ["U1", "U2", "U3", "U4"] }], {
    concepts: [C1DEF], units: ["U1", "U2", "U3", "U4"].map(u => ({ unitId: u })),
  });
  const rl = vRun(["B05"], [contents.B05], { plan: big });
  assert.ok(rl.warnings.find(e => e.code === "VAL_COVERAGE_LOW")?.detail.includes("1/4"));
  assert.equal(rl.errors.length, 0, "커버리지 부족만으로는 섹션 오류가 아니다");
  noHangul(alone); noHangul(rl);
});

test("validateGlobal: 새 근거 금지·계획에 있는(빠진) 대상은 오류 아님(§8.4)", () => {
  const plan = vPlan([vSec(["B05", "B07"])], {
    concepts: [C1DEF], global: [{ type: "B02", purpose: "p", conceptIds: [] }],
  });
  const secRes = vRun(["B05", "B07"], [contents.B05, null], { plan });
  assert.ok(secRes.cited.includes("U1.s1"));
  const gOut = items => ({ blocks: { GB1: env({ question: null, mode: "conclusions", items }) } });
  const gItem = (claim, targetIds) => ({ claim, reason: null, targetIds });
  const gArgs = {
    plan, sections: [{ ...secRes, blocks: secRes.blocks.filter(b => !b.errors.length) }],
    evidence: EV, registry: [], katex,
  };
  // 살아남은 섹션이 인용하지 않은 근거는 존재해도 새 근거다 — U2.s1 도 U9.s9 도 마찬가지
  let rg = NC.validateGlobal({ ...gArgs, output: gOut([gItem({ text: "새 근거", evidenceIds: ["U2.s1", "U9.s9"], basis: "lecture" }, ["S1_B2"])]) });
  const newE = rg.blocks[0].errors.find(e => e.code === "VAL_GLOBAL_EVIDENCE_NEW");
  assert.ok(newE && newE.detail.includes("U2.s1") && newE.detail.includes("U9.s9"));
  // S1_B2 는 보류로 빠졌지만 계획에는 있다 — 검증에서는 대상 오류가 아니다(조립이 정리)
  assert.ok(!rg.blocks[0].errors.some(e => e.code === "VAL_REF_UNKNOWN"));
  rg = NC.validateGlobal({ ...gArgs, output: gOut([gItem({ text: "정상", evidenceIds: ["U1.s1"], basis: "lecture" }, ["S1_B2"])]) });
  assert.deepEqual(rg.blocks[0].errors, [], JSON.stringify(rg.blocks[0].errors));
  // 전역에는 pedagogical 자리가 없다
  rg = NC.validateGlobal({ ...gArgs, output: gOut([gItem({ text: "거짓", evidenceIds: [], basis: "pedagogical" }, ["S1_B1"])]) });
  assert.ok(rg.blocks[0].errors.some(e => e.code === "VAL_BASIS_PLACEMENT"));
  // 출력이 없거나 null 블록이면 그 블록만 걸린다
  rg = NC.validateGlobal({ ...gArgs, output: { blocks: {} } });
  assert.ok(rg.blocks[0].errors.some(e => e.code === "VAL_SCHEMA"));
});

// §12 assembleNote: 전부 통과하는 최소 노트 재료
const REG = [
  { id: "F1", slideId: "s1", t0: 0, latex: "x+1", text: "x+1", status: "verified" },
  { id: "F2", slideId: "s1", t0: 0, latex: null, text: "y=2x", status: "image" },
  { id: "F3", slideId: "s1", t0: 0, latex: null, text: "z=3", status: "unverified" },
  { id: "F4", slideId: "s1", t0: 0, latex: null, text: "w=4", status: "unverified" },
];
const FIGS = [{ id: "G1", evidenceId: "U2.g1", unitId: "U2", slideId: "s2", t0: 60, kind: "chart", title: "차트", cells: null }];
const FU = { F1: ["U1"], F2: ["U1"], F3: ["U1"], F4: ["U1"] };
const aPlan = (global = [{ type: "B02", purpose: "p", conceptIds: [] }]) => vPlan([vSec(null, {
  blocks: [
    { type: "B05", purpose: "p", conceptIds: ["C1"], formulaIds: [], figureIds: [] },
    { type: "B10", purpose: "p", conceptIds: [], formulaIds: ["F2", "F3"], figureIds: ["G1"] },
  ],
})], { concepts: [C1DEF], global, formulaUnits: FU, figures: [{ id: "G1", unitId: "U2" }] });
const aOut = () => {
  const b05 = clone(contents.B05);
  b05.explanation = { text: "설명", evidenceIds: ["U2.s1"], basis: "lecture" };
  const b10 = b10Calc.set(b10Calc()); b10.formulaIds = ["F2", "F3"];
  return { gist: { text: "요지", evidenceIds: ["U1.s1"], basis: "lecture" }, checks: [], blocks: { S1_B1: env(b05), S1_B2: env(b10) } };
};
const aArgs = (over = {}) => ({
  plan: aPlan(), sections: [{ sectionId: "S1", output: aOut() }],
  global: { blocks: { GB1: env({ question: null, mode: "conclusions", items: [{ claim: C(), reason: null, targetIds: ["S1_B1"] }] }) } },
  units: UNITS, evidence: EV, registry: REG, formulaUnits: FU, figures: FIGS, crops: ["F2"],
  meta: META, tier: "paid", systemNotices: [], promptVersion: "v1", katex, ...over,
});
const noticeOf = (n, code) => n.notices.find(x => x.code === code);

test("assembleNote: 비전이 준 빈 제목·빈 그래프 값은 노트 스키마에 맞게 null 로 둔다(조립이 던지지 않는다)", () => {
  // 필드: 슬라이드 인식 스키마는 "" 와 빈 목록을 허용하지만 노트 스키마는 최소 1글자·1개를 요구한다 — 조립이 UNKNOWN 으로 멈췄다.
  const bad = { type: "line", categories: [], series: [{ name: "", values: [] }], unit: "", xLabel: "", yLabel: "" };
  const ok = { type: "bar", categories: ["a"], series: [{ name: "s", values: [1] }], unit: "", xLabel: "x", yLabel: "" };
  const figs = [{ ...FIGS[0], title: " ", chartData: bad }, { ...FIGS[0], id: "G2", title: "", chartData: ok }];
  const note = NC.assembleNote(aArgs({ figures: figs }));
  assert.deepEqual(note.figures.map(f => f.title), [null, null]);
  assert.equal(note.figures[0].chartData, null, "고칠 수 없는 그래프 값은 버린다");
  assert.deepEqual(note.figures[1].chartData, { ...ok, unit: null, yLabel: null }, "빈 단위·축 이름만 null");
});

test("assembleNote: 완전한 노트 — 결정적이고 입력을 바꾸지 않는다", () => {
  const args = aArgs();
  const snap = clone({ plan: args.plan, sections: args.sections, global: args.global, units: args.units, evidence: args.evidence, registry: args.registry, formulaUnits: args.formulaUnits, figures: args.figures, crops: args.crops, meta: args.meta, systemNotices: args.systemNotices });
  const n1 = NC.assembleNote(args), n2 = NC.assembleNote(args);
  assert.deepEqual(n1, n2, "같은 입력이면 같은 노트다");
  assert.deepEqual({ plan: args.plan, sections: args.sections, global: args.global, units: args.units, evidence: args.evidence, registry: args.registry, formulaUnits: args.formulaUnits, figures: args.figures, crops: args.crops, meta: args.meta, systemNotices: args.systemNotices }, snap, "입력 불변");
  assert.equal(n1.status, "complete");
  assert.deepEqual(Contracts.validate(NC.schemas.note, n1), { ok: true });
  assert.equal(n1.schemaVersion, 1);
  assert.equal(n1.noteSpecVersion, "lecture-note-2");
  assert.equal(n1.promptVersion, "v1");
  assert.equal(n1.tier, "paid");
  assert.deepEqual(n1.sections[0].blocks.map(b => b.id), ["S1_B1", "S1_B2"]);
  assert.equal(n1.sections[0].number, 1);
  assert.deepEqual(n1.sections[0].range, { t0: 0, t1: 120 });
  assert.equal(n1.sections[0].gist.text, "요지");
  assert.equal(n1.global.length, 1);
  assert.equal(n1.global[0].type, "B02");
  assert.equal(n1.global[0].sectionId, null);
  assert.equal(n1.concepts[0].homeBlockId, "S1_B1");
  // 표시: verified+latex → latex, 나머지는 크롭 유무 — 고지는 노트가 참조한 것만 센다
  assert.deepEqual(Object.fromEntries(n1.registry.map(f => [f.id, f.display])),
    { F1: "latex", F2: "crop", F3: "check", F4: "check" });
  assert.deepEqual(noticeOf(n1, "NOTE_FORMULAS_IMAGE").ids, ["F2"]);
  assert.deepEqual(noticeOf(n1, "NOTE_FORMULAS_CHECK").ids, ["F3"]); // F4 는 참조되지 않아 고지 없음
  assert.deepEqual(noticeOf(n1, "NOTE_FIGURES_CHECK").ids, ["G1"]);
  assert.ok(!noticeOf(n1, "NOTE_FIGURES_NOT_DETECTED"), "paid");
  assert.ok(!noticeOf(n1, "NOTE_UNITS_UNCITED"), "두 유닛 모두 인용됨");
  assert.deepEqual(n1.sources.map(s => s.id), ["U1.s1", "U2.s1"], "근거 배열 순서대로 인용분만");
  assert.deepEqual(n1.dropped, []);
  assert.deepEqual(n1.pruned, []);
});

test("assembleNote: 의존 정리 — 죽은 대상·복습 위치·앵커와 다회차 연쇄(§12.2)", () => {
  const plan = vPlan([vSec(null, {
    blocks: [
      { type: "B05", purpose: "p", conceptIds: ["C1"], formulaIds: [], figureIds: [] },
      { type: "B12", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] },
      { type: "B14", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] },
      { type: "B18", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] },
    ],
  })], { concepts: [C1DEF] });
  const q = (over = {}, ans = {}) => ({
    kind: "recall", prompt: C(), premise: null, level: "basic", targetIds: ["S1_B4"],
    answer: { verdict: null, explanation: C(), correction: null, rubric: [], alternatives: [], reviewIds: ["S1_B4"], ...ans },
    ...over,
  });
  const output = {
    gist: null, checks: [],
    blocks: {
      S1_B1: null,                 // 보류 → S1_B2 곁설명의 앵커가 죽는다
      S1_B2: env(contents.B12),
      S1_B3: env({ items: [
        q({ targetIds: ["S1_B2"] }),                            // 앵커가 먼저 죽고 다음 회차에 정리
        q({ targetIds: ["S1_B4"] }, { reviewIds: ["S1_B1"] }),  // 복습 위치가 전부 죽음
        q(),                                                  // 살아남는다
      ] }),
      S1_B4: env(contents.B18),
    },
  };
  const note = NC.assembleNote(aArgs({
    plan, sections: [{ sectionId: "S1", output }], global: null,
    registry: [], formulaUnits: {}, figures: [], crops: [],
  }));
  const pruned = Object.fromEntries(note.pruned.map(p => [p.id, p.codes]));
  assert.deepEqual(pruned["S1_B3/Q2"], ["NOTE_REVIEW_DROPPED"]);
  assert.deepEqual(pruned["S1_B3/Q1"], ["NOTE_TARGET_DROPPED"], "정리 전 위치 ID 로 남는다");
  const dropped = Object.fromEntries(note.dropped.map(d => [d.blockId, d.codes]));
  assert.deepEqual(dropped.S1_B1, ["VAL_BLOCK_DECLINED"]);
  assert.deepEqual(dropped.S1_B2, ["NOTE_ANCHOR_DROPPED"]);
  assert.deepEqual(note.sections.map(s => s.sectionId), ["S1"]);
  assert.equal(note.sections[0].blocks.length, 2);
  assert.equal(note.sections[0].blocks[0].content.items.length, 1, "살아남은 문항만 남는다");
  assert.equal(note.status, "partial", "제외된 블록이 있으면 partial");
  assert.ok(noticeOf(note, "NOTE_BLOCKS_DROPPED") && noticeOf(note, "NOTE_ITEMS_PRUNED"));
  // 고지·제외·정리 기록에는 코드와 id 만 있다 — 내용(한글)이 새어 나가지 않는다
  for (const x of [...note.notices, ...note.dropped, ...note.pruned])
    assert.ok(!/[가-힣]/.test(JSON.stringify(x)), JSON.stringify(x));
});

test("assembleNote: 목록이 비면 블록을 거두고 블록이 없으면 섹션이 실패한다", () => {
  const plan = vPlan([vSec(null, {
    blocks: [
      { type: "B14", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] },
      { type: "B05", purpose: "p", conceptIds: ["C1"], formulaIds: [], figureIds: [] },
    ],
  })], { concepts: [C1DEF] });
  const item = {
    kind: "recall", prompt: C(), premise: null, level: "basic", targetIds: ["S1_B2"],
    answer: { verdict: null, explanation: C(), correction: null, rubric: [], alternatives: [], reviewIds: ["S1_B2"] },
  };
  const output = { gist: null, blocks: { S1_B1: env({ items: [item] }), S1_B2: null }, checks: [] };
  const note = NC.assembleNote(aArgs({
    plan, sections: [{ sectionId: "S1", output }], global: null,
    registry: [], formulaUnits: {}, figures: [], crops: [],
  }));
  assert.equal(note.sections.length, 0, "유일한 살아남은 블록이 빠지면 섹션 실패");
  const nf = noticeOf(note, "NOTE_SECTIONS_FAILED");
  assert.ok(nf && nf.ids.includes("S1") && nf.count === 1);
  assert.deepEqual(nf.ranges, [{ t0: 0, t1: 120 }]);
  assert.ok(note.pruned.find(p => p.id === "S1_B1/Q1"));
  assert.ok(note.dropped.find(d => d.blockId === "S1_B1")?.codes.includes("NOTE_DEPENDENCY_DROPPED"));
  // B12 곁설명: 계획상 앞 블록이 빠지면 함께 간다
  const plan2 = vPlan([vSec(null, {
    blocks: [
      { type: "B05", purpose: "p", conceptIds: ["C1"], formulaIds: [], figureIds: [] },
      { type: "B12", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] },
    ],
  })], { concepts: [C1DEF] });
  const note2 = NC.assembleNote(aArgs({
    plan: plan2, global: null, registry: [], formulaUnits: {}, figures: [], crops: [],
    sections: [{ sectionId: "S1", output: { gist: null, checks: [], blocks: { S1_B1: null, S1_B2: env(contents.B12) } } }],
  }));
  assert.equal(note2.sections.length, 0);
  assert.ok(note2.dropped.find(d => d.blockId === "S1_B2")?.codes.includes("NOTE_ANCHOR_DROPPED"));
});

test("assembleNote: 정정 지도는 섹션을 넘어 2차 검증에 적용된다(§6)", () => {
  const plan = vPlan([
    vSec(["B05"], { unitIds: ["U1"] }),
    vSec(["B07", "B18"], { sectionId: "S2", unitIds: ["U2"], crossUnitIds: ["U1"] }),
  ], { concepts: [C1DEF] });
  // S1 의 정정 확인 항목: U1.s1 → U1.t1
  const chk = {
    kind: "correction", claim: { text: "c", evidenceIds: ["U1.t1"], basis: "lecture" }, targetIds: ["S1_B1"],
    before: { text: "b", evidenceIds: ["U1.s1"], basis: "lecture" },
    after: { text: "a", evidenceIds: ["U1.t1"], basis: "lecture" }, hold: null,
  };
  const s1 = clone(contents.B05); s1.definition = { text: "새 정의", evidenceIds: ["U1.t1"], basis: "lecture" };
  const s1Out = { gist: null, checks: [chk], blocks: { S1_B1: env(s1) } };
  // S2 는 교차 유닛 U1 을 쓸 수 있다 — 옛 근거만 인용하면 1차는 통과하지만 2차에서 걸린다
  const s2b18 = clone(contents.B18); s2b18.items[0].claim.evidenceIds = ["U2.t1"];
  const s2Out = { gist: null, checks: [], blocks: { S2_B1: env(contents.B07), S2_B2: env(s2b18) } };
  const note = NC.assembleNote(aArgs({
    plan, global: null, registry: [], formulaUnits: {}, figures: [], crops: [],
    sections: [{ sectionId: "S1", output: s1Out }, { sectionId: "S2", output: s2Out }],
  }));
  assert.deepEqual(note.sections.map(s => s.sectionId), ["S1", "S2"], "S2 는 다른 블록이 살아 남는다");
  assert.deepEqual(note.sections[1].blocks.map(b => b.id), ["S2_B2"]);
  assert.deepEqual(note.dropped.find(d => d.blockId === "S2_B1")?.codes, ["VAL_SUPERSEDED"]);
  assert.equal(note.sections[0].checks.length, 1, "정정 확인 항목은 노트에 남는다");
});

test("assembleNote: 실패한 섹션·인용 안 된 유닛·Free 고지", () => {
  const units3 = [...UNITS, { unitId: "U3", t0: 120, t1: 180 }];
  const plan = vPlan([
    vSec(["B05"], { unitIds: ["U1", "U2"] }),
    vSec(["B07"], { sectionId: "S2", unitIds: ["U3"] }),
  ], { concepts: [C1DEF], units: units3 });
  const note = NC.assembleNote(aArgs({
    plan, global: null, registry: [], formulaUnits: {}, figures: [], crops: [], units: units3,
    sections: [
      { sectionId: "S1", output: { gist: null, checks: [], blocks: { S1_B1: env(contents.B05) } } },
      { sectionId: "S2", output: null },
    ],
    tier: "free",
  }));
  assert.equal(note.tier, "free");
  assert.equal(note.status, "partial");
  const nf = noticeOf(note, "NOTE_SECTIONS_FAILED");
  assert.deepEqual(nf.ids, ["S2"]);
  assert.deepEqual(nf.ranges, [{ t0: 120, t1: 180 }], "실패 섹션 자기 유닛의 구간");
  assert.ok(!note.dropped.some(d => d.blockId.startsWith("S2")), "실패 섹션의 블록은 dropped 에 없다");
  assert.ok(!note.sections.some(s => s.sectionId === "S2"));
  assert.deepEqual(noticeOf(note, "NOTE_UNITS_UNCITED").ids, ["U2"], "살아남은 섹션에서 인용되지 않은 유닛");
  assert.deepEqual(noticeOf(note, "NOTE_UNITS_UNCITED").ranges, [{ t0: 60, t1: 120 }]);
  // 판정이 잡담(중요도 1.5 미만)으로 본 유닛은 미인용으로 세지 않는다. 경계 1.5 는 센다
  for (const [importance, counted] of [[1.2, false], [1.5, true]]) {
    const scored = units3.map(u => u.unitId === "U2" ? { ...u, judge: { importance, lectureProb: null } } : u);
    const n2 = NC.assembleNote(aArgs({ plan, global: null, registry: [], formulaUnits: {}, figures: [], crops: [], units: scored,
      sections: [{ sectionId: "S1", output: { gist: null, checks: [], blocks: { S1_B1: env(contents.B05) } } }, { sectionId: "S2", output: null }], tier: "free" }));
    assert.equal(!!noticeOf(n2, "NOTE_UNITS_UNCITED"), counted, "importance " + importance);
  }
  const free = noticeOf(note, "NOTE_FIGURES_NOT_DETECTED");
  assert.ok(free && free.count === null && free.ids === null && free.ranges === null);
  for (const x of [...note.notices, ...note.dropped, ...note.pruned])
    assert.ok(!/[가-힣]/.test(JSON.stringify(x)), JSON.stringify(x));
});

test("assembleNote: 권장량 초과는 조판 힌트로만 나간다", () => {
  const C1MEN = { conceptId: "C1", name: "고정비", homeSectionId: "S1", depth: "mentioned" };
  const ox = targetIds => ({
    kind: "ox", prompt: C(), premise: null, level: "basic", targetIds,
    answer: { verdict: "O", explanation: C(), correction: null, rubric: [], alternatives: [], reviewIds: ["S1_B3"] },
  });
  const plan = vPlan([vSec(null, {
    blocks: [
      { type: "B06", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] },
      { type: "B14", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] },
      { type: "B12", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] },
      { type: "B03", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] },
      { type: "B09", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] },
    ],
  })], { concepts: [C1MEN] });
  const b06 = clone(contents.B06);
  b06.entities = [{ label: "A", conceptId: null }, { label: "B", conceptId: "C1" }, { label: "C", conceptId: null }, { label: "D", conceptId: null }];
  b06.criteria = [{ label: "기준", cells: [C(), null, null, null] }];
  const b12 = { kind: "term", note: { text: "힌트 ".repeat(50), evidenceIds: ["U1.s1"], basis: "lecture" } };
  const b03 = {
    title: "지도",
    nodes: Array.from({ length: 8 }, (_, i) => ({ key: `n${i + 1}`, label: `노드${i + 1}`, targetId: null })),
    edges: [{ from: "n1", to: "n2", relation: "includes", claim: null }],
  };
  const output = {
    gist: null, checks: [],
    blocks: {
      S1_B1: env(b06),
      S1_B2: env({ items: [ox(["S1_B5"]), ox(["S1_B4"])] }),
      S1_B3: env(b12),
      S1_B4: env(b03),
      S1_B5: env(contents.B09),
    },
  };
  const note = NC.assembleNote(aArgs({
    plan, sections: [{ sectionId: "S1", output }], global: null,
    registry: [], formulaUnits: {}, figures: [], crops: [],
  }));
  assert.equal(note.status, "complete", "권장량 초과는 내용을 자르거나 실패시키지 않는다");
  const adv = note.advisories.map(a => `${a.code}:${a.id}`);
  assert.ok(adv.includes("NOTE_ADVISORY_TABLE_WIDE:S1_B1"));
  assert.ok(adv.includes("NOTE_ADVISORY_OX_ONLY:S1_B2"));
  assert.ok(adv.includes("NOTE_ADVISORY_OX_CONTESTED:S1_B2/Q1"), "OX 문항이 자료 읽기를 가리킨다");
  assert.ok(adv.includes("NOTE_ADVISORY_LENGTH:S1_B3"), "곁설명 140자 초과");
  assert.ok(adv.includes("NOTE_ADVISORY_MAP_LARGE:S1_B4"));
});

// 교차 리뷰(agy)에서 찾은 우회 경로의 회귀 테스트.
test("normalizePlan: Planner 가 쓴 제목·질문·개념 이름의 숫자도 유닛 근거에 있어야 한다", () => {
  const units = [{ unitId: "U1", t0: 0, t1: 60, slideText: "고정비는 300만 원", speech: "" }];
  const sec = over => ({ ...vSec(["B05"]), unitIds: ["U1"], ...over });
  const run = (s, name = "고정비") => NC.normalizePlan(
    { concepts: [{ ...C1DEF, name }], sections: [s], global: [] }, { units });
  assert.equal(run(sec({ title: "300만 원의 고정비" })).ok, true, "근거에 있는 숫자는 통과");
  assert.ok(run(sec({ title: "1937년의 거래비용 이론" })).errors[0].detail.includes("number:S1"));
  assert.ok(run(sec({ question: "2025년 개정은?" })).errors[0].detail.includes("number:S1"));
  assert.ok(run(sec({}), "1960년대 고정비").errors[0].detail.includes("number:C1"));
});

test("Point 대상은 1부터다(P0 거절)", () => {
  const re = new RegExp(NC.IDS.target);
  assert.ok(re.test("S2_B3/P1") && re.test("S2_B3/P6"));
  assert.ok(!re.test("S2_B3/P0") && !re.test("S2_B3/P7"));
});

test("validateSection: 섹션 안 강의 지도의 노드 대상도 계획에 있어야 한다", () => {
  const m = clone(contents.B03); m.nodes[1].targetId = "S9";
  assert.ok(hasErr(vRun(["B03"], [m]), "S1_B1", "VAL_REF_UNKNOWN"));
  assert.ok(!hasErr(vRun(["B03"], [contents.B03]), "S1_B1", "VAL_REF_UNKNOWN"));
});

// §18 생성 옵션(lecture-note-2): 켠 옵션의 basis 만, 허용 위치에서만 통과한다. 강의 근거·숫자 검사는 받지 않는다.
test("augmentation: synthetic·external 는 켠 옵션과 허용 위치에서만 통과한다", () => {
  const aug = (policy, mutate) => {
    const plan = { ...vPlan1(["B05"]), policy };
    const b = clone(contents.B05); mutate(b);
    return vRun(["B05"], [b], { plan });
  };
  const SYN = { text: "가상의 카페가 월 1,234잔을 판다고 하자", evidenceIds: [], basis: "synthetic" };
  const EXT = { text: "이 개념은 1937년 코스가 처음 제시했다", evidenceIds: [], basis: "external" };
  const on = { syntheticExamples: true, externalAugmentation: true };
  // 꺼진 옵션: 스키마에서 basis 가 거절된다
  assert.ok(hasErr(aug(NC.POLICY, b => { b.examples = [SYN]; }), "S1_B1", "VAL_SCHEMA"));
  // 켠 옵션 + 허용 위치: 숫자가 근거에 없어도 통과
  let r = aug(on, b => { b.examples = [SYN]; b.explanation = EXT; });
  assert.ok(!bErrs(r, "S1_B1").length, JSON.stringify(bErrs(r, "S1_B1")));
  // 허용 위치 밖(정의)은 VAL_BASIS_PLACEMENT
  r = aug(on, b => { b.definition = SYN; });
  assert.ok(hasErr(r, "S1_B1", "VAL_BASIS_PLACEMENT"));
  // 한쪽만 켠 경우 다른 쪽은 스키마에서 거절
  r = aug({ syntheticExamples: true, externalAugmentation: false }, b => { b.explanation = EXT; });
  assert.ok(hasErr(r, "S1_B1", "VAL_SCHEMA"));
  assert.equal(NC.policyOf({ syntheticExamples: "yes" }).syntheticExamples, false);
});

test("canonicalPlanIds: 제멋대로인 개념·섹션 id 를 C1../S1.. 로 매기고 참조를 옮긴다", () => {
  const raw = { concepts: [{ conceptId: "concept_a", name: "가", homeSectionId: "sec-2", depth: "defined" }, { conceptId: 7, name: "나", homeSectionId: "S1", depth: "mentioned" }],
    sections: [{ sectionId: "S1", blocks: [{ type: "B04", conceptIds: [7, "x"] }] }, { sectionId: "sec-2", blocks: [{ type: "B05", conceptIds: ["concept_a"] }] }],
    global: [{ type: "B02", conceptIds: ["concept_a"] }] };
  const out = NC.canonicalPlanIds(raw);
  assert.deepEqual(out.concepts.map(c => [c.conceptId, c.homeSectionId]), [["C1", "S2"], ["C2", "S1"]]);
  assert.deepEqual([...out.sections[0].blocks[0].conceptIds], ["C2"], "모양이 틀린 참조는 뗀다");
  const f = NC.canonicalPlanIds({ concepts: [], global: [], sections: [{ sectionId: "S1", crossUnitIds: ["U1", "u2"], blocks: [{ type: "B10", conceptIds: [], formulaIds: ["F1", "식1", 3, "F2", "F3", "F4", "F5", "F6", "F7"], figureIds: ["G1", "fig"] }] }] });
  assert.deepEqual([...f.sections[0].blocks[0].formulaIds], ["F1", "F2", "F3", "F4", "F5", "F6"]);
  assert.deepEqual([...f.sections[0].blocks[0].figureIds], ["G1"]);
  assert.deepEqual([...f.sections[0].crossUnitIds], ["U1"]);
  assert.deepEqual([...out.sections[1].blocks[0].conceptIds], ["C1"]);
  assert.deepEqual([...out.global[0].conceptIds], ["C1"]);
  assert.equal(raw.concepts[0].conceptId, "concept_a", "입력은 바꾸지 않는다");
  const ok = mkOutput();
  assert.deepEqual(JSON.parse(JSON.stringify(NC.canonicalPlanIds(ok))), JSON.parse(JSON.stringify(ok)), "이미 맞는 계획은 그대로");
});

test("canonicalMapKeys: B03 node keys become n1.. in order and edges follow; unknown edge ends stay; other blocks untouched", () => {
  const out = { gist: null, blocks: {
    GB2: { status: "supported", content: { nodes: [{ key: "A", label: "x" }, { key: "node-2", label: "y" }, { key: 3, label: "z" }], edges: [{ from: "A", to: "node-2" }, { from: "3", to: "Q" }] } },
    GB1: { status: "supported", content: { items: [] } }, GB3: null } };
  const r = NC.canonicalMapKeys(out);
  assert.deepEqual(r.blocks.GB2.content.nodes.map(n => n.key), ["n1", "n2", "n3"]);
  assert.deepEqual(r.blocks.GB2.content.edges, [{ from: "n1", to: "n2" }, { from: "n3", to: "Q" }]);
  assert.equal(r.blocks.GB1, out.blocks.GB1);
  assert.equal(r.blocks.GB3, null);
  assert.equal(out.blocks.GB2.content.nodes[0].key, "A", "입력은 바꾸지 않는다");
});

test("canonicalMapKeys with a sectionId: a bare in-section block ref (B3) in targetIds/reviewIds becomes S2_B3; other refs stay", () => {
  const out = { gist: null, blocks: { S2_B1: { status: "supported", content: { propositions: [{ targetIds: ["B3", "b1", "C2", "S1_B2", "U4"] }] } }, S2_B2: null } };
  const r = NC.canonicalMapKeys(out, "S2");
  assert.deepEqual(r.blocks.S2_B1.content.propositions[0].targetIds, ["S2_B3", "S2_B1", "C2", "S1_B2", "U4"]);
  assert.equal(NC.canonicalMapKeys(out).blocks.S2_B1.content.propositions[0].targetIds[0], "B3", "섹션을 모르면 그대로");
});

test("assembleNote: 연쇄 손실 계측 (cause direct vs cascade 및 stats, 하위 호환)", () => {
  const plan = vPlan([vSec(null, {
    blocks: [
      { type: "B05", purpose: "p", conceptIds: ["C1"], formulaIds: [], figureIds: [] },
      { type: "B12", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] },
      { type: "B14", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] },
      { type: "B18", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] },
    ],
  })], { concepts: [C1DEF] });
  const q = (over = {}, ans = {}) => ({
    kind: "recall", prompt: C(), premise: null, level: "basic", targetIds: ["S1_B4"],
    answer: { verdict: null, explanation: C(), correction: null, rubric: [], alternatives: [], reviewIds: ["S1_B4"], ...ans },
    ...over,
  });
  const output = {
    gist: null, checks: [],
    blocks: {
      S1_B1: null,
      S1_B2: env(contents.B12),
      S1_B3: env({ items: [
        q({ targetIds: ["S1_B2"] }),
        q({ targetIds: ["S1_B4"] }, { reviewIds: ["S1_B1"] }),
        q(),
      ] }),
      S1_B4: env(contents.B18),
    },
  };
  const note = NC.assembleNote(aArgs({
    plan, sections: [{ sectionId: "S1", output }], global: null,
    registry: [], formulaUnits: {}, figures: [], crops: [],
  }));
  const b1 = note.dropped.find(d => d.blockId === "S1_B1");
  const b2 = note.dropped.find(d => d.blockId === "S1_B2");
  assert.equal(b1?.cause, "direct", "직접 검증 실패는 direct");
  assert.equal(b2?.cause, "cascade", "선행 블록 부재 연쇄 탈락은 cascade");
  assert.equal(note.pruned[0]?.cause, "cascade", "정리된 문항은 cascade");
  assert.deepEqual(note.stats, {
    directBlocks: 1,
    cascadeBlocks: 1,
    prunedItems: 2,
    prunedQuestions: 2,
  });
  assert.deepEqual(Contracts.validate(NC.schemas.note, note), { ok: true });
  // 하위 호환: cause 없는 dropped 와 stats 없는 note 도 스키마 통과
  const legacyNote = clone(note);
  delete legacyNote.stats;
  legacyNote.dropped = legacyNote.dropped.map(({ cause, ...d }) => d);
  legacyNote.pruned = legacyNote.pruned.map(({ cause, ...p }) => p);
  assert.deepEqual(Contracts.validate(NC.schemas.note, legacyNote), { ok: true });
});

test("W2-B: learningItem 정규화, 자동 재배정, 커버리지 원장 및 이벤트", () => {
  const units = [{ unitId: "U1", t0: 0, t1: 10 }, { unitId: "U2", t0: 10, t1: 20 }, { unitId: "U3", t0: 20, t1: 30 }];
  const plannerOut = {
    concepts: [{ conceptId: "C1", name: "개념", homeSectionId: "S1", depth: "defined" }],
    sections: [
      {
        sectionId: "S1", title: "단원 1", question: null, stage: "understand",
        unitIds: ["U1"], crossUnitIds: [],
        blocks: [{ type: "B05", purpose: "개념", conceptIds: ["C1"], formulaIds: [], figureIds: [] }],
        learningItemIds: ["L1"], prerequisites: null, compareAxes: null, needs: { formula: true, figure: false },
        expectedSize: "medium", worker: "general",
      },
      {
        sectionId: "S2", title: "단원 2", question: null, stage: "apply",
        unitIds: ["U2", "U3"], crossUnitIds: [],
        blocks: [{ type: "B08", purpose: "사례", conceptIds: [], formulaIds: [], figureIds: [] }],
        learningItemIds: [], prerequisites: ["C1"], compareAxes: ["축1", "축2"], needs: null,
        expectedSize: "large", worker: "argument",
      },
    ],
    global: [],
    learningItems: [
      { itemId: "L1", kind: "definition", unitIds: ["U1"], importance: "core" },
      // L2: core 인데 S2 에 미배정 -> U2 소유 섹션인 S2 에 자동 배정되어야 함
      { itemId: "L2", kind: "procedure", unitIds: ["U2"], importance: "core" },
      // L3: supporting 인데 어디에도 미배정 -> deferred 로 남음
      { itemId: "L3", kind: "example", unitIds: ["U3"], importance: "supporting" },
      // L4: 모르는 유닛 -> excluded (unrecognizable)
      { itemId: "L4", kind: "condition", unitIds: ["U999"], importance: "minor" },
    ],
  };

  const norm = NC.normalizePlan(plannerOut, { units });
  assert.equal(norm.ok, true);
  const plan = norm.plan;
  assert.equal(plan.sections[0].learningItemIds[0], "L1");
  assert.ok(plan.sections[1].learningItemIds.includes("L2"), "core L2 는 U2 섹션인 S2 에 자동 배정");
  assert.equal(plan.sections[0].needs.formula, true);
  assert.equal(plan.sections[1].worker, "argument");

  const lItems = plan.learningItems;
  assert.equal(lItems.find(l => l.itemId === "L1").status, "included");
  assert.equal(lItems.find(l => l.itemId === "L1").sectionId, "S1");
  assert.equal(lItems.find(l => l.itemId === "L2").status, "included");
  assert.equal(lItems.find(l => l.itemId === "L2").sectionId, "S2");
  assert.equal(lItems.find(l => l.itemId === "L3").status, "deferred");
  assert.equal(lItems.find(l => l.itemId === "L4").status, "excluded");
  assert.equal(lItems.find(l => l.itemId === "L4").reason, "unrecognizable");

  // assembleNote 정산: S2 가 탈락하면 L2 는 deferred 로 강등
  const events = [];
  const fakeEvents = { emit: ev => events.push(ev) };
  const out1 = { gist: null, checks: [], blocks: { S1_B1: env(contents.B05) } };
  const note = NC.assembleNote(aArgs({
    plan, sections: [{ sectionId: "S1", output: out1 }], // S2 는 없음(실패/탈락)
    units, events: fakeEvents,
  }));

  assert.ok(note.coverage);
  assert.equal(note.coverage.items.find(l => l.itemId === "L1").status, "included");
  assert.equal(note.coverage.items.find(l => l.itemId === "L1").sectionId, "S1");
  assert.equal(note.coverage.items.find(l => l.itemId === "L2").status, "deferred", "S2 탈락으로 deferred 강등");
  assert.equal(note.coverage.items.find(l => l.itemId === "L2").sectionId, undefined);

  // COVERAGE 이벤트 발행 확인
  const covEv = events.find(e => e.code === "COVERAGE");
  assert.ok(covEv);
  assert.match(covEv.msg, /inc=1 mrg=0 def=2 exc=1/);
  assert.match(covEv.msg, /core=1\/2/);

  // 하위 호환: coverage 가 없는 기존 note 도 스키마 통과
  const noteWithoutCov = clone(note);
  delete noteWithoutCov.coverage;
  assert.deepEqual(Contracts.validate(NC.schemas.note, noteWithoutCov), { ok: true });
});



test("W2-B: canonicalPlanIds 는 learningItem id 를 L1.. 로 다시 매기고 참조를 같이 옮긴다", () => {
  const fixed = NC.canonicalPlanIds({
    concepts: [], global: [],
    sections: [{ sectionId: "q9", title: "t", learningItemIds: ["L9", "L3"] }],
    learningItems: [
      { itemId: "L9", kind: "definition", unitIds: ["U1"], importance: "core" },
      { itemId: "L3", kind: "example", unitIds: ["U2"], importance: "minor", correctionOf: "L9" },
    ],
  });
  assert.equal(fixed.learningItems[0].itemId, "L1");
  assert.equal(fixed.learningItems[1].itemId, "L2");
  assert.equal(fixed.learningItems[1].correctionOf, "L1", "앞 항목을 가리키는 correctionOf 도 새 번호로");
  assert.deepEqual(fixed.sections[0].learningItemIds, ["L1", "L2"], "섹션 배정 참조도 같은 표로");
});

test("W2-B: learningItems 없는 구 계획·구 노트는 그대로 통과한다", () => {
  const oldPlan = {
    schemaVersion: NC.NOTE_SCHEMA_VERSION, noteSpecVersion: NC.NOTE_SPEC_VERSION,
    policy: { externalAugmentation: false, syntheticExamples: false },
    concepts: [],
    sections: [{ sectionId: "S1", title: "t", question: null, stage: "understand", unitIds: ["U1"], crossUnitIds: [], blocks: [{ blockId: "S1_B1", type: "B05", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] }] }],
    global: [],
  };
  assert.deepEqual(Contracts.validate(NC.schemas.plan, oldPlan), { ok: true }, "선택 필드 없는 구 Plan");
  // 구 planner 출력 형식(learningItems 없음)도 정규화는 받는다 — 서버 검증 전 기본값을 채운다
  const norm = NC.normalizePlan({
    concepts: [],
    sections: [{ sectionId: "S1", title: "단원", question: null, stage: "understand", unitIds: ["U1"], crossUnitIds: [], blocks: [{ type: "B08", purpose: "p", conceptIds: [], formulaIds: [], figureIds: [] }] }],
    global: [],
  }, { units: [{ unitId: "U1", t0: 0, t1: 10 }] });
  assert.equal(norm.ok, true);
  assert.equal(norm.plan.learningItems, undefined);
});
