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
});
