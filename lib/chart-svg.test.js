const test = require("node:test");
const assert = require("node:assert/strict");
const ChartSvg = require("./chart-svg.js");

test("ChartSvg rejects ungrounded numbers when ocrText does not cover values", () => {
  const chartData = {
    type: "bar",
    categories: ["2020", "2021"],
    series: [{ name: "매출", values: [100, 200] }],
    unit: "억원",
    xLabel: "연도",
    yLabel: "매출액",
  };

  // 근거 텍스트에 100만 있고 200이 없음 -> 거부 (null)
  assert.equal(ChartSvg.renderChartSvg(chartData, { ocrText: "연도별 매출 100억원 기록" }), null);

  // ocrText 가 아예 없음 -> 거부 (null)
  assert.equal(ChartSvg.renderChartSvg(chartData, { ocrText: null }), null);
  assert.equal(ChartSvg.renderChartSvg(chartData, { ocrText: "" }), null);
});

test("ChartSvg produces deterministic SVG when grounded", () => {
  const chartData = {
    type: "bar",
    categories: ["2020", "2021", "2022"],
    series: [
      { name: "매출", values: [100, 150, 200] },
      { name: "영업익", values: [10, 15, 20] },
    ],
    unit: "억원",
    xLabel: "연도",
    yLabel: "실적",
  };
  const ocrText = "2020년 100 10, 2021년 150 15, 2022년 200 20 억원 달성";

  const svg1 = ChartSvg.renderChartSvg(chartData, { ocrText });
  const svg2 = ChartSvg.renderChartSvg(chartData, { ocrText });

  assert.ok(svg1 !== null);
  assert.equal(svg1, svg2, "동일 입력에 대해 완전히 동일한 문자열(결정성)이어야 함");
  assert.ok(svg1.startsWith("<svg class=\"note-chart\""));
  assert.ok(svg1.includes("var(--accent)"), "디자인 토큰 색상 포함");
  assert.ok(svg1.includes("var(--ink)"), "디자인 토큰 색상 포함");
  assert.ok(svg1.includes("매출"), "범례 포함");
  assert.ok(svg1.includes("영업익"), "범례 포함");
  assert.ok(svg1.includes("표본: 2020~2022"), "표본 범위 포함");
  assert.ok(svg1.includes("실적 · 연도 (억원)"), "축 및 단위 포함");
});

test("ChartSvg line chart rendering is deterministic", () => {
  const chartData = {
    type: "line",
    categories: ["1월", "2월", "3월"],
    series: [{ name: "온도", values: [-5, 0, 10] }],
    unit: "°C",
    xLabel: "월",
    yLabel: "기온",
  };
  const ocrText = "1월 -5도, 2월 0도, 3월 10도";

  const svg = ChartSvg.renderChartSvg(chartData, { ocrText });
  assert.ok(svg !== null);
  assert.ok(svg.includes("<polyline"));
  assert.ok(svg.includes("<circle"));
  assert.ok(svg.includes("표본: 1월~3월"));
});

test("ChartSvg parses observed data from cells (numeric columns)", () => {
  const cells = [
    ["연도", "학생수"],
    ["2021", "50"],
    ["2022", "80"],
  ];
  const ocrText = "2021년 50명, 2022년 80명";

  const parsed = ChartSvg.parseChartFromCells(cells, { unit: "명" });
  assert.deepEqual(parsed, {
    type: "bar",
    categories: ["2021", "2022"],
    series: [{ name: "학생수", values: [50, 80] }],
    unit: "명",
    xLabel: "연도",
    yLabel: null,
  });

  const svg = ChartSvg.renderChartSvg({ cells, unit: "명" }, { ocrText });
  assert.ok(svg !== null);
  assert.ok(svg.includes("50명"));
  assert.ok(svg.includes("80명"));
});
