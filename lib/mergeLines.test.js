const assert = require("assert");
const { mergeLines, zipEntries, formatTime } = require("./mergeLines.js");

const e = (time, text) => ({ time, text });

// 같은 시각의 정확히 중복된 입력만 생략한다.
assert.deepStrictEqual(mergeLines([e(2, "안녕하세요")], [e(2, "안녕하세요")]), [e(2, "안녕하세요")]);

// 대소문자는 수식의 의미를 바꿀 수 있으므로 보존한다.
assert.deepStrictEqual(mergeLines([e(10, "  Hello World ")], [e(2, "hello world")]), [e(2, "hello world"), e(10, "Hello World")]);

// 새로운 줄은 추가됨 (타임스탬프 보존)
assert.deepStrictEqual(mergeLines([e(30, "둘째 줄")], [e(5, "첫째 줄")]), [e(5, "첫째 줄"), e(30, "둘째 줄")]);

// 빈 문자열/공백만 있는 OCR 결과는 무시
assert.deepStrictEqual(mergeLines([e(1, ""), e(2, "   ")], [e(0, "첫째 줄")]), [e(0, "첫째 줄")]);

// 빈 스크립트에서 시작
assert.deepStrictEqual(mergeLines([e(0, "첫 줄")], []), [e(0, "첫 줄")]);

// OCR이 요청보다 적게 돌려준 경우 — 짧은 쪽에 맞춰 잘림 (크래시 없음)
assert.deepStrictEqual(zipEntries(["a"], [1, 2, 3]), [e(1, "a")]);
// OCR이 더 많이 돌려준 경우도 마찬가지
assert.deepStrictEqual(zipEntries(["a", "b", "c"], [1]), [e(1, "a")]);
// null 항목이 섞여도 문자열로 강제
assert.deepStrictEqual(zipEntries([null], [7]), [e(7, "")]);

assert.strictEqual(formatTime(0), "00:00");
assert.strictEqual(formatTime(75), "01:15");
assert.strictEqual(formatTime(3661), "61:01");

console.log("mergeLines: all tests passed");

assert.equal(mergeLines([e(10, "동일한 강조")], [e(2, "동일한 강조")]).length, 2);
