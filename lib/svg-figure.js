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
  function relativeLuminance(color) {
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

  const api = { allowTag, allowAttr, relativeLuminance, coversViewBox, ALLOWED_TAGS, ALLOWED_ATTRS };
  if (typeof module !== "undefined") module.exports = api;
  globalThis.SvgFigure = api;
})();
