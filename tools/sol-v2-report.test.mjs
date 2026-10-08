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

test("sol-v2-report 신규 지표: 채택 수정당 비용, p50/p95 지연, L1/L2 지표 표시/null", () => {
  const rows = [
    {
      mode: "sol-luna-3", repeat: 0, verdict: "complete", status: "complete",
      reportedCostUsd: 0.30, endToEndMs: 10000,
      reviewCounts: { proposed: 10, queued: 8, executed: 6, accepted: 5 },
      reviewRejects: { target_missing: 1, no_change: 1 },
      repairCauses: { writer_null: 2, schema: 1 },
      loop: { attempts: 3, spentUsd: 0.05, successfulTargets: 2 },
      attempts: [
        { stage: "plan", model: "openai/gpt-6.1-sol", inputTokens: 1000, outputTokens: 200, costUsd: 0.02 },
        { stage: "draft", model: "openai/gpt-6-luna@high", inputTokens: 2000, outputTokens: 500, cachedInputTokens: 1500, costUsd: 0.01 },
      ],
    },
    {
      mode: "sol-luna-3", repeat: 1, verdict: "complete", status: "complete",
      reportedCostUsd: 0.20, endToEndMs: 20000,
      reviewCounts: { proposed: 5, queued: 5, executed: 5, accepted: 5 },
      // L2 필드 생략 (null 검증용)
    },
  ];

  const { modes } = aggregateByMode(rows);
  const m = modes["sol-luna-3"];

  // 총 비용: 0.50, 총 채택 수정: 10 -> 수정당 비용: 0.05
  assert.equal(m.totalAcceptedEdits, 10);
  assert.equal(m.costPerAcceptedEdit, 0.05);

  // 지연 시간: 10000ms, 20000ms -> p50=10000, p95=20000
  assert.equal(m.latencies.p50Ms, 10000);
  assert.equal(m.latencies.p95Ms, 20000);

  // L1 지표 합산 확인
  assert.deepEqual(m.reviewCounts, { proposed: 15, queued: 13, executed: 11, accepted: 10 });
  assert.deepEqual(m.reviewRejects, { target_missing: 1, no_change: 1 });

  // L2 지표: 있는 필드는 표시
  assert.deepEqual(m.repairCauses, { writer_null: 2, schema: 1 });
  assert.deepEqual(m.loop, { attempts: 3, spentUsd: 0.05, successfulTargets: 2 });

  // generateReport 포맷팅 검증
  const md = generateReport(rows, { margin: 3 });
  assert.match(md, /채택수정당 비용/);
  assert.match(md, /p50 지연/);
  assert.match(md, /p95 지연/);
  assert.match(md, /### 비용·캐시 단계별 분석/);
  assert.match(md, /reviewCounts \(L1\)/);
  assert.match(md, /repairCauses \(L2\)/);
  assert.match(md, /우열 판정 없음, 탐색 결과/);
});

test("sol-v2-report 신규 지표: 채택 수정이 0건이면 채택수정당 비용은 'n/a'", () => {
  const rows = [
    { mode: "sol-luna-3", repeat: 0, verdict: "complete", reportedCostUsd: 0.15, endToEndMs: 5000 },
  ];
  const { modes } = aggregateByMode(rows);
  const m = modes["sol-luna-3"];
  assert.equal(m.totalAcceptedEdits, 0);
  assert.equal(m.costPerAcceptedEdit, "n/a");
  assert.equal(m.reviewCounts, null);
  assert.equal(m.repairCauses, null);
  assert.equal(m.loop, null);
});
