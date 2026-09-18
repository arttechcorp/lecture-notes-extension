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

console.log('sandbox: render pipeline guards present');
