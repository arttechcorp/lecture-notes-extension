// 개발용 키 파일 파서.
//
// 설정 화면에 매번 키를 붙여넣지 않으려고 확장 폴더의 apikey.env.local 을 읽는다.
// 사람이 손으로 만드는 파일이라 모양이 제각각이다 — "KEY=값", 값만, 따옴표,
// 주석, 앞뒤 공백. 잘못 파싱하면 증상이 "키가 없습니다"로만 나타나서 원인을
// 찾기 어렵다.
const assert = require("assert");
const { parseDevKey } = require("./settings.js");

for (const [raw, want, why] of [
  ["OPENROUTER_API_KEY=sk-or-v1-abc", "sk-or-v1-abc", "KEY=값"],
  ["sk-or-v1-bare", "sk-or-v1-bare", "값만 적은 경우"],
  ['KEY="sk-ant-quoted"', "sk-ant-quoted", "큰따옴표"],
  ["KEY='sk-ant-single'", "sk-ant-single", "작은따옴표"],
  ["  KEY = sk-or-spaced  ", "sk-or-spaced", "앞뒤 공백"],
  ["# 주석\nKEY=sk-or-after-comment", "sk-or-after-comment", "주석 다음 줄"],
  ["KEY=sk-or-first\nKEY=sk-or-second", "sk-or-first", "여러 줄이면 첫 줄"],
  ["", "", "빈 파일"],
  ["   \n\n  ", "", "공백만"],
  ["# 주석만 있음", "", "주석뿐"],
  [null, "", "null"],
  [undefined, "", "undefined"],
  ["\uFEFFOPENROUTER_API_KEY=sk-or-bom", "sk-or-bom", "BOM 포함"],
  ["s\0k\0-\0o\0r\0-\0p\0w\0s\0h\0", "sk-or-pwsh", "PowerShell UTF-16LE 널 바이트"],
  ["\uFFFD\uFFFDs\0k\0-\0o\0r\0-\0b\0o\0m\0", "sk-or-bom", "PowerShell UTF-16LE BOM 대체 문자"],
]) {
  assert.strictEqual(parseDevKey(raw), want, why);
}

// base64 키에 "=" 가 들어가도 첫 "=" 뒤 전체를 값으로 본다.
assert.strictEqual(parseDevKey("KEY=abc=def=="), "abc=def==", "값 안의 = 를 잘라먹는다");

console.log("devkey: all tests passed (15케이스 + 등호 포함 값)");
