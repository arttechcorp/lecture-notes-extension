const test = require("node:test"), assert = require("node:assert/strict");
const LLM = require("./llm.js");

// 공급자별 프롬프트 캐시 필드를 한 모양으로 정규화한다. 미보고는 null — 보고된 0 과 구분한다.
test("cacheOf: OpenAI·Gemini 모양(prompt_tokens_details.cached_tokens)", () => {
  assert.deepEqual(LLM.cacheOf({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 40 } }),
    { cached_input_tokens: 40, cache_write_tokens: null });
  assert.deepEqual(LLM.cacheOf({ prompt_tokens_details: { cached_tokens: 0 } }),
    { cached_input_tokens: 0, cache_write_tokens: null }, "보고된 0 은 miss(0)다 — null 이 아니다");
});
test("cacheOf: Anthropic 모양(cache_read/cache_creation_input_tokens)", () => {
  assert.deepEqual(LLM.cacheOf({ cache_read_input_tokens: 250, cache_creation_input_tokens: 1000 }),
    { cached_input_tokens: 250, cache_write_tokens: 1000 });
});
test("cacheOf: DeepSeek 모양(prompt_cache_hit_tokens)과 OpenRouter cache_write_tokens", () => {
  assert.deepEqual(LLM.cacheOf({ prompt_cache_hit_tokens: 7, prompt_cache_miss_tokens: 93 }),
    { cached_input_tokens: 7, cache_write_tokens: null });
  assert.deepEqual(LLM.cacheOf({ cache_write_tokens: 11 }), { cached_input_tokens: null, cache_write_tokens: 11 });
});
test("cacheOf: 중첩 cache_write_tokens(Chat prompt_tokens_details·Responses input_tokens_details)", () => {
  // 필드: 중첩 cache_write_tokens 는 읽히지 않아 null 로 남았다 — write 비용이 hit ratio 를 오염시켰다.
  assert.deepEqual(LLM.cacheOf({ prompt_tokens_details: { cached_tokens: 100, cache_write_tokens: 2048 } }),
    { cached_input_tokens: 100, cache_write_tokens: 2048 });
  assert.deepEqual(LLM.cacheOf({ input_tokens: 500, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 256 }, output_tokens: 80, output_tokens_details: { reasoning_tokens: 40 } }),
    { cached_input_tokens: 0, cache_write_tokens: 256 }, "Responses usage 모양");
  assert.deepEqual(LLM.cacheOf({ input_tokens_details: { cached_tokens: 512 } }),
    { cached_input_tokens: 512, cache_write_tokens: null });
  assert.deepEqual(LLM.cacheOf({ input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } }),
    { cached_input_tokens: 0, cache_write_tokens: 0 }, "보고된 0 은 미보고가 아니다");
});
test("cacheOf: 미보고·이상한 값은 null 을 유지한다", () => {
  assert.deepEqual(LLM.cacheOf({ prompt_tokens: 10 }), { cached_input_tokens: null, cache_write_tokens: null });
  assert.deepEqual(LLM.cacheOf({}), { cached_input_tokens: null, cache_write_tokens: null });
  assert.deepEqual(LLM.cacheOf(null), { cached_input_tokens: null, cache_write_tokens: null });
  assert.deepEqual(LLM.cacheOf({ prompt_tokens_details: { cached_tokens: -3 }, cache_read_input_tokens: "x" }),
    { cached_input_tokens: null, cache_write_tokens: null }, "음수·문자열은 미보고로 접는다");
  assert.deepEqual(LLM.cacheOf({ prompt_tokens_details: { cached_tokens: 40.7 } }),
    { cached_input_tokens: 40, cache_write_tokens: null }, "소수는 내린다");
});
