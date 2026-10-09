const test = require("node:test");
const assert = require("node:assert/strict");
const Figures = require("./figures.js");

// (1) 정상 허용 케이스
test("정상 허용: ocr 'A 10 B 20' + A=10, B=20 -> true", () => {
  const chartData = {
    type: "bar",
    categories: ["A", "B"],
    series: [{ name: "값", values: [10, 20] }],
    xLabel: "항목",
    yLabel: "값",
  };
  assert.equal(Figures.isSimpleChart(chartData, { ocrText: "A 10 B 20" }), true);
});

test("정상 허용: 음수 정상 'A -10 B 20' + A=-10, B=20 -> true", () => {
  const chartData = {
    type: "bar",
    categories: ["A", "B"],
    series: [{ name: "값", values: [-10, 20] }],
    xLabel: "항목",
    yLabel: "값",
  };
  assert.equal(Figures.isSimpleChart(chartData, { ocrText: "A -10 B 20" }), true);
});

test("정상 허용: 유니코드 마이너스 'A −10 B 20' + A=-10, B=20 -> true", () => {
  const chartData = {
    type: "bar",
    categories: ["A", "B"],
    series: [{ name: "값", values: [-10, 20] }],
    xLabel: "항목",
    yLabel: "값",
  };
  assert.equal(Figures.isSimpleChart(chartData, { ocrText: "A −10 B 20" }), true);
});

// (2) 차단 케이스 (구현 전이므로 현재 실패 기대)
test("차단: 근거는 'A 10 B 20'인데 데이터가 A=-10, B=20인 경우 -> false", () => {
  const chartData = {
    type: "bar",
    categories: ["A", "B"],
    series: [{ name: "값", values: [-10, 20] }],
    xLabel: "항목",
    yLabel: "값",
  };
  assert.equal(Figures.isSimpleChart(chartData, { ocrText: "A 10 B 20" }), false);
});

test("차단: 항목값 뒤바꿈 ocr 'A 10 B 20'인데 데이터가 A=20, B=10인 경우 -> false", () => {
  const chartData = {
    type: "bar",
    categories: ["A", "B"],
    series: [{ name: "값", values: [20, 10] }],
    xLabel: "항목",
    yLabel: "값",
  };
  assert.equal(Figures.isSimpleChart(chartData, { ocrText: "A 10 B 20" }), false);
});

test("차단: 근거가 축 눈금 '0 10 20' 뿐이고 카테고리 A, B가 OCR에 없는 경우 -> false", () => {
  const chartData = {
    type: "bar",
    categories: ["A", "B"],
    series: [{ name: "값", values: [10, 20] }],
    xLabel: "항목",
    yLabel: "값",
  };
  assert.equal(Figures.isSimpleChart(chartData, { ocrText: "0 10 20" }), false);
});
