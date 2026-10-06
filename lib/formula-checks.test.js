const test = require("node:test");
const assert = require("node:assert/strict");
const katex = require("./vendor/katex/katex.min.js");
const Verify = require("./verify.js");
const Formulas = require("./formulas.js");

test("checkFormula computes parse ok, failed, and unchecked", () => {
  // 1. 유효한 LaTeX + KaTeX -> parse: ok
  const okResult = Verify.checkFormula({ latex: "E = mc^2" }, { katex });
  assert.equal(okResult.parse, "ok");

  // 2. 파싱 불가 문법 오류 LaTeX -> parse: failed
  const failResult = Verify.checkFormula({ latex: "\\frac{1}{" }, { katex });
  assert.equal(failResult.parse, "failed");

  // 3. latex 누락 -> parse: unchecked
  const uncheckResult = Verify.checkFormula({ latex: null }, { katex });
  assert.equal(uncheckResult.parse, "unchecked");

  // 4. katex 미제공 -> parse: unchecked
  const noKatex = Verify.checkFormula({ latex: "E = mc^2" }, { katex: null });
  assert.equal(noKatex.parse, "unchecked");
});

test("checkFormula computes symbols match, mismatch, and unchecked", () => {
  // 1. 원본 텍스트 누락 -> unchecked
  const noOcr = Verify.checkFormula({ latex: "y = 2x", text: null });
  assert.equal(noOcr.symbols, "unchecked");

  // 2. 기호 일치 -> match
  const matchRes = Verify.checkFormula({ latex: "y = 2x", text: "y = 2x" });
  assert.equal(matchRes.symbols, "match");

  // 그리스 문자 및 지수 일치 -> match
  const greekRes = Verify.checkFormula({ latex: "\\alpha + \\beta^2 = 1", text: "α + β² = 1" });
  assert.equal(greekRes.symbols, "match");

  // 3. 변수 기호 불일치 -> mismatch
  const varMismatch = Verify.checkFormula({ latex: "y = 2x", text: "z = 2x" });
  assert.equal(varMismatch.symbols, "mismatch");

  // 4. 지수(첨자) 불일치 -> mismatch
  const expMismatch = Verify.checkFormula({ latex: "E = mc^2", text: "E = mc³" });
  assert.equal(expMismatch.symbols, "mismatch");

  // 5. 분수 분모 불일치 -> mismatch
  const fracMismatch = Verify.checkFormula({ latex: "\\frac{a}{b}", text: "a / c" });
  assert.equal(fracMismatch.symbols, "mismatch");

  // 6. 그리스 문자 불일치 -> mismatch
  const greekMismatch = Verify.checkFormula({ latex: "\\alpha + \\beta", text: "α + γ" });
  assert.equal(greekMismatch.symbols, "mismatch");
});

test("checkFormula computes units ok, mismatch, and unchecked", () => {
  // 1. B10 계산 단위 불일치 (m 와 s 더하기) -> mismatch
  const b10Bad = {
    inputs: [
      { label: "거리", value: 10, unit: "m" },
      { label: "시간", value: 5, unit: "s" },
    ],
    steps: [
      { label: "합산", op: "add", a: "i1", b: "i2", value: 15, unit: "m" },
    ],
  };
  const b10BadRes = Verify.checkFormula({ latex: "10 + 5 = 15" }, { b10: b10Bad });
  assert.equal(b10BadRes.units, "mismatch");

  // 2. B10 계산 % - % 의 결과가 %p 가 아님 -> mismatch
  const b10PercentBad = {
    inputs: [
      { label: "A", value: 30, unit: "%" },
      { label: "B", value: 20, unit: "%" },
    ],
    steps: [
      { label: "차이", op: "sub", a: "i1", b: "i2", value: 10, unit: "%" },
    ],
  };
  const b10PercentBadRes = Verify.checkFormula({ latex: "30 - 20 = 10" }, { b10: b10PercentBad });
  assert.equal(b10PercentBadRes.units, "mismatch");

  // 3. B10 계산 정상 단위 (같은 차원 더하기) -> ok
  const b10Good = {
    inputs: [
      { label: "구간1", value: 100, unit: "m" },
      { label: "구간2", value: 200, unit: "m" },
    ],
    steps: [
      { label: "전체", op: "add", a: "i1", b: "i2", value: 300, unit: "m" },
    ],
  };
  const b10GoodRes = Verify.checkFormula({ latex: "100 + 200 = 300" }, { b10: b10Good });
  assert.equal(b10GoodRes.units, "ok");

  // 4. 수식 내 단위 텍스트 불일치 -> mismatch
  const textUnitBad = Verify.checkFormula({ latex: "10\\text{m} + 5\\text{kg} = 15" });
  assert.equal(textUnitBad.units, "mismatch");

  // 5. 수식 내 단위 텍스트 일치 -> ok
  const textUnitGood = Verify.checkFormula({ latex: "10\\text{m} + 5\\text{m} = 15\\text{m}" });
  assert.equal(textUnitGood.units, "ok");

  // 6. 단위 정보 없음 -> unchecked
  const plainRes = Verify.checkFormula({ latex: "y = 2x + 1" });
  assert.equal(plainRes.units, "unchecked");
});

test("tokenizeMathSymbols maps unicode subscript letters to sub, not sup", () => {
  // U+1D62 대역(ᵢᵣᵤᵥ)은 유니코드 아래첨자다 — 범위 정규식이 위첨자로 오분류하면 mismatch 가 된다.
  assert.equal(Verify.checkFormulaSymbols("x_i", "xᵢ"), "match");
  assert.equal(Verify.checkFormulaSymbols("x_i", "xⁱ"), "mismatch", "아래첨자와 위첨자는 다르다");
});

test("checkFormulaUnits ignores bare-letter operands (variables are not units)", () => {
  // "5x - 2y" 의 x·y 는 변수일 수 있다 — 한글·%·° 로 시작하거나 \text{} 로 감싼 것만 단위로 본다.
  assert.equal(Verify.checkFormula({ latex: "5x - 2y = 3" }).units, "unchecked");
  assert.equal(Verify.checkFormula({ latex: "10명 + 5명 = 15명" }).units, "ok");
  assert.equal(Verify.checkFormula({ latex: "10명 + 5개 = 15" }).units, "mismatch");
});

test("Formulas.verify sets checks and demotes status on symbol mismatch", () => {
  const entry = {
    id: "F1",
    slideId: "s1",
    latex: "y = 2x",
    text: "z = 2x", // 기호 불일치
  };
  const res = Formulas.verify(entry, { katex, reread: true });
  assert.equal(res.status, "image", "기호 불일치는 검증을 통과하지 못하고 image로 강등");
  assert.deepEqual(res.checks, {
    parse: "ok",
    symbols: "mismatch",
    units: "unchecked",
  });
});
