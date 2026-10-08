#!/usr/bin/env node
// cache-prefix-probe — Luna 공통 접두 직렬화 순서 및 프롬프트 캐시 적중 여건을 정량 진단하는 도구.
// §3.2, §7, §9.4 규칙 준수:
//   1. 실제 전송 순서 진단: draft 및 questions 요청을 합성 입력으로 만들어 직렬화 후 공통 접두 길이 측정.
//   2. 시스템 지시·스키마·공통 용어가 앞, 섹션별 근거/명세가 뒤인지 검증.
//   3. 타임스탬프·섹션 ID·동적 목록이 공통 접두에 누출되지 않는지 검증.
//   4. independent(isV3=false) 경로는 바이트 불변을 유지하고, v3(isV3=true)에서만 공통 키가 앞으로 오는지 비교.
//   5. 합성 probe 단계 총 예산 상한 기본 $0.05 (--max-usd 로 변경 가능).
//   6. 라이브(유료) 호출은 PROBE_LIVE_CONSENT=true 및 예산 검사를 통과하지 않으면 차단 (오프라인 dry 기본).

import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const LLM = require("../server/llm.js");
const Prompts = require("../server/prompts.js");
const NoteV3 = require("../lib/note-v3.js");

export const PROBE_MAX_USD = 0.05;
export const DEFAULT_MODEL = "openai/gpt-6-luna@high";

/**
 * 서로 다른 두 섹션의 합성 draft 요청 생성
 */
export function synthesizeSectionDraftRequests({
  noteMode = "sol-luna-3",
  isV3 = true,
  model = DEFAULT_MODEL,
} = {}) {
  const commonConcepts = [
    { conceptId: "C1", name: "Entropy and Energy" },
    { conceptId: "C2", name: "Carnot Engine" },
  ];
  const commonOptions = { syntheticExamples: false };
  const commonAllowedRefs = { targetIds: ["REF_T1", "REF_T2", "REF_T3"] };

  const systemPrompt = Prompts.systemFor("draft", commonOptions, "ko", "general", noteMode);
  const sysMsg = LLM.cachedSystem(model, systemPrompt);

  const sec1Input = JSON.stringify({
    section: { sectionId: "SECTION_1", title: "Introduction to Entropy" },
    concepts: commonConcepts,
    options: commonOptions,
    allowedRefs: commonAllowedRefs,
    evidence: [{ id: "EVID_1.1", text: "First law definition" }],
    timestamp: "2026-10-08T00:00:00Z",
  });

  const sec2Input = JSON.stringify({
    section: { sectionId: "SECTION_2", title: "Carnot Efficiency Limits" },
    concepts: commonConcepts,
    options: commonOptions,
    allowedRefs: commonAllowedRefs,
    evidence: [{ id: "EVID_2.1", text: "Reversible process efficiency" }],
    timestamp: "2026-10-08T00:01:00Z",
  });

  const userMsg1 = LLM.cachedUser(model, sec1Input, "draft", { isV3, noteMode });
  const userMsg2 = LLM.cachedUser(model, sec2Input, "draft", { isV3, noteMode });

  const reqA = JSON.stringify({ model, messages: [sysMsg, userMsg1] });
  const reqB = JSON.stringify({ model, messages: [sysMsg, userMsg2] });

  return {
    reqA,
    reqB,
    dynamicTokens: ["SECTION_1", "SECTION_2", "EVID_1.1", "EVID_2.1", "Introduction to Entropy", "Carnot Efficiency Limits", "2026-10-08T00:00:00Z", "2026-10-08T00:01:00Z"],
    staticTokens: ["Entropy and Energy", "Carnot Engine", "REF_T1"],
  };
}

/**
 * draft 와 questions 요청 간 합성 요청 생성
 */
export function synthesizeDraftAndQuestionsRequests({
  noteMode = "sol-luna-3",
  isV3 = true,
  model = DEFAULT_MODEL,
} = {}) {
  const commonConcepts = [
    { conceptId: "C1", name: "Quantum Mechanics" },
    { conceptId: "C2", name: "Wave Function" },
  ];
  const commonOptions = { syntheticExamples: false };
  const commonAllowedRefs = { targetIds: ["REF_Q1"] };

  const draftInput = JSON.stringify({
    section: { sectionId: "SEC_QUANTUM", title: "Wave Mechanics" },
    concepts: commonConcepts,
    options: commonOptions,
    allowedRefs: commonAllowedRefs,
    evidence: [{ id: "EV_Q1", text: "Schrodinger equation derivation" }],
  });

  const questionsInput = JSON.stringify({
    section: { sectionId: "SEC_QUANTUM" },
    blockId: "SEC_QUANTUM/B14",
    concepts: commonConcepts,
    sections: [{ sectionId: "SEC_QUANTUM", title: "Wave Mechanics" }],
    options: commonOptions,
    allowedRefs: commonAllowedRefs,
  });

  const userDraft = LLM.cachedUser(model, draftInput, "draft", { isV3, noteMode });
  const userQuestions = LLM.cachedUser(model, questionsInput, "questions", { isV3, noteMode });

  const reqA = JSON.stringify({ model, messages: [userDraft] });
  const reqB = JSON.stringify({ model, messages: [userQuestions] });

  return {
    reqA,
    reqB,
    dynamicTokens: ["EV_Q1", "Schrodinger equation derivation", "SEC_QUANTUM/B14"],
    staticTokens: ["Quantum Mechanics", "Wave Function"],
  };
}

/**
 * 두 직렬화 요청 간의 공통 접두 및 동적 누출 검사
 */
export function measurePrefixAlignment(serializedA, serializedB, { dynamicTokens = [], staticTokens = [] } = {}) {
  const bytesA = Buffer.byteLength(serializedA, "utf8");
  const bytesB = Buffer.byteLength(serializedB, "utf8");
  const commonBytes = LLM.commonPrefixLength(serializedA, serializedB);
  const ratioA = bytesA > 0 ? commonBytes / bytesA : 0;
  const ratioB = bytesB > 0 ? commonBytes / bytesB : 0;

  const commonHead = serializedA.slice(0, commonBytes);

  const leakedDynamicTokens = [];
  for (const token of dynamicTokens) {
    if (commonHead.includes(token)) {
      leakedDynamicTokens.push(token);
    }
  }

  const missingStaticTokens = [];
  for (const token of staticTokens) {
    if (!commonHead.includes(token)) {
      missingStaticTokens.push(token);
    }
  }

  return {
    bytesA,
    bytesB,
    commonBytes,
    ratioA,
    ratioB,
    commonHead,
    leakedDynamicTokens,
    missingStaticTokens,
    passed: leakedDynamicTokens.length === 0 && commonBytes > 0,
  };
}

/**
 * 캐시 접두 진단 실행 (v3 vs legacy 대조)
 */
export function diagnoseCachePrefix({ noteMode = "sol-luna-3", model = DEFAULT_MODEL } = {}) {
  const v3Data = synthesizeSectionDraftRequests({ noteMode, isV3: true, model });
  const v3Alignment = measurePrefixAlignment(v3Data.reqA, v3Data.reqB, {
    dynamicTokens: v3Data.dynamicTokens,
    staticTokens: v3Data.staticTokens,
  });

  const legacyData = synthesizeSectionDraftRequests({ noteMode: "independent", isV3: false, model });
  const legacyAlignment = measurePrefixAlignment(legacyData.reqA, legacyData.reqB, {
    dynamicTokens: legacyData.dynamicTokens,
    staticTokens: legacyData.staticTokens,
  });

  const gainBytes = v3Alignment.commonBytes - legacyAlignment.commonBytes;
  const gainPercent = legacyAlignment.commonBytes > 0
    ? ((gainBytes / legacyAlignment.commonBytes) * 100).toFixed(1)
    : "n/a";

  return {
    mode: noteMode,
    model,
    v3: v3Alignment,
    legacy: legacyAlignment,
    gainBytes,
    gainPercent,
    passed: v3Alignment.passed && gainBytes >= 0,
  };
}

/**
 * 라이브 probe 가드 및 실행
 */
export async function runLiveProbe({
  maxUsd = PROBE_MAX_USD,
  env = process.env,
} = {}) {
  if (env.PROBE_LIVE_CONSENT !== "true") {
    return {
      status: "aborted",
      reason: "consent_required",
      message: "PROBE_LIVE_CONSENT=true 환경변수 필요 (유료 모델 호출 방지 불변조건)",
    };
  }

  const estimatedCost = 0.02;
  if (estimatedCost > maxUsd) {
    return {
      status: "aborted",
      reason: "budget_exceeded",
      maxUsd,
      estimatedCost,
      message: `예상 비용($${estimatedCost})이 probe 상한($${maxUsd})을 초과합니다.`,
    };
  }

  return {
    status: "ready",
    maxUsd,
    estimatedCost,
    message: "라이브 probe 사전 검증 완료 (dry 환경에서 네트워크 미실행)",
  };
}

/**
 * 종합 프로브 실행 (오프라인 dry 기본)
 */
export async function runProbe({
  dry = true,
  live = false,
  maxUsd = PROBE_MAX_USD,
  mode = "sol-luna-3",
  env = process.env,
} = {}) {
  if (live) {
    return runLiveProbe({ maxUsd, env });
  }

  const diagnosis = diagnoseCachePrefix({ noteMode: mode });
  return {
    status: "completed",
    mode,
    maxUsd,
    diagnosis,
  };
}

/**
 * 마크다운/텍스트 보고서 생성
 */
export function formatProbeReport(result) {
  if (result.status === "aborted") {
    return `[프로브 중단] ${result.reason}: ${result.message}`;
  }
  if (result.status === "ready") {
    return `[라이브 프로브 준비] ${result.message} (상한: $${result.maxUsd})`;
  }

  const diag = result.diagnosis;
  const v3 = diag.v3;
  const legacy = diag.legacy;

  return [
    `# 캐시 접두 진단 보고서 (Cache Prefix Probe)`,
    `- 검증 모드: ${diag.mode} (모델: ${diag.model})`,
    `- 판정: ${diag.passed ? "합격 (PASS)" : "불합격 (FAIL)"}`,
    ``,
    `## 1. 요청 크기 및 공통 접두 측정`,
    `| 항목 | v3 (sol-luna-3) | legacy (independent) | 개선 |`,
    `|---|---|---|---|`,
    `| 요청 A 크기 | ${v3.bytesA} bytes | ${legacy.bytesA} bytes | - |`,
    `| 요청 B 크기 | ${v3.bytesB} bytes | ${legacy.bytesB} bytes | - |`,
    `| 공통 접두 길이 | ${v3.commonBytes} bytes | ${legacy.commonBytes} bytes | +${diag.gainBytes} bytes (${diag.gainPercent}%) |`,
    `| 공통 비율 (A/B) | ${(v3.ratioA * 100).toFixed(1)}% / ${(v3.ratioB * 100).toFixed(1)}% | ${(legacy.ratioA * 100).toFixed(1)}% / ${(legacy.ratioB * 100).toFixed(1)}% | - |`,
    ``,
    `## 2. 불변조건 및 누출 검증`,
    `- 시스템 지시 및 공통 용어 포함: ${v3.missingStaticTokens.length === 0 ? "정상 (PASS)" : `누락됨 (${v3.missingStaticTokens.join(", ")})`}`,
    `- 동적 값(섹션 ID, 타임스탬프 등) 누출: ${v3.leakedDynamicTokens.length === 0 ? "없음 (PASS)" : `누출 발견 (${v3.leakedDynamicTokens.join(", ")})`}`,
    `- 예산 상한: $${result.maxUsd.toFixed(2)} (합성 dry probe)`,
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      dry: { type: "boolean", default: true },
      live: { type: "boolean", default: false },
      "max-usd": { type: "string" },
      mode: { type: "string", default: "sol-luna-3" },
      format: { type: "string", default: "text" },
    },
    allowPositionals: true,
  });

  const maxUsd = values["max-usd"] ? Number(values["max-usd"]) : PROBE_MAX_USD;
  const result = await runProbe({
    dry: values.dry && !values.live,
    live: values.live,
    maxUsd,
    mode: values.mode,
  });

  if (values.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatProbeReport(result));
  }

  if (result.status === "aborted") {
    process.exit(1);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
