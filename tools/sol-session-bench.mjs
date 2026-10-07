#!/usr/bin/env node
// sol-session-bench — 계획→섹션 작성→검증→전역→조립 파이프라인을 openai/gpt-6.1-sol 에서 두 가지 호출 방식으로 돌려
// 캐시·비용·품질을 비교하는 한정 합성 실험 하네스다.
//   independent : 운영 서버와 같은 방식 — 단계마다 시스템+입력만 실은 독립 요청, strict json_schema.
//   continuation: 한 대화로 이어 붙임 — 고정 시스템 1개 + 앞 턴의 user/assistant 를 그대로 다시 보내고
//                 다음 지시를 붙인다. response_format 은 모든 턴에서 같은 {type:"json_object"}.
//                 strict json_schema 를 못 쓰는 confound 는 결과에 명시한다.
// 입력은 tools/note-fixture/input.json(직접 작성한 합성 자료)뿐이다. 모델 입출력은 메모리에만 두고
// 저장·로그에는 살균된 메트릭(토큰·지연·비용·검증 코드·개수)만 남긴다 — 프롬프트·응답·키는 절대 기록하지 않는다.
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const Contracts = require("../lib/contracts.js");
const NoteContract = require("../lib/note-contract.js");
const Boilerplate = require("../lib/boilerplate.js");
const Preprocess = require("../lib/preprocess.js");
const Stages = require("../lib/stages.js");
const Prompts = require("../server/prompts.js");
const LLM = require("../server/llm.js");
const { RATES } = require("../server/index.js");
const katex = require("../lib/vendor/katex/katex.min.js");

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const ENDPOINTS_API = m => `https://openrouter.ai/api/v1/models/${m}/endpoints`;
const DEFAULT_MODEL = "openai/gpt-6.1-sol";
// continuation 은 같은 response_format 을 모든 턴에 써야 해서 운영의 strict json_schema 를 포기한다 — 결과에 confound 로 남긴다.
const CONT_CONFOUND = "continuation uses response_format {type:'json_object'} on every turn instead of the production strict json_schema per stage; upstream structured-output enforcement and its effect on validity/latency are not comparable to independent";
const CONT_TASK_INSTRUCTION = "이 메시지는 한 단계의 작업이다. input 은 그 단계의 입력 자료이고 outputSchema 는 출력의 JSON Schema다. outputSchema 를 만족하는 JSON 객체 하나만 답한다. 설명이나 코드 펜스를 붙이지 않는다.";
const contPreamble = () => [
  "이 대화는 강의 노트 생성 작업 하나를 정해진 단계 순서로 진행한다: 1) 계획(plan), 2) 계획된 각 섹션의 작성(section, 섹션마다 한 번), 3) 전체 글(global).",
  "각 사용자 메시지는 한 단계의 작업이고 {stage, sectionId?, instruction, input, outputSchema} 모양의 JSON이다. 아래 규칙 중 해당 단계(stage)의 지시를 따른다.",
].join("\n");
// 대화 전체에서 바뀌지 않는 안정된 시스템: 진행 설명 + 각 단계 규칙 전문을 구분자로 그대로 연결한다.
// 줄 단위 중복 제거는 문구 구조를 깰 수 있어 하지 않는다 — 공용 규칙이 단계마다 반복되더라도 원문을 유지한다.
// 운영 프롬프트 문구를 그대로 재사용한다 — 별도 문구를 새로 쓰지 않는다.
export const contSystemFor = (options, sourceLang) => [
  contPreamble(),
  Prompts.systemFor("plan", options, sourceLang),
  Prompts.systemFor("section", options, sourceLang),
  Prompts.systemFor("global", options, sourceLang),
].join("\n\n---\n\n");

// server/index.js 의 providerSchema 와 같은 변환 — strict 제공자는 검증 전용 키워드(maxLength·pattern 등)가
// 섞인 스키마를 통째로 거절한다. 서버 모듈이 이 함수를 export 하지 않아 여기에 그대로 둔다.
export function providerSchema(s, drop) {
  if (!s || typeof s !== "object") return s;
  const out = {};
  for (const k of ["type", "properties", "required", "additionalProperties", "enum", "items"]) if (Object.hasOwn(s, k)) out[k] = s[k];
  if (out.properties) { const props = {}; for (const [name, p] of Object.entries(out.properties)) if (!drop.includes(name)) props[name] = providerSchema(p, drop); out.properties = props; if (Array.isArray(out.required)) out.required = out.required.filter(n => !drop.includes(n)); }
  if (out.items) out.items = providerSchema(out.items, drop);
  return out;
}

// ── 합성 fixture 로드와 입력 조립 (lib/stages.js·lib/note-fixture.test.js 와 같은 경로) ──
export function loadFixture() {
  const input = require("../tools/note-fixture/input.json");
  const slides = Boilerplate.detect(input.slides).slides;
  const ir = Preprocess.buildIR(slides, input.transcript.segments);
  const options = NoteContract.policyOf(undefined); // 합성 실험은 증강 옵션을 켜지 않는다
  const sourceLang = input.meta?.lang === "en" ? "en" : undefined;
  const scope = { units: ir.units, formulaUnits: input.formulaUnits, figures: input.figures };
  const ownUnits = sec => new Set([...(sec.unitIds || []), ...(sec.crossUnitIds || [])]);
  const fx = {
    input, ir, options, sourceLang, scope, ownUnits,
    units: ir.units, evidence: ir.evidence,
    registry: input.registry, formulaUnits: input.formulaUnits, figures: input.figures,
    crops: input.crops, meta: input.meta, tier: input.tier, systemNotices: input.systemNotices,
    evidenceFor: sec => { const us = ownUnits(sec); return ir.evidence.filter(e => us.has(e.unitId)); },
    regFor: sec => { const us = ownUnits(sec); return input.registry.filter(e => (input.formulaUnits[e.id] || []).some(u => us.has(u))).slice(0, 200).map(e => ({ id: e.id, latex: e.latex ?? null, status: e.status })); },
    figsFor: sec => { const us = ownUnits(sec); return input.figures.filter(f => us.has(f.unitId)).slice(0, 50).map(f => ({ id: f.id, kind: f.kind, title: f.title ?? null, cells: f.cells ? f.cells.slice(0, 30).map(r => r.slice(0, 6).map(c => String(c).slice(0, 200))) : null })); },
  };
  return fx;
}

// allowedRefs · learningItemsFor — lib/stages.js 와 같은 규칙(전체 정규화 계획에서 한 번 만든다).
export function buildAllowedRefs(plan) {
  const targetIds = [], reviewIds = [];
  for (const s of plan.sections) {
    targetIds.push(s.sectionId);
    for (const b of s.blocks) {
      targetIds.push(b.blockId); reviewIds.push(b.blockId);
      if (b.type === "B08" || b.type === "B09") for (let i = 1; i <= 6; i++) targetIds.push(`${b.blockId}/P${i}`);
    }
  }
  for (const g of plan.global) targetIds.push(g.blockId);
  for (const c of plan.concepts) if (c.depth === "defined") targetIds.push(c.conceptId);
  return { targetIds: [...new Set(targetIds)].slice(0, 3500), reviewIds: [...new Set(reviewIds)].slice(0, 500) };
}
const learningItemsFor = (plan, sec) => {
  const all = plan.learningItems;
  if (!Array.isArray(all) || !Array.isArray(sec.learningItemIds) || !sec.learningItemIds.length) return {};
  const items = all.filter(l => sec.learningItemIds.includes(l.itemId)).map(({ itemId, kind, importance, unitIds }) => ({ itemId, kind, importance, unitIds }));
  return items.length ? { learningItems: items } : {};
};

// noteRoute 와 같은 직렬화: 본문은 스키마 properties 순서만 남긴다 — 캐시 접두 재현에 순서가 중요하다.
export function restOf(stage, raw) {
  const spec = Prompts.REQUEST[stage];
  const rest = Object.fromEntries(Object.keys(spec.properties).filter(k => raw[k] !== undefined).map(k => [k, raw[k]]));
  const checked = Contracts.validate(spec, rest);
  if (!checked.ok) throw new Error("request_rejected:" + (checked.errors[0]?.path || "?"));
  return rest;
}

// 단계 정의: system(운영 문구) · outSchema(계약 스키마) · params(생성 파라미터)는 두 모드가 같다.
function stepDef(fx, model, stage, raw, sectionId = null) {
  const rest = restOf(stage, raw);
  return {
    phase: stage, sectionId, rest,
    outSchema: Prompts.outputSchema(stage, rest, fx.sourceLang),
    system: Prompts.systemFor(stage, fx.options, fx.sourceLang, rest.section?.worker),
    params: Prompts.modelParams(model, stage),
  };
}
const planStep = (fx, model) => {
  const formulas = fx.registry.map(({ id, status }) => ({ id, status, unitIds: (fx.formulaUnits[id] || []).slice(0, 20) }));
  const figures = fx.figures.map(({ id, unitId, kind, title }) => ({ id, unitId, kind, title: title ?? null }));
  return stepDef(fx, model, "plan", { ir: { units: fx.units }, formulas, figures, recognition: "local", options: fx.options });
};
const sectionStep = (fx, plan, sec, model) => {
  // sourceLang 은 봉투 키라 spec.properties 밖 — restOf 가 알아서 뺀다
  return stepDef(fx, model, "section", {
    section: sec, concepts: plan.concepts, evidence: fx.evidenceFor(sec), registry: fx.regFor(sec),
    figures: fx.figsFor(sec), options: fx.options, allowedRefs: fx.arefs,
    ...learningItemsFor(plan, sec), ...(fx.sourceLang ? { sourceLang: fx.sourceLang } : {}), withGist: true,
  }, sec.sectionId);
};
const globalStep = (fx, plan, gs, model) =>
  stepDef(fx, model, "global", { plan: { concepts: plan.concepts, global: plan.global }, sections: gs, options: fx.options, allowedRefs: fx.arefs });

// ── 비용·요청 상한 ──
export class Budget {
  constructor({ maxCostUsd = 2, maxRequests = 16 } = {}) {
    this.maxCostUsd = maxCostUsd; this.maxRequests = maxRequests;
    this.requests = 0; this.spentEstUsd = 0;
  }
  estimate(estInputTokens, maxTokens, pi, po) { return (estInputTokens * pi + maxTokens * po) / 1e6; }
  // 다음 호출 전에 상한을 본다 — 넘으면 그 단계는 skipped_budget 으로 표시하고 보내지 않는다.
  check(estInputTokens, maxTokens, pi, po) {
    if (this.requests + 1 > this.maxRequests) return { ok: false, reason: "max_requests" };
    const est = this.estimate(estInputTokens, maxTokens, pi, po);
    if (this.spentEstUsd + est > this.maxCostUsd) return { ok: false, reason: "max_cost", est };
    return { ok: true, est };
  }
  spend(usd) { this.requests++; this.spentEstUsd += Number.isFinite(usd) ? usd : 0; }
}

// ── 메트릭: 토큰·캐시·비용 미보고는 null(보고된 0 과 구분) — server/index.js attemptOf 와 같은 규칙.
export function usageMetric(u) {
  const num = v => Number.isFinite(v) && v >= 0 ? v : null;
  const c = LLM.cacheOf(u);
  const input = num(u?.prompt_tokens) ?? num(u?.input_tokens);
  const output = num(u?.completion_tokens) ?? num(u?.output_tokens);
  const reported = num(u?.cost);
  return {
    inputTokens: input, outputTokens: output,
    reasoningTokens: num(u?.completion_tokens_details?.reasoning_tokens) ?? num(u?.reasoning_tokens),
    cachedInputTokens: c.cached_input_tokens,
    // LLM.cacheOf 가 안 읽는 cache_write_tokens 를 먼저 본다 — OpenAI 계열은 prompt_tokens_details 에 싣는다
    cacheWriteTokens: num(u?.prompt_tokens_details?.cache_write_tokens) ?? c.cache_write_tokens,
    reportedCostUsd: reported,
    costStatus: reported !== null ? "provider_reported" : (input !== null || output !== null) ? "estimated" : "unreported",
  };
}
const estCostOf = (u, pi, po) => {
  const i = u?.prompt_tokens ?? u?.input_tokens, o = u?.completion_tokens ?? u?.output_tokens;
  return Number.isFinite(i) && Number.isFinite(o) && i >= 0 && o >= 0 ? (i * pi + o * po) / 1e6 : null;
};

// OpenRouter 오류 봉투 {error:{code,message,metadata}} — HTTP 200 으로도 내려오는 실패(필드 관측).
// 메트릭에는 숫자 코드와 아래 허용 분류뿐 남긴다 — error.message·metadata 원문은 어디에도 쓰지 않는다.
// 분류 판별을 위해 message 를 지역에서만 스캔하고 결과는 영구 버킷 라벨로만 출력한다.
export function errorEnvelope(raw) {
  const e = raw?.error;
  if (!e || typeof e !== "object") return null;
  // 비숫자 code 는 제공자 자유 문자열이라 부분 문자열도 남기지 않는다 — 고정 라벨로 접고 분류는 category 가 담당한다.
  const num = Number(e.code);
  const code = Number.isFinite(num) && num > 0 ? "provider_error_" + Math.floor(num) : "provider_body_error";
  const text = `${e.code ?? ""} ${e.message ?? ""} ${JSON.stringify(e.metadata ?? {})}`.toLowerCase();
  const category =
    /credit|insufficient/.test(text) ? "insufficient_credits" :
    /unsupported|require_parameters|not a supported|unrecognized (request )?argument|unknown (parameter|field)|is not supported/.test(text) ? "unsupported_parameter" :
    /no endpoints|no_endpoints|not found|404/.test(text) ? "no_endpoints" :
    /rate.?limit|too many|429/.test(text) ? "rate_limit" :
    /moderat|flagged|content.?policy/.test(text) ? "moderation" :
    /auth|invalid key|api key|401|403/.test(text) ? "auth" :
    /timeout|timed out|408/.test(text) ? "timeout" :
    /invalid|malformed|bad request|400/.test(text) ? "invalid_request" :
    "provider_error";
  // metadata.error_type 은 OpenRouter 가 주는 짧은 식별자(rate_limited·provider_error 등)다.
  // 식별자 형식이 맞을 때만 원인 분류용으로 메트릭에 남기고, 자유 형식이면 버린다 — 문자열 원문이 아니다.
  const t = e.metadata?.error_type;
  const errorType = typeof t === "string" && /^[a-z][a-z0-9_]{0,39}$/i.test(t) ? t.toLowerCase() : null;
  return { code, category, errorType };
}

// send(body) → {status, ok, raw} 를 주입받는다(실경로는 fetch, 테스트는 mock). 본문·응답은 메모리에만 둔다.
export function makeHttpSend(key, timeoutMs) {
  return async body => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST", redirect: "error", signal: ctl.signal,
        headers: { authorization: "Bearer " + key, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: res.status, ok: res.ok, raw: await res.json() };
    } finally { clearTimeout(t); }
  };
}

// 요청 본문을 모드에 맞게 만든다 — send 에 넘기기 전·예산 추정에도 쓰는 순수 함수.
export function buildBody({ mode, step, model, providerTag, cacheKey, contSystem, history }) {
  let messages;
  if (mode === "independent") {
    messages = [LLM.cachedSystem(model, step.system), LLM.cachedUser(model, JSON.stringify(step.rest), step.phase)];
  } else {
    messages = [{ role: "system", content: contSystem }, ...history];
  }
  return {
    model: LLM.upstreamOf(model), ...step.params, messages,
    response_format: mode === "independent"
      ? { type: "json_schema", json_schema: { name: "lecture_note_" + step.phase, strict: true, schema: providerSchema(step.outSchema, []) } }
      : { type: "json_object" },
    provider: { only: [providerTag], order: [providerTag], require_parameters: true, allow_fallbacks: false, zdr: true, data_collection: "deny" },
    ...(mode === "continuation" && cacheKey ? { prompt_cache_key: cacheKey } : {}),
  };
}
const estInputTokens = body =>
  Prompts.estimateTokens(body.messages.map(m => typeof m.content === "string" ? m.content : m.content.map(p => p.text || "").join("")).join(""));

// 모델 응답 → 계약 오브젝트: 서버와 같은 순서(parse → id 정규화 → salvage → strict 검사).
function parsePhase(step, content) {
  let parsed;
  try { parsed = LLM.parseNote(content); } catch { return { ok: false, code: "invalid_json" }; }
  if (step.phase === "plan") parsed = NoteContract.withPlannerDefaults(NoteContract.canonicalPlanIds(parsed));
  else parsed = NoteContract.canonicalMapKeys(parsed, step.rest.section?.sectionId ?? null);
  let checked = parsed;
  const pre = Contracts.validate(step.outSchema, checked);
  if (!pre.ok) checked = Contracts.salvage(step.outSchema, checked).value;
  const r = Contracts.validate(step.outSchema, checked);
  return r.ok ? { ok: true, output: checked } : { ok: false, code: "invalid_schema" };
}

// 한 모드 실행: plan → normalizePlan → 계획된 모든 섹션 작성 → validateSection → global → assembleNote.
// 어떤 단계도 조용히 빠뜨리지 않는다 — ok / failed / skipped_budget / skipped_no_survivors 로 표시한다.
export async function runMode(mode, fx, ctx) {
  // ctx: {model, providerTag, send, budget, cacheKey, planOverride?}
  const [pi, po] = RATES[ctx.model] || RATES[LLM.upstreamOf(ctx.model)] || [2, 10];
  const result = { mode, model: ctx.model, provider: ctx.providerTag, calls: [], sections: [], global: null, plan: null, note: null, confounds: [] };
  if (mode === "continuation") result.confounds.push(CONT_CONFOUND);
  const contSystem = mode === "continuation" ? contSystemFor(fx.options, fx.sourceLang) : null;
  const history = []; // continuation: system 을 뺀 user/assistant 교대 — 매 턴 전부 다시 보낸다

  const call = async step => {
    const metric = {
      phase: step.phase, ...(step.sectionId ? { sectionId: step.sectionId } : {}),
      model: ctx.model, provider: ctx.providerTag, status: "ok", latencyMs: null,
      inputTokens: null, outputTokens: null, reasoningTokens: null,
      cachedInputTokens: null, cacheWriteTokens: null,
      reportedCostUsd: null, estimatedCostUsd: null, costStatus: "unreported",
      finishReason: null, schemaOk: null, codeCheckOk: null, errorCodes: [], errorCategory: null, errorType: null,
    };
    const hLen = history.length;
    if (mode === "continuation") {
      const task = { stage: step.phase, ...(step.sectionId ? { sectionId: step.sectionId } : {}), instruction: CONT_TASK_INSTRUCTION, input: step.rest, outputSchema: step.outSchema };
      history.push({ role: "user", content: JSON.stringify(task) });
    }
    const fail = (codes, skip = false) => {
      metric.status = skip ? "skipped_budget" : "failed";
      metric.errorCodes.push(...[].concat(codes));
      result.calls.push(metric);
      history.length = hLen; // 실패한 턴은 대화에 남기지 않는다 — 다음 단계는 앞의 성공 턴만 다시 본다
      return skip ? { skipped: true, metric } : { failed: true, metric };
    };
    const body = buildBody({ mode, step, model: ctx.model, providerTag: ctx.providerTag, cacheKey: ctx.cacheKey, contSystem, history });
    const gate = ctx.budget.check(estInputTokens(body), step.params.max_tokens, pi, po);
    if (!gate.ok) return fail(gate.reason, true);
    const at = Date.now();
    let http;
    try { http = await ctx.send(body); } catch (e) {
      metric.latencyMs = Date.now() - at;
      ctx.budget.spend(gate.est); // 전송을 시도한 호출도 요청수·비용 상한에 보수적으로 센다
      return fail(e?.name === "AbortError" ? "timeout" : "fetch_failed");
    }
    metric.latencyMs = Date.now() - at;
    const raw = http.raw || {}, u = raw.usage || {}, choice = raw.choices?.[0];
    const um = usageMetric(u);
    Object.assign(metric, um, { estimatedCostUsd: um.reportedCostUsd ?? estCostOf(u, pi, po) });
    ctx.budget.spend(metric.estimatedCostUsd ?? gate.est);
    // 오류 봉투(raw.error)는 HTTP 상태와 무관하게 먼저 분류한다 — 200 본문 오류도 코드·분류로 남긴다.
    const env = errorEnvelope(raw);
    if (env) { metric.errorCategory = env.category; metric.errorType = env.errorType; }
    if (!http.ok) return fail(env?.code ?? "provider_http_" + http.status);
    metric.finishReason = choice?.finish_reason ?? null;
    const content = choice?.message?.content;
    if (mode === "continuation") history.push({ role: "assistant", content: typeof content === "string" ? content : "" });
    if (!choice) return fail(env?.code ?? "provider_output_incomplete");
    if (choice.finish_reason !== "stop" || typeof content !== "string")
      return fail(choice.finish_reason === "length" ? "llm_output_truncated" : "provider_output_incomplete");
    const p = parsePhase(step, content);
    metric.schemaOk = p.ok;
    if (!p.ok) return fail(p.code);
    result.calls.push(metric);
    return { ok: true, output: p.output, metric };
  };

  // 1) 계획
  let planRaw;
  if (ctx.planOverride) planRaw = { ok: true, output: ctx.planOverride };
  else planRaw = await call(planStep(fx, ctx.model));
  if (!planRaw.ok) { result.plan = { status: planRaw.skipped ? "skipped_budget" : "failed" }; return result; }
  const filled = NoteContract.withPlannerDefaults(planRaw.output);
  const { output: repaired, fixes } = NoteContract.repairPlan(filled, fx.scope);
  const norm = NoteContract.normalizePlan(repaired, { ...fx.scope, policy: fx.options });
  if (!norm.ok) { result.plan = { status: "failed", errorCodes: ["VAL_PLAN_INVALID"] }; return result; }
  const plan = norm.plan;
  fx.arefs = buildAllowedRefs(plan);
  result.plan = {
    status: "ok", sections: plan.sections.length, concepts: plan.concepts.length,
    globalBlocks: plan.global.length, fixes: fixes.length,
  };

  // 2) 계획된 모든 섹션 작성 + 코드 검증
  const check = (sectionId, output) => NoteContract.validateSection({
    plan, sectionId, output, evidence: fx.evidence,
    registry: fx.registry, formulaUnits: fx.formulaUnits, figures: fx.figures, katex,
  });
  const sections = [];
  for (const sec of plan.sections) {
    const r = await call(sectionStep(fx, plan, sec, ctx.model));
    const entry = { sectionId: sec.sectionId, output: null };
    if (r.ok) {
      entry.output = r.output;
      const v = check(sec.sectionId, r.output);
      const last = result.calls.at(-1);
      last.codeCheckOk = !v.errors.length && v.blocks.every(b => !b.errors.length);
      last.errorCodes.push(...v.blocks.flatMap(b => b.errors.map(e => e.code)).slice(0, 12), ...v.errors.map(e => e.code));
      entry.validation = {
        ok: last.codeCheckOk,
        blocks: v.blocks.length,
        blocksOk: v.blocks.filter(b => !b.errors.length).length,
        errorCodes: [...new Set(v.blocks.flatMap(b => b.errors.map(e => e.code)))].slice(0, 12),
      };
    } else entry.validation = { ok: false, skipped: r.skipped ? "budget" : "failed" };
    sections.push(entry); result.sections.push({ sectionId: sec.sectionId, ...entry.validation });
  }

  // 3) 전역 — 살아남은 섹션이 없으면 단계 자체를 건너뛴 표시로 남긴다
  const survivors = [];
  for (const s of sections) if (s.output) {
    const v = check(s.sectionId, s.output), blocks = v.blocks.filter(b => !b.errors.length);
    if (!v.errors.length && blocks.length) survivors.push({ sectionId: s.sectionId, title: plan.sections.find(x => x.sectionId === s.sectionId).title, gist: v.gist, blocks });
  }
  const gs = survivors.length ? Stages.globalSections(survivors) : null;
  let global = null;
  if (gs) {
    const r = await call(globalStep(fx, plan, gs, ctx.model));
    if (r.ok) global = r.output;
    result.global = { status: r.ok ? "ok" : r.skipped ? "skipped_budget" : "failed" };
  } else result.global = { status: "skipped_no_survivors" };

  // 4) 조립 — 검증·손실 정리는 운영과 같은 assembleNote 에 맡긴다
  let note = null;
  try {
    note = NoteContract.assembleNote({
      plan, sections, global, units: fx.units, evidence: fx.evidence,
      registry: fx.registry, formulaUnits: fx.formulaUnits, figures: fx.figures,
      crops: fx.crops, meta: fx.meta, tier: fx.tier, systemNotices: fx.systemNotices,
      promptVersion: null, katex,
    });
  } catch { note = null; }
  result.note = note ? {
    status: note.status,
    sections: note.sections.length,
    blocks: note.sections.reduce((n, s) => n + s.blocks.length, 0),
    globalBlocks: note.global.length,
    questions: note.sections.reduce((n, s) => n + s.blocks.filter(b => b.type === "B14").reduce((m, b) => m + (b.content?.items?.length || 0), 0), 0),
    dropped: note.dropped.length, pruned: note.pruned.length, notices: note.notices.length,
  } : { status: "assemble_failed" };
  return result;
}

const sumCalls = calls => {
  const num = k => calls.some(c => Number.isFinite(c[k])) ? calls.reduce((s, c) => s + (c[k] || 0), 0) : null;
  return {
    calls: calls.length,
    sent: calls.filter(c => c.latencyMs !== null).length,
    inputTokens: num("inputTokens"), outputTokens: num("outputTokens"), reasoningTokens: num("reasoningTokens"),
    cachedInputTokens: num("cachedInputTokens"), cacheWriteTokens: num("cacheWriteTokens"),
    reportedCostUsd: num("reportedCostUsd"), estimatedCostUsd: num("estimatedCostUsd"),
    latencyMs: calls.reduce((s, c) => s + (c.latencyMs || 0), 0),
  };
};
export function summarize(result) {
  return {
    mode: result.mode, model: result.model, provider: result.provider,
    plan: result.plan, sections: result.sections, global: result.global, note: result.note,
    confounds: result.confounds, totals: sumCalls(result.calls), calls: result.calls,
  };
}

// ── dry-run: 네트워크 없이 두 모드의 요청 본문 전부를 만들고 입력 계약을 검사한다.
// 계획은 fixture 의 골든 planner-output.json 을 같은 정규화 경로로 통과시켜 쓴다(실제 호출 없음).
export function dryRun(fx, ctx) {
  const golden = require("../tools/note-fixture/planner-output.json");
  const filled = NoteContract.withPlannerDefaults(golden);
  const { output: repaired } = NoteContract.repairPlan(filled, fx.scope);
  const norm = NoteContract.normalizePlan(repaired, { ...fx.scope, policy: fx.options });
  if (!norm.ok) throw new Error("fixture plan did not normalize");
  const plan = norm.plan;
  fx.arefs = buildAllowedRefs(plan);
  const survivors = [{ sectionId: plan.sections[0].sectionId, title: plan.sections[0].title, gist: null, blocks: [{ id: plan.sections[0].blocks[0].blockId, type: plan.sections[0].blocks[0].type, envelope: null }] }];
  const steps = [planStep(fx, ctx.model), ...plan.sections.map(sec => sectionStep(fx, plan, sec, ctx.model)), globalStep(fx, plan, survivors.map(s => ({ ...s, gist: null, blocks: [] })), ctx.model)];
  const out = { dryRun: true, model: ctx.model, provider: ctx.providerTag, modes: {} };
  for (const mode of ["independent", "continuation"]) {
    const contSystem = mode === "continuation" ? contSystemFor(fx.options, fx.sourceLang) : null;
    const history = [];
    out.modes[mode] = {
      confounds: mode === "continuation" ? [CONT_CONFOUND] : [],
      requests: steps.map(step => {
        if (mode === "continuation") history.push({ role: "user", content: JSON.stringify({ stage: step.phase, ...(step.sectionId ? { sectionId: step.sectionId } : {}), instruction: CONT_TASK_INSTRUCTION, input: step.rest, outputSchema: step.outSchema }) });
        const body = buildBody({ mode, step, model: ctx.model, providerTag: ctx.providerTag, cacheKey: ctx.cacheKey, contSystem, history });
        if (mode === "continuation") history.push({ role: "assistant", content: "{}" });
        return {
          phase: step.phase, sectionId: step.sectionId ?? null,
          messages: body.messages.length, estInputTokens: estInputTokens(body),
          maxTokens: body.max_tokens,
          estimatedCostUsd: Math.round((estInputTokens(body) * 2 + body.max_tokens * 10) / 1e6 * 1e6) / 1e6,
          zdr: body.provider.zdr === true && body.provider.data_collection === "deny",
          strictSchema: body.response_format.type === "json_schema",
        };
      }),
    };
  }
  return out;
}

async function checkEndpoint(key, model, tag) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch(ENDPOINTS_API(model), { signal: ctl.signal, headers: { authorization: "Bearer " + key } });
    clearTimeout(t);
    if (!res.ok) return { checked: true, listed: false, error: "http_" + res.status };
    const raw = await res.json();
    const tags = (raw?.data?.endpoints || []).map(e => e.tag);
    return { checked: true, listed: tags.includes(tag), tags: tags.filter(t => typeof t === "string").slice(0, 20) };
  } catch { return { checked: false, listed: null }; }
}

async function main() {
  const { values: v } = parseArgs({
    options: {
      mode: { type: "string", default: "both" },           // independent | continuation | both
      out: { type: "string" },                              // 살균 메트릭 JSON 저장 경로
      "max-cost": { type: "string", default: "2" },         // 실험 1회 예상 상한 USD
      "max-requests": { type: "string", default: "16" },    // 호출 상한
      "timeout-ms": { type: "string", default: "120000" },
      provider: { type: "string" },                         // MODELS 태그 중 하나 (기본: 첫 태그)
      model: { type: "string", default: DEFAULT_MODEL },
      "cache-key": { type: "string", default: "sol-session-bench:v1" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (!["independent", "continuation", "both"].includes(v.mode)) { console.error("--mode must be independent|continuation|both"); process.exit(2); }
  const model = v.model, tags = LLM.MODELS[model]?.tags;
  if (!tags) { console.error("model not in llm.MODELS: " + model); process.exit(2); }
  const providerTag = v.provider || tags[0];
  if (!tags.includes(providerTag)) { console.error("provider tag not allowed for model: " + providerTag); process.exit(2); }
  const maxCostUsd = Number(v["max-cost"]), maxRequests = Number(v["max-requests"]), timeoutMs = Number(v["timeout-ms"]);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) { console.error("--max-cost must be a positive number (USD)"); process.exit(2); }
  if (!Number.isInteger(maxRequests) || maxRequests <= 0) { console.error("--max-requests must be a positive integer"); process.exit(2); }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) { console.error("--timeout-ms must be a positive number"); process.exit(2); }
  const key = process.env.OPENROUTER_API_KEY || null;
  const budget = new Budget({ maxCostUsd, maxRequests });
  const fx = loadFixture();
  const ctx = { model, providerTag, budget, cacheKey: v["cache-key"], send: null };

  if (v["dry-run"]) {
    const out = dryRun(fx, ctx);
    out.keyPresent = Boolean(key);
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (!key) { console.error("OPENROUTER_API_KEY is not set — use --dry-run for offline checks. No paid calls will be made."); process.exit(2); }
  ctx.send = makeHttpSend(key, timeoutMs);

  const endpoint = await checkEndpoint(key, LLM.upstreamOf(model), providerTag);
  if (endpoint.checked && endpoint.listed === false) console.error(`warning: provider tag "${providerTag}" not listed on ${model} endpoints`);

  const modes = v.mode === "both" ? ["independent", "continuation"] : [v.mode];
  const results = { experiment: "sol-session-bench", model, provider: providerTag, endpoint, budget: { maxCostUsd: budget.maxCostUsd, maxRequests: budget.maxRequests, spentEstUsd: 0, requests: 0 }, modes: {} };
  for (const mode of modes) {
    results.modes[mode] = summarize(await runMode(mode, fx, ctx));
  }
  results.budget.spentEstUsd = Math.round(budget.spentEstUsd * 1e6) / 1e6;
  results.budget.requests = budget.requests;
  const json = JSON.stringify(results, null, 2);
  if (v.out) { fs.writeFileSync(v.out, json); console.log("wrote " + v.out); }
  console.log(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e?.message || e); process.exit(1); });
}
