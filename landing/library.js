// 내 노트 페이지: .summrizei 파일을 브라우저 안에서 복호화해 목록과 노트를 보여준다.
// 복호화 결과·파생 키는 메모리에만 두고 잠그기로 전부 버린다. 어떤 저장소(localStorage,
// sessionStorage, IndexedDB, 쿠키)에도 쓰지 않는다. 저장 문자열은 전부 textContent/DOM
// 으로만 넣고, 렌더러가 돌려주는 이스케이프된 HTML 만 innerHTML 로 둔다.
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const MAX = NoteFile.MAX_FILE || 40 * 1024 * 1024;
  const EXT = NoteFile.EXT || ".summrizei";

  const drop = $("drop"), folderBtn = $("folderBtn"), filesBtn = $("filesBtn");
  const folderInput = $("folderInput"), filesInput = $("filesInput");
  const fileStatus = $("fileStatus"), keyForm = $("keyForm"), passInput = $("passInput");
  const openBtn = $("openBtn"), keyStatus = $("keyStatus"), failList = $("failList");
  const listView = $("listView"), cards = $("cards"), noteView = $("noteView");
  const backLink = $("backLink"), noteTitle = $("noteTitle"), noteContent = $("noteContent");
  const answersSel = $("answersSel"), examCb = $("examCb"), writingCb = $("writingCb");
  const warnCount = $("warnCount"), lockBtn = $("lockBtn"), mdBtn = $("mdBtn"), pdfBtn = $("pdfBtn");

  // 노트 양식 CSS는 한 번만 넣는다 — 렌더러가 만드는 DOM은 항상 라이트 종이 토큰이다.
  const specStyle = document.createElement("style");
  specStyle.textContent = NoteSpec.css;
  document.head.appendChild(specStyle);

  const files = [];              // {name, text} — 암호문 원문(잠그면 함께 버림)
  const keys = new Map();        // salt → CryptoKey
  const entries = new Map();     // packageId → {meta, note, crops}
  let skipped = 0;
  let current = null;            // 지금 열린 {meta, note, crops}
  let busy = false;

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
    openBtn.disabled = files.length === 0 || busy;
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

  function paintList() {
    const list = [...entries.values()].sort((a, b) =>
      String(b.meta?.updatedAt ?? "").localeCompare(String(a.meta?.updatedAt ?? "")));
    cards.textContent = "";
    for (const e of list) {
      const m = e.meta || {};
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
      c.addEventListener("click", () => openNote(e));
      cards.append(c);
    }
    listView.hidden = !list.length;
    lockBtn.hidden = !(list.length || keys.size);
  }

  function openNote(e) {
    current = e;
    noteTitle.textContent = e.meta?.title || "제목 없는 강의";
    listView.hidden = true;
    noteView.hidden = false;
    window.scrollTo(0, 0);
    render("web");
  }

  function closeNote() {
    current = null;
    noteTitle.textContent = "";
    noteContent.textContent = "";
    warnCount.hidden = true;
    noteView.hidden = true;
    listView.hidden = !entries.size;
  }

  // 복호화: 같은 솔트를 쓰는 파일끼리 묶어 키는 솔트마다 한 번만 만든다
  // (파일마다 60만 회 PBKDF2를 돌리면 너무 느리다).
  keyForm.addEventListener("submit", async e => {
    e.preventDefault();
    if (!files.length || busy) return;
    busy = true;
    openBtn.disabled = true;
    const pass = passInput.value;
    passInput.value = ""; // 암호는 폼에 남기지 않는다
    keyStatus.textContent = "여는 중…";
    failList.textContent = "";

    const groups = new Map(); // salt → files
    for (const f of files) {
      try {
        const env = NoteFile.parseFile(f.text);
        const g = groups.get(env.salt);
        if (g) g.push(f); else groups.set(env.salt, [f]);
      } catch (err) { fail(f.name, err); }
    }
    for (const [salt, group] of groups) {
      let key = keys.get(salt);
      if (!key) {
        try { key = await NoteFile.deriveKey(pass, salt); keys.set(salt, key); }
        catch (err) { for (const f of group) fail(f.name, err); continue; }
      }
      for (const f of group) {
        try {
          const data = await NoteFile.decryptWithKey(f.text, key);
          entries.set(data.meta.packageId, data);
        } catch (err) { fail(f.name, err); }
      }
    }

    busy = false;
    keyStatus.textContent = "";
    paintFiles();
    paintList();
  });

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

  // 잠그기: 복호화 결과·키·불러온 파일을 전부 버리고 DOM을 비워 1단계로 돌아간다.
  lockBtn.addEventListener("click", () => {
    closeNote();
    files.length = 0;
    skipped = 0;
    keys.clear();
    entries.clear();
    cards.textContent = "";
    failList.textContent = "";
    keyStatus.textContent = "";
    listView.hidden = true;
    lockBtn.hidden = true;
    paintFiles();
  });
})();
