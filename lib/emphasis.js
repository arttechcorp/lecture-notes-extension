// mis-sol-hai 강조 신호 계산 (기획 §4.3, D4, D10).
// 슬라이드·발화 유닛별 성분: dwellRatio(체류 비율), repeatCount(핵심어 재등장), stressHits(강조어 출현), revisits(재방문), inkArea(필기 면적).
// 가중합 없이 성분 그대로 숫자로 반환하여 계획 모델(Sol)이 판단하게 한다.

const EMPHASIS_WORDS = {
  stress: /중요|핵심|꼭|반드시|기억|\b(?:important|crucial|essential|remember|key point)\b/i,
  exam: /시험|출제|중간고사|기말고사|퀴즈|\b(?:exams?|midterm|final exam|quiz)\b/i,
};

const STRESS_RE = /중요|핵심|꼭|반드시|기억|\b(?:important|crucial|essential|remember|key point)\b/gi;
const EXAM_RE = /시험|출제|중간고사|기말고사|퀴즈|\b(?:exams?|midterm|final exam|quiz)\b/gi;

const TOKEN_RE = /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*(?:\+\+|#)?|[가-힣]+/gu;
const ENGLISH_STOPWORDS = new Set((
  "the and for are was were with that this from have has will would what which when where then than into also each other about such using used not but you your can may is it of in to by or as at be an on if so we do no " +
  "a i he she they them their our us me him her its his my who whom how why all any some only very just now out up off over under too " +
  "page slide slides chapter figure fig table example examples contents agenda overview summary introduction lecture week part section copyright reserved rights www http https com pdf ppt pptx"
).split(" "));
const KOREAN_STOPWORDS = new Set((
  "있는 있다 없는 없다 하는 하다 되는 되다 대한 대해 통해 위한 위해 따라 따라서 그리고 하지만 그러나 또는 경우 때문 때문에 다음 이상 이하 관련 가장 매우 우리 이것 그것 여기 오늘 사용 " +
  "같은 이런 그런 저런 여러분 그래서 그러면 것은 입니다 합니다 등의 및 수 등 이 그 저 것"
).split(" "));
const PARTICLES = ["에서는", "에서", "으로", "에게", "까지", "부터", "보다", "처럼", "은", "는", "이", "가", "을", "를", "의", "에", "로", "와", "과"];

function countStressHits(text) {
  if (!text || typeof text !== "string") return 0;
  const stress = (text.match(STRESS_RE) || []).length;
  const exam = (text.match(EXAM_RE) || []).length;
  return stress + exam;
}

function extractKeywords(text) {
  if (!text || typeof text !== "string") return [];
  const words = text.match(TOKEN_RE) || [];
  const set = new Set();
  for (const raw of words) {
    let tok = raw.trim();
    if (!tok) continue;
    const isKo = /[가-힣]/.test(tok[0]);
    if (isKo) {
      if (tok.length < 2 || tok.length > 30 || KOREAN_STOPWORDS.has(tok)) continue;
      for (const p of PARTICLES) {
        if (tok.endsWith(p) && tok.length - p.length >= 2) {
          const stem = tok.slice(0, -p.length);
          if (!KOREAN_STOPWORDS.has(stem)) tok = stem;
          break;
        }
      }
      if (tok.length >= 2 && !KOREAN_STOPWORDS.has(tok)) set.add(tok);
    } else {
      const lower = tok.toLowerCase();
      if (lower.length < 2 || lower.length > 30 || ENGLISH_STOPWORDS.has(lower)) continue;
      set.add(lower);
    }
  }
  return [...set];
}

function countKeywordHits(keyword, text) {
  if (!keyword || !text || typeof text !== "string") return 0;
  const isKo = /[가-힣]/.test(keyword[0]);
  if (isKo) {
    return text.split(keyword).length - 1;
  }
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "gi");
  return (text.match(re) || []).length;
}

function getUnitSpeechSeconds(u, evidence) {
  if (!u) return 0;
  const speechText = String(u.speech || "").trim();
  if (!speechText) return 0;

  if (Array.isArray(evidence) && evidence.length) {
    const ev = evidence.filter(e => e && e.unitId === u.unitId && e.kind === "speech");
    if (ev.length) {
      return ev.reduce((sum, e) => sum + Math.max(0, (e.t1 ?? e.t0 ?? 0) - (e.t0 ?? 0)), 0);
    }
  }
  if (typeof u.speechDuration === "number" && Number.isFinite(u.speechDuration)) {
    return Math.max(0, u.speechDuration);
  }
  if (typeof u.t0 === "number" && typeof u.t1 === "number" && u.t1 > u.t0) {
    return Math.max(0, u.t1 - u.t0);
  }
  if (typeof u.features?.dwell === "number" && u.features.dwell > 0) {
    return Math.max(0, u.features.dwell);
  }
  return 0;
}

function getRevisits(u, units, slides) {
  if (typeof u.revisits === "number" && Number.isFinite(u.revisits)) return Math.max(0, Math.floor(u.revisits));
  if (typeof u.revisitCount === "number" && Number.isFinite(u.revisitCount)) return Math.max(0, Math.floor(u.revisitCount));
  if (!u.slideId) return 0;
  let count = 0;
  for (const other of units) {
    if (other && other.slideId === u.slideId) count++;
  }
  if (Array.isArray(slides)) {
    const sc = slides.filter(s => s && s.slideId === u.slideId).length;
    if (sc > count) count = sc;
  }
  return Math.max(0, count - 1);
}

function getInkArea(u, options) {
  if (typeof u.inkArea === "number" && Number.isFinite(u.inkArea)) return Math.max(0, u.inkArea);
  if (typeof u.slide?.inkArea === "number" && Number.isFinite(u.slide.inkArea)) return Math.max(0, u.slide.inkArea);
  const fromMap = options?.inkAreas?.[u.unitId] ?? options?.inkAreas?.[u.slideId];
  if (typeof fromMap === "number" && Number.isFinite(fromMap)) return Math.max(0, fromMap);
  return 0;
}

function computeEmphasis(units = [], options = {}) {
  if (!Array.isArray(units) && typeof units === "object" && units !== null) {
    options = units;
    units = options.units || [];
  }
  if (!Array.isArray(units) || !units.length) {
    const empty = [];
    empty.byUnit = new Map();
    empty.get = () => undefined;
    return empty;
  }

  const evidence = options.evidence || [];
  const slides = options.slides || [];
  const allSpeech = units.map(u => u?.speech || "").join(" ");

  // 1. 단위별 발화 초 계산 및 슬라이드별 합산 (재방문 합산)
  const slideSeconds = new Map();
  for (const u of units) {
    if (!u) continue;
    const sid = u.slideId ?? u.unitId;
    const sec = getUnitSpeechSeconds(u, evidence);
    slideSeconds.set(sid, (slideSeconds.get(sid) ?? 0) + sec);
  }

  // 2. 슬라이드 체류 초 중앙값
  const values = [...slideSeconds.values()];
  let median = 0;
  if (values.length > 0) {
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    median = values.length % 2 !== 0 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  }

  // 3. 유닛별 강조 신호 성분 계산
  const result = units.map(u => {
    if (!u) return { unitId: "", dwellRatio: 0, repeatCount: 0, stressHits: 0, revisits: 0, inkArea: 0 };
    const sid = u.slideId ?? u.unitId;
    const totalSlideSec = slideSeconds.get(sid) ?? 0;
    const dwellRatio = median > 0 && totalSlideSec > 0
      ? Math.round((totalSlideSec / median) * 100) / 100
      : 0;

    const keywords = Array.isArray(u.keywords) ? u.keywords : extractKeywords(u.slideText);
    const repeatCount = allSpeech
      ? keywords.reduce((n, kw) => n + countKeywordHits(kw, allSpeech), 0)
      : 0;

    const stressHits = countStressHits(u.speech);
    const revisits = getRevisits(u, units, slides);
    const inkArea = Math.round(getInkArea(u, options) * 100) / 100;

    return {
      unitId: u.unitId,
      dwellRatio,
      repeatCount,
      stressHits,
      revisits,
      inkArea,
    };
  });

  result.byUnit = new Map(result.map(e => [e.unitId, e]));
  result.get = id => result.byUnit.get(id);

  return result;
}

const api = {
  EMPHASIS_WORDS,
  countStressHits,
  extractKeywords,
  countKeywordHits,
  getUnitSpeechSeconds,
  computeEmphasis,
};

globalThis.Emphasis = api;
if (typeof module !== "undefined") {
  module.exports = api;
}
