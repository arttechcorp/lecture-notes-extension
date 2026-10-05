// 사용자가 온보딩에서 한 번 고른 보관함 폴더. 폴더 핸들은 이 기기 IndexedDB(keys 저장소)에만 두고, 완성된 노트 파일(암호문)은 그 뒤로 확인 없이 여기에 바로 쓴다.
// 권한은 브라우저가 쥔다: 고른 직후나 "다시 허용"을 누르면 granted, 브라우저가 권한을 거두면 prompt 가 되어 쓰기를 멈추고 사용자의 한 번 클릭(regrant)을 기다린다.
(() => {
  const ID = "libraryFolder", RW = { mode: "readwrite" };
  const NAME_RE = /^[^/\\:*?"<>|\x00-\x1f\x7f]{1,200}\.summrizei$/;
  const COURSE_RE = /^(?![. ])[^/\\:*?"<>|\x00-\x1f\x7f]{1,40}(?<![. ])$/;
  const isHandle = h => h !== null && typeof h === "object" && h.kind === "directory" && typeof h.queryPermission === "function";
  const load = async adapter => { const r = await adapter.get("keys", ID); return isHandle(r?.handle) ? r : null; };

  // 사용자 클릭 안에서만 부른다(폴더 선택 창). 취소하면 AbortError 가 그대로 올라간다.
  // 선택 창은 전에 고른 폴더(없으면 문서 폴더)에서 열린다 — 확인만 누르면 된다. 고른 폴더가 보관함이 아니면(이름이 Summrizei 가 아니고
  // 노트·data 폴더도 없으면) 그 안에 Summrizei 폴더를 만들어 쓴다: 문서 폴더에서 확인만 눌러도 문서/Summrizei 가 보관함이 된다.
  const HOME = "Summrizei";
  async function isLibrary(h) {
    if (h.name === HOME) return true;
    for await (const [name, e] of h.entries()) if ((e.kind === "file" && NAME_RE.test(name)) || (e.kind === "directory" && name === "data")) return true;
    return false;
  }
  async function pick(adapter, picker = globalThis.showDirectoryPicker?.bind(globalThis)) {
    if (!picker) throw new Error("이 브라우저는 폴더 저장을 지원하지 않습니다.");
    const prev = await load(adapter).catch(() => null);
    let handle = await picker({ id: "summrizei-library", mode: "readwrite", startIn: prev?.handle ?? "documents" });
    if (await handle.requestPermission(RW) !== "granted") throw new Error("폴더 쓰기 권한이 필요합니다.");
    if (!(await isLibrary(handle))) handle = await handle.getDirectoryHandle(HOME, { create: true });
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
  // 보관함 폴더 배치(이 밖의 경로는 쓰지도 읽지도 않는다):
  //   [<과목>/]<제목>-<packageId>.summrizei   노트(암호문) — 웹 /library 가 연다. 과목(NoteFile.courseFolder)이 있으면 한 단계 하위 폴더
  //   data/<packageId>.srzdata       다시 만들기 자료 백업(암호문: 메타·재생성 입력·노트·인식 결과·크롭) — 재설치·다른 기기에서 복원
  //   diagnostics/summrizei-diagnostic-<날짜>-<jobId>.json   작업별 진단 기록(내용 없는 이벤트)
  //   settings.json                  비민감 설정 백업(동의·로그인·키는 넣지 않는다)
  const KINDS = [
    { dir: null, re: NAME_RE, head: '{"format":"summrizei-note"' },
    { dir: "data", re: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.srzdata$/, head: '{"format":"summrizei-data"' },
    { dir: "diagnostics", re: /^summrizei-diagnostic-\d{4}-\d{2}-\d{2}-[A-Za-z0-9-]{8,64}\.json$/, head: "{" },
    { dir: null, re: /^settings\.json$/, head: "{" },
  ];
  const BAD = "보관함 파일 요청이 올바르지 않습니다.";
  // "dir/name" 또는 "name" → {kind, dir, name}. 규칙 밖이면 던진다.
  function parse(path) {
    if (typeof path !== "string") throw new Error(BAD);
    const i = path.indexOf("/"), dir = i < 0 ? null : path.slice(0, i), name = i < 0 ? path : path.slice(i + 1);
    const kind = KINDS.find(k => k.dir === dir && k.re.test(name)) || (dir !== null && COURSE_RE.test(dir) && NAME_RE.test(name) ? KINDS[0] : null);
    if (!kind) throw new Error(BAD);
    return { kind, dir, name };
  }
  // 권한을 새로 묻지는 않는다 — 없으면 "no-folder", 거둬졌으면 "no-permission" 코드로 던지고 사용자가 패널·옵션에서 다시 허용한다.
  async function granted(adapter) {
    const rec = await load(adapter), fail = code => Object.assign(new Error(code), { code });
    if (!rec) throw fail("no-folder");
    if (await rec.handle.queryPermission(RW).catch(() => "denied") !== "granted") throw fail("no-permission");
    return rec;
  }
  const dirOf = (rec, dir, create) => dir ? rec.handle.getDirectoryHandle(dir, { create }) : rec.handle;
  // 같은 이름은 덮어쓴다(임시 파일에 쓴 뒤 바꿔치기). 하위 폴더는 없으면 만든다.
  async function writeFile(adapter, path, text) {
    const { kind, dir, name } = parse(path);
    if (typeof text !== "string" || !text.startsWith(kind.head) || text.length > 40 * 1024 * 1024) throw new Error(BAD);
    const rec = await granted(adapter);
    const file = await (await dirOf(rec, dir, true)).getFileHandle(name, { create: true }), w = await file.createWritable();
    try { await w.write(text); await w.close(); } catch (e) { await w.abort().catch(() => {}); throw e; }
  }
  // 없는 파일은 null.
  async function readFile(adapter, path, max = 40 * 1024 * 1024) {
    const { dir, name } = parse(path), rec = await granted(adapter);
    let file;
    try { file = await (await (await dirOf(rec, dir, false)).getFileHandle(name)).getFile(); }
    catch (e) { if (e?.name === "NotFoundError") return null; throw e; }
    if (file.size > max) throw new Error("보관함 파일이 너무 큽니다.");
    return file.text();
  }
  // 한 폴더(최상위 또는 data·diagnostics)에서 규칙에 맞는 파일 이름만. 하위 폴더가 아직 없으면 [].
  // ponytail: 500개에서 자른다 — 그보다 많으면 페이지 나누기를 더한다.
  async function listDir(adapter, dir, re) {
    const rec = await granted(adapter), names = [];
    let h;
    try { h = await dirOf(rec, dir, false); } catch (e) { if (e?.name === "NotFoundError") return []; throw e; }
    for await (const [name, e] of h.entries()) if (e.kind === "file" && re.test(name) && names.push(name) >= 500) break;
    return names.sort();
  }

  // 노트(.summrizei) 전용 — 오프스크린 내보내기와 웹 /library 가 쓴다. course 가 있으면 그 하위 폴더(없으면 만든다).
  const NOTE_BAD = "노트 파일 요청이 올바르지 않습니다.";
  const notePath = path => { try { return parse(path).kind === KINDS[0]; } catch { return false; } };
  async function write(adapter, name, text, course = "") {
    if (typeof name !== "string" || !NAME_RE.test(name) || typeof course !== "string" || (course && !COURSE_RE.test(course))) throw new Error(NOTE_BAD);
    try { return await writeFile(adapter, course ? `${course}/${name}` : name, text); }
    catch (e) { if (e.message === BAD) throw new Error(NOTE_BAD); throw e; }
  }
  // 최상위와 과목 하위 폴더(한 단계, data·diagnostics 제외)의 노트 경로("이름" 또는 "과목/이름").
  async function list(adapter) {
    const rec = await granted(adapter), names = await listDir(adapter, null, NAME_RE);
    for await (const [dir, e] of rec.handle.entries()) {
      if (e.kind !== "directory" || !COURSE_RE.test(dir) || dir === "data" || dir === "diagnostics" || names.length >= 500) continue;
      for (const n of await listDir(adapter, dir, NAME_RE)) names.push(`${dir}/${n}`);
    }
    return { folder: rec.name, names: names.slice(0, 500).sort() };
  }
  async function read(adapter, name, max) {
    if (!notePath(name)) throw new Error(NOTE_BAD);
    const text = await readFile(adapter, name, max).catch(e => { throw e.message === "보관함 파일이 너무 큽니다." ? new Error("노트 파일이 너무 큽니다.") : e; });
    if (text === null) throw new Error("노트 파일이 없습니다.");
    return text;
  }
  // 다시 만들기 자료 백업 파일 이름. packageId 의 ':' 같은 파일명 금지 문자는 '_' 로 — 진짜 id 는 암호문 안에 있다.
  const dataPath = packageId => `data/${String(packageId).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 128)}.srzdata`;
  const listData = adapter => listDir(adapter, "data", KINDS[1].re).then(n => n.map(x => "data/" + x));

  // 비민감 설정만 백업·복원한다. 동의·로그인·서비스 주소는 기기마다 사용자가 직접 정한다.
  const SETTINGS_KEYS = ["ocrEnabled", "whisperEnabled", "whisperModel", "whisperLang", "speedCorrection", "theme", "noteOptions"];
  const pickSettings = s => Object.fromEntries(SETTINGS_KEYS.filter(k => s && s[k] !== undefined).map(k => [k, s[k]]));
  const writeSettings = (adapter, settings) => writeFile(adapter, "settings.json", JSON.stringify({ v: 1, settings: pickSettings(settings) }, null, 2));
  // 백업이 없거나 깨졌으면 null. 돌려주는 값은 허용 목록 키뿐이다(검증은 saveSettings 가 한다).
  async function readSettings(adapter) {
    try { const j = JSON.parse(await readFile(adapter, "settings.json", 64 * 1024)); return j?.v === 1 && j.settings && typeof j.settings === "object" ? pickSettings(j.settings) : null; }
    catch { return null; }
  }
  // 폴더를 새로 고른 직후(사용자 클릭 뒤): 폴더에 설정 백업이 있으면 이 기기에 들이고(true), 없으면 지금 설정을 백업한다(false).
  async function adoptSettings(adapter, load, save) {
    const saved = await readSettings(adapter);
    if (saved) { await save(saved); return true; }
    await writeSettings(adapter, await load()).catch(() => {});
    return false;
  }
  // 설정 화면·패널에서 비민감 설정이 바뀌면 0.5초 모아 settings.json 에 쓴다. 폴더·권한이 없으면 조용히 건너뛴다.
  function watchSettings(getAdapter, load) {
    let timer = null;
    globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
      if (area !== "local" || !SETTINGS_KEYS.some(k => k in changes)) return;
      clearTimeout(timer);
      timer = setTimeout(async () => { try { await writeSettings(await getAdapter(), await load()); } catch { /* 폴더 없음·권한 없음 */ } }, 500);
    });
  }
  const clear = adapter => adapter.delete("keys", ID);

  const api = { pick, status, regrant, write, list, read, writeFile, readFile, dataPath, listData, writeSettings, readSettings, adoptSettings, watchSettings, SETTINGS_KEYS, clear };
  globalThis.LibraryFolder = api;
  if (typeof module !== "undefined") module.exports = api;
})();
