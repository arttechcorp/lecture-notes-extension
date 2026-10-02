// 파이프라인 v2 H단계 렌더 엔진 (docs/architecture-v2.md §6.3·§6.6·§6.7). Note JSON + 수식 등록부 + 크롭 → 결정적 HTML.
// 표현(템플릿·문서 순서·고지 문구·CSS)은 전부 NoteSpec 슬롯(lib/note-spec.js)에서 온다. 여기에는 양식이 없다.
// 엔진이 책임지는 것: 모델 텍스트 이스케이프, {{F12}} 치환, 수식 상태별 표시, 크롭 src 허용 목록, 경고 코드.
// 경고는 내용이 없다 — {code, count, ids?}만. KaTeX 은 formulas.js 처럼 불러오지 않고 주입받는다.
(() => {
  const NoteSpec = globalThis.NoteSpec || (typeof require !== "undefined" ? require("./note-spec.js") : null);
  // formulas.js substituteRefs·verify.js 와 같은 참조 형태. 렌더러가 치환하는 것만 참조로 센다.
  const REF = /\{\{\s*(F\d+)\s*\}\}/g;
  // 크롭은 blob: 이거나 래스터 data: 이미지여야 한다. 원격 URL·svg·html 은 거절한다(추적·스크립트 경로).
  const SRC_OK = /^(?:blob:[\w\-.~:\/?#@!$&()*+,;=%]+|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+\/]+={0,2})$/;
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = text => String(text ?? "").replace(/[&<>"']/g, c => ESC[c]);
  const arr = v => (Array.isArray(v) ? v : []);
  // 알 수 없는 블록 폴백이 건너뛰는 키: 문자열이지만 본문이 아니다.
  const SKIP_KEYS = new Set(["type", "id", "evidenceIds"]);
  const leaves = (v, out = []) => {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!SKIP_KEYS.has(k)) leaves(x, out);
    return out;
  };

  function renderNote(note, { katex, crops = {}, spec = NoteSpec } = {}) {
    // KaTeX 부재를 조용히 넘기면 모든 수식이 크롭·미검증으로 내려간다 — formulas.js 처럼 즉시 던진다.
    if (!katex || typeof katex.renderToString !== "function") throw new Error("KaTeX 객체가 필요합니다.");
    const n = { ...note, global: arr(note?.global), sections: arr(note?.sections), registry: arr(note?.registry), notices: arr(note?.notices) };
    const byId = new Map(n.registry.filter(e => e && typeof e.id === "string").map(e => [e.id, e]));
    const cropMap = crops && typeof crops === "object" ? crops : {};
    const warnings = [];
    const warn = (code, id) => {
      let w = warnings.find(x => x.code === code);
      if (!w) warnings.push(w = { code, count: 0 });
      w.count++;
      if (typeof id === "string" && /^F\d+$/.test(id)) { w.ids ??= []; if (!w.ids.includes(id)) w.ids.push(id); }
    };

    const render = (latex, display) => {
      try { return katex.renderToString(String(latex ?? ""), { throwOnError: true, displayMode: display }); } catch { return null; }
    };
    const crop = (id, alt = "") => {
      if (!Object.hasOwn(cropMap, id)) return "";
      const src = cropMap[id];
      if (typeof src !== "string" || !SRC_OK.test(src)) { warn("RENDER_CROP_REJECTED", id); return ""; }
      return `<img class="note-crop" src="${esc(src)}" alt="${esc(alt)}">`;
    };
    // 검증된 LaTeX 만 수식으로 그린다. 그 외(reread·image·unverified·KaTeX 실패)는 크롭, 없으면 OCR 텍스트(미검증).
    const formula = id => {
      const e = byId.get(id);
      if (!e) { warn("RENDER_REF_UNKNOWN", id); return `<span class="note-f note-f-missing">[알 수 없는 수식 ${esc(id)}]</span>`; }
      if (e.status === "verified" && typeof e.latex === "string" && e.latex.trim()) {
        const html = render(e.latex, false);
        if (html !== null) return html;
        warn("RENDER_FORMULA_FAILED", id);
      }
      const img = crop(id, "원본 이미지로 표시");
      if (img) return `<span class="note-f note-f-img">${img}<span class="note-f-label">원본 이미지로 표시</span></span>`;
      const text = typeof e.text === "string" && e.text.trim() ? e.text : "[수식]";
      return `<span class="note-f note-f-raw">${esc(text)}<span class="note-f-label">미검증</span></span>`;
    };
    // 요소 본문 전용: 결과에 따옴표가 들어 있어 속성 안에 쓰면 깨진다. 속성에는 esc 만 쓴다.
    const rich = text => esc(text).split(/\r?\n/).map(line => line.replace(REF, (_, id) => formula(id))).join("<br>");
    const math = (latex, opts) => render(latex, !!(opts && opts.display))
      ?? (warn("RENDER_FORMULA_FAILED"), `<code class="note-f-src">${esc(latex)}</code>`);

    // 템플릿이 던지거나 문자열을 안 주면 폴백으로 대신한다 — 렌더는 항상 문서 하나를 낸다.
    const guard = (fn, fallback) => {
      try { const out = fn(); if (typeof out === "string") return out; } catch { /* 아래 경고 */ }
      warn("RENDER_TEMPLATE_FAILED");
      return fallback();
    };
    const fallback = b => `<div class="note-block note-block-fallback">${leaves(b).map(t => `<p>${rich(t)}</p>`).join("")}</div>`;
    const block = b => {
      const type = b && b.type, templates = spec.templates || {};
      if (typeof type !== "string" || !Object.hasOwn(templates, type) || typeof templates[type] !== "function") {
        warn("RENDER_NO_TEMPLATE");
        return fallback(b);
      }
      return guard(() => templates[type](b, h), () => fallback(b));
    };
    // 고지 문구는 일반 텍스트이고 여기서 이스케이프한다.
    const notice = x => esc(guard(() => spec.notice(x, h), () => ""));

    const h = { esc, rich, math, formula, crop, block, notice };
    if (n.noteSpecVersion !== spec.NOTE_SPEC_VERSION) warn("RENDER_SPEC_MISMATCH");
    const html = (spec.css ? `<style>${spec.css}</style>` : "") + spec.layout(n, h);
    return { html, warnings };
  }

  const api = { renderNote };
  globalThis.NoteRender = api;
  if (typeof module !== "undefined") module.exports = api;
})();
