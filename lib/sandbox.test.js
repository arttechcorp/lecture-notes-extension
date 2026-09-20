// sandbox.html 은 브라우저 전용이라 여기서 실행할 수 없다. panel.test.js 와 같은 방식으로 소스를 검사해
// 렌더 파이프라인의 가드가 실수로 사라지는 것만 막는다. 실제 렌더 검증은 sandbox.html 을 HTTP 로 띄우고
// postMessage({type:'RENDER', markdown}) 를 보내 SVG 안의 .katex 개수를 세는 방식으로 한다.
const assert = require('node:assert/strict');
const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'sandbox.html'), 'utf8');

// mermaid 번들은 이중달러만 KaTeX 로 넘긴다. 홑달러 수식을 바꿔주지 않으면 라벨에 글자 그대로 남는다.
assert.ok(html.includes("forMermaid"), "mermaid 라벨 수식 변환이 사라졌다");
assert.ok(html.includes("'$$' + src + '$$'"), "이중달러로 감싸지 않으면 mermaid 가 수식으로 보지 않는다");

// mermaid 는 라벨을 HTML 이스케이프한 뒤 KaTeX 에 넘긴다. 부등호를 미리 명령으로 바꾸지 않으면
// < 가 &lt; 가 되어 KaTeX 가 터지고 도식 전체가 폴백으로 떨어진다.
assert.ok(html.includes("\\\\lt "), "부등호 < 변환이 사라졌다");
assert.ok(html.includes("\\\\gt "), "부등호 > 변환이 사라졌다");

// mermaid 는 throwOnError:true 로 부르므로, 파싱 안 되는 것을 바꾸면 도식 전체를 잃는다.
assert.ok(html.includes("mathParses"), "변환 전 katex 검증이 사라졌다");
assert.ok(html.includes("throwOnError: true"), "검증이 실제 파싱으로 확인해야 한다");

// 통화 표기를 수식으로 먹지 않기 위한 판별은 변환 전 원문에 적용해야 한다.
assert.ok(html.includes("looksLikeMath(math) && mathParses(src)"), "통화 판별을 변환 후 문자열에 적용하면 $20,000 이 수식이 된다");

// 노트 타이포그래피의 단일 원천은 product-panel.css 다. 여기에 다시 정의하면 제품과 랜딩이 갈라진다.
assert.ok(html.includes('landing/product-panel.css'), '제품 패널 디자인 시스템을 읽지 않는다');
assert.ok(html.includes('class="note-document"'), '노트 본문이 .note-document 안에 있어야 디자인 규칙이 걸린다');

// ==형광펜== 은 marked 인라인 확장으로만 처리한다. 출력 HTML 을 정규식으로 치면 코드 펜스 안의 == 까지 칠해진다.
assert.ok(html.includes("name: 'highlight'"), '형광펜 확장이 사라졌다');
assert.ok(html.includes("level: 'inline'"), '형광펜을 인라인 확장으로 달아야 강조 안의 마크다운이 살아난다');
assert.ok(html.includes('(?!\\s)') && html.includes('(?<!\\s)'), '공백 가드가 없으면 a == b == c 가 형광펜이 된다');

// 인쇄는 배경을 기본으로 빼버린다. exact 가 없으면 형광펜과 표머리 배경이 PDF 에서 통째로 사라진다.
assert.ok(html.includes('print-color-adjust: exact !important'), '인쇄 배경 강제가 사라졌다 — 형광펜이 PDF 에서 빠진다');
assert.ok(/@media print[\s\S]*?note-document mark/.test(html), '형광펜 인쇄 규칙이 사라졌다');

// 다크 모드로 뽑은 PDF 도 다크여야 한다. 색은 토큰으로 갈아끼우고, @page 여백은 0 이라야 종이 끝까지 배경이 찍힌다.
assert.ok(html.includes(':root[data-theme="dark"] {') && html.includes('--print-bg'), '인쇄용 다크 토큰이 사라졌다');
assert.ok(html.includes("dark ? '0' : page.margin"), '다크에서 @page 여백을 0 으로 두지 않으면 종이 가장자리가 흰 테두리로 남는다');
assert.ok(html.includes('applyPrintRatio(lastPrintRatio)'), '테마가 바뀌어도 인쇄 스타일을 다시 만들지 않는다');

console.log('sandbox: render pipeline guards present');
