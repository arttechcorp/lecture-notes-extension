const assert = require("assert");
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
for (const p of ["anthropic", "gemini"]) {
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
// 빈/이상 응답에도 크래시하지 않아야 한다
assert.deepStrictEqual(parseProviderResponse("anthropic", {}), { text: "", input: 0, output: 0 });
assert.deepStrictEqual(parseProviderResponse("gemini", {}), { text: "", input: 0, output: 0 });

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

console.log("ai: all tests passed");
