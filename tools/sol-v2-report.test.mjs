import test from "node:test";
import assert from "node:assert/strict";
import { parseResultLines, aggregateByMode, generateReport } from "./sol-v2-report.mjs";

test("parseResultLines parses JSON lines and JSON array", () => {
  const jsonl = `
{"mode":"sol-luna-2","repeat":0,"verdict":"complete","reportedCostUsd":0.25}
{"mode":"sol-fork-2","repeat":0,"verdict":"complete","reportedCostUsd":0.80}
  `;
  const rows1 = parseResultLines(jsonl);
  assert.equal(rows1.length, 2);
  assert.equal(rows1[0].mode, "sol-luna-2");
  assert.equal(rows1[1].mode, "sol-fork-2");

  const arr = JSON.stringify([
    { mode: "sol-luna-2", repeat: 0 },
    { mode: "sol-fork-2", repeat: 0 },
  ]);
  const rows2 = parseResultLines(arr);
  assert.equal(rows2.length, 2);
  assert.equal(rows2[0].mode, "sol-luna-2");
});

test("aggregateByMode: pass count 0 yields 'n/a', never 0", () => {
  const rows = [
    { mode: "sol-luna-2", repeat: 0, verdict: "failed", status: "failed", reportedCostUsd: 0.20, criticalErrors: ["VAL_BLOCK_DECLINED"] },
    { mode: "sol-luna-2", repeat: 1, verdict: "degraded", status: "partial", reportedCostUsd: 0.15, criticalErrors: ["MATH_ERROR"] },
  ];
  const { modes } = aggregateByMode(rows);
  const m = modes["sol-luna-2"];
  assert.equal(m.totalRuns, 2);
  assert.equal(m.qualityPassCount, 0);
  assert.equal(m.costPerPassTotal, "n/a", "품질 통과 0건일 때 비용은 반드시 'n/a'여야 함 (0이 아님)");
  assert.equal(m.costPerPassSuccess, "n/a");
  assert.deepEqual(m.criticalErrorCounts, { VAL_BLOCK_DECLINED: 1, MATH_ERROR: 1 });
});

test("aggregateByMode: calculates cost per pass with failures included and success-only", () => {
  const rows = [
    { mode: "sol-luna-2", repeat: 0, verdict: "complete", status: "complete", reportedCostUsd: 0.30, criticalErrors: [] },
    { mode: "sol-luna-2", repeat: 1, verdict: "failed", status: "failed", reportedCostUsd: 0.10, criticalErrors: ["TIMEOUT"] },
  ];
  const { modes } = aggregateByMode(rows);
  const m = modes["sol-luna-2"];
  assert.equal(m.totalRuns, 2);
  assert.equal(m.qualityPassCount, 1);
  assert.equal(m.totalCostUsd, 0.40);
  assert.equal(m.successfulCostUsd, 0.30);
  assert.equal(m.costPerPassTotal, 0.40);
  assert.equal(m.costPerPassSuccess, 0.30);
});

test("aggregateByMode & generateReport: no winner declared without human scores", () => {
  const rows = [
    { mode: "sol-luna-2", repeat: 0, verdict: "complete", status: "complete", reportedCostUsd: 0.20, humanScores: null, criticalErrors: [] },
    { mode: "sol-fork-2", repeat: 0, verdict: "complete", status: "complete", reportedCostUsd: 0.85, humanScores: null, criticalErrors: [] },
  ];
  const { verdict } = aggregateByMode(rows, { margin: 3 });
  assert.equal(verdict.winner, null, "사람 평가 점수가 없으면 승자를 확정하지 않음");
  assert.match(verdict.reason, /사람 평가 점수가 없어 승자를 확정하지 않음/);

  const md = generateReport(rows, { margin: 3 });
  assert.match(md, /승자 미정/);
  assert.match(md, /사람 블라인드 평가 미진행/);
});

test("aggregateByMode & generateReport: human scores within equivalence margin trigger cost fallback", () => {
  const rows = [
    {
      mode: "sol-luna-2", repeat: 0, verdict: "complete", status: "complete", reportedCostUsd: 0.25, criticalErrors: [],
      humanScores: { accuracy: 3.5, coverage: 3.5, structure: 3.5, visualization: 3.5, questions: 3.5, layout: 3.5 }
    },
    {
      mode: "sol-fork-2", repeat: 0, verdict: "complete", status: "complete", reportedCostUsd: 0.90, criticalErrors: [],
      humanScores: { accuracy: 3.6, coverage: 3.5, structure: 3.5, visualization: 3.5, questions: 3.5, layout: 3.5 }
    },
  ];
  const { modes, verdict } = aggregateByMode(rows, { margin: 3 });
  assert.ok(verdict.hasHumanScores);
  assert.ok(Math.abs(modes["sol-luna-2"].humanScore100 - modes["sol-fork-2"].humanScore100) <= 3);
  // 점수가 동등 마진(3점) 이내이므로 더 저렴한 sol-luna-2 가 승자
  assert.equal(verdict.winner, "sol-luna-2");
  assert.match(verdict.reason, /동등 허용폭.*비용 우위/);

  const md = generateReport(rows, { margin: 3 });
  assert.match(md, /sol-luna-2 채택/);
  assert.match(md, /## 5\. 사람 블라인드 평가/);
});

test("generateReport formats markdown tables with spec 11 sections", () => {
  const rows = [
    {
      mode: "sol-luna-2", repeat: 0, verdict: "complete", status: "complete",
      tokens: { uncachedInputTokens: 1000, cacheReadTokens: 5000, cacheWriteTokens: 200, outputTokens: 800, reasoningTokens: 400 },
      reportedCostUsd: 0.22, estimatedCostUsd: 0.25, generationMs: 120000, endToEndMs: 125000,
      sourceCoverage: 0.95, questionsAnswerable: 5, printDefects: 1, criticalErrors: [], humanScores: null,
    },
  ];
  const md = generateReport(rows, { margin: 3 });
  assert.match(md, /## 1\. 종합 결과 요약/);
  assert.match(md, /## 2\. 토큰 및 프롬프트 캐시 분석/);
  assert.match(md, /## 3\. 구조 및 품질 메트릭/);
  assert.match(md, /## 4\. 치명 결함 내역/);
  assert.match(md, /## 5\. 사람 블라인드 평가/);
  assert.match(md, /`sol-luna-2`/);
});
