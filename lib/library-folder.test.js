const test = require("node:test"), assert = require("node:assert/strict"), lf = require("./library-folder"), { memoryAdapter } = require("./package-store");
const NOTE = '{"format":"summrizei-note","version":2}', NAME = "자료구조-pkg-1.summrizei";
// 폴더 핸들 흉내: 권한 상태와 쓰인 파일을 들고 있다. 실제 브라우저에서는 FileSystemDirectoryHandle 이다.
function dir(perm = "granted") {
  const files = new Map(), d = {
    kind: "directory", name: "Summrizei", perm, files,
    async queryPermission() { return d.perm; },
    async requestPermission() { return d.perm === "denied" ? "denied" : (d.perm = "granted"); },
    async getDirectoryHandle(n) { return { ...d, getFileHandle: (x, o) => d.getFileHandle(n + "/" + x, o), async *entries() { for (const k of files.keys()) if (k.startsWith(n + "/")) yield [k.slice(n.length + 1), { kind: "file" }]; } }; },
    async *entries() { for (const n of files.keys()) if (!n.includes("/")) yield [n, { kind: "file" }]; yield ["sub", { kind: "directory" }]; },
    async getFileHandle(n, o) {
      if (!files.has(n) && !o?.create) throw new Error("NotFound");
      return { async getFile() { const t = files.get(n); return { size: t.length, text: async () => t }; }, async createWritable() { let buf = ""; return { async write(t) { buf += t; }, async close() { files.set(n, buf); }, async abort() {} }; } };
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

test("list and read give the web page only .summrizei names and their text, and need permission", async () => {
  const a = memoryAdapter(), d = dir();
  await assert.rejects(lf.list(a), { code: "no-folder" });
  await lf.pick(a, picker(d));
  await lf.write(a, NAME, NOTE);
  d.files.set("memo.txt", "x"); // 다른 파일은 보이지 않는다
  assert.deepEqual(await lf.list(a), { folder: "Summrizei", names: [NAME] });
  d.files.set("sub/" + NAME, NOTE); // 과목 하위 폴더의 노트도 "과목/이름"으로 보인다
  assert.deepEqual((await lf.list(a)).names, ["sub/" + NAME, NAME].sort());
  assert.equal(await lf.read(a, "sub/" + NAME), NOTE);
  d.files.delete("sub/" + NAME);
  assert.equal(await lf.read(a, NAME), NOTE);
  for (const bad of ["memo.txt", "../x.summrizei", "a/b/c.summrizei", ".hid/x.summrizei"]) await assert.rejects(lf.read(a, bad), /올바르지/);
  await assert.rejects(lf.read(a, NAME, 3), /너무 큽니다/);
  d.perm = "prompt";
  await assert.rejects(lf.list(a), { code: "no-permission" });
  await assert.rejects(lf.read(a, NAME), { code: "no-permission" });
});

test("writeFile/readFile keep to the folder layout: notes, data/, diagnostics/, settings.json only", async () => {
  const a = memoryAdapter(), d = dir();
  await lf.pick(a, picker(d));
  await lf.writeFile(a, "data/pkg_1.srzdata", '{"format":"summrizei-data"}');
  await lf.writeFile(a, "diagnostics/summrizei-diagnostic-2026-10-05-job-12345678.json", "{}");
  assert.equal(lf.dataPath("pkg:1"), "data/pkg_1.srzdata");
  for (const [p, t] of [["data/x.txt", "{}"], ["../settings.json", "{}"], ["other/x.srzdata", '{"format":"summrizei-data"}'], ["data/pkg.srzdata", '{"format":"summrizei-note"}'], ["a/b/c.summrizei", "{}"]])
    await assert.rejects(lf.writeFile(a, p, t), /올바르지/, p);
  assert.equal(await lf.readFile(a, "data/pkg_1.srzdata"), '{"format":"summrizei-data"}');
  assert.ok(d.files.has("diagnostics/summrizei-diagnostic-2026-10-05-job-12345678.json"));
});

test("settings backup holds only the non-sensitive keys; adoptSettings brings a backup in or writes the current one", async () => {
  // 하위 폴더가 필요 없는 settings.json 만 쓰므로 단순 흉내로 충분하다.
  const a = memoryAdapter(), d = dir();
  await lf.pick(a, picker(d));
  const saved = [];
  assert.equal(await lf.adoptSettings(a, async () => ({ theme: "dark", whisperLang: "en", authSession: { secret: 1 }, visionConsent: true, appSessionToken: "t" }), async s => saved.push(s)), false, "백업이 없으면 지금 설정을 쓴다");
  const file = JSON.parse(d.files.get("settings.json"));
  assert.deepEqual(file, { v: 1, settings: { theme: "dark", whisperLang: "en" } }, "동의·로그인·토큰은 백업하지 않는다");
  assert.equal(await lf.adoptSettings(a, async () => ({}), async s => saved.push(s)), true);
  assert.deepEqual(saved, [{ theme: "dark", whisperLang: "en" }]);
  d.files.set("settings.json", JSON.stringify({ v: 1, settings: { theme: "light", remoteSummaryConsent: true } }));
  assert.deepEqual(await lf.readSettings(a), { theme: "light" }, "파일에 끼워 넣은 동의 키는 버린다");
  d.files.set("settings.json", "not json");
  assert.equal(await lf.readSettings(a), null);
});

test("write with a course puts the file one subfolder down, creating it; bad course names are refused", async () => {
  const a = memoryAdapter(), d = dir(), subs = new Map();
  d.getDirectoryHandle = async (n, o) => { if (!subs.has(n) && o?.create) subs.set(n, dir()); return subs.get(n); };
  await lf.pick(a, picker(d));
  await lf.write(a, NAME, NOTE, "회로이론");
  assert.equal(d.files.size, 0);
  assert.equal(subs.get("회로이론").files.get(NAME), NOTE);
  for (const bad of ["..", "a/b", ".hidden", "trail.", "x".repeat(41), 7]) await assert.rejects(lf.write(a, NAME, NOTE, bad), String(bad));
  await lf.write(a, NAME, NOTE, "");
  assert.equal(d.files.get(NAME), NOTE, "과목이 없으면 보관함 폴더에 바로 쓴다");
});
test("pick: the picker opens at the folder chosen before; picking a plain folder (e.g. 문서) makes and uses its Summrizei subfolder", async () => {
  const a = memoryAdapter(), docs = { ...dir(), name: "Documents" }, sub = dir(), seen = [];
  docs.getDirectoryHandle = async (n, o) => (seen.push([n, o?.create]), sub);
  docs.queryPermission = async () => "granted"; docs.requestPermission = async () => "granted";
  docs.entries = async function* () { yield ["memo.txt", { kind: "file" }]; };
  const opts = [];
  assert.deepEqual(await lf.pick(a, async o => (opts.push(o), docs)), { state: "ok", name: "Summrizei" });
  assert.deepEqual(seen, [["Summrizei", true]]);
  assert.equal(opts[0].startIn, "documents");
  await lf.pick(a, async o => (opts.push(o), sub));
  assert.equal(opts[1].startIn, sub, "두 번째부터는 고른 폴더에서 열린다");
});
