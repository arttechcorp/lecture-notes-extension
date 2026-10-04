const test = require("node:test"), assert = require("node:assert/strict");
const { ENDPOINT, JUDGE_TASKS, QUESTIONS, buildRequests, parseAnswers } = require("./jev.js");

const OPTS = { model: "typesafe/jev-1.13", providers: ["typesafe"] };
const items = n => Array.from({ length: n }, (_, i) => ({ itemId: "it-" + i, text: "항목 " + i }));

test("buildRequests chunks items by count and state bytes, oversized item goes alone", () => {
  const rs = buildRequests("utterance", items(23), OPTS);
  assert.equal(rs.length, 3, "23개 항목은 10+10+3 요청이다");
  assert.deepEqual(rs.map(r => r.itemIndexes), [Array.from({ length: 10 }, (_, i) => i), Array.from({ length: 10 }, (_, i) => i + 10), [20, 21, 22]]);
  assert.deepEqual(rs.map(r => r.body.state.items.length), [10, 10, 3]);
  assert.deepEqual(rs[0].body.state.items[0], { text: "항목 0" }, "state 는 text/context 만 싣는다");
  assert.ok(rs.every(r => r.body.model === "typesafe/jev-1.13"));
  assert.deepEqual(rs[0].body.provider, { only: ["typesafe"], allow_fallbacks: false, zdr: true, data_collection: "deny" });
  const big = t => ({ itemId: "b", text: "x".repeat(t) });
  const bytes = buildRequests("importance", Array.from({ length: 12 }, () => big(2000)), OPTS);
  assert.deepEqual(bytes.map(r => r.itemIndexes.length), [5, 5, 2], "state JSON 12000바이트를 넘기 전에 자른다");
  const alone = buildRequests("importance", [{ itemId: "s", text: "소" }, { itemId: "h", text: "x".repeat(13000) }, { itemId: "t", text: "삼" }], OPTS);
  assert.deepEqual(alone.map(r => r.itemIndexes), [[0], [1], [2]], "한도를 넘는 항목은 단독 요청이다");
  const withCtx = buildRequests("support", [{ itemId: "a", text: "주장", context: "근거" }, { itemId: "b", text: "맥락없음" }], OPTS);
  assert.equal(withCtx[0].body.state.items[0].context, "근거");
  assert.ok(!("context" in withCtx[0].body.state.items[1]), "context 는 있을 때만 싣는다");
  assert.throws(() => buildRequests("nope", items(1), OPTS), /invalid_task/);
});

test("buildRequests emits per-task question shapes with backtick paths", () => {
  const one = (task, item) => buildRequests(task, [item], OPTS)[0].body.questions;
  const utt = one("utterance", { itemId: "a", text: "개념 설명" });
  assert.deepEqual(Object.keys(utt), ["i0", "r0"], "선택 과제는 정방향+역방향 둘을 묻는다");
  assert.equal(utt.i0.type, "choice");
  assert.deepEqual(Object.keys(utt.i0.criteria), ["lecture", "example", "admin", "chatter"], "정방향은 라벨 순서대로");
  assert.deepEqual(Object.keys(utt.r0.criteria), ["chatter", "admin", "example", "lecture"], "역방향은 뒤집은 순서다");
  assert.ok(utt.i0.instructions.includes("`items[0].text`"), "질문은 state 의 항목 경로를 가리킨다");
  assert.equal(typeof utt.i0.criteria.lecture.what, "string");
  assert.equal(typeof utt.i0.criteria.lecture.not_for, "string");
  const fig = one("figure", { itemId: "a", text: "그래프 설명" });
  assert.deepEqual(Object.keys(fig.i0.criteria), ["core", "supporting", "decorative"]);
  assert.deepEqual(Object.keys(fig.r0.criteria), ["decorative", "supporting", "core"]);
  const imp = one("importance", { itemId: "a", text: "슬라이드 글" });
  assert.deepEqual(Object.keys(imp), ["i0"], "score·noul 과제는 한 번만 묻는다");
  assert.equal(imp.i0.type, "score");
  assert.equal(imp.i0.criteria.length, 5, "낮은 순 5단계다");
  assert.ok(imp.i0.instructions.includes("`items[0].text`"));
  const bp = one("boilerplate", { itemId: "a", text: "학과명" });
  assert.equal(bp.i0.type, "noul");
  assert.deepEqual(Object.keys(bp.i0.criteria), ["true", "false"]);
  const sup = one("support", { itemId: "a", text: "주장", context: "근거" });
  assert.equal(sup.i0.type, "noul");
  assert.equal(typeof sup.i0.instructions, "object", "support 는 claim/evidence 를 구조화 지시로 묻는다");
  assert.ok(sup.i0.instructions.question.includes("`items[0].text`") && sup.i0.instructions.question.includes("`items[0].context`"));
  const k1 = buildRequests("utterance", items(2), OPTS)[0].body.questions;
  assert.ok(k1.i1.instructions.includes("`items[1].text`"), "질문은 청크 안의 위치를 가리킨다");
});

const choiceAns = (probs, confidence) => ({ type: "choice", choice: "lecture", probabilities: probs, confidence });
const scoreAns = (score, probs, confidence) => ({ type: "score", score, legend: { "0": "a", "1": "b", "2": "c", "3": "d", "4": "e" }, probabilities: probs, confidence });
const noulAns = noul => ({ type: "noul", noul });

test("parseAnswers maps choice answers averaged over forward and reversed", () => {
  const json = { answers: {
    i0: choiceAns({ lecture: .9, example: .1, admin: 0, chatter: 0 }, .9),
    r0: choiceAns({ lecture: .7, example: .3, admin: 0, chatter: 0 }, .7),
  } };
  const [r] = parseAnswers("utterance", json, 1);
  assert.deepEqual(r.probs.map(x => x.label), JUDGE_TASKS.utterance);
  assert.ok(Math.abs(r.probs[0].p - .8) < 1e-9 && Math.abs(r.probs[1].p - .2) < 1e-9, "정방향·역방향을 평균 낸다");
  assert.equal(r.score, null);
  assert.ok(Math.abs(r.confidence - .8) < 1e-9, "confidence 는 두 답의 평균이다");
  const skew = { answers: { i0: choiceAns({ lecture: .6, example: .3 }, .5), r0: choiceAns({ lecture: .5, example: .5 }, .5) } };
  const [s] = parseAnswers("utterance", skew, 1);
  assert.ok(Math.abs(s.probs[0].p - 1.1 / 1.9) < 1e-6 && Math.abs(s.probs[1].p - .8 / 1.9) < 1e-6, "합이 1이 아닌 분포도 정규화한다");
  assert.ok(Math.abs(s.probs.reduce((a, x) => a + x.p, 0) - 1) < 1e-5);
});

test("parseAnswers maps score levels to 1..5 labels and lifts score by one", () => {
  const json = { answers: { i0: scoreAns(3.4, { "0": 0, "1": 0, "2": .2, "3": .6, "4": .2 }, .8) } };
  const [r] = parseAnswers("importance", json, 1);
  assert.deepEqual(r.probs, [{ label: "1", p: 0 }, { label: "2", p: 0 }, { label: "3", p: .2 }, { label: "4", p: .6 }, { label: "5", p: .2 }], "level 키 0..4 가 라벨 1..5 다");
  assert.ok(Math.abs(r.score - 4.4) < 1e-9, "Jev 기댓값 0..4 를 계약 1..5 로 올린다");
  assert.equal(r.confidence, .8);
});

test("parseAnswers maps noul to label probabilities and derives confidence", () => {
  const [b] = parseAnswers("boilerplate", { answers: { i0: noulAns(.8) } }, 1);
  assert.deepEqual(b.probs, [{ label: "yes", p: .8 }, { label: "no", p: .2 }]);
  assert.equal(b.score, .8);
  assert.ok(Math.abs(b.confidence - .6) < 1e-9, "noul 은 confidence 가 없어 |2p-1| 로 계산한다");
  const [s] = parseAnswers("support", { answers: { i0: noulAns(.3) } }, 1);
  assert.deepEqual(s.probs, [{ label: "supported", p: .3 }, { label: "unsupported", p: .7 }]);
  assert.equal(s.score, .3);
  const [c] = parseAnswers("boilerplate", { answers: { i0: noulAns(1.4) } }, 1);
  assert.equal(c.probs[0].p, 1, "noul 은 0..1 로 자른다");
});

test("parseAnswers throws judge_answer_invalid on missing or malformed answers", () => {
  assert.throws(() => parseAnswers("utterance", { answers: {} }, 1), /judge_answer_invalid/, "빠진 답");
  assert.throws(() => parseAnswers("utterance", {}, 1), /judge_answer_invalid/);
  assert.throws(() => parseAnswers("nope", { answers: {} }, 1), /judge_answer_invalid/);
  assert.throws(() => parseAnswers("utterance", { answers: { i0: choiceAns({ lecture: 1 }, .5) } }, 1), /judge_answer_invalid/, "역방향 답이 없다");
  assert.throws(() => parseAnswers("utterance", { answers: { i0: choiceAns({}, .5), r0: choiceAns({}, .5) } }, 1), /judge_answer_invalid/, "확률 질량이 하나도 없다");
  assert.throws(() => parseAnswers("importance", { answers: { i0: noulAns(.5) } }, 1), /judge_answer_invalid/, "과제와 다른 답 타입");
  assert.throws(() => parseAnswers("importance", { answers: { i0: { type: "score", score: 3, confidence: .8 } } }, 1), /judge_answer_invalid/, "probabilities 없음");
  assert.throws(() => parseAnswers("boilerplate", { answers: { i0: { type: "noul" } } }, 1), /judge_answer_invalid/, "noul 값 없음");
  const two = parseAnswers("boilerplate", { answers: { i0: noulAns(.9), i1: noulAns(.1) } }, 2);
  assert.equal(two.length, 2, "청크 안 항목 순서대로 돌아온다");
  assert.throws(() => parseAnswers("boilerplate", { answers: { i0: noulAns(.9) } }, 2), /judge_answer_invalid/, "i1 이 빠지면 실패다");
});

test("ENDPOINT is the OpenRouter decisions route", () => {
  assert.equal(ENDPOINT, "https://openrouter.ai/api/alpha/decisions");
});
