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

const EXPECTED_CODES = [
  PrintCheck.CODES.OVERFLOW_X,
  PrintCheck.CODES.OVERFLOW_Y,
  PrintCheck.CODES.HEADING_ORPHAN,
  PrintCheck.CODES.ANSWER_SPLIT,
  PrintCheck.CODES.TABLE_ROW_CLIPPED,
  PrintCheck.CODES.FONT_SIZE_VIOLATION,
  PrintCheck.CODES.KATEX_ERROR,
  PrintCheck.CODES.IMAGE_FAILED,
  PrintCheck.CODES.FIGURE_UNIT_SPLIT,
];

browserTest("브라우저 실측: 기하 probe가 의도된 9종 결함을 모두 검출한다", async () => {
  const res = await measureDomGeometry(chromeBin, buildGeometryProbeHtml());
  assert.equal(res.measured, true, `측정 실패: ${res.reason}`);
  assert.ok(res.media === "print" || res.media === "screen", `media 라벨: ${res.media}`);
  assert.ok(res.check);

  const codes = new Set(res.check.issues.map(i => i.code));
  for (const c of EXPECTED_CODES) {
    assert.ok(codes.has(c), `${c} 미검출`);
  }

  // 세로 넘침은 한 쪽보다 큰 svg 1건만 — 쪽 경계를 걸치는 pre는 오탐하지 않는다
  assert.equal(res.check.metrics.overflowYCount, 1);
  const yIssue = res.check.issues.find(i => i.code === PrintCheck.CODES.OVERFLOW_Y);
  assert.equal(yIssue.targetTag, "svg");

  // 도표 단위 분리는 G_SPLIT 1건만 — 1쪽 초과/분할 허용 G_TALL 은 오탐하지 않는다 (spec 8.3)
  assert.equal(res.check.metrics.figureUnitSplitCount, 1);
  const figIssue = res.check.issues.find(i => i.code === PrintCheck.CODES.FIGURE_UNIT_SPLIT);
  assert.ok(figIssue);
  assert.equal(figIssue.figId, "G_SPLIT");
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
