// 도표 레지스트리·간단한 표/그래프 판정·크롭 — 계약은 docs/note-contract.md §14,
// 파이프라인은 docs/architecture-v2.md §6.7 이다.
const test = require("node:test");
const assert = require("node:assert/strict");
const Figures = require("./figures.js");
const Boilerplate = require("./boilerplate.js");
const Preprocess = require("./preprocess.js");
const input = require("../tools/note-fixture/input.json");

const gray = (w, h, f) => ({ width: w, height: h, data: Uint8Array.from({ length: w * h }, (_, i) => f(i % w, Math.floor(i / w))) });

// 64비트 차이 해시 — 균일하면 전부 0, 왼→오로 밝아지는 그라데이션은 전부 1
test("dHash: flat image is all zeros, left-to-right gradient is all ones", () => {
  assert.equal(Figures.dHash(gray(16, 8, () => 128)), "0000000000000000");
  const grad = Figures.dHash(gray(18, 8, x => x * 10));
  assert.equal(grad, "ffffffffffffffff");
  // RGBA 샘플은 휘도로 접는다 — 같은 그라데이션이면 같은 해시
  const rgba = { width: 18, height: 8, channels: 4,
    data: Uint8ClampedArray.from({ length: 18 * 8 * 4 }, (_, i) => i % 4 === 3 ? 255 : (i >> 2) % 18 * 10) };
  assert.equal(Figures.dHash(rgba), grad);
});

test("hamming counts differing bits between hex hashes", () => {
  assert.equal(Figures.hamming("0000000000000000", "ffffffffffffffff"), 64);
  assert.equal(Figures.hamming("8000000000000000", "0000000000000000"), 1);
  assert.equal(Figures.hamming("abcdef0123456789", "abcdef0123456789"), 0);
});

// §14 간단한 표 — 직사각형·빈 칸 없음·열≤5·행≤12·셀 숫자가 같은 영역의 로컬 OCR에 있다
test("isSimpleTable accepts a verified rectangular table and rejects degenerate shapes", () => {
  const T = Figures.isSimpleTable;
  assert.equal(T([["이름", "값"], ["A", "3"], ["B", "1,200"]], { ocrText: "A는 3이고 B는 1,200원" }), true);
  // 비교할 OCR이 없으면 숫자 없는 표만 옮겨 적을 수 있다
  assert.equal(T([["기준", "관점"], ["비용", "거래"]]), true);
  assert.equal(T([["구간", "값"], ["전체", "3"]]), false, "숫자는 OCR 없이 검증 불가");
  // 모양 위반
  assert.equal(T([]), false);
  assert.equal(T([["a", "b"], ["c"]]), false, "병합 셀처럼 들쭉날쭉한 행");
  assert.equal(T([["a", "b"], ["c", " "]]), false, "빈 칸");
  assert.equal(T([["a", "b", "c", "d", "e", "f"]]), false, "열 6개");
  assert.equal(T(Array.from({ length: 13 }, () => ["a", "b"])), false, "행 13개");
  // 셀 숫자가 OCR에 없으면 화면과 다른 값이다
  assert.equal(T([["이름", "값"], ["A", "7"]], { ocrText: "A 3" }), false);
});

// §14 간단한 그래프 — 막대·꺾은선만, 값이 전부 OCR에 있어야 다시 그린다
test("isSimpleChart requires bar/line, matching values, axis labels and OCR coverage", () => {
  const C = Figures.isSimpleChart;
  const good = { type: "bar", categories: ["늘었다", "줄었다"], series: [{ name: "응답", values: [62, 13] }], unit: "%", xLabel: null, yLabel: "응답 비율" };
  const ocr = "늘었다 62%, 줄었다 13%";
  assert.equal(C(good, { ocrText: ocr }), true);
  assert.equal(C(good), false, "OCR이 없으면 다시 그리지 않는다");
  assert.equal(C(good, { ocrText: "늘었다 62%" }), false, "값 13이 화면에 없다");
  assert.equal(C({ ...good, type: "pie" }, { ocrText: ocr }), false);
  assert.equal(C({ ...good, xLabel: null, yLabel: null }, { ocrText: ocr }), false, "축 이름이 안 읽혔다");
  assert.equal(C({ ...good, series: Array(4).fill(good.series[0]) }, { ocrText: ocr }), false, "계열 4개");
  assert.equal(C({ ...good, series: [{ name: "응답", values: [62] }] }, { ocrText: ocr }), false, "값 개수가 항목 수와 다르다");
});

// note-fixture.test.js 와 같은 순서다: boilerplate detect → buildIR 의 유닛·근거를 그대로 쓴다.
const detected = Boilerplate.detect(input.slides).slides;
const ir = Preprocess.buildIR(detected, input.transcript.segments);
const unitOf = id => (ir.units.find(u => u.slideId === String(id)) || {}).unitId ?? null;

// fixture의 두 도표가 슬라이드 순서대로 G1(표)·G2(차트)가 된다
test("fixture registry: G1 is the U4 table, G2 the U5 chart, in slide order", () => {
  const reg = Figures.buildFigureRegistry(detected, { unitOf, evidence: ir.evidence, crops: ["sl-5/g1"] });
  assert.deepEqual(reg.map(e => [e.id, e.evidenceId, e.kind]), [["G1", "U4.g1", "table"], ["G2", "U5.g1", "chart"]]);
  assert.equal(reg[0].slideId, "sl-4");
  assert.equal(reg[0].display, "table");   // 숫자 없는 단순 표는 옮겨 적는다
  assert.equal(reg[0].cropKey, "sl-4/g1");
  assert.equal(reg[1].slideId, "sl-5");
  assert.equal(reg[1].t0, 900);
  assert.equal(reg[1].display, "crop");    // chartData가 없어 다시 그릴 수 없다
  assert.equal(reg[1].cropKey, "sl-5/g1");
});

// 다음 슬라이드에 더 완성된 같은 도표가 나오면 합쳐 하나만 남기고 G# 를 다시 단다
test("near-duplicate figures merge into the fuller version keeping the earliest t0", () => {
  const slides = [
    { slideId: "a1", t0: 0, figures: [
      { id: "g", kind: "table", title: "t", bbox: { x: 0, y: 0.5, w: 0.5, h: 0.2 }, cells: [["기준", "값"]] },
    ] },
    { slideId: "a2", t0: 10, figures: [
      { id: "g", kind: "table", title: "t", bbox: { x: 0, y: 0.5, w: 0.5, h: 0.2 }, cells: [["기준", "값"], ["알파", "1"], ["베타", "2"]] },
      { id: "d", kind: "diagram", title: "구조", bbox: { x: 0, y: 0.8, w: 0.3, h: 0.1 }, cells: null },
    ] },
  ];
  const units = { a1: "U1", a2: "U2" }, of = id => units[id] ?? null;
  const evidence = [
    { id: "U1.g1", kind: "figure", unitId: "U1", slideId: "a1", sourceId: "g" },
    { id: "U2.g1", kind: "figure", unitId: "U2", slideId: "a2", sourceId: "g" },
    { id: "U2.g2", kind: "figure", unitId: "U2", slideId: "a2", sourceId: "d" },
  ];
  const reg = Figures.buildFigureRegistry(slides, {
    unitOf: of, evidence, crops: ["a2/d"],
    hashes: { "a1/g": "0000000000000000", "a2/g": "0000000000000007" },  // 해밍 3
  });
  assert.equal(reg.length, 2, "해밍 3의 같은 표는 하나로 합친다");
  const [t, d] = reg;
  assert.equal(t.id, "G1");
  assert.equal(t.slideId, "a2");           // 더 완성된 쪽을 대표로 둔다
  assert.equal(t.cells.length, 3);
  assert.equal(t.evidenceId, "U2.g1");
  assert.equal(t.t0, 0, "첫 등장 시각을 유지한다");
  assert.equal(t.display, "check");         // 숫자 셀을 검증할 OCR도 크롭도 없다
  assert.equal(d.id, "G2");
  assert.equal(d.display, "crop");
  // 해시가 없는 도표는 절대 합치지 않는다
  assert.equal(Figures.buildFigureRegistry(slides, { unitOf: of, evidence }).length, 3);
});

// 표시 결정 — 검증된 단순 표·그래프만 HTML로, 나머지는 크롭, 크롭도 없으면 "확인 필요"
test("display picks table/chart only when verified simple, else crop or check", () => {
  const slides = [{ slideId: "s", t0: 0, figures: [
    { id: "t", kind: "table", title: "표", bbox: { x: 0, y: 0.1, w: 0.5, h: 0.2 }, cells: [["항목", "값"], ["매출", "62"]] },
    { id: "c", kind: "chart", title: "차트", bbox: { x: 0, y: 0.4, w: 0.5, h: 0.2 }, cells: null,
      chartData: { type: "line", categories: ["전", "후"], series: [{ name: "점유율", values: [25, 62] }], unit: "%", xLabel: "시점", yLabel: null } },
    { id: "x", kind: "chart", title: "복잡한 차트", bbox: { x: 0, y: 0.7, w: 0.5, h: 0.2 }, cells: null, chartData: null },
    { id: "y", kind: "diagram", title: "도식", bbox: { x: 0.6, y: 0.7, w: 0.3, h: 0.2 }, cells: null },
  ] }];
  const evidence = ["t", "c", "x", "y"].map((f, i) => ({ id: `U1.g${i + 1}`, kind: "figure", unitId: "U1", slideId: "s", sourceId: f }));
  const reg = Figures.buildFigureRegistry(slides, {
    unitOf: () => "U1", evidence,
    ocr: { "s/t": "항목 값 매출 62", "s/c": "전 후 점유율 25 62" },
    crops: ["s/x"],
  });
  assert.deepEqual(reg.map(e => [e.id, e.display]), [["G1", "table"], ["G2", "chart"], ["G3", "crop"], ["G4", "check"]]);
});

// 크롭 — 주입된 캔버스에 비트맵 좌표로 옮겨 그리고 WebP로 돌려준다
test("cropFigure clamps the ratio bbox to the bitmap, draws it and converts to webp", async () => {
  const calls = [];
  const bitmap = { width: 100, height: 50 };
  const createCanvas = () => ({
    getContext: () => ({ drawImage: (...a) => calls.push(a) }),
    convertToBlob: o => { calls.push(o); return Promise.resolve({ type: o.type }); },
  });
  await Figures.cropFigure(bitmap, { x: 0.5, y: 0.5, w: 0.9, h: 0.9 }, { createCanvas });
  assert.deepEqual(calls[0], [bitmap, 50, 25, 50, 25, 0, 0, 50, 25], "이미지 밖은 클램프된다");
  assert.equal(calls[1].type, "image/webp");
  calls.length = 0;
  await Figures.cropFigure(bitmap, { x: 0, y: 0, w: 1, h: 1 }, { createCanvas, maxSide: 10 });
  assert.deepEqual(calls[0].slice(5), [0, 0, 10, 5], "긴 변은 maxSide를 넘지 않는다");
  await assert.rejects(() => Figures.cropFigure(bitmap, { x: 0.5, y: 0.5, w: 0, h: 0.2 }, { createCanvas }), TypeError);
});
