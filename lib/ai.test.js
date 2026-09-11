const assert = require("assert");
const fs = require("fs");
const { parseOcrJson, buildOcrBody, buildSummaryBody, parseProviderResponse } = require("./ai.js");

const PNG = "data:image/png;base64,AAAA";
const JPG = "data:image/jpeg;base64,BBBB";

// --- parseOcrJson: 모델이 배열 앞뒤에 말을 붙이는 경우가 흔하다 -------------------
assert.deepStrictEqual(parseOcrJson('["가", "나"]'), ["가", "나"]);
assert.deepStrictEqual(parseOcrJson('네, 결과입니다:\n["가", "나"]\n이상입니다.'), ["가", "나"]);
assert.deepStrictEqual(parseOcrJson('["가", null]'), ["가", ""]);
// JSON이 아예 깨지면 줄 단위로라도 건진다 (전부 날리는 것보다 낫다)
assert.deepStrictEqual(parseOcrJson("첫 줄\n\n  둘째 줄  "), ["첫 줄", "둘째 줄"]);
// 배열이 아닌 JSON은 배열 파싱으로 취급하지 않는다
assert.deepStrictEqual(parseOcrJson('{"a":1}'), ['{"a":1}']);

// --- buildOcrBody: 제공자별 형식 ------------------------------------------------
const a = buildOcrBody("anthropic", "claude-x", [PNG, JPG]);
assert.strictEqual(a.model, "claude-x");
assert.strictEqual(a.messages[0].content.length, 3); // 이미지 2 + 지시문 1
assert.deepStrictEqual(a.messages[0].content[0].source, {
  type: "base64", media_type: "image/png", data: "AAAA",
});
assert.strictEqual(a.messages[0].content[1].source.media_type, "image/jpeg");
assert.ok(a.messages[0].content[2].text.includes("2장"));

const g = buildOcrBody("gemini", "gemini-x", [PNG, JPG]);
assert.strictEqual(g.contents[0].parts.length, 3);
assert.deepStrictEqual(g.contents[0].parts[0].inline_data, { mime_type: "image/png", data: "AAAA" });
assert.ok(g.systemInstruction.parts[0].text.length > 0);

assert.throws(() => buildOcrBody("openai", "m", [PNG]), /알 수 없는 제공자/);

// --- buildSummaryBody: 요약에는 이미지가 절대 들어가면 안 된다 --------------------
// 이 assert가 깨지면 규정 대응(이미지 미송신)이 깨진 것이다.
for (const p of ["anthropic", "gemini", "openrouter"]) {
  const body = JSON.stringify(buildSummaryBody(p, "m", "sys", "본문"));
  assert.ok(!body.includes("image"), `${p} 요약 본문에 이미지가 섞였다`);
  assert.ok(!body.includes("inline_data"), `${p} 요약 본문에 이미지가 섞였다`);
  assert.ok(body.includes("본문"));
}

// --- parseProviderResponse -----------------------------------------------------
assert.deepStrictEqual(
  parseProviderResponse("anthropic", {
    content: [{ text: "가" }, { text: "나" }],
    usage: { input_tokens: 10, output_tokens: 3 },
  }),
  { text: "가나", input: 10, output: 3 }
);
assert.deepStrictEqual(
  parseProviderResponse("gemini", {
    candidates: [{ content: { parts: [{ text: "가" }, { text: "나" }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 },
  }),
  { text: "가나", input: 10, output: 3 }
);
assert.deepStrictEqual(
  parseProviderResponse("openrouter", {
    choices: [{ message: { content: "가나" } }],
    usage: { prompt_tokens: 10, completion_tokens: 3 },
  }),
  { text: "가나", input: 10, output: 3 }
);
// 빈/이상 응답에도 크래시하지 않아야 한다
assert.deepStrictEqual(parseProviderResponse("anthropic", {}), { text: "", input: 0, output: 0 });
assert.deepStrictEqual(parseProviderResponse("gemini", {}), { text: "", input: 0, output: 0 });
assert.deepStrictEqual(parseProviderResponse("openrouter", {}), { text: "", input: 0, output: 0 });

// --- splitScript: 온디바이스 요약용 분할 -------------------------------------------
{
  const { splitScript } = require("./ai.js");
  const lines = (n) => Array.from({ length: n }, (_, i) => `[00:0${i % 10}] 줄 ${i}`).join("\n");

  // 한도 안이면 한 덩어리
  assert.deepStrictEqual(splitScript("짧은 스크립트", 100), ["짧은 스크립트"]);

  // 줄 경계에서만 자른다 — 조각을 다시 붙이면 원본과 같아야 한다
  const src = lines(50);
  const parts = splitScript(src, 60);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 60));
  assert.strictEqual(parts.join("\n"), src);

  // 한 줄이 통째로 한도를 넘으면 그 줄만 강제로 자른다 (무한 루프 방지)
  const huge = splitScript("가".repeat(250), 100);
  assert.deepStrictEqual(huge.map((p) => p.length), [100, 100, 50]);

  // 빈 입력
  assert.deepStrictEqual(splitScript("", 100), []);
}

// --- 제공자 판정이 한 곳에서만 일어나는지 ------------------------------------------
// body 형식 · 엔드포인트 · 응답 파서가 모두 같은 제공자를 봐야 한다. 예전에는
// 호출부가 settings.provider 로 body 를 만들고 callRemote 가 키 모양으로 다시
// 판정해서, 기본 제공자(openrouter)에 Anthropic 키를 넣으면 OpenRouter 형식
// body 가 Anthropic 엔드포인트로 날아갔다.
{
  const { providerForKey, modelForProvider, buildSummaryBody, buildOcrBody } = require("./ai.js");

  // 키 모양이 제공자를 정한다. 설정값은 키가 말이 없을 때만 쓴다.
  assert.strictEqual(providerForKey("sk-ant-abc", "openrouter"), "anthropic");
  assert.strictEqual(providerForKey("sk-or-abc", "anthropic"), "openrouter");
  assert.strictEqual(providerForKey("AIzaSyAbc", "openrouter"), "gemini");
  assert.strictEqual(providerForKey("", "gemini"), "gemini");
  assert.strictEqual(providerForKey("unknown-shape", "anthropic"), "anthropic");

  // 제공자가 바뀌면 저장된 모델 이름은 버린다 — 그 이름은 옛 제공자의 것이다.
  assert.strictEqual(modelForProvider("anthropic", "anthropic", "my-model"), "my-model");
  assert.notStrictEqual(modelForProvider("anthropic", "openrouter", "my-model"), "my-model");

  // 각 제공자의 body 가 그 엔드포인트의 형식을 지키는지.
  const a = buildSummaryBody("anthropic", "m", "SYS", "P");
  assert.ok(a.system === "SYS", "anthropic 은 system 이 최상위여야 한다");
  assert.ok(!a.messages.some((m) => m.role === "system"), "anthropic 은 system 역할 메시지를 받지 않는다");

  const o = buildSummaryBody("openrouter", "m", "SYS", "P");
  assert.ok(o.system === undefined, "openrouter 는 최상위 system 을 쓰지 않는다");
  assert.ok(o.messages.some((m) => m.role === "system"), "openrouter 는 system 을 메시지로 넣는다");

  const g = buildSummaryBody("gemini", "m", "SYS", "P");
  assert.ok(Array.isArray(g.contents) && g.systemInstruction, "gemini 는 contents/systemInstruction 형식");

  // 원격 OCR 은 세 제공자 모두에서 body 를 만들 수 있어야 한다. openrouter 가
  // 기본값인데 예전에는 여기서 "알 수 없는 제공자" 로 던졌다.
  const frame = "data:image/jpeg;base64,AAAA";
  for (const p of ["anthropic", "gemini", "openrouter"]) {
    assert.ok(buildOcrBody(p, "m", [frame]), `buildOcrBody 가 ${p} 를 모른다`);
  }
}

// 비전 OCR 은 글자만이 아니라 그림도 옮겨야 한다. 예전 프롬프트는 "설명을
// 덧붙이지 마라"로 이걸 명시적으로 금지해서, 그래프·표가 통째로 사라졌다.
{
  const ai = fs.readFileSync(require("path").join(__dirname, "ai.js"), "utf8");
  assert.ok(/\[그림\]/.test(ai), "OCR 프롬프트에 그림 설명 지시가 없다 — 도표가 사라진다");
  assert.ok(
    !/설명·추측을 덧붙이지 마라/.test(ai),
    "설명을 금지하는 옛 문구가 남아 있다 — 그림 지시와 모순된다"
  );
}

// --- withTimeout: 온디바이스 AI 프리징 방지 타임아웃 --------------------------------
(async () => {
  const { withTimeout } = require("./ai.js");

  // 정상 완료
  const fast = Promise.resolve("ok");
  assert.strictEqual(await withTimeout(fast, 100, "초과"), "ok");

  // 지연 시 타임아웃 에러 발생
  const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 50));
  await assert.rejects(
    async () => withTimeout(slow, 10, "시간 초과 발생"),
    /시간 초과 발생/
  );

  // 원래 에러 전파
  const errorPromise = Promise.reject(new Error("기존 오류"));
  await assert.rejects(
    async () => withTimeout(errorPromise, 100, "초과"),
    /기존 오류/
  );

  console.log("ai: all tests passed");
})();
