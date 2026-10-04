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
// 강의 분야 분류 — 교육부 학과 분류의 중분류다. plan 요청마다 슬라이드 제목 첫 줄을 모아 한 번 묻고
// 결과는 원장(subject) 메타로만 나간다. 라벨 순서는 f(정방향)·r(역방향) 두 질문과 parse 가 같이 쓴다.
const SUBJECTS = Object.freeze({
  language_literature: "언어·문학",
  humanities: "인문과학(철학·역사·종교)",
  business_economics: "경영·경제",
  law: "법률",
  social_science: "사회과학",
  education: "교육",
  architecture: "건축",
  civil_urban: "토목·도시",
  transport: "교통·운송",
  mechanical: "기계·금속",
  electrical_electronic: "전기·전자",
  precision_energy: "정밀·에너지",
  materials: "소재·재료",
  computer_communication: "컴퓨터·통신",
  industrial: "산업공학",
  chemical_engineering: "화공",
  agriculture_fisheries: "농림·수산",
  bio_chem_env: "생물·화학·환경",
  human_ecology: "생활과학",
  math_physics: "수학·물리·천문·지리",
  medicine: "의료",
  nursing: "간호",
  pharmacy: "약학",
  health_therapy: "치료·보건",
  design: "디자인",
  applied_arts: "응용예술",
  sports_dance: "무용·체육",
  fine_arts: "미술·조형",
  theater_film: "연극·영화",
  music: "음악",
  other: "기타",
});
// 선택지 기준은 영어 설명에 한국어 라벨을 싣는다(다른 과제의 {what} 과 같은 모양). other 는 어느 분야에도 안 맞을 때만 고른다.
const SUBJECT_WHAT = Object.freeze({
  language_literature: "언어·문학: language and literature — Korean or foreign languages, literature, linguistics",
  humanities: "인문과학(철학·역사·종교): humanities — philosophy, history, religion",
  business_economics: "경영·경제: business administration and economics — management, accounting, finance, marketing, trade",
  law: "법률: law and legal studies",
  social_science: "사회과학: social sciences — political science, public administration, sociology, psychology, media/communication, social welfare",
  education: "교육: education — pedagogy and teacher training",
  architecture: "건축: architecture and architectural engineering",
  civil_urban: "토목·도시: civil engineering and urban planning",
  transport: "교통·운송: transportation and logistics",
  mechanical: "기계·금속: mechanical engineering — automotive, shipbuilding, metal machinery",
  electrical_electronic: "전기·전자: electrical and electronic engineering, semiconductors",
  precision_energy: "정밀·에너지: precision instruments and energy/nuclear engineering",
  materials: "소재·재료: materials science and engineering",
  computer_communication: "컴퓨터·통신: computer science, software, information/communication engineering, AI",
  industrial: "산업공학: industrial engineering and industrial management",
  chemical_engineering: "화공: chemical, polymer and textile engineering",
  agriculture_fisheries: "농림·수산: agriculture, forestry, fisheries and marine science",
  bio_chem_env: "생물·화학·환경: biology, chemistry, environmental science and engineering",
  human_ecology: "생활과학: human ecology — food and nutrition, clothing, housing, family/child studies",
  math_physics: "수학·물리·천문·지리: mathematics, statistics, physics, astronomy, earth science and geography",
  medicine: "의료: medicine, dentistry, Korean medicine, veterinary medicine",
  nursing: "간호: nursing",
  pharmacy: "약학: pharmacy and pharmaceutical sciences",
  health_therapy: "치료·보건: health sciences and therapy — physical/occupational therapy, public health, clinical laboratory",
  design: "디자인: design — industrial, visual, fashion and communication design",
  applied_arts: "응용예술: applied arts — crafts, ceramics, textile art",
  sports_dance: "무용·체육: dance and physical education/sports",
  fine_arts: "미술·조형: fine arts — painting, sculpture, plastic arts",
  theater_film: "연극·영화: theater, film and broadcasting",
  music: "음악: music — composition, performance, practical music",
  other: "기타: use only if none fits",
});
// 분류는 항목 청크가 아니라 제목 목록 하나를 묻는 단일 요청이다 — 질문은 f(정방향)·r(역방향) 둘뿐이다.
function buildSubjectRequest(titles, opts = {}) {
  const list = (Array.isArray(titles) ? titles : []).map(t => typeof t === "string" ? t.trim().slice(0, 80) : "").filter(Boolean).slice(0, 20);
  const instructions = "The state `titles` holds Korean university lecture slide titles. Which academic field is this lecture course in?";
  const question = reversed => {
    const entries = Object.keys(SUBJECTS).map(k => [k, { what: SUBJECT_WHAT[k] }]);
    if (reversed) entries.reverse();
    return { type: "choice", instructions, criteria: Object.fromEntries(entries) };
  };
  return { body: { model: opts.model, state: { titles: list }, questions: { f: question(false), r: question(true) }, provider: { only: opts.providers, allow_fallbacks: false, zdr: true, data_collection: "deny" } } };
}
// 두 분포(정방향·역방향)를 선택지별로 평균 내 argmax 를 고른다. 어긋난 응답은 제공자 실패와 같이 던진다.
function parseSubjectAnswer(json) {
  const answers = json && typeof json === "object" ? json.answers : null;
  const dist = k => {
    const a = answers && typeof answers === "object" ? answers[k] : null;
    if (!a || a.type !== "choice" || !a.probabilities || typeof a.probabilities !== "object") throw new Error("subject_answer_invalid");
    return a.probabilities;
  };
  const f = dist("f"), r = dist("r");
  let subject = null, best = 0;
  for (const code of Object.keys(SUBJECTS)) {
    const p = ((Number.isFinite(f[code]) ? f[code] : 0) + (Number.isFinite(r[code]) ? r[code] : 0)) / 2;
    if (p > best) { best = p; subject = code; }
  }
  if (subject === null) throw new Error("subject_answer_invalid");
  return { subject, conf: Math.round(best * 1e4) / 1e4 };
}
module.exports = { ENDPOINT, JUDGE_TASKS, QUESTIONS, SUBJECTS, buildRequests, buildSubjectRequest, parseAnswers, parseSubjectAnswer };
