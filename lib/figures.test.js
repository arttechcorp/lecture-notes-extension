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

// 크롭 표시 도표의 근거 기반 설명 — 비전의 chartSummary 만 그 도표 근거를 인용하는 주장이 된다
test("chartSummary는 그 도표 근거를 인용하는 explanation 주장이 되고, 없으면 만들지 않는다", () => {
  const slides = [{ slideId: "s", t0: 0, figures: [
    { id: "x", kind: "chart", title: "복잡한 차트", bbox: { x: 0, y: 0.7, w: 0.5, h: 0.2 }, cells: null, chartData: null,
      chartSummary: "매출이 2021년부터 오른다" },
    { id: "y", kind: "diagram", title: "도식", bbox: { x: 0.6, y: 0.7, w: 0.3, h: 0.2 }, cells: null },
  ] }];
  const evidence = ["x", "y"].map((f, i) => ({ id: `U1.g${i + 1}`, kind: "figure", unitId: "U1", slideId: "s", sourceId: f }));
  const reg = Figures.buildFigureRegistry(slides, { unitOf: () => "U1", evidence, crops: ["s/x", "s/y"] });
  assert.deepEqual(reg[0].explanation, { text: "매출이 2021년부터 오른다", evidenceIds: ["U1.g1"], basis: "lecture" });
  assert.equal(reg[1].explanation, null, "요약이 없으면 주장을 지어내지 않는다");
  // 크롭이 아닌 표시(재조판/누락)에는 설명을 달지 않는다
  const noCrop = Figures.buildFigureRegistry(slides, { unitOf: () => "U1", evidence });
  assert.equal(noCrop[0].explanation, null, "check 표시는 크롭이 없어 설명도 붙지 않는다");
  // claim text 상한(600자)을 넘는 요약은 자른다 — 스키마 위반으로 노트 전체가 깨지는 걸 막는다
  const long = Figures.buildFigureRegistry(
    [{ slideId: "s", t0: 0, figures: [{ id: "x", kind: "chart", bbox: { x: 0, y: 0, w: 0.5, h: 0.5 }, chartSummary: "가".repeat(700) }] }],
    { unitOf: () => "U1", evidence: [{ id: "U1.g1", kind: "figure", unitId: "U1", slideId: "s", sourceId: "x" }], crops: ["s/x"] });
  assert.equal(long[0].explanation.text.length, 600);
});

// 크롭 — 프레임을 넘는 bbox는 코드를 단 TypeError로 거절하고, 유효한 가장자리 상자는 묶인 패딩 뒤 비트맵 좌표로 잘라 WebP로 돌려준다
test("cropFigure rejects out-of-frame bboxes and draws a bounded edge crop to webp", async () => {
  const calls = [];
  const bitmap = { width: 100, height: 50 };
  const createCanvas = () => ({
    getContext: () => ({ drawImage: (...a) => calls.push(a) }),
    convertToBlob: o => { calls.push(o); return Promise.resolve({ type: o.type }); },
  });
  await Figures.cropFigure(bitmap, { x: 0, y: 0, w: 0.5, h: 0.5 }, { createCanvas });
  assert.deepEqual(calls[0], [bitmap, 0, 0, 53, 27, 0, 0, 53, 27], "가장자리 상자: 패딩은 프레임 안에 묶인다");
  assert.equal(calls[1].type, "image/webp");
  calls.length = 0;
  await Figures.cropFigure(bitmap, { x: 0, y: 0, w: 0.5, h: 0.5 }, { createCanvas, maxSide: 10 });
  assert.deepEqual(calls[0].slice(5), [0, 0, 10, 5], "긴 변은 maxSide를 넘지 않는다");
  for (const [b, code] of [
    [{ x: 0.5, y: 0.5, w: 0.9, h: 0.9 }, "CROP_BAD_BBOX"],   // 프레임 밖으로 넘치는 상자는 자르지 않는다
    [{ x: 0, y: 0, w: 1, h: 1 }, "CROP_WHOLE_FRAME"],         // 슬라이드 통째는 크롭이 아니다
    [{ x: 0.5, y: 0.5, w: 0, h: 0.2 }, "CROP_BAD_BBOX"],      // 빈 상자
  ]) await assert.rejects(
    () => Figures.cropFigure(bitmap, b, { createCanvas }),
    e => e instanceof TypeError && e.code === code,
    JSON.stringify(b));
});

// cropFigure가 내리기만 하는지 — 패딩 뒤 소스 영역의 픽셀을 있는 그대로 그리고(늘리지 않는다),
// 소스 픽셀 크기·저해상도는 패딩 전 원본 상자로 호출자에게 알린다
test("cropFigure never upscales and reports source pixels + lowRes through the info object", async () => {
  const calls = [], info = {};
  const bitmap = { width: 20, height: 20 };
  const createCanvas = () => ({
    getContext: () => ({ drawImage: (...a) => calls.push(a) }),
    convertToBlob: o => Promise.resolve({ type: o.type }),
  });
  await Figures.cropFigure(bitmap, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, { createCanvas, maxSide: 1200, info });
  assert.deepEqual([info.srcW, info.srcH, info.lowRes], [10, 10, true], "소스 픽셀(패딩 전)이 64px 미만이면 저해상도 표시");
  assert.equal(info.sw, 12, "패딩 뒤 소스 영역의 너비 — 품질 지표(srcW·lowRes)는 패딩 전이다");
  assert.deepEqual(calls[0], [bitmap, 1, 1, 12, 12, 0, 0, 12, 12], "패딩된 소스 영역을 원본 픽셀 그대로 그린다 — 출력이 소스 픽셀을 넘지 않는다");
});

// 자를 상자 — 유한·양수·프레임 안이 아닌 bbox와 소스 픽셀이 없는 영역은 거절 코드다
test("cropBox rejects non-finite, non-positive, out-of-frame and empty bboxes", () => {
  const B = Figures.cropBox;
  const bad = [null, {}, { x: NaN, y: 0, w: 0.5, h: 0.5 }, { x: Infinity, y: 0, w: 0.5, h: 0.5 },
    { x: 0, y: 0, w: -0.5, h: 0.5 }, { x: 0, y: 0, w: 0.5, h: 0 }, { x: -0.1, y: 0, w: 0.5, h: 0.5 },
    { x: 0.5, y: 0.5, w: 0.9, h: 0.9 }, { x: 0.5, y: 0.5, w: 0.6, h: 0.6 },
    { x: 0, y: 0, w: 0.001, h: 0.5 }]; // 0.001×100 = 0.1px — 소스 픽셀이 없는 빈 영역
  for (const b of bad) assert.equal(B(b, 100, 50).code, "CROP_BAD_BBOX", JSON.stringify(b));
});

// 패딩은 상자 비율(padRatio)과 프레임 픽셀 상한(padPx) 중 작은 쪽으로 묶이고 프레임을 넘지 않는다 —
// 패딩 뒤에도 프레임 대부분이면 통째 슬라이라 자르지 않는다
test("cropBox pads a valid box inside the frame and never returns a whole slide", () => {
  const B = Figures.cropBox, r = B({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, 100, 100, { padRatio: 0.02 });
  assert.deepEqual([r.box.x, r.box.y, r.box.w, r.box.h].map(v => Math.round(v * 100) / 100), [0.09, 0.09, 0.52, 0.52], "상자의 2%(padRatio)만큼 늘린다");
  assert.deepEqual([r.sx, r.sy, r.sw, r.sh], [9, 9, 52, 52], "패딩된 영역의 정수 소스 픽셀");
  const edge = B({ x: 0, y: 0, w: 0.5, h: 0.5 }, 100, 100, { padRatio: 0.05 });
  assert.equal(edge.box.x, 0, "패딩은 프레임을 넘지 않는다");
  assert.equal(edge.box.y, 0);
  const big = B({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 2000, 2000); // padRatio면 100px — padPx(24)가 묶는다
  assert.equal(big.box.x, 0.2 - 24 / 2000);
  for (const b of [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0.01, y: 0.01, w: 0.97, h: 0.97 }])
    assert.equal(B(b, 100, 100).code, "CROP_WHOLE_FRAME", "패딩 뒤에도 프레임의 90% 이상이면 거절");
});

// 저해상도 표시 — 소스 픽셀의 짧은 변이 64px 미만이면 OCR 숫자 대조를 믿을 수 없다
test("cropBox marks crops whose source pixels are too small for OCR as lowRes", () => {
  const B = Figures.cropBox;
  assert.equal(B({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, 20, 20).lowRes, true);
  assert.equal(B({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, 200, 200).lowRes, false);
  assert.equal(B({ x: 0, y: 0, w: 1, h: 0.2 }, 640, 100).lowRes, true, "넓어도 짧은 변이 64px 미만이면 저해상도");
});

// 제공자 응답의 cells·chartData는 OCR을 지어내는 재료가 아니다 — 같은 영역의 독립 로컬 OCR 없이는
// 숫자 든 도표를 절대 table·chart 로 내리지 않는다(제공자 결과로 제공자 결과를 검증하지 않는다)
test("provider cells and chartData can never verify themselves — without independent crop OCR a numeric figure stays check/crop", () => {
  const slides = [{ slideId: "s", t0: 0, figures: [
    { id: "c", kind: "chart", title: "차트", bbox: { x: 0, y: 0.1, w: 0.5, h: 0.3 }, cells: null,
      chartData: { type: "bar", categories: ["전", "후"], series: [{ name: "점유율", values: [25, 62] }], xLabel: "시점", yLabel: null } },
    { id: "t", kind: "table", title: "표", bbox: { x: 0, y: 0.5, w: 0.5, h: 0.3 }, cells: [["항목", "값"], ["매출", "62"]] },
  ] }];
  const evidence = ["c", "t"].map((f, i) => ({ id: `U1.g${i + 1}`, kind: "figure", unitId: "U1", slideId: "s", sourceId: f }));
  const mk = (ocr, extra = {}) => Figures.buildFigureRegistry(slides, { unitOf: () => "U1", evidence, ocr, ...extra });
  // OCR이 없으면 cells·chartData 자체로는 검증 불가 — 숫자 든 표·그래프는 check(크롭이 있으면 crop)
  assert.deepEqual(mk({}).map(e => e.display), ["check", "check"]);
  assert.deepEqual(mk({}, { crops: ["s/c", "s/t"] }).map(e => e.display), ["crop", "crop"]);
  // 독립 크롭 OCR이 모든 숫자를 덮을 때만 다시 그린다 — 하나라도 모자라면 crop/check 다
  assert.deepEqual(mk({ "s/c": "전 후 점유율 25", "s/t": "항목 값 매출 62" }).map(e => e.display), ["check", "table"], "차트 값 62가 OCR에 없다");
  assert.deepEqual(mk({ "s/c": "전 후 점유율 25 62", "s/t": "항목 값 매출 62" }).map(e => e.display), ["chart", "table"]);
});

// 기기 안 크롭 OCR — 초기화가 던지면 새 엔진도 내려야 하고, 실패(null)는 그 작업 안에서 캐시된다.
// 캐시를 비우는 건 작업 끝의 cropOcrDispose 몫이라 다음 작업이 다시 띄운다.
test("cropOcr caches a failed init as null until dispose, then the next job retries", async () => {
  const gone = []; let made = 0;
  try {
    globalThis.PpOcrV5 = class { constructor() { made++; } async init() { throw new Error("model missing"); } async dispose() { gone.push(this); } };
    assert.equal(await Figures.cropOcr(), null);
    assert.deepEqual([made, gone.length], [1, 1], "init가 던진 새 엔진도 바로 해제한다");
    assert.equal(await Figures.cropOcr(), null, "같은 작업 안에서는 실패가 캐시된다");
    assert.equal(made, 1, "두 번째 호출은 엔진을 다시 만들지 않는다");
    await Figures.cropOcrDispose();
    assert.equal(gone.length, 1, "실패 캐시에는 더 내릴 엔진이 없다");
    globalThis.PpOcrV5 = class { constructor() { made++; } async init() {} async recognize() { return { text: "x" }; } async dispose() { gone.push(this); } };
    const engine = await Figures.cropOcr();
    assert.ok(engine, "작업 끝에 캐시를 비우면 다음 호출이 다시 띄운다");
    assert.equal(made, 2);
    assert.equal(await Figures.cropOcr(), engine, "살아 있는 엔진은 하나만 쓴다");
    assert.equal(made, 2);
    await Figures.cropOcrDispose();
    assert.equal(gone.length, 2, "작업이 끝나면 엔진을 내려 메모리를 푼다");
  } finally {
    delete globalThis.PpOcrV5;
    await Figures.cropOcrDispose(); // 어느 단언에서 던져도 엔진 캐시를 비워 둔다
  }
});

test("figureFunnelStats: counts funnel stages across crop, select, reject, plan, text, render", () => {
  const slides = [
    { slideId: "s1", t0: 0, figures: [{ id: "f1", kind: "table" }, { id: "f2", kind: "chart" }] },
    { slideId: "s2", t0: 60, figures: [{ id: "f3", kind: "diagram" }] },
  ];
  const figures = [
    { id: "G1", kind: "table", display: "table", cropKey: "s1/f1" },
    { id: "G2", kind: "chart", display: "check", cropKey: "s1/f2" },
    { id: "G3", kind: "diagram", display: "crop", cropKey: "s2/f3" },
  ];
  const crops = ["s1/f1", "s2/f3"];
  const plan = {
    sections: [{ blocks: [{ blockId: "S1_B1", figureIds: ["G1", "G3"] }] }],
    global: [],
  };
  const note = {
    sections: [{ blocks: [{ type: "B10", content: { figureIds: ["G1"] }, planBlock: { figureIds: ["G1", "G3"] } }] }],
    global: [],
  };
  const stats = Figures.figureFunnelStats({ slides, figures, crops, plan, note });
  assert.equal(stats.cropExist, 2, "s1/f1, s2/f3 에 크롭 존재");
  assert.equal(stats.selected, 3, "레지스트리에 3개 선택");
  assert.equal(stats.rejectedQuality, 1, "G2 가 check 로 품질 거절");
  assert.equal(stats.planAssigned, 2, "계획에 G1, G3 배정");
  assert.equal(stats.textReferenced, 2, "노트 본문/블록에서 G1, G3 참조");
  assert.equal(stats.renderSuccess, 2, "G1(table), G3(crop) 렌더 성공");
});

