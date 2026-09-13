const test = require("node:test");
const assert = require("node:assert/strict");
const { chunkEvidence, validateSummary, generate, requestId } = require("./summary.js");
const settings = { serviceUrl: "https://summary.example", appSessionToken: "app-token-for-tests".padEnd(32, "x"), remoteSummaryConsent: true };
const evidence = (text, id = "e1") => ({ id, text, t0: 3, t1: 8, source: "ocr" });
function response(items) {
  return { summary: { title: "개념 정리", sections: [{ heading: "비교", content: "서로 다른 개념의 조건을 비교한 설명입니다.", evidenceIds: items.map(e => e.id) }], questions: ["적용 조건의 차이는 무엇인가요?"] }, usage: { promptTokens: 100, completionTokens: 20, costUsd: 0.01 } };
}
test("long multilingual evidence preserves every character and byte-bounds each chunk", () => {
  const original = "한글 😀 p > P 100000 원 \"예시\"\n".repeat(3000);
  const chunks = chunkEvidence([evidence(original)], 12000);
  assert.ok(chunks.length > 3);
  assert.equal(chunks.flat().map(e => e.text).join(""), original);
  for (const c of chunks) assert.ok(Buffer.byteLength(JSON.stringify(c)) <= 12000);
});
test("no connection produces a recoverable state without disclosing evidence", async () => {
  const secret = "비공개 강의 문장";
  const result = await generate([evidence(secret)]);
  assert.equal(result.status, "recognition-only");
  assert.ok(!JSON.stringify(result).includes(secret));
});
test("remote summary requires explicit consent", async () => {
  await assert.rejects(generate([evidence("자료")], { settings: { ...settings, remoteSummaryConsent: false } }), /안내/);
});
test("all chunks, including last one, stay in the final result", async () => {
  const sent = [];
  const result = await generate([evidence("합성 강의 자료 ".repeat(1800)), evidence("후반 핵심 정정", "end")], {
    settings, sessionId: "test", service: { summary: async request => { sent.push(request); return response(request.evidence); } },
  });
  assert.equal(result.status, "complete");
  assert.equal(result.coverage.completed, result.coverage.total);
  assert.ok(sent.some(r => r.evidence.some(e => e.id === "end")));
  assert.ok(result.sections.some(s => s.evidenceIds.includes("end")));
});
test("failed chunk exposes honest partial status and retains completed chapters", async () => {
  let calls = 0;
  await assert.rejects(generate([evidence("시험용 자료 ".repeat(2000))], {
    settings, service: { summary: async request => { if (++calls === 2) throw new Error("quota reached"); return response(request.evidence); } },
  }), error => { assert.equal(error.partial.status, "partial"); assert.equal(error.partial.coverage.completed, 1); assert.ok(error.partial.sections.length); return true; });
});
test("missing IDs and long verbatim copies are rejected", () => {
  const input = [evidence("abcdef0123456789".repeat(30))];
  const out = response(input).summary;
  out.sections[0].evidenceIds = ["invented"];
  assert.throws(() => validateSummary(out, input), /근거/);
  out.sections[0].evidenceIds = ["e1"]; out.sections[0].content = input[0].text;
  assert.throws(() => validateSummary(out, input), /원문/);
});
test("cancelled work never submits and deterministic IDs bind content", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(generate([evidence("테스트")], { settings, signal: controller.signal }), { name: "AbortError" });
  assert.equal(await requestId("s", "chunk", [evidence("A")]), await requestId("s", "chunk", [evidence("A")]));
  assert.notEqual(await requestId("s", "chunk", [evidence("A")]), await requestId("s", "chunk", [evidence("B")]));
});
