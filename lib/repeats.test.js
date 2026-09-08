const assert = require("assert");
const { collapseRepeats } = require("./repeats.js");

const t = (s) => collapseRepeats(s).text;

// 실제로 관측된 루프
const loop = "그 다음에는 " + "제가 얘기하면 ".repeat(140).trim();
assert.strictEqual(t(loop), "그 다음에는 제가 얘기하면 제가 얘기하면");
assert.ok(collapseRepeats(loop).removed > 200);

// 한 단어 루프
assert.strictEqual(t("네 네 네 네 네 네 네"), "네 네");

// 정당한 반복 두 번까지는 남긴다
assert.strictEqual(t("네 네 알겠습니다"), "네 네 알겠습니다");

// 띄어쓰기 없이 붙은 반복
assert.strictEqual(t("감사합니다감사합니다감사합니다감사합니다"), "감사합니다감사합니다");

// 긴 구절 반복
assert.strictEqual(
  t("오늘은 현금흐름을 봅니다 현금흐름을 봅니다 현금흐름을 봅니다 현금흐름을 봅니다"),
  "오늘은 현금흐름을 봅니다 현금흐름을 봅니다"
);

// 정상 문장은 건드리지 않는다
const ok = "이 프로젝트의 순현재가치는 할인율에 따라 크게 달라집니다";
assert.strictEqual(t(ok), ok);
assert.strictEqual(collapseRepeats(ok).removed, 0);

// 반복처럼 보이지만 아닌 것 — 인접하지 않으면 안 건드린다
assert.strictEqual(t("비용 대비 편익 그리고 편익 대비 비용"), "비용 대비 편익 그리고 편익 대비 비용");

// 경계값
assert.strictEqual(t(""), "");
assert.strictEqual(t("단어"), "단어");

console.log("repeats: all tests passed");
