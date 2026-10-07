// 의미 초안 원장(ledger) 회귀 — 보류·탈락된 주장에 기대는(dependsOn) 주장이 확정 본문에 남지 않는지,
// 학습 항목 커버리지가 섹션 생존이 아니라 살아남은 주장 연결로 세는지를 결정적 합성 입력으로 본다.
const test = require("node:test");
const assert = require("node:assert/strict");
const katex = require("./vendor/katex/katex.min.js");
const Contracts = require("./contracts.js");
const NC = require("./note-contract.js");
const SD = require("./section-draft.js");

const ev = (id, unitId, text) => ({ id, unitId, kind: "slide", t0: 0, t1: 60, slideId: "s1", sourceId: id, role: "body", text });
const EV = [
  ev("U1.s1", "U1", "고정비는 생산량이 바뀌어도 변하지 않는 비용이다"),
  ev("U2.s1", "U2", "공헌이익은 판매가격에서 단위당 변동비를 뺀 값이다"),
];
const UNITS = [{ unitId: "U1", t0: 0, t1: 60 }, { unitId: "U2", t0: 60, t1: 120 }];
const META = {
  title: "가상 강의", course: null, lectureDate: null, session: null,
  lang: "ko", generatedAt: "2026-10-07T00:00:00Z", processed: { t0: 0, t1: 120 },
};

// 계획 블록 배열 → 정규화된 Plan(단일 섹션 S1). B05 블록마다 defined 개념을 하나씩 둔다.
const mkPlan = (blocks, opts = {}) => {
  const concepts = [...new Set(blocks.filter(b => b.type === "B05").flatMap(b => b.conceptIds ?? []))]
    .map(cid => ({ conceptId: cid, name: `개념${cid}`, homeSectionId: "S1", depth: "defined" }));
  const r = NC.normalizePlan({
    concepts,
    sections: [{
      sectionId: "S1", title: "단원", question: null, stage: "understand",
      unitIds: ["U1", "U2"], crossUnitIds: [],
      blocks: blocks.map(b => ({ type: b.type, purpose: "p", conceptIds: b.conceptIds ?? [], formulaIds: [], figureIds: [] })),
      learningItemIds: opts.learningItemIds ?? null, prerequisites: null, compareAxes: null,
      needs: null, expectedSize: null, worker: null,
    }],
    global: [],
    learningItems: opts.learningItems ?? null,
  }, { units: UNITS });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.plan;
};

const REL0 = () => ({ comparisons: [], arguments: [], cases: [], materials: [], calcs: [], pitfalls: [], notes: [], links: [], notices: [], maps: [] });
const dc = (claimId, role, text, evidenceIds, conceptIds = [], extra = {}) =>
  ({ claimId, role, text, basis: "lecture", evidenceIds, conceptIds, dependsOn: [], emphasis: null, ...extra });
const draftOf = (claims, relations = {}) => ({ sectionId: "S1", gist: null, claims, relations: { ...REL0(), ...relations }, checks: [] });
const compile = (plan, draft) => SD.compileDraft(draft, plan.sections[0], { concepts: plan.concepts });
const assemble = (plan, sections, over = {}) => NC.assembleNote({
  plan, sections, global: null, units: UNITS, evidence: EV, registry: [], formulaUnits: {}, figures: [], crops: [],
  meta: META, tier: "paid", systemNotices: [], katex, ...over,
});
const noteBlocks = n => n.sections.flatMap(s => s.blocks.map(b => b.id));

test("원장: 보류(pending)된 주장에 기대는 주장은 확정 본문에서 빠져 pending 에 보존된다", () => {
  const plan = mkPlan([{ type: "B05", conceptIds: ["C1"] }, { type: "B12" }]);
  const out = compile(plan, draftOf([
    dc("c1", "definition", "고정비는 생산량이 바뀌어도 변하지 않는 비용이라는 뜻이다", ["U1.s1"], ["C1"]),
    dc("c2", "intuition", "생산을 늘려도 고정비 총액은 그대로라고 읽으면 된다", ["U1.s1"], ["C1"]),
    dc("c3", "condition", "단기에서는 고정비를 바꿀 수 없다는 조건이 붙는다", ["U1.s1"], [], { dependsOn: ["c2"] }),
  ], { notes: [{ kind: "term", note: "c3" }] }));
  assert.equal(out.blocks.S1_B2.content.note.text, "단기에서는 고정비를 바꿀 수 없다는 조건이 붙는다");
  // T5 보류를 흉내 낸다 — S1_B1 의 explanation 칸을 빼고 pending 에 실은다(원래 주장 객체 보존).
  const held = out.blocks.S1_B1.content.explanation;
  out.blocks.S1_B1.content.explanation = null;
  const note = assemble(plan, [{
    sectionId: "S1", output: out,
    pending: [{ blockId: "S1_B1", sectionId: "S1", type: "B05", paths: ["/content/explanation"], claims: [held], envelope: null }],
  }]);
  // c3 는 보류된 c2 에 기댄다 — B12 의 note 는 필수 칸이라 주장만 뺄 수 없어 블록째 보류된다.
  assert.deepEqual(noteBlocks(note), ["S1_B1"], "보류 의존 주장을 실은 B12 는 확정 본문에 없다");
  assert.equal(note.sections[0].blocks[0].content.explanation, null);
  const p12 = note.pending.find(p => p.blockId === "S1_B2");
  assert.ok(p12, "보류된 블록은 pending 에 보존된다");
  assert.equal(p12.type, "B12");
  assert.ok(p12.envelope, "블록째 보류는 봉투를 보존한다");
  assert.equal(p12.envelope.content.note.text, "단기에서는 고정비를 바꿀 수 없다는 조건이 붙는다");
  assert.ok(!note.dropped.some(d => d.blockId === "S1_B2"), "보류는 탈락으로 세지 않는다");
  assert.deepEqual(Contracts.validate(NC.schemas.note, note), { ok: true });
});

test("원장: 탈락 블록의 주장에 기대는 주장이 연쇄로 보류되고, 뺄 수 있는 칸은 주장만 뺀다", () => {
  // S1_B2(B05·C2)는 모르는 근거를 인용해 검증에서 떨어진다. S1_B1 의 intuition(c2)→mechanism(c3) 연쇄가 그 정의(c9)에 기댄다.
  const plan = mkPlan([{ type: "B05", conceptIds: ["C1"] }, { type: "B05", conceptIds: ["C2"] }]);
  const out = compile(plan, draftOf([
    dc("c1", "definition", "고정비는 생산량이 바뀌어도 변하지 않는 비용이라는 뜻이다", ["U1.s1"], ["C1"]),
    dc("c9", "definition", "공헌이익은 판매가격에서 변동비를 뺀 값이라는 뜻이다", ["U9.s9"], ["C2"]),
    dc("c2", "intuition", "고정비 개념은 공헌이익 개념과 짝을 이뤄 읽는다", ["U1.s1"], ["C1"], { dependsOn: ["c9"] }),
    dc("c3", "mechanism", "두 개념의 연결로 손익 판단이 성립한다", ["U1.s1"], ["C1"], { dependsOn: ["c2"] }),
  ]));
  assert.equal(out.blocks.S1_B1.content.explanation.text, "고정비 개념은 공헌이익 개념과 짝을 이뤄 읽는다", "컴파일은 주장을 실었다");
  const note = assemble(plan, [{ sectionId: "S1", output: out }]);
  assert.deepEqual(noteBlocks(note), ["S1_B1"]);
  const b1 = note.sections[0].blocks[0];
  assert.equal(b1.content.explanation, null, "탈락 블록 주장에 기대는 주장은 본문에 없다");
  assert.equal(b1.content.mechanism, null, "연쇄 의존도 본문에 없다");
  const p1 = note.pending.find(p => p.blockId === "S1_B1");
  assert.ok(p1 && !p1.envelope, "주장 단위 보류는 봉투 없이 주장만 남긴다");
  assert.deepEqual(p1.paths.sort(), ["/content/explanation", "/content/mechanism"].sort());
  assert.equal(p1.claims.length, 2);
  assert.equal(note.dropped.find(d => d.blockId === "S1_B2")?.cause, "direct", "검증 실패 블록은 직접 탈락");
  assert.deepEqual(Contracts.validate(NC.schemas.note, note), { ok: true });
});

test("원장: 배치되지 않은 초안 주장에 기대는 주장도 확정 본문에 남지 않는다", () => {
  const plan = mkPlan([{ type: "B05", conceptIds: ["C1"] }]);
  const out = compile(plan, draftOf([
    dc("c1", "definition", "고정비는 생산량이 바뀌어도 변하지 않는 비용이라는 뜻이다", ["U1.s1"], ["C1"]),
    dc("c9", "argument", "어느 봉투에도 배정되지 않는다", ["U1.s1"], ["C1"]),
    dc("c2", "intuition", "배치되지 않은 주장에 기대는 설명", ["U1.s1"], ["C1"], { dependsOn: ["c9"] }),
  ]));
  assert.deepEqual(out.ledger.claims.c9.places, []);
  const note = assemble(plan, [{ sectionId: "S1", output: out }]);
  const b1 = note.sections[0].blocks[0];
  assert.equal(b1.content.explanation, null, "본문에 없는 것에 기댄 주장은 보류된다");
  const p1 = note.pending.find(p => p.blockId === "S1_B1");
  assert.deepEqual(p1?.paths, ["/content/explanation"]);
  assert.equal(p1?.claims.length, 1);
});

test("원장: 분할 작성 조각 배열은 조각 안에서만 로컬 키를 푼다", () => {
  const plan = mkPlan([{ type: "B05", conceptIds: ["C1"] }, { type: "B12" }]);
  const out = compile(plan, draftOf([
    dc("c1", "definition", "고정비는 생산량이 바뀌어도 변하지 않는 비용이라는 뜻이다", ["U1.s1"], ["C1"]),
    dc("c2", "condition", "단기에서는 고정비를 바꿀 수 없다", ["U1.s1"], []),
  ], { notes: [{ kind: "term", note: "c2" }] }));
  // 다른 조각의 c1(배치 없음)에 기대는 c9 — 조각 A 의 살아 있는 c1 과 겹치지만 같은 키가 아니다.
  const fragB = { v: 1, claims: {
    c1: { role: "definition", conceptIds: [], dependsOn: [], evidenceIds: [], places: [] },
    c9: { role: "condition", conceptIds: [], dependsOn: ["c1"], evidenceIds: [], places: ["S1_B2#/content/note"] },
  } };
  const note = assemble(plan, [{ sectionId: "S1", output: out }]);
  assert.deepEqual(noteBlocks(note), ["S1_B1", "S1_B2"], "단일 조각이면 그대로");
  const note2 = assemble(plan, [{ sectionId: "S1", output: { ...out, ledger: SD.mergeLedgers(out.ledger, fragB) } }]);
  assert.deepEqual(noteBlocks(note2), ["S1_B1"], "조각 B 의 c9 는 자기 조각의 죽은 c1 에 기대어 보류된다");
  assert.ok(note2.pending.some(p => p.blockId === "S1_B2"));
});

test("커버리지: 섹션 생존만으로는 included 가 아니다 — 항목 유닛을 인용한 살아남은 주장이 필요하다", () => {
  const plan = mkPlan([{ type: "B05", conceptIds: ["C1"] }], {
    learningItemIds: ["L1", "L2"],
    learningItems: [
      { itemId: "L1", kind: "definition", unitIds: ["U1"], importance: "core", correctionOf: null },
      { itemId: "L2", kind: "example", unitIds: ["U2"], importance: "supporting", correctionOf: null },
    ],
  });
  assert.equal(plan.learningItems.find(l => l.itemId === "L1").status, "included");
  const out = compile(plan, draftOf([
    dc("c1", "definition", "공헌이익은 판매가격에서 변동비를 뺀 값이라는 뜻이다", ["U2.s1"], ["C1"]),
  ]));
  const note = assemble(plan, [{ sectionId: "S1", output: out }]);
  const items = Object.fromEntries(note.coverage.items.map(i => [i.itemId, i]));
  assert.equal(items.L2.status, "included", "살아남은 주장이 유닛을 인용한다");
  assert.equal(items.L1.status, "deferred", "유닛을 인용한 주장이 하나도 살지 않으면 섹션 생존으로 세지 않는다");
  assert.equal(items.L1.sectionId, undefined);
  // 원장 보류로 주장이 빠진 뒤에도 같은 규칙이다 — 보류된 주장은 확정 본문이 아니라서 연결로 세지 않는다.
  const plan2 = mkPlan([{ type: "B05", conceptIds: ["C1"] }, { type: "B12" }], {
    learningItemIds: ["L1", "L2"],
    learningItems: [
      { itemId: "L1", kind: "definition", unitIds: ["U1"], importance: "core", correctionOf: null },
      { itemId: "L2", kind: "example", unitIds: ["U2"], importance: "supporting", correctionOf: null },
    ],
  });
  const out2 = compile(plan2, draftOf([
    dc("c1", "definition", "고정비는 생산량이 바뀌어도 변하지 않는 비용이라는 뜻이다", ["U1.s1"], ["C1"]),
    dc("c2", "condition", "공헌이익 예시 설명이다", ["U2.s1"], [], { dependsOn: ["c9"] }),
    dc("c9", "argument", "배치되지 않는다", ["U1.s1"], ["C1"]),
  ], { notes: [{ kind: "term", note: "c2" }] }));
  const note2 = assemble(plan2, [{ sectionId: "S1", output: out2 }]);
  const items2 = Object.fromEntries(note2.coverage.items.map(i => [i.itemId, i]));
  assert.deepEqual(noteBlocks(note2), ["S1_B1"], "보류 의존으로 B12 는 빠진다");
  assert.equal(items2.L1.status, "included", "U1 을 인용한 주장이 살아 있다");
  assert.equal(items2.L2.status, "deferred", "U2 주장은 보류돼 본문에 없다 — 포함으로 세지 않는다");
});

test("원장 없는 출력은 기존과 같이 조립된다(하위 호환)", () => {
  const plan = mkPlan([{ type: "B05", conceptIds: ["C1"] }, { type: "B12" }]);
  const out = compile(plan, draftOf([
    dc("c1", "definition", "고정비는 생산량이 바뀌어도 변하지 않는 비용이라는 뜻이다", ["U1.s1"], ["C1"]),
    dc("c2", "condition", "단기에서는 고정비를 바꿀 수 없다", ["U1.s1"], ["C1"]),
  ], { notes: [{ kind: "term", note: "c2" }] }));
  const withLedger = assemble(plan, [{ sectionId: "S1", output: out }]);
  const without = assemble(plan, [{ sectionId: "S1", output: { gist: out.gist, blocks: out.blocks, checks: out.checks } }]);
  assert.deepEqual(without, withLedger, "원장이 없거나 의존이 죽지 않으면 결과는 같다");
  assert.equal(withLedger.pending, undefined, "보류가 없으면 pending 칸도 없다");
});

test("원장: root 블록 복구 뒤 restoreDependents 가 원래 초안의 종속 주장을 재검증 후보로 돌려준다", () => {
  // 위의 탈락 연쇄와 같은 구성 — S1_B2(c9 정의)가 떨어져 c2·c3 가 보류됐다가, root 복구로 되돌릴 후보다.
  const plan = mkPlan([{ type: "B05", conceptIds: ["C1"] }, { type: "B05", conceptIds: ["C2"] }]);
  const draft = draftOf([
    dc("c1", "definition", "고정비는 생산량이 바뀌어도 변하지 않는 비용이라는 뜻이다", ["U1.s1"], ["C1"]),
    dc("c9", "definition", "공헌이익은 판매가격에서 변동비를 뺀 값이라는 뜻이다", ["U2.s1"], ["C2"]),
    dc("c2", "intuition", "고정비 개념은 공헌이익 개념과 짝을 이뤄 읽는다", ["U1.s1"], ["C1"], { dependsOn: ["c9"] }),
    dc("c3", "mechanism", "두 개념의 연결로 손익 판단이 성립한다", ["U1.s1"], ["C1"], { dependsOn: ["c2"] }),
  ]);
  const out = compile(plan, draft);
  assert.equal(out.ledger.draft, draft, "원장이 원래 초안을 보존한다");
  assert.deepEqual(SD.restoreDependents(out.ledger, []), [], "복구된 root 가 없으면 후보도 없다");
  const got = SD.restoreDependents(out.ledger, ["S1_B2"]);
  assert.deepEqual(got.map(x => x.claimId), ["c2", "c3"], "c9(블록 내 root 주장)→c2→c3 순으로 재검증 후보");
  assert.equal(got[0].claim, draft.claims[2], "추측이 아니라 원래 초안 주장 객체다");
  assert.deepEqual(SD.restoreDependents(out.ledger, ["c9"]).map(x => x.claimId), ["c2", "c3"], "주장 id 로도 넘길 수 있다");
});
