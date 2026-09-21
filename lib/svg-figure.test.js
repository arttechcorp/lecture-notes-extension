const assert = require("node:assert/strict");
const { allowTag, allowAttr, relativeLuminance, coversViewBox } = require("./svg-figure.js");

// 태그: 허용 목록만 통과하고, 대소문자는 무시한다.
for (const tag of ["svg", "g", "rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text", "tspan", "defs", "marker", "linearGradient", "stop", "title", "desc"])
  assert.equal(allowTag(tag), true, `${tag}는 허용된다`);
assert.equal(allowTag("linearGradient"), true, "camelCase 태그도 허용된다");
for (const tag of ["script", "foreignObject", "image", "a", "use", "animate", "animateTransform", "style", "iframe"])
  assert.equal(allowTag(tag), false, `${tag}는 차단된다`);

// 속성: 기본 거부. 목록에 없으면 전부 버린다.
for (const attr of ["x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "d", "points", "transform", "viewBox", "fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "opacity", "fill-opacity", "text-anchor", "dominant-baseline", "font-size", "font-weight", "font-family"])
  assert.equal(allowAttr(attr), true, `${attr}는 허용된다`);
for (const attr of ["onload", "onclick", "ONLOAD", "href", "xlink:href", "style", "onmouseover", "formaction"])
  assert.equal(allowAttr(attr), false, `${attr}는 차단된다`);

// 상대휘도: 흰색 1, 검정 0, 코퍼스의 실제 값들이 경계 양쪽에 놓인다.
assert.equal(relativeLuminance("#ffffff"), 1);
assert.equal(relativeLuminance("#000000"), 0);
assert.equal(relativeLuminance("#FFF"), 1, "3자리 축약형을 편다");
assert.equal(relativeLuminance("#FFFFFF"), 1, "대문자를 받는다");
assert.ok(relativeLuminance("#f8fafc") > 0.5, "코퍼스의 밝은 글자색");
assert.ok(relativeLuminance("#0f172a") < 0.5, "코퍼스의 어두운 배경색");
assert.equal(relativeLuminance("none"), null, "색이 아니면 null");
assert.equal(relativeLuminance(""), null);
assert.equal(relativeLuminance(null), null);

// 전면 배경 판정: viewBox 면적의 90% 이상을 덮으면 배경이다.
assert.equal(coversViewBox("100%", "100%", 900, 380), true, "퍼센트 전면");
assert.equal(coversViewBox("900", "380", 900, 380), true, "정확히 같은 크기");
assert.equal(coversViewBox("810", "342", 900, 380), true, "정확히 90%는 배경이다");
assert.equal(coversViewBox("809", "342", 900, 380), false, "90% 바로 아래는 배경이 아니다");
assert.equal(coversViewBox("160", "36", 900, 380), false, "코퍼스의 밴드 상자는 배경이 아니다");
assert.equal(coversViewBox(null, null, 900, 380), false, "크기가 없으면 배경이 아니다");
assert.equal(coversViewBox("100%", "100%", 0, 0), false, "viewBox가 없으면 판정하지 않는다");
