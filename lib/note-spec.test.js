const test = require("node:test");
const assert = require("node:assert/strict");
const Contracts = require("./contracts.js");
const NoteSpec = require("./note-spec.js");

const block = { type: "text", heading: "미분의 정의", body: "순간 변화율을 {{F12}}로 정의한다.", evidenceIds: ["U3"], derived: ["\\frac{dy}{dx}"] };
const section = { sectionId: "S1", title: "미분", unitIds: ["U3", "U4"], blocks: [{ type: "text", purpose: "정의를 설명한다" }] };
const examples = {
  blockSchema: block,
  planSchema: { sections: [section] },
  planSectionSchema: section,
  sectionOutputSchema: { blocks: [block] },
  globalOutputSchema: { blocks: [block] },
  sectionResultSchema: { sectionId: "S1", title: "미분", blocks: [block] },
};

test("모든 노트 스펙 스키마가 strict 호환이고 자리표시자 예시를 통과시킨다", () => {
  for (const [name, example] of Object.entries(examples)) {
    assert.equal(Contracts.isStrictCompatible(NoteSpec[name]), true, name + " strict");
    assert.deepEqual(Contracts.validate(NoteSpec[name], example), { ok: true }, name + " 예시");
  }
});

test("스펙 버전·블록 종류·한도·프롬프트 규칙이 자리표시자 값으로 고정돼 있다", () => {
  assert.equal(NoteSpec.NOTE_SPEC_VERSION, "placeholder-0");
  assert.deepEqual(NoteSpec.BLOCK_TYPES, ["text"]);
  assert.deepEqual(NoteSpec.limits.tokens, { plannerInput: 40000, plannerOutput: 8000, writerInput: 12000, writerOutput: 4000 });
  assert.ok(NoteSpec.limits.maxSections > 0 && NoteSpec.limits.maxBlocksPerSection > 0);
  assert.match(NoteSpec.promptRules, /\{\{F12\}\}/);
  assert.equal(globalThis.NoteSpec, NoteSpec, "UMD 전역 노출");
});

test("스키마는 잘못된 블록을 위반 경로와 함께 거절한다", () => {
  const bad = (schema, value) => Contracts.validate(schema, value).errors.map(e => e.path);
  assert.ok(bad(NoteSpec.sectionOutputSchema, { blocks: [{ ...block, type: "quiz" }] }).includes("/blocks/0/type"), "모르는 블록 종류");
  assert.ok(bad(NoteSpec.sectionOutputSchema, { blocks: [{ ...block, extra: 1 }] }).includes("/blocks/0/extra"), "추가 속성");
  const { derived: _d, ...lean } = block;
  assert.ok(bad(NoteSpec.sectionOutputSchema, { blocks: [lean] }).includes("/blocks/0/derived"), "필수 속성 누락");
  assert.ok(bad(NoteSpec.sectionOutputSchema, { blocks: Array(NoteSpec.limits.maxBlocksPerSection + 1).fill(block) }).includes("/blocks"), "블록 수 상한");
  assert.ok(bad(NoteSpec.planSchema, { sections: [{ ...section, sectionId: "intro" }] }).includes("/sections/0/sectionId"), "섹션 id 형식");
});

test("스키마는 동결돼 있어 호출자가 슬롯을 바꾸지 못한다", () => {
  assert.throws(() => { "use strict"; NoteSpec.blockSchema.properties.body.maxLength = 1; }, TypeError);
  assert.throws(() => { "use strict"; NoteSpec.BLOCK_TYPES.push("quiz"); }, TypeError);
});

test("표현 슬롯: 모든 블록 종류에 템플릿이 있고 layout·notice·css 가 있다", () => {
  for (const type of NoteSpec.BLOCK_TYPES) assert.equal(typeof NoteSpec.templates[type], "function", type + " 템플릿");
  assert.equal(typeof NoteSpec.layout, "function");
  assert.equal(typeof NoteSpec.notice, "function");
  assert.ok(typeof NoteSpec.css === "string" && NoteSpec.css.length > 0);
  assert.throws(() => { "use strict"; NoteSpec.templates.quiz = () => ""; }, TypeError, "표현 슬롯도 동결");
});

test("표현 슬롯은 도우미만으로 블록·문서·고지를 문자열로 만든다", () => {
  const h = { esc: String, rich: String, math: String, block: b => NoteSpec.templates[b.type](b, h), notice: n => NoteSpec.notice(n, h) };
  assert.equal(typeof h.block(block), "string");
  const html = NoteSpec.layout({ global: [block], sections: [{ sectionId: "S1", title: "미분", blocks: [block] }], notices: [{ code: "VAL_BLOCK_FAILED", count: 2 }] }, h);
  assert.equal(typeof html, "string");
  assert.match(NoteSpec.notice({ code: "VAL_BLOCK_FAILED", count: 2 }, h), /2건/);
  assert.equal(typeof NoteSpec.notice({ code: "NO_SUCH_CODE" }, h), "string", "모르는 코드도 문장을 낸다");
});
