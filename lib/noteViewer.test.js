const assert = require("assert");
const NoteViewer = require("../landing/note-viewer.js");

const render = (source, title) => NoteViewer.render(source, title);

const markdown = `# 강의 노트

## 핵심 개념

**강조**와 *기울임*을 확인합니다.

- 첫 항목
  - 중첩 항목

> 기억할 문장

| 개념 | 설명 |
| --- | --- |
| 인지 | 학습 |

\`\`\`js
<script>alert("x")</script> &
\`\`\`

- [x] 완료
- [ ] 남음

[x] 일반 문단
\`[x] 코드\`

<script>alert("raw")</script>

[안전하지 않음](javascript:alert(1)) [안전한 링크](https://example.com) ![외부 이미지](https://example.com/image.png)`;

const html = render(markdown, "강의 노트");
assert.ok(html.includes("<h2>핵심 개념</h2>"), "중복된 첫 제목만 제거하고 다음 제목은 유지한다");
assert.ok(!html.includes("<h1>강의 노트</h1>"), "제공된 제목과 같은 첫 제목은 중복 렌더링하지 않는다");
assert.ok(html.includes("<strong>강조</strong>") && html.includes("<em>기울임</em>"));
assert.ok(html.includes("<ul>") && html.includes("<ul>\n<li>중첩 항목</li>"), "중첩 목록을 렌더링한다");
assert.ok(html.includes("<blockquote>\n<p>기억할 문장</p>\n</blockquote>"));
assert.ok(html.includes('class="note-table-scroll"') && html.includes("<th>개념</th>") && html.includes("<td>학습</td>"));
assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp;"), "코드 펜스의 HTML을 이스케이프한다");
assert.equal((html.match(/type="checkbox"/g) || []).length, 2, "목록의 작업 항목만 체크박스로 변환한다");
assert.ok(html.includes("완료") && html.includes("미완료") && html.includes("checked"));
assert.ok(html.includes("[x] 일반 문단") && html.includes("<code>[x] 코드</code>"), "일반 문단과 인라인 코드는 작업 항목으로 바꾸지 않는다");
assert.ok(html.includes("&lt;script&gt;alert(&quot;raw&quot;)&lt;/script&gt;"), "raw HTML을 마크업으로 실행하지 않는다");
assert.ok(!html.includes('href="javascript:') && !html.includes('href="data:') && !html.includes("<img"), "위험한 링크와 외부 이미지를 출력하지 않는다");
assert.ok(html.includes('href="https://example.com" target="_blank" rel="noopener noreferrer"'));
for (const unsafe of [
  '[열기](data:text/html,hello)',
  '[열기](jav&#x61;script:alert)',
  '<img src="https://example.com/pixel" onerror="alert(1)">',
  '<svg onload="alert(1)"></svg>',
]) {
  assert.ok(!/<(?:a|img|svg)\b/.test(render(unsafe)), "위험한 원문이 실행 가능한 요소나 네트워크 요청이 되면 안 된다");
}

const distinct = render("# 다른 제목\n\n내용", "강의 노트");
assert.ok(distinct.includes("<h1>다른 제목</h1>"), "제공된 제목과 다른 첫 제목은 유지한다");

console.log("noteViewer: all tests passed");
