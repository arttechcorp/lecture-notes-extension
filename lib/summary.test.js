const test = require("node:test");
const assert = require("node:assert/strict");
const { chunkEvidence, preprocessEvidence, validateSummary, generate, requestId, droppedNotice, uncitedNotice } = require("./summary.js");
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
  assert.deepEqual(out.find(e => e.id === "first").relatedEvidenceIds, ["duplicate", "spoken"]);
  assert.deepEqual(out.find(e => e.id === "spoken").relatedEvidenceIds, ["first"]);
  assert.equal(out.find(e => e.id === "uncertain").selection, "uncertain");
  assert.equal(out.find(e => e.id === "normalized").text, "공백 정돈");
  assert.equal(out.find(e => e.id === "superseded").selection, "filtered");
  assert.equal(out.find(e => e.id === "empty").selection, "filtered");
  assert.equal(input.find(e => e.id === "normalized").text, "  공백\n정돈  ");
  assert.equal(input.some(e => "selection" in e), false);
  assert.match(JSON.stringify(out), /100000/);
});
test("exact OCR duplicate links back to its actual target with existing references", () => {
  const out = preprocessEvidence([
    evidence("same", "first", { slideId: "s" }),
    evidence("same", "duplicate", { slideId: "s", t0: 9, relatedEvidenceIds: ["older"] }),
    evidence("older", "older", { slideId: "other", t0: 1 }),
  ]);
  assert.equal(out.find(e => e.id === "first").relatedEvidenceIds[0], "duplicate");
  assert.equal(out.find(e => e.id === "older").relatedEvidenceIds.includes("duplicate"), false);
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
  // 구간마다 본문을 다르게 둔다 — 같은 본문이면 뒤 구간이 요청 캐시에 그대로 걸려 호출 자체가 안 나간다.
  const parts = [0, 1, 2].map(i => evidence(`${i}구간 시험용 자료 `.repeat(1700), `e${i}`, { t0: i * 60, t1: i * 60 + 59 }));
  await assert.rejects(generate(parts, {
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

  // keyConclusions 의 detail(결론 아래 자세한 설명)은 검증을 통과해 노트까지 남아야 한다.
  const detailed = response(input).summary;
  detailed.keyConclusions[0].detail = "자세한 설명";
  assert.equal(validateSummary(detailed, input).keyConclusions[0].detail, "자세한 설명");
  detailed.keyConclusions[0].detail = "x".repeat(6001);
  assert.equal(validateSummary(detailed, input).keyConclusions[0].detail, undefined, "상한을 넘는 detail 은 결론만 남기고 버린다");
  // 전부 환각이면 그 항목만 사라지고 나머지 요약은 통과한다. 예전엔 여기서 청크 전체가 죽었다.
  const bad = response(input).summary;
  bad.corrections = [{ content: "앞서 말한 값을 정정합니다.", importance: "important", evidenceIds: ["invented"] }];
  const checked = validateSummary(bad, input);
  assert.equal(checked.corrections.length, 0);
  assert.ok(checked.sections.length);
  assert.deepEqual(checked.evidenceIds, ["e1", "e2"]);
});
test("버린 항목은 구간마다 합쳐져 노트 경고로 드러난다", async () => {
  const bad = request => {
    const r = response(request.evidence);
    r.summary.corrections = [{ content: "앞서 말한 값을 정정합니다.", importance: "important", evidenceIds: ["invented"] }];
    return r;
  };
  const result = await generate([evidence("합성 강의 자료 ".repeat(7000)), evidence("후반 핵심 정정", "end")], {
    settings, sessionId: "drop", service: { summary: async request => bad(request) },
  });
  // 구간마다 1건씩 버렸다면 마지막 합성 호출의 수가 아니라 합계가 실려야 한다.
  assert.ok(result.dropped > 1, "구간별 손실이 합산되지 않는다");
  assert.ok(result.notice.includes("뺀 항목이 " + result.dropped + "건"), "경고의 건수가 실제와 어긋난다");
  assert.equal(result.corrections.length, 0);
  assert.equal(result.status, "complete");
});
test("버린 항목이 없으면 경고를 붙이지 않는다", () => {
  assert.equal(droppedNotice(0), "");
  assert.match(droppedNotice(3), /3건/);
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
});
test("선별 요약은 낮은 인용률을 허용하고 명시적 전수 검사는 유지", () => {
  const three = [evidence("첫 근거", "e1"), evidence("둘째 근거", "e2"), evidence("셋째 근거", "e3")];
  // 미인용 근거는 진단 정보로 남긴다.
  const most = response(three).summary;
  for (const f of ["keyConclusions", "sections", "reviewQuestions"]) for (const v of most[f]) v.evidenceIds = ["e1", "e2"];
  const checked = validateSummary(most, three);
  assert.deepEqual(checked.uncited.map(x => x.id), ["e3"]);
  assert.deepEqual(checked.evidenceIds, ["e1", "e2"]);
  // 기본 선별 모드에서는 낮은 인용률도 허용한다.
  const few = response(three).summary;
  for (const f of ["keyConclusions", "sections", "reviewQuestions"]) for (const v of few[f]) v.evidenceIds = ["e1"];
  assert.throws(() => validateSummary(few, three, { requireCoverage: true }), /처리되지 않은 근거/);
  assert.deepEqual(validateSummary(few, three).uncited.map(x => x.id), ["e2", "e3"]);
});
test("선별한 노트의 미인용 근거는 처리 실패 경고로 표시하지 않는다", async () => {
  // 구간 및 합성 단계에서 일부 근거를 선택하지 않는다.
  const skipLast = request => {
    const r = response(request.evidence);
    const ids = [...new Set(request.evidence.map(e => String(e.id)))];
    const kept = ids.length > 1 ? ids.slice(0, -1) : ids;
    for (const f of ["keyConclusions", "sections", "reviewQuestions"]) for (const v of r.summary[f]) v.evidenceIds = kept;
    return r;
  };
  const result = await generate([evidence("합성 강의 자료 ".repeat(7000)), evidence("후반 핵심 정정", "end")], {
    settings, sessionId: "uncited", service: { summary: async request => skipLast(request) },
  });
  assert.ok(result.uncited.length > 0, "다루지 못한 근거를 모으지 않는다");
  assert.equal(result.notice, "");
  assert.equal(result.status, "complete");
});
test("다루지 못한 근거가 없으면 경고를 붙이지 않는다", () => {
  assert.equal(uncitedNotice([]), "");
  assert.match(uncitedNotice([{ id: "a", t0: 65, t1: 70 }]), /1:05~1:10/);
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
test("같은 슬라이드의 점진 노출은 뒤 인식 결과에 접힌다", () => {
  const out = preprocessEvidence([
    evidence("1. 전압 정의", "reveal1", { slideId: "s2", t0: 1, t1: 2 }),
    evidence("1. 전압 정의 2. 전류 정의", "reveal2", { slideId: "s2", t0: 3, t1: 4 }),
    evidence("1. 전압 정의", "other", { slideId: "s3", t0: 5, t1: 6 }),
  ]);
  assert.equal(out.find(e => e.id === "reveal1").selection, "filtered");
  assert.match(out.find(e => e.id === "reveal1").selectionReason, /뒤 캡처/);
  assert.equal(out.find(e => e.id === "reveal2").selection, "included", "상위집합인 뒤 인식을 남긴다");
  assert.equal(out.find(e => e.id === "other").selection, "included", "다른 슬라이드는 접지 않는다");
  assert.equal(chunkEvidence(out).flat().filter(e => e.id === "reveal1").length, 0);
});
test("BYOK 구간은 동시에 나가고 합성 입력에 계량 필드를 싣지 않는다", async () => {
  const byok = { openRouterApiKey: "sk-or-v1-" + "a".repeat(32), remoteSummaryConsent: true };
  let live = 0, peak = 0;
  const stages = [], synthesisItems = [];
  const result = await generate([evidence("합성 강의 자료 ".repeat(9000)), evidence("후반 핵심 정정", "end")], {
    settings: byok, sessionId: "parallel",
    service: { summary: async request => {
      peak = Math.max(peak, ++live); stages.push(request.stage);
      if (request.stage === "synthesis") synthesisItems.push(...request.evidence);
      await new Promise(resolve => setTimeout(resolve, 5));
      live--; return response(request.evidence);
    } },
  });
  assert.ok(peak > 1, "구간 요약이 여전히 한 건씩 순차로 나간다");
  assert.ok(stages.includes("synthesis"));
  assert.ok(synthesisItems.length, "합성 입력이 비었다");
  for (const node of synthesisItems) {
    const note = JSON.parse(node.text);
    for (const field of ["uncited", "dropped", "evidenceIds"]) assert.ok(!(field in note), `${field} 가 합성 입력에 실렸다`);
  }
  assert.equal(result.status, "complete");
  assert.ok(result.evidenceIds.includes("end"));
});
test("서비스 경로는 계정 잠금 때문에 한 건씩 보낸다", async () => {
  let live = 0, peak = 0;
  await generate([evidence("서비스 경로 자료 ".repeat(9000))], {
    settings, sessionId: "serial",
    service: { summary: async request => {
      peak = Math.max(peak, ++live);
      await new Promise(resolve => setTimeout(resolve, 5));
      live--; return response(request.evidence);
    } },
  });
  assert.equal(peak, 1, "서비스 경로에서 동시 요청이 나가면 서버가 429 로 막는다");
});
test("selectionReason 은 판단이 필요한 uncertain 에만 실린다", () => {
  const items = chunkEvidence(preprocessEvidence([
    evidence("또렷한 인식 결과", "sure"),
    evidence("흐릿한 인식 결과", "unsure", { confidence: .2, t0: 9, t1: 10 }),
  ])).flat();
  const sure = items.find(e => e.id === "sure"), unsure = items.find(e => e.id === "unsure");
  assert.equal(sure.selection, "included");
  assert.equal("selectionReason" in sure, false, "included 의 상수 문장이 근거마다 실린다");
  assert.equal(unsure.selection, "uncertain");
  assert.match(unsure.selectionReason, /신뢰도/, "uncertain 의 뜻을 설명할 문장이 사라졌다");
});

// 그림(figure) 타입은 인라인 SVG 를 data 로 받고, 보간 여부를 inferred 로 표시한다.
test("validateSummary는 figure 타입과 inferred 플래그를 보존한다", () => {
  const items = [evidence("슬라이드에 회로가 있었습니다.")];
  const ids = ["e1"];
  const base = response(items).summary;
  base.visuals = [{ type: "figure", title: "회로", description: "직렬 RLC", data: '<svg viewBox="0 0 10 10"></svg>', importance: "important", evidenceIds: ids, inferred: true }];
  const out = validateSummary(base, items);
  assert.equal(out.visuals.length, 1);
  assert.equal(out.visuals[0].type, "figure");
  assert.equal(out.visuals[0].inferred, true);
  assert.equal(out.visuals[0].data, '<svg viewBox="0 0 10 10"></svg>');
});

test("validateSummary는 inferred가 없으면 false로 채운다", () => {
  const items = [evidence("슬라이드에 회로가 있었습니다.")];
  const base = response(items).summary;
  base.visuals = [{ type: "figure", title: "회로", description: "직렬 RLC", data: "<svg/>", importance: "important", evidenceIds: ["e1"] }];
  assert.equal(validateSummary(base, items).visuals[0].inferred, false);
});

test("validateSummary는 inferred가 boolean이 아니면 거부한다", () => {
  const items = [evidence("슬라이드에 회로가 있었습니다.")];
  const base = response(items).summary;
  base.visuals = [{ type: "figure", title: "회로", description: "직렬 RLC", data: "<svg/>", importance: "important", evidenceIds: ["e1"], inferred: "yes" }];
  assert.throws(() => validateSummary(base, items), /시각 자료/);
});
test("핵심 결론은 최종·부분 결과 모두 3개를 넘지 않고 critical 이 먼저 남는다", async () => {
  const mk = importance => ({ content: "결론 " + importance, importance, evidenceIds: ["e0"] });
  const many = request => { const r = response(request.evidence); r.summary.keyConclusions = ["reference", "important", "reference", "critical", "important"].map(mk); return r; };
  const check = r => { assert.equal(r.keyConclusions.length, 3); assert.equal(r.keyConclusions[0].importance, "critical"); };
  check(await generate([evidence("자료", "e0")], { settings, service: { summary: async request => many(request) } }));
  let calls = 0;
  const parts = [0, 1].map(i => evidence(`${i}구간 시험용 자료 `.repeat(1700), `e${i}`, { t0: i * 60, t1: i * 60 + 59 }));
  await assert.rejects(generate(parts, { settings, service: { summary: async request => { if (++calls === 2) throw new Error("quota"); return many(request); } } }), e => { check(e.partial); return true; });
});
