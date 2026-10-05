// 사용자가 온보딩에서 한 번 고른 보관함 폴더. 폴더 핸들은 이 기기 IndexedDB(keys 저장소)에만 두고, 완성된 노트 파일(암호문)은 그 뒤로 확인 없이 여기에 바로 쓴다.
// 권한은 브라우저가 쥔다: 고른 직후나 "다시 허용"을 누르면 granted, 브라우저가 권한을 거두면 prompt 가 되어 쓰기를 멈추고 사용자의 한 번 클릭(regrant)을 기다린다.
(() => {
  const ID = "libraryFolder", RW = { mode: "readwrite" };
  const NAME_RE = /^[^/\\:*?"<>|\x00-\x1f\x7f]{1,200}\.summrizei$/;
  const isHandle = h => h !== null && typeof h === "object" && h.kind === "directory" && typeof h.queryPermission === "function";
  const load = async adapter => { const r = await adapter.get("keys", ID); return isHandle(r?.handle) ? r : null; };

  // 사용자 클릭 안에서만 부른다(폴더 선택 창). 취소하면 AbortError 가 그대로 올라간다.
  async function pick(adapter, picker = globalThis.showDirectoryPicker?.bind(globalThis)) {
    if (!picker) throw new Error("이 브라우저는 폴더 저장을 지원하지 않습니다.");
    const handle = await picker({ id: "summrizei-library", mode: "readwrite", startIn: "documents" });
    if (await handle.requestPermission(RW) !== "granted") throw new Error("폴더 쓰기 권한이 필요합니다.");
    const rec = { handle, name: String(handle.name || ""), at: Date.now() };
    await adapter.put("keys", ID, rec);
    return { state: "ok", name: rec.name };
  }
  // "none"(고른 폴더 없음) | "needs-permission"(브라우저가 권한을 거둠) | "ok".
  async function status(adapter) {
    const rec = await load(adapter);
    if (!rec) return { state: "none", name: "" };
    const p = await rec.handle.queryPermission(RW).catch(() => "denied");
    return { state: p === "granted" ? "ok" : "needs-permission", name: rec.name };
  }
  // 사용자 클릭 안에서만 부른다: 이미 고른 폴더의 쓰기 권한만 다시 받는다.
  async function regrant(adapter) {
    const rec = await load(adapter);
    if (!rec) return { state: "none", name: "" };
    const p = await rec.handle.requestPermission(RW).catch(() => "denied");
    return { state: p === "granted" ? "ok" : "needs-permission", name: rec.name };
  }
  // 정해진 이름 모양과 머리말만 쓴다. 폴더가 없으면 "no-folder", 권한이 없으면 "no-permission" 코드로 던진다. 같은 이름은 덮어쓴다(임시 파일에 쓴 뒤 바꿔치기).
  async function write(adapter, name, text) {
    if (typeof name !== "string" || !NAME_RE.test(name) || typeof text !== "string" || !text.startsWith('{"format":"summrizei-note"'))
      throw new Error("노트 파일 요청이 올바르지 않습니다.");
    const rec = await load(adapter), fail = code => Object.assign(new Error(code), { code });
    if (!rec) throw fail("no-folder");
    if (await rec.handle.queryPermission(RW).catch(() => "denied") !== "granted") throw fail("no-permission");
    const file = await rec.handle.getFileHandle(name, { create: true }), w = await file.createWritable();
    try { await w.write(text); await w.close(); } catch (e) { await w.abort().catch(() => {}); throw e; }
  }
  const clear = adapter => adapter.delete("keys", ID);

  const api = { pick, status, regrant, write, clear };
  globalThis.LibraryFolder = api;
  if (typeof module !== "undefined") module.exports = api;
})();
