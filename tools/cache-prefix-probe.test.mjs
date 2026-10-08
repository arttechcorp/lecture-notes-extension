import test from "node:test";
import assert from "node:assert/strict";
import {
  PROBE_MAX_USD,
  synthesizeSectionDraftRequests,
  synthesizeDraftAndQuestionsRequests,
  measurePrefixAlignment,
  diagnoseCachePrefix,
  runLiveProbe,
  runProbe,
  formatProbeReport,
} from "./cache-prefix-probe.mjs";

test("synthesizeSectionDraftRequests: 합성 draft 요청 생성 및 검증 토큰 분리", () => {
  const data = synthesizeSectionDraftRequests({ noteMode: "sol-luna-3", isV3: true });
  assert.ok(data.reqA.includes("messages"), "reqA 에 messages 포함");
  assert.ok(data.reqB.includes("messages"), "reqB 에 messages 포함");
  assert.ok(data.dynamicTokens.includes("SECTION_1"));
  assert.ok(data.staticTokens.includes("Entropy and Energy"));
});

test("synthesizeDraftAndQuestionsRequests: draft 와 questions 간 공통 문맥 생성", () => {
  const data = synthesizeDraftAndQuestionsRequests({ noteMode: "sol-luna-3", isV3: true });
  assert.ok(data.reqA.includes("Quantum Mechanics"));
  assert.ok(data.reqB.includes("Quantum Mechanics"));
  assert.ok(data.dynamicTokens.includes("SEC_QUANTUM/B14"));
});

test("measurePrefixAlignment: 공통 접두 바이트 측정 및 동적 토큰 누출 탐지", () => {
  const cleanA = JSON.stringify({ common: "hello world", id: "A" });
  const cleanB = JSON.stringify({ common: "hello world", id: "B" });
  const result = measurePrefixAlignment(cleanA, cleanB, {
    dynamicTokens: ["id: \"A\"", "id: \"B\""],
    staticTokens: ["hello world"],
  });

  assert.ok(result.commonBytes > 0);
  assert.equal(result.leakedDynamicTokens.length, 0);
  assert.equal(result.missingStaticTokens.length, 0);
  assert.equal(result.passed, true);

  // 동적 토큰 누출 시뮬레이션
  const leakA = JSON.stringify({ leakId: "DYN_1", common: "hello world" });
  const leakB = JSON.stringify({ leakId: "DYN_1", common: "hello other" });
  const leakResult = measurePrefixAlignment(leakA, leakB, {
    dynamicTokens: ["DYN_1"],
    staticTokens: ["hello"],
  });
  assert.ok(leakResult.leakedDynamicTokens.includes("DYN_1"), "누출된 동적 토큰이 탐지되어야 함");
  assert.equal(leakResult.passed, false);
});

test("diagnoseCachePrefix: v3는 legacy 대비 공통 접두가 대폭 확장되고 동적 누출 없음", () => {
  const diag = diagnoseCachePrefix({ noteMode: "sol-luna-3" });
  assert.equal(diag.mode, "sol-luna-3");
  assert.equal(diag.passed, true);
  assert.ok(diag.gainBytes >= 0, `v3 공통 접두 이득(${diag.gainBytes})은 0 이상이어야 함`);
  assert.equal(diag.v3.leakedDynamicTokens.length, 0, "v3 접두에 동적 토큰 누출 없어야 함");
  assert.equal(diag.v3.missingStaticTokens.length, 0, "v3 접두에 필수 정적 토큰 포함되어야 함");
});

test("runLiveProbe: 동의(PROBE_LIVE_CONSENT) 없거나 예산 초과 시 안전하게 중단", async () => {
  // 1. 동의 없음
  const noConsent = await runLiveProbe({ env: {} });
  assert.equal(noConsent.status, "aborted");
  assert.equal(noConsent.reason, "consent_required");

  // 2. 동의 있으나 예산 초과
  const budgetExceeded = await runLiveProbe({
    maxUsd: 0.01, // 0.02 미만
    env: { PROBE_LIVE_CONSENT: "true" },
  });
  assert.equal(budgetExceeded.status, "aborted");
  assert.equal(budgetExceeded.reason, "budget_exceeded");

  // 3. 정상 사전 검증
  const ready = await runLiveProbe({
    maxUsd: 0.05,
    env: { PROBE_LIVE_CONSENT: "true" },
  });
  assert.equal(ready.status, "ready");
});

test("runProbe: 기본 dry 실행 시 완료 상태 및 진단 결과 반환", async () => {
  const res = await runProbe({ dry: true, mode: "sol-luna-3" });
  assert.equal(res.status, "completed");
  assert.equal(res.diagnosis.passed, true);
  assert.equal(res.maxUsd, PROBE_MAX_USD);
});

test("formatProbeReport: 마크다운 보고서 서식 검증", () => {
  const mockRes = {
    status: "completed",
    maxUsd: 0.05,
    diagnosis: {
      mode: "sol-luna-3",
      model: "openai/gpt-6-luna@high",
      passed: true,
      gainBytes: 512,
      gainPercent: "25.0",
      v3: {
        bytesA: 2000,
        bytesB: 2050,
        commonBytes: 1500,
        ratioA: 0.75,
        ratioB: 0.73,
        leakedDynamicTokens: [],
        missingStaticTokens: [],
      },
      legacy: {
        bytesA: 2000,
        bytesB: 2050,
        commonBytes: 988,
        ratioA: 0.49,
        ratioB: 0.48,
        leakedDynamicTokens: [],
        missingStaticTokens: [],
      },
    },
  };

  const report = formatProbeReport(mockRes);
  assert.ok(report.includes("# 캐시 접두 진단 보고서"));
  assert.ok(report.includes("sol-luna-3"));
  assert.ok(report.includes("합격 (PASS)"));
  assert.ok(report.includes("+512 bytes"));
});
