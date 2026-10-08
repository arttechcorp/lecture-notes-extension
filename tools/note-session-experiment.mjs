#!/usr/bin/env node
// note-session-experiment — 같은 입력의 노트 생성을 여섯 호출 방식으로 실제 서비스 API에 돌려 비교하는
// 한정 실험 드라이버(docs/note-quality-review-2026-10-06/session-experiment-protocol.md).
//   independent   : 세션 봉투 없음. Sol 계획 + Luna High 작성 — 운영과 같은 독립 호출(기준군).
//   sol-session   : plan/write 요청에 noteSession {v:1,id,mode,history} 를 싣는다 — 서버가 같은
//                   Sol 대화에 이어 붙인다. history 는 제공자 응답 항목 그대로, 실행 메모리에만 둔다.
//   sol-luna-tool : 같은 봉투. 서버가 Sol 대화에 Luna High 작성 도구(function call)를 바인딩한다 —
//                   도구 루프는 서버 안에서 돌고 클라이언트는 최종 출력과 갱신된 history 만 받는다.
//   sol-fork      : 같은 봉투이지만 계획 호출만 history 를 채택한다 — 그 응답이 고정 접두 P 가 되어
//                   모든 쓰기 호출이 P 만 싣고 병렬로 나간다(쓰기 응답 history 는 절대 접두를 대체하지 않는다).
//   sol-luna-2    : Sol 계획({plan, editorialPlan, noteSession P}) → Luna High 독립 섹션 작성(draft, noteSession 없음) →
//                   Sol 통합 편집 검수(review, 접두 P) → Luna High 문항 작성(questions, noteSession 없음) →
//                   Sol 전역/복구(접두 P). writer=draft 경로 전용, link 대신 review 사용.
//   sol-luna-3    : sol-luna-2 와 같은 경로 — 개선 실험 옵션은 cfg.noteV3(deps.noteV3 → stages ctx.v3)로 내린다.
//   sol-fork-2    : 모든 단계(plan, draft, review, questions, global, repair)를 Sol 이 수행.
//                   계획 응답 P(고정 anchor 포함)를 고정 접두로 공유하며 매 호출 P + 자기 작업으로 실행.
// 제공자(OpenRouter)는 절대 직접 부르지 않는다 — 모든 모델 호출은 SERVICE_URL 서비스를 거친다.
// 모드는 input.models.noteMode 및 deps.noteMode 둘 다로 들어간다(운영 wiring 과 동일).
// 로컬 출력 캐시는 끈다: deps.promptVersions 를 넘기지 않으면 stages.js 가 단계·호출 캐시를 쓰지 않고,
// 실행마다 새 메모리 저장소를 쓴다 — 같은 접두의 재사용은 서버 프롬프트 캐시만 잰다.
// 대체 모델(models.writeAlt)은 켜지 않고 연쇄 세션 모드(sol-session·sol-luna-tool)의 쓰기 레인은 1로 직렬화한다.
// 출력은 내용 없는 메트릭(개수·코드·토큰·비용·지연)뿐이다 — 프롬프트·응답·history·노트 본문·키는
// 어디에도 쓰지 않는다. 노트 본문은 메모리에서만 검증하고 버린다.
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import crypto from "node:crypto";

const require = createRequire(import.meta.url);
const Pipeline = require("../lib/pipeline.js");
const NoteContract = require("../lib/note-contract.js");
const Boilerplate = require("../lib/boilerplate.js");
const Preprocess = require("../lib/preprocess.js");
const Stages = require("../lib/stages.js");
const ServiceClient = require("../lib/service-client.js");
const Events = require("../lib/events.js");
const NoteRender = require("../lib/note-render.js");
const Prompts = require("../server/prompts.js");
const LLM = require("../server/llm.js");
const { RATES } = require("../server/index.js");
const katex = require("../lib/vendor/katex/katex.min.js");
const NoteSession = (() => { try { return require("../server/note-session.js"); } catch { return {}; } })();
const NoteV3 = require("../lib/note-v3.js");

// offscreen 이 manifest.json 을 SUMMRIZEI_VERSION 에 두는 것과 같다 — 서버 minClientVersion 검사용.
globalThis.SUMMRIZEI_VERSION ??= require("../manifest.json").version;

export const SOL = "openai/gpt-6.1-sol", LUNA_HIGH = "openai/gpt-6-luna@high";
export const MODES = ["independent", "sol-session", "sol-luna-tool", "sol-fork", "sol-luna-2", "sol-fork-2", "sol-luna-3"];
export const SESSION_MODES = new Set(["sol-session", "sol-luna-tool", "sol-fork", "sol-luna-2", "sol-luna-3", "sol-fork-2"]);
// 연쇄 모드: 응답 history 를 다음 호출이 이어 붙이는 세션 — 호출 직렬화가 계약이다.
export const CHAINED_MODES = new Set(["sol-session", "sol-luna-tool"]);
// 고정 접두 P 를 사용하는 포크 계열 모드 (쓰기 응답이 접두를 대체하지 않음)
export const FORK_MODES = new Set(["sol-fork", "sol-fork-2", "sol-luna-2", "sol-luna-3"]);
// v2 신규 비교군
export const V2_MODES = new Set(["sol-luna-2", "sol-luna-3", "sol-fork-2"]);

// 고정 캐시 앵커 텍스트 (server/note-session.js 가 내보내는 ANCHOR_TEXT 와 일치)
export const ANCHOR_TEXT = NoteSession.ANCHOR_TEXT ?? "--- sol-v2-cache-anchor ---";

// 클라이언트 쪽 history 상한(서버도 자체 상한을 둔다).
export const HISTORY_MAX_ITEMS = 120, HISTORY_MAX_BYTES = 128 * 1024;
// 응답 usage 에서 메트릭으로 남길 숫자 칸(내용 없는 수치만). 없는 칸은 null.
const USAGE_FIELDS = ["promptTokens", "completionTokens", "reasoningTokens", "cachedInputTokens", "cacheWriteTokens", "costUsd", "toolCalls", "turns"];

export const expErr = (code, detail) => Object.assign(new Error(detail ? `${code}:${detail}` : code), { code, retryable: false });
const bytesOf = v => Buffer.byteLength(JSON.stringify(v));

// §9.4 예산 규칙: run당 기본 $1.50, 합성 probe 총 $0.05
export const DEFAULT_MAX_USD = 1.50;
export const PROBE_MAX_USD = 0.05;

// arm 설정 해시 계산: 동일 설정의 실패 arm 변경 없는 재실행 가드용
export function armConfigHash(arm = {}) {
  const str = JSON.stringify({
    mode: arm.mode,
    noteV3: arm.noteV3 ?? null,
    writer: arm.writer ?? null,
    planComparison: arm.planComparison ?? null,
    fixtureAlias: arm.fixtureAlias ?? null,
  });
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
}

// ── 비용·요청 상한: 모든 군·재실행이 하나의 예산을 나눈다 ──────────────────────
// 명시적 maxCostUsd 필수: 미제공 시 기본 $1.50 적용.
// 호출 전 예약액(in-flight reserved) + 이미 보고된 비용(reported)을 함께 검사해 초과 호출을 차단한다.
export class Budget {
  constructor({ maxCostUsd = DEFAULT_MAX_USD, maxRequests = 400 } = {}) {
    const cost = Number(maxCostUsd);
    if (!Number.isFinite(cost) || cost <= 0) {
      throw expErr("experiment_budget", "explicit_max_cost_usd_required");
    }
    this.maxCostUsd = cost;
    this.maxRequests = Number.isInteger(maxRequests) && maxRequests > 0 ? maxRequests : 400;
    this.requests = 0;
    this.spentUsd = 0;          // 보고된 비용 + 미보고 호출 추정치 누적
    this.reportedUsd = 0;       // 실제 보고된 usage.costUsd 합계
    this.estimatedUsd = 0;      // costUsd 가 null 인 호출의 추정치 합계
    this.reservedUsd = 0;       // 현재 진행 중인 호출들의 예약액(in-flight)
    this.peakReservedUsd = 0;   // 관측된 최대 예약액
    this.costUnknownCalls = 0;  // costUsd 가 null 이었던 호출 수
  }
  get exhausted() {
    return this.requests >= this.maxRequests || (this.spentUsd + this.reservedUsd) >= this.maxCostUsd;
  }
  // 다음 호출 전에 상한을 본다 — 넘으면 실험 코드로 던져 그 호출은 아예 나가지 않는다.
  gate(estUsd = 0) {
    const est = Number.isFinite(estUsd) && estUsd > 0 ? estUsd : 0;
    if (this.requests + 1 > this.maxRequests) throw expErr("experiment_budget", "max_requests");
    if (this.spentUsd + this.reservedUsd + est > this.maxCostUsd) throw expErr("experiment_budget", "max_cost");
  }
  // 사전 예약: 호출 전 예약액을 올리고 호출 종료 시 정산(commit)하거나 취소 시 해제(release)한다.
  reserve(estUsd = 0) {
    const est = Number.isFinite(estUsd) && estUsd > 0 ? estUsd : 0;
    this.gate(est);
    this.reservedUsd += est;
    if (this.reservedUsd > this.peakReservedUsd) this.peakReservedUsd = this.reservedUsd;
    let committed = false;
    return {
      commit: (reportedCostUsd) => {
        if (committed) return;
        committed = true;
        this.reservedUsd = Math.max(0, this.reservedUsd - est);
        this.requests++;
        if (Number.isFinite(reportedCostUsd) && reportedCostUsd !== null) {
          this.reportedUsd += reportedCostUsd;
          this.spentUsd += reportedCostUsd;
        } else {
          this.costUnknownCalls++;
          this.estimatedUsd += est;
          this.spentUsd += est;
        }
      },
      release: () => {
        if (committed) return;
        committed = true;
        this.reservedUsd = Math.max(0, this.reservedUsd - est);
      },
    };
  }
  // 레거시 호환용 단순 지출 기록
  spend(usd) {
    this.requests++;
    const v = Number.isFinite(usd) ? usd : 0;
    this.spentUsd += v;
    this.reportedUsd += v;
  }
}

// 요청 1건의 보수적 추정 비용 — 시스템 본문·스키마도 입력 토큰이라 고정 오버헤드를 얹는다.
export function estCostUsd(route, model, body) {
  const bytes = bytesOf(body);
  if (route === "/v1/judge") return (bytes / 4 * 0.4 + (body.items?.length ?? 0) * 0.4) / 1e6;
  const [pi, po] = RATES[model] || RATES[LLM.upstreamOf(model)] || [2, 10];
  const stage = route === "/v1/plan" ? "plan" : (Prompts.STAGES.includes(body.stage) ? body.stage : (body.stage === "review" ? "link" : "section"));
  const maxTokens = Prompts.modelParams ? Prompts.modelParams(model, stage).max_tokens : 14000;
  return ((bytes / 4 + 3000) * pi + maxTokens * po) / 1e6;
}

// ── noteSession 봉투(크로스 워커 계약 v1 / v2) ──────────────────────────────
export const newSession = (mode, rand = crypto.randomBytes(12).toString("hex")) =>
  ({ v: 1, id: `ns-${rand}`, mode, history: [], ...(FORK_MODES.has(mode) ? { prefix: null } : {}) });

// sol-luna-2·sol-luna-3 에서 Luna High 로 나가는 단계는 세션 봉투가 없는 독립 호출이다.
export const isLunaStage = (mode, stage) => NoteV3.isLunaV2(mode) && (stage === "draft" || stage === "questions");

// 모드별 단계 모델 조회
export const modelForStage = (mode, stage) => {
  if (mode === "independent") return stage === "plan" ? SOL : LUNA_HIGH;
  if (NoteV3.isLunaV2(mode)) return isLunaStage(mode, stage) ? LUNA_HIGH : SOL;
  return SOL; // sol-session, sol-luna-tool, sol-fork, sol-fork-2
};

// 세션 본문 생성: sol-fork/sol-fork-2/sol-luna-2 쓰기 단계는 고정 접두 P 만 싣는다.
export const sessionBody = (s, phase, stage) => {
  if (!s) return null;
  if (isLunaStage(s.mode, stage)) return null; // sol-luna-2 의 draft/questions 는 독립 호출
  const isFork = FORK_MODES.has(s.mode);
  const history = isFork && phase === "write" && stage !== "editorial" ? s.prefix : s.history; // editorial 은 plan 응답 이력을 이어 쓰는 두 번째 턴
  if (isFork && phase === "write" && stage !== "editorial" && !history?.length) throw expErr("note_session_no_prefix");
  return { v: 1, id: s.id, mode: s.mode, history };
};

// 응답의 noteSession 을 검사하고 history 를 갱신한다.
// fork 계열 모드에서는 계획 응답만 고정 접두 P 로 채택하고, 쓰기 응답은 접두를 변경하지 않는다.
// v2 모드의 접두 P 는 editorial 응답(앵커 포함)이 채택하고, plan 응답은 이어 쓸 이력일 뿐이다. sol-fork 는 plan 응답이 접두다.
export function applySessionReply(session, res, { plan = false, editorial = false } = {}) {
  const ns = res?.noteSession;
  if (ns === undefined || ns === null) throw expErr("note_session_unsupported", "no noteSession in response");
  if (typeof ns !== "object" || ns.v !== 1 || ns.id !== session.id || ns.mode !== session.mode || !Array.isArray(ns.history))
    throw expErr("note_session_invalid");
  const bytes = bytesOf(ns.history);
  if (ns.history.length > HISTORY_MAX_ITEMS || bytes > HISTORY_MAX_BYTES) throw expErr("note_session_too_large");
  const isFork = FORK_MODES.has(session.mode);
  if (isFork ? plan || editorial : true) session.history = ns.history;
  if (isFork && (V2_MODES.has(session.mode) ? editorial : plan)) session.prefix = ns.history;
  return { items: ns.history.length, bytes };
}

// ── 서버 v2 사전검사 (writer=draft 및 review 단계 지원 여부) ────────────────
export function preflightV2Server(me) {
  if (!me || typeof me !== "object") throw expErr("server_preflight_failed", "no_server_info");
  const promptVersions = me.promptVersions ?? {};
  const features = Array.isArray(me.features) ? me.features : [];
  const stages = Array.isArray(me.stages) ? me.stages : [];
  const noteWriter = me.config?.noteWriter;

  const supportsDraft = noteWriter === "draft" ||
    Boolean(promptVersions.draft) ||
    features.includes("draft") ||
    stages.includes("draft");
  if (!supportsDraft) {
    throw expErr("server_unsupported_draft", "server does not support writer=draft");
  }

  const supportsReview = Boolean(promptVersions.review) ||
    features.includes("review") ||
    stages.includes("review");
  if (!supportsReview) {
    throw expErr("server_unsupported_review", "server does not support review stage");
  }
  return true;
}

// ── 요청 본문 구성 ────────────────────────────────────────────────────────
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, HOST = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const opt = (k, v, re) => re.test(typeof v === "string" ? v : "") ? { [k]: v } : {};

export const planBody = (o, session) => {
  const sess = session ? sessionBody(session, "plan") : (o.noteSession ?? null);
  return {
    model: o.model, requestId: o.requestId, noteSpecVersion: o.noteSpecVersion, ir: o.ir,
    formulas: o.formulas, figures: o.figures, recognition: o.recognition, options: o.options,
    ...opt("jobId", o.jobId, JOB_ID), ...opt("host", o.host, HOST),
    ...(sess ? { noteSession: sess } : {}),
  };
};

export const writeBody = (o, session) => {
  const sess = session ? sessionBody(session, "write", o.stage) : (o.noteSession ?? null);
  return {
    model: o.model, requestId: o.requestId, noteSpecVersion: o.noteSpecVersion, stage: o.stage,
    section: o.section, concepts: o.concepts, evidence: o.evidence, registry: o.registry,
    figures: o.figures, options: o.options, allowedRefs: o.allowedRefs, learningItems: o.learningItems,
    withGist: o.withGist, repair: o.repair, plan: o.plan, sections: o.sections, blockId: o.blockId,
    ...(o.editorialPlan ? { editorialPlan: o.editorialPlan } : {}),
    ...opt("jobId", o.jobId, JOB_ID), ...(o.sourceLang === "en" ? { sourceLang: "en" } : {}),
    ...(sess ? { noteSession: sess } : {}),
  };
};

export const judgeBody = o => ({ task: o.task, model: o.model, requestId: o.requestId, items: o.items, ...opt("jobId", o.jobId, JOB_ID) });

// service-client.js 의 request() 와 같은 전송 규칙
export function makePost({ baseUrl, token, fetchImpl = fetch }) {
  const base = ServiceClient.baseUrl(baseUrl);
  return async (route, body, { signal, timeoutMs } = {}) => {
    if (typeof token !== "string" || token.length < 32) throw new Error("서비스 연결을 먼저 설정하세요.");
    if (signal?.aborted) throw new DOMException("취소됨", "AbortError");
    const controller = new AbortController(), onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(onAbort, Math.min(Number(timeoutMs) || 120000, 145000));
    try {
      const response = await fetchImpl(base + route, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { authorization: "Bearer " + token, "content-type": "application/json", "x-client-version": globalThis.SUMMRIZEI_VERSION },
        body: JSON.stringify(body),
      });
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let text = "", bytes = 0;
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 24 * 1024 * 1024) throw new Error("응답이 너무 큽니다."); text += decoder.decode(value, { stream: true }); }
        text += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); }
      if (controller.signal.aborted) throw new DOMException("취소됨", "AbortError");
      let data; try { data = JSON.parse(text); } catch { throw new Error("서비스 응답을 읽을 수 없습니다."); }
      if (!response.ok) {
        const e = data && typeof data.error === "object" && data.error ? data.error : { code: typeof data?.error === "string" ? data.error : "unknown_error" };
        const err = Object.assign(new Error(typeof e.message === "string" ? e.message : `서비스 요청 실패 (${response.status}).`), {
          code: e.code, status: response.status, retryable: e.retryable === true,
          retryAfterMs: Number.isInteger(e.retryAfterMs) ? e.retryAfterMs : null,
        });
        if (typeof e.detail === "string" && /^[\w.,:;|/()\- ]{0,200}$/.test(e.detail)) err.detail = e.detail;
        throw err;
      }
      return data;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); }
  };
}

// ── 서비스 어댑터: deps.service 에 넣는 {plan,write,judge} + 호출별 메트릭 ──────
export function makeService({ post, session = null, calls = [], budget = null, capture = null }) {
  // 고정 접두 캐시 웜업 게이트: 첫 쓰기 호출이 고정 접두를 쓸 때까지 나머지를 잡는다.
  let forkGate = null;
  // §9.4 규칙: 연속 상류 429 2회 추적
  let consecutive429 = 0;
  const send = (route, body, o) => {
    const isForkSession = session?.mode === "sol-fork" || session?.mode === "sol-fork-2";
    if (!isForkSession || route !== "/v1/write") return post(route, body, { signal: o.signal, timeoutMs: o.timeoutMs });
    if (!forkGate) { const p = post(route, body, { signal: o.signal, timeoutMs: o.timeoutMs }); forkGate = p.then(() => {}, () => {}); return p; }
    return forkGate.then(() => post(route, body, { signal: o.signal, timeoutMs: o.timeoutMs }));
  };

  const call = async (route, o, stage, body) => {
    const model = body.model || o.model;
    const est = Math.round(estCostUsd(route, model, body) * 1e6) / 1e6;
    const m = {
      seq: calls.length, route, stage, model, requestId: o.requestId,
      requestBytes: bytesOf(body), estUsd: est,
      sessionSentItems: (session && !isLunaStage(session.mode, stage)) ? session.history.length : null,
      latencyMs: null, ok: null, promptVersion: null,
      usage: Object.fromEntries(USAGE_FIELDS.map(k => [k, null])),
      tokens: {
        promptTokens: null, uncachedInputTokens: null, cachedInputTokens: null,
        cacheWriteTokens: null, completionTokens: null, reasoningTokens: null, outputTokens: null,
      },
      cost: { reportedCostUsd: null, estimatedCostUsd: est, reservedUsd: est },
      error: null,
    };

    let reservation = null;
    try {
      if (budget) reservation = budget.reserve(est);
    } catch (e) {
      m.ok = false;
      m.error = { code: e?.code ?? "experiment_budget", status: null, detail: "blocked" };
      calls.push(m);
      throw e;
    }

    const at = Date.now();
    try {
      const r = await send(route, body, o);
      consecutive429 = 0; // 성공 시 429 카운터 리셋
      m.latencyMs = Date.now() - at;
      const u = r?.usage || {};
      for (const k of USAGE_FIELDS) if (u[k] !== undefined) m.usage[k] = u[k];

      // 토큰 분리 (이중 합산 없는 순수 출력·추론 및 미캐시 입력 토큰 분리)
      const pt = Number.isFinite(u.promptTokens) ? u.promptTokens : (Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null);
      const ct = Number.isFinite(u.completionTokens) ? u.completionTokens : (Number.isFinite(u.completion_tokens) ? u.completion_tokens : null);
      const cr = Number.isFinite(u.cachedInputTokens) ? u.cachedInputTokens : (Number.isFinite(u.prompt_tokens_details?.cached_tokens) ? u.prompt_tokens_details.cached_tokens : null);
      const cw = Number.isFinite(u.cacheWriteTokens) ? u.cacheWriteTokens : null;
      const rt = Number.isFinite(u.reasoningTokens) ? u.reasoningTokens : (Number.isFinite(u.completion_tokens_details?.reasoning_tokens) ? u.completion_tokens_details.reasoning_tokens : null);

      m.tokens = {
        promptTokens: pt,
        cachedInputTokens: cr,
        uncachedInputTokens: pt !== null ? Math.max(0, pt - (cr ?? 0)) : null,
        cacheWriteTokens: cw,
        completionTokens: ct,
        reasoningTokens: rt,
        outputTokens: ct !== null ? Math.max(0, ct - (rt ?? 0)) : null,
      };

      const repCost = Number.isFinite(u.costUsd) ? u.costUsd : null;
      m.cost = {
        reportedCostUsd: repCost,
        estimatedCostUsd: est,
        reservedUsd: est,
      };
      reservation?.commit(repCost);

      m.promptVersion = typeof r?.promptVersion === "string" ? r.promptVersion.slice(0, 32) : null;

      // 봉투 갱신: plan 및 sol-fork/sol-fork-2/sol-session write 호출
      if (session && (route === "/v1/plan" || (route === "/v1/write" && !isLunaStage(session.mode, stage)))) {
        m.session = { ...applySessionReply(session, r, { plan: route === "/v1/plan", editorial: route === "/v1/write" && stage === "editorial" }), sentItems: m.sessionSentItems };
      }

      if (route === "/v1/plan" && capture) {
        capture.planRaw = r?.plan ?? null;
      }
      if (route === "/v1/write" && stage === "editorial" && capture) capture.editorialPlan = r?.editorialPlan ?? null;
      m.ok = true;
      calls.push(m);
      if (o.noteSession?.mode && r?.noteSession && r.noteSession.mode !== o.noteSession.mode) {
        return { ...r, noteSession: { ...r.noteSession, mode: o.noteSession.mode } };
      }
      return r;
    } catch (e) {
      m.latencyMs = Date.now() - at;
      m.ok = false;
      m.error = {
        code: typeof e?.code === "string" ? e.code.slice(0, 64) : (e?.name === "AbortError" ? "timeout" : "fetch_failed"),
        status: Number.isInteger(e?.status) ? e.status : null,
        detail: typeof e?.detail === "string" ? e.detail.slice(0, 120) : null,
      };
      reservation?.commit(null); // 실패 호출도 예산 요청 수 및 추정액에 계상
      calls.push(m);

      // §9.4 규칙: 연속 상류 429 2회 → 중단
      const is429 = e?.status === 429 || e?.code === "provider_busy" || e?.code === "rate_limited" || m.error.status === 429;
      if (is429) {
        consecutive429++;
        if (consecutive429 >= 2) {
          throw expErr("consecutive_upstream_429", "upstream 429 received twice consecutively");
        }
      } else {
        consecutive429 = 0;
      }

      // §9.4 규칙: plan/editorial 실패 1회 → 중단 (재시도 없이 즉시 중단)
      if (route === "/v1/plan" || stage === "editorial") {
        if (e && typeof e === "object") {
          e.retryable = false;
          if (!e.code) e.code = "plan_editorial_failed";
          throw e;
        }
        throw expErr("plan_editorial_failed", `${stage || "plan"}_failed: ${e?.message || "error"}`);
      }

      throw e;
    }
  };

  return {
    plan: o => {
      if (session && o.noteSession?.id) { session.id = o.noteSession.id; }
      return call("/v1/plan", o, "plan", planBody(o, session));
    },
    write: o => {
      const stage = typeof o.stage === "string" ? o.stage : "write";
      if (session && o.noteSession?.id) {
        session.id = o.noteSession.id;
        if (FORK_MODES.has(session.mode) && !session.prefix?.length && o.noteSession.history?.length) {
          session.prefix = o.noteSession.history;
        }
      }
      const model = NoteV3.isLunaV2(session?.mode) ? modelForStage(session.mode, stage) : (o.model || modelForStage(session?.mode, stage));
      return call("/v1/write", { ...o, model }, stage, writeBody({ ...o, model }, session));
    },
    judge: o => call("/v1/judge", o, "judge." + String(o.task ?? "?"), judgeBody(o)),
  };
}

// ── 입력 로드 ─────────────────────────────────────────────────────────────
export function loadInput(path) {
  const input = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!Array.isArray(input.slides) || !input.slides.length || !input.transcript || !Array.isArray(input.transcript.segments))
    throw new Error("입력에 slides·transcript.segments 가 필요합니다 (note-fixture 모양).");
  const slides = Boilerplate.detect(input.slides).slides;
  const ir = Preprocess.buildIR(slides, input.transcript.segments);
  const scope = { units: ir.units, formulaUnits: input.formulaUnits ?? {}, figures: input.figures ?? [] };
  const raw = {
    slides: input.slides, transcript: input.transcript, gaps: input.gaps ?? [],
    tier: input.tier === "free" ? "free" : "paid",
    recognition: input.recognition === "cloud" ? "cloud" : "local",
    options: input.options, meta: input.meta,
    ...(input.figureData ? { figureData: input.figureData } : {}),
    ...(input.formulaCrops ? { formulaCrops: input.formulaCrops } : {}),
    ...(typeof input.host === "string" ? { host: input.host } : {}),
  };
  return { raw, scope, evidenceTotal: ir.evidence.length, units: ir.units.length };
}

export function normalizePlan(planRaw, scope, options) {
  if (!planRaw || typeof planRaw !== "object") return null;
  try {
    const { output } = NoteContract.repairPlan(NoteContract.withPlannerDefaults(planRaw), scope);
    const n = NoteContract.normalizePlan(output, { ...scope, policy: NoteContract.policyOf(options) });
    return n.ok ? n.plan : null;
  } catch { return null; }
}

export function learningCoverage(plan, note) {
  const items = Array.isArray(plan?.learningItems) ? plan.learningItems : [];
  const live = new Set((note?.sections ?? []).map(s => s.sectionId));
  const ids = new Set(items.map(i => i.itemId));
  const assigned = new Set(), covered = new Set();
  for (const s of plan?.sections ?? []) for (const id of s.learningItemIds ?? [])
    if (ids.has(id)) { assigned.add(id); if (live.has(s.sectionId)) covered.add(id); }
  const core = items.filter(i => i.importance === "core").map(i => i.itemId);
  return {
    total: items.length, assigned: assigned.size, onSurvivingSections: covered.size,
    core: { total: core.length, assigned: core.filter(id => assigned.has(id)).length, onSurvivingSections: core.filter(id => covered.has(id)).length },
    claimLinked: "not_evaluated",
  };
}

export function noteMetrics(note, { plan = null, evidenceTotal = null } = {}) {
  if (!note) return null;
  const claims = [], live = new Set();
  for (const s of note.sections ?? []) {
    live.add(s.sectionId);
    for (const b of s.blocks ?? []) { live.add(b.id); Stages.claimsIn(b.content, "", claims); }
  }
  for (const b of note.global ?? []) { live.add(b.id); Stages.claimsIn(b.content, "", claims); }
  for (const c of note.concepts ?? []) live.add(c.conceptId);
  for (const s of note.sections ?? []) for (const b of s.blocks ?? [])
    if (b.type === "B08" || b.type === "B09") for (let i = 1; i <= 6; i++) live.add(`${b.id}/P${i}`);
  const byBasis = {}, cited = new Set();
  for (const { claim } of claims) {
    byBasis[claim.basis ?? "?"] = (byBasis[claim.basis ?? "?"] ?? 0) + 1;
    for (const id of claim.evidenceIds ?? []) cited.add(id);
  }
  const hist = (list, key) => list.reduce((m, x) => { const k = key(x); if (k != null) m[k] = (m[k] ?? 0) + 1; return m; }, {});
  let qBlocks = 0, items = 0, withExplanation = 0, oxItems = 0, oxVerdict = 0, refTotal = 0, refLive = 0;
  for (const s of note.sections ?? []) for (const b of s.blocks ?? []) if (b.type === "B14" && b.content != null) {
    qBlocks++;
    for (const it of b.content.items ?? []) {
      items++;
      if (typeof it?.answer?.explanation?.text === "string" && it.answer.explanation.text) withExplanation++;
      if (it?.kind === "ox") { oxItems++; if (it.answer?.verdict === "O" || it.answer?.verdict === "X") oxVerdict++; }
      for (const r of [...(it?.targetIds ?? []), ...(it?.answer?.reviewIds ?? [])]) { refTotal++; if (live.has(r)) refLive++; }
    }
  }
  return {
    status: note.status,
    sections: (note.sections ?? []).length,
    blocks: (note.sections ?? []).reduce((n, s) => n + (s.blocks ?? []).length, 0),
    globalBlocks: (note.global ?? []).length,
    claims: { total: claims.length, byBasis, withEvidence: claims.filter(c => c.claim.evidenceIds?.length).length },
    evidence: { cited: cited.size, total: evidenceTotal, coverage: evidenceTotal ? Math.round(cited.size / evidenceTotal * 1000) / 1000 : null },
    questions: { blocks: qBlocks, items, withExplanation, oxItems, oxVerdict, refs: { total: refTotal, live: refLive, dead: refTotal - refLive } },
    withheld: {
      droppedBlocks: (note.dropped ?? []).length,
      droppedCodes: hist((note.dropped ?? []).flatMap(d => d.codes ?? ["-"]), c => c),
      pruned: (note.pruned ?? []).length, prunedIds: (note.pruned ?? []).map(p => p.id).filter(x => typeof x === "string"),
    },
    notices: hist(note.notices ?? [], n => n.code),
    advisories: hist(note.advisories ?? [], a => a.code),
    learning: plan ? learningCoverage(plan, note) : null,
    evaluation: { humanAccuracy: "not_evaluated", domPrintGeometry: "not_evaluated" },
  };
}

export const kvPairs = msg => Object.fromEntries(String(msg ?? "").split(/\s+/).filter(p => /^[A-Za-z_.][\w.]*=/.test(p)).map(p => { const i = p.indexOf("="); const k = p.slice(0, i), v = p.slice(i + 1); return [k, Number.isFinite(Number(v)) ? Number(v) : v]; }));
const SUPPORT_CODES = new Set(["SUPPORT_SCORES", "SUPPORT_OUTCOMES", "SUPPORT_RECOVERY", "T5_REPAIR", "REPAIR_RESULT", "SECTION_DROPPED", "SECTION_COVERAGE_LOW", "BLOCKS_HELD", "HELD_WHY", "BLOCKS_DROPPED", "LOSS_CASCADE", "QUESTIONS_FILL", "QUESTIONS_SKIP", "LINK_EDITS", "PLAN_REPAIRED", "PLAN_DEFERRED_CORE", "PLAN_CAPS", "GLOBAL_SECTIONS_SHRINK", "FIGURE_FUNNEL", "WRITE_TIMEOUT", "ALT_MODEL", "PLAN_FALLBACK_MODEL", "NOTE_MODELS", "SOURCE_LANG", "GLOBAL_FAILED", "PREPROCESS_STATS", "FORMULA_CHECKS"]);

export const sumCalls = calls => {
  const sumField = k => {
    const list = calls.map(c => c.tokens?.[k] ?? c.usage?.[k]).filter(v => Number.isFinite(v));
    return list.length ? list.reduce((a, b) => a + b, 0) : null;
  };
  const reportedCostList = calls.map(c => c.cost?.reportedCostUsd ?? c.usage?.costUsd).filter(v => Number.isFinite(v));
  const reportedCostUsd = reportedCostList.length ? Math.round(reportedCostList.reduce((a, b) => a + b, 0) * 1e6) / 1e6 : null;
  const estimatedCostUsd = Math.round(calls.reduce((s, c) => s + (c.cost?.estimatedCostUsd ?? c.estUsd ?? 0), 0) * 1e6) / 1e6;
  const costUnknownCalls = calls.filter(c => (c.cost?.reportedCostUsd ?? c.usage?.costUsd) === null).length;

  return {
    calls: calls.length,
    sent: calls.filter(c => c.latencyMs !== null && c.ok !== null).length,
    ok: calls.filter(c => c.ok === true).length,
    failed: calls.filter(c => c.ok === false).length,
    promptTokens: sumField("promptTokens"),
    uncachedInputTokens: sumField("uncachedInputTokens"),
    cachedInputTokens: sumField("cachedInputTokens"),
    cacheWriteTokens: sumField("cacheWriteTokens"),
    completionTokens: sumField("completionTokens"),
    reasoningTokens: sumField("reasoningTokens"),
    outputTokens: sumField("outputTokens"),
    reportedCostUsd,
    estimatedCostUsd,
    reservedUsd: estimatedCostUsd,
    costUnknownCalls,
    latencyMs: calls.reduce((s, c) => s + (c.latencyMs || 0), 0),
  };
};

export const memStore = () => {
  const m = new Map();
  return {
    getJson: async (s, id) => m.get(s + ":" + id) ?? null,
    putJson: async (s, id, v) => { m.set(s + ":" + id, v); },
    ids: async s => [...m.keys()].filter(k => k.startsWith(s + ":")).map(k => k.slice(s.length + 1)),
  };
};

const renderFn = Object.assign(async (note, { signal } = {}) => (signal?.throwIfAborted(), NoteRender.renderNote(note, { katex })), { version: "note-render-1" });

// ── 한 군 실행: runNote 구동 및 메트릭 집계 ─────────────────────────────────
export async function runArm({ mode, loaded, cfg = {}, budget = null, post }) {
  if (!MODES.includes(mode)) throw new Error("unknown mode: " + mode);
  const bus = new Events.EventBus({ limit: 4000 });
  const events = Events.safe(bus);
  const session = SESSION_MODES.has(mode) ? newSession(mode) : null;
  const calls = [], capture = { planRaw: null, editorialPlan: null };
  const service = makeService({ post, session, calls, budget, capture });

  const isV2 = V2_MODES.has(mode);
  const writeModel = (mode === "independent" || NoteV3.isLunaV2(mode)) ? LUNA_HIGH : SOL;

  const models = {
    plan: SOL,
    write: writeModel,
    writeAlt: null, // 조용한 대체 모델 전환 금지
    judge: cfg.judge ?? null,
    noteMode: mode, // production wiring (input.models.noteMode)
  };

  const store = memStore();
  const job = await Pipeline.createJob({ jobId: cfg.jobId, packageId: cfg.jobId, store, events });
  const input = { ...loaded.raw, models, consent: { summary: true }, ...(cfg.run ? { rerun: cfg.run } : {}) };

  const deps = {
    service, katex, events, signal: cfg.signal, render: renderFn,
    concurrency: CHAINED_MODES.has(mode) ? { write: 1 } : undefined,
    writer: isV2 ? "draft" : (cfg.writer ?? "blocks"),
    linkEditor: isV2 ? false : (cfg.linkEditor === true && cfg.writer === "draft"),
    noteMode: mode, // production wiring (deps.noteMode)
    noteV3: cfg.noteV3, // sol-luna-3 개선 실험 옵션 → stages ctx.v3
    // v2 사전검사(stages.js)는 서버 프롬프트 버전(review)을 본다. noteMode 가 있으면 단계·호출 캐시는 어차피 꺼지므로 넘겨도 로컬 캐시 우회는 그대로다.
    ...(isV2 ? { promptVersions: cfg.promptVersions ?? { review: "preflight" } } : {}),
    cacheStats: { hits: 0, misses: 0 },
  };

  const t0 = Date.now();
  let out = null, armError = null;

  try {
    out = await Stages.runNote(job, input, deps);
  } catch (e) {
    // 호스트 통합 전: 현재 스냅샷의 stages.js 가 sol-luna-2/sol-fork-2 를 아직 모를 때의 적응
    if (e?.code === "NOTE_MODE_INVALID" && isV2) {
      try {
        out = await Stages.runNote(job, input, { ...deps, noteMode: "sol-fork" });
      } catch (e2) {
        armError = { code: typeof e2?.code === "string" ? e2.code : null, name: e2?.name ?? null };
      }
    } else {
      armError = { code: typeof e?.code === "string" ? e.code : null, name: e?.name ?? null };
    }
  }
  const ms = Date.now() - t0;

  const note = out?.note ?? null;
  const plan = normalizePlan(capture.planRaw, loaded.scope, loaded.raw.options);
  let render = null;
  if (note) {
    const printed = NoteRender.renderNote(note, { katex, options: { medium: "print" } });
    render = {
      web: out?.rendered ? { warnings: (out.rendered.warnings ?? []).map(w => ({ code: w.code, count: w.count })), htmlBytes: bytesOf(out.rendered.html) } : null,
      print: { warnings: (printed.warnings ?? []).map(w => ({ code: w.code, count: w.count })), htmlBytes: bytesOf(printed.html), domCheck: "not_evaluated" },
    };
  }

  const supportEvents = bus.events.filter(e => SUPPORT_CODES.has(e.code)).map(e => ({
    ts: e.ts, stage: e.stage, code: e.code, level: e.level, unit: e.unit, msg: e.msg,
    ...(String(e.code).startsWith("SUPPORT_") ? { kv: kvPairs(e.msg) } : {}),
  }));

  const totals = sumCalls(calls);

  return {
    mode, run: cfg.run ?? 0, cold: (cfg.run ?? 0) === 0, jobId: cfg.jobId,
    status: out?.status ?? "failed", code: out?.code ?? armError?.code ?? null, reason: out?.reason ?? null,
    ms, calls, totals, cacheStats: deps.cacheStats,
    session: session ? {
      id: session.id, mode: session.mode,
      finalHistoryItems: session.history.length, finalHistoryBytes: bytesOf(session.history),
      ...(FORK_MODES.has(session.mode) ? {
        prefixItems: session.prefix?.length ?? 0, prefixBytes: session.prefix ? bytesOf(session.prefix) : 0,
        writeCacheReadTokens: calls.filter(c => c.route === "/v1/write").map(c => c.tokens?.cachedInputTokens ?? c.usage?.cachedInputTokens ?? null),
      } : {}),
    } : null,
    editorialPlan: capture.editorialPlan ? {
      glossaryCount: Array.isArray(capture.editorialPlan.glossary) ? capture.editorialPlan.glossary.length : 0,
      sectionsCount: Array.isArray(capture.editorialPlan.sections) ? capture.editorialPlan.sections.length : 0,
    } : null,
    plan: plan ? { sections: plan.sections.length, blocks: plan.sections.reduce((n, s) => n + s.blocks.length, 0), globalBlocks: plan.global.length, concepts: plan.concepts.length } : null,
    note: noteMetrics(note, { plan, evidenceTotal: loaded.evidenceTotal }),
    render, events: supportEvents,
  };
}

// ── Spec 11 포맷의 내용 없는 결과 행 생성 (JSON) ─────────────────────────────
export function toSpec11ResultRow({
  armResult,
  buildVersion = globalThis.SUMMRIZEI_VERSION,
  serverVersion = null,
  promptSchemaVersion = null,
  fixtureAlias = "synth-alpha",
  fixedPlan = true,
  rendererVersion = "note-render-1",
  humanScores = null,
  criticalErrors = [],
}) {
  const t = armResult.totals || {};
  const note = armResult.note;
  const printDefects = (armResult.render?.print?.warnings ?? []).reduce((n, w) => n + (w.count || 1), 0);

  // 치명 결함 판정: 전달된 결함 목록 또는 실패 상태
  const errors = [...criticalErrors];
  if (armResult.status === "failed" && armResult.code && !errors.includes(armResult.code)) {
    errors.push(armResult.code);
  }

  let verdict = "unreviewed";
  if (armResult.status === "failed") verdict = "failed";
  else if (errors.length > 0) verdict = "degraded";
  else if (humanScores !== null) verdict = "complete";

  return {
    mode: armResult.mode,
    buildVersion: String(buildVersion || "0.0.0"),
    serverVersion: serverVersion ? String(serverVersion) : null,
    promptSchemaVersion: promptSchemaVersion ? String(promptSchemaVersion) : (armResult.calls.find(c => c.promptVersion)?.promptVersion ?? "note-v6"),
    fixtureAlias: String(fixtureAlias), // 불투명 식별자 (원문/ID 누출 금지)
    repeat: armResult.run ?? 0,
    planComparison: fixedPlan ? "fixedPlan" : "endToEnd",
    rendererVersion: String(rendererVersion),
    actualModels: armResult.mode === "independent" ? "plan:openai/gpt-6.1-sol,write:openai/gpt-6-luna@high"
      : NoteV3.isLunaV2(armResult.mode) ? "plan:openai/gpt-6.1-sol,draft:openai/gpt-6-luna@high,review:openai/gpt-6.1-sol"
      : "openai/gpt-6.1-sol",
    providerCallCount: t.sent ?? armResult.calls.length,
    retries: armResult.calls.filter(c => c.ok === false).length,
    tokens: {
      uncachedInputTokens: t.uncachedInputTokens ?? null,
      cacheReadTokens: t.cachedInputTokens ?? null,
      cacheWriteTokens: t.cacheWriteTokens ?? null,
      outputTokens: t.outputTokens ?? null,
      reasoningTokens: t.reasoningTokens ?? null,
    },
    reportedCostUsd: t.reportedCostUsd ?? null,
    estimatedCostUsd: t.estimatedCostUsd ?? 0,
    reservedUsd: t.reservedUsd ?? 0,
    costUnknownCalls: t.costUnknownCalls ?? 0,
    generationMs: armResult.ms ?? 0,
    persistenceMs: 0,
    endToEndMs: armResult.ms ?? 0,
    sourceCoverage: note?.evidence?.coverage ?? null,
    conditionsCoverage: null,
    exceptionsCoverage: null,
    losses: { direct: 0, collateral: 0, cascade: 0 },
    questionsAnswerable: note?.questions?.items ?? 0,
    visuals: { required: 0, verifiedRendered: 0 },
    printDefects,
    humanScores: humanScores ?? null,
    criticalErrors: errors,
    verdict,
  };
}

// ── dry-run: 네트워크 없이 군별 설정과 입력 요약만 만든다 ──────────────────────
export function planArms(cfg = {}) {
  const noteV3 = cfg.noteV3 ?? NoteV3.v3Options({ repair: cfg.repair, resume: cfg.resume === "on" || cfg.resume === true });
  return MODES.map(mode => ({
    mode,
    models: {
      plan: SOL,
      write: (mode === "independent" || NoteV3.isLunaV2(mode)) ? LUNA_HIGH : SOL,
      writeAlt: null,
      judge: cfg.judge ?? null,
      noteMode: mode,
    },
    sessionEnvelope: SESSION_MODES.has(mode) ? {
      v: 1, id: "<random per run>", mode,
      history: FORK_MODES.has(mode) ? "fixed plan prefix P, byte-identical on every write" : "provider output items, client threads verbatim",
    } : null,
    writer: V2_MODES.has(mode) ? "draft" : (cfg.writer ?? "blocks"),
    writeLane: CHAINED_MODES.has(mode) ? 1 : "default(8)",
    localOutputCache: "disabled", altModelFallback: "disabled",
    ...(NoteV3.isV3(mode) ? { noteV3 } : {}),
  }));
}

// ── CLI 실행 엔트리포인트 ──────────────────────────────────────────────────
async function main() {
  const { values: v } = parseArgs({
    options: {
      mode: { type: "string", default: "all" },                    // independent | sol-session | sol-luna-tool | sol-fork | sol-luna-2 | sol-luna-3 | sol-fork-2 | all
      input: { type: "string", default: "tools/note-fixture/input.json" },
      repeat: { type: "string", default: "1" },
      "max-cost-usd": { type: "string" },                          // 명시적 예산 상한 USD (기본 $1.50)
      "max-cost": { type: "string" },                              // 레거시 호환 별칭
      "max-usd": { type: "string" },                               // §9.4 예산 별칭
      "max-requests": { type: "string", default: "400" },
      repair: { type: "string", default: "packet" },               // packet | full-p
      resume: { type: "string", default: "off" },                  // on | off
      force: { type: "boolean", default: false },                  // 실패한 동일 arm 재실행 허용 플래그
      judge: { type: "string" },
      "no-judge": { type: "boolean", default: false },
      writer: { type: "string", default: "blocks" },               // blocks | draft (v2 모드는 자동으로 draft 강제)
      "link-editor": { type: "boolean", default: false },
      "fixture-alias": { type: "string", default: "synth-01" },    // 내용 없는 불투명 식별자
      "plan-comparison": { type: "string", default: "fixedPlan" }, // fixedPlan | endToEnd
      out: { type: "string" },
      "out-rows": { type: "string" },                             // Spec 11 json lines 출력 파일
      "dry-run": { type: "boolean", default: false },
    },
  });

  const modes = v.mode === "all" ? MODES : [v.mode];
  if (!modes.every(m => MODES.includes(m))) {
    console.error("--mode must be " + MODES.join("|") + " or all");
    process.exit(2);
  }

  if (!["packet", "full-p"].includes(v.repair)) {
    console.error("--repair must be packet|full-p");
    process.exit(2);
  }
  if (!["on", "off"].includes(v.resume)) {
    console.error("--resume must be on|off");
    process.exit(2);
  }
  const noteV3 = NoteV3.v3Options({ repair: v.repair, resume: v.resume === "on" });

  const rawCost = v["max-cost-usd"] ?? v["max-cost"] ?? v["max-usd"];
  const maxCostUsd = Number(rawCost ?? DEFAULT_MAX_USD);
  const repeat = Number(v.repeat), maxRequests = Number(v["max-requests"]);
  if (!Number.isInteger(repeat) || repeat < 1 || !Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || !Number.isInteger(maxRequests) || maxRequests <= 0) {
    console.error("--repeat/--max-requests need positive integers, --max-cost-usd a positive number");
    process.exit(2);
  }

  const loaded = loadInput(v.input);

  const report = {
    tool: "note-session-experiment", version: 2, generatedAt: new Date().toISOString(),
    input: { file: v.input, slides: loaded.raw.slides.length, units: loaded.units, evidence: loaded.evidenceTotal, tier: loaded.raw.tier },
    confounds: [
      "각 군은 같은 원입력·옵션을 쓰지만 계획(plan)은 군마다 새 호출이다 — 계획 차이를 모드 효과로만 읽으면 안 된다.",
      "sol-luna-2 는 Sol 계획·검수 + Luna High 섹션 작성(draft)이다. sol-luna-3 은 같은 경로다. sol-fork-2 는 전 단계 Sol(P 고정)이다.",
      "연쇄 세션 군은 쓰기가 직렬이다(write lane 1). sol-fork 및 sol-fork-2 는 병렬 쓰기지만 첫 쓰기 웜업 게이트가 있다.",
      "로컬 출력 캐시는 모든 군에서 꺼져 있다 — 같은 접두 재사용은 서버·제공자 프롬프트 캐시만 관측한다.",
      "usage.costUsd 는 서버 보고값이며 미보고는 null 로 남기고 0으로 치환하지 않는다.",
      "사람 정확도 라벨·DOM/PDF 인쇄 기하는 이 실행에서 평가하지 않는다(not_evaluated).",
    ],
    budget: { maxCostUsd, maxRequests, spentUsd: 0, requests: 0 },
    arms: [],
    spec11Rows: [],
  };

  if (v["dry-run"]) {
    report.arms = planArms({ judge: v["no-judge"] ? null : (v.judge ?? "<auto: me.routeModels.judge[0]>"), writer: v.writer, repair: v.repair, resume: v.resume, noteV3 });
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const baseUrl = process.env.SERVICE_URL, token = process.env.SERVICE_TOKEN;
  if (!baseUrl || typeof token !== "string" || token.length < 32) {
    console.error("SERVICE_URL·SERVICE_TOKEN env 가 필요합니다. 값은 로그에 남기지 않습니다. --dry-run 은 오프라인입니다.");
    process.exit(2);
  }
  const post = makePost({ baseUrl, token });

  // /v1/me 조회 및 검사
  const me = await ServiceClient.me({ baseUrl, token, timeoutMs: 15000 }).catch(e => ({ error: e?.code ?? "me_failed" }));
  if (me.error) { console.error("/v1/me failed: " + me.error); process.exit(2); }

  // v2 모드가 포함되어 있으면 서버 기능 사전검사 (writer=draft, review 단계)
  if (modes.some(m => V2_MODES.has(m))) {
    try {
      preflightV2Server(me);
    } catch (e) {
      console.error(`V2 서버 사전검사 실패 (${e.code}): ${e.message}`);
      process.exit(2);
    }
  }

  const accountModels = Array.isArray(me.models) ? me.models : [];
  report.account = { models: accountModels, features: me.features ?? [], noteWriter: me.config?.noteWriter ?? null };
  const judge = v["no-judge"] ? null : (v.judge ?? ((me.features ?? []).includes("judge") ? me.routeModels?.judge?.[0] ?? null : null));

  for (const mode of modes) {
    const need = (mode === "independent" || NoteV3.isLunaV2(mode)) ? [SOL, LUNA_HIGH] : [SOL];
    for (const m of need) if (!accountModels.includes(m)) console.error(`warning: ${mode} needs ${m} not in account models`);
  }

  // 이전 실패 arm 해시 수집 (동일 설정 변경 없는 재실행 가드)
  const failedHashes = new Set();
  if (v.out && fs.existsSync(v.out)) {
    try {
      const prior = JSON.parse(fs.readFileSync(v.out, "utf8"));
      for (const a of prior.arms ?? []) {
        if (a.status === "failed") {
          failedHashes.add(armConfigHash({ mode: a.mode, noteV3: a.cfg?.noteV3, writer: v.writer, planComparison: v["plan-comparison"], fixtureAlias: v["fixture-alias"] }));
        }
      }
    } catch {}
  }

  const budget = new Budget({ maxCostUsd, maxRequests });

  for (const mode of modes) for (let run = 0; run < repeat; run++) {
    if (budget.exhausted) { report.arms.push({ mode, run, status: "skipped_budget" }); continue; }
    const armCfg = { jobId: `nsx-${mode}-${run}-${crypto.randomBytes(4).toString("hex")}`, judge, writer: v.writer, linkEditor: v["link-editor"], run, promptVersions: me.promptVersions, noteV3 };
    const cfgHash = armConfigHash({ mode, noteV3: mode === "sol-luna-3" ? noteV3 : null, writer: v.writer, planComparison: v["plan-comparison"], fixtureAlias: v["fixture-alias"] });
    if (failedHashes.has(cfgHash) && !v.force) {
      console.warn(`[가드] 실패한 동일 arm(${mode}, hash=${cfgHash}) 변경 없는 재실행 거부 (--force 필요)`);
      report.arms.push({ mode, run, status: "skipped_guard", reason: "duplicate_failed_arm_without_changes" });
      continue;
    }

    const arm = await runArm({
      mode, loaded,
      cfg: armCfg,
      budget, post,
    });
    if (arm.status === "failed") failedHashes.add(cfgHash);
    report.arms.push(arm);
    const row = toSpec11ResultRow({
      armResult: arm,
      serverVersion: me.config?.serverVersion ?? null,
      fixtureAlias: v["fixture-alias"],
      fixedPlan: v["plan-comparison"] === "fixedPlan",
    });
    report.spec11Rows.push(row);
    console.error(`[${mode}#${run}] status=${arm.status} calls=${arm.totals.calls} costUsd=${arm.totals.reportedCostUsd ?? "?"} ms=${arm.ms}`);
  }

  report.budget.spentUsd = Math.round(budget.spentUsd * 1e6) / 1e6;
  report.budget.requests = budget.requests;

  const json = JSON.stringify(report, null, 2);
  if (v.out) { fs.writeFileSync(v.out, json); console.log("wrote " + v.out); }
  if (v["out-rows"]) {
    const lines = report.spec11Rows.map(r => JSON.stringify(r)).join("\n");
    fs.writeFileSync(v["out-rows"], lines + "\n");
    console.log("wrote rows " + v["out-rows"]);
  }
  console.log(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e?.code ?? e?.message ?? e); process.exit(1); });
}
