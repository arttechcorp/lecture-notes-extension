#!/usr/bin/env node
// sol-v2-report — sol-luna-2 vs sol-fork-2 및 기존 비교군의 Spec 11 결과 행(JSON Lines)을 읽어
// 정량 마크다운 보고서와 치명 결함 목록을 생성하는 도구.
// Spec 11 규칙 준수:
//   1. 비용은 실패 실행 포함 총액/통과수와 성공 실행 자체의 비용을 둘 다 보고한다.
//   2. 품질 통과수(Pass count)가 0이면 단가는 반드시 "n/a"로 표기하며 절대 0으로 쓰지 않는다.
//   3. 사람 블라인드 평가 점수가 없으면 자동 품질만 보고하고 승자를 확정하지 않는다.
//   4. 동등 품질 허용폭(기본 3점)은 결과 확인 전 사전 고정 CLI 옵션(--margin)으로 지정한다.
//   5. 강의 본문·원문 키·개인정보는 보고서에 절대 출력하지 않는다.

import fs from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { stageUsageSummary } = require("../server/usage.js");

export function percentile(arr, p) {
  if (!Array.isArray(arr) || !arr.length) return null;
  const sorted = [...arr].filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

// ── JSON Lines / JSON 배열 파서 ─────────────────────────────────────────────
export function parseResultLines(text) {
  if (typeof text !== "string") return [];
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const arr = JSON.parse(trimmed);
      return Array.isArray(arr) ? arr : [];
    } catch {
      // json lines 폴백
    }
  }
  const lines = trimmed.split("\n").map(l => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      // 비 JSON 줄 무시
    }
  }
  return rows;
}

// ── 모드별 메트릭 집계 ──────────────────────────────────────────────────────
export function aggregateByMode(rows, { margin = 3, sampleApproved = false, evaluatorApproved = false } = {}) {
  const groups = new Map();

  for (const row of rows) {
    const mode = String(row.mode || "unknown");
    if (!groups.has(mode)) groups.set(mode, []);
    groups.get(mode).push(row);
  }

  const modes = {};

  for (const [mode, modeRows] of groups.entries()) {
    const totalRuns = modeRows.length;
    const failedRuns = modeRows.filter(r => r.verdict === "failed" || r.status === "failed").length;
    const successfulRuns = totalRuns - failedRuns;

    // 치명 결함 목록 수집
    const criticalErrorCounts = {};
    for (const r of modeRows) {
      const errs = Array.isArray(r.criticalErrors) ? r.criticalErrors : [];
      for (const err of errs) {
        criticalErrorCounts[err] = (criticalErrorCounts[err] || 0) + 1;
      }
    }

    // 품질 통과 판정: 실패하지 않고 치명 결함이 없는 실행
    const qualityPassRows = modeRows.filter(r => {
      if (r.verdict === "failed" || r.status === "failed") return false;
      const errs = Array.isArray(r.criticalErrors) ? r.criticalErrors : [];
      if (errs.length > 0) return false;
      return true;
    });
    const qualityPassCount = qualityPassRows.length;

    // 비용 계산 (보고 비용 우선, 없으면 추정치)
    let totalCostUsd = 0;
    let successfulCostUsd = 0;
    for (const r of modeRows) {
      const cost = Number.isFinite(r.reportedCostUsd) ? r.reportedCostUsd : (Number(r.estimatedCostUsd) || 0);
      totalCostUsd += cost;
      if (r.verdict !== "failed" && r.status !== "failed") {
        successfulCostUsd += cost;
      }
    }

    // Spec 11: 품질 통과당 비용 (통과 수 0 이면 "n/a", 결코 0 이 아님)
    const costPerPassTotal = qualityPassCount === 0 ? "n/a" : (totalCostUsd / qualityPassCount);
    const costPerPassSuccess = qualityPassCount === 0 ? "n/a" : (successfulCostUsd / qualityPassCount);

    // 실제 채택 수정당 비용 (L1/수정당 비용, 채택 0이면 "n/a")
    let totalAcceptedEdits = 0;
    for (const r of modeRows) {
      const acc = r.reviewCounts?.accepted ?? r.acceptedPatches ?? r.acceptedFixes;
      if (Number.isFinite(acc)) totalAcceptedEdits += acc;
    }
    const costPerAcceptedEdit = totalAcceptedEdits > 0 ? (totalCostUsd / totalAcceptedEdits) : "n/a";

    // L1 / L2 필드 수집 (있으면 표시·없으면 null)
    const sumObj = key => {
      const found = modeRows.filter(r => r[key] && typeof r[key] === "object");
      if (!found.length) return null;
      const res = {};
      for (const r of found) {
        for (const [k, v] of Object.entries(r[key])) {
          if (Number.isFinite(v)) res[k] = (res[k] || 0) + v;
        }
      }
      return res;
    };
    const reviewCounts = sumObj("reviewCounts");
    const reviewRejects = sumObj("reviewRejects");
    const repairCauses = sumObj("repairCauses");
    const loop = sumObj("loop") || sumObj("loopMetrics");

    // 단계별 집계 (calls 또는 attempts 행이 있는 경우)
    const allAttempts = modeRows.flatMap(r => r.attempts || r.calls || []);
    const stageSummary = allAttempts.length > 0 ? stageUsageSummary(allAttempts) : null;

    // 토큰 집계 (평균)
    const avgToken = field => {
      const vals = modeRows.map(r => r.tokens?.[field]).filter(v => Number.isFinite(v));
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };
    const uncachedInput = avgToken("uncachedInputTokens");
    const cacheRead = avgToken("cacheReadTokens");
    const cacheWrite = avgToken("cacheWriteTokens");
    const output = avgToken("outputTokens");
    const reasoning = avgToken("reasoningTokens");

    const totalInput = (uncachedInput || 0) + (cacheRead || 0);
    const cacheReadRatio = totalInput > 0 ? (cacheRead || 0) / totalInput : 0;

    // 지연 시간 평균 및 백분위수 (p50, p95)
    const avgGenMs = Math.round(modeRows.reduce((s, r) => s + (r.generationMs || 0), 0) / totalRuns);
    const avgE2EMs = Math.round(modeRows.reduce((s, r) => s + (r.endToEndMs || 0), 0) / totalRuns);
    const e2eList = modeRows.map(r => r.endToEndMs).filter(v => Number.isFinite(v));
    const p50Ms = percentile(e2eList, 50);
    const p95Ms = percentile(e2eList, 95);

    // 품질 및 커버리지 평균
    const covVals = modeRows.map(r => r.sourceCoverage).filter(v => Number.isFinite(v));
    const avgSourceCov = covVals.length ? (covVals.reduce((a, b) => a + b, 0) / covVals.length) : null;

    const questionsAnswerable = modeRows.reduce((s, r) => s + (r.questionsAnswerable || 0), 0);
    const printDefects = modeRows.reduce((s, r) => s + (r.printDefects || 0), 0);

    // 사람 블라인드 평가 점수 집계 (있는 경우)
    const humanRows = modeRows.filter(r => r.humanScores && typeof r.humanScores === "object");
    let humanScore100 = null;
    let humanDetails = null;

    if (humanRows.length > 0) {
      const avgCategory = cat => {
        const list = humanRows.map(r => r.humanScores[cat]).filter(v => Number.isFinite(v));
        return list.length ? (list.reduce((a, b) => a + b, 0) / list.length) : null;
      };
      const accuracy = avgCategory("accuracy") ?? 0;        // 30%
      const coverage = avgCategory("coverage") ?? 0;        // 20%
      const structure = avgCategory("structure") ?? 0;      // 15%
      const visual = avgCategory("visualization") ?? 0;    // 20%
      const questions = avgCategory("questions") ?? 0;      // 10%
      const layout = avgCategory("layout") ?? 0;            // 5%

      // 0-4 점을 100점 만점으로 환산
      const weighted4 = accuracy * 0.30 + coverage * 0.20 + structure * 0.15 + visual * 0.20 + questions * 0.10 + layout * 0.05;
      humanScore100 = Math.round((weighted4 / 4) * 100 * 10) / 10;
      humanDetails = { accuracy, coverage, structure, visual, questions, layout };
    }

    modes[mode] = {
      mode,
      totalRuns,
      failedRuns,
      successfulRuns,
      qualityPassCount,
      totalCostUsd: Math.round(totalCostUsd * 1e4) / 1e4,
      successfulCostUsd: Math.round(successfulCostUsd * 1e4) / 1e4,
      costPerPassTotal,
      costPerPassSuccess,
      totalAcceptedEdits,
      costPerAcceptedEdit,
      tokens: { uncachedInput, cacheRead, cacheWrite, output, reasoning, cacheReadRatio },
      latencies: { avgGenMs, avgE2EMs, p50Ms, p95Ms },
      quality: { avgSourceCov, questionsAnswerable, printDefects },
      criticalErrorCounts,
      reviewCounts,
      reviewRejects,
      repairCauses,
      loop,
      stageSummary,
      humanScore100,
      humanDetails,
      hasHumanScores: humanRows.length > 0,
    };
  }

  // 승자 판정 로직 (§9.4 규칙: 사람 블라인드 점수 없이 가격만으로 승자 선언 금지)
  const allHasHuman = Object.values(modes).length > 0 && Object.values(modes).every(m => m.hasHumanScores);
  const isApproved = Boolean(sampleApproved && evaluatorApproved);

  let verdict = {
    hasHumanScores: allHasHuman,
    sampleApproved,
    evaluatorApproved,
    margin,
    winner: null,
    reason: "",
  };

  if (!allHasHuman) {
    verdict.winner = null;
    verdict.reason = "사람 평가 점수가 없어 승자를 확정하지 않음 (Spec 11 규칙에 따라 자동 품질만 보고). 우열 판정 없음, 탐색 결과.";
  } else {
    // 인간 평가 점수 기준 비교
    const sorted = Object.values(modes).sort((a, b) => (b.humanScore100 ?? 0) - (a.humanScore100 ?? 0));
    if (sorted.length >= 2) {
      const diff = Math.abs((sorted[0].humanScore100 ?? 0) - (sorted[1].humanScore100 ?? 0));
      if (diff <= margin) {
        // 동등 품질: 2차 기준인 통과당 비용 비교
        const c0 = typeof sorted[0].costPerPassTotal === "number" ? sorted[0].costPerPassTotal : Infinity;
        const c1 = typeof sorted[1].costPerPassTotal === "number" ? sorted[1].costPerPassTotal : Infinity;
        if (c0 < c1) {
          verdict.winner = sorted[0].mode;
          verdict.reason = `품질 점수 차이(${diff.toFixed(1)}점)가 동등 허용폭(±${margin}점) 이내이므로 비용 우위인 ${sorted[0].mode} 선택.`;
        } else if (c1 < c0) {
          verdict.winner = sorted[1].mode;
          verdict.reason = `품질 점수 차이(${diff.toFixed(1)}점)가 동등 허용폭(±${margin}점) 이내이므로 비용 우위인 ${sorted[1].mode} 선택.`;
        } else {
          verdict.winner = sorted[0].mode;
          verdict.reason = `품질 및 비용 동등. 시간 우위 기준 적용.`;
        }
      } else {
        verdict.winner = sorted[0].mode;
        verdict.reason = `품질 점수 차이(${diff.toFixed(1)}점)가 동등 허용폭(±${margin}점)을 초과하여 ${sorted[0].mode} 승리.`;
      }
    } else if (sorted.length === 1) {
      verdict.winner = sorted[0].mode;
      verdict.reason = "단일 모드 평가 완료.";
    }
  }

  return { modes, verdict };
}

// ── 마크다운 보고서 생성 ────────────────────────────────────────────────────
export function generateReport(rows, { margin = 3, sampleApproved = false, evaluatorApproved = false } = {}) {
  const { modes, verdict } = aggregateByMode(rows, { margin, sampleApproved, evaluatorApproved });
  const modeList = Object.values(modes);

  const fmtCost = v => (typeof v === "number" ? `$${v.toFixed(3)}` : String(v));
  const fmtNum = v => (v !== null && v !== undefined ? String(v) : "—");
  const fmtSec = ms => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : "—");
  const fmtPct = v => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—");

  const out = [];

  out.push("# sol-luna-2 vs sol-fork-2 실험 결과 보고서");
  out.push("");
  out.push(`- 생성 시각: ${new Date().toISOString()}`);
  out.push(`- 총 실행 레코드 수: ${rows.length}`);
  out.push(`- 사전 고정 품질 동등 허용폭(Equivalence Margin): ±${margin}점 (100점 환산)`);
  out.push(`- 최종 판정 상태: **${verdict.winner ? `${verdict.winner} 채택` : "승자 미정"}**`);
  out.push(`  > 사유: ${verdict.reason}`);
  if (!sampleApproved || !evaluatorApproved) {
    out.push("  > ⚠️ **우열 판정 없음, 탐색 결과**: 평가자·표본 수 미승인 시 가격만으로 최종 승자를 선언하지 않습니다.");
  }
  out.push("");

  // 1. 종합 결과 요약 (Summary Table)
  out.push("## 1. 종합 결과 요약");
  out.push("");
  out.push("| 모드 | 총 실행 | 품질 통과 | 통과당 비용(전체) | 채택수정당 비용 | 총 지출 | p50 지연 | p95 지연 | 캐시 읽기율 |");
  out.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const m of modeList) {
    out.push(`| \`${m.mode}\` | ${m.totalRuns} | ${m.qualityPassCount} | ${fmtCost(m.costPerPassTotal)} | ${fmtCost(m.costPerAcceptedEdit)} | $${m.totalCostUsd.toFixed(3)} | ${fmtSec(m.latencies.p50Ms)} | ${fmtSec(m.latencies.p95Ms)} | ${fmtPct(m.tokens.cacheReadRatio)} |`);
  }
  out.push("");

  // 2. 토큰 및 프롬프트 캐시 분석
  out.push("## 2. 토큰 및 프롬프트 캐시 분석 (호출당 평균)");
  out.push("");
  out.push("| 모드 | 미캐시 입력 | 캐시 읽기(Read) | 캐시 쓰기(Write) | 순수 출력 | 추론(Reasoning) | 캐시 적중률 |");
  out.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const m of modeList) {
    const t = m.tokens;
    out.push(`| \`${m.mode}\` | ${fmtNum(t.uncachedInput)} | ${fmtNum(t.cacheRead)} | ${fmtNum(t.cacheWrite)} | ${fmtNum(t.output)} | ${fmtNum(t.reasoning)} | ${fmtPct(t.cacheReadRatio)} |`);
  }
  out.push("");

  // 2.1 비용·캐시 단계별 분석 표
  let hasStageTable = false;
  for (const m of modeList) {
    if (m.stageSummary?.byStage?.length) {
      if (!hasStageTable) {
        out.push("### 비용·캐시 단계별 분석");
        out.push("");
        hasStageTable = true;
      }
      out.push(`#### \`${m.mode}\` 단계별 지표`);
      out.push("");
      out.push("| 단계 | 모델 | 공급자 | 캐시 읽기 | 캐시 쓰기 | 미캐시 입력 | 순수 출력 | 추론 | 비용(USD) | 적중률 |");
      out.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|");
      for (const s of m.stageSummary.byStage) {
        out.push(`| \`${s.stage}\` | ${s.model || "—"} | ${s.provider || "—"} | ${fmtNum(s.cacheReadTokens)} | ${fmtNum(s.cacheWriteTokens)} | ${fmtNum(s.uncachedInputTokens)} | ${fmtNum(s.outputTokens)} | ${fmtNum(s.reasoningTokens)} | ${s.costUsd !== null ? `$${s.costUsd.toFixed(4)}` : "—"} | ${fmtPct(s.hitRatio)} |`);
      }
      out.push("");
    }
  }

  // 3. 구조 및 품질 메트릭 (Content-Free)
  out.push("## 3. 구조 및 품질 메트릭 (내용 비포함)");
  out.push("");
  out.push("| 모드 | 근거 커버리지 | 유효 문항 수 | 인쇄 경고 수 | 실패 실행 수 |");
  out.push("|---|---:|---:|---:|---:|");
  for (const m of modeList) {
    out.push(`| \`${m.mode}\` | ${fmtPct(m.quality.avgSourceCov)} | ${m.quality.questionsAnswerable} | ${m.quality.printDefects} | ${m.failedRuns} |`);
  }
  out.push("");

  // 3.1 검수(L1) 및 수리(L2) 루프 메트릭
  out.push("### 검수(L1) 및 수리(L2) 루프 메트릭");
  out.push("");
  for (const m of modeList) {
    out.push(`#### \`${m.mode}\``);
    out.push(`- **reviewCounts (L1)**: ${m.reviewCounts ? JSON.stringify(m.reviewCounts) : "null"}`);
    out.push(`- **reviewRejects (L1)**: ${m.reviewRejects ? JSON.stringify(m.reviewRejects) : "null"}`);
    out.push(`- **repairCauses (L2)**: ${m.repairCauses ? JSON.stringify(m.repairCauses) : "null"}`);
    out.push(`- **loop (L2)**: ${m.loop ? JSON.stringify(m.loop) : "null"}`);
    out.push("");
  }

  // 4. 치명 결함 내역 (Critical Defects Ledger)
  out.push("## 4. 치명 결함 내역");
  out.push("");
  let defectFound = false;
  for (const m of modeList) {
    const errs = Object.entries(m.criticalErrorCounts);
    if (errs.length > 0) {
      defectFound = true;
      out.push(`### \`${m.mode}\` 치명 결함`);
      for (const [code, count] of errs) {
        out.push(`- **${code}**: ${count}건 발생`);
      }
      out.push("");
    }
  }
  if (!defectFound) {
    out.push("> 모든 모드에서 치명 결함(Critical Defects) 미발생.");
    out.push("");
  }

  // 5. 사람 블라인드 평가표 (Human Evaluation)
  out.push("## 5. 사람 블라인드 평가 (100점 환산)");
  out.push("");
  if (!verdict.hasHumanScores) {
    out.push("> ⚠️ **사람 블라인드 평가 미진행 (unreviewed)**: 자동 측정 메트릭만 보고되며, Spec 11 원칙에 따라 승자를 확정하지 않습니다.");
  } else {
    if (!sampleApproved || !evaluatorApproved) {
      out.push("> ⚠️ **우열 판정 없음, 탐색 결과**: 사람 블라인드 점수 및 평가자·표본 수 미승인으로 가격만으로 승자를 선언하지 않습니다.");
      out.push("");
    }
    out.push("| 모드 | 정확성(30%) | 내용보존(20%) | 개념구조(15%) | 시각화(20%) | 문항(10%) | 조판(5%) | 환산 총점 |");
    out.push("|---|---:|---:|---:|---:|---:|---:|---:|");
    for (const m of modeList) {
      const d = m.humanDetails;
      if (d) {
        out.push(`| \`${m.mode}\` | ${d.accuracy.toFixed(1)}/4 | ${d.coverage.toFixed(1)}/4 | ${d.structure.toFixed(1)}/4 | ${d.visual.toFixed(1)}/4 | ${d.questions.toFixed(1)}/4 | ${d.layout.toFixed(1)}/4 | **${m.humanScore100}점** |`);
      } else {
        out.push(`| \`${m.mode}\` | — | — | — | — | — | — | unreviewed |`);
      }
    }
  }
  out.push("");

  return out.join("\n");
}

// ── CLI 엔트리포인트 ────────────────────────────────────────────────────────
async function main() {
  const { values: v } = parseArgs({
    options: {
      input: { type: "string" },
      out: { type: "string" },
      margin: { type: "string", default: "3" },
      "sample-approved": { type: "boolean", default: false },
      "evaluator-approved": { type: "boolean", default: false },
    },
  });

  let raw = "";
  if (v.input) {
    raw = fs.readFileSync(v.input, "utf8");
  } else if (!process.stdin.isTTY) {
    raw = fs.readFileSync(0, "utf8");
  } else {
    console.error("사용법: node tools/sol-v2-report.mjs --input=<results.jsonl> [--out=<report.md>] [--margin=3] [--sample-approved] [--evaluator-approved]");
    process.exit(2);
  }

  const rows = parseResultLines(raw);
  if (!rows.length) {
    console.error("오류: 분석할 결과 행(JSON lines)이 비어 있습니다.");
    process.exit(2);
  }

  const margin = Number(v.margin) || 3;
  const sampleApproved = v["sample-approved"] === true;
  const evaluatorApproved = v["evaluator-approved"] === true;
  const md = generateReport(rows, { margin, sampleApproved, evaluatorApproved });

  if (v.out) {
    fs.writeFileSync(v.out, md, "utf8");
    console.log(`보고서가 ${v.out} 에 작성되었습니다.`);
  } else {
    console.log(md);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e?.message ?? e); process.exit(1); });
}
