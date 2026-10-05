const test = require("node:test"), assert = require("node:assert/strict"), lf = require("./library-folder"), { memoryAdapter } = require("./package-store");
const NOTE = '{"format":"summrizei-note","version":2}', NAME = "자료구조-pkg-1.summrizei";
// 폴더 핸들 흉내: 권한 상태와 쓰인 파일을 들고 있다. 실제 브라우저에서는 FileSystemDirectoryHandle 이다.
function dir(perm = "granted") {
  const files = new Map(), d = {
    kind: "directory", name: "Summrizei", perm, files,
    async queryPermission() { return d.perm; },
    async requestPermission() { return d.perm === "denied" ? "denied" : (d.perm = "granted"); },
    async getFileHandle(n, o) {
      if (!files.has(n) && !o?.create) throw new Error("NotFound");
      return { async createWritable() { let buf = ""; return { async write(t) { buf += t; }, async close() { files.set(n, buf); }, async abort() {} }; } };
    },
  };
  return d;
}
const picker = d => async () => d;

test("pick stores the folder; status reports none / ok / needs-permission", async () => {
  const a = memoryAdapter(), d = dir();
  assert.deepEqual(await lf.status(a), { state: "none", name: "" });
  assert.deepEqual(await lf.pick(a, picker(d)), { state: "ok", name: "Summrizei" });
  assert.deepEqual(await lf.status(a), { state: "ok", name: "Summrizei" });
  d.perm = "prompt";
  assert.equal((await lf.status(a)).state, "needs-permission");
  assert.equal((await lf.regrant(a)).state, "ok");
});
test("pick fails without write permission and stores nothing", async () => {
  const a = memoryAdapter();
  await assert.rejects(lf.pick(a, picker(dir("denied"))));
  assert.equal((await lf.status(a)).state, "none");
});
test("write puts the file in the chosen folder, overwriting the same name", async () => {
  const a = memoryAdapter(), d = dir();
  await lf.pick(a, picker(d));
  await lf.write(a, NAME, NOTE);
  await lf.write(a, NAME, NOTE + " ");
  assert.equal(d.files.size, 1);
  assert.equal(d.files.get(NAME), NOTE + " ");
});
test("write refuses without a folder or permission, and bad names or bodies", async () => {
  const a = memoryAdapter(), d = dir();
  await assert.rejects(lf.write(a, NAME, NOTE), { code: "no-folder" });
  await lf.pick(a, picker(d));
  d.perm = "prompt";
  await assert.rejects(lf.write(a, NAME, NOTE), { code: "no-permission" });
  assert.equal(d.files.size, 0);
  d.perm = "granted";
  for (const bad of ["../x.summrizei", "a/b.summrizei", "x.txt", ""]) await assert.rejects(lf.write(a, bad, NOTE), /올바르지/);
  await assert.rejects(lf.write(a, NAME, "{}"), /올바르지/);
});
test("clear forgets the folder", async () => {
  const a = memoryAdapter();
  await lf.pick(a, picker(dir()));
  await lf.clear(a);
  assert.equal((await lf.status(a)).state, "none");
});
