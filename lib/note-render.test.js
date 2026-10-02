const test = require("node:test");
const assert = require("node:assert/strict");
const katex = require("./vendor/katex/katex.min.js");
const NoteSpec = require("./note-spec.js");
const { renderNote } = require("./note-render.js");

const BLOB = "blob:chrome-extension://abcdefghijklmnop/1b2c3d4e-0000-4000-8000-000000000000";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const throwingKatex = { renderToString() { throw new Error("boom"); } };
const reg = (id, status, extra = {}) => ({ id, latex: null, text: null, status, ...extra });
const REGISTRY = [
  reg("F1", "verified", { latex: "x^2+1" }),
  reg("F2", "image", { latex: "\\sqrt{2}", text: "√2" }),
  reg("F3", "unverified", { latex: "\\frac{a}{b}", text: "a/b" }),
  reg("F4", "reread", { latex: "\\alpha", text: "alpha" }),
  reg("F5", "verified", { latex: "\\frac{", text: "OCR5" }),
];
const note = (over = {}) => ({
  noteSpecVersion: NoteSpec.NOTE_SPEC_VERSION, plan: { sections: [] },
  sections: [{ sectionId: "S1", title: "미분", blocks: [{ type: "text", heading: "정의", body: "식 {{F1}} 이다.", evidenceIds: ["U1"], derived: [] }] }],
  global: [], registry: REGISTRY, notices: [], ...over,
});
const textBlock = body => ({ type: "text", heading: "제목", body, evidenceIds: [], derived: [] });
const withBody = (body, over = {}) => note({ sections: [{ sectionId: "S1", title: "T", blocks: [textBlock(body)] }], ...over });
const run = (n, opts = {}) => renderNote(n, { katex, ...opts });
// 템플릿 안에서 도우미를 직접 쓰는 스펙. 표현은 테스트가 정한다.
const specWith = over => ({ ...NoteSpec, ...over });
const codes = r => r.warnings.map(w => w.code);
// 태그만 모은다: 이스케이프가 제대로면 텍스트 속 '<' 는 &lt; 라서 여기에 안 잡힌다.
const tags = html => html.match(/<[a-zA-Z][^>]*>/g) || [];
// 따옴표 값 안의 'onerror=' 같은 글자는 값이지 속성이 아니다. 태그를 속성 [이름, 값] 쌍으로 쪼갠다.
const attrs = tag => [...tag.matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+)))?/g)].slice(1).map(m => [m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? ""]);
// 실행 경로 검사: script 태그 없음, on* 속성 없음, URL 속성은 blob:/래스터 data: 만.
const noHandlers = html => {
  for (const t of tags(html)) {
    assert.ok(!/^<script/i.test(t), t);
    for (const [k, v] of attrs(t)) {
      assert.ok(!k.startsWith("on"), t);
      assert.ok(!/^(?:href|src|action|formaction|srcdoc|xlink:href)$/.test(k) || /^(?:blob:|data:image\/)/.test(v), t);
    }
  }
};
// KaTeX strict 모드가 htmlClass 같은 확장에 console.warn 을 낸다 — 테스트 출력만 조용히 한다.
const quiet = fn => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };

test("문서 순서는 슬롯의 layout 이 정하고 CSS 도 슬롯에서 온다", () => {
  const r = run(note({
    global: [textBlock("전역")], notices: [{ code: "VAL_BLOCK_FAILED", count: 2 }],
  }));
  assert.ok(r.html.startsWith("<style>" + NoteSpec.css + "</style>"));
  const at = s => r.html.indexOf(s);
  assert.ok(at("전역") > 0 && at("전역") < at("미분") && at("미분") < at("2건"), "전역, 섹션, 고지 순서");
  assert.deepEqual(r.warnings, []);
});

test("검증된 수식은 KaTeX 로, 인라인으로 그린다", () => {
  const r = run(note());
  assert.match(r.html, /class="katex"/);
  assert.ok(!r.html.includes("katex-display"));
  assert.ok(!r.html.includes("{{F1}}"));
});

test("verified 외 상태는 LaTeX 를 그리지 않고 크롭이 있으면 원본 이미지로 표시한다", () => {
  for (const id of ["F2", "F3", "F4"]) {
    const r = run(withBody(`{{${id}}}`), { crops: { [id]: BLOB } });
    assert.ok(r.html.includes(`<img class="note-crop" src="${BLOB}" alt="원본 이미지로 표시">`), id);
    assert.ok(r.html.includes("원본 이미지로 표시</span>"), id + " 라벨");
    assert.ok(!r.html.includes("katex") && !r.html.includes("frac") && !r.html.includes("sqrt"), id + " 미검증 LaTeX 노출 금지");
    assert.deepEqual(r.warnings, []);
  }
  assert.ok(run(withBody("{{F1}}"), { crops: { F1: BLOB } }).html.includes("katex"), "verified 는 크롭이 있어도 수식");
});

test("크롭이 없으면 OCR 텍스트를 미검증으로 표시하고 LaTeX 는 숨긴다", () => {
  const r = run(withBody("{{F3}}|{{F2}}|{{F4}}"));
  assert.ok(r.html.includes('<span class="note-f note-f-raw">a/b<span class="note-f-label">미검증</span></span>'));
  assert.ok(r.html.includes("√2<span") && r.html.includes("alpha<span"));
  assert.ok(!r.html.includes("katex") && !r.html.includes("\\frac") && !r.html.includes("\\sqrt"));
  // OCR 텍스트가 없는 항목: LaTeX 대신 고정 문구
  const bare = run(withBody("{{F9}}"), {}).html;
  assert.ok(bare.includes("알 수 없는 수식 F9"));
  const noText = run(withBody("{{F6}}", { registry: [reg("F6", "unverified", { latex: "z^9" })] })).html;
  assert.ok(noText.includes("[수식]") && noText.includes("미검증") && !noText.includes("z^9") && !noText.includes("katex"));
});

test("KaTeX 실패는 경고를 남기고 크롭, 없으면 미검증 텍스트로 내려간다", () => {
  const withCrop = run(withBody("{{F5}}"), { crops: { F5: PNG } });
  assert.ok(withCrop.html.includes(`src="${PNG}"`) && !withCrop.html.includes("katex"));
  assert.deepEqual(withCrop.warnings, [{ code: "RENDER_FORMULA_FAILED", count: 1, ids: ["F5"] }]);
  const noCrop = run(withBody("{{F5}} {{F5}}"));
  assert.ok(noCrop.html.includes("OCR5<span") && noCrop.html.includes("미검증"));
  assert.deepEqual(noCrop.warnings, [{ code: "RENDER_FORMULA_FAILED", count: 2, ids: ["F5"] }]);
  // 가짜 KaTeX: 모든 verified 수식이 같은 경로를 탄다
  const fake = renderNote(withBody("{{F1}}"), { katex: throwingKatex, crops: { F1: BLOB } });
  assert.ok(fake.html.includes(`src="${BLOB}"`));
  assert.deepEqual(fake.warnings, [{ code: "RENDER_FORMULA_FAILED", count: 1, ids: ["F1"] }]);
});

test("모르는 수식 id 는 이스케이프된 눈에 보이는 자리표시자와 경고가 된다", () => {
  const r = run(withBody("앞 {{F99}} 뒤"));
  assert.ok(r.html.includes('<span class="note-f note-f-missing">[알 수 없는 수식 F99]</span>'));
  assert.deepEqual(r.warnings, [{ code: "RENDER_REF_UNKNOWN", count: 1, ids: ["F99"] }]);
});

test("참조는 공백과 줄바꿈을 허용하고 줄바꿈은 보존한다", () => {
  const html = run(withBody("a\nb\r\nc {{ F1 }}&{{F1}}")).html;
  assert.ok(html.includes("a<br>b<br>c "));
  assert.equal(html.match(/class="katex"/g).length, 2);
  assert.ok(html.includes("&amp;"));
});

test("크롭 src 는 blob: 과 래스터 data: 만 통과하고 나머지는 거절한다", () => {
  const bad = [
    "javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,AA==\"onerror=\"x",
    "https://evil.example/x.png", "//evil.example/x.png", "blob:x\" onerror=\"alert(1)", "blob:", "", "BLOB:abc", " " + BLOB, BLOB + "\n", { src: BLOB }, null,
  ];
  for (const src of bad) {
    const r = run(withBody("{{F2}}"), { crops: { F2: src } });
    assert.ok(!r.html.includes("<img"), "거절: " + JSON.stringify(src));
    assert.deepEqual(r.warnings, [{ code: "RENDER_CROP_REJECTED", count: 1, ids: ["F2"] }], JSON.stringify(src));
    assert.ok(r.html.includes("미검증"), "OCR 텍스트로 내려간다");
    noHandlers(r.html);
  }
  for (const src of [BLOB, PNG, "data:image/jpeg;base64,/9j/4AAQ", "data:image/webp;base64,UklGRg==", "blob:null/abc-123"]) {
    assert.ok(run(withBody("{{F2}}"), { crops: { F2: src } }).html.includes(`src="${src}"`), src);
  }
  // 프로토타입 키는 크롭이 아니다
  assert.ok(!run(withBody("{{F2}}"), { crops: {} }).html.includes("<img"));
});

test("XSS 프로브: 모델 텍스트는 어디서도 태그·속성·핸들러가 되지 못한다", () => {
  const probes = [
    "<script>alert(1)</script>", '"><img src=x onerror=alert(1)>', "<svg onload=alert(1)>", "'><iframe src=javascript:alert(1)>",
    "&lt;script&gt;", "</style><script>alert(1)</script>", "javascript:alert(1)", "<a href=\"javascript:alert(1)\">x</a>",
  ];
  for (const p of probes) {
    const r = run(note({
      sections: [{ sectionId: p, title: p, blocks: [{ type: "text", heading: p, body: p + " {{F3}}", evidenceIds: [p], derived: [] }] }],
      global: [{ type: p, heading: p, body: p }],
      registry: [reg("F3", "unverified", { text: p })], notices: [{ code: p, count: p }],
    }), { crops: { F3: p } });
    assert.ok(!r.html.includes(p) || !p.includes("<"), "원문 그대로 노출: " + p);
    noHandlers(r.html);
    assert.ok(!/<(?:script|img|svg|iframe|a)\b/i.test(r.html), p);
  }
});

test("XSS 프로브: 속성 안의 모델 텍스트와 {{F1}} 는 치환되지 않고 속성을 못 깬다", () => {
  const spec = specWith({ templates: { text: (b, h) => `<p title="${h.esc(b.body)}" data-h='${h.esc(b.heading)}'>x</p>` } });
  const body = '" onmouseover="alert(1)" {{F1}}', heading = "' onfocus='alert(1)' {{F1}}";
  const r = run(note({ sections: [{ sectionId: "S1", title: "t", blocks: [{ type: "text", heading, body }] }] }), { spec });
  assert.ok(r.html.includes('title="&quot; onmouseover=&quot;alert(1)&quot; {{F1}}" data-h=\'&#39; onfocus=&#39;alert(1)&#39; {{F1}}\''));
  assert.ok(!r.html.includes("katex"));
  noHandlers(r.html);
  // sectionId 도 id 속성에서 갇힌다
  const id = run(note({ sections: [{ sectionId: 'S1" onclick="x', title: "t", blocks: [] }] })).html;
  assert.ok(id.includes('id="S1&quot; onclick=&quot;x"'));
  noHandlers(id);
});

test("XSS 프로브: 수식 안의 모델 HTML·링크는 실행 경로가 되지 못한다", () => {
  // KaTeX(trust:false)는 \\href·\\url·\\includegraphics·\\htmlClass 를 던지지 않고 붉은 명령어 글자로 그린다 — 링크·속성은 만들지 않는다.
  const evil = [
    reg("F1", "verified", { latex: "\\text{<script>alert(1)</script>}" }),
    reg("F2", "verified", { latex: "\\href{javascript:alert(1)}{x}" }),
    reg("F3", "verified", { latex: "\\includegraphics{javascript:alert(1)}" }),
    reg("F4", "verified", { latex: "\\htmlClass{x\" onclick=\"y}{z}" }),
    reg("F5", "unverified", { text: "<img src=x onerror=alert(1)>" }),
    reg("F6", "verified", { latex: "\\notacommand{<b>x</b>}", text: "<b>OCR6</b>" }),
  ];
  const r = quiet(() => run(withBody("{{F1}}{{F2}}{{F3}}{{F4}}{{F5}}{{F6}}", { registry: evil })));
  noHandlers(r.html);
  assert.ok(!/<script/i.test(r.html) && !/href\s*=/i.test(r.html) && !r.html.includes("<img src=x") && !r.html.includes("<b>"));
  assert.ok(r.html.includes("&lt;b&gt;OCR6&lt;/b&gt;<span"), "던진 수식은 이스케이프된 OCR 텍스트로");
  assert.deepEqual(r.warnings, [{ code: "RENDER_FORMULA_FAILED", count: 1, ids: ["F6"] }]);
});

test("파생 LaTeX 는 h.math 로 렌더하고 실패하면 이스케이프된 원문과 경고 코드를 낸다", () => {
  const derived = ["\\int_0^1 x\\,dx", "\\frac{", "\\notacommand{<b>x</b>}"];
  const r = run(withBody("본문", { sections: [{ sectionId: "S1", title: "T", blocks: [{ ...textBlock("본문"), derived }] }] }));
  assert.equal(r.html.match(/class="katex-display"/g).length, 1, "성공한 식은 디스플레이 수식");
  assert.ok(r.html.includes('<code class="note-f-src">\\frac{</code>'));
  assert.ok(r.html.includes("&lt;b&gt;x&lt;/b&gt;") && !r.html.includes("<b>"));
  assert.deepEqual(r.warnings, [{ code: "RENDER_FORMULA_FAILED", count: 2 }]);
  noHandlers(r.html);
  // derived 가 이상한 모양이어도 템플릿이 지킨다
  assert.deepEqual(run(note({ sections: [{ sectionId: "S1", title: "T", blocks: [{ ...textBlock("x"), derived: "oops" }] }] })).warnings, []);
});

test("h 도우미를 직접 쓴다: esc, rich, math, formula, crop", () => {
  let h;
  const spec = specWith({ templates: { text: (b, hh) => (h = hh, "") }, layout: (n, hh) => hh.block(n.sections[0].blocks[0]) });
  renderNote(note({ sections: [{ sectionId: "S1", title: "t", blocks: [{ type: "text" }] }] }), { katex, spec, crops: { F2: PNG, X: "javascript:1" } });
  assert.equal(h.esc(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
  assert.equal(h.esc(null), "");
  assert.equal(h.esc(12), "12");
  assert.equal(h.rich("a<b\n{{F1}}"), "a&lt;b<br>" + h.formula("F1"));
  assert.match(h.math("x", { display: true }), /katex-display/);
  assert.doesNotMatch(h.math("x"), /katex-display/);
  assert.doesNotMatch(h.math("x", null), /katex-display/);
  assert.equal(h.math("\\bad{<i>"), '<code class="note-f-src">\\bad{&lt;i&gt;</code>');
  assert.equal(h.crop("F2", 'a"b'), `<img class="note-crop" src="${PNG}" alt="a&quot;b">`);
  assert.equal(h.crop("nope"), "");
  assert.equal(h.crop("X"), "");
  assert.equal(h.crop("constructor"), "", "프로토타입 키");
  assert.equal(h.formula("constructor"), '<span class="note-f note-f-missing">[알 수 없는 수식 constructor]</span>');
});

test("모르는 블록 종류는 경고와 이스케이프된 폴백이 되고 크래시하지 않는다", () => {
  const r = run(note({
    global: [{ type: "quiz", question: "Q <b>1</b> {{F1}}", choices: ["가", "<i>나</i>"], evidenceIds: ["U9"], id: "b1" }],
    sections: [{ sectionId: "S1", title: "T", blocks: [{ type: "constructor", body: "c" }, { type: "__proto__", body: "p" }, { type: "toString" }, null, "문자열", { body: "타입 없음" }, { type: 7 }] }],
  }));
  assert.deepEqual(r.warnings, [{ code: "RENDER_NO_TEMPLATE", count: 8 }]);
  assert.ok(r.html.includes("Q &lt;b&gt;1&lt;/b&gt; ") && r.html.includes("class=\"katex\""), "폴백에서도 이스케이프와 수식 치환");
  assert.ok(r.html.includes("&lt;i&gt;나&lt;/i&gt;") && !r.html.includes("<i>") && !r.html.includes("U9") && !r.html.includes(">quiz<"));
  assert.ok(r.html.includes("<p>문자열</p>") && r.html.includes("<p>타입 없음</p>"));
});

test("템플릿이 던지거나 문자열을 주지 않으면 폴백과 경고가 된다", () => {
  const spec = specWith({ templates: { text: () => { throw new Error("secret 강의 내용"); }, bad: () => 42 } });
  const r = run(note({ sections: [{ sectionId: "S1", title: "T", blocks: [{ type: "text", body: "A" }, { type: "bad", body: "B" }] }] }), { spec });
  assert.deepEqual(r.warnings, [{ code: "RENDER_TEMPLATE_FAILED", count: 2 }]);
  assert.ok(r.html.includes("<p>A</p>") && r.html.includes("<p>B</p>"));
  assert.ok(!JSON.stringify(r.warnings).includes("secret"));
});

test("고지 문구는 슬롯에서 오고 일반 텍스트로 이스케이프되며 던져도 렌더는 계속된다", () => {
  const kinds = [{ code: "VAL_BLOCK_FAILED", count: 3 }, { code: "VAL_UNCITED", count: 1 }, { code: "SRC_GAPS" }, { code: "<UNKNOWN>" }];
  const html = run(note({ notices: kinds })).html;
  assert.ok(html.includes("3건") && html.includes("1건") && html.includes("기록이 끊긴") && html.includes("알림: &lt;UNKNOWN&gt;"));
  const spec = specWith({ notice: (n, h) => (n.code === "X" ? (() => { throw new Error("x"); })() : "<b>" + n.code + "</b>") });
  const r = run(note({ notices: [{ code: "A" }, { code: "X" }, null] }), { spec });
  assert.ok(r.html.includes("&lt;b&gt;A&lt;/b&gt;") && !r.html.includes("<b>"));
  assert.deepEqual(r.warnings, [{ code: "RENDER_TEMPLATE_FAILED", count: 2 }]);
});

test("표현은 전부 슬롯에서 온다: 슬롯을 바꾸면 노트 마크업이 통째로 바뀐다", () => {
  const spec = {
    NOTE_SPEC_VERSION: "custom-1", css: ".k{}",
    templates: { callout: (b, h) => `<aside>${h.rich(b.text)}</aside>` },
    layout: (n, h) => `<main>${n.sections.map(s => s.blocks.map(b => h.block(b)).join("")).join("")}</main>`,
    notice: () => "",
  };
  const r = renderNote({ noteSpecVersion: "custom-1", sections: [{ sectionId: "S1", title: "t", blocks: [{ type: "callout", text: "핵심 {{F1}}" }] }], registry: REGISTRY }, { katex, spec });
  assert.ok(r.html.startsWith("<style>.k{}</style><main><aside>핵심 <span class=\"katex\">"));
  assert.ok(r.html.endsWith("</aside></main>"));
  assert.ok(!r.html.includes("note-block") && !r.html.includes("<article"));
  assert.deepEqual(r.warnings, []);
  assert.equal(renderNote({ noteSpecVersion: "custom-1" }, { katex, spec: { ...spec, css: "" } }).html, "<main></main>", "CSS 없으면 style 도 없다");
});

test("스펙 버전이 다르면 경고만 하고 렌더한다", () => {
  const r = run(note({ noteSpecVersion: "old-9" }));
  assert.deepEqual(r.warnings, [{ code: "RENDER_SPEC_MISMATCH", count: 1 }]);
  assert.match(r.html, /class="katex"/);
});

test("KaTeX 객체가 없으면 조용히 내려가지 않고 던진다", () => {
  assert.throws(() => renderNote(note(), {}), /KaTeX/);
  assert.throws(() => renderNote(note(), { katex: {} }), /KaTeX/);
});

test("엉성한 노트도 크래시하지 않는다", () => {
  assert.equal(run({}).html.includes("<article"), true);
  assert.equal(run(null).html.includes("<article"), true);
  const r = run(note({ registry: [null, { id: 5 }, reg("F1", "verified", { latex: "x" })], global: "oops", sections: [{ sectionId: "S1", title: "T" }] }));
  assert.match(r.html, /<section id="S1"><h2>T<\/h2><\/section>/);
});

test("같은 입력은 바이트까지 같은 HTML 을 만든다(시각·난수 미사용)", () => {
  const input = note({
    global: [textBlock("전역 {{F1}}")], notices: [{ code: "SRC_GAPS", ranges: [{ t0: 1, t1: 2 }] }],
    sections: [{ sectionId: "S1", title: "T", blocks: [{ ...textBlock("{{F1}} {{F2}} {{F3}} {{F5}} {{F9}}"), derived: ["a^2", "\\frac{"] }, { type: "quiz", q: "x" }] }],
  });
  const crops = { F2: BLOB, F5: PNG };
  const a = run(input, { crops });
  const { now } = Date, { random } = Math;
  Date.now = Math.random = () => { throw new Error("비결정 입력"); };
  let b;
  try { b = run(JSON.parse(JSON.stringify(input)), { crops: { ...crops } }); } finally { Date.now = now; Math.random = random; }
  assert.equal(b.html, a.html);
  assert.deepEqual(b.warnings, a.warnings);
  assert.equal(run(input, { crops }).html, a.html);
});

test("경고는 내용이 없다: 코드, 건수, F-id 뿐", () => {
  const SECRET = "비밀강의내용";
  const r = run(note({
    sections: [{ sectionId: "S1", title: SECRET, blocks: [textBlock(SECRET + " {{F5}} {{F77}}"), { type: SECRET, body: SECRET }] }],
    registry: [...REGISTRY, reg("F6", "image", { text: SECRET })],
  }), { crops: { F5: "javascript:" + SECRET } });
  assert.ok(r.warnings.length >= 3);
  for (const w of r.warnings) {
    assert.deepEqual(Object.keys(w).filter(k => !["code", "count", "ids"].includes(k)), []);
    assert.match(w.code, /^RENDER_[A-Z_]+$/);
    assert.ok(Number.isInteger(w.count) && w.count > 0);
    for (const id of w.ids || []) assert.match(id, /^F\d+$/);
  }
  assert.ok(!JSON.stringify(r.warnings).includes(SECRET));
  assert.equal(globalThis.NoteRender.renderNote, renderNote, "UMD 전역 노출");
});
