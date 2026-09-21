// 모델이 생성한 인라인 SVG를 노트에 넣기 위한 정화기.
//
// 신뢰 경계다. sandbox.html 은 marked 출력을 innerHTML 에 그대로 넣고 marked 는 HTML 을
// 거르지 않는다. renderFrame 에 allow-same-origin 이 없어 chrome.* 에는 닿지 못하지만
// manifest 의 CSP 에 connect-src 가 없어 <svg onload> 안의 fetch 는 외부로 나간다 —
// "원문을 외부로 보내지 않는다"가 걸리는 자리라 속성은 기본 거부로 간다.
(() => {
  const ALLOWED_TAGS = new Set(["svg", "g", "rect", "circle", "ellipse", "line", "polyline",
    "polygon", "path", "text", "tspan", "defs", "marker", "linearGradient", "stop", "title", "desc"]);

  // 기본 거부. 여기 없는 속성은 이름을 보지 않고 버린다 — 차단 목록이면 새 이벤트
  // 핸들러 속성이 생길 때마다 구멍이 난다.
  const ALLOWED_ATTRS = new Set(["x", "y", "width", "height", "cx", "cy", "r", "rx", "ry",
    "x1", "y1", "x2", "y2", "d", "points", "transform", "viewBox",
    "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap",
    "opacity", "fill-opacity", "text-anchor", "dominant-baseline",
    "font-size", "font-weight", "font-family"]);

  // 소문자 비교 전용 조회 테이블. ALLOWED_ATTRS 자체는 가독성을 위해 원문 철자를
  // 유지하고(브리프 그대로), 멤버십 판정만 이 세트로 낮춰서 한다 — allowAttr("viewBox")
  // 같은 camelCase 입력도 소문자-소문자 비교로 통과한다. 기본 거부 성질은 그대로:
  // 여기 없는 이름은 무엇이든 이름을 보지 않고 버린다.
  const ALLOWED_ATTRS_LOWER = new Set([...ALLOWED_ATTRS].map(attr => attr.toLowerCase()));

  // 태그 이름만 대소문자를 무시한다. SVG 는 linearGradient 처럼 camelCase 가 정식이라
  // 비교용으로만 낮춘다.
  const allowTag = name => ALLOWED_TAGS.has(String(name || "")) ||
    [...ALLOWED_TAGS].some(tag => tag.toLowerCase() === String(name || "").toLowerCase());

  const allowAttr = name => ALLOWED_ATTRS_LOWER.has(String(name || "").toLowerCase());

  // WCAG 상대휘도. 배경이 없는 SVG 의 카드 색을 글자 밝기로 정하는 데 쓴다.
  // 코퍼스와 모델 출력이 실제로 쓰는 색 키워드는 white/black 뿐이라 그 둘만 더한다 —
  // 전체 CSS 색이름표는 만들지 않는다.
  function relativeLuminance(color) {
    const keyword = String(color || "").trim().toLowerCase();
    if (keyword === "white") return 1;
    if (keyword === "black") return 0;
    let hex = String(color || "").trim().replace(/^#/, "");
    if (hex.length === 3) hex = [...hex].map(c => c + c).join("");
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    const channel = value => {
      const c = parseInt(value, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(hex.slice(0, 2)) + 0.7152 * channel(hex.slice(2, 4)) + 0.0722 * channel(hex.slice(4, 6));
  }

  // viewBox 면적의 90% 이상을 덮으면 배경판으로 본다. 코퍼스의
  // <rect width="100%" height="100%" fill="#0f172a"/> 가 여기 걸린다.
  function coversViewBox(width, height, vbWidth, vbHeight) {
    if (!(vbWidth > 0) || !(vbHeight > 0)) return false;
    const span = (value, total) => {
      const text = String(value == null ? "" : value).trim();
      if (!text) return NaN;
      return text.endsWith("%") ? parseFloat(text) / 100 * total : parseFloat(text);
    };
    const w = span(width, vbWidth), h = span(height, vbHeight);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return false;
    return w >= vbWidth * 0.9 && h >= vbHeight * 0.9;
  }

  // DOM 파싱은 브라우저에서만 한다. node 테스트는 위의 순수 함수만 검증하고,
  // 이 순회는 tools/svg-figure-probe.html 이 코퍼스 21개로 확인한다.
  // 정규식 정화는 쓰지 않는다 — HTML 을 정규식으로 거르는 건 새는 방식이다.
  function sanitizeSvgFigure(svgText) {
    const fail = { ok: false, svg: "", background: "dark", dropped: [] };
    if (typeof DOMParser === "undefined" || !svgText) return fail;
    const doc = new DOMParser().parseFromString(String(svgText), "image/svg+xml");
    if (doc.getElementsByTagName("parsererror").length) return fail;
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== "svg") return fail;

    const dropped = [];
    // 자식부터 지우면서 순회해야 하므로 먼저 목록을 만든다.
    for (const node of [...root.querySelectorAll("*")]) {
      if (!allowTag(node.nodeName)) { dropped.push(node.nodeName); node.remove(); }
    }
    for (const node of [root, ...root.querySelectorAll("*")]) {
      for (const attr of [...node.attributes]) {
        if (!allowAttr(attr.name)) { dropped.push(attr.name); node.removeAttribute(attr.name); }
      }
    }

    const viewBox = String(root.getAttribute("viewBox") || "").trim().split(/\s+/).map(Number);
    const vbWidth = viewBox.length === 4 ? viewBox[2] : 0, vbHeight = viewBox.length === 4 ? viewBox[3] : 0;

    // 배경이 이미 있으면 손대지 않는다(코퍼스 15/21). 없을 때만 우리가 카드를 깐다.
    // 판정 불가면 어두운 카드로 기본한다 — 코퍼스 실측상 밝은 글자가 다수(14/21)이고,
    // "theme" 배경은 흰 배경에 흰 글자가 겹칠 수 있는 유일한 경로라 기본값에서 뺐다.
    let background = "dark";
    const hasOwn = [...root.querySelectorAll("rect, path, polygon")].some(shape => {
      const fill = String(shape.getAttribute("fill") || "");
      if (!fill || fill === "none" || fill === "transparent") return false;
      return coversViewBox(shape.getAttribute("width"), shape.getAttribute("height"), vbWidth, vbHeight);
    });
    if (hasOwn) background = "own";
    else {
      // 글자가 밝으면 어두운 카드, 어두우면 밝은 카드. 판정 불가하면 위의 기본값(dark)을 쓴다.
      const levels = [...root.querySelectorAll("text")]
        .map(node => relativeLuminance(node.getAttribute("fill"))).filter(Number.isFinite);
      if (levels.length) background = levels.reduce((a, b) => a + b, 0) / levels.length > 0.5 ? "dark" : "light";
    }

    // 좁은 패널에서 넘치지 않도록 루트 크기를 고정한다. viewBox 가 비율을 지킨다.
    root.setAttribute("width", "100%");
    root.removeAttribute("height");

    return { ok: true, svg: new XMLSerializer().serializeToString(root), background, dropped };
  }

  const api = { sanitizeSvgFigure, allowTag, allowAttr, relativeLuminance, coversViewBox, ALLOWED_TAGS, ALLOWED_ATTRS };
  if (typeof module !== "undefined") module.exports = api;
  globalThis.SvgFigure = api;
})();
