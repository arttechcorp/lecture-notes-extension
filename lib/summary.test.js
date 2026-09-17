const test = require("node:test");
const assert = require("node:assert/strict");
const { chunkEvidence, preprocessEvidence, validateSummary, generate, requestId } = require("./summary.js");
const settings = { serviceUrl: "https://summary.example", appSessionToken: "app-token-for-tests".padEnd(32, "x"), remoteSummaryConsent: true };
const evidence = (text, id = "e1", extra = {}) => ({ id, text, t0: 3, t1: 8, source: "ocr", ...extra });
const LISTS = ["concepts", "corrections", "openQuestions"];
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
test("환각 근거 id 는 걸러내고, 남는 게 없는 항목만 버린다", () => {
  const input = [evidence("첫 근거", "e1"), evidence("둘째 근거", "e2")];
  // 정상 id 와 섞여 있으면 없는 id 만 빼고 항목은 살린다 — 통째로 버리면 커버리지 검사가 되살아난다.
  const mixed = response(input).summary;
  mixed.keyConclusions[0].evidenceIds = ["e1", "invented", "e2"];
  assert.deepEqual(validateSummary(mixed, input).keyConclusions[0].evidenceIds, ["e1", "e2"]);
  // 전부 환각이면 그 항목만 사라지고 나머지 요약은 통과한다. 예전엔 여기서 청크 전체가 죽었다.
  const bad = response(input).summary;
  bad.corrections = [{ content: "앞서 말한 값을 정정합니다.", importance: "important", evidenceIds: ["invented"] }];
  const checked = validateSummary(bad, input);
  assert.equal(checked.corrections.length, 0);
  assert.ok(checked.sections.length);
  assert.deepEqual(checked.evidenceIds, ["e1", "e2"]);
});
test("근거를 잃은 항목이 전부라면 빈 요약으로 막는다", () => {
  const input = [evidence("근거")], out = response(input).summary;
  for (const f of ["keyConclusions", "sections", "reviewQuestions"]) for (const v of out[f]) v.evidenceIds = ["invented"];
  assert.throws(() => validateSummary(out, input), /핵심 결론/);
});
test("원문이 길게 재현된 요약은 막는다", () => {
  const input = [evidence("abcdef0123456789".repeat(30))], out = response(input).summary;
  out.sections[0].content = input[0].text;
  assert.throws(() => validateSummary(out, input), /원문/);
});
test("top-level evidenceIds are derived from items, not dictated by the model", () => {
  const input = [evidence("첫 근거", "e1"), evidence("둘째 근거", "e2")], out = response(input).summary;
  // 모델이 최상위 목록을 빼먹거나 틀리게 줘도, 항목들이 근거를 모두 인용했으면 통과한다.
  delete out.evidenceIds;
  assert.deepEqual(validateSummary(out, input).evidenceIds, ["e1", "e2"]);
  // 반대로 어떤 항목도 인용하지 않은 근거가 있으면 그때는 진짜로 막는다.
  for (const f of ["keyConclusions", "sections", "reviewQuestions"]) for (const v of out[f]) v.evidenceIds = ["e1"];
  assert.throws(() => validateSummary(out, input), /처리되지 않은 근거/);
  assert.deepEqual(validateSummary(out, input, { requireCoverage: false }).evidenceIds, ["e1"]);
});
test("cancelled work never submits and deterministic IDs bind content", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(generate([evidence("테스트")], { settings, signal: controller.signal }), { name: "AbortError" });
  assert.equal(await requestId("s", "chunk", [evidence("A")]), await requestId("s", "chunk", [evidence("A")]));
  assert.notEqual(await requestId("s", "chunk", [evidence("A")]), await requestId("s", "chunk", [evidence("B")]));
});

test("끊긴 구간은 노트에 경고로 남고 모델에게도 따로 전달된다", async () => {
  const { gapRanges, gapNotice } = require("./summary.js");

  // 같은 이유가 연달아 찍힌 것은 한 구간이다. gap 은 시각 하나만 기록하므로
  // 실제로 찍힌 첫/마지막 시각만 쓰고 없는 구간을 지어내지 않는다.
  const ranges = gapRanges([
    { time: 750, reason: "audio-capacity" }, { time: 770, reason: "audio-capacity" },
    { time: 1120, reason: "video-offscreen" }, { time: Number.NaN, reason: "ocr-failed" },
  ]);
  assert.deepEqual(ranges, [
    { reason: "audio-capacity", t0: 750, t1: 770 },
    { reason: "video-offscreen", t0: 1120, t1: 1120 },
  ]);

  const notice = gapNotice(ranges);
  assert.match(notice, /12:30~12:50 음성 인식 밀림/);
  assert.match(notice, /18:40 영상이 화면 밖/);
  assert.doesNotMatch(notice, /18:40~18:40/, "한 번뿐인 구간을 구간처럼 적는다");
  assert.equal(gapNotice([]), "", "끊긴 곳이 없는데 경고가 붙는다");

  // 원격 요약을 못 쓰는 경우에도 경고는 붙어야 한다 — 모르고 믿는 것이 최악이다.
  const local = await generate([evidence("인식된 강의 내용")], { gaps: [{ time: 60, reason: "user-paused" }] });
  assert.match(local.notice, /1:00 사용자 일시정지/);

  // 근거 배열만 보면 "말 없이 슬라이드만 떠 있던 5분"과 구분이 안 된다. 따로 실어 보낸다.
  let sent = null;
  const service = { summary: async options => { sent = options; return response(options.evidence); } };
  const note = await generate([evidence("인식된 강의 내용")], {
    settings, service, sessionId: "s", gaps: [{ time: 750, reason: "audio-capacity" }],
  });
  assert.deepEqual(sent.gaps, [{ reason: "audio-capacity", t0: 750, t1: 750 }], "끊긴 구간이 모델에게 전달되지 않는다");
  assert.match(note.notice, /12:30 음성 인식 밀림/);
  assert.ok(sent.evidence.every(e => e.source !== "gap"), "끊긴 구간이 근거로 섞여 들어갔다");
});
