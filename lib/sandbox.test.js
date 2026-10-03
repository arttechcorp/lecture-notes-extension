// sandbox.html 은 브라우저 전용이라 여기서 실행할 수 없다. 소스를 검사해 v2 렌더 파이프라인의
// 계약(RENDER_NOTE/PRINT_NOTE/RENDER_RECOGNITION, 스크립트 순서, 이스케이프 규칙)이 지켜지는지만 막는다.
const assert = require('node:assert/strict');
const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'sandbox.html'), 'utf8');

// 노트 파이프라인은 KaTeX 다음에 계약→양식→렌더러 순으로 올라야 한다(렌더러가 앞 둘의 전역을 쓴다).
const order = ['lib/vendor/katex/katex.min.js', 'lib/note-contract.js', 'lib/note-spec.js', 'lib/note-render.js'].map(s => html.indexOf(`src="${s}"`));
assert.ok(order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2] && order[2] < order[3], 'katex → note-contract → note-spec → note-render 순서로 불러야 한다');
assert.ok(html.indexOf('src="lib/vendor/katex/katex.min.js"') > html.indexOf('katex.min.css'), 'KaTeX css 다음에 js');

// v1 렌더 경로는 없어야 한다.
assert.ok(!html.includes('marked'), 'marked 는 v1 경로다');
assert.ok(!html.includes('mermaid'), 'mermaid 는 v1 경로다');
assert.ok(!html.includes('product-panel.css'), 'v2 노트는 NoteSpec.css 를 쓴다');
assert.ok(!html.includes('landing/'), '샌드박스는 랜딩 자산을 참조하지 않는다');

// 노트 양식 CSS는 한 번만 넣는다.
assert.ok(html.includes('NoteSpec.css'), 'NoteSpec.css 를 주입해야 한다');

// 메시지 계약: 부모 → RENDER_NOTE/PRINT_NOTE/RENDER_RECOGNITION, 자식 → RENDERER_READY/RENDER_HEIGHT/RENDER_WARNINGS/PRINT_COMPLETE/PRINT_ERROR.
for (const t of ['RENDER_NOTE', 'PRINT_NOTE', 'RENDER_RECOGNITION', 'RENDERER_READY', 'RENDER_HEIGHT', 'RENDER_WARNINGS', 'PRINT_COMPLETE', 'PRINT_ERROR'])
  assert.ok(html.includes(`'${t}'`), `${t} 메시지가 없다`);
assert.ok(html.includes('NoteRender.renderNote'), '노트 렌더는 NoteRender.renderNote 가 한다');
assert.ok(html.includes("medium: 'web'") && html.includes("medium: 'print'"), '웹/인쇄 매체를 강제한다');
assert.ok(html.includes('document.fonts.ready') && html.includes('.decode()'), '인쇄 전 폰트·이미지 디코드를 기다린다');

// 인식 결과는 계약 밖의 문자열이다 — innerHTML 이 아니라 textContent/노드로만 넣는다.
const recog = html.slice(html.indexOf('function renderRecognition'), html.indexOf('async function printNote'));
assert.ok(recog.includes('textContent'), '인식 결과는 textContent 로 넣어야 한다');
assert.ok(!recog.includes('innerHTML'), '인식 문자열을 innerHTML 로 넣으면 안 된다');

// 인쇄는 화면을 인쇄 매체 마크업으로 덮어쓴다 — afterprint·인쇄 실패 둘 다 마지막 웹 렌더로 되돌려야 남지 않는다.
assert.ok(html.includes('lastWeb = { note, crops, options }'), '웹 렌더를 기억해야 한다');
const afterprint = html.slice(html.indexOf("addEventListener('afterprint'"), html.indexOf("addEventListener('resize'"));
assert.ok(afterprint.includes('restoreWeb()'), 'afterprint 는 웹 렌더를 되돌린다');
const printFn = html.slice(html.indexOf('async function printNote'), html.indexOf("addEventListener('message'"));
assert.ok(printFn.includes('restoreWeb()'), '인쇄 오류에도 웹 렌더를 되돌린다');
const recogView = html.slice(html.indexOf('function renderRecognition'), html.indexOf('async function printNote'));
assert.ok(recogView.includes('lastWeb = null'), '인식 보기에는 되돌릴 노트가 없다');

// 샌드박스 문서는 chrome API 를 쓰지 못한다(패키지 감사와 같은 규칙).
assert.ok(!html.includes('chrome.'), 'sandbox.html 은 chrome.* 를 참조하면 안 된다');

console.log('sandbox: v2 render pipeline contract present');
