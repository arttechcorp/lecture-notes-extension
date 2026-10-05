// 내 노트 페이지: .summrizei 파일을 브라우저 안에서 복호화해 목록과 노트를 보여준다.
// 파일은 확장 프로그램의 보관함 폴더에서 자동으로 받는다(library-bridge.js 콘텐츠 스크립트 — 암호문만 건넨다). 확장이 없는 브라우저에서만 폴더를 직접 고른다.
// 열쇠는 로그인한 계정의 노트 키(서비스 library_key())다 — 별도 비밀번호는 없다. 복호화 결과·키는 메모리에만 두고
// 잠그기·로그아웃으로 전부 버린다. 이 페이지는 어떤 저장소에도 노트나 키를 쓰지 않는다(로그인 세션은 supabase-js 가 따로 둔다). 저장 문자열은 전부 textContent/DOM
// 으로만 넣고, 렌더러가 돌려주는 이스케이프된 HTML 만 innerHTML 로 둔다.
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const MAX = NoteFile.MAX_FILE || 40 * 1024 * 1024;
  const EXT = NoteFile.EXT || ".summrizei";

  const drop = $("drop"), folderBtn = $("folderBtn"), filesBtn = $("filesBtn");
  const folderInput = $("folderInput"), filesInput = $("filesInput");
  const fileStatus = $("fileStatus"), authText = $("authText"), loginBtn = $("loginBtn"), logoutBtn = $("logoutBtn");
  const reopenBtn = $("reopenBtn"), keyStatus = $("keyStatus"), failList = $("failList");
  const stepFile = $("stepFile"), stepKey = $("stepKey"), openBar = $("openBar");
  const openCount = $("openCount"), addBtn = $("addBtn");
  const listView = $("listView"), cards = $("cards"), noteView = $("noteView");
  const backLink = $("backLink"), noteTitle = $("noteTitle"), noteContent = $("noteContent");
  const answersSel = $("answersSel"), examCb = $("examCb"), writingCb = $("writingCb");
  const warnCount = $("warnCount"), lockBtn = $("lockBtn"), mdBtn = $("mdBtn"), pdfBtn = $("pdfBtn");

  // 노트 양식 CSS는 한 번만 넣는다 — 렌더러가 만드는 DOM은 항상 라이트 종이 토큰이다.
  const specStyle = document.createElement("style");
  specStyle.textContent = NoteSpec.css;
  document.head.appendChild(specStyle);

  const files = [];              // {name, text} — 암호문 원문(잠그면 함께 버림)
  let client = null;             // supabase-js 클라이언트(로그인·키 조회용)
  let session = null;            // 지금 로그인 세션(없으면 null)
  let key = null;                // 이 계정의 노트 키(CryptoKey, 메모리만)
  const entries = new Map();     // packageId → {meta, note, crops}
  let skipped = 0;
  let current = null;            // 지금 열린 {meta, note, crops}
  let busy = false;
  let adding = false;            // 이미 연 노트가 있는데 파일을 더 불러오는 중
  let manual = false;            // 확장에서 받지 못해 폴더를 직접 고르는 중
  let lastCard = null;           // 노트에서 목록으로 돌아갈 때 포커스를 돌려줄 카드

  // h:mm:ss(1시간 이상) 또는 m:ss. durationSec가 null이면 빈 문자열.
  const fmtDur = s => {
    if (s == null || !Number.isFinite(s)) return "";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  };
  const fmtDate = iso => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  };
  // 다운로드 파일명: 경로·제어 문자를 빼고 80자로 자른다.
  const safeName = s => (s || "note").replace(/[/\\:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "note";

  const okFile = f => f.name.toLowerCase().endsWith(EXT) && f.size <= MAX;

  function paintFiles() {
    fileStatus.textContent = files.length
      ? `파일 ${files.length}개${skipped ? ` · 건너뜀 ${skipped}개` : ""}`
      : "";
    reopenBtn.hidden = !session || busy || entries.size > 0;
  }

  async function addFiles(list) {
    const seen = new Set(files.map(f => f.name));
    for (const f of list) {
      if (!f || !okFile(f)) { skipped++; continue; }
      if (seen.has(f.name)) continue;
      seen.add(f.name);
      try { files.push({ name: f.name, text: await f.text() }); }
      catch { skipped++; }
    }
    paintFiles();
    if (session && files.length) await openFiles();
  }

  folderBtn.addEventListener("click", () => folderInput.click());
  filesBtn.addEventListener("click", () => filesInput.click());
  folderInput.addEventListener("change", () => { addFiles([...folderInput.files]); folderInput.value = ""; });
  filesInput.addEventListener("change", () => { addFiles([...filesInput.files]); filesInput.value = ""; });

  // 폴더째 드롭은 webkitGetAsEntry로 안쪽 파일까지 읽는다.
  function entryFiles(entry, out) {
    return new Promise(resolve => {
      if (entry.isFile) return entry.file(f => { out.push(f); resolve(); }, resolve);
      if (!entry.isDirectory) return resolve();
      const reader = entry.createReader();
      const read = () => reader.readEntries(async batch => {
        if (!batch.length) return resolve();
        for (const e of batch) await entryFiles(e, out);
        read();
      }, resolve);
      read();
    });
  }
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", e => { if (!drop.contains(e.relatedTarget)) drop.classList.remove("over"); });
  drop.addEventListener("drop", async e => {
    e.preventDefault();
    drop.classList.remove("over");
    const got = [];
    const items = [...(e.dataTransfer.items || [])].filter(it => it.kind === "file");
    if (items.length) {
      for (const it of items) {
        const entry = it.webkitGetAsEntry && it.webkitGetAsEntry();
        if (entry) await entryFiles(entry, got);
        else { const f = it.getAsFile(); if (f) got.push(f); }
      }
    }
    await addFiles(got.length ? got : [...e.dataTransfer.files]);
  });

  const fail = (name, err) => {
    const li = document.createElement("li");
    li.textContent = `${name}: ${err && err.message ? err.message : String(err)}`;
    failList.append(li);
  };

  const opts = () => ({ answers: answersSel.value, exam: examCb.checked, writing: writingCb.checked });

  function render(medium) {
    if (!current) return false;
    try {
      const { html, warnings } = NoteRender.renderNote(current.note, {
        katex: globalThis.katex, crops: current.crops, options: { ...opts(), medium },
      });
      noteContent.innerHTML = html;
      warnCount.hidden = !warnings.length;
      warnCount.textContent = warnings.length ? `표시하지 못한 항목 ${warnings.length}개` : "";
      return true;
    } catch {
      noteContent.textContent = "노트를 표시하지 못했습니다.";
      warnCount.hidden = true;
      return false;
    }
  }

  // 노트가 하나라도 열려 있으면 1·2단계를 접고 간결한 열림 표시줄을 단다.
  // 노트를 보는 동안에는 목록과 "파일 더 불러오기"를 숨긴다.
  function paintChrome() {
    const unlocked = entries.size > 0;
    stepKey.hidden = unlocked && !adding;
    stepFile.hidden = !(manual || adding) || (unlocked && !adding);
    openBar.hidden = !unlocked;
    openCount.textContent = `노트 ${entries.size}개 열림`;
    addBtn.hidden = !noteView.hidden;
  }

  function paintList() {
    // 과목별로 묶고(과목 없는 노트는 맨 뒤), 과목 안에서는 최근 것부터.
    const course = e => e.meta?.course || "";
    const list = [...entries.values()].sort((a, b) =>
      (!course(a) - !course(b)) || course(a).localeCompare(course(b), "ko") ||
      String(b.meta?.updatedAt ?? "").localeCompare(String(a.meta?.updatedAt ?? "")));
    const grouped = list.some(course);
    cards.textContent = "";
    let group = null;
    for (const e of list) {
      const m = e.meta || {};
      if (grouped && course(e) !== group) {
        group = course(e);
        const g = document.createElement("h2");
        g.className = "course-head";
        g.textContent = group || "과목 없음";
        cards.append(g);
      }
      const c = document.createElement("button");
      c.type = "button";
      c.className = "card";
      const h = document.createElement("h3");
      h.textContent = m.title || "제목 없는 강의";
      const meta = document.createElement("div");
      meta.className = "meta";
      const span = t => { const s = document.createElement("span"); s.textContent = t; meta.append(s); };
      if (m.host) span(m.host);
      const when = fmtDate(m.createdAt || m.updatedAt);
      if (when) span(when);
      const dur = fmtDur(m.durationSec);
      if (dur) span(dur);
      if (m.counts) {
        if (m.counts.sections != null) span(`섹션 ${m.counts.sections}`);
        if (m.counts.questions != null) span(`문제 ${m.counts.questions}`);
      }
      c.append(h, meta);
      c.addEventListener("click", () => { lastCard = c; openNote(e); });
      cards.append(c);
    }
    listView.hidden = !list.length;
    paintChrome();
  }

  function openNote(e) {
    current = e;
    noteTitle.textContent = e.meta?.title || "제목 없는 강의";
    listView.hidden = true;
    noteView.hidden = false;
    paintChrome();
    window.scrollTo(0, 0);
    render("web");
    noteTitle.focus();
  }

  function closeNote() {
    const back = lastCard;
    lastCard = null;
    current = null;
    noteTitle.textContent = "";
    noteContent.textContent = "";
    warnCount.hidden = true;
    noteView.hidden = true;
    listView.hidden = !entries.size;
    paintChrome();
    if (back && back.isConnected) back.focus();
  }

  // 로그인 상태 표시. 로그아웃되면 열린 노트·키를 모두 잠근다.
  function paintAuth(next) {
    const was = session;
    session = next || null;
    if (was && !session) lock();
    if (!was && session && !entries.size) autoOpen();
    const email = session?.user?.email;
    authText.textContent = session
      ? `${email || "로그인됨"} 계정으로 로그인했습니다.`
      : "노트를 만든 계정으로 로그인하면 확장 프로그램에서 고른 보관함 폴더의 노트가 바로 열립니다. 별도 비밀번호는 없습니다.";
    loginBtn.hidden = !!session;
    logoutBtn.hidden = !session;
    paintFiles();
  }
  async function initAuth() {
    const cfg = window.SUMMRIZEI_SUPABASE;
    if (!cfg || !window.supabase) { authText.textContent = "로그인 기능을 불러오지 못했습니다. 새로고침해 주세요."; return; }
    client = window.supabase.createClient(cfg.url, cfg.anonKey);
    loginBtn.disabled = false;
    client.auth.onAuthStateChange((_event, s) => paintAuth(s));
    const { data } = await client.auth.getSession();
    paintAuth(data.session);
  }
  loginBtn.addEventListener("click", async () => {
    if (!client) return;
    const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
    if (error) authText.textContent = "로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  });
  logoutBtn.addEventListener("click", () => { client?.auth.signOut(); });

  // 확장 프로그램과 주고받기: 같은 창의 콘텐츠 스크립트(library-bridge.js)가 답한다. 확장이 없으면 답이 없어 null.
  function ext(op, name) {
    return new Promise(resolve => {
      const id = crypto.randomUUID();
      const done = v => { clearTimeout(timer); removeEventListener("message", on); resolve(v); };
      const on = e => { if (e.source === window && e.data?.srz === "lib-reply" && e.data.id === id) done(e.data); };
      const timer = setTimeout(() => done(null), op === "list" ? 2500 : 60000);
      addEventListener("message", on);
      postMessage({ srz: "lib", id, op, name }, location.origin);
    });
  }
  const EXT_WHY = {
    "no-folder": "확장 프로그램에서 아직 보관함 폴더를 고르지 않았습니다. 사이드 패널이나 설정에서 폴더를 고르세요.",
    "no-permission": "브라우저가 보관함 폴더 권한을 거뒀습니다. 확장 프로그램 사이드 패널의 '다시 허용'을 누른 뒤 보관함 열기를 누르세요.",
  };
  // 확장의 보관함 폴더에서 파일을 받아 바로 연다. 확장이 없거나 폴더를 못 읽으면 직접 고르기를 연다.
  async function autoOpen() {
    if (busy || !session) return;
    busy = true;
    paintFiles();
    keyStatus.textContent = "보관함 폴더를 여는 중…";
    failList.textContent = "";
    const list = await ext("list");
    if (!list?.ok) {
      busy = false;
      manual = true;
      keyStatus.textContent = list ? (EXT_WHY[list.code] || "보관함 폴더를 읽지 못했습니다.") : "이 브라우저에서 Summrizei 확장 프로그램을 찾지 못했습니다. 아래에서 폴더를 직접 고르세요.";
      paintFiles();
      paintChrome();
      return;
    }
    files.length = 0;
    for (const name of list.names) {
      const r = await ext("read", name);
      if (r?.ok && typeof r.text === "string") files.push({ name, text: r.text });
      else fail(name, new Error("파일을 읽지 못했습니다."));
    }
    busy = false;
    if (!files.length) { keyStatus.textContent = list.names.length ? "" : `보관함 폴더(${list.folder || "Summrizei"})에 아직 노트가 없습니다.`; paintFiles(); return; }
    await openFiles();
  }
  reopenBtn.addEventListener("click", autoOpen);

  // 복호화: 이 계정의 키를 한 번 받아 모든 파일을 같은 키로 연다. 다른 계정으로 만든 파일은 실패 목록에 이유와 함께 남는다.
  async function openFiles() {
    if (!files.length || busy || !session) return;
    busy = true;
    keyStatus.textContent = "여는 중…";
    failList.textContent = "";
    try {
      if (!key) {
        const { data, error } = await client.rpc("library_key");
        if (error) throw new Error("계정 키를 받지 못했습니다. 인터넷 연결과 로그인을 확인하세요.");
        key = await NoteFile.keyFromHex(data);
      }
      for (const f of files) {
        try {
          const data = await NoteFile.decryptWithKey(f.text, key);
          entries.set(data.meta.packageId, data);
        } catch (err) { fail(f.name, err); }
      }
    } catch (err) { fail("계정", err); }
    busy = false;
    keyStatus.textContent = "";
    adding = manual && failList.children.length > 0; // 직접 고르다 실패 줄이 남았으면 단계를 열어 둬서 오류가 보이게 한다
    paintFiles();
    paintList();
  }

  answersSel.addEventListener("change", () => render("web"));
  examCb.addEventListener("change", () => render("web"));
  writingCb.addEventListener("change", () => render("web"));
  backLink.addEventListener("click", e => { e.preventDefault(); closeNote(); });

  mdBtn.addEventListener("click", () => {
    if (!current) return;
    const md = NoteExport.toMarkdown(current.note, { answers: answersSel.value });
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName(current.meta?.title || current.meta?.packageId)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  });

  pdfBtn.addEventListener("click", async () => {
    if (!render("print")) return;
    await document.fonts.ready;
    await Promise.all([...noteContent.querySelectorAll("img")].map(img => img.decode().catch(() => {})));
    window.print();
  });
  window.addEventListener("afterprint", () => { if (current && !noteView.hidden) render("web"); });

  // 파일 더 불러오기: 이미 연 노트는 그대로 두고 1·2단계를 다시 연다.
  addBtn.addEventListener("click", () => {
    adding = manual = true;
    paintChrome();
    folderBtn.focus();
  });

  // 잠그기: 복호화 결과·키·불러온 파일을 전부 버리고 DOM을 비워 처음 단계로 돌아간다.
  function lock() {
    closeNote();
    files.length = 0;
    skipped = 0;
    key = null;
    entries.clear();
    cards.textContent = "";
    failList.textContent = "";
    keyStatus.textContent = "";
    listView.hidden = true;
    adding = false;
    paintChrome();
    paintFiles();
  }
  lockBtn.addEventListener("click", lock);
  initAuth();
})();
