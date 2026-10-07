// tools/print-check.test.mjs
// 조판 검수 CI 도구 단위 테스트

import test from "node:test";
import assert from "node:assert/strict";

import {
  findChromium,
  hasPyMuPDF,
  createSyntheticFixture,
  createReleaseFixture,
  buildStandaloneHtml,
  buildGeometryProbeHtml,
  buildInstrumentedHtml,
  extractCheckResult,
  measureDomGeometry,
  measurePdfGeometry,
  generatePdfContactSheet,
  getPdfRepresentativePages,
  generateDomContactSheet,
  runPrintCheckCI,
} from "./print-check.mjs";

test("1. 합성 스트레스 Fixture 생성 검증", () => {
  const fixture = createSyntheticFixture();
  assert.ok(fixture.meta?.title);
  assert.equal(fixture.sections.length, 1);

  // 깨진 수식 F999 참조 포함 확인
  const def = fixture.sections[0].blocks[0].content.definition.text;
  assert.ok(def.includes("{{F999}}"), "미등록 F999 참조가 포함되어야 함");

  // 파싱 불가 수식 F3 포함 확인
  const badFormula = fixture.registry.find(f => f.id === "F3");
  assert.ok(badFormula);
  assert.equal(badFormula.latex, "\\frac{1}{", "문법 오류 수식이어야 함");

  // 긴 표 포함 확인 (30행 이상)
  const tableFig = fixture.figures.find(f => f.id === "G1");
  assert.ok(tableFig);
  assert.ok(tableFig.cells.length >= 35, "35행 이상의 긴 표여야 함");
});

test("2. 골든 릴리스 Fixture 무결성 검증", () => {
  const release = createReleaseFixture();
  assert.ok(release.meta?.title);

  // 모든 참조 수식(F1, F2)이 레지스트리에 존재함
  const regIds = new Set(release.registry.map(f => f.id));
  const text1 = release.sections[0].blocks[0].content.definition.text;
  const text2 = release.sections[0].blocks[0].content.explanation.text;

  const matches = [...(text1 + text2).matchAll(/\{\{\s*(F\d+)\s*\}\}/g)].map(m => m[1]);
  for (const id of matches) {
    assert.ok(regIds.has(id), `참조 수식 ${id}이(가) 등록부에 있어야 함`);
  }
});

test("3. 독립 HTML 생성 검증", () => {
  const release = createReleaseFixture();
  const res = buildStandaloneHtml(release);

  assert.ok(res.html.includes("<!doctype html>"));
  assert.ok(res.html.includes("<style>"));
  assert.ok(res.html.includes("class=\"note\""));
  assert.equal(res.warnings.length, 0);
});

test("4. 환경 탐색 함수 (Chromium 및 PyMuPDF) 반환 타입 검증", () => {
  const chrome = findChromium();
  assert.ok(chrome === null || typeof chrome === "string");

  const pymupdf = hasPyMuPDF();
  assert.equal(typeof pymupdf, "boolean");
});

test("5. runPrintCheckCI 실행 및 출시 조건 통과 검증", async () => {
  const result = await runPrintCheckCI();
  assert.equal(result.ok, true);
  assert.equal(result.releaseMetrics.unknownRefs, 0);
  assert.equal(result.releaseMetrics.formulaFails, 0);
  assert.equal(result.caughtStressIssues.brokenRef, true);
  assert.equal(result.caughtStressIssues.formulaFailed, true);

  // 측정 여부는 환경 의존 — 측정됐으면 media+metrics, 아니면 명시적 reason이 있어야 한다
  assert.equal(typeof result.domRelease.measured, "boolean");
  if (result.domRelease.measured) {
    assert.ok(result.domRelease.media === "print" || result.domRelease.media === "screen");
    assert.ok(result.domRelease.metrics);
    assert.equal(result.domRelease.metrics.overflowXCount, 0);
    assert.equal(result.domRelease.metrics.overflowYCount, 0);
  } else {
    assert.ok(typeof result.domRelease.reason === "string" && result.domRelease.reason.length > 0);
  }
});

test("6. 기하 probe 문서 구조: 의도된 결함 마커가 모두 포함됨", () => {
  const html = buildGeometryProbeHtml();
  assert.ok(html.includes('<article class="note"'));
  assert.ok(html.includes('class="answer"'));
  assert.ok(html.includes('class="answer-head"'));
  assert.ok(html.includes('class="answer-body"'));
  assert.ok(html.includes('class="katex-error"'));
  assert.ok(html.includes('data-decode-failed="true"'));
  assert.ok(html.includes('class="note-table"'));
  assert.ok(html.includes("<h3"));
  assert.ok(html.includes("<svg"));
  assert.ok(html.includes("<pre"));
  assert.ok(html.includes('data-fig="G_SPLIT"'), "FIGURE_UNIT_SPLIT 결함 도표 포함");
  assert.ok(html.includes('data-fig="G_TALL"'), "1쪽 초과 분할 허용 도표 포함");
});

test("7. 계측 삽입: print-check 스크립트와 결과 마커 드라이버가 </body> 앞에 들어감", () => {
  const src = "<!doctype html><html><body><article class=\"note\"></article></body></html>";
  const inst = buildInstrumentedHtml(src);

  assert.ok(inst.includes("globalThis.PrintCheck"));
  assert.ok(inst.includes("print-check-result"));
  assert.ok(inst.includes("checkPrintLayout"));
  assert.ok(inst.indexOf("print-check-result") < inst.indexOf("</body>"), "드라이버는 </body> 앞에 있어야 한다");
  assert.ok(inst.indexOf("globalThis.PrintCheck") < inst.indexOf("checkPrintLayout(adapter)"), "라이브러리가 드라이버보다 먼저 로드되어야 한다");

  // </body>가 없는 문서는 끝에 덧붙인다
  const noBody = buildInstrumentedHtml("<div class=\"note\"></div>");
  assert.ok(noBody.endsWith("})();") || noBody.includes("print-check-result"));

  assert.throws(() => buildInstrumentedHtml(""), /HTML/);
});

test("8. 덤프 DOM 결과 추출: JSON 파싱과 HTML 엔티티 복원", () => {
  const payload = JSON.stringify({
    measured: true,
    reason: null,
    check: { ok: false, issues: [{ code: "OVERFLOW_X", blockId: "S1_B1" }], metrics: { overflowXCount: 1 } },
  });
  const dom = `<html><body><pre id="print-check-result" style="display: none;">${payload.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre></body></html>`;

  const res = extractCheckResult(dom);
  assert.equal(res.measured, true);
  assert.equal(res.check.issues[0].code, "OVERFLOW_X");
  assert.equal(res.check.metrics.overflowXCount, 1);

  assert.equal(extractCheckResult("<html><body></body></html>"), null);
  assert.equal(extractCheckResult(null), null);
  assert.equal(extractCheckResult(`<pre id="print-check-result">{broken</pre>`), null);
});

test("9. 측정 불가 경로는 0이 아니라 measured:false와 사유를 반환한다", async () => {
  const noChrome = await measureDomGeometry(null, "<html></html>");
  assert.equal(noChrome.measured, false);
  assert.equal(noChrome.media, null);
  assert.equal(noChrome.reason, "chromium-unavailable");
  assert.equal(noChrome.check, null);

  const pdf = measurePdfGeometry("/nonexistent.pdf");
  assert.equal(typeof pdf.measured, "boolean");
  if (!pdf.measured) {
    assert.ok(typeof pdf.reason === "string" && pdf.reason.length > 0);
  }
});

test("10. generatePdfContactSheet: PyMuPDF 부재 시 미검증 반환 및 print_pagination 라벨 확인", () => {
  const pymupdf = hasPyMuPDF();
  const res = generatePdfContactSheet("/nonexistent.pdf");

  assert.equal(res.checkType, "print_pagination");
  assert.ok(res.label.includes("PDF 인쇄 페이지"));

  if (!pymupdf) {
    assert.equal(res.generated, false);
    assert.equal(res.verified, false);
    assert.equal(res.status, "미검증");
    assert.equal(res.reason, "pymupdf-unavailable");
  } else {
    assert.equal(typeof res.generated, "boolean");
  }
});

test("11. getPdfRepresentativePages: PyMuPDF 부재 시 미검증 반환 및 print_pagination 라벨 확인", () => {
  const pymupdf = hasPyMuPDF();
  const res = getPdfRepresentativePages("/nonexistent.pdf");

  assert.equal(res.checkType, "print_pagination");
  assert.ok(res.label.includes("PDF 인쇄 페이지"));

  if (!pymupdf) {
    assert.equal(res.verified, false);
    assert.equal(res.status, "미검증");
    assert.equal(res.reason, "pymupdf-unavailable");
    assert.equal(res.pages, null);
  } else {
    assert.equal(typeof res.verified, "boolean");
  }
});

test("12. generateDomContactSheet: DOM 프리플라이트 축소 미리보기 문서 생성 및 dom_preflight 라벨 확인", () => {
  const sampleHtml = "<div>테스트 본문</div>";
  const res = generateDomContactSheet(sampleHtml, { cols: 3, scale: 0.2 });

  assert.equal(res.generated, true);
  assert.equal(res.verified, true);
  assert.equal(res.status, "완료");
  assert.equal(res.checkType, "dom_preflight");
  assert.ok(res.label.includes("DOM 프리플라이트"));
  assert.ok(res.html.includes("class=\"sheet-grid\""));
  assert.ok(res.html.includes("class=\"sheet-preview\""));
  assert.ok(res.html.includes("실제 PDF 인쇄 페이지 단편화 검증(print pagination)이 아닙니다"));
});

test("13. runPrintCheckCI 결과에 대표 페이지 및 밀착 인화 검증 상태 포함", async () => {
  const result = await runPrintCheckCI();
  assert.equal(result.ok, true);

  // domRelease 가 측정된 경우 대표 페이지 목록 확인 (DOM 프리플라이트)
  if (result.domRelease.measured) {
    assert.ok(result.domRelease.representativePages, "DOM 대표 페이지 데이터가 있어야 함");
    assert.equal(result.domRelease.representativePages.checkType, "dom_preflight");
    assert.ok(Array.isArray(result.domRelease.representativePages.zoomList));
  }

  // PDF 밀착 인화 및 대표 페이지 상태 확인
  assert.ok(result.pdfContactSheet);
  assert.equal(result.pdfContactSheet.checkType, "print_pagination");
  assert.ok(result.pdfRepresentativePages);
  assert.equal(result.pdfRepresentativePages.checkType, "print_pagination");

  if (!hasPyMuPDF()) {
    assert.equal(result.pdfContactSheet.status, "미검증");
    assert.equal(result.pdfRepresentativePages.status, "미검증");
  }
});
