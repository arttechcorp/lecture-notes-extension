# 강의 그림 자료 1단계 (모델 SVG sanitizer) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모델이 생성한 인라인 SVG를 안전하게 정화해 강의 노트에 그림으로 렌더링한다.

**Architecture:** 새 파일 `lib/svg-figure.js` 하나가 정화를 전담한다. `DOMParser`로 파싱해 허용 목록 밖 태그·속성을 잘라내고, 배경이 없는 SVG에만 글자 휘도로 결정한 카드 배경을 붙인다. 모델 팔레트는 건드리지 않는다. `sandbox.html`의 기존 mermaid 추출 단계 옆에 figure 추출 단계를 나란히 놓는다.

**Tech Stack:** Vanilla JS (ES2022), `node:test`/`node:assert`, `DOMParser`/`XMLSerializer` (브라우저 내장), 빌드 단계 없음.

**Spec:** `docs/superpowers/specs/2026-09-20-figure-rendering-design.md`

## Global Constraints

- 빌드 단계·번들러 없음. 새 npm 의존성 금지 (jsdom 포함).
- `lib/*.js`는 IIFE + `if (typeof module !== "undefined") module.exports = …` + `globalThis` 할당 패턴을 따른다 (`lib/summary.js` 참고).
- **ES 모듈 금지.** `sidepanel.html`의 `renderFrame`은 `sandbox="allow-scripts allow-forms allow-popups allow-modals"`로 `allow-same-origin`이 없어 opaque origin에서 모듈 fetch가 막힌다. sandbox가 싣는 스크립트는 전부 classic이어야 한다.
- 속성 필터는 **기본 거부(deny-by-default)**. 허용 목록에 없는 속성은 이름을 보지 않고 버린다. 차단 목록 방식 금지.
- `visuals[].data` 상한 12,000자는 변경하지 않는다.
- 노트 타이포그래피 CSS는 `landing/product-panel.css`에만 둔다. `sandbox.html`의 `<style>`에는 렌더러 전용 상자와 인쇄 규칙만 둔다.
- 커밋은 Conventional Commits. 작업 브랜치는 `b/note-design` (`main` 직접 커밋 금지).
- 매 작업 끝에 `node --test lib/*.test.js` 전체가 통과해야 한다.

---

## 파일 구조

| 파일 | 책임 |
| --- | --- |
| `lib/svg-figure.js` (신규) | SVG 정화 전담. 순수 정책 함수 + DOM 순회. |
| `lib/svg-figure.test.js` (신규) | 순수 정책 함수의 node 테스트. |
| `tools/extract-svg-cases.mjs` (신규) | 코퍼스 `.md`에서 SVG를 뽑아 프로브 케이스 파일 생성. |
| `tools/svg-figure-cases.js` (생성물) | 프로브가 싣는 케이스 배열. |
| `tools/svg-figure-probe.html` (신규) | 브라우저에서 DOM 순회·실제 렌더 검증. |
| `lib/openrouter-client.js` (수정) | 스키마에 `figure` 타입·`inferred` 필드, 프롬프트 지시. |
| `lib/summary.js` (수정) | `figure` 타입·`inferred` 검증 통과. |
| `sidepanel.js` (수정) | `noteText()`가 figure를 마크다운에 삽입. |
| `sandbox.html` (수정) | figure 추출 → 정화 → 주입. |
| `landing/product-panel.css` (수정) | `.note-figure` 상자 스타일. |

---

### Task 1: 순수 정책 함수

**Files:**
- Create: `lib/svg-figure.js`
- Test: `lib/svg-figure.test.js`

**Interfaces:**
- Consumes: 없음 (첫 작업)
- Produces: `allowTag(name) -> boolean`, `allowAttr(name) -> boolean`, `relativeLuminance(color) -> number|null`, `coversViewBox(width, height, vbWidth, vbHeight) -> boolean`. 모두 `module.exports` 및 `globalThis.SvgFigure`로 노출.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`lib/svg-figure.test.js` 를 만든다:

```js
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
```

- [ ] **Step 2: 실패를 확인한다**

```bash
node --test lib/svg-figure.test.js
```

Expected: FAIL — `Cannot find module './svg-figure.js'`

- [ ] **Step 3: 최소 구현을 쓴다**

`lib/svg-figure.js` 를 만든다:

```js
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

  // 태그 이름만 대소문자를 무시한다. SVG 는 linearGradient 처럼 camelCase 가 정식이라
  // 비교용으로만 낮춘다.
  const allowTag = name => ALLOWED_TAGS.has(String(name || "")) ||
    [...ALLOWED_TAGS].some(tag => tag.toLowerCase() === String(name || "").toLowerCase());

  const allowAttr = name => ALLOWED_ATTRS.has(String(name || "").toLowerCase());

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
```

- [ ] **Step 4: 통과를 확인한다**

```bash
node --test lib/svg-figure.test.js
```

Expected: PASS

- [ ] **Step 5: 전체 테스트가 여전히 통과하는지 본다**

```bash
node --test lib/*.test.js
```

Expected: 기존 테스트 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add lib/svg-figure.js lib/svg-figure.test.js
git commit -m "feat(figure): SVG 정화 정책 함수 — 기본 거부 허용 목록과 휘도 판정"
```

---

### Task 2: 정화기 본체와 브라우저 프로브

**Files:**
- Modify: `lib/svg-figure.js` (Task 1에서 만든 파일에 추가)
- Create: `tools/extract-svg-cases.mjs`
- Create: `tools/svg-figure-probe.html`

**Interfaces:**
- Consumes: Task 1의 `allowTag`, `allowAttr`, `relativeLuminance`, `coversViewBox`
- Produces: `sanitizeSvgFigure(svgText) -> { ok: boolean, svg: string, background: "own"|"dark"|"light"|"theme", dropped: string[] }`. `ok:false`면 `svg`는 빈 문자열이고 호출자는 그림을 버린다. `dropped`는 잘라낸 태그·속성 이름 배열(프로브 표시용).

- [ ] **Step 1: 정화기를 구현한다**

`lib/svg-figure.js` 의 `const api = {` 줄 **바로 위**에 붙인다:

```js
  // DOM 파싱은 브라우저에서만 한다. node 테스트는 위의 순수 함수만 검증하고,
  // 이 순회는 tools/svg-figure-probe.html 이 코퍼스 21개로 확인한다.
  // 정규식 정화는 쓰지 않는다 — HTML 을 정규식으로 거르는 건 새는 방식이다.
  function sanitizeSvgFigure(svgText) {
    const fail = { ok: false, svg: "", background: "theme", dropped: [] };
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
    let background = "theme";
    const hasOwn = [...root.querySelectorAll("rect, path, polygon")].some(shape => {
      const fill = String(shape.getAttribute("fill") || "");
      if (!fill || fill === "none" || fill === "transparent") return false;
      return coversViewBox(shape.getAttribute("width"), shape.getAttribute("height"), vbWidth, vbHeight);
    });
    if (hasOwn) background = "own";
    else {
      // 글자가 밝으면 어두운 카드, 어두우면 밝은 카드. 판정 불가면 테마 배경 그대로.
      const levels = [...root.querySelectorAll("text")]
        .map(node => relativeLuminance(node.getAttribute("fill"))).filter(Number.isFinite);
      if (levels.length) background = levels.reduce((a, b) => a + b, 0) / levels.length > 0.5 ? "dark" : "light";
    }

    // 좁은 패널에서 넘치지 않도록 루트 크기를 고정한다. viewBox 가 비율을 지킨다.
    root.setAttribute("width", "100%");
    root.removeAttribute("height");

    return { ok: true, svg: new XMLSerializer().serializeToString(root), background, dropped };
  }
```

그리고 같은 파일의 `const api = { allowTag, …` 줄을 아래로 바꾼다:

```js
  const api = { sanitizeSvgFigure, allowTag, allowAttr, relativeLuminance, coversViewBox, ALLOWED_TAGS, ALLOWED_ATTRS };
```

- [ ] **Step 2: 코퍼스 추출 스크립트를 쓴다**

`tools/extract-svg-cases.mjs`:

```js
// 코퍼스 .md 에 박힌 인라인 SVG 를 뽑아 프로브가 싣는 classic 스크립트로 굽는다.
// 프로브는 file:// 로도 열리도록 모듈을 쓰지 않는다.
import fs from "node:fs";
import path from "node:path";

const SOURCE = "electric_circuits_note_example";
const cases = [];
for (const file of fs.readdirSync(SOURCE).filter(name => /^0[1-7].*\.md$/.test(name))) {
  const text = fs.readFileSync(path.join(SOURCE, file), "utf8");
  for (const [index, svg] of (text.match(/<svg[\s\S]*?<\/svg>/g) || []).entries()) {
    cases.push({ name: `${file.replace(/\.md$/, "")} #${index + 1}`, svg });
  }
}
fs.writeFileSync("tools/svg-figure-cases.js", `window.SVG_FIGURE_CASES = ${JSON.stringify(cases, null, 2)};\n`);
console.log(`${cases.length} cases -> tools/svg-figure-cases.js`);
```

- [ ] **Step 3: 케이스를 생성하고 개수를 확인한다**

```bash
node tools/extract-svg-cases.mjs
```

Expected: `21 cases -> tools/svg-figure-cases.js`

- [ ] **Step 4: 프로브 페이지를 쓴다**

`tools/svg-figure-probe.html`:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>SVG figure 정화 프로브</title>
  <style>
    body { font: 14px/1.6 system-ui, sans-serif; margin: 24px; background: #F7F7F4; color: #18181B; }
    .case { border: 1px solid #E4E4E7; border-radius: 10px; padding: 12px; margin: 16px 0; background: #fff; }
    .meta { font: 12px ui-monospace, monospace; color: #71717A; margin-bottom: 8px; }
    .fail { color: #b91c1c; font-weight: 700; }
    .box { padding: 12px; border-radius: 8px; }
    .box.dark { background: #09090B; }
    .box.light, .box.own, .box.theme { background: #fff; }
    .box svg { max-width: 100%; height: auto; display: block; }
    #summary { position: sticky; top: 0; background: #FF5600; color: #fff; padding: 10px 14px; border-radius: 8px; font-weight: 700; }
  </style>
</head>
<body>
  <div id="summary">실행 중…</div>
  <div id="out"></div>
  <script src="../lib/svg-figure.js"></script>
  <script src="svg-figure-cases.js"></script>
  <script>
    const out = document.getElementById("out");
    let ok = 0, failed = 0;
    const counts = { own: 0, dark: 0, light: 0, theme: 0 };
    for (const item of window.SVG_FIGURE_CASES) {
      const result = SvgFigure.sanitizeSvgFigure(item.svg);
      const card = document.createElement("div");
      card.className = "case";
      const meta = document.createElement("div");
      meta.className = "meta" + (result.ok ? "" : " fail");
      meta.textContent = `${item.name} · ${result.ok ? "OK" : "PARSE FAIL"} · 배경:${result.background} · 잘라냄:${result.dropped.join(",") || "없음"}`;
      card.append(meta);
      if (result.ok) {
        ok++; counts[result.background]++;
        const box = document.createElement("div");
        box.className = "box " + result.background;
        box.innerHTML = result.svg;
        card.append(box);
      } else failed++;
      out.append(card);
    }
    document.getElementById("summary").textContent =
      `총 ${window.SVG_FIGURE_CASES.length} · 파싱성공 ${ok} · 실패 ${failed} · 배경(자체 ${counts.own} / 어두운카드 ${counts.dark} / 밝은카드 ${counts.light} / 테마 ${counts.theme})`;
  </script>
</body>
</html>
```

- [ ] **Step 5: HTTP 로 띄워 확인한다**

`file://` 로 열지 않는다. 상대 경로 스크립트가 붙지 않아 전부 FAIL 로 보인다.

```bash
python -m http.server 8765
```

브라우저에서 `http://localhost:8765/tools/svg-figure-probe.html` 을 연다.

Expected:
- 상단 요약에 `총 21 · 파싱성공 21 · 실패 0`
- 배경 분류가 `자체 15 / 어두운카드 + 밝은카드 6 / 테마 0` 근처
- 모든 카드에서 **글자가 읽힌다** (배경에 묻힌 그림이 없다)
- `잘라냄` 에 `onload` 같은 이벤트 속성이 남아 있지 않다

읽히지 않는 그림이 있으면 그 케이스 이름을 적어두고 Step 1의 배경 판정을 고친다.

- [ ] **Step 6: 주입 방어를 직접 확인한다**

브라우저 콘솔에서:

```js
SvgFigure.sanitizeSvgFigure('<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)<\/script><rect x="1" y="1" width="8" height="8" fill="#f00" onclick="alert(3)"/></svg>')
```

Expected: `ok:true`, 반환된 `svg` 문자열에 `onload`·`script`·`onclick` 이 **하나도 없다**. `dropped` 에 셋이 들어 있다.

- [ ] **Step 7: 커밋**

```bash
git add lib/svg-figure.js tools/extract-svg-cases.mjs tools/svg-figure-cases.js tools/svg-figure-probe.html
git commit -m "feat(figure): SVG 정화기와 코퍼스 21개 브라우저 프로브"
```

---

### Task 3: 스키마와 검증에 figure 타입을 연다

**Files:**
- Modify: `lib/openrouter-client.js:12` (visuals 스키마)
- Modify: `lib/summary.js:160` (visuals 검증)
- Test: `lib/summary.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: `visuals[]` 항목이 `type: "figure"` 를 받고 `inferred: boolean` 필드를 보존한다. 이후 Task 4가 `visual.type === "figure"` 와 `visual.inferred` 를 읽는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`lib/summary.test.js` 맨 아래에 붙인다:

```js
// 그림(figure) 타입은 인라인 SVG 를 data 로 받고, 보간 여부를 inferred 로 표시한다.
test("validateSummary는 figure 타입과 inferred 플래그를 보존한다", () => {
  const items = [evidence("슬라이드에 회로가 있었습니다.")];
  const ids = ["e1"];
  const base = response(items);
  base.visuals = [{ type: "figure", title: "회로", description: "직렬 RLC", data: '<svg viewBox="0 0 10 10"></svg>', importance: "important", evidenceIds: ids, inferred: true }];
  const out = validateSummary(base, items);
  assert.equal(out.visuals.length, 1);
  assert.equal(out.visuals[0].type, "figure");
  assert.equal(out.visuals[0].inferred, true);
  assert.equal(out.visuals[0].data, '<svg viewBox="0 0 10 10"></svg>');
});

test("validateSummary는 inferred가 없으면 false로 채운다", () => {
  const items = [evidence("슬라이드에 회로가 있었습니다.")];
  const base = response(items);
  base.visuals = [{ type: "figure", title: "회로", description: "직렬 RLC", data: "<svg/>", importance: "important", evidenceIds: ["e1"] }];
  assert.equal(validateSummary(base, items).visuals[0].inferred, false);
});

test("validateSummary는 inferred가 boolean이 아니면 거부한다", () => {
  const items = [evidence("슬라이드에 회로가 있었습니다.")];
  const base = response(items);
  base.visuals = [{ type: "figure", title: "회로", description: "직렬 RLC", data: "<svg/>", importance: "important", evidenceIds: ["e1"], inferred: "yes" }];
  assert.throws(() => validateSummary(base, items), /시각 자료/);
});
```

파일 상단의 `require` 줄에 `validateSummary` 가 이미 들어 있는지 확인한다. 없으면 추가한다.

- [ ] **Step 2: 실패를 확인한다**

```bash
node --test lib/summary.test.js
```

Expected: FAIL — `시각 자료 형식이 올바르지 않습니다.` (`figure` 가 아직 허용 목록에 없다)

- [ ] **Step 3: 검증을 고친다**

`lib/summary.js` 의 160번 줄 `["table", "relationship", "chart"]` 를 `["table", "relationship", "chart", "figure"]` 로 바꾸고, 같은 조건식 끝(`|| !IMPORTANCE.has(visual.importance)` 앞)에 `inferred` 검사를 더한다:

```js
      if (!visual || !["table", "relationship", "chart", "figure"].includes(visual.type) || typeof visual.title !== "string" || visual.title.length > 200 || typeof visual.description !== "string" || visual.description.length > 4000 || typeof visual.data !== "string" || visual.data.length > 12000 || (visual.inferred !== undefined && typeof visual.inferred !== "boolean") || !IMPORTANCE.has(visual.importance)) throw new Error("시각 자료 형식이 올바르지 않습니다.");
```

그리고 바로 아래 `return evidenceIds && { … }` 줄에 `inferred` 를 더한다:

```js
      return evidenceIds && { type: visual.type, title: visual.title, description: visual.description, data: visual.data, importance: visual.importance, evidenceIds, inferred: visual.inferred === true };
```

- [ ] **Step 4: 스키마를 고친다**

`lib/openrouter-client.js` 12번 줄의 visuals 정의에서 두 곳을 바꾼다. enum 에 `"figure"` 를 더하고, `required` 배열과 `properties` 에 `inferred` 를 더한다 (구조화 출력은 모든 속성이 `required` 에 있어야 한다):

```js
    visuals: { type: "array", items: { type: "object", additionalProperties: false, required: ["type", "title", "description", "data", "importance", "evidenceIds", "inferred"], properties: { type: { type: "string", enum: ["table", "relationship", "chart", "figure"] }, title: { type: "string" }, description: { type: "string" }, data: { type: "string" }, importance: item.properties.importance, evidenceIds: item.properties.evidenceIds, inferred: { type: "boolean" } }}},
```

- [ ] **Step 5: 통과를 확인한다**

```bash
node --test lib/*.test.js
```

Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add lib/summary.js lib/summary.test.js lib/openrouter-client.js
git commit -m "feat(figure): visuals 스키마에 figure 타입과 inferred 플래그를 연다"
```

---

### Task 4: 노트 마크다운에 그림을 넣는다

**Files:**
- Modify: `sidepanel.js:35` (`noteText` 안의 `visual` 함수)
- Test: `lib/panel.test.js`

**Interfaces:**
- Consumes: Task 3의 `visual.type === "figure"`, `visual.inferred`
- Produces: figure 항목이 `### 제목` + (보간이면 이탤릭 고지 한 줄) + 설명 + raw SVG 순서로 마크다운에 들어간다. Task 5의 `sandbox.html` 이 이 raw SVG 를 찾아 정화한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`lib/panel.test.js` 의 `const note={…}` 블록에서 `visuals:` 줄을 아래로 바꾼다:

```js
  visuals:[{type:'table',title:'B표',description:'',data:'| x |',importance:'important',evidenceIds:['d']},
    {type:'figure',title:'회로그림',description:'직렬 RLC',data:'<svg viewBox="0 0 10 10"></svg>',importance:'important',evidenceIds:['d'],inferred:true}],
```

그리고 파일 맨 아래에 붙인다:

```js
// 그림은 raw SVG 로 들어가고, 보간된 그림은 고지 문구를 달고 나온다.
const figureText=noteText(note);
assert.match(figureText,/### 회로그림/,'그림 제목이 소제목으로 들어간다');
assert.match(figureText,/<svg viewBox="0 0 10 10"><\/svg>/,'SVG 원문이 마크다운에 그대로 들어간다');
assert.match(figureText,/\*\(강의 화면에 없던 연결은 표준 구성으로 채웠습니다\)\*/,'보간 고지가 붙는다');
assert.ok(figureText.indexOf('강의 화면에 없던')<figureText.indexOf('<svg'),'고지는 그림보다 먼저 온다');
// 보간이 아닌 그림에는 고지가 붙지 않는다.
const plainNote={...note,visuals:[{type:'figure',title:'평범',description:'설명',data:'<svg/>',importance:'important',evidenceIds:['d'],inferred:false}]};
assert.doesNotMatch(noteText(plainNote),/강의 화면에 없던/,'inferred가 false면 고지가 없다');
// 기존 mermaid 경로는 그대로다.
const mermaidNote={...note,visuals:[{type:'relationship',title:'관계',description:'',data:'flowchart TD\n  A-->B',importance:'important',evidenceIds:['d']}]};
assert.match(noteText(mermaidNote),/```mermaid/,'펜스 없는 mermaid는 여전히 펜스가 붙는다');
```

- [ ] **Step 2: 실패를 확인한다**

```bash
node --test lib/panel.test.js
```

Expected: FAIL — 보간 고지 문구가 없다

- [ ] **Step 3: `visual` 함수를 고친다**

`sidepanel.js` 35번 줄을 아래 두 줄로 바꾼다:

```js
  // figure 는 모델이 그린 인라인 SVG 다. 마크다운에는 원문 그대로 넣고, 정화는 sandbox.html 이
  // lib/svg-figure.js 로 한다 — 편집 탭의 canonical 마크다운은 손대지 않은 원본을 유지한다.
  const inferredNotice='*(강의 화면에 없던 연결은 표준 구성으로 채웠습니다)*';
  const visual=v=>`### ${v.title}\n\n${v.inferred?`${inferredNotice}\n\n`:''}${v.description}${v.data?`\n\n${v.type==='figure'?v.data:fenceIfBareDiagram(v.data)}`:''}`;
```

- [ ] **Step 4: 통과를 확인한다**

```bash
node --test lib/*.test.js
```

Expected: 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add sidepanel.js lib/panel.test.js
git commit -m "feat(figure): noteText가 그림을 raw SVG로 넣고 보간 고지를 단다"
```

---

### Task 5: sandbox 가 그림을 정화해 렌더링한다

**Files:**
- Modify: `sandbox.html` (스크립트 로드, `renderMarkdown` 1단계 옆, 인쇄 규칙)
- Modify: `landing/product-panel.css` (`.note-figure`)

**Interfaces:**
- Consumes: Task 2의 `SvgFigure.sanitizeSvgFigure`, Task 4가 마크다운에 넣은 raw SVG
- Produces: 화면에 렌더링된 그림. 이 작업으로 1단계가 끝난다.

- [ ] **Step 1: 정화기를 sandbox 에 싣는다**

`sandbox.html` 의 `<script src="lib/vendor/mermaid/mermaid.min.js"></script>` 줄 **바로 아래**에 넣는다. 반드시 classic script 다:

```html
  <script src="lib/svg-figure.js"></script>
```

- [ ] **Step 2: figure 추출 단계를 더한다**

`renderMarkdown` 안, `// 2. Display Math` 주석 **바로 위**에 넣는다. mermaid 추출과 같은 자리에 두는 이유는 marked 가 보기 전에 떼어내야 하기 때문이다:

```javascript
      // 1.5 인라인 SVG 추출 — marked 가 보기 전에 떼어내 정화한 뒤 자리표시자로 바꾼다.
      // 정화에 실패하면 그림을 버린다(설명 문단은 마크다운에 이미 들어 있다).
      const figureBlocks = [];
      sanitized = sanitized.replace(/<svg[\s\S]*?<\/svg>/gi, raw => {
        const result = (typeof SvgFigure !== 'undefined') ? SvgFigure.sanitizeSvgFigure(raw) : { ok: false };
        if (!result.ok) return '';
        const idx = figureBlocks.length;
        figureBlocks.push(result);
        return '<div class="note-figure" data-bg="' + result.background + '" id="figure-wrap-' + idx + '"></div>';
      });
```

- [ ] **Step 3: 정화된 SVG 를 주입한다**

`target.innerHTML = html;` 줄 **바로 아래**에 넣는다. 자리표시자가 DOM 에 들어간 뒤라야 찾을 수 있다:

```javascript
      // 정화된 SVG 를 자리표시자에 넣는다. sanitizeSvgFigure 가 이미 허용 목록으로 걸렀다.
      for (let i = 0; i < figureBlocks.length; i++) {
        const host = document.getElementById('figure-wrap-' + i);
        if (host) host.innerHTML = figureBlocks[i].svg;
      }
```

- [ ] **Step 4: 그림 상자 스타일을 더한다**

`landing/product-panel.css` 의 노트 본문 규칙 근처(형광펜 `--brand-highlight` 를 쓰는 규칙 아래)에 넣는다:

```css
  /* 모델이 그린 그림. 배경이 없는 SVG 에만 data-bg 로 카드를 깔고, 자체 배경이 있으면
     (data-bg="own") 모델 팔레트를 그대로 둔다. */
  .note-figure { margin: 16px 0; border-radius: var(--r-md); overflow: hidden; }
  .note-figure[data-bg="dark"] { background: #09090B; padding: 12px; }
  .note-figure[data-bg="light"] { background: #ffffff; padding: 12px; }
  .note-figure[data-bg="theme"] { background: var(--paper-card); padding: 12px; }
  .note-figure svg { display: block; width: 100%; height: auto; }
```

- [ ] **Step 5: 인쇄 규칙을 더한다**

`sandbox.html` 의 `@media print` 블록에서 `table, pre, blockquote, .mermaid-box {` 로 시작하는 선택자에 `.note-figure` 를 더한다:

```css
      table, pre, blockquote, .mermaid-box, .note-figure {
```

이 규칙이 `page-break-inside: avoid` 를 준다. 그림이 페이지 경계에서 반으로 잘리는 것을 막는 유일한 수단이다.

- [ ] **Step 6: 확장을 실제로 띄워 확인한다**

`chrome://extensions` 에서 압축해제된 확장으로 이 디렉터리를 로드하거나, 이미 로드돼 있으면 새로고침한다. 그리고 패널의 **마크다운 편집** 탭에 아래를 붙여넣고 **서식 보기** 로 돌아온다:

```markdown
### 정화 확인

*(강의 화면에 없던 연결은 표준 구성으로 채웠습니다)*

밝은 글자만 있고 배경이 없는 그림이다.

<svg viewBox="0 0 200 60" onload="alert('XSS')"><rect x="10" y="10" width="60" height="40" fill="#38bdf8"/><text x="100" y="35" fill="#f8fafc" font-size="14">밝은 글자</text></svg>
```

Expected:
- 그림이 **어두운 카드** 위에 보이고 "밝은 글자" 가 읽힌다 (`data-bg="dark"`)
- `alert` 가 뜨지 않는다
- 개발자 도구로 `renderFrame` 안을 보면 `onload` 속성이 없다
- 보간 고지 이탤릭 줄이 그림 위에 있다

- [ ] **Step 7: 다크 테마와 PDF 를 확인한다**

테마를 다크로 바꾸고 같은 노트를 본다. 그 다음 **PDF** 버튼을 눌러 A4 와 16:9 양쪽 미리보기를 본다.

Expected: 어느 테마에서도 그림의 글자가 읽히고, 인쇄 미리보기에서 그림이 페이지 경계에 걸쳐 잘리지 않는다.

- [ ] **Step 8: 전체 테스트**

```bash
node --test lib/*.test.js
```

Expected: 전부 PASS

- [ ] **Step 9: 커밋**

```bash
git add sandbox.html landing/product-panel.css
git commit -m "feat(figure): sandbox가 인라인 SVG를 정화해 그림 상자로 렌더링한다"
```

---

### Task 6: 모델에게 그림을 요청한다

**Files:**
- Modify: `lib/openrouter-client.js` (26~27번 줄 부근의 visuals 지시문)
- Test: `lib/openrouter-client.test.js`

**Interfaces:**
- Consumes: Task 3의 스키마
- Produces: 실제 요약 호출에서 `type: "figure"` 항목이 생성된다. 이 작업으로 기능이 켜진다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`lib/openrouter-client.test.js` 맨 아래에 붙인다:

```js
// 프롬프트는 figure 타입과 viewBox 를 요구하되 색은 지시하지 않는다 — 색은 정화기가 정한다.
const source = require("node:fs").readFileSync("lib/openrouter-client.js", "utf8");
assert.match(source, /figure/, "프롬프트가 figure 타입을 설명한다");
assert.match(source, /viewBox/, "프롬프트가 viewBox 를 요구한다");
```

- [ ] **Step 2: 실패를 확인한다**

```bash
node --test lib/openrouter-client.test.js
```

Expected: FAIL — `viewBox` 를 찾지 못한다

- [ ] **Step 3: 지시문을 더한다**

`lib/openrouter-client.js` 의 27번 줄(좌표 OCR 을 설명하는 문장) **바로 아래**에 문자열 한 줄을 더한다:

```js
    "When the evidence describes a figure that is neither a flow nor a table — a circuit, an energy band diagram, a labelled plot, a structure — emit type \"figure\" whose data is one inline <svg> element. Always include a viewBox. Do not choose colours for legibility: the note applies its own background. Set \"inferred\": true when you completed the figure with standard domain knowledge rather than drawing only what the evidence shows, and false when every element comes from the evidence.",
```

- [ ] **Step 4: 통과를 확인한다**

```bash
node --test lib/*.test.js
```

Expected: 전부 PASS

- [ ] **Step 5: 실제 강의로 끝까지 돌려본다**

짧은 강의 영상으로 캡처 → 요약까지 한 번 돌린다. 도식이 있는 슬라이드가 포함된 것이어야 한다.

Expected: 노트에 그림이 하나 이상 들어가고, 읽히고, PDF 에 따라간다. 그림이 하나도 안 나오면 기능이 아니라 프롬프트 문제다 — `tools/diagram-violation-probe.mjs` 를 돌려 모델이 `figure` 를 내는지부터 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add lib/openrouter-client.js lib/openrouter-client.test.js
git commit -m "feat(figure): 도식 근거에 인라인 SVG 그림을 요청하는 지시를 더한다"
```

---

## 완료 확인

1단계가 끝났다고 말하기 전에 전부 확인한다.

- [ ] `node --test lib/*.test.js` 가 전부 통과한다
- [ ] `http://localhost:8765/tools/svg-figure-probe.html` 이 21/21 파싱 성공을 보인다
- [ ] 프로브의 21개 그림 모두에서 글자가 읽힌다
- [ ] `onload` 를 넣은 SVG 를 붙여넣어도 `alert` 가 뜨지 않는다
- [ ] 라이트·다크 양쪽에서 그림이 읽힌다
- [ ] A4·16:9 PDF 에서 그림이 잘리지 않는다
- [ ] 실제 강의 한 편에서 그림이 노트에 들어간다

마지막 항목이 스펙 §6의 측정 출발점이다. 프로브에 기록된 파싱 실패·잘라낸 태그·눈금 어긋남·회로 뭉개짐이 2단계 DSL 의 우선순위를 정한다.
