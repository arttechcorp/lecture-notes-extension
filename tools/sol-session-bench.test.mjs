// sol-session-bench.mjs 의 합성 자가 테스트 — 네트워크 없이 mock send 로 두 모드를 끝까지 돌린다.
// fixture(tools/note-fixture/*)의 골든 출력을 canned 응답으로 써서 계획·섹션·전역·조립 전 과정을 검증한다.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Contracts = require("../lib/contracts.js");
const NoteContract = require("../lib/note-contract.js");
const Prompts = require("../server/prompts.js");
const plannerOutput = require("../tools/note-fixture/planner-output.json");
const writer = require("../tools/note-fixture/writer-outputs.json");

const { loadFixture, runMode, summarize, dryRun, Budget, usageMetric, errorEnvelope } = await import("./sol-session-bench.mjs");

const MODEL = "openai/gpt-6.1-sol";
const merged = Object.fromEntries(Object.entries(writer.sections).map(([id, s]) => [id, { ...s.first, blocks: { ...s.first.blocks, ...(s.repair ? s.repair.blocks : {}) } }]));
const CANNED = { plan: JSON.stringify(plannerOutput), global: JSON.stringify(writer.global) };

// 마지막 user 메시지에서 단계를 알아내 골든 출력을 돌려준다.
// continuation 은 {stage,input} 작업 JSON, independent 는 요청 본문(rest) JSON이다.
const phaseOf = body => {
  const last = body.messages.at(-1).content;
  const parsed = JSON.parse(typeof last === "string" ? last : last.map(p => p.text).join(""));
  if (parsed.stage) return { phase: parsed.stage, sectionId: parsed.input?.section?.sectionId };
  if (parsed.ir) return { phase: "plan" };
  if (parsed.section) return { phase: "section", sectionId: parsed.section.sectionId };
  if (parsed.plan) return { phase: "global" };
  throw new Error("unknown phase");
};
const canned = (phase, sectionId) =>
  phase === "plan" ? CANNED.plan : phase === "global" ? CANNED.global : JSON.stringify(merged[sectionId]);

// 캡처용 mock send — usage 는 호출마다 cached 값을 달리해 null/0/hit 구분을 확인한다.
function mockSend(captured, { cachedSeq = [] } = {}) {
  let n = 0;
  return async body => {
    const { phase, sectionId } = phaseOf(body);
    const content = canned(phase, sectionId);
    const cached = cachedSeq.length ? cachedSeq[n % cachedSeq.length] : 0;
    n++;
    captured.push({ body, content });
    return {
      status: 200, ok: true,
      raw: {
        choices: [{ message: { content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1000 + n * 100, completion_tokens: 500, cost: 0.005, prompt_tokens_details: { cached_tokens: cached }, completion_tokens_details: { reasoning_tokens: 200 } },
      },
    };
  };
}
const ctxOf = (send, opts = {}) => ({
  model: MODEL, providerTag: "azure", send, cacheKey: "sol-session-bench:test",
  budget: new Budget({ maxCostUsd: 2, maxRequests: 16 }), ...opts,
});

// 1. continuation: 접두가 정확히 같고 assistant 응답이 턴 사이에 원문 그대로 보존된다.
test("continuation resends exact prior system/user/assistant prefix each turn", async () => {
  const captured = [];
  const res = await runMode("continuation", loadFixture(), ctxOf(mockSend(captured), { budget: new Budget() }));
  assert.equal(res.plan.status, "ok");
  assert.equal(captured.length, 7, "plan + 5 sections + global");

  const sys0 = captured[0].body.messages[0];
  assert.equal(sys0.role, "system");
  // 공유 시스템은 각 단계의 운영 규칙 전문을 원문 그대로 담아야 한다 — 줄 단위 병합으로 문구를 깨면 안 된다
  const opts = NoteContract.policyOf(undefined);
  for (const st of ["plan", "section", "global"])
    assert.ok(sys0.content.includes(Prompts.systemFor(st, opts, undefined)), st + " 단계 규칙 전문이 공유 prefix 에 그대로 있어야 한다");
  for (const { body } of captured) {
    assert.deepEqual(body.messages[0], sys0, "시스템은 모든 턴에서 동일");
    assert.deepEqual(body.response_format, { type: "json_object" }, "모든 턴에 같은 response_format");
    assert.equal(body.prompt_cache_key, "sol-session-bench:test", "안정된 캐시 라우팅 키");
    assert.deepEqual(body.provider, { only: ["azure"], order: ["azure"], require_parameters: true, allow_fallbacks: false, zdr: true, data_collection: "deny" });
    assert.equal(body.model, MODEL);
  }
  captured.forEach(({ body }, i) => {
    assert.equal(body.messages.length, 2 + 2 * i, `turn ${i}: system + ${i}쌍 + 새 user`);
    // k+1 번째 요청의 접두 = k 번째 요청 전체 + 방금 받은 assistant 1건
    if (i > 0) {
      const prev = captured[i - 1];
      assert.deepEqual(body.messages.slice(0, prev.body.messages.length), prev.body.messages, `turn ${i} 접두 불일치`);
      assert.deepEqual(body.messages[prev.body.messages.length], { role: "assistant", content: prev.content }, `turn ${i}: assistant 원문 보존`);
    }
    const roles = body.messages.map(m => m.role).slice(1).join(",");
    assert.equal(roles, Array.from({ length: i + 1 }, () => "user,assistant").join(",").replace(/,assistant$/, ""));
  });
  // 계획 입력이 두 번째 턴의 user 에 그대로 남고, assistant 계획 응답이 원문 그대로 보존된다
  const t2 = JSON.parse(captured[1].body.messages[1].content);
  assert.ok(t2.input.ir, "plan input이 후속 턴에 재전송된다");
  assert.equal(captured[1].body.messages[2].content, CANNED.plan, "assistant plan 응답 원문 보존");
});

// 2. independent: 운영과 같은 독립 요청 — strict json_schema, 시스템+입력 2메시지.
test("independent sends production-style requests: strict schema, cached system, zdr deny", async () => {
  const captured = [];
  const res = await runMode("independent", loadFixture(), ctxOf(mockSend(captured)));
  assert.equal(res.plan.status, "ok");
  assert.equal(captured.length, 7);
  for (const { body } of captured) {
    assert.equal(body.messages.length, 2, "system + user 만");
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.ok(!("prompt_cache_key" in body), "Sol 은 운영에서 캐시 키를 보내지 않는다");
    assert.equal(body.provider.data_collection, "deny");
    assert.equal(body.provider.zdr, true);
    assert.equal(body.reasoning.effort, "medium");
    assert.equal(body.seed, 7);
    assert.ok(!("temperature" in body), "Sol 은 temperature 를 거절한다");
    // user 본문은 운영과 같은 rest 직렬화 — 단계 계약을 그대로 통과해야 한다
    const { phase } = phaseOf(body);
    const rest = JSON.parse(typeof body.messages[1].content === "string" ? body.messages[1].content : body.messages[1].content.map(p => p.text).join(""));
    assert.ok(Contracts.validate(Prompts.REQUEST[phase], rest).ok, phase + " request contract");
  }
});

// 3. 두 모드 모두 끝까지 돌아 노트가 조립된다 — 섹션·전역 모두 ok/failed/skipped 로 표시.
test("both modes run all phases and assemble a note with counts only", async () => {
  for (const mode of ["independent", "continuation"]) {
    const res = summarize(await runMode(mode, loadFixture(), ctxOf(mockSend([]))));
    assert.equal(res.plan.status, "ok", mode);
    assert.equal(res.sections.length, 5, mode + ": 계획된 섹션 전부 실행");
    assert.ok(res.sections.every(s => s.ok === true || s.ok === false), mode + ": 각 섹션 검증 결과 표시");
    assert.equal(res.global.status, "ok", mode);
    assert.equal(res.note.status, "partial", mode + ": 골든과 같이 S3_B4 손실로 partial");
    assert.equal(res.note.sections, 5, mode);
    assert.equal(res.note.globalBlocks, 2, mode);
    assert.ok(res.note.questions >= 1, mode);
    assert.ok(res.totals.inputTokens > 0 && res.totals.outputTokens > 0, mode);
    if (mode === "continuation") assert.ok(res.confounds.length === 1 && res.confounds[0].includes("json_object"), "confound 명시");
    else assert.equal(res.confounds.length, 0);
  }
});

// 4. 토큰 메트릭: 미보고는 null, 보고된 0 은 0 — 둘을 섞으면 캐시 적중률이 오염된다.
test("usageMetric distinguishes unreported (null) from reported zero", () => {
  const miss = usageMetric({ prompt_tokens: 10, completion_tokens: 5 });
  assert.equal(miss.cachedInputTokens, null);
  assert.equal(miss.cacheWriteTokens, null);
  assert.equal(miss.reasoningTokens, null);
  assert.equal(miss.reportedCostUsd, null);
  assert.equal(miss.costStatus, "estimated");
  const hit = usageMetric({ prompt_tokens: 10, completion_tokens: 5, cost: 0, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 } });
  assert.equal(hit.cachedInputTokens, 0, "보고된 0(miss)은 0으로 보존");
  assert.equal(hit.reasoningTokens, 0);
  assert.equal(hit.reportedCostUsd, 0);
  assert.equal(hit.costStatus, "provider_reported");
  assert.equal(usageMetric({}).costStatus, "unreported");
  assert.equal(usageMetric({}).inputTokens, null);
  // cache_write_tokens: prompt_tokens_details 를 먼저 읽고(LLM.cacheOf 누락 보완), 미보고 null / 보고 0 구분
  assert.equal(usageMetric({}).cacheWriteTokens, null);
  assert.equal(usageMetric({ prompt_tokens_details: { cache_write_tokens: 0 } }).cacheWriteTokens, 0);
  assert.equal(usageMetric({ prompt_tokens_details: { cache_write_tokens: 120 } }).cacheWriteTokens, 120);
  assert.equal(usageMetric({ cache_creation_input_tokens: 40 }).cacheWriteTokens, 40, "Anthropic 계열 fallback");
});

// 5. 요청·비용 상한: cap 에 걸리면 보내지 않고 skipped_budget 으로 표시한다.
test("request and cost budgets halt before sending and mark skipped_budget", async () => {
  let sent = 0;
  const counting = async body => { sent++; return mockSend([])(body); };
  // 요청 1건만 허용 — 계획만 나가고 섹션·전역은 전부 skipped_budget
  const res1 = await runMode("independent", loadFixture(), ctxOf(counting, { budget: new Budget({ maxCostUsd: 100, maxRequests: 1 }) }));
  assert.equal(sent, 1);
  assert.equal(res1.plan.status, "ok");
  assert.equal(res1.calls.filter(c => c.status === "skipped_budget").length, 5, "5개 섹션이 전부 예산으로 건너뛴다");
  assert.equal(res1.global.status, "skipped_no_survivors");
  // 비용 상한 0 — 계획 자체가 안 나간다
  sent = 0;
  const res2 = await runMode("independent", loadFixture(), ctxOf(counting, { budget: new Budget({ maxCostUsd: 0.000001, maxRequests: 16 }) }));
  assert.equal(sent, 0);
  assert.equal(res2.plan.status, "skipped_budget");
});

// 5-b. 전송이 실패해도 요청수·비용 추정을 상한에서 보수적으로 뺀다.
test("a failed send still consumes request and estimated-cost budget", async () => {
  const budget = new Budget({ maxCostUsd: 100, maxRequests: 3 });
  const boom = async () => { throw new Error("network down"); };
  const res = await runMode("independent", loadFixture(), ctxOf(boom, { budget }));
  assert.equal(res.plan.status, "failed");
  assert.equal(res.calls[0].status, "failed");
  assert.equal(budget.requests, 1, "전송 시도한 호출은 요청수에 센다");
  assert.ok(budget.spentEstUsd > 0, "gate.est 를 비용 추정에 센다");
});

// 6. 메트릭 출력에 키·프롬프트·모델·강의 내용이 새지 않는다.
test("sanitized metrics contain no secrets, prompts, or lecture content", async () => {
  const res = summarize(await runMode("continuation", loadFixture(), ctxOf(mockSend([]))));
  const json = JSON.stringify(res);
  for (const forbidden of [
    "Bearer", "OPENROUTER", "sk-or",
    "당신은 대학 강의를", "대체 금지", // 시스템 프롬프트 본문
    "2026123456", "월 고정비(FC)", "손익분기 판매량 계산", // fixture 슬라이드 본문
    JSON.stringify(plannerOutput).slice(0, 60), // 계획 원문
  ]) assert.ok(!json.includes(forbidden), "metrics leaked: " + forbidden.slice(0, 24));
  // 에러 코드·개수·id 만 남는다
  for (const s of res.sections) for (const c of s.errorCodes || []) assert.match(c, /^[A-Z0-9_]+$/);
});

// 7. dry-run: 두 모드의 요청이 전부 컴파일되고 안전 플래그가 붙는다 — 네트워크 없음.
test("dry-run compiles valid requests for both modes without network", () => {
  const fx = loadFixture();
  const out = dryRun(fx, ctxOf(null, { send: null }));
  assert.equal(out.dryRun, true);
  for (const mode of ["independent", "continuation"]) {
    const reqs = out.modes[mode].requests;
    assert.equal(reqs.length, 7, mode);
    assert.deepEqual(reqs.map(r => r.phase), ["plan", "section", "section", "section", "section", "section", "global"]);
    for (const r of reqs) {
      assert.equal(r.zdr, true);
      assert.ok(r.estInputTokens > 0);
      assert.ok(r.maxTokens > 0);
    }
    assert.equal(reqs.every(r => r.strictSchema), mode === "independent", mode + " schema mode");
  }
  assert.equal(out.modes.continuation.confounds.length, 1);
});

// 9. raw.error 봉투: HTTP 200 본문 오류를 숫자 코드·허용 분류로만 기록한다 — message/metadata 원문 금지.
// 필드 관측: Azure 로 나간 호출이 200 인데 choices·usage 없이 돌아온 사례를 재현한다.
test("raw.error envelope records numeric code and allowlisted category, never message text", async () => {
  const env200 = async () => ({ status: 200, ok: true, raw: { id: "gen-x", error: { code: 404, message: "No endpoints found matching your data collection requirements for seed", metadata: { error_type: "no_endpoints", provider_name: "Azure", upstream: "SECRET-UPSTREAM-TEXT" } } } });
  const res = await runMode("independent", loadFixture(), ctxOf(env200));
  const m = res.calls[0];
  assert.equal(m.status, "failed");
  assert.deepEqual(m.errorCodes, ["provider_error_404"]);
  assert.equal(m.errorCategory, "no_endpoints");
  assert.equal(m.errorType, "no_endpoints");
  const json = JSON.stringify(summarize(res));
  for (const forbidden of ["SECRET-UPSTREAM-TEXT", "No endpoints found matching", "provider_name", "data collection requirements"])
    assert.ok(!json.includes(forbidden), "envelope text leaked: " + forbidden);
});
test("errorEnvelope maps numeric and string codes to allowlisted categories", () => {
  const c = (code, message, metadata) => errorEnvelope({ error: { code, message, metadata } });
  assert.deepEqual(c(402, "You need more credits"), { code: "provider_error_402", category: "insufficient_credits", errorType: null });
  assert.equal(c(400, "seed is not a supported parameter for this model").category, "unsupported_parameter");
  assert.equal(c(429, "Rate limit exceeded").category, "rate_limit");
  assert.equal(c(401, "Invalid API key").category, "auth");
  assert.equal(c(408, "Request timed out").category, "timeout");
  assert.equal(c(500, "upstream exploded").category, "provider_error");
  // 비숫자 코드는 제공자 자유 문자열이라 부분 문자열도 메트릭에 남기지 않는다 — 고정 라벨로 접는다
  const s = c("no_endpoints_found", "No endpoints available");
  assert.equal(s.code, "provider_body_error");
  assert.equal(s.category, "no_endpoints", "분류는 code+message 스캔으로 유지");
  assert.equal(errorEnvelope({ error: {} }).code, "provider_body_error");
  assert.equal(errorEnvelope({ error: { code: "leaky secret phrase inside" } }).code, "provider_body_error");
  assert.equal(errorEnvelope({ choices: [] }), null);
});
// 필드 관측 재현: HTTP200 {id, error:{code:429, metadata:{error_type}}} — 식별자를 숫자 코드와 함께 남긴다.
test("errorEnvelope keeps metadata.error_type identifiers and drops free-form values", () => {
  const obs = errorEnvelope({ id: "gen-x", error: { code: 429, message: "Rate limited", metadata: { error_type: "rate_limited" } } });
  assert.deepEqual(obs, { code: "provider_error_429", category: "rate_limit", errorType: "rate_limited" });
  // 식별자 형식이 아니면(공백·태그·장문) 버린다 — 자유 문자열이 메트릭에 섞이지 않는다
  for (const bad of ["rate limited, try later", "<b>x</b>", "x".repeat(80), 429, null])
    assert.equal(errorEnvelope({ error: { code: 429, metadata: { error_type: bad } } }).errorType, null, JSON.stringify(bad));
  // 끝까지 통합 경로: 200 본문 오류가 errorType 까지 메트릭에 남는다
});

// 8. continuation 에서 실패한 턴은 대화에 남지 않는다 — 다음 요청 접두가 성공 턴만 담는다.
test("a failed continuation turn is rolled back from the resend prefix", async () => {
  const captured = [];
  let n = 0;
  const flaky = async body => {
    n++;
    captured.push(body);
    if (n === 3) return { status: 500, ok: false, raw: { error: { code: "x" } } }; // 2번째 섹션을 일부러 실패
    return mockSend([])(body);
  };
  const res = await runMode("continuation", loadFixture(), ctxOf(flaky));
  assert.equal(res.calls[2].status, "failed");
  const after = captured[3]; // 실패 다음 요청
  // 성공한 plan + S1 만 접두에 있어야 한다: system + (u1,a1,u2,a2) + new user = 6
  assert.equal(after.messages.length, 6);
  const tasks = after.messages.filter(m => m.role === "user").map(m => JSON.parse(m.content));
  assert.deepEqual(tasks.map(t => t.stage), ["plan", "section", "section"]);
});
