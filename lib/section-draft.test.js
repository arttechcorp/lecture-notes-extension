const test = require("node:test");
const assert = require("node:assert/strict");
const katex = require("./vendor/katex/katex.min.js");
const Contracts = require("./contracts.js");
const NoteContract = require("./note-contract.js");
const Preprocess = require("./preprocess.js");
const Boilerplate = require("./boilerplate.js");
const Formulas = require("./formulas.js");
const Figures = require("./figures.js");
const SectionDraft = require("./section-draft.js");
const INPUT = require("../tools/note-fixture/input.json");
const PLANNER = require("../tools/note-fixture/planner-output.json");

// 합성 픽스처 강의로 정규화한 계획의 섹션을 꺼낸다 — 컴파일러는 계획 블록 순서·id·타입·formulaIds 를 이 값에서 읽는다.
// 정제 단계와 같은 범위를 만든다 — 수식·도표 참조(ref:S2:F1 등)는 normalizePlan 이 레지스트리로 걸러낸다.
const bp = Boilerplate.detect(INPUT.slides);
const ir = Preprocess.buildIR(bp.slides, INPUT.transcript.segments);
const registry = Formulas.buildRegistry(bp.slides);
const owner = new Map();
for (const m of Preprocess.mergeProgressive(bp.slides)) for (const id of [...(m.mergedFrom ?? []), m.slideId]) owner.set(String(id), String(m.slideId));
const unitBySlide = new Map(ir.units.filter(u => u.slideId != null).map(u => [String(u.slideId), u.unitId]));
const unitOf = s => unitBySlide.get(owner.get(String(s))) ?? null;
const formulaUnits = Object.fromEntries(registry.map(e => [e.id, [...new Set([e.slideId, ...e.seenOn].map(unitOf).filter(Boolean))]]));
const figures = Figures.buildFigureRegistry(bp.slides, { unitOf, evidence: ir.evidence, hashes: {}, ocr: {}, crops: [] });
const plan = () => {
  const n = NoteContract.normalizePlan(JSON.parse(JSON.stringify(PLANNER)), { units: ir.units, formulaUnits, figures });
  if (!n.ok) throw new Error("plan fixture failed: " + JSON.stringify(n.errors));
  return n.plan;
};
const sec = id => plan().sections.find(s => s.sectionId === id);
const CTX = () => ({ concepts: plan().concepts });
// 검증 단계와 같은 호출이다 — 컴파일 결과는 기존 검증(§9)을 그대로 통과해야 한다.
const check = (sectionId, output) => NoteContract.validateSection({ plan: plan(), sectionId, output, evidence: ir.evidence, registry, formulaUnits, figures, katex });
// 빈 typed 관계 — strict 스키마는 모든 칸이 필수라 "없음"은 이렇게 표현된다.
const REL0 = () => ({ comparisons: [], arguments: [], cases: [], materials: [], calcs: [], pitfalls: [], notes: [], links: [], notices: [], maps: [] });
const claim = (claimId, role, text, evidenceIds, conceptIds = [], extra = {}) => ({ claimId, role, text, basis: "lecture", evidenceIds, conceptIds, dependsOn: [], emphasis: null, ...extra });
const draftOf = (sectionId, claims, relations = {}, gist = null, checks = []) => ({ sectionId, gist, claims, relations: { ...REL0(), ...relations }, checks });

// S3 (B05·B05·B06·B07, 유닛 U4) — 픽스처 발화·슬라이드 문구를 옮긴 숫자 없는 주장들이라 근거·숫자 검증을 통과한다.
const DRAFT3 = draftOf("S3", [
  claim("c1", "definition", "시장 거래 비용과 내부 조직 비용을 비교해 기업의 경계를 정한다는 관점이다", ["U4.s2", "U4.t2"], ["C5"]),
  claim("c2", "intuition", "거래가 자주 일어나고 그 기업에만 맞춘 자산이 필요할수록 내부에서 하는 편이 낫다고 본다", ["U4.t2"], ["C5"], { dependsOn: ["c1"] }),
  claim("c3", "condition", "어떤 활동을 직접 하고 어떤 활동을 시장에서 살지 정하는 문제를 다룬다", ["U4.t1"], ["C5"]),
  claim("c4", "definition", "고유 자원과 역량이 있는 활동을 기업 내부에 둔다는 관점이다", ["U4.s3", "U4.t3"], ["C6"]),
  claim("c5", "intuition", "비용보다 그 기업만 가진 자원과 역량이 경쟁우위가 되는지를 먼저 묻는다", ["U4.t3"], ["C6"]),
  claim("c6", "comparison", "거래를 분석 단위로 삼는다", ["U4.g1"], ["C5"]),
  claim("c7", "comparison", "자원과 역량을 분석 단위로 삼는다", ["U4.g1"], ["C6"]),
  claim("c8", "comparison", "계약 관계를 분석 단위로 삼는다", ["U4.g1"], ["C7"]),
  claim("c9", "comparison", "만들 것인가 살 것인가를 묻는다", ["U4.g1"], ["C5"]),
  claim("c10", "comparison", "무엇이 강점인가를 묻는다", ["U4.g1"], ["C6"]),
  claim("c11", "comparison", "시장 거래 비용과 내부 조직 비용을 비교해 정한다", ["U4.s2"], ["C5"]),
  claim("c12", "comparison", "고유 자원과 역량이 있는 활동을 내부에 둔다", ["U4.s3"], ["C6"]),
  claim("c13", "argument", "기업의 경계는 시장 거래 비용과 내부 조직 비용의 비교로 정한다", ["U4.s2"], ["C5"]),
  claim("c14", "argument", "거래가 자주 일어나고 전용 자산이 필요할수록 내부에서 하는 편이 낫다", ["U4.t2"], ["C5"]),
  claim("c15", "argument", "두 관점 모두 기업이 무엇을 내부에 둘지를 설명한다", ["U4.t4"], ["C5", "C6"]),
], {
  comparisons: [{
    status: null, importance: null, title: "세 관점을 같은 기준으로 비교",
    entities: [{ label: "거래비용 관점", conceptId: "C5" }, { label: "자원기반 관점", conceptId: "C6" }, { label: "대리인 관점", conceptId: "C7" }],
    criteria: [
      { label: "분석 단위", cells: ["c6", "c7", "c8"] },
      { label: "핵심 질문", cells: ["c9", "c10", null] },
      { label: "경계 결정 방식", cells: ["c11", "c12", null] },
    ],
    common: [], discriminator: null,
  }],
  arguments: [{
    status: null, importance: null, title: "거래비용 관점의 논거", relationType: "argument", question: null,
    steps: [{ role: "premise", claim: "c13" }, { role: "reason", claim: "c14" }, { role: "claim", claim: "c15" }],
    missingLinks: [],
  }],
}, { text: "기업의 경계를 설명하는 관점들을 같은 기준으로 비교한다", evidenceIds: ["U4.s1", "U4.t1"], basis: "lecture" });

test("draft output schema: strict + validates a draft, rejects malformed claims", () => {
  const s = sec("S3"), schema = SectionDraft.outputSchemaFor(s, { gist: true });
  assert.equal(Contracts.isStrictCompatible(schema), true);
  assert.ok(Contracts.validate(schema, DRAFT3).ok, JSON.stringify(Contracts.validate(schema, DRAFT3).errors));
  // 로컬 키 형식·required 를 벗어나면 걸린다
  assert.ok(!Contracts.validate(schema, { ...DRAFT3, checks: [{ kind: "wrong", claim: null, targetIds: ["S3_B1"], before: null, after: null, hold: null }] }).ok, "check enum");
  const bad = JSON.parse(JSON.stringify(DRAFT3)); bad.claims[0].claimId = "S3_c1"; // 섹션 접두는 모델이 아니라 호스트가 단다
  assert.ok(!Contracts.validate(schema, bad).ok);
  // checks 의 대상은 계획 블록 id 로만 좁혀진다
  assert.deepEqual(schema.properties.checks.items.properties.targetIds.items.enum, ["S3_B1", "S3_B2", "S3_B3", "S3_B4"]);
});

test("compileDraft: S3 draft compiles into block envelopes that pass section validation", () => {
  const s = sec("S3"), out = SectionDraft.compileDraft(DRAFT3, s, CTX());
  assert.deepEqual(Object.keys(out.blocks), ["S3_B1", "S3_B2", "S3_B3", "S3_B4"]); // 계획 블록 순서 그대로
  assert.equal(out.gist.text, "기업의 경계를 설명하는 관점들을 같은 기준으로 비교한다");
  const b1 = out.blocks.S3_B1;
  assert.equal(b1.content.term, "거래비용 관점"); // term 은 계획 개념 이름
  assert.equal(b1.content.definition.text, DRAFT3.claims[0].text);
  assert.deepEqual(b1.emphasis, []);
  assert.equal(b1.importance, "core"); // B05 기본값
  assert.equal(b1.content.original, null);
  // typed 관계가 블록 구조로 옮겨진다 — 비교 표 셀의 null 은 그대로 null
  const b3 = out.blocks.S3_B3;
  assert.equal(b3.content.criteria.length, 3);
  assert.equal(b3.content.criteria[0].cells[1].text, "자원과 역량을 분석 단위로 삼는다");
  assert.equal(b3.content.criteria[2].cells[2], null);
  assert.equal(b3.content.entities.length, 3);
  // 논증 단계의 role·주장이 보존된다
  assert.deepEqual(out.blocks.S3_B4.content.steps.map(x => x.role), ["premise", "reason", "claim"]);
  // 기존 검증을 그대로 통과한다 — 저장 포맷(Note)은 봉투 검증 이후 조립에서 정해진다
  const v = check("S3", out);
  assert.equal(v.errors.length, 0, JSON.stringify(v.errors));
  assert.equal(v.blocks.filter(b => b.errors.length).length, 0, JSON.stringify(v.blocks.map(b => [b.id, b.errors]).filter(([, e]) => e.length)));
  assert.equal(v.ok, true);
  assert.equal(v.warnings.length, 0, JSON.stringify(v.warnings));
});

test("compileDraft: no duplicating claims to fill empty slots", () => {
  const d = draftOf("S3", [
    claim("c1", "definition", "고유 자원과 역량이 있는 활동을 기업 내부에 둔다는 관점이다", ["U4.s3"], ["C6"]),
  ]);
  const out = SectionDraft.compileDraft(d, sec("S3"), CTX());
  // C5 의 definition 주장이 없다 — C6 정의를 복제해 채우지 않는다
  assert.equal(out.blocks.S3_B1, null);
  // C6 은 definition 만 있다 — explanation·mechanism 은 null(정의를 다시 쓰지 않는다)
  const b2 = out.blocks.S3_B2.content;
  assert.equal(b2.explanation, null);
  assert.equal(b2.mechanism, null);
  assert.deepEqual(b2.scope, []);
  // 관계 재료가 없으면 그 타입의 계획 블록은 null = 기존 보류 규칙
  assert.equal(out.blocks.S3_B3, null);
  assert.equal(out.blocks.S3_B4, null);
});

test("compileDraft: relations are consumed in plan order, not draft order", () => {
  // 같은 타입 블록이 둘 이상이면 관계 배열의 다음 항목이 계획 순서로 배정된다(초안은 블록 id 를 모른다).
  const p = { sectionId: "S9", blocks: [{ blockId: "S9_B1", type: "B12" }, { blockId: "S9_B2", type: "B12" }] };
  const d = draftOf("S9", [claim("c1", "procedure", "첫 번째 노트다", ["U4.s1"]), claim("c2", "procedure", "두 번째 노트다", ["U4.s1"])],
    { notes: [{ status: null, importance: "reference", kind: "hint", note: "c2" }, { status: "uncertain", importance: null, kind: "term", note: "c1" }] });
  const out = SectionDraft.compileDraft(d, p);
  assert.equal(out.blocks.S9_B1.content.note.text, "두 번째 노트다"); // notes[0] → 첫 계획 블록
  assert.equal(out.blocks.S9_B2.content.note.text, "첫 번째 노트다");
  assert.equal(out.blocks.S9_B1.importance, "reference"); // 관계가 준 봉투 판단 칸이 산다
  assert.equal(out.blocks.S9_B2.status, "uncertain");
  // 같은 초안을 두 번 컴파일해도 같다 — 조판은 결정적이다
  assert.deepEqual(SectionDraft.compileDraft(d, p), out);
});

test("compileDraft: dangling claim refs follow the slot rules", () => {
  const d = draftOf("S3", [claim("c1", "definition", "시장 거래 비용과 내부 조직 비용을 비교해 경계를 정한다", ["U4.s2"], ["C5"])], {
    comparisons: [{ status: null, importance: null, title: "x", entities: [{ label: "A", conceptId: null }, { label: "B", conceptId: null }], criteria: [{ label: "기준", cells: ["c1", "c99"] }], common: ["c99"], discriminator: "c99" }],
    pitfalls: [{ status: null, importance: null, misconception: "c99", correction: "c1", conditions: [], origin: "lecture_correction" }],
  });
  const out = SectionDraft.compileDraft(d, sec("S3"), CTX());
  const cells = out.blocks.S3_B3.content.criteria[0].cells;
  assert.equal(cells[1], null); // 없는 주장의 셀은 null
  assert.deepEqual(out.blocks.S3_B3.content.common, []); // 없는 주장은 목록에서 빠진다
  assert.equal(out.blocks.S3_B3.content.discriminator, null);
  // 필수 칸이 끊기면 그 블록은 보류 — S3 에는 B11 계획이 없으니 별도 계획으로 확인한다
  const p = { sectionId: "S9", blocks: [{ blockId: "S9_B1", type: "B11" }] };
  assert.equal(SectionDraft.compileDraft(draftOf("S9", [], { pitfalls: [{ status: null, importance: null, misconception: "c99", correction: "c1", conditions: [], origin: "lecture_correction" }] }), p).blocks.S9_B1, null);
  // 다른 섹션 id 의 초안·비객체 입력은 이 섹션의 내용이 아니다 — 전부 null
  assert.ok(Object.values(SectionDraft.compileDraft({ ...d, sectionId: "S1" }, sec("S3"), CTX()).blocks).every(v => v === null));
  assert.ok(Object.values(SectionDraft.compileDraft(null, sec("S3"), CTX()).blocks).every(v => v === null));
});

test("compileDraft: calcs scope i#/c# refs onto the block and keep plan-bound formula/figure ids", () => {
  const s = sec("S2"); // B05·B05·B10·B11·B14
  const d = draftOf("S2", [
    claim("c1", "definition", "판매가격에서 단위당 변동비를 뺀, 한 개를 팔 때 남는 돈이다", ["U2.s4", "U2.t1"], ["C3"]),
    claim("c2", "definition", "고정비를 개당 공헌이익으로 나눴을 때 나오는 판매량이다", ["U2.t3"], ["C4"]),
    claim("c3", "calculation", "고정비를 개당 공헌이익으로 나눠 손익분기 판매량을 구한다", ["U2.t3"], ["C4"]),
    claim("c4", "calculation", "개당 공헌이익은 첫 번째 입력과 두 번째 입력의 차다", ["i1", "i2"], ["C3"]),
    claim("c5", "calculation", "손익분기 판매량은 결과 단계의 값이다", ["c2"], ["C4"]),
    claim("c6", "exception", "공헌이익을 판매가격에서 고정비를 뺀 값으로 착각하기 쉽다", ["U2.t4"], ["C3"]),
    claim("c7", "definition", "공헌이익은 판매가격에서 단위당 변동비를 뺀 값이고 고정비는 빼면 안 된다", ["U2.s4", "U2.t4"], ["C3"]),
  ], {
    calcs: [{
      status: null, importance: null, title: "손익분기 판매량 계산", kind: "calc", goal: "c3",
      formulaIds: ["F1", "F9"], figureIds: [], // F9 는 계획이 허용하지 않는다 — 컴파일이 뺀다
      variables: [{ symbol: "P − VC", meaning: "c4", unit: "원" }],
      assumptions: [],
      inputs: [
        { label: "판매가격", value: 15000, unit: "원", evidenceIds: ["U2.s2"] },
        { label: "단위당 변동비", value: 9000, unit: "원", evidenceIds: ["U2.s2"] },
        { label: "월 고정비", value: 2400000, unit: "원", evidenceIds: ["U2.s3"] },
      ],
      steps: [
        { label: "개당 공헌이익", op: "sub", a: "i1", b: "i2", value: 6000, unit: "원", digits: 0 },
        { label: "손익분기 판매량", op: "div", a: "i3", b: "c1", value: 400, unit: "개", digits: 0 },
      ],
      derived: ["손익분기 판매량은 400개다"], reading: ["c4"], result: "c5", limits: [], withheld: null,
    }],
    pitfalls: [{ status: null, importance: null, misconception: "c6", correction: "c7", conditions: [], origin: "lecture_correction" }],
  });
  const out = SectionDraft.compileDraft(d, s, CTX());
  const b3 = out.blocks.S2_B3.content;
  assert.equal(b3.title, "손익분기 판매량 계산");
  assert.deepEqual(b3.formulaIds, ["F1"]); // 계획 블록이 허용한 수식만 남는다
  assert.deepEqual(b3.reading[0].evidenceIds, ["S2_B3.i1", "S2_B3.i2"]); // 로컬 참조가 그 블록의 계산 참조로 옮겨진다
  assert.deepEqual(b3.result.evidenceIds, ["S2_B3.c2"]);
  assert.equal(b3.inputs.length, 3);
  assert.equal(b3.steps.length, 2);
  assert.equal(out.blocks.S2_B4.content.misconception.text, d.claims[5].text); // pitfalls → B11
  assert.equal(out.blocks.S2_B5, null); // B14 문항은 이 경로에서 만들지 않는다 — blockId 키는 보존, 값은 null
  assert.ok("S2_B5" in out.blocks);
});

test("compileDraft: emphasis is collected only from claims that actually landed", () => {
  const d = draftOf("S3", [
    claim("c1", "definition", "시장 거래 비용과 내부 조직 비용을 비교해 경계를 정한다", ["U4.s2"], ["C5"], { emphasis: { kind: "exam", evidenceIds: ["U4.s2"] } }),
    claim("c2", "intuition", "내부가 더 나을 때가 있다", ["U4.t2"], ["C5"], { emphasis: { kind: "stress", evidenceIds: ["U4.t2"] } }),
  ]);
  const out = SectionDraft.compileDraft(d, sec("S3"), CTX());
  assert.deepEqual(out.blocks.S3_B1.emphasis, [{ kind: "exam", evidenceIds: ["U4.s2"] }, { kind: "stress", evidenceIds: ["U4.t2"] }]);
  // 같은 주장을 관계가 다시 인용해도 emphasis 가 중복되지 않는다
  const d2 = draftOf("S3", [claim("c1", "definition", "시장 거래 비용과 내부 조직 비용을 비교해 경계를 정한다", ["U4.s2"], ["C5"], { emphasis: { kind: "exam", evidenceIds: ["U4.s2"] } })], {
    comparisons: [{ status: null, importance: null, title: "x", entities: [{ label: "A", conceptId: null }, { label: "B", conceptId: null }], criteria: [{ label: "기준", cells: ["c1", "c1"] }], common: ["c1"], discriminator: "c1" }],
  });
  assert.deepEqual(SectionDraft.compileDraft(d2, sec("S3"), CTX()).blocks.S3_B3.emphasis, [{ kind: "exam", evidenceIds: ["U4.s2"] }]);
});

test("compileDraft: checks pass through and B13 propositions keep typed targets", () => {
  const p = { sectionId: "S9", blocks: [{ blockId: "S9_B1", type: "B13" }] };
  const d = draftOf("S9", [
    claim("c1", "definition", "설문이 응답자의 직접 경험만이 아니라 인상을 묻는다는 뜻이다", ["U5.s1"], []),
  ], {
    links: [{ status: null, importance: null, title: "자료와 관점의 연결", propositions: [
      { relation: "common", claim: "c1", targetIds: ["C5"] },
      { relation: "contrast", claim: "c9", targetIds: ["C5"] }, // 끊긴 명제는 빠진다
    ] }],
  }, null, [{ kind: "wrong", claim: { text: "응답자가 직접 경험한 사실로 다룬다", evidenceIds: ["U5.s1"], basis: "lecture" }, targetIds: ["S9_B1"], before: null, after: null, hold: null }]);
  const out = SectionDraft.compileDraft(d, p);
  assert.equal(out.blocks.S9_B1.content.propositions.length, 1);
  assert.equal(out.blocks.S9_B1.content.propositions[0].targetIds[0], "C5");
  assert.equal(out.checks.length, 1); // 확인 항목은 컴파일러가 건드리지 않고 그대로 넘긴다(검증이 걸러낸다)
});
