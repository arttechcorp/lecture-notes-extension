// 사이드패널의 단계 전환은 전부 element.hidden 에 의존한다. 그런데 hidden 은
// UA 스타일의 [hidden]{display:none} 으로만 동작해서, 작성자 CSS에 display 가
// 하나라도 걸리면 조용히 무력화된다. 실제로 #onboard 가 그래서 뚫렸고,
// 온보딩을 누르지 않아도 모든 기능이 열려 있었다. 눈에 안 보이는 고장이라
// 여기서 못을 박는다.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "sidepanel.html"), "utf8");
const js = fs.readFileSync(path.join(__dirname, "..", "sidepanel.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "landing", "product-panel.css"), "utf8");

assert.match(
  html,
  /<link\s+rel="stylesheet"\s+href="landing\/product-panel\.css">/,
  "sidepanel.html 이 landing/product-panel.css 를 연결하지 않았다"
);

// 1. [hidden] 을 !important 로 강제하는 규칙이 있어야 한다.
assert.ok(
  /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(css),
  "sidepanel.html 의 CSS에 [hidden]{display:none!important} 가 없다 — hidden 이 뚫릴 수 있다"
);

// 2. JS가 .hidden 으로 여닫는 요소가 HTML에 실제로 있어야 한다.
//    els.foo.hidden = ... 형태에서 foo 를 뽑아 els 정의와 대조한다.
const toggled = new Set([...js.matchAll(/els\.(\w+)\.hidden\s*=/g)].map((m) => m[1]));
assert.ok(toggled.size > 0, ".hidden 을 쓰는 곳을 하나도 못 찾았다 — 테스트가 낡았다");

const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
for (const key of toggled) {
  // els 매핑에서 그 키가 가리키는 id 를 찾는다: `key: $("someId")`
  const m = js.match(new RegExp(`\\b${key}:\\s*\\$\\("([^"]+)"\\)`));
  assert.ok(m, `els.${key} 가 정의돼 있지 않다`);
  assert.ok(ids.has(m[1]), `els.${key} 가 가리키는 #${m[1]} 가 sidepanel.html 에 없다`);
}

// 3. 동의 전에는 온보딩만 열린다는 가드가 setStage 안에 있어야 한다.
//    버튼마다 가드를 다는 대신 전환 지점 한 곳에서 막는 구조를 지킨다.
const setStage = js.slice(js.indexOf("function setStage"), js.indexOf("function setStage") + 600);
assert.ok(
  /consentAccepted/.test(setStage),
  "setStage 에 동의 검사가 없다 — 게이트가 CSS 에만 의존하게 된다"
);

// 4. API 키가 없으면 원격 호출을 막는 가드가 generateNotes 안에 있어야 한다.
//    키가 없는 상태에서 노트를 만들려 하면 조용히 실패하지 않고 안내해야 한다.
assert.ok(
  /!settings\.apiKey/.test(js),
  "generateNotes 에 API 키 검사 가드가 없다"
);

const guardAt = js.indexOf("!settings.apiKey");
const remoteAt = js.indexOf("await notesRemote(");
assert.ok(guardAt > 0 && remoteAt > guardAt, "API 키 가드가 원격 호출보다 뒤에 있다 — 순서가 뒤집혔다");


// 5. 출력 경계 (AGENTS.md §2) — 평문 스크립트·노트의 내보내기 컨트롤 금지,
//    강의 원문을 그대로 재현하지 않음. 화면에서 읽는 것까지가 이 도구의 범위다.
for (const [pattern, what] of [
  [/navigator\.clipboard/, "클립보드 복사"],
  [/URL\.createObjectURL|new Blob\(/, "파일 다운로드"],
  [/buildTimeline\s*\(/, "원문 타임라인 출력"],
]) {
  assert.ok(!pattern.test(js), `${what} 경로가 되살아났다 — AGENTS.md §2 출력 경계 위반`);
}
assert.doesNotMatch(html, /id="copyBtn"|id="downloadBtn"|id="timelineBtn"/,
  "내보내기·타임라인 버튼이 되살아났다");

console.log(`panel: all tests passed (hidden 토글 대상 ${toggled.size}개 확인)`);
