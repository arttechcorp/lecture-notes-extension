// 노트 페이지: 보관함 레코드를 읽어 샌드박스에 렌더를 맡긴다.
// 노트 본문은 샌드박스 안에서만 HTML이 되고, 이 페이지는 메시지만 주고받는다.
(function () {
  "use strict";

  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
  const $ = id => document.getElementById(id);
  const frame = $("renderFrame");

  const titleEl = $("title"), toolbar = $("toolbar"), warnEl = $("warnCount");
  const missingEl = $("missing"), errorEl = $("error"), recogNote = $("recogNote");
  const answersSel = $("answersSel"), examCb = $("examCb"), writingCb = $("writingCb");

  const packageId = new URLSearchParams(location.search).get("id");

  // 샌드박스가 준비되기 전 메시지는 마지막 것만 쌓아 둔다.
  let ready = false, pending = null;
  const post = msg => { if (ready) frame.contentWindow.postMessage(msg, "*"); else pending = msg; };
  window.addEventListener("message", e => {
    if (e.source !== frame.contentWindow) return;
    const m = e.data || {};
    if (m.type === "RENDERER_READY") {
      ready = true;
      if (pending) { const p = pending; pending = null; frame.contentWindow.postMessage(p, "*"); }
    } else if (m.type === "RENDER_HEIGHT") {
      frame.style.height = `${Math.max(200, m.height | 0)}px`;
    } else if (m.type === "RENDER_WARNINGS") {
      const n = (m.warnings || []).length;
      warnEl.hidden = !n;
      warnEl.textContent = n ? `표시하지 못한 항목 ${n}개` : "";
    }
  });

  const options = () => ({ answers: answersSel.value, exam: examCb.checked, writing: writingCb.checked });

  // 다운로드 파일명: 경로·제어 문자를 빼고 80자로 자른다.
  const safeName = s => (s || "note").replace(/[/\\:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "note";

  function bindToolbar(note, crops) {
    const render = () => post({ type: "RENDER_NOTE", note, crops, options: options() });
    answersSel.addEventListener("change", render);
    examCb.addEventListener("change", render);
    writingCb.addEventListener("change", render);
    $("pdfBtn").addEventListener("click", () => post({ type: "PRINT_NOTE", note, crops, options: options() }));
    $("mdBtn").addEventListener("click", () => {
      const md = NoteExport.toMarkdown(note, { answers: answersSel.value });
      const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName(note.title)}.md`;
      a.click();
      URL.revokeObjectURL(url);
    });
    render();
  }

  async function main() {
    if (!packageId || !ID_RE.test(packageId)) { missingEl.hidden = false; return; }
    let store;
    try {
      store = await PackageStore.indexedDbAdapter().then(PackageStore.createStore);
    } catch (e) {
      errorEl.textContent = "보관함을 열지 못했습니다. 다시 시도해 주세요.";
      errorEl.hidden = false;
      return;
    }
    const data = await NoteLibrary.load(store, packageId).catch(() => null);
    if (!data || !data.meta) { missingEl.hidden = false; return; }

    titleEl.textContent = data.meta.title || "제목 없는 강의";
    document.title = data.meta.title ? `${data.meta.title} — 강의 노트` : "강의 노트";

    if (data.note) {
      toolbar.hidden = false;
      frame.hidden = false;
      const crops = await NoteLibrary.cropUrls(store, packageId).catch(() => ({}));
      bindToolbar(data.note, crops);
    } else if (data.recognition) {
      // 인식만 끝난 강의 — 내보내기 버튼은 숨기고 인식 결과를 그대로 보여준다.
      recogNote.hidden = false;
      frame.hidden = false;
      post({ type: "RENDER_RECOGNITION", recognition: data.recognition });
    } else {
      missingEl.hidden = false;
    }
  }

  main();
})();
