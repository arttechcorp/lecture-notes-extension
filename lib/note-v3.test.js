// lib/note-v3.js — sol-luna-3 모드 판별과 devNoteV3 옵션 정규화.
const test = require("node:test"), assert = require("node:assert/strict");
const { isV3, isLunaV2, v3Options } = require("./note-v3.js");

test("isV3·isLunaV2: sol-luna-3 은 v3 이고 Luna 계열 v2 경로를 탄다", () => {
  assert.equal(isV3("sol-luna-3"), true);
  for (const m of [null, "", "sol-luna-2", "sol-fork-2", "independent"]) assert.equal(isV3(m), false, String(m));
  for (const m of ["sol-luna-2", "sol-luna-3"]) assert.equal(isLunaV2(m), true, m);
  for (const m of [null, "sol-fork-2", "sol-fork", "independent"]) assert.equal(isLunaV2(m), false, String(m));
});

test("v3Options: 모르는 값·없는 키는 기본(repair=packet, resume=false)으로 떨어진다", () => {
  for (const raw of [undefined, null, "x", 42, [], { repair: "bogus", resume: "yes" }])
    assert.deepEqual(v3Options(raw), { repair: "packet", resume: false }, JSON.stringify(raw));
  assert.deepEqual(v3Options({ repair: "full-p" }), { repair: "full-p", resume: false });
  assert.deepEqual(v3Options({ resume: true }), { repair: "packet", resume: true });
  assert.deepEqual(v3Options({ repair: "full-p", resume: true, extra: 1 }), { repair: "full-p", resume: true }, "모르는 키는 버린다");
});
