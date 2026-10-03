const test = require("node:test");
const assert = require("node:assert/strict");
const NC = require("./note-contract.js");
const NoteSpec = require("./note-spec.js");

test("NoteSpec 은 표현 슬롯만 내보낸다: 버전·템플릿·문서 순서·고지 문구·CSS", () => {
  assert.deepEqual(Object.keys(NoteSpec).sort(), ["NOTE_SPEC_VERSION", "RENDER_VERSION", "css", "layout", "notice", "templates"]);
  assert.equal(NoteSpec.NOTE_SPEC_VERSION, NC.NOTE_SPEC_VERSION, "계약 버전과 같다(직접 값이 아님)");
  assert.equal(NoteSpec.RENDER_VERSION, "render-4");
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
  assert.equal(n("NOTE_FORMULAS_IMAGE", { count: 1 }), "원본 이미지로 표시한 수식 1개");
  assert.equal(n("NOTE_FORMULAS_CHECK", { count: 2 }), "확인이 필요한 수식 2개");
  assert.equal(n("NOTE_FORMULAS_UNVERIFIED", { count: 2 }), "확인이 필요한 수식 2개");
  assert.equal(n("NOTE_FIGURES_CHECK", { count: 1 }), "확인이 필요한 도표 1개");
  assert.equal(n("NOTE_FIGURES_NOT_DETECTED"), "도표는 찾지 않았습니다(Free)");
  assert.equal(n("NOTE_AUGMENTED"), "가상 사례·강의 밖 보강이 포함된 노트입니다");
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
    "@page{size:A4;margin:14.3mm}", "break-after:avoid", "orphans:2", "table-header-group",
    "data-label", "max-width:520px", "break-before:page"]) assert.ok(c.includes(t), t);
  assert.ok(!c.includes("--teal") && !c.includes("--plum"), "구형 색 금지");
  assert.ok(!/overflow\s*:\s*hidden/.test(c), "내용 클리핑 금지(§15)");
  assert.ok(!/text-overflow|ellipsis/.test(c), "말줄임 금지(§15)");
});

test("layout·templates 는 도우미만으로 문자열을 만든다", () => {
  const h = {
    esc: String, rich: String, claim: c => c && c.text || "", math: String, formula: String, figure: () => "",
    crop: () => "", block: b => `<w data-type="${b.type}">${NoteSpec.templates[b.type](b, h)}</w>`,
    notice: n => NoteSpec.notice(n, h), time: (t0, t1) => `${t0}-${t1}`, qno: () => 1, opts: { medium: "web", answers: "end" }, note: {},
  };
  h.note = { sections: [{ sectionId: "S1", number: 1, title: "t", stage: "understand", range: { t0: 0, t1: 9 }, blocks: [{ id: "S1_B1", type: "B05", content: { term: "t", definition: { text: "d", evidenceIds: [], basis: "lecture" } } }] }] };
  const html = NoteSpec.layout(h.note, h);
  assert.ok(typeof html === "string" && html.includes('data-type="B05"'));
});
