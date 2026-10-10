const test = require("node:test");
const assert = require("node:assert/strict");
const { toMarkdown } = require("./note-export.js");
const fixture = require("../tools/note-fixture/expected-note.json");

const claim = (text, basis = "lecture") => ({ text, evidenceIds: [], basis });
const block = (type, content, over = {}) => ({ id: "S1_B1", type, sectionId: "S1", status: "supported", importance: "core", emphasis: [], content, ...over });
const section = (blocks, over = {}) => ({
  sectionId: "S1", number: 1, title: "단원", question: null, stage: "understand",
  unitIds: ["U1"], range: { t0: 0, t1: 10 }, gist: null, blocks, checks: [], ...over,
});
const META = { title: "제목", course: null, lectureDate: null, session: null, lang: "ko", generatedAt: "x", processed: { t0: 0, t1: 10 } };
const base = (over = {}) => ({ schemaVersion: 1, status: "complete", tier: "paid", meta: META, global: [], sections: [], registry: [], figures: [], notices: [], ...over });
const b05 = (definition, over = {}) => block("B05", { conceptId: "C1", term: "용어", original: null, definition, explanation: null, mechanism: null, scope: [], examples: [], ...over });
const b10 = (over = {}) => block("B10", {
  title: "계산", kind: "calc", goal: null, formulaIds: [], figureIds: [], variables: [], assumptions: [],
  inputs: [], steps: [], derived: [], reading: [], result: null, limits: [], withheld: null, ...over,
});
const reg = (id, display, extra = {}) => ({ id, latex: null, text: null, status: "unverified", slideId: "s", t0: 0, display, ...extra });

test("픽스처: §15 문서 순서, ## 0n 헤더, B06 표, 근거 id 미노출", () => {
  const md = toMarkdown(fixture);
  assert.ok(md.startsWith("# 경영학원론(가상) 6주차\n"), "B01 머리");
  assert.ok(md.includes("6주차 · 담은 구간 0:00–21:00"), "메타 줄");
  assert.ok(md.includes("> 일부 내용이 빠진 노트입니다. 끝의 처리 참고를 보세요."), "partial 고지");
  for (const s of fixture.sections) assert.ok(md.includes(`## ${String(s.number).padStart(2, "0")} ${s.title}`), `## 0${s.number} ${s.title}`);
  const at = x => md.indexOf(x);
  assert.ok(at("공헌이익으로 손익분기 판매량을 어떻게 구하는가") > 0 && at("공헌이익으로 손익분기 판매량을 어떻게 구하는가") < at("## 01"), "전역 B02 는 섹션 앞");
  assert.ok(at("### 두 관점의 관계") > at("## 05"), "전역 B13 은 섹션 뒤");
  assert.ok(at("## 자기 점검") > at("### 두 관점의 관계"), "자기 점검은 B13 뒤");
  assert.ok(at("## 정답과 해설") > at("## 자기 점검") && at("## 처리 참고") > at("## 정답과 해설"), "정답→고지 순서");
  assert.ok(md.includes("| 기준 | 거래비용 관점 | 자원기반 관점 | 대리인 관점 |"), "B06 표 머리");
  assert.ok(md.includes("| 핵심 질문 | 만들 것인가 살 것인가를 묻는다 | 무엇이 강점인가를 묻는다 | — |"), "null 셀은 —");
  assert.doesNotMatch(md, /U\d+\.[stg]\d+/, "근거 id 노출 금지");
  assert.ok(!md.includes("{{"), "수식 참조 잔여물 없음");
  assert.ok(md.includes("$$BEP=\\frac{FC}{P-VC}$$"), "formulaIds 는 $$ 수식");
  assert.ok(md.includes("식 $BEP=\\frac{FC}{P-VC}$에 따라"), "본문 참조는 $ 수식");
  assert.ok(md.includes("비교 식으로 [수식 확인 필요]가 제시되었다"), "check 수식 표식");
  assert.ok(md.includes("**Q1.**") && md.includes("**Q4.**") && md.includes("**A1.**") && md.includes("**A4.**"), "문항·답안 문서 전체 번호");
  assert.ok(md.includes("**A2.** X —") && md.includes("**A4.** O —"), "OX 판정");
  assert.ok(md.includes("*(응용)*") && md.includes("*(기초)*"), "수준 한국어");
  assert.ok(md.includes("> 곁설명: 고정비에는"), "B12 곁설명");
  assert.ok(md.includes("**오해**") && md.includes("**바로잡기**"), "B11");
  assert.ok(md.includes("> [확인 필요] 강의 중 월 고정비 수치가 정정되었다"), "단원 확인 항목");
  assert.ok(md.includes("**저자 주장.**") && md.includes("**강의의 해석.**"), "B09 라벨");
  assert.ok(md.includes("**Point 1.**"), "Point 번호 규격");
  assert.ok(md.includes("(기한: 다음 주 수요일 수업 전까지)"), "B18 기한");
  assert.ok(!md.includes("NOTE_ADVISORY"), "advisories 는 고지가 아니다");
});

test("같은 입력은 바이트까지 같은 Markdown, 입력을 바꾸지 않는다", () => {
  const before = JSON.stringify(fixture);
  const a = toMarkdown(fixture);
  assert.equal(toMarkdown(JSON.parse(before)), a, "결정적");
  assert.equal(JSON.stringify(fixture), before, "입력 불변");
});

test("answers:'inline' 은 답을 문항 바로 아래에 두고 정답 파트가 없다", () => {
  const md = toMarkdown(fixture, { answers: "inline" });
  assert.ok(!md.includes("## 정답과 해설"));
  assert.ok(md.indexOf("**A1.") > md.indexOf("**Q1.") && md.indexOf("**A1.") < md.indexOf("**Q2."), "A1 은 Q1 바로 아래");
});

test("basis 접미사: synthetic → 가상 사례, external → 강의 밖 보강", () => {
  const md = toMarkdown(base({
    sections: [section([b05(claim("정의다", "synthetic"), { scope: [claim("범위다", "external")] })])],
  }));
  assert.ok(md.includes("정의다 _(가상 사례)_"));
  assert.ok(md.includes("범위다 _(강의 밖 보강 — 확인 필요)_"));
  assert.ok(!md.includes("synthetic") && !md.includes("external"), "영문 basis 값 미노출");
});

test("{{F12}} 치환: display latex·crop·check 와 모르는 id", () => {
  const registry = [
    reg("F1", "latex", { latex: "x^2+1", status: "verified" }),
    reg("F2", "crop", { latex: "\\sqrt{2}", status: "image" }),
    reg("F3", "check"),
  ];
  const md = toMarkdown(base({ registry, sections: [section([b05(claim("a {{F1}} b {{F2}} c {{ F3 }} d {{F9}} e"))])] }));
  assert.ok(md.includes("a $x^2+1$ b [수식 이미지] c [수식 확인 필요] d [수식] e"));
  assert.ok(!md.includes("\\sqrt{2}"), "crop 은 LaTeX 를 보이지 않는다");
});

test("B10 formulaIds 는 식마다 한 줄, figureIds 는 표 또는 원본 안내", () => {
  const md = toMarkdown(base({
    registry: [reg("F1", "latex", { latex: "a+b", status: "verified" }), reg("F2", "crop", { status: "image" })],
    figures: [
      { id: "G1", evidenceId: "U1.g1", kind: "table", title: "표제", cells: [["기준", "a|b"], ["x", "y"]], t0: 0, display: "check" },
      { id: "G2", evidenceId: "U1.g1", kind: "chart", title: "차트제", cells: null, t0: 0, display: "crop" },
    ],
    sections: [section([b10({ formulaIds: ["F1", "F2", "F9"], figureIds: ["G1", "G2", "G9"], derived: ["c=a+b"] })])],
  }));
  assert.ok(md.includes("$$a+b$$\n[수식 이미지]\n[수식]"), "formulaIds 한 줄씩");
  assert.ok(md.includes("| 기준 | a\\|b |\n| --- | --- |\n| x | y |"), "도표 표 + | 이스케이프");
  assert.ok(md.includes("[도표: 차트제 — 원본 화면 참고]"), "셀 없는 도표");
  assert.ok(md.includes("[도표: G9 — 원본 화면 참고]"), "모르는 도표 id");
  assert.ok(md.includes("$$c=a+b$$"), "derived 는 $$ 수식");
});

test("고지: 코드 문구·count 기본값·구간(h:mm:ss)·외 n곳·advisory 숨김", () => {
  const md = toMarkdown(base({
    notices: [
      { code: "NOTE_CAPTURE_GAP", count: 5, ids: null, ranges: [{ t0: 3600, t1: 3700 }, { t0: 60, t1: 70 }, { t0: 80, t1: 90 }, { t0: 100, t1: 110 }, { t0: 120, t1: 130 }] },
      { code: "NOTE_FIGURES_NOT_DETECTED", count: null, ids: null, ranges: null },
      { code: "NOTE_FORMULAS_UNVERIFIED", count: null, ids: null, ranges: null },
      { code: "NOTE_ADVISORY_TABLE_LONG", count: 7, ids: null, ranges: null },
      { code: "SOMETHING_ELSE", count: 2, ids: null, ranges: null },
    ],
  }));
  assert.ok(md.includes("## 처리 참고"));
  assert.ok(md.includes("- 인식하지 못한 구간 5곳 (1:00:00–1:01:40, 1:00–1:10, 1:20–1:30, … 외 2곳)"), "구간 3개 + 외 2곳");
  assert.ok(md.includes("- 도표는 찾지 않았습니다(Free)"), "count 없는 고지");
  assert.ok(md.includes("- 확인이 필요한 수식 1개"), "count 기본값 1");
  assert.ok(md.includes("- 기타 참고: SOMETHING_ELSE×2"), "모르는 코드");
  assert.ok(!md.includes("NOTE_ADVISORY") && !md.includes("ADVISORY"), "advisory 숨김");
  assert.equal(toMarkdown(base({ notices: [] })).includes("## 처리 참고"), false, "고지 없으면 파트도 없다");
});

test("모델 텍스트는 구조를 깨지 못한다: <script> 와 줄 머리 기호", () => {
  const md = toMarkdown(base({ sections: [section([b05(claim("<script>alert(1)</script>\n# 머리\n- 항목\n> 인용"))])] }));
  assert.ok(md.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !md.includes("<script>"), "< > 이스케이프");
  assert.ok(md.includes("\\# 머리") && md.includes("\\- 항목") && md.includes("&gt; 인용"), "줄 머리 구조 문자 무력화 (>는 &gt;로 충분)");
});

test("엉성한 입력도 문자열을 돌려준다", () => {
  assert.equal(toMarkdown(null), "");
  assert.equal(toMarkdown({}), "# 강의 노트");
  assert.ok(toMarkdown(base({ meta: { ...META, title: null } })).startsWith("# 강의 노트"), "제목 폴백");
  assert.equal(globalThis.NoteExport.toMarkdown, toMarkdown, "UMD 전역 노출");
});
