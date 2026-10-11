// tools/print-geometry.test.mjs
// 실제 Headless Chromium을 사용한 인쇄 기하 측정 테스트.
// 로컬 Chromium이 없으면 명시적으로 skip한다(측정 생략을 성공으로 위장하지 않는다).
// 주의: 이 측정은 비페이지 DOM 모델이다 — media:"print"(CDP)면 @media print가 적용되지만
// 요소 top/pageHeight의 쪽 판정은 실제 PDF 단편화 결과가 아닌 근사다.

import test from "node:test";
import assert from "node:assert/strict";

import PrintCheck from "../lib/print-check.js";
import {
  findChromium,
  createReleaseFixture,
  buildStandaloneHtml,
  buildGeometryProbeHtml,
  measureDomGeometry,
} from "./print-check.mjs";

const chromeBin = findChromium();
const browserTest = chromeBin ? test : (name, fn) => test.skip(name, fn);

// 이슈로 세는 것은 검증 가능한 결함뿐 — 쪽 경계 걸침 4종은 DOM 모델로 실제 단편화를
// 알 수 없어(인쇄 CSS keep 규칙이 처리) metrics 로만 둔다. 실측 계약은 그대로 유지된다(mis-sol-hai-28).
const EXPECTED_CODES = [
  PrintCheck.CODES.OVERFLOW_X,
  PrintCheck.CODES.OVERFLOW_Y,
  PrintCheck.CODES.FONT_SIZE_VIOLATION,
  PrintCheck.CODES.KATEX_ERROR,
  PrintCheck.CODES.IMAGE_FAILED,
];
// 경계 걸침 계열은 이슈가 아니라 측정값이다 — 어댑터가 재지 않으면 측정 경로가 고장 난 것.
const EXPECTED_METRICS = [
  "headingOrphanCount",
  "answerSplitCount",
  "tableRowClippedCount",
  "figureUnitSplitCount",
];

browserTest("브라우저 실측: 기하 probe가 의도된 결함을 이슈로, 경계 걸침을 지표로 모두 측정한다", async () => {
  const res = await measureDomGeometry(chromeBin, buildGeometryProbeHtml());
  assert.equal(res.measured, true, `측정 실패: ${res.reason}`);
  assert.ok(res.media === "print" || res.media === "screen", `media 라벨: ${res.media}`);
  assert.ok(res.check);

  const codes = new Set(res.check.issues.map(i => i.code));
  for (const c of EXPECTED_CODES) {
    assert.ok(codes.has(c), `${c} 미검출`);
  }
  for (const k of EXPECTED_METRICS) {
    assert.ok(res.check.metrics[k] > 0, `${k} 미측정`);
  }
  // 경계 걸침 계열은 이슈로 나오면 안 된다 — keep 규칙이 실제 인쇄에서 이미 처리한다.
  const metricCodes = new Set([PrintCheck.CODES.HEADING_ORPHAN, PrintCheck.CODES.ANSWER_SPLIT, PrintCheck.CODES.TABLE_ROW_CLIPPED, PrintCheck.CODES.FIGURE_UNIT_SPLIT]);
  assert.ok(!res.check.issues.some(i => metricCodes.has(i.code)), "경계 걸침이 이슈로 승격됨");

  // 세로 넘침은 한 쪽보다 큰 svg 1건만 — 쪽 경계를 걸치는 pre·한 쪽 초과 표 도표(G_TABLE)는 오탐하지 않는다
  assert.equal(res.check.metrics.overflowYCount, 1);
  const yIssue = res.check.issues.find(i => i.code === PrintCheck.CODES.OVERFLOW_Y);
  assert.equal(yIssue.targetTag, "svg");

  // 글자 크기 위반은 본문 claim 1건만 — .source 안 11px 보조 claim 은 양식상 의도라 오탐하지 않는다
  const fsIssues = res.check.issues.filter(i => i.code === PrintCheck.CODES.FONT_SIZE_VIOLATION);
  assert.equal(fsIssues.length, 1);

  // 도표 단위 분리는 G_SPLIT 1건만 — 1쪽 초과/분할 허용 G_TALL 은 오탐하지 않는다 (spec 8.3)
  assert.equal(res.check.metrics.figureUnitSplitCount, 1);
});

browserTest("브라우저 실측: 쪽 경계만 걸치는 단편은 세로 넘침으로 세지 않는다", async () => {
  const html = `<!doctype html><html><head><style>
* { margin: 0; padding: 0; }
.note { width: 686px; }
</style></head><body><article class="note">
<div style="height:900px"></div>
<pre style="height:200px">s</pre>
<div style="height:200px"></div>
</article></body></html>`;
  const res = await measureDomGeometry(chromeBin, html);
  assert.equal(res.measured, true, `측정 실패: ${res.reason}`);
  assert.equal(res.check.metrics.overflowYCount, 0);
  assert.ok(!res.check.issues.some(i => i.code === PrintCheck.CODES.OVERFLOW_Y));
});

browserTest("브라우저 실측: 골든 fixture는 DOM 기하 결함 0건이다", async () => {
  const { html } = buildStandaloneHtml(createReleaseFixture());
  const res = await measureDomGeometry(chromeBin, html);
  assert.equal(res.measured, true, `측정 실패: ${res.reason}`);
  assert.equal(res.check.issues.length, 0, JSON.stringify(res.check.issues));
  assert.equal(res.check.metrics.overflowXCount, 0);
  assert.equal(res.check.metrics.overflowYCount, 0);
});
