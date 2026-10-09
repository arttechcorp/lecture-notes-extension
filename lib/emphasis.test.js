const test = require("node:test");
const assert = require("node:assert/strict");
const Emphasis = require("./emphasis.js");

test("stressHits counts matches of EMPHASIS_WORDS (stress and exam)", () => {
  assert.equal(Emphasis.countStressHits(""), 0);
  assert.equal(Emphasis.countStressHits(null), 0);

  // 한국어 강조어
  assert.equal(Emphasis.countStressHits("이 개념은 매우 중요하고 시험에 꼭 나옵니다. 반드시 기억하세요."), 5);
  // 중요(1), 시험(1), 꼭(1), 반드시(1), 기억(1) => 5

  // 영어 강조어
  assert.equal(Emphasis.countStressHits("This is an important key point for the midterm and final exam, crucial to remember."), 6);
  // important(1), key point(1), midterm(1), final exam(1), crucial(1), remember(1) => 6

  // 무관한 단어
  assert.equal(Emphasis.countStressHits("오늘 날씨가 좋습니다."), 0);
});

test("extractKeywords and countKeywordHits extract non-stopwords and count occurrences", () => {
  const keywords = Emphasis.extractKeywords("경사하강법(Gradient Descent)과 손실함수 계산");
  assert.ok(keywords.includes("경사하강법"));
  assert.ok(keywords.includes("gradient"));
  assert.ok(keywords.includes("descent"));
  assert.ok(keywords.includes("손실함수"));
  assert.ok(keywords.includes("계산"));
  assert.ok(!keywords.includes("그리고"));

  // 강의 전체 발화에서 출현 횟수
  const allSpeech = "오늘 배울 경사하강법은 매우 유용합니다. 경사하강법을 사용하면 최적화가 됩니다. Gradient descent is great.";
  const hitsKo = Emphasis.countKeywordHits("경사하강법", allSpeech);
  assert.equal(hitsKo, 2);
  const hitsEn = Emphasis.countKeywordHits("gradient", allSpeech);
  assert.equal(hitsEn, 1);
});

test("computeEmphasis computes all 5 components raw without weighting", () => {
  const units = [
    {
      unitId: "U1",
      slideId: "S1",
      slideText: "머신러닝 기초와 지도학습",
      speech: "이번 시간에는 머신러닝 기초에 대해 설명합니다. 지도학습이 중요합니다.",
      t0: 0,
      t1: 60,
      speechDuration: 60,
    },
    {
      unitId: "U2",
      slideId: "S2",
      slideText: "경사하강법 알고리즘 수식",
      speech: "경사하강법 수식입니다. 이 부분은 시험에 반드시 나옵니다. 꼭 기억하세요.",
      t0: 60,
      t1: 180,
      speechDuration: 120,
      inkArea: 42.5,
    },
    {
      unitId: "U3",
      slideId: "S3",
      slideText: "정리 및 다음 시간 예고",
      speech: "오늘 머신러닝 수업은 여기까지입니다.",
      t0: 180,
      t1: 240,
      speechDuration: 60,
    },
  ];

  const result = Emphasis.computeEmphasis(units);

  assert.equal(result.length, 3);
  const [e1, e2, e3] = result;

  // Slide seconds: S1=60, S2=120, S3=60. Sorted: [60, 60, 120]. Median: 60.
  // dwellRatio: S1 = 60/60 = 1.0, S2 = 120/60 = 2.0, S3 = 60/60 = 1.0
  assert.equal(e1.dwellRatio, 1.0);
  assert.equal(e2.dwellRatio, 2.0);
  assert.equal(e3.dwellRatio, 1.0);

  // stressHits:
  // U1: "중요" -> 1
  // U2: "시험", "반드시", "꼭", "기억" -> 4
  // U3: none -> 0
  assert.equal(e1.stressHits, 1);
  assert.equal(e2.stressHits, 4);
  assert.equal(e3.stressHits, 0);

  // revisits: each slide appears once -> 0
  assert.equal(e1.revisits, 0);
  assert.equal(e2.revisits, 0);
  assert.equal(e3.revisits, 0);

  // inkArea:
  assert.equal(e1.inkArea, 0);
  assert.equal(e2.inkArea, 42.5);
  assert.equal(e3.inkArea, 0);

  // repeatCount:
  // U1 slideText: "머신러닝", "지도학습" -> allSpeech mentions "머신러닝" 2 times (U1, U3), "지도학습" 1 time (U1) => >= 3
  assert.ok(e1.repeatCount >= 2);
  // U2 slideText: "경사하강법", "알고리즘", "수식" -> "경사하강법" 1 time, "수식" 1 time => >= 2
  assert.ok(e2.repeatCount >= 2);

  // byUnit lookup
  assert.equal(result.byUnit.get("U2"), e2);
  assert.equal(result.get("U1"), e1);
});

test("computeEmphasis calculates revisits and sums dwell across revisits", () => {
  // S1 appears at U1 (30s) and is revisited at U3 (70s).
  // S2 appears at U2 (50s).
  const units = [
    {
      unitId: "U1",
      slideId: "S1",
      slideText: "1장 개요",
      speech: "개요를 먼저 봅니다.",
      speechDuration: 30,
    },
    {
      unitId: "U2",
      slideId: "S2",
      slideText: "2장 본론",
      speech: "본론으로 들어갑니다.",
      speechDuration: 50,
    },
    {
      unitId: "U3",
      slideId: "S1", // S1 revisited!
      slideText: "1장 개요",
      speech: "다시 1장 개요로 돌아와서 마무리합니다.",
      speechDuration: 70,
    },
  ];

  const result = Emphasis.computeEmphasis(units);

  // Slide totals: S1 = 30 + 70 = 100s, S2 = 50s.
  // Distinct slides: S1 (100s), S2 (50s).
  // Median: (50 + 100) / 2 = 75.
  // dwellRatio for S1: 100 / 75 = 1.33.
  // dwellRatio for S2: 50 / 75 = 0.67.
  const [e1, e2, e3] = result;
  assert.equal(e1.dwellRatio, 1.33);
  assert.equal(e2.dwellRatio, 0.67);
  assert.equal(e3.dwellRatio, 1.33); // U3 shares S1's summed dwellRatio!

  // revisits: S1 appeared 2 times -> revisits = 1
  assert.equal(e1.revisits, 1);
  assert.equal(e2.revisits, 0);
  assert.equal(e3.revisits, 1);
});

test("computeEmphasis handles empty speech gracefully (no NaN, no throw)", () => {
  const units = [
    { unitId: "U1", slideId: "S1", slideText: "제목 슬라이드", speech: "" },
    { unitId: "U2", slideId: "S2", slideText: "", speech: "   " },
    { unitId: "U3", slideId: "S3", slideText: "수식 슬라이드", speech: null },
  ];

  const result = Emphasis.computeEmphasis(units);
  assert.equal(result.length, 3);
  for (const item of result) {
    assert.equal(item.dwellRatio, 0);
    assert.equal(item.repeatCount, 0);
    assert.equal(item.stressHits, 0);
    assert.equal(item.revisits, 0);
    assert.equal(item.inkArea, 0);
  }

  // Entirely empty units list
  const empty = Emphasis.computeEmphasis([]);
  assert.equal(empty.length, 0);
  assert.equal(empty.get("U1"), undefined);
});

test("computeEmphasis uses evidence items when available for speech duration", () => {
  const units = [
    { unitId: "U1", slideId: "S1", slideText: "A", speech: "말씀" },
    { unitId: "U2", slideId: "S2", slideText: "B", speech: "말씀" },
  ];
  const evidence = [
    { unitId: "U1", kind: "speech", t0: 0, t1: 40, text: "말" },
    { unitId: "U1", kind: "speech", t0: 40, t1: 60, text: "씀" },
    { unitId: "U2", kind: "speech", t0: 60, t1: 180, text: "말씀" },
  ];

  const result = Emphasis.computeEmphasis(units, { evidence });
  // U1 speechSec: 20 + 40 = 60s
  // U2 speechSec: 120s
  // Median: (60 + 120) / 2 = 90
  // U1 dwellRatio: 60 / 90 = 0.67
  // U2 dwellRatio: 120 / 90 = 1.33
  assert.equal(result.get("U1").dwellRatio, 0.67);
  assert.equal(result.get("U2").dwellRatio, 1.33);
});

// ── stages.js 통합 검증: mis-sol-hai judging 비활성화 및 plan 입력 emphasis 전달 검증 ──
const S = require("./stages.js");
const P = require("./pipeline.js");
const Contracts = require("./contracts.js");
const Prompts = require("../server/prompts.js");
const { createStore, memoryAdapter } = require("./package-store.js");
const { EventBus } = require("./events.js");
const INPUT = require("../tools/note-fixture/input.json");
const PLANNER = require("../tools/note-fixture/planner-output.json");
const WRITER = require("../tools/note-fixture/writer-outputs.json");
const katex = require("./vendor/katex/katex.min.js");

function makeFakeService() {
  const calls = { plan: [], section: [], repair: [], global: [], judge: [] };
  return {
    calls,
    plan: async o => { calls.plan.push(o); return { plan: PLANNER, promptVersion: "note-v6" }; },
    write: async o => {
      calls[o.stage].push(o);
      if (o.stage === "section") return { output: WRITER.sections[o.section.sectionId].first };
      if (o.stage === "repair") return { output: { blocks: Object.fromEntries(o.repair.map(r => [r.blockId, WRITER.sections[o.section.sectionId].repair?.blocks?.[r.blockId] ?? null])) } };
      if (o.stage === "global") return { output: WRITER.global };
      return { output: {} };
    },
    judge: async o => {
      calls.judge.push(o);
      return { results: o.items.map(i => ({ itemId: i.itemId, task: o.task, probs: [{ label: "yes", p: 0.9 }], score: o.task === "support" ? 0.9 : 3, confidence: null, model: o.model })) };
    },
  };
}

test("stages integration: emphasisSignals disables judging and provides emphasis to plan input", async () => {
  const store = await createStore(memoryAdapter());
  const bus = new EventBus({ now: () => 1000, limit: 10000 });
  const job = await P.createJob({ jobId: "j-emph", packageId: "pkg-emph", store, events: bus, now: () => 1000 });
  const svc = makeFakeService();

  const input = {
    slides: INPUT.slides,
    transcript: INPUT.transcript,
    gaps: [],
    tier: "paid",
    models: { plan: "m-plan", write: "m-write", judge: "m-judge" },
    consent: { summary: true },
    meta: INPUT.meta,
  };

  const deps = {
    service: svc,
    katex,
    events: bus,
    emphasisSignals: true,
  };

  const res = await S.runNote(job, input, deps);
  assert.equal(job.state, "done");

  // 1. Judging was disabled for importance
  const importanceCalls = svc.calls.judge.filter(c => c.task === "importance");
  assert.equal(importanceCalls.length, 0, "emphasisSignals 활성화 시 JEV importance judging 호출 건너뜀");

  // 2. Plan request has emphasis attached
  assert.equal(svc.calls.plan.length, 1);
  const planReq = svc.calls.plan[0];
  assert.ok(Array.isArray(planReq.emphasis), "plan 입력에 emphasis 배열 존재");
  assert.equal(planReq.emphasis.length, planReq.ir.units.length);

  for (const item of planReq.emphasis) {
    assert.match(item.unitId, /^U\d+$/);
    assert.equal(typeof item.dwellRatio, "number");
    assert.equal(typeof item.repeatCount, "number");
    assert.equal(typeof item.stressHits, "number");
    assert.equal(typeof item.revisits, "number");
    assert.equal(typeof item.inkArea, "number");
    assert.ok(item.dwellRatio >= 0);
    assert.ok(item.repeatCount >= 0);
    assert.ok(item.stressHits >= 0);
    assert.ok(item.revisits >= 0);
    assert.ok(item.inkArea >= 0);
  }

  // 3. Schema validation against Prompts.REQUEST.plan
  const planBody = {
    ir: planReq.ir,
    formulas: planReq.formulas,
    figures: planReq.figures,
    recognition: planReq.recognition,
    options: planReq.options,
    emphasis: planReq.emphasis,
  };
  const val = Contracts.validate(Prompts.REQUEST.plan, planBody);
  assert.ok(val.ok, "Prompts.REQUEST.plan 계약 검증 통과: " + JSON.stringify(val.errors));
});

test("stages integration: default mode leaves judging and plan unchanged", async () => {
  const store = await createStore(memoryAdapter());
  const bus = new EventBus({ now: () => 1000, limit: 10000 });
  const job = await P.createJob({ jobId: "j-def", packageId: "pkg-def", store, events: bus, now: () => 1000 });
  const svc = makeFakeService();

  const input = {
    slides: INPUT.slides,
    transcript: INPUT.transcript,
    gaps: [],
    tier: "paid",
    models: { plan: "m-plan", write: "m-write", judge: "m-judge" },
    consent: { summary: true },
    meta: INPUT.meta,
  };

  const deps = {
    service: svc,
    katex,
    events: bus,
    // emphasisSignals NOT set
  };

  const res = await S.runNote(job, input, deps);
  assert.equal(job.state, "done");

  // 1. Judging was executed for importance
  const importanceCalls = svc.calls.judge.filter(c => c.task === "importance");
  assert.ok(importanceCalls.length > 0, "기존 모드에서는 JEV importance judging 정상 호출");

  // 2. Plan request has NO emphasis field
  assert.equal(svc.calls.plan.length, 1);
  assert.equal(svc.calls.plan[0].emphasis, undefined, "기존 모드에서는 plan 입력에 emphasis 미포함");
});
