const test = require("node:test");
const assert = require("node:assert/strict");
const NC = require("./note-contract.js");
const NoteSpec = require("./note-spec.js");

test("NoteSpec 은 표현 슬롯만 내보낸다: 버전·템플릿·문서 순서·고지 문구·CSS", () => {
  assert.deepEqual(Object.keys(NoteSpec).sort(), ["NOTE_SPEC_VERSION", "RENDER_VERSION", "css", "layout", "notice", "templates"]);
  assert.equal(NoteSpec.NOTE_SPEC_VERSION, NC.NOTE_SPEC_VERSION, "계약 버전과 같다(직접 값이 아님)");
  assert.equal(NoteSpec.RENDER_VERSION, "render-6");
  assert.equal(globalThis.NoteSpec, NoteSpec, "UMD 전역 노출");
  // 모델이 쓰는 전 타입 + 코드 투영 블록에 템플릿이 있다
  for (const t of [...NC.WRITER_TYPES, "B01", "B04", "B15", "B16", "B17"])
    assert.equal(typeof NoteSpec.templates[t], "function", t + " 템플릿");
  assert.throws(() => { "use strict"; NoteSpec.templates.B99 = () => ""; }, TypeError, "슬롯 동결");
  assert.throws(() => { "use strict"; NoteSpec.css = ""; }, TypeError);
});

test("notice: 코드·건수·구간만으로 문구를 만들고 ids 는 쓰지 않는다", () => {
  const n = (code, extra = {}) => NoteSpec.notice({ code, ...extra });
  assert.equal(n("NOTE_CAPTURE_GAP", { count: 3 }), "인식하지 못한 구간 3곳");
  assert.equal(n("NOTE_CAPTURE_GAP"), "인식하지 못한 구간 1곳", "count 없으면 1");
  assert.equal(n("NOTE_SECTIONS_FAILED", { count: 2 }), "요약하지 못한 단원 2개");
  assert.equal(n("NOTE_BLOCKS_DROPPED", { count: 4 }), "검증을 통과하지 못해 뺀 내용 4건");
  assert.equal(n("NOTE_UNITS_UNCITED", { count: 2 }), "노트에 반영되지 않은 강의 구간 2곳");
  assert.equal(n("NOTE_GLOBAL_FAILED"), "강의 전체 요약을 만들지 못했습니다");
  assert.equal(n("NOTE_JUDGE_SKIPPED"), "중요도 판정 없이 만들었습니다");
  assert.equal(n("NOTE_ITEMS_PRUNED", { count: 2 }), "연결된 내용이 빠져 함께 뺀 항목 2건");
  assert.equal(n("NOTE_FORMULAS_IMAGE", { count: 1 }), "기타 고지: NOTE_FORMULAS_IMAGE×1", "문구가 없다 — 노트 화면은 HIDDEN 으로 아예 띄우지 않는다");
  assert.equal(n("NOTE_FORMULAS_CHECK", { count: 2 }), "확인이 필요한 수식 2개");
  assert.equal(n("NOTE_FORMULAS_UNVERIFIED", { count: 2 }), "확인이 필요한 수식 2개");
  assert.equal(n("NOTE_FIGURES_CHECK", { count: 1 }), "확인이 필요한 도표 1개");
  assert.equal(n("NOTE_FIGURES_NOT_DETECTED"), "도표는 찾지 않았습니다(Free)");
  assert.equal(n("NOTE_AUGMENTED"), "가상 사례·강의 밖 보강이 포함된 노트입니다");
  assert.equal(n("NOTE_CLAIMS_UNSUPPORTED", { count: 14 }), "강의 근거가 부족해 보류한 내용 14건");
  assert.equal(n("NOTE_WHATEVER", { count: 2 }), "기타 고지: NOTE_WHATEVER×2", "모르는 코드 폴백");
  // 구간: 한 시간 미만 m:ss, 이상 h:mm:ss, 처음 3개, 나머지는 "외 k곳"
  assert.equal(n("NOTE_CAPTURE_GAP", { count: 2, ranges: [{ t0: 725, t1: 820 }, { t0: 3730, t1: 3780 }] }),
    "인식하지 못한 구간 2곳 (12:05–13:40, 1:02:10–1:03:00)");
  assert.equal(n("NOTE_BLOCKS_DROPPED", { count: 5, ranges: [{ t0: 1, t1: 2 }, { t0: 3, t1: 4 }, { t0: 5, t1: 6 }, { t0: 7, t1: 8 }] }),
    "검증을 통과하지 못해 뺀 내용 5건 (0:01–0:02, 0:03–0:04, 0:05–0:06 외 1곳)");
  const out = n("NOTE_BLOCKS_DROPPED", { count: 1, ids: ["S3_B4"], ranges: [{ t0: 1, t1: 2 }] });
  assert.ok(!out.includes("S3_B4"), "id 는 문구에 싣지 않는다");
});

test("css: v3 토큰, 인쇄 규칙, 좁은 화면 표 규칙이 들어 있고 구형 색·내용 클리핑이 없다", () => {
  const c = NoteSpec.css;
  for (const t of ["--canvas:#F7F7F4", "--accent:#FF5600", "--accentText:#A63700", "--surfaceSubtle:#F0F0ED",
    "@page{size:A4;margin:14.3mm}", "break-after:avoid", ".concept h3,.note .aside-note,.note .answer-compact{break-inside:avoid",
    ".material-inner,.note .case-box,.note .equation{break-inside:avoid",
    ".role{display:block;width:max-content}", "orphans:2", "table-header-group",
    "data-label", "max-width:520px", "break-before:page", "font-size:16px", ".concept .definition{font-size:16px}",
    ".chain{list-style:none", ".map-flow", "eq-ref", "ox-mark", ".memo-row", 'counter(concept',
    'th[scope="row"]', ".aside-note{display:block"]) assert.ok(c.includes(t), t);
  assert.ok(!c.includes('[data-type="B05"],.note .question'), "긴 개념 블록을 통째로 묶지 않는다 — 의미 단위로 나눈다");
  assert.ok(!c.includes("break-before:avoid"), "note-sys 가 앞 답 꼬리를 끌지 않는다(QA)");
  assert.ok(!/with-aside\s*\{[^}]*break-inside/.test(c), "일반 with-aside·단원은 통째로 묶지 않고 개념·곁설명 조합만 묶는다");
  assert.ok(!c.includes("--teal") && !c.includes("--plum"), "구형 색 금지");
  assert.ok(!/overflow\s*:\s*hidden/.test(c), "내용 클리핑 금지(§15)");
  assert.ok(!/text-overflow|ellipsis/.test(c), "말줄임 금지(§15)");
});

test("layout·templates 는 도우미만으로 문자열을 만든다", () => {
  const h = {
    esc: String, rich: String, claim: c => c && c.text || "", math: String, formula: String, equation: String, figure: () => "",
    crop: () => "", block: b => `<w data-type="${b.type}">${NoteSpec.templates[b.type](b, h)}</w>`,
    notice: n => NoteSpec.notice(n, h), time: (t0, t1) => `${t0}-${t1}`, qno: () => 1, opts: { medium: "web", answers: "end" }, note: {},
  };
  h.note = { sections: [{ sectionId: "S1", number: 1, title: "t", stage: "understand", range: { t0: 0, t1: 9 }, blocks: [{ id: "S1_B1", type: "B05", content: { term: "t", definition: { text: "d", evidenceIds: [], basis: "lecture" } } }] }] };
  const html = NoteSpec.layout(h.note, h);
  assert.ok(typeof html === "string" && html.includes('data-type="B05"'));
});

// 레이아웃 시험용 도우미 — 엔진(h)을 흉내내고 모델 내용은 그대로 둔다.
const stubH = extra => ({
  esc: String, rich: String, claim: c => (c && c.text) || "", math: String, formula: String,
  equation: String, figure: () => "", crop: () => "", block: () => "",
  notice: n => NoteSpec.notice(n), time: (t0, t1) => `${t0}-${t1}`, qno: () => 1,
  opts: { medium: "web", answers: "end" }, note: {}, ...extra,
});
const b05 = id => ({ id, type: "B05", content: { term: "t", definition: { text: "d", evidenceIds: [], basis: "lecture" } } });
const sec1 = blocks => ({ sectionId: "S1", number: 1, title: "단원", stage: "understand", range: { t0: 0, t1: 9 }, blocks });

test("layout: 검증에서 뺀 내용은 단원 안에 알리지 않는다", () => {
  const h = stubH(); h.block = b => `<w data-type="${b.type}">${NoteSpec.templates[b.type](b, h)}</w>`;
  h.note = { sections: [sec1([b05("S1_B1")])], dropped: [{ blockId: "S1_B3", type: "B05", codes: ["VAL_A"] }] };
  const html = NoteSpec.layout(h.note, h);
  assert.ok(!html.includes("note-dropped") && !html.includes("뺀 내용") && !html.includes("VAL_A"));
});

test("layout: B10 은 formulaIds·figureIds 를 엔진 도우미로 넘기고 그 출력을 그대로 싣는다", () => {
  const eq = [], figs = [];
  const h = stubH({
    equation: id => (eq.push(id), `<div class="equation">${id}</div>`),
    figure: id => (figs.push(id), `<figure>${id}</figure>`),
  });
  h.block = b => `<w data-type="${b.type}">${NoteSpec.templates[b.type](b, h)}</w>`;
  h.note = { sections: [sec1([
    { id: "S1_B1", type: "B10", content: { title: "식", kind: "formula", formulaIds: ["F1", "F2", "F1"], figureIds: ["G3"] } },
  ])] };
  const html = NoteSpec.layout(h.note, h);
  assert.deepEqual(eq, ["F1", "F2", "F1"], "formulaIds 를 문서 순서 그대로 넘긴다 — 번호·중복 제거는 엔진(note-render)이 한다");
  assert.deepEqual(figs, ["G3"], "figureIds 는 블록 뒤에 배치");
  assert.ok(html.includes('<div class="equation">F1</div>'), "슬롯은 엔진 출력을 다시 쓰지 않는다(식 N 라벨은 엔진이 만든다)");
});
