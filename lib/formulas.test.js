const test = require("node:test");
const assert = require("node:assert/strict");
const katex = require("./vendor/katex/katex.min.js");
const F = require("./formulas.js");

// 금융 강의 예시: 명목이자율 -> 실효이자율 환산식
const L_GEN = "i_a = \\left(1 + \\frac{r}{CK}\\right)^{C} - 1";
const L_NUM = "\\left(1 + \\frac{0.09}{3 \\times 4}\\right)^{3} - 1 = 2.27\\%";
const OCR_NUM = "(1 + 0.09/(3×4))^3 − 1 = 2.27%";
const mk = (o) => ({ id: "F1", slideId: "s1", t0: 0, latex: null, text: null, bbox: null, conf: 1, status: "unverified", seenOn: [], ...o });

// buildRegistry: (t0, bbox.y, bbox.x) 순 id 부여, null bbox는 뒤로
test("buildRegistry assigns stable ids by t0 then bbox position", () => {
  const reg = F.buildRegistry([
    { slideId: "s1", t0: 10, formulas: [
      { latex: L_GEN, text: null, bbox: { x: 0.1, y: 0.5, w: 0.8, h: 0.1 }, conf: 0.9 },
      { latex: L_NUM, text: OCR_NUM, bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.1 }, conf: 0.8 },
      { latex: "K = 4", text: null, bbox: null, conf: 0.5 },
    ] },
    { slideId: "s2", t0: 20, formulas: [{ latex: "y = 2x", text: null, bbox: null, conf: 0.7 }] },
  ]);
  assert.deepEqual(reg.map((e) => e.id), ["F1", "F2", "F3", "F4"]);
  assert.equal(reg[0].latex, L_NUM);   // y=0.2
  assert.equal(reg[1].latex, L_GEN);   // y=0.5
  assert.equal(reg[2].latex, "K = 4"); // bbox null -> 마지막
  assert.equal(reg[3].latex, "y = 2x");
  assert.deepEqual(reg[0], { id: "F1", slideId: "s1", t0: 10, latex: L_NUM, text: OCR_NUM, bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.1 }, conf: 0.8, status: "unverified", seenOn: [] });
});

// 프로그레시브 슬라이드: 연속 슬라이드의 동일 수식은 첫 등장만 남기고 seenOn에 모은다
test("buildRegistry collapses duplicates on consecutive slides into seenOn", () => {
  const reg = F.buildRegistry([
    { slideId: "a", t0: 0, formulas: [{ latex: L_GEN, text: null, bbox: null, conf: 1 }] },
    { slideId: "b", t0: 1, formulas: [{ latex: "i_a=\\left(1+\\frac{r}{CK}\\right)^{C}-1", text: null, bbox: null, conf: 1 }] },
    { slideId: "c", t0: 2, formulas: [{ latex: L_GEN, text: null, bbox: null, conf: 1 }] },
  ]);
  assert.equal(reg.length, 1);
  assert.equal(reg[0].slideId, "a");
  assert.deepEqual(reg[0].seenOn, ["b", "c"]);

  // 떨어진 슬라이드의 같은 수식은 별개 항목
  const apart = F.buildRegistry([
    { slideId: "a", t0: 0, formulas: [{ latex: L_GEN, text: null, bbox: null, conf: 1 }] },
    { slideId: "b", t0: 1, formulas: [{ latex: "y = 2x", text: null, bbox: null, conf: 1 }] },
    { slideId: "c", t0: 2, formulas: [{ latex: L_GEN, text: null, bbox: null, conf: 1 }] },
  ]);
  assert.equal(apart.length, 3);
  assert.deepEqual(apart.map((e) => e.seenOn.length), [0, 0, 0]);

  // latex 없는 무료 모드 항목은 합치지 않는다
  const free = F.buildRegistry([
    { slideId: "a", t0: 0, formulas: [{ latex: null, text: "i = r / n", bbox: null, conf: 0.6 }] },
    { slideId: "b", t0: 1, formulas: [{ latex: null, text: "i = r / n", bbox: null, conf: 0.6 }] },
  ]);
  assert.equal(free.length, 2);

  // \rightarrow와 \leftarrow는 다른 수식 — 연속 슬라이드라도 합치지 않는다
  const arrows = F.buildRegistry([
    { slideId: "a", t0: 0, formulas: [{ latex: "x \\rightarrow 0", text: null, bbox: null, conf: 1 }] },
    { slideId: "b", t0: 1, formulas: [{ latex: "x \\leftarrow 0", text: null, bbox: null, conf: 1 }] },
  ]);
  assert.equal(arrows.length, 2);
  assert.deepEqual(arrows.map((e) => e.seenOn), [[], []]);
});

// normalizeLatex: 렌더링 차이 없는 요소 제거 확인
test("normalizeLatex removes delimiters, spacing and display commands", () => {
  assert.equal(F.normalizeLatex(" $$ i_a = \\left(1 + \\dfrac{r}{CK}\\right)^{C} \\; - \\! 1 $$ "), "i_a=(1+\\frac{r}{CK})^{C}-1");
  assert.equal(F.normalizeLatex("\\displaystyle\\tfrac{a}{b}\\quad x"), "\\frac{a}{b}x");
  assert.equal(F.normalizeLatex("\\left\\{ x \\, + \\, y \\right\\}"), "\\{x+y\\}");

  // \left/\right는 정확히 그 명령만 지운다 — \rightarrow, \leftarrow는 다른 수식이다
  assert.notEqual(F.normalizeLatex("x \\rightarrow 0"), F.normalizeLatex("x \\leftarrow 0"));
  assert.ok(F.normalizeLatex("x \\leftrightarrow y").includes("leftrightarrow"));
  assert.equal(F.normalizeLatex("\\left( x \\right)"), "(x)");
});

// numericTokens: 분수·명령 안의 숫자와 천 단위 쉼표 처리
test("numericTokens extracts numbers from latex and plain text", () => {
  assert.deepEqual(F.numericTokens(OCR_NUM), ["0.09", "1", "1", "2.27", "3", "3", "4"]);
  assert.deepEqual(F.numericTokens("가격 1,000원, \\frac{0.0075}{2} 적용"), ["0.0075", "2", "1000"]);
  assert.deepEqual(F.numericTokens("\\frac12"), ["1", "2"]); // 중괄호 없는 축약
  assert.deepEqual(F.numericTokens("\\sqrt{2}"), ["2"]);

  // 부분적으로 중괄호가 있는 \frac 형태
  assert.deepEqual(F.numericTokens("\\frac{10}2"), ["2", "10"]);
  assert.deepEqual(F.numericTokens("\\frac1{10}"), ["1", "10"]);
  assert.deepEqual(F.numericTokens("\\frac{0.0075}{2}"), ["0.0075", "2"]);

  // 천 단위 구분: 쉼표, \, , {,}
  assert.deepEqual(F.numericTokens("1,000"), ["1000"]);
  assert.deepEqual(F.numericTokens("1\\,000"), ["1000"]);
  assert.deepEqual(F.numericTokens("1{,}000"), ["1000"]);
  assert.deepEqual(F.numericTokens("1,000,000"), ["1000000"]);

  // OCR 유니코드 위·아래첨자와 전각 숫자는 NFKC로 ASCII에 맞춘다
  assert.deepEqual(F.numericTokens("x² + y₁"), ["1", "2"]);
  assert.deepEqual(F.numericTokens("１２ + 3"), ["3", "12"]);
});

// crossCheck: OCR과 LaTeX 숫자 다중집합 대조
test("crossCheck compares numeric multisets and skips empty OCR", () => {
  assert.deepEqual(F.crossCheck(L_NUM, OCR_NUM), { ok: true, missing: [], extra: [] });
  assert.deepEqual(F.crossCheck(L_NUM, ""), { ok: true, missing: [], extra: [], skipped: true });
  assert.deepEqual(F.crossCheck(L_NUM, null), { ok: true, missing: [], extra: [], skipped: true });
  // OCR이 0.09를 0.08로 잘못 읽은 경우
  assert.deepEqual(F.crossCheck(L_NUM, "(1 + 0.08/(3×4))^3 − 1 = 2.27%"), { ok: false, missing: ["0.08"], extra: ["0.09"] });
  // OCR 위첨자 표기도 LaTeX과 같은 숫자로 본다
  assert.equal(F.crossCheck("x^{2} + 1", "x² + 1").ok, true);
});

// parseOk / validateDerived: KaTeX 파싱 성공 여부
test("parseOk and validateDerived use vendored katex", () => {
  assert.equal(F.parseOk(L_NUM, katex), true);
  assert.equal(F.parseOk(L_GEN, katex), true);
  assert.equal(F.parseOk("\\frac{", katex), false);
  assert.equal(F.parseOk(null, katex), false);
  assert.deepEqual(F.validateDerived("e^{i\\pi}+1=0", katex), { ok: true, error: null });
  const bad = F.validateDerived("\\frac{", katex);
  assert.equal(bad.ok, false);
  assert.ok(typeof bad.error === "string" && bad.error.length > 0);
  assert.equal(F.validateDerived("", katex).ok, false);

  // KaTeX 객체가 없으면 조용한 실패 대신 즉시 던진다
  assert.throws(() => F.parseOk("x^2", undefined), /KaTeX/);
  assert.throws(() => F.validateDerived("x^2"), /KaTeX/);
});

// verify: 파싱+숫자 대조 통과만 verified, 실패는 reread, 재시도 실패는 image
test("verify gates status on parse and numeric cross-check", () => {
  const ok = F.verify(mk({ latex: L_NUM }), { katex, ocrText: OCR_NUM });
  assert.equal(ok.status, "verified");

  // ocrText 생략 시 entry.text로 대조
  assert.equal(F.verify(mk({ latex: L_NUM, text: OCR_NUM }), { katex }).status, "verified");

  // 파싱 실패 -> reread -> image
  const bad = mk({ latex: "\\frac{" });
  assert.equal(F.verify(bad, { katex }).status, "reread");
  assert.equal(F.verify(bad, { katex, reread: true }).status, "image");

  // 숫자 불일치 -> reread
  assert.equal(F.verify(mk({ latex: L_NUM }), { katex, ocrText: "(1 + 0.08/(3×4))^3 − 1 = 2.27%" }).status, "reread");

  // 무료 모드(latex 없음)는 unverified 유지, 원본은 변형하지 않는다
  const free = mk({ id: "F9", text: "i = r / n" });
  assert.equal(F.verify(free, { katex }).status, "unverified");
  assert.equal(free.status, "unverified");

  // KaTeX 없이 LaTeX 수식을 검증하려 하면 던지고, 무료 모드는 KaTeX 없이도 동작한다
  assert.throws(() => F.verify(mk({ latex: "x^2", text: "x2" }), {}), /KaTeX/);
  assert.equal(F.verify(mk({ latex: null, text: "i = r" }), {}).status, "unverified");
});

// substituteRefs: verified만 LaTeX, 나머지는 원본 이미지 토큰, 모르는 id는 오류
test("substituteRefs replaces verified refs and guards unknown ids", () => {
  const reg = [
    mk({ id: "F1", latex: L_NUM, status: "verified" }),
    mk({ id: "F2", latex: L_GEN, status: "image" }),
    mk({ id: "F3", latex: L_GEN, status: "reread" }),
    mk({ id: "F4", latex: L_GEN, status: "unverified" }),
  ];
  const out = F.substituteRefs("공식 {{F1}} / 크롭 {{F2}} {{F3}} {{F4}}", reg);
  assert.equal(out, "공식 $" + L_NUM + "$ / 크롭 [[IMG:F2]] [[IMG:F3]] [[IMG:F4]]");
  // 참조 토큰 안쪽 공백 허용
  assert.equal(F.substituteRefs("{{ F1 }}", reg), "$" + L_NUM + "$");
  assert.throws(() => F.substituteRefs("{{F99}}", reg), /알 수 없는 수식 참조: F99/);
  assert.throws(() => F.substituteRefs("{{ F99 }}", reg), /알 수 없는 수식 참조: F99/);
});

// findRetypedLatex: 참조 대신 수식을 다시 쓴 출력을 잡는다
test("findRetypedLatex detects retyped formulas and ignores short ones", () => {
  const reg = [
    mk({ id: "F1", latex: L_GEN, status: "verified" }),
    mk({ id: "F2", latex: "x^2", status: "verified" }),
  ];
  // 다른 공백, \left/\right 없는 재서술도 정규화 뒤 일치
  assert.deepEqual(F.findRetypedLatex("실효금리 i_a = (1 + \\frac{r}{CK})^{C} - 1 로 계산한다", reg), ["F1"]);
  // 참조만 쓴 출력은 통과
  assert.deepEqual(F.findRetypedLatex("실효금리는 {{F1}} 참조", reg), []);
  // 정규화 후 8자 미만 짧은 수식은 무시
  assert.deepEqual(F.findRetypedLatex("x^2 항을 전개하면", reg), []);
});

// 공개 함수는 입력을 변형하지 않는다
test("public functions do not mutate their inputs", () => {
  const slides = [
    { slideId: "a", t0: 0, formulas: [{ latex: L_GEN, text: null, bbox: { x: 0, y: 0, w: 1, h: 1 }, conf: 1 }] },
    { slideId: "b", t0: 1, formulas: [{ latex: L_GEN, text: null, bbox: { x: 0, y: 0, w: 1, h: 1 }, conf: 1 }] },
  ];
  const slidesJson = JSON.stringify(slides);
  const reg = F.buildRegistry(slides);
  const regJson = JSON.stringify(reg);
  const entry = mk({ latex: L_NUM, text: OCR_NUM });
  const entryJson = JSON.stringify(entry);
  assert.equal(JSON.stringify(slides), slidesJson);

  const v = F.verify(entry, { katex });
  assert.notEqual(v, entry);
  F.substituteRefs("{{F1}}", reg);
  F.findRetypedLatex("본문 " + L_GEN, reg);
  F.crossCheck(L_NUM, OCR_NUM);
  assert.equal(JSON.stringify(reg), regJson);
  assert.equal(JSON.stringify(entry), entryJson);
  assert.equal(JSON.stringify(slides), slidesJson);
});
