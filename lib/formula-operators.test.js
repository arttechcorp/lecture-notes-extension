const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("./verify.js");

// 같은 연산자면 match
test("같은 연산자 match: x+y=3 vs x+y=3", () => {
  assert.equal(V.checkFormulaSymbols("x+y=3", "x+y=3"), "match");
});

test("같은 연산자 match: x-y=3 vs x−y=3 (유니코드 마이너스)", () => {
  assert.equal(V.checkFormulaSymbols("x-y=3", "x−y=3"), "match");
});

test("같은 연산자 match: a\\times b vs a×b", () => {
  assert.equal(V.checkFormulaSymbols("a\\times b", "a×b"), "match");
});

test("같은 연산자 match: a\\cdot b vs a×b", () => {
  assert.equal(V.checkFormulaSymbols("a\\cdot b", "a×b"), "match");
});

// 연산자가 다르면 mismatch
test("연산자 불일치 mismatch: x-y=3 vs x+y=3", () => {
  assert.equal(V.checkFormulaSymbols("x-y=3", "x+y=3"), "mismatch");
});

test("연산자 불일치 mismatch: a\\le b vs a<b", () => {
  assert.equal(V.checkFormulaSymbols("a\\le b", "a<b"), "mismatch");
});

test("연산자 불일치 mismatch: a\\times b vs a\\div b", () => {
  assert.equal(V.checkFormulaSymbols("a\\times b", "a\\div b"), "mismatch");
});

test("연산자 불일치 mismatch: x=3 vs x<3", () => {
  assert.equal(V.checkFormulaSymbols("x=3", "x<3"), "mismatch");
});

// 기존 동작 유지
test("기존 동작 유지 match: \\frac{a}{b} vs a/b", () => {
  assert.equal(V.checkFormulaSymbols("\\frac{a}{b}", "a/b"), "match");
});
