// Jev(TypeSafe decisions) 판정 모듈 — 순수 함수만 둔다. 호출·슬롯·예약은 index.js 가 맡는다.
// 과제 라벨 표는 logprob 경로(선택지 알파벳 순서)와 같은 표를 써야 응답 라벨 순서가 어긋나지 않는다.
const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const JUDGE_TASKS = { utterance: ["lecture", "example", "admin", "chatter"], importance: ["1", "2", "3", "4", "5"], boilerplate: ["yes", "no"], figure: ["core", "supporting", "decorative"], support: ["supported", "unsupported"] };
// Jev 는 영어가 주 언어다 — 지시·기준은 영어로 쓰고 자료가 한국어라고 알려 준다.
// 글자 그대로 읽는 모델이라 choice 기준은 {what, not_for?} 로 경계 사례를 못 박고, score 단계는 숫자가 아니라 설명으로 쓴다.
const QUESTIONS = {
  utterance: {
    type: "choice",
    instructions: k => `The state \`items\` holds utterances from a Korean university lecture transcript (the text is Korean). Which kind of utterance is \`items[${k}].text\`? \`items[${k}].context\`, when present, is the surrounding context.`,
    criteria: {
      lecture: { what: "Explains course content — a definition, concept, method, derivation or result.", not_for: "Not a concrete example or analogy, not course logistics, not small talk." },
      example: { what: "A concrete example, analogy or worked case of course content.", not_for: "Not a general explanation of the concept itself, not logistics." },
      admin: { what: "Course logistics — assignments, deadlines, exam schedule, attendance or platform notices.", not_for: "Not teaching of the course subject." },
      chatter: { what: "Small talk or remarks unrelated to course content or logistics.", not_for: "Not an explanation, example or logistics notice." },
    },
  },
  importance: {
    type: "score",
    instructions: k => `How important is \`items[${k}].text\` — a unit (Korean slide text or utterance) from a university lecture — for a student reviewing the course? \`items[${k}].context\`, when present, is the surrounding context.`,
    criteria: [
      "Tangential: no course content (greeting, logistics, filler)",
      "Minor detail or passing remark",
      "Useful supporting content (background, side explanation)",
      "Important concept the lecture develops",
      "Core definition, theorem, method or result the lecture centers on, or the lecturer stresses for exams",
    ],
  },
  boilerplate: {
    type: "noul",
    instructions: k => `Is \`items[${k}].text\` recurring slide boilerplate (header, footer, course name, page number, watermark, institution notice) rather than lecture content? \`items[${k}].context\`, when present, holds clues such as how often the text repeats.`,
    criteria: {
      true: "The text is recurring slide boilerplate, not lecture content.",
      false: "The text is actual lecture content.",
    },
  },
  figure: {
    type: "choice",
    instructions: k => `\`items[${k}].text\` describes a figure (diagram, chart, table or photo) on a Korean lecture slide, and \`items[${k}].context\`, when present, is the utterance spoken with it. How essential is this figure to the lecture notes?`,
    criteria: {
      core: { what: "Needed to understand the content — a diagram, chart or table the lecture explains.", not_for: "Not merely helpful and not decoration." },
      supporting: { what: "Illustrates or adds an example, but the content is understandable without it.", not_for: "Not needed to follow the explanation." },
      decorative: { what: "A logo, icon, stock photo or layout ornament.", not_for: "Not teaching content." },
    },
  },
  support: {
    type: "noul",
    instructions: k => ({ question: `Is \`items[${k}].text\` (the claim) fully supported by \`items[${k}].context\` (the evidence)?` }),
    criteria: {
      true: "Every part of the claim is stated or directly implied by the evidence.",
      false: "The claim adds, changes or contradicts something.",
    },
  },
};
// 한 요청의 state 에 항목을 최대 10개·JSON 12000바이트까지 묶는다. 그 자체로 한도를 넘는 항목은 단독 요청이다.
// choice 과제는 Jev 의 첫 옵션 편향을 상쇄하려고 선택지 순서를 뒤집은 질문(r<k>)을 하나 더 붙인다.
const MAX_CHUNK_ITEMS = 10, MAX_STATE_BYTES = 12000;
const questionFor = (task, k, reversed) => {
  const q = QUESTIONS[task], out = { type: q.type, instructions: q.instructions(k) };
  if (q.type === "choice") {
    const entries = Object.entries(q.criteria);
    if (reversed) entries.reverse();
    out.criteria = Object.fromEntries(entries);
  } else out.criteria = q.criteria;
  return out;
};
function buildRequests(task, items, opts = {}) {
  if (!Object.hasOwn(QUESTIONS, task)) throw new Error("invalid_task");
  const choice = QUESTIONS[task].type === "choice", requests = [];
  let chunk = [], indexes = [];
  const flush = () => {
    if (!chunk.length) return;
    const questions = {};
    for (const k of chunk.keys()) { questions["i" + k] = questionFor(task, k, false); if (choice) questions["r" + k] = questionFor(task, k, true); }
    requests.push({ itemIndexes: indexes, body: { model: opts.model, state: { items: chunk }, questions, provider: { only: opts.providers, allow_fallbacks: false, zdr: true, data_collection: "deny" } } });
    chunk = []; indexes = [];
  };
  for (const [i, item] of items.entries()) {
    const entry = { text: item.text, ...(item.context !== undefined ? { context: item.context } : {}) };
    if (chunk.length && (chunk.length >= MAX_CHUNK_ITEMS || Buffer.byteLength(JSON.stringify({ items: [...chunk, entry] })) > MAX_STATE_BYTES)) flush();
    chunk.push(entry); indexes.push(i);
  }
  flush();
  return requests;
}
// decisions 응답을 과제 라벨 순서의 항목 결과로 푼다. 빠지거나 깨진 답은 제공자 실패와 같이 취급한다.
const clamp01 = x => Math.min(1, Math.max(0, x));
const invalid = () => { throw new Error("judge_answer_invalid"); };
// 확률은 소수 6자리로 자른다 — 평균·1-p 계산의 부동소수 꼬리가 응답에 실리지 않게.
const r6 = x => Math.round(x * 1e6) / 1e6;
function parseAnswers(task, json, chunkLength) {
  const labels = JUDGE_TASKS[task], q = QUESTIONS[task], answers = json && json.answers;
  if (!labels || !q || !answers || typeof answers !== "object") invalid();
  const out = [];
  for (let k = 0; k < chunkLength; k++) {
    if (q.type === "choice") {
      const dist = key => {
        const a = answers[key];
        if (!a || a.type !== "choice" || !a.probabilities || typeof a.probabilities !== "object" || !Number.isFinite(a.confidence)) invalid();
        return { mass: labels.map(l => { const v = a.probabilities[l]; return Number.isFinite(v) && v > 0 ? v : 0; }), conf: a.confidence };
      };
      const f = dist("i" + k), r = dist("r" + k), sum = f.mass.reduce((s, v, i) => s + v + r.mass[i], 0);
      if (!(sum > 0)) invalid();
      out.push({ probs: labels.map((label, i) => ({ label, p: r6(Math.min(1, (f.mass[i] + r.mass[i]) / sum)) })), score: null, confidence: r6((f.conf + r.conf) / 2) });
    } else if (q.type === "score") {
      const a = answers["i" + k];
      if (!a || a.type !== "score" || !a.probabilities || typeof a.probabilities !== "object" || !Number.isFinite(a.score) || !Number.isFinite(a.confidence)) invalid();
      // Jev score 는 0..levels-1 기댓값이라 계약의 1..5 로 한 단계 올린다.
      out.push({ probs: labels.map((label, i) => ({ label, p: Number.isFinite(a.probabilities[String(i)]) ? clamp01(a.probabilities[String(i)]) : 0 })), score: a.score + 1, confidence: a.confidence });
    } else {
      const a = answers["i" + k];
      if (!a || a.type !== "noul" || !Number.isFinite(a.noul)) invalid();
      const p = clamp01(a.noul);
      // noul 답에는 confidence 필드가 없다 — 확률이 0.5 에서 얼마나 멀리 떨어졌는지로 계산한다.
      out.push({ probs: [{ label: labels[0], p: r6(p) }, { label: labels[1], p: r6(1 - p) }], score: r6(p), confidence: r6(Math.abs(2 * p - 1)) });
    }
  }
  return out;
}
module.exports = { ENDPOINT, JUDGE_TASKS, QUESTIONS, buildRequests, parseAnswers };
