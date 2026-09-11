// lib/theme.js 분기 확인. chrome / matchMedia / document를 최소한으로 흉내낸다.
const assert = require("assert");

const storeListeners = [];
let onStorageRead;
const root = { dataset: {} };

global.matchMedia = () => ({ matches: true, addEventListener: () => {} }); // OS = dark
global.document = { documentElement: root };
global.chrome = {
  storage: {
    local: { get: (_key, cb) => (onStorageRead = cb) },
    onChanged: { addListener: (fn) => storeListeners.push(fn) },
  },
};

require("./theme.js");

assert.strictEqual(root.dataset.theme, "dark", "저장값 도착 전에는 OS 설정을 쓴다");

onStorageRead({ theme: "light" });
assert.strictEqual(root.dataset.theme, "light", "저장된 선택이 OS 설정을 이긴다");

storeListeners[0]({ theme: { newValue: "system" } }, "local");
assert.strictEqual(root.dataset.theme, "dark", "system으로 되돌리면 다시 OS 설정");

storeListeners[0]({ theme: { newValue: "light" } }, "sync");
assert.strictEqual(root.dataset.theme, "dark", "local 외 영역 변경은 무시한다");

console.log("theme: all tests passed");
