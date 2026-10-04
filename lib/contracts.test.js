const test = require("node:test");
const assert = require("node:assert/strict");
const { CONTRACT_VERSION, SCHEMAS, validate, assertValid, isStrictCompatible } = require("./contracts.js");

const box = { x: 0.1, y: 0.2, w: 0.5, h: 0.4 };
const slideDoc = {
  schemaVersion: 1, slideId: "s-3", t0: 120, t1: 185.5, engine: "ppocr", model: "v5",
  blocks: [
    { id: "b1", text: "2장 미분의 정의", role: "title", bbox: box, conf: 0.93 },
    { id: "b2", text: "도함수는 함수의 순간 변화율을 말한다.", role: "body", bbox: null, conf: null },
  ],
  formulas: [
    { id: "f1", latex: "f'(x)=\\lim_{h\\to 0}\\frac{f(x+h)-f(x)}{h}", text: null, bbox: null, conf: 0.81, status: "verified" },
  ],
  figures: [
    { id: "g1", bbox: box, kind: "table", title: "구간별 평균 변화율", cells: [["구간", "값"], ["[1,2]", "3"]], chartSummary: null, chartData: null, conf: null },
  ],
};
const transcript = {
  schemaVersion: 1, engine: "whisper", model: "base", lang: "ko",
  segments: [
    { id: "seg1", t0: 0, t1: 4.2, text: "미분이란 함수의 순간 변화율입니다",
      words: [{ w: "미분이란", t0: 0, t1: 0.9 }, { w: "함수의", t0: 1.0, t1: 1.5 }, { w: "순간", t0: 1.6, t1: 2.0 }, { w: "변화율입니다", t0: 2.1, t1: 4.2 }],
      noSpeechProb: 0.04, avgLogprob: -0.31, compressionRatio: 1.6, status: "kept" },
    { id: "seg2", t0: 4.5, t1: 5.0, text: "음", words: [], noSpeechProb: null, avgLogprob: null, compressionRatio: null, status: "filtered" },
  ],
};
const unit = {
  schemaVersion: 1, unitId: "u-7", slideId: "s-3", t0: 120, t1: 185.5,
  slideText: "2장 미분의 정의. 도함수는 함수의 순간 변화율을 말한다.",
  speech: "자 여기 보시면 이 기울기가 바로 미분입니다",
  features: { dwell: 45, speechChars: 120, emphasis: 2, deixis: 1, repeat: 0, hasFormula: true, hasFigure: false },
  judge: { importance: 4, lectureProb: 0.9 },
};
const judgeResult = { itemId: "u-7", task: "importance", probs: [{ label: "high", p: 0.7 }, { label: "low", p: 0.3 }], score: 4, confidence: 0.6, model: "gemini-flash" };
const errorEnvelope = { error: { code: "rate_limited", message: "요청이 많습니다. 잠시 후 다시 시도하세요.", retryable: true, retryAfterMs: 2000 } };

// 각 스키마의 현실적인 값이 통과하는지 검증
test("valid fixtures pass every schema", () => {
  assert.equal(CONTRACT_VERSION, 1);
  const fixtures = { bbox: box, slideDoc, transcript, unit, judgeResult, errorEnvelope };
  for (const [name, value] of Object.entries(fixtures)) assert.deepEqual(validate(SCHEMAS[name], value), { ok: true }, name);
});

// 위반 종류마다 올바른 JSON-pointer 경로가 보고되는지 검증
test("each violation kind reports a JSON-pointer path", () => {
  const bad = (name, value) => validate(SCHEMAS[name], value).errors;
  // 타입 불일치
  assert.equal(bad("slideDoc", { ...slideDoc, t0: "120" })[0].path, "/t0");
  // 필수 속성 누락
  const missing = { ...slideDoc }; delete missing.slideId;
  assert.ok(bad("slideDoc", missing).some(e => e.path === "/slideId"));
  // 추가 속성
  assert.ok(bad("slideDoc", { ...slideDoc, foo: 1 }).some(e => e.path === "/foo"));
  // enum 위반 (중첩 경로)
  const badRole = { ...slideDoc, blocks: [{ ...slideDoc.blocks[0], role: "noise" }, slideDoc.blocks[1]] };
  assert.ok(bad("slideDoc", badRole).some(e => e.path === "/blocks/0/role"));
  // const 위반 — 이전 버전 문서도 새 계약에서는 거절된다
  assert.ok(bad("slideDoc", { ...slideDoc, schemaVersion: 2 }).some(e => e.path === "/schemaVersion"));
  // pattern 위반
  assert.ok(bad("errorEnvelope", { error: { ...errorEnvelope.error, code: "Rate_Limit" } }).some(e => e.path === "/error/code"));
  // minimum / maximum
  assert.ok(bad("unit", { ...unit, features: { ...unit.features, dwell: -1 } }).some(e => e.path === "/features/dwell"));
  assert.ok(bad("slideDoc", { ...slideDoc, blocks: [{ ...slideDoc.blocks[0], conf: 1.5 }, slideDoc.blocks[1]] }).some(e => e.path === "/blocks/0/conf"));
  // minLength / maxLength
  assert.equal(validate({ type: "string", minLength: 2 }, "가").errors[0].path, "");
  assert.ok(bad("slideDoc", { ...slideDoc, slideId: "x".repeat(65) }).some(e => e.path === "/slideId"));
  // minItems / maxItems
  assert.equal(validate({ type: "array", minItems: 2, items: { type: "integer" } }, [1]).errors[0].path, "");
  assert.ok(bad("slideDoc", { ...slideDoc, figures: Array(51).fill(slideDoc.figures[0]) }).some(e => e.path === "/figures"));
  // integer 위반
  assert.ok(bad("unit", { ...unit, features: { ...unit.features, speechChars: 3.5 } }).some(e => e.path === "/features/speechChars"));
  // null 비허용 / 허용
  assert.ok(bad("slideDoc", { ...slideDoc, slideId: null }).some(e => e.path === "/slideId"));
  assert.ok(validate(SCHEMAS.slideDoc, { ...slideDoc, model: null }).ok);
  // 환각 필터용 compressionRatio: 음수와 누락은 거절, null은 허용
  const seg = (extra, drop) => { const g = { ...transcript.segments[0], ...extra }; if (drop) delete g[drop]; return { ...transcript, segments: [g] }; };
  assert.ok(bad("transcript", seg({ compressionRatio: -0.1 })).some(e => e.path === "/segments/0/compressionRatio"));
  assert.ok(bad("transcript", seg({}, "compressionRatio")).some(e => e.path === "/segments/0/compressionRatio"));
  assert.ok(validate(SCHEMAS.transcript, seg({ compressionRatio: null })).ok);
  // 루트 경로는 빈 문자열
  assert.equal(validate(SCHEMAS.bbox, 5).errors[0].path, "");
  // 오류 상한 20개
  const many = validate({ type: "array", items: { type: "integer" } }, Array(50).fill("x"));
  assert.equal(many.errors.length, 20);
});

// 스키마 오탈자는 값과 무관하게 즉시 throw
test("unknown schema keyword throws fast", () => {
  assert.throws(() => validate({ type: "string", maxLenght: 3 }, "abc"), /maxLenght/);
  assert.throws(() => validate({ type: "object", properties: { a: { type: "number", unk: 1 } } }, { a: 1 }), /unk/);
});

// strict 호환: 모든 객체 스키마가 additionalProperties:false + 전 속성 required
test("all SCHEMAS are strict-compatible and frozen", () => {
  for (const [name, s] of Object.entries(SCHEMAS)) assert.ok(isStrictCompatible(s), name);
  assert.ok(Object.isFrozen(SCHEMAS.slideDoc) && Object.isFrozen(SCHEMAS.slideDoc.properties.blocks.items));
  assert.equal(isStrictCompatible({ type: "object", properties: { a: { type: "string" } }, required: [], additionalProperties: false }), false);
  assert.equal(isStrictCompatible({ type: "object", properties: { a: { type: "string" } }, required: ["a"] }), false);
});

// assertValid: 통과 시 값 반환, 실패 시 한국어 메시지
test("assertValid returns the value or throws the Korean message", () => {
  assert.equal(assertValid(SCHEMAS.bbox, box, "bbox"), box);
  assert.throws(() => assertValid(SCHEMAS.bbox, { x: 2, y: 0, w: 1, h: 1 }, "bbox"),
    { message: /^bbox 형식이 올바르지 않습니다: \/x / });
});

// evidenceItem: strict 호환, 슬라이드·발화·도표 세 종류가 통과하고 id 패턴·빈 text 는 거절
test("evidenceItem accepts slide, speech and figure items and rejects malformed ids", () => {
  const item = (extra = {}) => ({
    id: "U3.s2", unitId: "U3", kind: "slide", t0: 10, t1: 25.5,
    slideId: "s-3", sourceId: "b7", role: "body", text: "도함수는 순간 변화율이다.",
    ...extra,
  });
  assert.ok(isStrictCompatible(SCHEMAS.evidenceItem));
  assert.ok(validate(SCHEMAS.evidenceItem, item()).ok);
  assert.ok(validate(SCHEMAS.evidenceItem, item({ id: "U3.t5", kind: "speech", slideId: null, role: null })).ok);
  assert.ok(validate(SCHEMAS.evidenceItem, item({ id: "U3.g1", kind: "figure", role: null })).ok);
  assert.ok(validate(SCHEMAS.evidenceItem, item({ id: "U3.x1" })).errors.some(e => e.path === "/id"));
  assert.ok(validate(SCHEMAS.evidenceItem, item({ id: "3.s1" })).errors.some(e => e.path === "/id"));
  assert.ok(validate(SCHEMAS.evidenceItem, item({ text: "" })).errors.some(e => e.path === "/text"));
});

// figure.chartData: 간단한 그래프의 구조화 값(§14) — 맞는 모양은 통과, 어긋난 값은 경로를 보고한다
test("figure chartData validates its strict shape and reports nested paths", () => {
  const chart = { type: "bar", categories: ["늘었다", "줄었다"], series: [{ name: "응답", values: [62, 13] }], unit: "%", xLabel: null, yLabel: "응답 비율" };
  const fig = c => ({ ...slideDoc, figures: [{ ...slideDoc.figures[0], kind: "chart", cells: null, chartData: c }] });
  assert.ok(validate(SCHEMAS.slideDoc, fig(chart)).ok);
  assert.ok(validate(SCHEMAS.slideDoc, fig(null)).ok);
  const badChart = { ...chart, series: [{ name: "응답", values: ["62", 13] }] };
  assert.ok(validate(SCHEMAS.slideDoc, fig(badChart)).errors.some(e => e.path === "/figures/0/chartData/series/0/values/0"));
});
