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
