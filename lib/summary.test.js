const test = require("node:test");
const assert = require("node:assert/strict");
const { chunkEvidence, preprocessEvidence, validateSummary, generate, requestId } = require("./summary.js");
const settings = { serviceUrl: "https://summary.example", appSessionToken: "app-token-for-tests".padEnd(32, "x"), remoteSummaryConsent: true };
const evidence = (text, id = "e1", extra = {}) => ({ id, text, t0: 3, t1: 8, source: "ocr", ...extra });
const LISTS = ["concepts", "claims", "definitions", "relationships", "examples", "corrections", "openQuestions"];
function response(items) {
  const ids = [...new Set(items.map(e => e.id))], item = { content: "서로 다른 개념의 조건을 비교한 설명입니다.", importance: "important", evidenceIds: ids };
  const summary = {
    title: "개념 정리", keyConclusions: [item], sections: [{ heading: "비교", ...item }], formulas: [], visuals: [],
    reviewQuestions: [{ question: "적용 조건의 차이는 무엇인가요?", evidenceIds: ids }], evidenceIds: ids,
  };
  for (const field of LISTS) summary[field] = [];
  return { summary, usage: { promptTokens: 100, completionTokens: 20, costUsd: 0.01 } };
}
test("long multilingual evidence preserves every character and byte-bounds each chunk", () => {
  const original = "한글 😀 p > P 100000 원 \"예시\"\n".repeat(9000);
  const chunks = chunkEvidence([evidence(original)], 36000);
  assert.ok(chunks.length > 3);
  assert.equal(chunks.flat().map(e => e.text).join(""), original);
  for (const c of chunks) assert.ok(Buffer.byteLength(JSON.stringify(c)) <= 36000);
});
test("preprocessing is non-destructive and only filters exact OCR duplicates", () => {
  const input = [
    evidence("P > p, 100000 원", "first", { slideId: "s1", bbox: { x: 0, y: 0, w: 1, h: 1 } }),
    evidence("P > p, 100000 원", "duplicate", { slideId: "s1", bbox: { x: 0, y: 0, w: 1, h: 1 }, t0: 9, t1: 10 }),
    evidence("P > p, 100000 원", "spoken", { source: "asr", t0: 9, t1: 10 }),
    evidence("불명확한 수식", "uncertain", { confidence: .2 }),
    evidence("  공백\n정돈  ", "normalized", { t0: 11, t1: 12 }),
    evidence("이전 OCR", "superseded", { status: "superseded", t0: 13, t1: 14 }),
    evidence("   ", "empty", { t0: 15, t1: 16 }),
  ];
  const out = preprocessEvidence(input);
  assert.equal(out.find(e => e.id === "duplicate").selection, "filtered");
  assert.equal(out.find(e => e.id === "spoken").selection, "included");
  assert.deepEqual(out.find(e => e.id === "first").relatedEvidenceIds, ["spoken"]);
  assert.deepEqual(out.find(e => e.id === "spoken").relatedEvidenceIds, ["first"]);
  assert.equal(out.find(e => e.id === "uncertain").selection, "uncertain");
  assert.equal(out.find(e => e.id === "normalized").text, "공백 정돈");
  assert.equal(out.find(e => e.id === "superseded").selection, "filtered");
  assert.equal(out.find(e => e.id === "empty").selection, "filtered");
  assert.equal(input.find(e => e.id === "normalized").text, "  공백\n정돈  ");
  assert.equal(input.some(e => "selection" in e), false);
  assert.match(JSON.stringify(out), /100000/);
});
test("no connection produces a recoverable state without disclosing evidence", async () => {
  const secret = "비공개 강의 문장", result = await generate([evidence(secret)]);
  assert.equal(result.status, "recognition-only");
  assert.ok(!JSON.stringify(result).includes(secret));
});
test("OpenRouter credentials reach the selected summary client without entering evidence", async () => {
  const apiKey = "sk-or-v1-" + "a".repeat(32);
  let request;
  await generate([evidence("요약 대상")], {
    settings: { openRouterApiKey: apiKey, summaryModel: "google/gemini-2.5-flash-lite", remoteSummaryConsent: true },
    service: { summary: async value => { request = value; return response(value.evidence); } },
  });
  assert.equal(request.apiKey, apiKey);
  assert.equal(JSON.stringify(request.evidence).includes(apiKey), false);
});
test("remote summary requires explicit consent", async () => {
  await assert.rejects(generate([evidence("자료")], { settings: { ...settings, remoteSummaryConsent: false } }), /안내/);
});
test("all chunks are followed by mandatory whole-note synthesis", async () => {
  const sent = [];
  const result = await generate([evidence("합성 강의 자료 ".repeat(7000)), evidence("후반 핵심 정정", "end")], {
    settings, sessionId: "test", service: { summary: async request => { sent.push(request); return response(request.evidence); } },
  });
  assert.equal(result.status, "complete");
  assert.equal(result.coverage.completed, result.coverage.total);
  assert.equal(result.coverage.synthesis, true);
  assert.ok(sent.some(r => r.stage === "synthesis"));
  assert.ok(result.evidenceIds.includes("end"));
});
test("failed chunk exposes honest partial status and retains completed chapters", async () => {
  let calls = 0;
  await assert.rejects(generate([evidence("시험용 자료 ".repeat(7000))], {
    settings, service: { summary: async request => { if (++calls === 2) throw new Error("quota reached"); return response(request.evidence); } },
  }), error => {
    assert.equal(error.partial.status, "partial"); assert.equal(error.partial.coverage.completed, 1);
    assert.ok(error.partial.sections.length); assert.ok(error.partial.coverage.unprocessed.length); assert.ok(error.partial.coverage.unprocessed[0].evidenceIds.includes("e1"));
    return true;
  });
});
test("missing coverage IDs and long verbatim copies are rejected", () => {
  const input = [evidence("abcdef0123456789".repeat(30))], out = response(input).summary;
  out.evidenceIds = ["invented"];
  assert.throws(() => validateSummary(out, input), /근거/);
  out.evidenceIds = ["e1"]; out.sections[0].content = input[0].text;
  assert.throws(() => validateSummary(out, input), /원문/);
});
test("cancelled work never submits and deterministic IDs bind content", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(generate([evidence("테스트")], { settings, signal: controller.signal }), { name: "AbortError" });
  assert.equal(await requestId("s", "chunk", [evidence("A")]), await requestId("s", "chunk", [evidence("A")]));
  assert.notEqual(await requestId("s", "chunk", [evidence("A")]), await requestId("s", "chunk", [evidence("B")]));
});
