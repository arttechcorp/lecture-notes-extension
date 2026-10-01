// 수식은 화면에서 한 번만 추출해 레지스트리에 둔다. 요약 LLM은 수식을 다시 쓰지 않고
// {{F12}}로 참조하고, 렌더러가 레지스트리 LaTeX로 치환한다. 학생에게 보이는 LaTeX은
// 전부 검증을 거치고, 실패하면 원본 크롭 이미지가 대신 나간다.
// 검증과 렌더링에 같은 vendor KaTeX을 쓰므로 "검증 통과"는 곧 "렌더링 성공"이다.
// KaTeX은 여기서 불러오지 않는다 — 브라우저는 globalThis.katex을, 테스트는 require 결과를 넘긴다.
(() => {
  // 비교 전용 정규화. 렌더링 차이가 없는 요소(공백, \left/\right, 간격·표시 명령,
  // 바깥 $ 구분자)를 지워 같은 수식이 다르게 읽힌 경우를 한 값으로 맞춘다.
  function normalizeLatex(s) {
    return String(s || "")
      .trim()
      .replace(/^\$\$?/, "").replace(/\$\$?$/, "")
      .replace(/\\[dt]frac\b/g, "\\frac")
      .replace(/\\(?:left|right)(?![a-zA-Z])|\\displaystyle\b|\\q?quad\b|\\[,;:!]/g, "")
      .replace(/\s+/g, "");
  }

  // 숫자만 모아 다중집합 비교에 쓴다. OCR의 유니코드 위·아래첨자(x², y₁)와 전각
  // 숫자는 NFKC로 ASCII에 맞춘다. "1\,000" 류 천 단위 구분은 명령 제거가 "\,"를
  // 먹어버리기 전에 합친다. \frac12 축약만 "1 2"로 펼친다 — 중괄호 형태는 어차피
  // 숫자가 갈라져 나온다.
  function numericTokens(s) {
    s = String(s || "").normalize("NFKC");
    s = s.replace(/(?<=\d)(?:\\,|\{,\}|,)(?=\d{3}(?!\d))/g, "");
    s = s.replace(/\\[dt]?frac\s*(\d)\s*(\d)/g, " $1 $2 ");
    s = s.replace(/\\[a-zA-Z]+/g, " ").replace(/\\./g, " ");
    return (s.match(/\d+(?:\.\d+)?|\.\d+/g) || []).sort((a, b) => a - b);
  }

  // OCR 숫자와 LaTeX 숫자의 다중집합 차이. 비교할 OCR이 없으면 검증을 스킵한다.
  function crossCheck(latex, ocrText) {
    if (ocrText == null || !String(ocrText).trim()) return { ok: true, missing: [], extra: [], skipped: true };
    const left = new Map();
    for (const t of numericTokens(latex)) left.set(t, (left.get(t) || 0) + 1);
    const missing = [];
    for (const t of numericTokens(ocrText)) {
      if (left.get(t) > 0) left.set(t, left.get(t) - 1);
      else missing.push(t);
    }
    const extra = [];
    for (const [t, c] of left) for (let i = 0; i < c; i++) extra.push(t);
    const byNum = (a, b) => a - b;
    return { ok: !missing.length && !extra.length, missing: missing.sort(byNum), extra: extra.sort(byNum) };
  }

  function validateDerived(latex, katex) {
    // KaTeX 부재를 실패로 삼으면 모든 수식이 조용히 "image"로 내려간다 — 즉시 던진다.
    if (!katex || typeof katex.renderToString !== "function") throw new Error("KaTeX 객체가 필요합니다.");
    if (typeof latex !== "string" || !latex.trim()) return { ok: false, error: "수식이 비어 있습니다." };
    try {
      katex.renderToString(latex, { throwOnError: true, displayMode: true });
      return { ok: true, error: null };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  function parseOk(latex, katex) {
    return validateDerived(latex, katex).ok;
  }

  // id는 (t0, bbox.y, bbox.x) 순으로 부여하고 bbox 없는 것은 같은 슬라이드 뒤에 둔다.
  // 프로그레시브 슬라이드 — 직전 슬라이드와 정규화 LaTeX가 같은 수식은 첫 등장만
  // 남기고 나머지 slideId는 seenOn에 모은다(같은 slideId는 한 번만).
  function buildRegistry(slides) {
    const registry = [];
    let prev = new Map();
    for (const slide of [...(slides || [])].sort((a, b) => a.t0 - b.t0)) {
      const fs = [...(slide.formulas || [])].sort((a, b) => {
        if (!a.bbox && !b.bbox) return 0;
        if (!a.bbox) return 1;
        if (!b.bbox) return -1;
        return a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x;
      });
      const cur = new Map();
      for (const f of fs) {
        const norm = f.latex ? normalizeLatex(f.latex) : "";
        const dup = norm && prev.get(norm);
        if (dup) {
          if (!dup.seenOn.includes(slide.slideId)) dup.seenOn.push(slide.slideId);
          cur.set(norm, dup);
          continue;
        }
        const entry = {
          id: "F" + (registry.length + 1),
          slideId: slide.slideId, t0: slide.t0,
          latex: f.latex ?? null, text: f.text ?? null, bbox: f.bbox ?? null,
          conf: f.conf ?? null, status: "unverified", seenOn: [],
        };
        if (norm) cur.set(norm, entry);
        registry.push(entry);
      }
      prev = cur;
    }
    return registry;
  }

  // 파싱과 OCR 숫자 대조를 함께 통과해야 "verified". 첫 실패는 "reread"(호출자가 더
  // 강한 모델로 한 번 다시 읽고 reread:true로 재호출), 재시도 실패는 "image"로 내려
  // 원본 크롭을 쓴다. 무료 로컬 모드(latex 없이 OCR text만)는 검증할 LaTeX이 없어
  // "unverified"를 유지한다.
  function verify(entry, opts = {}) {
    if (typeof entry?.latex !== "string" || !entry.latex.trim()) return { ...entry, status: "unverified" };
    const ok = parseOk(entry.latex, opts.katex) && crossCheck(entry.latex, opts.ocrText ?? entry.text).ok;
    return { ...entry, status: ok ? "verified" : opts.reread ? "image" : "reread" };
  }

  // 검증된 수식만 LaTeX로 치환한다. 그 외(reread/image/unverified)는 원본 크롭 토큰으로
  // 두어 미검증 LaTeX이 학생에게 나가지 않게 한다.
  function substituteRefs(text, registry) {
    const byId = new Map((registry || []).map((e) => [e.id, e]));
    return String(text || "").replace(/\{\{\s*(F\d+)\s*\}\}/g, (m, id) => {
      const e = byId.get(id);
      if (!e) throw new Error("알 수 없는 수식 참조: " + id);
      return e.status === "verified" && e.latex ? "$" + e.latex + "$" : "[[IMG:" + id + "]]";
    });
  }

  // 요약 LLM이 참조 대신 수식을 다시 써버린 출력을 찾는다. 너무 짧은 수식(정규화 후
  // 8자 미만)은 본문과 우연히 겹치는 일이 잦아 제외한다.
  function findRetypedLatex(text, registry) {
    const norm = normalizeLatex(text);
    return (registry || [])
      .filter((e) => { const n = e.latex ? normalizeLatex(e.latex) : ""; return n.length >= 8 && norm.includes(n); })
      .map((e) => e.id);
  }

  const api = { buildRegistry, normalizeLatex, parseOk, numericTokens, crossCheck, verify, substituteRefs, findRetypedLatex, validateDerived };
  globalThis.Formulas = api;
  if (typeof module !== "undefined") module.exports = api;
})();
