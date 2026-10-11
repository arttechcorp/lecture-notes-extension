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
  assert.match(web.html, /<details class="answer answer-compact"><summary>01번 해설 보기<\/summary>/, "OX 해설은 카드째로 묶는 표식을 단다");
  assert.ok(!web.html.includes('id="a-01"') && !web.html.includes("정답과 해설"));
  const inl = run(n, { options: { medium: "print", answers: "inline" } });
  assert.ok(inl.html.includes(`id="q-01"`));
  assert.ok(inl.html.indexOf('id="q-01"') < inl.html.indexOf('<div class="answer answer-compact">'), "문항 바로 아래 해설");
  const arg = run(note({ sections: [sec({ blocks: [b14("S1_B1", [item({ kind: "argue" })])] })] }), { options: { medium: "print", answers: "inline" } });
  assert.ok(arg.html.includes('<div class="answer">'), "긴 서술 답은 compact 가 아니다 — 의미 단위로 나뉠 수 있다");
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
  assert.ok(r.html.includes(`<img class="note-crop" src="${PNG}"`) && !r.html.includes("원본 이미지"), "F2 크롭 — 설명 문구 없이 이미지만");
  assert.ok(r.html.includes("수식 확인 필요") && r.html.includes("(9:20)"), "F3 확인 표식 + 시각");
  assert.ok(r.html.includes("인식한 원문(미검증): TC = C_market - C_internal"), "F3 OCR 원문");
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
  assert.ok(r.html.includes("도표 누락 <small>(0:50)</small>"), "G4 — 재조판도 크롭도 없으면 누락 고지(§5)");
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

test("차트는 시리즈마다 값 개수가 범주와 같아야 한다 — 어긋나면 확인 표식과 경고", () => {
  // 시리즈가 서로 다른 길이면 합계 검사는 우연히 통과할 수 있다([1,2,3]+[4] === 2*2).
  const bad = fig("G1", { kind: "chart", display: "chart", cells: null, chartData: { type: "bar", categories: ["a", "b"], series: [{ name: "x", values: [1, 2, 3] }, { name: "y", values: [4] }], unit: null, xLabel: null, yLabel: null } });
  const r = run(note({ figures: [bad], sections: [sec({ blocks: [b10("S1_B1", { figureIds: ["G1"] })] })] }));
  assert.deepEqual(codes(r), ["RENDER_CHART_INVALID"]);
  assert.ok(!r.html.includes("<svg") && r.html.includes("도표 누락"), "무너진 차트는 그리지 않는다");
});

// ── 4-1. 도표 표시 3단 (§5): 재조판 → 크롭+근거 설명 → 누락 ──
test("도표 3단 표시: 크롭 있으면 크롭(+설명 주장이 있을 때만 설명), 둘 다 없으면 누락", () => {
  const n = note({
    figures: [
      fig("G1", { display: "crop", cells: null }),
      fig("G2", { display: "crop", cells: null, explanation: cl("막대가 해마다 오른다") }),
      fig("G3", { display: "check", cells: null }),
      fig("G4", { display: "check", cells: null, explanation: cl("설명만 있다") }),
    ],
    sections: [sec({ blocks: [b10("S1_B1", { figureIds: ["G1", "G2", "G3", "G4"] })] })],
  });
  const r = run(n, { crops: { G1: BLOB, G2: BLOB } });
  const at = s => r.html.indexOf(s);
  const g1 = r.html.slice(at('data-fig="G1"'), at('data-fig="G2"'));
  assert.ok(g1.includes("note-crop") && !g1.includes("note-fig-explanation"), "설명 주장이 없으면 크롭만");
  const g2 = r.html.slice(at('data-fig="G2"'), at('data-fig="G3"'));
  assert.ok(g2.includes("note-crop") && g2.includes("note-fig-explanation") && g2.includes("막대가 해마다 오른다"), "크롭 + 근거 설명");
  const g3 = r.html.slice(at('data-fig="G3"'), at('data-fig="G4"'));
  assert.ok(g3.includes("도표 누락") && !g3.includes("<img"), "둘 다 없으면 누락 고지");
  const g4 = r.html.slice(at('data-fig="G4"'));
  assert.ok(g4.includes("도표 누락") && !g4.includes("note-fig-explanation"), "크롭 없는 도표에 설명만 달지 않는다");
});

// ── 4-2. 수식 checks: parse 실패·기호/단위 불일치는 크롭 또는 확인 표식 ──
test("수식 mismatch는 원본 크롭(있으면)으로 보이고 LaTeX로는 나가지 않는다", () => {
  const reg = [
    { id: "F1", latex: "y = 2x", text: "z = 2x", status: "image", slideId: "s1", t0: 10, display: "crop",
      checks: { parse: "ok", symbols: "mismatch", units: "unchecked" } },
    { id: "F2", latex: "a + b", text: null, status: "unverified", slideId: "s1", t0: 20, display: "check",
      checks: { parse: "failed", symbols: "unchecked", units: "unchecked" } },
  ];
  const n = note({ registry: reg, sections: [sec({ blocks: [b05("S1_B1", "식 {{F1}} 과 {{F2}}")] })] });
  const r = run(n, { crops: { F1: PNG } });
  assert.ok(r.html.includes(`<img class="note-crop" src="${PNG}"`), "mismatch + 크롭 → 원본 이미지");
  assert.ok(r.html.includes("수식 확인 필요") && r.html.includes("(0:20)"), "크롭 없는 mismatch → 확인 표식");
  assert.ok(!r.html.includes('class="katex"'), "mismatch 수식은 KaTeX으로 나가지 않는다");
});

// ── 4-3. 조판 최소 묶음 (§6): heading-bundle·eq-bundle·qa-bundle 을 실제로 낸다 ──
test("조판 묶음: 제목+첫 문단·식+변수 설명·문항+답안 단서에 bundle 클래스를 단다", () => {
  const n = note({
    registry: [{ id: "F1", latex: "y = 2x", text: "y = 2x", status: "verified", slideId: "s1", t0: 5, display: "latex" }],
    sections: [sec({ blocks: [
      b05("S1_B1", "정의"),
      b10("S1_B2", { formulaIds: ["F1"], variables: [{ symbol: "x", meaning: cl("입력"), unit: "m" }], goal: cl("목표") }),
      b14("S1_B3", [item({ kind: "argue" })]),
    ] })],
  });
  const r = run(n, { options: { medium: "print", answers: "inline", writing: true } });
  assert.ok(r.html.includes('<div class="heading-bundle"><h3>용어</h3>') && r.html.includes('</p></div>'), "B05 제목+정의 묶음");
  assert.ok(r.html.includes('<div class="eq-bundle">'), "B10 식+변수 묶음");
  const eqAt = r.html.indexOf('class="eq-bundle"');
  assert.ok(r.html.indexOf('class="equation"', eqAt) < r.html.indexOf('class="slots"', eqAt), "식 먼저, 변수 설명이 같은 묶음 안");
  const qa = r.html.slice(r.html.indexOf('class="qa-bundle"'), r.html.indexOf('class="qa-bundle"') + 800);
  assert.ok(qa.includes("<strong>") && qa.includes("판단 문장") && qa.includes("answer-space"), "질문+최소 답안 단서(답란)");
  assert.ok(NoteSpec.css.includes(".note .heading-bundle,.note .eq-bundle,.note .qa-bundle{break-inside:avoid}"), "인쇄 CSS 와 클래스가 맞다");
});

// ── 도표 배치 ──
test("어느 블록도 가리키지 않은 도표는 t0 가 드는 단원의 확인 상자 앞, 어디에도 안 들면 마지막 단원 뒤, 한 번만", () => {
  const check = { kind: "correction", claim: cl("정정"), targetIds: ["S2_B1"], before: null, after: null, hold: null }; // 화면에 남는 확인 상자는 정정뿐
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
  assert.ok(at('data-fig="G1"') > at('id="S2"') && at('data-fig="G1"') < at('data-kind="correction"'), "고아 도표는 그 단원 확인 상자 앞");
  assert.ok(at('data-fig="G2"') > at('data-kind="correction"') && at('data-fig="G2"') > r.html.lastIndexOf("</section>"), "범위 밖은 마지막 단원 뒤");
  assert.equal((r.html.match(/data-fig="G1"/g) || []).length, 1, "도표는 한 번만");
});

test("요약하지 못한 단원 구간의 고아 도표는 마지막 단원 뒤로 몰지 않고 함께 뺀다", () => {
  const n = note({
    figures: [fig("G1", { t0: 150 }), fig("G2", { t0: 999 })],
    sections: [sec({ sectionId: "S1", range: { t0: 0, t1: 100 }, blocks: [b05("S1_B1", "정의")] })],
    notices: [{ code: "NOTE_SECTIONS_FAILED", count: 1, ranges: [{ t0: 100, t1: 200 }] }],
  });
  const r = run(n);
  assert.equal(r.html.includes('data-fig="G1"'), false, "실패 단원(100~200초)의 도표는 싣지 않는다");
  assert.ok(r.html.indexOf('data-fig="G2"') > r.html.lastIndexOf("</section>"), "어느 구간에도 안 드는 도표는 종전대로 마지막 단원 뒤");
});

test("확인 상자는 강의 중 정정만 띄우고 인식 확인 필요·자료 충돌·확인 필요는 띄우지 않는다", () => {
  const box = kind => ({ kind, claim: cl("내용"), targetIds: ["S1_B1"], before: null, after: null, hold: null });
  const r = run(note({ sections: [sec({ blocks: [b05("S1_B1", "정의")], checks: ["recognition_uncertain", "input_conflict", "missing", "correction"].map(box) })] }));
  assert.ok(!/인식 확인 필요|자료 충돌|\[확인 필요\]/.test(r.html));
  assert.equal((r.html.match(/class="note-check"/g) || []).length, 1);
  assert.ok(r.html.includes("[강의 중 정정]"));
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
      { code: "NOTE_FORMULAS_IMAGE", count: 2 },
    ],
    advisories: [{ code: "NOTE_ADVISORY_TABLE_LONG", id: "S1_B1" }],
    sections: [sec({ blocks: [b05("S1_B1", "본문")] })],
  });
  const r = run(n);
  assert.ok(r.html.includes("인식하지 못한 구간 2곳 (12:05–13:40)"));
  assert.ok(!r.html.includes("뺀 내용"), "검증에서 뺀 내용 건수는 띄우지 않는다");
  assert.ok(r.html.includes("기타 참고: NOTE_NOPE×1"));
  assert.ok(!r.html.includes("FORMULAS_IMAGE") && !r.html.includes("원본 이미지"), "원본 이미지 수식 고지는 띄우지 않는다");
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
  assert.ok(r.html.includes("x &lt;b&gt;1&lt;/b&gt;") && !r.html.includes("{{F1}}") && r.html.includes("수식 확인 필요"), "폴백도 이스케이프와 수식 치환 — 모르는 식은 '수식 확인 필요'");
  const visible = r.html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, "");
  assert.ok(!visible.includes("F1"), "화면 텍스트에는 내부 id(F1)가 없다 — 앵커 href·KaTeX 마크업 속성의 F# 는 허용");
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

// ── 블록별 양식(part 2: .ref/templates.html 마크업 × content 슬롯) ──
const htmlOf = (type, content, over = {}) =>
  run(note({ sections: [sec({ blocks: [blk("S1_B1", type, content)] })], ...over })).html;

test("B02 한눈에: 질문 키커·항목·대상 링크, issues 는 '열린 질문'", () => {
  const html = htmlOf("B02", { question: cl("핵심 질문 <script>"), mode: "conclusions",
    items: [{ claim: cl("답 하나"), reason: cl("이유"), targetIds: ["S1_B1"] }] });
  assert.ok(html.includes('class="conclusion"') && html.includes("이 강의의 질문") && html.includes('href="#S1_B1"'));
  assert.ok(html.includes("&lt;script&gt;") && !html.includes("<script>"));
  assert.ok(htmlOf("B02", { question: null, mode: "issues", items: [{ claim: cl("미해결"), reason: null, targetIds: ["S1_B1"] }] }).includes("열린 질문"));
});

test("B03 강의 지도: 노드 칩 + 방향 관계 행(출발·관계·도착), 같은 관계는 한 번만", () => {
  const html = htmlOf("B03", { title: "지도", nodes: [
    { key: "n1", label: "루트", targetId: "S1_B1" }, { key: "n2", label: "가지<script>", targetId: null },
    { key: "n3", label: "외곁", targetId: "S9_B9" }],
    edges: [
      { from: "n1", to: "n2", relation: "causes", claim: cl("그래서") },
      { from: "n1", to: "n2", relation: "causes", claim: cl("그래서") },
      { from: "n2", to: "n1", relation: "supports", claim: null },
      { from: "n1", to: "nX", relation: "causes", claim: null },
    ] });
  assert.ok(html.includes('class="map"') && html.includes('class="map-flow"') && html.includes("map-node map-root"));
  assert.equal((html.match(/class="map-edge"/g) || []).length, 2, "중복 관계·끝점 모르는 관계는 뺀다");
  const row = html.slice(html.indexOf('class="map-edge"'), html.indexOf("</li>"));
  assert.ok(row.includes('class="edge-src"') && row.includes('class="edge-rel">원인') && row.includes('class="edge-dst"'), "출발·관계·도착 라벨이 모두 글자로");
  assert.ok(html.includes('href="#S1_B1">루트') && html.includes("그래서"));
  assert.ok(!html.includes("<script>") && html.includes("&lt;script&gt;"));
  assert.ok(html.includes("외곁") && !html.includes('href="#S9_B9"'), "죽은 대상은 라벨만 두고 링크를 달지 않는다");
});

test("B03 지도: precedes 는 '먼저'로 표시한다 — 시간 순서를 인과 관계로 바꾸지 않는다(§5)", () => {
  const html = htmlOf("B03", { title: "지도", nodes: [
    { key: "n1", label: "먼저 일어난 일", targetId: null }, { key: "n2", label: "나중 일", targetId: null }],
    edges: [{ from: "n1", to: "n2", relation: "precedes", claim: null }] });
  assert.ok(html.includes('class="edge-rel">먼저'));
  assert.ok(!html.includes("원인"), "precedes 를 인과로 려나지 않는다");
});

test("B05 개념 설명: term+원어 머리·정의, 슬롯 라벨 없이 내용이 문단으로 이어진다", () => {
  const html = htmlOf("B05", { conceptId: "C1", term: "용어<script>", original: "term", definition: cl("정의"),
    explanation: cl("풀이"), mechanism: cl("원리"), scope: [cl("조건")], examples: [cl("예시")] });
  assert.ok(html.includes('class="concept"') && html.includes('class="definition"') && html.includes("<h3>term(용어&lt;script&gt;)</h3>"), "원어(용어) 머리");
  assert.ok(html.includes('<span class="def-mark">:</span>') && html.includes('<ul class="concept-points">'), ": 정의 + 중간점 상세");
  // 슬롯 라벨(쉬운 풀이·작동 원리·범위·예시)은 내부 구조로만 쓰고 화면·PDF 에는 표시하지 않는다(§5-6).
  assert.ok(!/<dt>|<dl/.test(html), "개념 슬롯 라벨은 나가지 않는다");
  const order = ["정의", "풀이", "원리", "조건", "예시"].map(t => html.indexOf(`>${t}<`));
  assert.ok(order.every(x => x >= 0) && order.every((x, i) => i === 0 || x > order[i - 1]), "내용은 슬롯 순서대로 문단처럼 이어진다");
  assert.ok(html.includes("&lt;script&gt;") && !html.includes("<script>"));
});

test("B06 공통 축 비교: 기준×대상 표·빈 칸은 확인되지 않음·공통·구분", () => {
  const html = htmlOf("B06", { title: "비교", entities: [{ label: "A" }, { label: "B<script>" }],
    criteria: [{ label: "기준", cells: [cl("셀"), null] }], common: [cl("같은 점")], discriminator: cl("갈림길") });
  assert.ok(html.includes('<table class="note-table"') && html.includes('<th scope="row">기준</th>') && html.includes('data-label="B'));
  assert.ok(html.includes("확인되지 않음") && html.includes("<strong>공통</strong>") && html.includes("<strong>구분</strong>"));
  assert.ok(!html.includes("<script>"));
});

test("B07 논리 연결: 번호 사슬·역할 라벨·빠진 고리 표시", () => {
  const html = htmlOf("B07", { title: "연결", relationType: "argument", question: null,
    steps: [{ role: "premise", claim: cl("전제<script>") }, { role: "result", claim: cl("결과") }],
    missingLinks: [cl("빠진 추론")] });
  assert.ok(html.includes('class="chain"') && html.includes("01 전제") && html.includes("02 결과"));
  assert.ok(NoteSpec.css.includes(".chain{list-style:none"), "번호는 양식 한 체계 — ol 표식과 겹치지 않는다");
  assert.ok(html.includes('class="relation"') && html.includes("연결 설명 없음") && html.includes("빠진 추론"));
  assert.ok(!html.includes("<script>"));
});

test("B08 사례와 적용: 사례·해석 상자, Point 앵커·짝 칩, 판단 링크, 판단 상황 슬롯", () => {
  const html = htmlOf("B08", { caseTitle: "사례<script>", source: "lecture_case", situation: cl("상황"),
    points: [{ clue: cl("단서"), reading: cl("해석") }], appliedConceptIds: ["C1"],
    judgment: { pointRefs: [1], claim: cl("판단") }, limits: [cl("범위")],
    decision: { actor: cl("행위자"), goal: null, alternatives: [cl("대안")], criteria: [], tradeoffs: [], missingData: [] } });
  assert.ok(html.includes('class="case-box"') && html.includes('class="analysis-box"') && html.includes("강의 사례"));
  assert.ok(html.includes('id="S1_B1-P1"') && html.includes('href="#S1_B1-P1"'));
  assert.equal((html.match(/Point 1<\/span>/g) || []).length, 2, "자료·해설 칩이 같은 번호로 짝");
  // 의사결정 칸 라벨(행위자·목표·대안·기준·상충·부족한 자료)만 숨기고, 칸마다 한 항목의 들여쓴 목록으로 구분이 남는다(§5-6)
  assert.ok(!/<dt>|<dl class="slots"/.test(html.slice(html.indexOf('class="analysis-box"'))), "의사결정 슬롯 라벨은 나가지 않는다");
  const ul = html.match(/<ul class="decision">([\s\S]*?)<\/ul>/);
  assert.ok(ul && (ul[1].match(/<li>/g) || []).length === 2, "의사결정은 칸마다 한 항목의 들여쓴 목록");
  const decs = ["행위자", "대안"].map(t => html.indexOf(`>${t}<`));
  assert.ok(decs.every(x => x >= 0) && decs[0] < decs[1], "의사결정 내용은 순서대로 이어진다");
  assert.ok(html.includes("<strong>판단</strong>") && html.includes("<strong>범위</strong>"), "판단·범위 라벨은 유지");
  assert.ok(!html.includes("<script>"));
});

test("B08 중복 슬롯: 앞 슬롯이 보인 문장은 뒤 슬롯이 다시 싣지 않고 Point 앵커는 남는다", () => {
  const html = htmlOf("B08", { caseTitle: "사례", source: "lecture_case",
    situation: cl("문장A"), points: [{ clue: cl("문장A"), reading: cl("문장A") }, { clue: cl("문장B"), reading: cl("문장B") }],
    judgment: { pointRefs: [1, 2], claim: cl("문장B") }, limits: [], decision: null });
  const count = t => (html.match(new RegExp(`>${t}<`, "g")) || []).length;
  assert.equal(count("문장A"), 1, "situation 과 같은 문장은 clue·reading 에서 다시 싣지 않는다(mis-sol-hai-28)");
  assert.equal(count("문장B"), 1, "clue 와 같은 문장은 reading·판단에서 다시 싣지 않는다");
  assert.equal((html.match(/id="S1_B1-P1"/g) || []).length, 1, "P1 앵커는 스텁으로라도 살아 있다");
  assert.ok(html.includes('id="S1_B1-P2"'), "P2 앵커는 첫 표시 줄로 옮겨 살아 있다");
  assert.ok(html.includes('href="#S1_B1-P1"') && html.includes('href="#S1_B1-P2"'), "판단의 Point 링크 유지");
  assert.ok(html.includes("<strong>판단</strong>"), "판단 라벨·링크 줄은 남는다");
});

test("B09 중복 슬롯: 자료 문장과 같은 해석 문장은 다시 싣지 않는다", () => {
  const html = htmlOf("B09", { sourceTitle: "자료", sourceKind: "data", gist: cl("요지"),
    points: [{ clue: cl("단서A"), reading: cl("단서A") }, { clue: cl("단서B"), reading: cl("해석B") }] });
  const count = t => (html.match(new RegExp(`>${t}<`, "g")) || []).length;
  assert.equal(count("단서A"), 1, "clue 와 같은 reading 은 생략");
  assert.equal(count("단서B"), 1);
  assert.equal(count("해석B"), 1);
  assert.ok(html.includes('id="S1_B1-P1"') && html.includes('id="S1_B1-P2"'), "앵커는 남은 첫 줄로 옮긴다");
});

test("B09 자료 읽기: 자료·해석 분리, 인용, 저자 주장·강의 해석 다른 칸, Point 앵커", () => {
  const html = htmlOf("B09", { sourceTitle: "자료 A<script>", sourceKind: "historical", gist: cl("요지"),
    quote: { text: "인용 구절", evidenceIds: ["U1.s1"] }, points: [{ clue: cl("단서"), reading: cl("해석") }],
    authorClaim: cl("저자 주장"), lecturerReading: cl("강의 해석"), limits: [] });
  assert.ok(html.includes('class="material-inner"') && html.includes('class="interpretation"'));
  assert.ok(html.includes("사료") && html.includes('class="quote"') && html.includes("저자의 주장") && html.includes("강의의 해석"));
  assert.ok(html.includes('id="S1_B1-P1"') && !html.includes("<script>"));
});

test("B10 수식·표·그래프: 식 행·입력 표·계산 단계·derived 디스플레이·결과", () => {
  const r = run(note({ registry: FIX.registry,
    sections: [sec({ blocks: [blk("S1_B1", "B10", { title: "계산", kind: "calc", goal: cl("목적<script>"),
      formulaIds: ["F1"], figureIds: [], variables: [{ symbol: "P", meaning: cl("가격"), unit: "원" }],
      assumptions: [cl("가정")],
      inputs: [{ label: "가격", value: 15000, unit: "원", evidenceIds: [] }, { label: "변동비", value: 9000, unit: "원", evidenceIds: [] }],
      steps: [{ label: "공헌이익", op: "sub", a: "i1", b: "i2", value: 6000, unit: "원", digits: 0 }],
      derived: ["BEP=\\frac{3000000}{6000}"], reading: [], result: cl("500개"), limits: [], withheld: null })] })] }));
  assert.ok(r.html.includes('class="equation"') && r.html.includes('id="eq-F1"'), "레지스트리 식은 앵커가 딸린 독립 행");
  assert.ok(r.html.includes("공헌이익 = 15,000원 − 9,000원 = <strong>6,000원</strong>"), "i#/c# 참조를 값으로 푼다");
  assert.ok(r.html.includes("katex-display") && r.html.includes("<dt>P</dt>") && r.html.includes("<strong>결과</strong>"));
  assert.ok(!r.html.includes("<script>"));
});

test("B10 formulaIds: 식은 '식 N' 앵커 행으로 한 번만 소개하고 뒤에는 참조 링크, 본문 참조는 그 행 링크", () => {
  const r = run(note({ registry: FIX.registry, sections: [sec({ blocks: [
    b05("S1_B1", "본문의 {{F1}} 참조"),
    b10("S1_B2", { formulaIds: ["F1"] }),
    b10("S1_B3", { formulaIds: ["F1"] }),
    b10("S1_B4", { formulaIds: ["F2"] }),
  ] })] }));
  assert.deepEqual(r.warnings, []);
  assert.equal((r.html.match(/id="eq-F1"/g) || []).length, 1, "식 앵커는 한 번뿐");
  assert.ok(r.html.includes('id="eq-F1"><span class="eq-tag">식 1</span><span class="katex-display">'), "첫 B10 은 '식 1' 디스플레이 수식 행");
  assert.ok(r.html.includes('id="eq-F2"><span class="eq-tag">식 2</span>'), "번호는 문서 순서로 이어진다");
  assert.ok(r.html.includes('class="eq-ref" href="#eq-F1"') && r.html.includes("앞에서 소개한 식"), "뒤 B10 은 수식 본체 대신 앵커 링크");
  const prose = r.html.slice(r.html.indexOf('id="S1_B1"'), r.html.indexOf('id="S1_B2"'));
  assert.ok(prose.includes('href="#eq-F1"') && prose.includes(">식 1<") && !prose.includes("katex"), "식 행이 있는 {{F#}} 는 행 링크 — 본문에 다시 그리지 않는다");
  assert.ok(!/(수식|식) F\d/.test(r.html) && !/>F\d+</.test(r.html), "보이는 라벨에 내부 F# id 는 없다(앵커 속성만)");
});

test("B10 목표의 {{F#}} 는 같은 블록의 식 행으로 링크한다 — 식을 두 번 그리지 않는다", () => {
  const r = run(note({ registry: FIX.registry, sections: [sec({ blocks: [
    b10("S1_B1", { goal: cl("{{F1}} 으로 손익분기점을 구한다"), formulaIds: ["F1"] }),
  ] })] }));
  assert.deepEqual(r.warnings, []);
  assert.equal((r.html.match(/<span class="katex">/g) || []).length, 1, "수식 본체는 한 번뿐");
  assert.equal((r.html.match(/katex-display/g) || []).length, 1, "인라인 본체도 없다");
  assert.ok(r.html.includes('id="eq-F1"') && r.html.includes('class="eq-ref" href="#eq-F1"'), "목표의 참조는 식 행 앵커 링크");
  const goal = r.html.slice(r.html.indexOf('id="S1_B1"'), r.html.indexOf('id="eq-F1"'));
  assert.ok(goal.includes('href="#eq-F1"') && goal.includes(">식 1<"), "목표 문장 안에서 식 1 로 가리킨다");
});

test("식 행이 없는 {{F#}} 는 본문에 인라인으로 그린다", () => {
  const r = run(note({ registry: FIX.registry, sections: [sec({ blocks: [b05("S1_B1", "본문의 {{F1}} 참조")] })] }));
  assert.deepEqual(r.warnings, []);
  assert.ok(r.html.includes('class="katex"') && !r.html.includes("katex-display"), "B10 행이 없으면 인라인 유지");
  assert.ok(!r.html.includes("eq-F1") && !/식 \d/.test(r.html), "행이 없는 참조에는 식 번호를 붙이지 않는다");
});

test("식 행이 있는 '식 {{F#}}'는 앞 식을 뗀다 — '식 식 1' 중복 없이 '식 1' 링크 하나", () => {
  const r = run(note({
    registry: [{ id: "F1", latex: "x", text: null, status: "verified", slideId: "s", t0: 1, display: "latex" }],
    sections: [sec({ blocks: [
      b05("S1_B1", "식 {{F1}}에 따라, 인식 {{F1}}을 본다"),
      b10("S1_B2", { formulaIds: ["F1"] }),
    ] })] }));
  assert.deepEqual(r.warnings, []);
  const prose = r.html.slice(r.html.indexOf('id="S1_B1"'), r.html.indexOf('id="S1_B2"'));
  assert.ok(prose.includes('<a class="eq-ref" href="#eq-F1">식 1</a>에 따라'), "보이는 문구는 '식 1에 따라'");
  assert.ok(!/(?:^|[\s>])식\s*<a class="eq-ref"/.test(prose), "링크 앞에 독립 '식'이 남지 않는다 — '식 식 1' 없음");
  assert.ok(prose.includes('인식 <a class="eq-ref" href="#eq-F1">식 1</a>'), "'인식'의 식은 글자에 붙어 있어 남기고 같은 식으로 링크");
  assert.equal((prose.match(/href="#eq-F1"/g) || []).length, 2, "두 참조 모두 같은 앵커");
  assert.ok(r.html.includes('id="eq-F1"><span class="eq-tag">식 1</span>'), "eq-F# 앵커는 그대로");
});

test("식 행이 없는 '식 {{F#}}'는 원문 식을 남기고 인라인으로 그린다", () => {
  const r = run(note({
    registry: [{ id: "F1", latex: "x", text: null, status: "verified", slideId: "s", t0: 1, display: "latex" }],
    sections: [sec({ blocks: [b05("S1_B1", "식 {{F1}}에 따라")] })] }));
  assert.deepEqual(r.warnings, []);
  assert.ok(r.html.includes('식 <span class="katex"'), "원문 '식' 접두 유지 + 인라인 KaTeX");
  assert.ok(r.html.includes('</span>에 따라') && !r.html.includes('href="#eq-F1"'), "인라인 본체 — 식 행 링크 없음");
});

test("B10 c# 단계 참조는 그 단계의 digits 로 찍는다", () => {
  const r = run(note({ sections: [sec({ blocks: [b10("S1_B1", {
    inputs: [{ label: "합계", value: 9.4247, unit: "원", evidenceIds: [] }, { label: "개수", value: 3, unit: "개", evidenceIds: [] }],
    steps: [
      { label: "평균", op: "div", a: "i1", b: "i2", value: 3.14156, unit: "원", digits: 2 },
      { label: "배", op: "mul", a: "c1", b: "i2", value: 9.42468, unit: "원", digits: 1 },
    ] })] })] }));
  assert.ok(r.html.includes("배 = 3.14원 × 3개 = <strong>9.4원</strong>"), "c1 은 2자리로, i2 는 그대로");
});

test("B11 헷갈리기 쉬운 점: 오해·구분·조건, structural_check 는 '구분 점검'", () => {
  const html = htmlOf("B11", { misconception: cl("오해<script>"), correction: cl("구분"), conditions: [cl("조건")], origin: "structural_check" });
  assert.ok(html.includes('class="warning"') && html.includes("[구분 점검]"));
  assert.ok(html.includes("오해:") && html.includes("구분:") && html.includes("조건:"));
  assert.ok(!html.includes("<script>"));
  assert.ok(htmlOf("B11", { misconception: cl("m"), correction: cl("c"), conditions: [], origin: "lecture_correction" }).includes("[주의]"));
});

test("B12 곁설명: 앞 블록과 with-aside 로 묶이고 종류 라벨을 단다", () => {
  const r = run(note({ sections: [sec({ blocks: [b05("S1_B1", "본문"), blk("S1_B2", "B12", { kind: "hint", note: cl("곁설명<script>") })] })] }));
  assert.ok(r.html.includes('class="with-aside"') && r.html.includes('class="aside-note"') && r.html.includes("곁설명 · 힌트"));
  assert.ok(r.html.indexOf('id="S1_B1"') < r.html.indexOf('id="S1_B2"') && !r.html.includes("<script>"));
});

test("B12 곁설명은 앞 블록만 묶고 도표는 밖에 두며, 이어지는 곁설명은 같은 단에 쌓는다", () => {
  const r = run(note({ figures: [fig("G1")], sections: [sec({ blocks: [
    b10("S1_B1", { figureIds: ["G1"] }),
    blk("S1_B2", "B12", { kind: "hint", note: cl("첫 곁설명") }),
    blk("S1_B3", "B12", { kind: "hint", note: cl("둘째 곁설명") }),
  ] })] }));
  assert.equal((r.html.match(/class="with-aside"/g) || []).length, 1, "묶음은 하나 — with-aside 가 중첩되지 않는다");
  assert.equal((r.html.match(/class="aside-col"/g) || []).length, 1, "aside 단도 하나");
  const col = r.html.indexOf('class="aside-col"');
  assert.ok(col < r.html.indexOf('id="S1_B2"') && r.html.indexOf('id="S1_B2"') < r.html.indexOf('id="S1_B3"'), "두 곁설명이 같은 단에 들어간다");
  assert.ok(r.html.includes('</section></div></div><figure class="note-fig" data-fig="G1"'), "앞 블록의 도표는 묶음 밖에 둔다");
});

test("B13 연결 정리: 관계 라벨·명제·대상 링크", () => {
  const html = htmlOf("B13", { title: "정리", propositions: [
    { relation: "common", claim: cl("같은 대상<script>"), targetIds: ["S1_B1"] },
    { relation: "contrast", claim: cl("다른 초점"), targetIds: ["S1_B1"] }] });
  assert.ok(html.includes('class="synthesis"') && html.includes("<strong>공통:</strong>") && html.includes("<strong>차이:</strong>"));
  assert.ok(html.includes('href="#S1_B1"') && !html.includes("<script>"));
});

test("B14 자기 점검: 문서 전체 번호·유형·수준·전제, OX 는 작은 응답 표식", () => {
  const mk = items => note({ sections: [sec({ blocks: [b14("S1_B1", items)] })] });
  const r = run(mk([item({ prompt: cl("판단하라<script>"), premise: cl("전제 상황"), level: "advanced" }), item({ kind: "calc" })]));
  assert.ok(r.html.includes('class="question" id="q-01"') && r.html.includes("<strong>OX</strong>"));
  assert.ok(r.html.includes('<small class="qlevel">심화</small>') && r.html.includes('class="premise"'));
  assert.ok(r.html.includes('class="ox-mark"'), "OX 는 작은 응답 표식");
  assert.ok(!r.html.includes('class="answer-space"'), "기본(web) 렌더에는 큰 답란이 없다");
  assert.ok(!r.html.includes("<script>"));
  const w = run(mk([item({ kind: "calc" }), item({ kind: "argue" }), item({ kind: "recall" }), item({})]), { options: { writing: true } });
  assert.equal((w.html.match(/class="answer-space"/g) || []).length, 2, "writing 에서도 calc·argue 만 — recall·OX 는 답란 없다");
  assert.ok(w.html.includes('class="ox-mark"'), "writing 에서도 OX 는 표식만");
});

test("B18 수업 공지: 문서 머리 뒤 조판·주제·기한 그대로", () => {
  const r = run(note({ sections: [sec({ blocks: [
    blk("S1_B1", "B18", { items: [{ topic: "deadline", claim: cl("제출<script>"), due: "다음 수업 전" }] }),
    b05("S1_B2", "본문")] })] }));
  assert.ok(r.html.includes('class="notice"') && r.html.includes("<dt>기한</dt>") && r.html.includes("· 다음 수업 전"));
  assert.ok(r.html.indexOf('data-type="B18"') < r.html.indexOf('id="S1"'), "공지는 단원보다 먼저");
  assert.ok(!r.html.includes("<script>"));
});

// ── 대상 id 해석 ──
test("대상 id 는 사람 라벨+실존 앵커로만 나간다: 단원·블록·개념·Point, 죽은 id 는 뺀다", () => {
  const r = run(note({
    concepts: [
      { conceptId: "C1", name: "손익분기점", depth: "defined", homeBlockId: "S1_B1" },
      { conceptId: "C2", name: "언급 개념", depth: "mentioned", homeBlockId: null }],
    sections: [sec({ blocks: [
      b05("S1_B1", "정의"),
      blk("S1_B2", "B08", { caseTitle: "사례", source: "lecture_case", situation: cl("상황"),
        points: [{ clue: cl("단서"), reading: cl("해석") }], appliedConceptIds: [],
        judgment: { pointRefs: [1, 9], claim: cl("판단") }, limits: [], decision: null }),
      blk("S1_B3", "B13", { title: "정리", propositions: [
        { relation: "common", claim: cl("같은 대상"), targetIds: ["S1", "S1_B1", "C1", "S1_B2/P1", "S9_B9"] },
        { relation: "contrast", claim: cl("다른 초점"), targetIds: ["C2"] }] }),
    ] })] }));
  assert.deepEqual(r.warnings, []);
  assert.ok(r.html.includes('href="#S1">01 단원</a>'), "단원 id → 번호+제목");
  assert.ok(r.html.includes('href="#S1_B1">용어</a>'), "블록 id → 블록 라벨");
  assert.ok(r.html.includes('href="#S1_B1">손익분기점</a>'), "개념 id → 색인 이름 + 홈 블록 앵커");
  assert.ok(r.html.includes('href="#S1_B2-P1">Point 1</a>'), "Point 대상 → 해석 칩 앵커");
  assert.ok(r.html.includes('class="note-ref">언급 개념</span>'), "앵커 없는 개념은 이름만 둔다");
  assert.ok(!r.html.includes("S9_B9") && !/>\s*C[12]\s*</.test(r.html), "죽은 id·내부 id 원문은 나가지 않는다");
  assert.ok(!r.html.includes('href="#S1_B2-P9"') && r.html.includes(">Point 9</span>"), "범위 밖 Point 는 링크 없이 글자만");
});

test("B15 복습 위치: 살아 있는 블록만 라벨 링크로, 전부 죽었으면 줄 자체를 뺀다", () => {
  const live = run(note({ sections: [sec({ blocks: [b05("S1_B1", "정의"),
    b14("S1_B2", [item({ answer: { verdict: "O", explanation: cl("해설"), correction: null, rubric: [], alternatives: [], reviewIds: ["S1_B1", "S9_B9"] } })])] })] }));
  assert.ok(live.html.includes('href="#S1_B1">용어</a>') && !live.html.includes("S9_B9"), "죽은 복습 id 는 뺀다");
  const dead = run(note({ sections: [sec({ blocks: [
    b14("S1_B1", [item({ answer: { verdict: "O", explanation: cl("해설"), correction: null, rubric: [], alternatives: [], reviewIds: ["S9_B9"] } })])] })] }));
  assert.ok(!dead.html.includes("복습 위치"), "풀리는 대상이 하나도 없으면 줄을 숨긴다");
});

// ── mis-sol-hai 표시(기획 §4.6·§5): 새 데이터(근거 메타·필기 근거·인용/반복 강조)가 있을 때만 켠다 ──
const STRUCT = require("../tools/note-fixture/expected-structure.json");
const EXPECTED_HASH = "6d0b8c77b104c105209080b772b5dc772239cdd8bcaf153bddb9287e5eb7ef79";
const artOf = r => r.html.replace(/^<style>[\s\S]*?<\/style>/, "");
const structure = html => {
  const m = html.matchAll(/<(header|section|aside|figure|div|details)[^>]*class="(note-head|unit-head|note-block|with-aside|aside-col|note-fig|note-checklist|note-check|note-sec|note-answers|question|answer|memo)[^"]*"([^>]*)>/g);
  const out = [];
  for (const x of m) {
    const cls = x[2], rest = x[3] || "";
    if (cls === "note-block") out.push("block:" + (/data-type="([^"]+)"/.exec(rest)?.[1] || "?"));
    else if (cls === "note-fig") out.push("fig:" + (/data-fig="([^"]+)"/.exec(rest)?.[1] || "?"));
    else if (cls === "note-sec") out.push("sec:" + (/id="([^"]+)"/.exec(rest)?.[1] || "?"));
    else out.push(cls);
  }
  return out;
};
const SRCS = [
  { id: "U1.s1", kind: "slide", t0: 0, t1: 10, slideId: "s1" },
  { id: "U1.t1", kind: "speech", t0: 0, t1: 10, slideId: null },
  { id: "U1.s9", kind: "handwriting", t0: 5, t1: 10, slideId: "s1" },
  { id: "U2.t1", kind: "speech", t0: 60, t1: 70, slideId: null },
];
const mNote = (over = {}) => note({
  evidenceMeta: { U1: { source: "slide", ink: false, emphasis: 0.9 }, U2: { source: "speech", ink: true, emphasis: 0.1 } },
  sources: SRCS, ...over,
});
const b05x = (id, over = {}, emphasis = []) => ({ ...blk(id, "B05", {
  conceptId: "C1", term: "용어", original: null,
  definition: cl("정의 문장"), explanation: null, mechanism: null, scope: [], examples: [], ...over,
}), emphasis });

test("골든 노트 구조 스냅샷 — 블록 순서·클래스 구조가 고정이다(§5 레이아웃 고정)", () => {
  const art = artOf(run(deep(FIX)));
  assert.deepEqual(structure(art), STRUCT);
  assert.ok(!art.includes("mk-"), "새 데이터가 없는 골든 노트는 기존 렌더와 같다 — 표시가 켜지지 않는다");
});

test("새 데이터가 없으면 표시를 켜지 않는다: 기존 강조·인과 블록도 그대로", () => {
  const r = run(note({ sections: [sec({ blocks: [
    { ...b05x("S1_B1"), emphasis: [{ kind: "exam", evidenceIds: ["U1.t1"] }] },
    blk("S1_B2", "B07", { title: "인과", relationType: "causal", question: null, missingLinks: [],
      steps: [{ role: "premise", claim: cl("전제") }, { role: "result", claim: cl("결과") }] }),
  ] })] }));
  const art = artOf(r);
  assert.ok(!art.includes("mk-") && !art.includes("슬라이드에 없는 설명"), "사이드카·새 필드 없음 = 렌더 동일");
  assert.ok(art.includes('class="chain"'), "인과 사슬도 기존 양식");
});

test("1B 강조·2B 필기·3B 슬라이드에 없는 설명 — 근거 메타·필기 근거·B12 kind 로 켠다", () => {
  const n = mNote({ sections: [sec({ blocks: [
    b05x("S1_B1", {
      definition: cl("강조 정의", "lecture", ["U1.s1"]),
      explanation: cl("필기 설명", "lecture", ["U1.s9"]),
      scope: [cl("유닛 필기", "lecture", ["U2.t1"])],
    }),
    blk("S1_B2", "B12", { kind: "slide_absent", note: cl("말로만 한 내용", "lecture", ["U1.t1"]) }),
  ] })] });
  const on = artOf(run(n, { options: { emphasisMin: 0.8 } }));
  assert.ok(on.includes('<strong class="mk-1B">강조 정의</strong>'), "근거 메타 임계 이상인 주장은 강조 표시");
  assert.ok(on.includes('class="mk-2B"><svg class="mk-pen"'), "handwriting 근거 인용 주장은 필기 표시");
  assert.ok(on.match(/mk-2B[\s\S]*?유닛 필기/), "근거 메타 ink 도 필기 표시");
  assert.ok(on.includes('aside-note mk-3B') && on.includes('mk-mic') && on.includes("슬라이드에 없는 설명"), "3B 라벨 정확");
  const off = artOf(run(deep(n)));
  assert.ok(!off.includes("mk-1B"), "강조 임계는 옵션 — 기본은 끔");
  assert.ok(off.includes("mk-2B") && off.includes("mk-3B"), "필기·슬라이드 없는 설명은 옵션과 무관");
});

test("1B 강조는 블록 stress 근거와 겹친 주장에도 붙는다(임계 옵션 없이)", () => {
  const r = artOf(run(mNote({ sections: [sec({ blocks: [
    b05x("S1_B1", { definition: cl("강조 본문", "lecture", ["U1.t1"]) }, [{ kind: "stress", evidenceIds: ["U1.t1"] }]),
  ] })] })));
  assert.ok(r.includes('<strong class="mk-1B">강조 본문</strong>'));
});

test("시험 배지·반복 ×N·교수 강조 인용 — 블록당 1개, 단원 상한을 코드로 강제", () => {
  const em = q => [{ kind: "exam", evidenceIds: ["U1.t1"] }, { kind: "stress", evidenceIds: ["U1.t1"], quote: q, repeat: 3 }];
  const art = artOf(run(mNote({ sections: [sec({ blocks: [
    b05x("S1_B1", {}, em("꼭 기억하세요")),
    b05x("S1_B2", {}, em("두 번째 인용")),
    b05x("S1_B3", {}, em("세 번째 인용")),
  ] })] })));
  assert.equal((art.match(/class="mk-exam"/g) || []).length, 2, "시험 배지는 단원당 2개 이하");
  assert.equal((art.match(/class="mk-rep"/g) || []).length, 2, "반복 칩도 단원당 2개 이하");
  assert.equal((art.match(/mk-rep">×3</g) || []).length, 2, "repeat 수치를 그대로 표시");
  assert.equal((art.match(/class="mk-quote"/g) || []).length, 1, "교수 인용은 단원당 1개");
  assert.ok(art.includes("“꼭 기억하세요”") && !art.includes("두 번째 인용"));
  // repeat 없으면 인용 발화 근거 수로 센다 — 2건 미만이면 칩 없음
  const art2 = artOf(run(mNote({ sections: [sec({ blocks: [
    b05x("S1_B1", {}, [{ kind: "stress", evidenceIds: ["U1.t1", "U2.t1", "U1.s1"] }]),
    b05x("S1_B2", {}, [{ kind: "stress", evidenceIds: ["U1.t1", "U1.s9"] }]),
  ] })] })));
  assert.ok(art2.includes('mk-rep">×2') && (art2.match(/mk-rep/g) || []).length === 1, "발화 2건은 ×2, 1건은 표시 없음");
});

test("핵심 용어 첫 등장 굵게·조건 마커 — 문서 1회·단원 3개 상한, 굵은 표시는 주장당 하나", () => {
  const art = artOf(run(mNote({
    concepts: [{ conceptId: "C1", name: "사회적 책임", depth: "defined", homeBlockId: "S1_B1" }],
    sections: [sec({ blocks: [
      b05x("S1_B1", { definition: cl("사회적 책임의 정의"), explanation: cl("사회적 책임은 두 번 나온다"),
        scope: [cl("단, 첫째 조건"), cl("다만 둘째 조건"), cl("예외 셋째"), cl("단, 넷째")] }),
      b05x("S1_B2", { explanation: cl("사회적 책임 재등장") }),
    ] })],
  })));
  assert.equal((art.match(/mk-term/g) || []).length, 1, "정의된 용어는 문서 전체 첫 등장만 굵게");
  assert.equal((art.match(/mk-cond/g) || []).length, 3, "조건·예외 마커는 단원당 3개 이하");
  assert.ok(art.includes('mk-cond">예외') && art.includes('mk-cond">조건'));
  // 1B 가 붙은 주장에는 mk-term 을 달지 않는다
  const a2 = artOf(run(mNote({
    concepts: [{ conceptId: "C1", name: "사회적 책임", depth: "defined", homeBlockId: null }],
    sections: [sec({ blocks: [
      b05x("S1_B1", { definition: cl("사회적 책임은 시작", "lecture", ["U1.t1"]) }, [{ kind: "stress", evidenceIds: ["U1.t1"] }]),
    ] })],
  })));
  assert.ok(a2.includes("mk-1B") && !a2.includes("mk-term"), "1B > 용어 굵게 — 굵은 표시 하나만");
});

test("인과 흐름 인라인·대비 쌍 칩 — 데이터가 맞을 때만", () => {
  const b7 = (id, steps, missingLinks = []) => blk(id, "B07", { title: "인과", relationType: "causal", question: null,
    steps: steps.map((t, i) => ({ role: i ? "result" : "premise", claim: cl(t) })), missingLinks });
  const art = artOf(run(mNote({ sections: [sec({ blocks: [
    b05x("S1_B1"),
    b7("S1_B2", ["원인", "결과 하나", "결과 둘"], [cl("빠진 추론")]),
    blk("S1_B3", "B06", { title: "비교", entities: [{ label: "A" }, { label: "B" }],
      criteria: [{ label: "기준", cells: [cl("x"), cl("y")] }], common: [], discriminator: null }),
  ] })] })));
  assert.ok(art.includes('class="mk-flow"') && art.includes('mk-arrow">→') && art.includes("<small>전제</small>"), "causal 4단계 이하는 한 줄 흐름");
  assert.ok(art.includes("연결 설명 없음"), "빠진 추론은 흐름 아래에도 남긴다");
  assert.ok(art.includes('class="mk-pair"') && art.includes("↔") && art.includes('mk-chip-e">A'), "대상 둘은 대비 쌍");
  const a5 = artOf(run(mNote({ sections: [sec({ blocks: [b7("S1_B1", ["1", "2", "3", "4", "5"])] })] })));
  assert.ok(!a5.includes("mk-flow") && a5.includes('class="chain"'), "5단계면 기존 사슬 유지");
  const a3 = artOf(run(mNote({ sections: [sec({ blocks: [
    blk("S1_B1", "B06", { title: "비교", entities: [{ label: "A" }, { label: "B" }, { label: "C" }],
      criteria: [{ label: "기준", cells: [cl("x"), cl("y"), cl("z")] }], common: [], discriminator: null }),
  ] })] })));
  assert.ok(!a3.includes("mk-pair"), "대상 셋은 칩 없음");
});

test("표시 데이터의 문자열도 이스케이프된다 — 인용·개념명에 마크업 주입 불가", () => {
  const r = run(mNote({
    concepts: [{ conceptId: "C1", name: "위험<script>", depth: "defined", homeBlockId: null }],
    sections: [sec({ blocks: [
      b05x("S1_B1", { definition: cl("위험<script> 용어 본문") },
        [{ kind: "stress", evidenceIds: ["U1.t1"], quote: "<img src=x onerror=1>" }]),
    ] })],
  }));
  assert.ok(!/<script>|<img src=x/i.test(r.html));
  assert.ok(r.html.includes("&lt;script&gt;") && r.html.includes("&lt;img src=x onerror=1&gt;"));
  // 슬롯 라벨은 나가지 않지만 표시(X7 인용)는 나간다
  assert.ok(r.html.includes("mk-quote"));
});


test("표시 치환은 함수형 — 인용·라벨 속 $ 패턴이 매치 문자열로 확장되지 않는다", () => {
  const r = artOf(run(mNote({ sections: [sec({ blocks: [
    b05x("S1_B1", {}, [{ kind: "stress", evidenceIds: ["U1.t1"], quote: "값은 $& 이다" }]),
    blk("S1_B2", "B06", { title: "비교", entities: [{ label: "A$&" }, { label: "B" }],
      criteria: [{ label: "기준", cells: [cl("x"), cl("y")] }], common: [], discriminator: null }),
  ] })] })));
  assert.ok(r.includes("값은 $&amp; 이다"), "인용 속 $& 가 </h3> 등 매치로 확장되지 않는다");
  assert.ok(r.includes("A$&amp;"), "대상 라벨 속 $& 도 그대로");
});

test("골든 노트 렌더 해시 고정 — 기존 노트 출력이 결정적이다(슬롯 라벨 숨김 반영)", () => {
  const html = run(deep(FIX)).html;
  assert.equal(require("node:crypto").createHash("sha256").update(html).digest("hex"), EXPECTED_HASH);
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

test("같은 섹션의 두 B05 가 같은 슬롯 문장을 실으면 뒤 블록에서는 빼고, 다른 섹션에는 그대로 싣는다(실행 mis-sol-hai-23)", () => {
  const dup = "최소점 위치와 오차 수준은 구분해 읽는다.";
  const a = b05("S1_B1", "정의 A"), b = b05("S1_B2", "정의 B"), c = b05("S2_B1", "정의 C");
  a.content.scope = [cl(dup)]; b.content.scope = [cl(dup), cl("다른 범위")]; c.content.scope = [cl(dup)];
  const r = run(note({ sections: [sec({ blocks: [a, b] }), sec({ sectionId: "S2", number: 2, title: "둘째", blocks: [c] })] }));
  assert.equal(r.html.split(dup).length - 1, 2, "섹션당 한 번");
  assert.ok(r.html.includes("다른 범위"));
});

test("B05 정의는 명사형으로 끝내고, 이미 '원어(번역)' 꼴인 이름은 그대로 쓴다", () => {
  const html = htmlOf("B05", { conceptId: "C1", term: "k-Fold Cross-Validation(k겹 교차검증)", original: "k-fold", definition: cl("폴드별 오차를 평균하는 방법이다."),
    explanation: null, mechanism: null, scope: [], examples: [] });
  assert.ok(html.includes("<h3>k-Fold Cross-Validation(k겹 교차검증)</h3>"));
  assert.ok(html.includes("폴드별 오차를 평균하는 방법.<") && !html.includes("방법이다."));
  assert.ok(!html.includes('<ul class="concept-points"'), "상세가 없으면 목록도 없다");
});

test("도표 자리: 작성자 해설의 블록(B05)이면 정의와 상세 사이, 같은 슬라이드 좌우 도표는 한 줄, 해설은 그림 주석", () => {
  const a = b05x("S1_B1", { definition: cl("정의 문장", "lecture", ["U1.s1"]), scope: [cl("상세 문장")] });
  const figs = [
    fig("G1", { display: "crop", kind: "chart", evidenceId: "U1.g1", slideId: "s1", bbox: { x: 0.05, y: 0.3, w: 0.4, h: 0.4 }, blockId: "S1_B1", explanation: cl("왼쪽은 훈련 오차가 계속 줄어드는 그래프다") }),
    fig("G2", { display: "crop", kind: "chart", evidenceId: "U1.g2", slideId: "s1", bbox: { x: 0.55, y: 0.32, w: 0.4, h: 0.4 } }),
  ];
  const r = run(note({ sections: [sec({ blocks: [a] })], figures: figs }), { crops: { G1: PNG, G2: PNG } });
  const art = artOf(r);
  const iDef = art.indexOf("정의 문장"), iFig = art.indexOf('data-fig="G1"'), iPt = art.indexOf("상세 문장");
  assert.ok(iDef < iFig && iFig < iPt, "정의 → 도표 → 상세");
  assert.match(art, /<div class="fig-row"><div class="fig-cell"><figure class="note-fig" data-fig="G1">[\s\S]*?<div class="fig-cell"><figure class="note-fig" data-fig="G2">/, "같은 줄 G1·G2");
  assert.ok(art.includes('<figcaption class="note-fig-explanation">') && art.includes("왼쪽은 훈련 오차가 계속 줄어드는 그래프다"));
  assert.equal(art.split('data-fig="G2"').length - 1, 1, "G2 는 같은 유닛 근거를 인용한 개념에 한 번만");
});

test("수식 자리: 작성자 해설의 블록(B05)이면 상세 끝에 식+해설, B10 행은 앞 소개 링크, 같은 식은 한 번만", () => {
  const a = b05x("S1_B1", { definition: cl("정의 문장", "lecture", ["U1.s1"]), scope: [cl("상세 문장")] });
  const reg = [
    { id: "F1", latex: "y = 2x", text: "y = 2x", status: "verified", slideId: "s1", t0: 5, display: "latex",
      blockId: "S1_B1", explanation: cl("이 식은 기간별 잔액을 계산한다", "lecture", ["U1.s1"]) },
  ];
  const r = run(note({ registry: reg, sections: [sec({ blocks: [a, b10("S1_B2", { formulaIds: ["F1"] })] })] }));
  const art = artOf(r);
  const iHead = art.indexOf('<section class="concept">'), iDef = art.indexOf("정의 문장"), iPt = art.indexOf("상세 문장"), iEq = art.indexOf('id="eq-F1"'), iCap = art.indexOf("이 식은 기간별 잔액을 계산한다");
  assert.ok(iHead < iDef && iDef < iPt && iPt < iEq && iEq < iCap, "개념 머리 → 정의 → 상세 → 수식 → 수식 해설");
  assert.equal((art.match(/id="eq-F1"/g) || []).length, 1, "수식은 한 번만 그린다");
  assert.ok(art.includes('class="eq-tag">식 1<'), "B10 번호 규칙은 그대로");
  assert.ok(art.includes("앞에서 소개한 식"), "B10 행은 본체 대신 소개 링크");
});

test("수식 자리: 홈이 그 식을 다루는 B10 이면 그 안의 식 행에 해설이 붙고, 없던 식은 블록 뒤에 둔다", () => {
  const reg = [
    { id: "F1", latex: "y = 2x", text: "y = 2x", status: "verified", slideId: "s1", t0: 5, display: "latex",
      blockId: "S1_B1", explanation: cl("F1 해설") },
    { id: "F2", latex: "z = 3w", text: "z = 3w", status: "verified", slideId: "s1", t0: 6, display: "latex",
      blockId: "S1_B2", explanation: cl("F2 해설") },
  ];
  const r = run(note({ registry: reg, sections: [sec({ blocks: [
    b10("S1_B1", { formulaIds: ["F1"] }),
    blk("S1_B2", "B11", { misconception: cl("오해"), correction: cl("구분"), conditions: [], origin: "lecture_correction" }),
  ] })] }));
  const art = artOf(r);
  assert.equal((art.match(/class="equation"/g) || []).length, 2, "둘 다 한 번씩");
  const iB10 = art.indexOf('id="S1_B1"'), iEq1 = art.indexOf('id="eq-F1"'), iB11 = art.indexOf('id="S1_B2"'), iEq2 = art.indexOf('id="eq-F2"');
  assert.ok(iB10 < iEq1 && iEq1 < iB11 && iB11 < iEq2, "F1 은 B10 안, F2 는 B11 뒤");
  assert.ok(art.includes("F1 해설") && art.includes("F2 해설"), "해설은 식마다 붙는다");
});

// ── 수식 latex 입구 보정 (mis-sol-hai-28: raw % 가 주석으로 뒤를 지워 "PB(33.64" 로 잘림) ──
const freg = (id, latex, over = {}) => ({ id, latex, text: "", status: "verified", slideId: "s1", t0: 5, display: "latex", ...over });
const want = (s, display = true) => katex.renderToString(s, { throwOnError: true, displayMode: display });

test("수식 latex: bare % 는 \\% 로, 환경 밖 bare &·# 도 이스케이프해 그린다 — % 는 KaTeX 주석이라 뒤가 잘린다", () => {
  const registry = [
    freg("F1", "PB(i,25%)_2=A_0"),                    // raw % — 잘리는 사례 그대로
    freg("F2", "PB(33.64\\%)_3=A_0"),                 // 이미 이스케이프된 \% — 이중 처리 금지
    freg("F3", "a & b"),                              // 환경 밖 bare & — 파싱 오류 대신 앰퍼샌드
    freg("F4", "R #1"),                               // 환경 밖 bare #
    freg("F5", "\\begin{aligned}x&=y\\end{aligned}"), // 정렬 환경의 & 는 열 구분자 — 그대로
  ];
  const r = run(note({ registry, sections: [sec({ blocks: [b10("S1_B1", { formulaIds: ["F1", "F2", "F3", "F4", "F5"] })] })] }));
  const art = artOf(r);
  assert.ok(art.includes(want("PB(i,25\\%)_2=A_0")), "raw % → \\% — =A_0 뒤가 잘리지 않는다");
  assert.ok(!art.includes(want("PB(i,25%)_2=A_0")), "잘린 형태(…25 끝)는 나가지 않는다");
  assert.ok(art.includes(want("PB(33.64\\%)_3=A_0")) && !art.includes(want("PB(33.64\\\\%)_3=A_0")), "\\% 는 한 번만 — 이중 이스케이프 없음");
  assert.ok(art.includes(want("a \\& b")), "bare & → \\&");
  assert.ok(art.includes(want("R \\#1")), "bare # → \\#");
  assert.ok(art.includes(want("\\begin{aligned}x&=y\\end{aligned}")), "aligned 안의 & 는 그대로");
  assert.deepEqual(codes(r), [], "보정 뒤 렌더 경고 없음");
});

test("수식 latex: 본문 {{F#}} 인라인 참조와 derived 도 같은 보정을 탄다", () => {
  const n = note({
    registry: [freg("F1", "PB(i,25%)_2=A_0")],
    sections: [sec({ blocks: [
      b05("S1_B1", "비율은 {{F1}} 이다"),
      b10("S1_B2", { derived: ["r = 5%\\cdot n"] }),
    ] })],
  });
  const r = run(n);
  assert.ok(r.html.includes(want("PB(i,25\\%)_2=A_0", false)), "인라인도 % 보정");
  assert.ok(r.html.includes(want("r = 5\\%\\cdot n")), "B10 derived 도 % 보정");
  assert.deepEqual(codes(r), []);
});

test("수식 해설: 같은 해설 문장이 이어지는 식 묶음은 마지막 식에 한 번만 단다(mis-sol-hai-28 ※ 4연속)", () => {
  const fx = (id, t) => freg(id, `x_{${id.slice(1)}}=0`, { explanation: cl(t, "lecture", ["U1.s1"]), blockId: "S1_B1" });
  const registry = [fx("F1", "같은 해설"), fx("F2", "같은 해설"), fx("F3", "같은 해설"), fx("F4", "다른 해설")];
  const r = run(note({ registry, sections: [sec({ blocks: [b10("S1_B1", { formulaIds: ["F1", "F2", "F3", "F4"] })] })] }));
  const art = artOf(r);
  assert.equal((art.match(/class="eq-caption"/g) || []).length, 2, "같은 해설은 한 번 — 다른 해설은 따로");
  const i3 = art.indexOf('id="eq-F3"'), i4 = art.indexOf('id="eq-F4"'), iCap = art.indexOf("같은 해설");
  assert.ok(i3 < iCap && iCap < i4, "묶음 해설은 같은 묶음 마지막 식(F3) 아래 한 번");
});

// ── 긴 수식 가로 넘침 처리(mis-sol-hai-28: eq-F9/eq-F10 OVERFLOW_X — 한 줄 display 식이 쪽 폭 686px 초과) ──
const LONG_SUM = "PB(i,25%)_2=A_0(1+i)^2+(R_1-E_1)(1+i)^{2-1}+(R_2-E_2)(1+i)^{2-2}+\\cdots+(R_n-E_n)(1+i)^{2-n}+S_2";

test("긴 display 수식: 쪽 폭을 넘는 한 줄 식은 최상위 연산자에서 gathered 여러 줄로 나눈다", () => {
  const r = run(note({ registry: [freg("F1", LONG_SUM)],
    sections: [sec({ blocks: [b10("S1_B1", { formulaIds: ["F1"] })] })] }));
  const art = artOf(r);
  assert.deepEqual(codes(r), []);
  assert.ok(!art.includes(want("PB(i,25\\%)_2=A_0(1+i)^2+(R_1-E_1)(1+i)^{2-1}+(R_2-E_2)(1+i)^{2-2}+\\cdots+(R_n-E_n)(1+i)^{2-n}+S_2")),
    "쪽 폭을 넘는 한 줄 렌더는 나가지 않는다");
  assert.ok(art.includes(want("\\begin{gathered}PB(i,25\\%)_2=A_0(1+i)^2+(R_1-E_1)(1+i)^{2-1}+(R_2-E_2)(1+i)^{2-2}+\\cdots\\\\+(R_n-E_n)(1+i)^{2-n}+S_2\\end{gathered}")),
    "관계(=)·꼬리 뒤와 이항(+) 앞에서 끊은 gathered 행렬로 그린다");
  assert.ok(art.includes('id="eq-F1"><span class="eq-tag">식 1</span>'), "앵커·식 번호는 그대로");
});

test("긴 display 수식: 끊을 최상위 연산자가 없는 긴 식은 단계 축소 클래스를 단다", () => {
  const frac = "\\frac{A_0(1+i)^2+(R_1-E_1)(1+i)^{2-1}+(R_2-E_2)(1+i)^{2-2}+S_2}{B_0(1+j)^2+(T_1-U_1)(1+j)^{2-1}+(T_2-U_2)(1+j)^{2-2}}";
  const r = run(note({ registry: [freg("F1", frac)],
    sections: [sec({ blocks: [b10("S1_B1", { formulaIds: ["F1"] })] })] }));
  const art = artOf(r);
  assert.match(art, /class="eq-shrink eq-shrink-[789]0"><span class="katex-display">/, "축소 래퍼가 KaTeX 디스플레이를 감싼다");
  assert.ok(art.includes(want(frac)), "식 본체는 원문 그대로 — 분모·분자 안 연산자는 끊지 않는다");
});

test("긴 수식: 본문 인라인 {{F#}} 도 넘치면 축소한다 — gathered 분할은 display 전용", () => {
  const r = run(note({ registry: [freg("F1", LONG_SUM)],
    sections: [sec({ blocks: [b05("S1_B1", "본문의 {{F1}} 참조")] })] }));
  const art = artOf(r);
  assert.match(art, /class="eq-shrink eq-shrink-[789]0"><span class="katex"/, "인라인은 축소 래퍼");
  assert.ok(art.includes(want("PB(i,25\\%)_2=A_0(1+i)^2+(R_1-E_1)(1+i)^{2-1}+(R_2-E_2)(1+i)^{2-2}+\\cdots+(R_n-E_n)(1+i)^{2-n}+S_2", false)),
    "인라인 본체는 원문 식 그대로");
});

test("긴 display 수식: 이미 \\begin{…} 환경인 식은 다시 나누지 않고, 짧은 식은 그대로다", () => {
  const aligned = "\\begin{aligned}PB(i,25\\%)_2&=A_0(1+i)^2+(R_1-E_1)(1+i)^{2-1}\\\\&=A_0(1+i)^2+(R_2-E_2)(1+i)^{2-2}+(R_3-E_3)(1+i)^{2-3}+S_2\\end{aligned}";
  const r = run(note({ registry: [freg("F1", aligned), freg("F2", "y = 2x")],
    sections: [sec({ blocks: [b10("S1_B1", { formulaIds: ["F1", "F2"] })] })] }));
  const art = artOf(r);
  assert.ok(art.includes(want(aligned)), "aligned 원문 그대로 — gathered 재포장 없음");
  assert.ok(!art.includes("gathered"), "환경 안 식을 두 번 싸지 않는다");
  assert.ok(art.includes(want("y = 2x")), "짧은 식은 변형 없이 그대로");
});

test("B02 첫 쪽: 질문 뿌리와 결론 가지(번호)로 그린다", () => {
  const html = htmlOf("B02", { question: cl("핵심 질문"), mode: "conclusions",
    items: [{ claim: cl("결론 하나"), reason: null, targetIds: [] }, { claim: cl("결론 둘"), reason: cl("이유"), targetIds: [] }] });
  assert.ok(html.includes('data-view="mindmap"') && html.includes('<div class="mm-root"><h3>'));
  assert.equal((html.match(/class="mm-branch"/g) || []).length, 2);
  assert.ok(html.includes('<span class="mm-no">02</span>'));
});
