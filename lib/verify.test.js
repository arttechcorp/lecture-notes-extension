const test = require("node:test");
const assert = require("node:assert/strict");
const katex = require("./vendor/katex/katex.min.js");
const { verifySection, checkSupport, verbatimIds, textOf, numbersOf } = require("./verify.js");

// 블록 타입은 아직 확정 전이다 — 문자열 잎(text)과 evidenceIds 만 있으면 된다.
const block = (text, evidenceIds, extra = {}) => ({ text, evidenceIds, ...extra });
const codes = r => r.blocks.flatMap(b => b.errors.map(e => e.code));
const values = (text, keepSmall) => numbersOf(text, keepSmall).flatMap(n => n.values);

const EV = [
  { id: "e1", text: "연이율은 3.5%이고 투자 기간은 12년이다. 원금은 1,000,000원이다." },
  { id: "e2", text: "대상 인구는 약 5천만 명이며 시장 규모는 2억 원이다." },
];
// 숫자 없는 서로 다른 한글 음절 300개 — 원문 재현 창을 어디서 잘라도 우연히 겹치지 않는다.
const LONG = Array.from({ length: 300 }, (_, i) => String.fromCharCode(0xAC00 + i * 7) + (i % 6 === 5 ? " " : "")).join("");

// textOf: 문자열 잎만 모으고 id 류 필드는 뺀다
test("textOf joins string leaves and skips evidenceIds and id keys", () => {
  const b = { id: "b12", type: "list", title: "요약", items: ["첫째", { id: "x99", text: "둘째", evidenceIds: ["e7"] }], level: 3, flag: true, none: null, evidenceIds: ["e1"] };
  assert.equal(textOf(b), "list\n요약\n첫째\n둘째");
  assert.equal(textOf(null), "");
});

// numbersOf: 정규화 한 가지씩
test("numbersOf folds thousands separators, decimals and full-width digits to numeric values", () => {
  assert.deepEqual(values("1,000원"), [1000]);
  assert.deepEqual(values("1,000,000원"), [1000000]);
  assert.deepEqual(values("3.50과 3.5"), [3.5, 3.5]);
  assert.deepEqual(values("비율 .5 와 0.50"), [0.5, 0.5]);
  assert.deepEqual(values("１２３명, ３．５배"), [123, 3.5]);
  assert.deepEqual(values("12 3 4,56"), [12, 56], "쉼표 뒤가 세 자리가 아니면 천 단위가 아니다");
  assert.deepEqual(values("1,2345"), [2345], "세 자리 뒤에 숫자가 더 이어지면 천 단위 묶음이 아니다");
});

test("numbersOf counts Korean multipliers as both raw and multiplied value", () => {
  assert.deepEqual(values("100만 원"), [100, 1000000]);
  assert.deepEqual(values("2억"), [2, 200000000]);
  assert.deepEqual(values("5천만 명"), [5, 5000], "천 뒤의 만은 합치지 않는다");
  assert.deepEqual(values("1.5억, 3조"), [1.5, 150000000, 3, 3e12]);
  assert.deepEqual(values("0.1만"), [0.1, 1000], "부동소수 곱셈 오차가 없다");
  assert.deepEqual(values("2.3만"), [2.3, 23000]);
  assert.deepEqual(values("3만큼 늘었다"), [], "만큼의 만은 배수가 아니고, 한 자리 정수라 건너뛴다");
  assert.deepEqual(numbersOf("약 100만 원").map(n => n.raw), ["100만"]);
});

test("numbersOf treats percent as the plain number and ignores single-digit integers", () => {
  assert.deepEqual(values("수익률 25%와 3.5퍼센트"), [25, 3.5]);
  assert.deepEqual(values("2가지 3단계 0 9"), []);
  assert.deepEqual(values("10가지"), [10]);
  assert.deepEqual(values("3.0"), [3], "소수 표기는 한 자리여도 남긴다");
  assert.deepEqual(values("3만"), [3, 30000], "배수가 붙은 한 자리는 남긴다");
  assert.deepEqual(values("2가지 3단계", true), [2, 3], "근거 쪽은 한 자리도 모은다");
});

test("numbersOf ignores formula references so F-ids are not numbers", () => {
  assert.deepEqual(values("식 {{F3}}에 따라 {{ F12 }}와 {{F123}}은 45이다"), [45]);
  assert.deepEqual(values("｛｛Ｆ３｝｝ 참조", true), [], "전각 참조도 지운다");
});

// 정상 섹션
test("a clean section passes with no errors and nothing skipped", () => {
  const blocks = [
    block("연이율 3.50%로 12년 투자한다.", ["e1"]),
    block("원금은 100만 원이고 시장은 2억 원이다.", ["e1", "e2"]),
  ];
  assert.deepEqual(verifySection({ blocks, evidence: EV }), {
    ok: true, blocks: [],
    section: { errors: [], uncitedIds: [], uncitedRatio: 0 },
    skipped: [],
  });
});

// 1. 근거 id
test("VAL_EVIDENCE_UNKNOWN lists unknown ids and VAL_EVIDENCE_MISSING covers empty or absent evidenceIds", () => {
  const r = verifySection({ blocks: [block("연이율은 높다.", ["e1", "e9", "e8"]), block("설명이다.", []), { text: "설명이다." }], evidence: EV });
  assert.deepEqual(r.blocks, [
    { index: 0, errors: [{ code: "VAL_EVIDENCE_UNKNOWN", detail: ["e9", "e8"] }] },
    { index: 1, errors: [{ code: "VAL_EVIDENCE_MISSING", detail: [] }] },
    { index: 2, errors: [{ code: "VAL_EVIDENCE_MISSING", detail: [] }] },
  ]);
});

// 2. 숫자 보존
test("VAL_NUMBER_MISSING reports numbers as written that the cited evidence lacks", () => {
  const r = verifySection({ blocks: [block("연이율은 4.5%이고 기간은 15년, 원금 1,234원이다. 다시 4.5%.", ["e1"])], evidence: EV });
  assert.deepEqual(r.blocks, [{ index: 0, errors: [{ code: "VAL_NUMBER_MISSING", detail: ["4.5", "15", "1,234"] }] }]);
});

test("numbers must come from the cited evidence, not from other section evidence", () => {
  const r = verifySection({ blocks: [block("시장 규모는 2억 원이다.", ["e1"])], evidence: EV });
  assert.deepEqual(codes(r), ["VAL_NUMBER_MISSING"]);
  assert.deepEqual(codes(verifySection({ blocks: [block("시장 규모는 2억 원이다.", ["e2"])], evidence: EV })), []);
});

test("number matching normalizes separators, multipliers, percent, decimals and full-width digits", () => {
  const ok = (text, evText) => assert.deepEqual(codes(verifySection({ blocks: [block(text, ["e1"])], evidence: [{ id: "e1", text: evText }] })), [], `${text} <- ${evText}`);
  const no = (text, evText) => assert.deepEqual(codes(verifySection({ blocks: [block(text, ["e1"])], evidence: [{ id: "e1", text: evText }] })), ["VAL_NUMBER_MISSING"], `${text} <- ${evText}`);
  ok("원금 1000000원", "원금은 1,000,000원");        // 천 단위 쉼표
  ok("원금 1,000,000원", "원금은 1000000원");
  ok("원금 100만 원", "원금은 1,000,000원");           // 출력의 만 ↔ 근거의 풀어쓴 수
  ok("원금 1,000,000원", "원금은 100만 원");           // 반대 방향
  ok("인구 약 2억 명", "인구 200,000,000명");
  ok("인구 2억 명", "인구 2억 명");
  ok("수익률 25%", "수익률은 25 퍼센트");              // 퍼센트는 그냥 25
  ok("비율 3.5", "비율은 3.50");                        // 소수 정준화
  ok("비율 .5", "비율은 0.50");
  ok("비율 3.0", "단계 3");                              // 근거의 한 자리 정수와는 맞는다
  ok("금액 １２，０００원", "금액 12,000원");           // 전각 숫자·쉼표(NFKC)
  ok("차이 ２⁵", "차이 25");                            // 위첨자(NFKC)
  no("원금 1,000,000원", "원금은 10,000,000원");
  no("원금 100만 원", "원금은 1,000원");
  no("수익률 25%", "수익률은 2.5%");
});

test("single-digit integers and enumerations never trigger VAL_NUMBER_MISSING", () => {
  assert.deepEqual(verifySection({ blocks: [block("방법은 2가지, 3단계, 0번부터 9번까지다.", ["e1"])], evidence: EV }).blocks, []);
});

test("formula reference digits are not treated as numbers", () => {
  const r = verifySection({ blocks: [block("식 {{F3}}에서 {{F12}}를 유도한다.", ["e1"])], evidence: EV, registry: [{ id: "F3", latex: null, status: "image" }, { id: "F12", latex: null, status: "image" }] });
  assert.deepEqual(r.blocks, []);
});

// 3. 수식 참조
test("VAL_FORMULA_REF_UNKNOWN fires for refs missing from the registry", () => {
  const registry = [{ id: "F1", latex: "a+b", status: "verified" }];
  const r = verifySection({ blocks: [block("식 {{F1}}과 {{F9}}, {{F9}}를 쓴다.", ["e1"])], evidence: EV, registry });
  assert.deepEqual(r.blocks, [{ index: 0, errors: [{ code: "VAL_FORMULA_REF_UNKNOWN", detail: ["F9"] }] }]);
  assert.deepEqual(verifySection({ blocks: [block("식 {{ F1 }}을 쓴다.", ["e1"])], evidence: EV, registry }).blocks, []);
});

test("VAL_FORMULA_RETYPED fires through Formulas.findRetypedLatex", () => {
  const registry = [{ id: "F2", latex: "\\left(1+\\frac{r}{n}\\right)^{n}", status: "verified" }, { id: "F3", latex: "x+y", status: "verified" }];
  // 공백·\left\right 차이는 정규화돼 같은 식으로 읽힌다. F3 은 짧아서 우연 일치를 제외한다.
  const r = verifySection({ blocks: [block("복리식은 $(1 + \\frac{r}{n})^{n}$ 이고 x+y 는 합이다.", ["e1"])], evidence: EV, registry });
  assert.deepEqual(r.blocks, [{ index: 0, errors: [{ code: "VAL_FORMULA_RETYPED", detail: ["F2"] }] }]);
});

// 4. 유도식
const fakeKatex = { renderToString(latex) { if (latex.includes("@@BAD")) throw new Error("파싱 실패"); return "<span></span>"; } };

test("VAL_DERIVED_INVALID fires for derived LaTeX that fails to render, at any depth", () => {
  const blocks = [
    block("유도 결과다.", ["e1"], { derived: "a=b@@BAD" }),
    block("단계별 유도다.", ["e1"], { steps: [{ derived: ["a=b", "c=@@BAD", "d=e@@BAD"] }, { derived: "f=g" }] }),
    block("정상 유도다.", ["e1"], { derived: ["a=b", "c=d"] }),
  ];
  const r = verifySection({ blocks, evidence: EV, katex: fakeKatex });
  assert.deepEqual(r.blocks.map(b => b.index), [0, 1]);
  assert.deepEqual(r.blocks[0].errors, [{ code: "VAL_DERIVED_INVALID", detail: ["파싱 실패"] }]);
  assert.deepEqual(r.blocks[1].errors[0].detail, ["파싱 실패", "파싱 실패"]);
  assert.deepEqual(r.skipped, []);
});

test("without katex the derived check is skipped and reported, never silently verified", () => {
  const r = verifySection({ blocks: [block("유도 결과다.", ["e1"], { derived: "a=b@@BAD" })], evidence: [{ id: "e1", text: "유도 결과다." }] });
  assert.equal(r.ok, true, "건너뛴 것은 실패가 아니라 skipped 로 알린다");
  assert.deepEqual(r.blocks, []);
  assert.deepEqual(r.skipped, ["VAL_DERIVED_INVALID"]);
  // 검증할 유도식이 없으면 건너뛴 것도 없다. 빈 문자열은 유도식이 아니다.
  assert.deepEqual(verifySection({ blocks: [block("설명이다.", ["e1"], { derived: "" })], evidence: EV }).skipped, []);
  assert.deepEqual(verifySection({ blocks: [block("설명이다.", ["e1"], { derived: null })], evidence: EV, katex: fakeKatex }).blocks, []);
});

test("derived LaTeX is validated with the real vendored KaTeX", () => {
  const r = verifySection({ blocks: [block("유도식이다.", ["e1"], { derived: ["e^{i\\pi}+1=0", "\\frac{"] })], evidence: EV, katex });
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].errors.length, 1);
  assert.equal(r.blocks[0].errors[0].code, "VAL_DERIVED_INVALID");
  assert.equal(r.blocks[0].errors[0].detail.length, 1, "깨진 식 하나만 걸린다");
  assert.deepEqual(verifySection({ blocks: [block("유도식이다.", ["e1"], { derived: "e^{i\\pi}+1=0" })], evidence: EV, katex }).blocks, []);
});

// 5. 원문 재현
test("VAL_VERBATIM fires when a 180-char window of any section evidence appears in the block", () => {
  const evidence = [{ id: "e1", text: "짧은 근거다." }, { id: "e2", text: LONG }];
  const copy = LONG.slice(60, 240);
  // 인용하지 않은 e2 를 옮겨도 걸리고, 공백 모양이 달라도 걸린다.
  const r = verifySection({ blocks: [block(copy.replace(/ /g, "  \n"), ["e1"])], evidence });
  assert.deepEqual(r.blocks, [{ index: 0, errors: [{ code: "VAL_VERBATIM", detail: ["e2"] }] }]);
  assert.deepEqual(codes(verifySection({ blocks: [block(LONG.slice(60, 239), ["e1"])], evidence })), []);
  assert.deepEqual(codes(verifySection({ blocks: [block(LONG.slice(0, 100), ["e1"])], evidence })), []);
  // 240자 이상은 어디서 잘라도 창 하나를 품는다.
  assert.deepEqual(codes(verifySection({ blocks: [block(LONG.slice(7, 250), ["e1"])], evidence })), ["VAL_VERBATIM"]);
  // 180자 미만 근거는 창이 없어 재현으로 세지 않는다.
  assert.deepEqual(codes(verifySection({ blocks: [block("짧은 근거다.", ["e1"])], evidence })), []);
});

// 6. 커버리지
test("VAL_COVERAGE_LOW fires below 0.5 and not at 0.5; uncitedIds are returned", () => {
  const evidence = ["가나", "다라", "마바", "사아"].map((text, i) => ({ id: "e" + (i + 1), text }));
  const below = verifySection({ blocks: [block("설명 하나다.", ["e1"])], evidence });
  assert.equal(below.ok, false);
  assert.deepEqual(below.blocks, []);
  assert.deepEqual(below.section, { errors: [{ code: "VAL_COVERAGE_LOW", detail: ["1/4"] }], uncitedIds: ["e2", "e3", "e4"], uncitedRatio: .75 });
  const at = verifySection({ blocks: [block("설명 하나다.", ["e1"]), block("설명 둘이다.", ["e2", "e1"])], evidence });
  assert.equal(at.ok, true);
  assert.deepEqual(at.section, { errors: [], uncitedIds: ["e3", "e4"], uncitedRatio: .5 });
  // 실패한 블록의 인용은 세지 않는다(제외될 블록이다).
  const failed = verifySection({ blocks: [block("설명 하나다.", ["e1"]), block("실패 블록 99개.", ["e2", "e3", "e4"])], evidence });
  assert.deepEqual(failed.blocks.map(b => b.index), [1]);
  assert.deepEqual(failed.section.uncitedIds, ["e2", "e3", "e4"]);
  assert.deepEqual(failed.section.errors.map(e => e.code), ["VAL_COVERAGE_LOW"]);
  // 근거도 블록도 없으면 비율은 0이고 오류가 아니다.
  assert.deepEqual(verifySection({ blocks: [], evidence: [] }).section, { errors: [], uncitedIds: [], uncitedRatio: 0 });
  assert.deepEqual(verifySection({ blocks: [], evidence }).section.errors.map(e => e.code), ["VAL_COVERAGE_LOW"]);
});

test("only failing blocks are reported, with every error and a content-free code", () => {
  const registry = [{ id: "F1", latex: "a+b", status: "verified" }];
  const blocks = [block("연이율 3.5%다.", ["e1"]), block("식 {{F5}}, 수치 777.7.", ["e1", "e0"]), block("연이율 3.5%다.", ["e1"])];
  const r = verifySection({ blocks, evidence: EV, registry });
  assert.deepEqual(r.blocks.map(b => b.index), [1]);
  assert.deepEqual(r.blocks[0].errors.map(e => e.code), ["VAL_EVIDENCE_UNKNOWN", "VAL_NUMBER_MISSING", "VAL_FORMULA_REF_UNKNOWN"]);
  for (const e of r.blocks[0].errors) assert.match(e.code, /^VAL_[A-Z_]+$/);
});

// 7. 근거 지지
const bySupport = scores => async items => items.map(it => ({ itemId: it.itemId, task: "support", probs: [], score: scores[it.text] ?? null, model: "m" }));

test("checkSupport sends text+context items and flags scores below the threshold", async () => {
  const blocks = [
    block("연이율이 3.5%이다.", ["e1"], { id: "b1" }),
    block("시장은 2억 원이다.", ["e2", "e1"]),
    block("근거와 무관한 설명이다.", ["e1"]),
  ];
  let sent;
  const judge = async items => { sent = items; return bySupport({ "시장은 2억 원이다.": .5, "근거와 무관한 설명이다.": .2 })(items); };
  const r = await checkSupport(blocks, EV, { judge });
  assert.deepEqual(sent.map(i => i.itemId), ["0", "1", "2"]);
  assert.equal(sent[0].context, EV[0].text);
  assert.equal(sent[1].context, EV[1].text + "\n" + EV[0].text);
  assert.ok(!sent[0].text.includes("b1"), "id 필드는 본문이 아니다");
  assert.deepEqual(Object.keys(sent[0]).sort(), ["context", "itemId", "text"]);
  assert.deepEqual(r.blocks, [{ index: 2, errors: [{ code: "VAL_SUPPORT_LOW", detail: [.2] }] }]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unjudged, [0], "점수 없는 항목은 실패가 아니라 미판정이다");
  // 임계값 위임, 0.5 는 통과
  assert.deepEqual((await checkSupport(blocks, EV, { judge, threshold: .6 })).blocks.map(b => b.index), [1, 2]);
});

test("checkSupport treats a null score as no judgement, not as a failure", async () => {
  const r = await checkSupport([block("연이율이 3.5%이다.", ["e1"])], EV, { judge: bySupport({}) });
  assert.deepEqual(r, { ok: true, blocks: [], unjudged: [0] });
  const nan = await checkSupport([block("연이율이 3.5%이다.", ["e1"])], EV, { judge: async items => [{ itemId: items[0].itemId, score: NaN }] });
  assert.equal(nan.ok, true);
});

test("checkSupport accepts a ServiceClient-style {results} response and skips blocks it cannot judge", async () => {
  let calls = 0;
  const judge = async items => { calls++; return { results: items.map(it => ({ itemId: it.itemId, score: .1 })), usage: {} }; };
  const blocks = [block("근거 없는 블록이다.", []), block("미지의 근거다.", ["e9"]), block("본문이 있다.", ["e1"])];
  const r = await checkSupport(blocks, EV, { judge });
  assert.equal(calls, 1);
  assert.deepEqual(r.blocks.map(b => b.index), [2]);
  assert.deepEqual(r.unjudged, [0, 1]);
  // 보낼 항목이 없으면 judge 를 부르지 않는다.
  await checkSupport([block("근거 없는 블록이다.", [])], EV, { judge });
  assert.equal(calls, 1);
});

test("numbers inside derived formulas are computed results, not evidence claims", () => {
  const r = verifySection({ blocks: [block("미분 결과다.", ["e1"], { derived: ["f'(x)=12x^{3}+250"] })], evidence: [{ id: "e1", text: "f(x)=3x^4 를 미분한다." }], katex });
  assert.equal(r.blocks.length, 0, JSON.stringify(r.blocks));
});

// verbatimIds: 본문에 근거의 180자 창이 통째로 들어 있으면 그 근거 id — 근거 배열 순, 중복 없이
test("verbatimIds returns evidence ids whose windows appear in the text", () => {
  const LONG2 = LONG.split("").reverse().join("");   // 음절이 전부 달라 우연히 겹치지 않는 다른 근거
  const evidence = [{ id: "e1", text: "짧은 근거다." }, { id: "e2", text: LONG2 }, { id: "e3", text: LONG }];
  // e3 를 먼저 옮겨도 결과는 근거 배열 순이다. 200자 연속 구간은 창 하나를 온전히 품는다.
  const text = "설명 " + LONG.slice(0, 200) + " 중간 " + LONG2.slice(0, 200);
  assert.deepEqual(verbatimIds(text, evidence), ["e2", "e3"]);
  // 창 하나를 품지 못하는 패러프레이즈·짧은 발췌는 빈 배열
  assert.deepEqual(verbatimIds("전부 다른 표현으로 고쳐 쓴 문장이다.", evidence), []);
  assert.deepEqual(verbatimIds(LONG.slice(0, 100), evidence), []);
});
