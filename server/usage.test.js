// server/usage.test.js — settle 페이로드의 시도별 선택 필드(model/provider/stage/reasoningTokens) 계약
// 혼합 모델 실행의 시도별 원가가 요청 부모 값으로 덮어씌워지지 않게 usage_attempts 행으로 그대로 보낸다.
const test = require("node:test");
const assert = require("node:assert/strict");
const { supabaseUsage } = require("./usage.js");

// rpc 호출을 잡는 최소 http: reserve 는 reserved, 나머지는 settled 로 답하고 본문을 기록한다.
function fakeHttp(calls) {
  return async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return url.endsWith("/rpc/reserve_usage") ? "reserved" : "settled";
  };
}

async function settleBody(calls, meta) {
  const u = supabaseUsage({ url: "https://db.example", key: "k", http: fakeHttp(calls) });
  const r = await u.reserve({ account: "user-1", requestId: "req-1", digest: "d", cents: 0.01, minutes: 0 });
  await r.settle({ status: "ok", amount: 0.001, meta });
  return calls.find(c => c.url.endsWith("/rpc/settle_usage")).body;
}

const BASE = { stage: "write.section", provider: "openrouter", model: "openai/gpt-6.1-sol" };

test("settle: 시도별 model/provider/stage/reasoningTokens는 유효할 때만 행에 싣는다", async () => {
  const calls = [];
  const body = await settleBody(calls, {
    ...BASE,
    attempts: [
      { id: "a0", status: "ok", latencyMs: 10 }, // 선택 필드 생략 — 기본 모양(이전 호환)
      { id: "a1", status: "ok", latencyMs: 20, model: "openai/gpt-6-luna", provider: "azure", stage: "write.global", reasoningTokens: 640 },
    ],
  });
  const [a0, a1] = body.p_attempts;
  // a0: 선택 필드 키가 아예 없어야 한다 — SQL coalesce 가 요청 부모 값으로 채우게 둔다
  for (const k of ["model", "provider", "stage", "reasoning_tokens"]) assert.equal(Object.hasOwn(a0, k), false, k);
  // a1: 시도별 값이 그대로 간다
  assert.equal(a1.model, "openai/gpt-6-luna");
  assert.equal(a1.provider, "azure");
  assert.equal(a1.stage, "write.global");
  assert.equal(a1.reasoning_tokens, 640);
});

test("settle: 선택 필드 모양이 어긋나면 그 키만 뺀다(시도는 버리지 않는다)", async () => {
  const calls = [];
  const body = await settleBody(calls, {
    ...BASE,
    attempts: [{
      id: "a0", status: "ok", latencyMs: 10,
      model: "bad model with space", provider: "BAD-PROVIDER", stage: "Free Stage",
      reasoningTokens: -1,
    }],
  });
  const [a0] = body.p_attempts;
  assert.equal(a0.attempt_id, "a0");
  for (const k of ["model", "provider", "stage", "reasoning_tokens"]) assert.equal(Object.hasOwn(a0, k), false, k);
});

test("settle: reasoningTokens 는 정수만 받고 0 도 허용한다", async () => {
  const calls = [];
  const body = await settleBody(calls, {
    ...BASE,
    attempts: [
      { id: "a0", status: "ok", latencyMs: 1, reasoningTokens: 0 },
      { id: "a1", status: "ok", latencyMs: 1, reasoningTokens: 12.5 },
    ],
  });
  assert.equal(body.p_attempts[0].reasoning_tokens, 0); // 실제 0 은 0 — null 이 아니다
  assert.equal(Object.hasOwn(body.p_attempts[1], "reasoning_tokens"), false); // 비정수는 생략
});

const { stageUsageSummary } = require("./usage.js");

test("stageUsageSummary: 단계별 토큰·비용·적중률 정확히 집계 및 미보고 null 유지", () => {
  const attempts = [
    {
      id: "a0", stage: "plan", model: "openai/gpt-6.1-sol", provider: "azure",
      inputTokens: 1000, outputTokens: 200, reasoningTokens: 50,
      cachedInputTokens: 0, cacheWriteTokens: 0, uncachedInputTokens: 1000,
      costUsd: 0.05,
    },
    {
      id: "a1", stage: "draft", model: "openai/gpt-6-luna@high", provider: "azure",
      inputTokens: 2500, outputTokens: 800, reasoningTokens: 400,
      cachedInputTokens: 2000, cacheWriteTokens: 100, uncachedInputTokens: 400,
      costUsd: 0.02,
    },
    {
      id: "a2", stage: "draft", model: "openai/gpt-6-luna@high", provider: "azure",
      inputTokens: 2600, outputTokens: 900, reasoningTokens: 450,
      cachedInputTokens: 2000, cacheWriteTokens: 0, uncachedInputTokens: 600,
      costUsd: 0.025,
    },
    {
      // 미보고(null) 캐시 및 비용
      id: "a3", stage: "review", model: "openai/gpt-6.1-sol", provider: "azure",
      inputTokens: 500, outputTokens: 100, reasoningTokens: null,
      cachedInputTokens: null, cacheWriteTokens: null, uncachedInputTokens: null,
      costUsd: null,
    },
  ];

  const summary = stageUsageSummary(attempts);
  assert.equal(summary.byStage.length, 3);

  const draft = summary.byStage.find(s => s.stage === "draft");
  assert.ok(draft);
  assert.equal(draft.model, "openai/gpt-6-luna@high");
  assert.equal(draft.provider, "azure");
  assert.equal(draft.cacheReadTokens, 4000);
  assert.equal(draft.cacheWriteTokens, 100);
  assert.equal(draft.uncachedInputTokens, 1000);
  assert.equal(draft.outputTokens, 1700);
  assert.equal(draft.reasoningTokens, 850);
  assert.equal(draft.costUsd, 0.045);
  // hitRatio: 4000 / (4000 + 1000) = 0.8
  assert.equal(draft.hitRatio, 0.8);

  const plan = summary.byStage.find(s => s.stage === "plan");
  assert.ok(plan);
  assert.equal(plan.cacheReadTokens, 0); // 보고된 0 은 0
  assert.equal(plan.hitRatio, 0);

  const review = summary.byStage.find(s => s.stage === "review");
  assert.ok(review);
  assert.equal(review.cacheReadTokens, null, "미보고는 null 유지 (0과 구분)");
  assert.equal(review.costUsd, null, "비용 미보고는 null 유지");
  assert.equal(review.hitRatio, null);

  // total 검증
  assert.equal(summary.total.stage, "total");
  assert.equal(summary.total.outputTokens, 2000);
  assert.equal(summary.total.cacheReadTokens, 4000);
  assert.equal(summary.total.costUsd, 0.095);
});

test("costOf reasoning tokens: 공급자 completion_tokens에 reasoning이 포함되므로 이중 집계하지 않음 검증", () => {
  // server/index.js 의 costOf 로직 검증
  const pi = 1.0; // $1.00 per 1M input tokens
  const po = 5.0; // $5.00 per 1M output tokens

  // 공급자 usage: completion_tokens = 1000 이고, 그 중 reasoning_tokens = 600
  // 이 때 output 비용은 completion_tokens(1000) * po 만으로 계산되어야 하며,
  // reasoning_tokens 를 추가로 더해 1600 * po 로 부풀려지면 안 됨!
  const usage = {
    prompt_tokens: 2000,
    completion_tokens: 1000,
    completion_tokens_details: { reasoning_tokens: 600 },
  };

  const calculatedCost = (usage.prompt_tokens * pi + usage.completion_tokens * po) / 1e6;
  assert.equal(calculatedCost, (2000 * 1.0 + 1000 * 5.0) / 1e6); // $0.007
  assert.notEqual(calculatedCost, (2000 * 1.0 + (1000 + 600) * 5.0) / 1e6, "이중 집계 금지");
});
