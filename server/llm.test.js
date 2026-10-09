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

test("commonPrefixLength: 두 문자열의 공통 바이트 접두 길이를 정확히 측정", () => {
  assert.equal(LLM.commonPrefixLength("abcdef", "abcxyz"), 3);
  assert.equal(LLM.commonPrefixLength("hello", "world"), 0);
  assert.equal(LLM.commonPrefixLength("same", "same"), 4);
  assert.equal(LLM.commonPrefixLength("", "test"), 0);
});

test("orderUserPayload: independent(isV3=false)는 바이트 불변, v3(isV3=true)는 공통 키를 앞으로", () => {
  const dynamicFirst = JSON.stringify({ section: { sectionId: "S1" }, concepts: [{ id: "C1" }], options: { x: 1 } });
  // isV3 = false: 원본 문자열 불변
  assert.equal(LLM.orderUserPayload(dynamicFirst, "draft", false), dynamicFirst);

  // isV3 = true: concepts, options 가 section 보다 앞으로 재배치
  const reordered = LLM.orderUserPayload(dynamicFirst, "draft", true);
  const parsed = JSON.parse(reordered);
  const keys = Object.keys(parsed);
  assert.deepEqual(keys, ["concepts", "options", "section"]);
});

test("cachedUser (draft): v3 요청은 서로 다른 두 섹션의 공통 접두 길이가 기준 이상이며 동적 값이 없음", () => {
  const model = "openai/gpt-6-luna@high";
  const commonConcepts = [{ conceptId: "C1", name: "Entropy" }];
  const commonOptions = { syntheticExamples: false };
  const commonAllowedRefs = { targetIds: ["T_TARGET_1", "T_TARGET_2"] };

  const s1Input = JSON.stringify({
    section: { sectionId: "SECTION_ALPHA", title: "First Section" },
    concepts: commonConcepts,
    options: commonOptions,
    allowedRefs: commonAllowedRefs,
    evidence: [{ id: "U1.s1", text: "evidence 1" }],
  });

  const s2Input = JSON.stringify({
    section: { sectionId: "SECTION_BETA", title: "Second Section" },
    concepts: commonConcepts,
    options: commonOptions,
    allowedRefs: commonAllowedRefs,
    evidence: [{ id: "U2.s1", text: "evidence 2" }],
  });

  // v3 캐시 처리
  const s1Msg = LLM.cachedUser(model, s1Input, "draft", { isV3: true });
  const s2Msg = LLM.cachedUser(model, s2Input, "draft", { isV3: true });

  assert.equal(Array.isArray(s1Msg.content), true, "cachedUser should split into ephemeral head and tail");
  assert.equal(Array.isArray(s2Msg.content), true);
  assert.equal(s1Msg.content[0].type, "text");
  assert.deepEqual(s1Msg.content[0].cache_control, { type: "ephemeral" });

  // 공통 접두 텍스트가 정확히 일치해야 함
  assert.equal(s1Msg.content[0].text, s2Msg.content[0].text);

  // 공통 접두 블록에 동적 값(섹션 ID, 근거 ID)이 없음을 검증
  const headText = s1Msg.content[0].text;
  assert.ok(!headText.includes("SECTION_ALPHA"), "공통 접두에 SECTION_ALPHA 섹션 ID가 없어야 함");
  assert.ok(!headText.includes("SECTION_BETA"), "공통 접두에 SECTION_BETA 섹션 ID가 없어야 함");
  assert.ok(!headText.includes("U1.s1"), "공통 접두에 U1 근거 ID가 없어야 함");
  assert.ok(!headText.includes("First Section"), "공통 접두에 섹션 타이틀이 없어야 함");
  assert.ok(headText.includes("Entropy"), "공통 접두에 concepts가 포함되어야 함");

  // 직렬화된 두 메시지의 공통 접두 길이 측정
  const s1Json = JSON.stringify(s1Msg);
  const s2Json = JSON.stringify(s2Msg);
  const prefixLen = LLM.commonPrefixLength(s1Json, s2Json);

  // 공통 접두 길이는 headText 길이를 온전히 포함해야 함
  assert.ok(prefixLen >= headText.length, `공통 접두 길이(${prefixLen})가 headText 길이(${headText.length}) 이상이어야 함`);
});

test("cachedUser (questions): v3 요청은 섹션이 달라도 공통 문맥 접두를 온전히 공유", () => {
  const model = "openai/gpt-6-luna@high";
  const commonConcepts = [{ conceptId: "C1", name: "Physics" }];
  const commonSections = [{ sectionId: "S1", title: "Summary of S1" }, { sectionId: "S2", title: "Summary of S2" }];
  const commonOptions = { syntheticExamples: false };
  const commonAllowedRefs = { targetIds: ["S1/B1"] };

  const q1Input = JSON.stringify({
    section: { sectionId: "S1" },
    blockId: "S1/B14",
    concepts: commonConcepts,
    sections: commonSections,
    options: commonOptions,
    allowedRefs: commonAllowedRefs,
  });

  const q2Input = JSON.stringify({
    section: { sectionId: "S2" },
    blockId: "S2/B14",
    concepts: commonConcepts,
    sections: commonSections,
    options: commonOptions,
    allowedRefs: commonAllowedRefs,
  });

  const q1Msg = LLM.cachedUser(model, q1Input, "questions", { isV3: true });
  const q2Msg = LLM.cachedUser(model, q2Input, "questions", { isV3: true });

  assert.equal(Array.isArray(q1Msg.content), true);
  assert.equal(Array.isArray(q2Msg.content), true);
  assert.equal(q1Msg.content[0].text, q2Msg.content[0].text);

  const headText = q1Msg.content[0].text;
  assert.ok(!headText.includes("S1/B14"), "공통 접두에 blockId가 없어야 함");
  assert.ok(!headText.includes("S2/B14"), "공통 접두에 blockId가 없어야 함");
  assert.ok(headText.includes("Physics"), "공통 접두에 concepts가 포함되어야 함");
  assert.ok(headText.includes("Summary of S1"), "공통 접두에 전체 sections 요약이 포함되어야 함");
});

test("toLiner: GPT-6 모델만 Liner 로 — provider·미지원 칸 제거, 키 교체, 그 외는 변환 없음",()=>{
  const L={key:"k-liner",base:"https://liner.example/api/v1/"},hdr={authorization:"Bearer or",x:"1"};
  const r=LLM.toLiner("https://openrouter.ai/api/v1/responses",{headers:hdr,body:JSON.stringify({model:"openai/gpt-6.1-sol",provider:{only:["azure"]},prompt_cache_options:{mode:"explicit"},reasoning:{effort:"medium",context:"all_turns"},session_id:"s"})},L);
  assert.equal(r[0],"https://liner.example/api/v1/responses");
  const b=JSON.parse(r[1].body);assert.deepEqual([b.provider,b.prompt_cache_options,b.reasoning.context,b.reasoning.effort,b.session_id],[undefined,undefined,undefined,"medium","s"]);
  assert.equal(r[1].headers.authorization,"Bearer k-liner");assert.equal(r[1].headers.x,"1");
  const c=LLM.toLiner("https://openrouter.ai/api/v1/chat/completions",{headers:hdr,body:JSON.stringify({model:"openai/gpt-6-luna",provider:{},prompt_cache_options:{mode:"explicit"},reasoning:{effort:"high"},response_format:{}})},L);
  const cb=JSON.parse(c[1].body);assert.deepEqual([cb.provider,cb.reasoning,cb.prompt_cache_options,cb.reasoning_effort],[undefined,undefined,undefined,"high"]);
  assert.equal(LLM.toLiner("https://openrouter.ai/api/v1/chat/completions",{headers:hdr,body:JSON.stringify({model:"xiaomi/mimo-v2.6-flash"})},L),null);
  assert.equal(LLM.toLiner("https://openrouter.ai/api/v1/chat/completions",{headers:hdr,body:JSON.stringify({model:"openai/gpt-6-luna"})},{}),null);
});
