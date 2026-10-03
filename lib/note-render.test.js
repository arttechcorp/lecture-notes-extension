const test = require("node:test");
const assert = require("node:assert/strict");
const katex = require("./vendor/katex/katex.min.js");
const NC = require("./note-contract.js");
const NoteSpec = require("./note-spec.js");
const { renderNote } = require("./note-render.js");
const FIX = require("../tools/note-fixture/expected-note.json");

const deep = o => JSON.parse(JSON.stringify(o));
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const BLOB = "blob:chrome-extension://aaaaaaaaaaaaaaaa/00000000-0000-0000-0000-000000000000";
const run = (n, o = {}) => renderNote(n, { katex, ...o });
const codes = r => r.warnings.map(w => w.code);
const cl = (text, basis = "lecture", evidenceIds = []) => ({ text, evidenceIds, basis });
const blk = (id, type, content) => ({ id, type, sectionId: null, status: "supported", importance: "core", emphasis: [], content });
const sec = (over = {}) => ({ sectionId: "S1", number: 1, title: "단원", question: null, stage: "understand", unitIds: ["U1"], range: { t0: 0, t1: 100 }, gist: null, blocks: [], checks: [], ...over });
const note = (over = {}) => ({
  noteSpecVersion: NC.NOTE_SPEC_VERSION, status: "complete", tier: "paid",
  policy: { externalAugmentation: false, syntheticExamples: false },
  meta: {}, concepts: [], global: [], sections: [], registry: [], figures: [], sources: [], notices: [], dropped: [], pruned: [], advisories: [], ...over,
});
const fig = (id, over = {}) => ({ id, evidenceId: "U1.s1", kind: "table", title: "표", cells: [["기준", "값"], ["a", "1"]], chartData: null, t0: 50, display: "table", ...over });
const b05 = (id, def) => blk(id, "B05", { conceptId: "C1", term: "용어", original: null, definition: cl(def), explanation: null, mechanism: null, scope: [], examples: [] });
const b10 = (id, over = {}) => blk(id, "B10", {
  title: "계산", kind: "calc", goal: null, formulaIds: [], figureIds: [], variables: [], assumptions: [],
  inputs: [], steps: [], derived: [], reading: [], result: null, limits: [], withheld: null, ...over,
});
const b14 = (id, items) => blk(id, "B14", { items });
const item = over => ({
  kind: "ox", prompt: cl("판단 문장"), premise: null, level: "basic", targetIds: ["S1"],
  answer: { verdict: "O", explanation: cl("해설"), correction: null, rubric: [], alternatives: [], reviewIds: ["S1_B1"] },
  ...over,
});

// ── 1. 골든 노트 ──
test("expected-note.json 은 경고 없이 렌더되고 모든 단원 제목·문항 앵커가 나온다", () => {
  const r = run(deep(FIX));
  assert.deepEqual(r.warnings, []);
  assert.ok(r.html.startsWith("<style>" + NoteSpec.css + "</style><article class=\"note\">"));
  for (const s of FIX.sections) assert.ok(r.html.includes(`>${s.title}<`), s.sectionId);
  assert.ok(r.html.includes("일부 누락"), "partial 표식");
  assert.equal((r.html.match(/id="q-\d+"/g) || []).length,
    FIX.sections.flatMap(s => s.blocks).filter(b => b.type === "B14").reduce((n, b) => n + b.content.items.length, 0));
  assert.ok(!r.html.includes("정답과 해설"), "웹 기본은 문항 아래 접힌 해설");
  assert.ok(!r.html.includes("NOTE_ADVISORY"), "조판 힌트는 텍스트로 나가지 않는다");
  for (const id of ["S4_B2/Q3", "GB1/I3"]) assert.ok(!r.html.includes(id), "정리된 항목 id 는 나가지 않는다");
});

// ── 2. 매체별 답안 공개 ──
test("web 은 문항 아래 <details>, print+inline 은 바로 아래, print+end 는 끝 파트, exam 은 쪽 넘김", () => {
  const n = note({ sections: [sec({ blocks: [b05("S1_B1", "정의"), b14("S1_B2", [item({})])] })] });
  const web = run(n);
  assert.match(web.html, /<details class="answer"><summary>01번 해설 보기<\/summary>/);
  assert.ok(!web.html.includes('id="a-01"') && !web.html.includes("정답과 해설"));
  const inl = run(n, { options: { medium: "print", answers: "inline" } });
  assert.ok(inl.html.includes(`id="q-01"`));
  assert.ok(inl.html.indexOf('id="q-01"') < inl.html.indexOf('<div class="answer">'), "문항 바로 아래 해설");
  assert.ok(!inl.html.includes('<section class="note-answers"'), "문항 아래 해설이면 끝 파트 없음(CSS 이름과 구분)");
  const end = run(n, { options: { medium: "print" } });
  assert.ok(end.html.includes('<section class="note-answers"'));
  assert.ok(end.html.includes('id="a-01"') && end.html.includes('href="#q-01"') && end.html.includes('href="#a-01"'));
  const exam = run(n, { options: { medium: "print", exam: true } });
  assert.ok(exam.html.includes('class="note-answers page-break"'), "시험 모드는 답안 앞에서 쪽을 넘긴다");
});

// ── 3. 수식 display ──
test("수식: latex 는 KaTeX 인라인, crop 은 이미지+라벨, check 는 표식과 인식 원문", () => {
  const n = note({
    registry: FIX.registry,
    sections: [sec({ blocks: [b05("S1_B1", "식 {{F1}} 과 {{F2}}, 미검증 {{F3}}")] })],
  });
  const r = run(n, { crops: { F2: PNG } });
  assert.ok(r.html.includes('class="katex"') && !r.html.includes("katex-display"), "F1 인라인 KaTeX");
  assert.ok(r.html.includes(`<img class="note-crop" src="${PNG}"`) && r.html.includes("원본 이미지로 표시</span>"), "F2 크롭");
  assert.ok(r.html.includes("수식 확인 필요") && r.html.includes("(9:20)"), "F3 확인 표식 + 시각");
  assert.ok(r.html.includes("인식 원문(미검증): TC = C_market - C_internal"), "F3 OCR 원문");
  assert.ok(!r.html.includes("{{F"), "참조는 전부 치환");
  const noCrop = run(n); // 크롭이 없으면 crop 표시도 확인 표식으로 내린다
  assert.ok(noCrop.html.includes("수식 확인 필요") && !noCrop.html.includes("<img"));
});

// ── 4. 도표 display ──
test("도표: table 은 <table>+<caption>, chart 는 <svg>+값 라벨, crop 은 이미지, check 는 표식", () => {
  const n = note({
    figures: [
      fig("G1", { kind: "table", display: "table", cells: [["기준", "거래비용", "자원기반"], ["분석 단위", "거래", "자원"], ["핵심 질문", "만들까", "강점"]] }),
      fig("G2", { kind: "chart", display: "chart", cells: null, chartData: { type: "bar", categories: ["1분기", "2분기"], series: [{ name: "매출", values: [12, 17] }], unit: "억", xLabel: "분기", yLabel: "매출" } }),
      fig("G3", { kind: "diagram", display: "crop", cells: null }),
      fig("G4", { kind: "table", display: "check", cells: null }),
    ],
    sections: [sec({ blocks: [b10("S1_B1", { figureIds: ["G1", "G2", "G3", "G4"] })] })],
  });
  const r = run(n, { crops: { G3: BLOB } });
  assert.deepEqual(r.warnings, []);
  assert.ok(r.html.includes('<table class="note-table"><caption>화면 표를 옮겨 적음</caption>'), "표 도표 캡션");
  assert.ok(r.html.includes('<th scope="row">분석 단위</th>') && r.html.includes('<td data-label="자원기반">자원</td>'));
  assert.ok(r.html.includes("<svg") && r.html.includes(">12억<") && r.html.includes(">17억<"), "차트 값 라벨");
  assert.ok(r.html.includes("화면 그래프를 옮겨 그림"));
  assert.ok(r.html.includes(`<img class="note-crop" src="${BLOB}"`), "G3 크롭");
  assert.ok(r.html.includes("도표 확인 필요 <small>(0:50)</small>"), "G4 확인 표식");
});

test("차트는 음수를 영점 기준선 아래로 그린다(막대 아래로, 값 라벨 유지)", () => {
  const f = fig("G1", { kind: "chart", display: "chart", cells: null, chartData: { type: "bar", categories: ["상반기", "하반기"], series: [{ name: "손익", values: [-3, 5] }], unit: "억", xLabel: null, yLabel: null } });
  const r = run(note({ figures: [f], sections: [sec({ blocks: [b10("S1_B1", { figureIds: ["G1"] })] })] }));
  assert.ok(r.html.includes("<svg") && !r.html.includes("도표 확인 필요"));
  assert.ok(r.html.includes(">-3억<") && r.html.includes(">5억<"));
  const rects = r.html.match(/<rect[^>]*y="([\d.]+)"[^>]*height="([\d.]+)"/g) || [];
  assert.ok(rects.length === 2, "음수 막대도 그린다");
  const l = fig("G2", { kind: "chart", display: "chart", cells: null, chartData: { type: "line", categories: ["a", "b"], series: [{ name: "s", values: [-2, 4] }], unit: null, xLabel: null, yLabel: null } });
  const r2 = run(note({ figures: [l], sections: [sec({ blocks: [b10("S1_B1", { figureIds: ["G2"] })] })] }));
  assert.ok(r2.html.includes("<polyline") && r2.html.includes(">-2<"));
});

// ── 도표 배치 ──
test("어느 블록도 가리키지 않은 도표는 t0 가 드는 단원의 확인 상자 앞, 어디에도 안 들면 마지막 단원 뒤, 한 번만", () => {
  const check = { kind: "missing", claim: cl("확인할 것"), targetIds: ["S2_B1"], before: null, after: null, hold: null };
  const n = note({
    figures: [fig("G1", { t0: 150 }), fig("G2", { t0: 999 }), fig("G3", { t0: 150 })],
    sections: [
      sec({ sectionId: "S1", range: { t0: 0, t1: 100 }, blocks: [b05("S1_B1", "정의")] }),
      sec({ sectionId: "S2", number: 2, range: { t0: 100, t1: 200 }, blocks: [b10("S2_B1", { figureIds: ["G3"] })], checks: [check] }),
    ],
  });
  const r = run(n);
  assert.deepEqual(r.warnings, []);
  const at = s => r.html.indexOf(s);
  assert.ok(at('data-fig="G3"') < at('data-fig="G1"'), "참조 도표가 먼저");
  assert.ok(at('data-fig="G1"') > at('id="S2"') && at('data-fig="G1"') < at('data-kind="missing"'), "고아 도표는 그 단원 확인 상자 앞");
  assert.ok(at('data-fig="G2"') > at('data-kind="missing"') && at('data-fig="G2"') > r.html.lastIndexOf("</section>"), "범위 밖은 마지막 단원 뒤");
  assert.equal((r.html.match(/data-fig="G1"/g) || []).length, 1, "도표는 한 번만");
});

// ── 5. basis 라벨 ──
test("synthetic·external 주장은 라벨을 단다", () => {
  const n = note({
    policy: { externalAugmentation: true, syntheticExamples: true },
    sections: [sec({ blocks: [b05("S1_B1", "가상")].map(b => (b.content.definition.basis = "synthetic", b.content.examples = [cl("외부 보강", "external")], b)) })],
  });
  const r = run(n);
  assert.ok(r.html.includes('class="note-label note-label-synthetic">가상 사례<'));
  assert.ok(r.html.includes('class="note-label note-label-external">강의 밖 보강 — 확인 필요<'));
});

// ── 6. 고지 ──
test("고지는 문구만 나가고 ids·advisories·조판 힌트 코드는 나가지 않는다", () => {
  const n = note({
    notices: [
      { code: "NOTE_CAPTURE_GAP", count: 2, ids: null, ranges: [{ t0: 725, t1: 820 }] },
      { code: "NOTE_BLOCKS_DROPPED", count: 3, ids: ["S3_B4"], ranges: null },
      { code: "NOTE_ADVISORY_TABLE_WIDE", count: 1 },
      { code: "NOTE_NOPE", count: 1 },
    ],
    advisories: [{ code: "NOTE_ADVISORY_TABLE_LONG", id: "S1_B1" }],
    sections: [sec({ blocks: [b05("S1_B1", "본문")] })],
  });
  const r = run(n);
  assert.ok(r.html.includes("인식하지 못한 구간 2곳 (12:05–13:40)"));
  assert.ok(r.html.includes("검증을 통과하지 못해 뺀 내용 3건"));
  assert.ok(r.html.includes("기타 고지: NOTE_NOPE×1"));
  assert.ok(!r.html.includes("NOTE_ADVISORY"), "조판 힌트·advisories 는 텍스트로 나가지 않는다");
  assert.ok(!r.html.includes("S3_B4\"") || !/S3_B4[^"]*건/.test(r.html.replace(/id="[^"]*"/g, "")), "고지 문구에 id 없음");
});

// ── 7. 이스케이프 ──
test("모델 텍스트의 <script> 는 어디에서도 이스케이프된다", () => {
  const p = "<script>alert(1)</script>";
  const n = note({
    meta: { title: p },
    figures: [fig("G1", { title: p, t0: 50 })],
    sections: [sec({ title: p, question: p, gist: cl(p), blocks: [b05("S1_B1", p + " {{F1}}")], checks: [{ kind: "missing", claim: cl(p), targetIds: ["S1_B1"], before: null, after: null, hold: null }] })],
    notices: [{ code: "NOTE_CAPTURE_GAP", count: 1 }],
    registry: [{ id: "F1", latex: "x", text: p, status: "unverified", slideId: "s", t0: 1, display: "check" }],
  });
  const r = run(n, { crops: {} });
  assert.ok(!r.html.includes("<script>"), "원문 스크립트 태그 없음");
  assert.ok(r.html.includes("&lt;script&gt;"), "이스케이프된 원문은 보인다");
  assert.ok(!/onerror=|onclick=|onload=/i.test(r.html), "핸들러 속성 없음");
});

// ── 8. 경고·오류 ──
test("스펙 버전 불일치·거절된 크롭은 경고, KaTeX 부재는 오류", () => {
  const r = run(note({ noteSpecVersion: "lecture-note-1" }));
  assert.deepEqual(r.warnings, [{ code: "RENDER_SPEC_MISMATCH", count: 1 }]);
  const bad = run(note({
    registry: [{ id: "F1", latex: null, text: "x", status: "image", slideId: "s", t0: 1, display: "crop" }],
    sections: [sec({ blocks: [b05("S1_B1", "{{F1}}")] })],
  }), { crops: { F1: "https://evil.example/x.png\" onerror=\"alert(1)" } });
  assert.deepEqual(bad.warnings, [{ code: "RENDER_CROP_REJECTED", count: 1, ids: ["F1"] }]);
  assert.ok(!bad.html.includes("<img") && bad.html.includes("수식 확인 필요"));
  assert.throws(() => renderNote(note(), {}), /KaTeX/);
  assert.throws(() => renderNote(note(), { katex: {} }), /KaTeX/);
});

// ── 엔진 안전 ──
test("모르는 블록 종류는 경고와 이스케이프된 폴백, 템플릿이 던지면 폴백", () => {
  const r = run(note({ sections: [sec({ blocks: [blk("S1_B1", "B99", { body: "x <b>1</b> {{F1}}", id: "z" }), blk("S1_B2", "B05", null)] })] }));
  assert.ok(codes(r).includes("RENDER_NO_TEMPLATE"));
  assert.ok(r.html.includes("x &lt;b&gt;1&lt;/b&gt;") && !r.html.includes("{{F1}}") && r.html.includes("알 수 없는 수식 F1"), "폴백도 이스케이프와 수식 치환");
  const spec = { ...NoteSpec, templates: { ...NoteSpec.templates, B05: () => { throw new Error("secret"); } } };
  const r2 = run(note({ sections: [sec({ blocks: [b05("S1_B1", "본문 A")] })] }), { spec });
  assert.deepEqual(r2.warnings, [{ code: "RENDER_TEMPLATE_FAILED", count: 1 }]);
  assert.ok(r2.html.includes("본문 A") && !JSON.stringify(r2.warnings).includes("secret"));
});

test("같은 입력은 바이트까지 같은 HTML 을 낸다", () => {
  const input = deep(FIX), crops = {};
  const a = run(input, { crops, options: { medium: "print" } });
  const { now } = Date, { random } = Math;
  Date.now = Math.random = () => { throw new Error("비결정 입력"); };
  let b;
  try { b = run(deep(input), { crops, options: { medium: "print" } }); } finally { Date.now = now; Math.random = random; }
  assert.equal(b.html, a.html);
  assert.deepEqual(b.warnings, a.warnings);
});

test("경고는 내용이 없다: 코드·건수·F#/G# id 뿐", () => {
  const SECRET = "비밀강의내용";
  const r = run(note({
    registry: [{ id: "F1", latex: null, text: SECRET, status: "image", slideId: "s", t0: 1, display: "crop" }],
    sections: [sec({ title: SECRET, blocks: [b05("S1_B1", SECRET + " {{F1}} {{F99}}"), blk("S1_B2", SECRET, { x: 1 })] })],
  }), { crops: { F1: "javascript:" + SECRET } });
  assert.ok(r.warnings.length >= 3);
  for (const w of r.warnings) {
    assert.deepEqual(Object.keys(w).filter(k => !["code", "count", "ids"].includes(k)), []);
    assert.match(w.code, /^RENDER_[A-Z_]+$/);
    assert.ok(Number.isInteger(w.count) && w.count > 0);
    for (const id of w.ids || []) assert.match(id, /^[FG]\d+$/);
  }
  assert.ok(!JSON.stringify(r.warnings).includes(SECRET));
  assert.equal(globalThis.NoteRender.renderNote, renderNote, "UMD 전역 노출");
});
