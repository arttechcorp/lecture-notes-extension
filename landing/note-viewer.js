/* 제품과 랜딩 체험이 공유하는 Markdown 읽기/편집 뷰어.
   원문은 textarea에만 보관한다. HTML·외부 이미지·자동 링크 요청은 허용하지 않는다. */
const NoteViewer = (() => {
  const MarkdownIt = typeof module !== "undefined" && module.exports
    ? require("./vendor/markdown-it.min.js") : markdownit;
  const md = new MarkdownIt({ html: false, linkify: false, breaks: false });
  md.validateLink = (url) => /^https?:\/\//i.test(url);
  md.renderer.rules.image = (tokens, index) => md.utils.escapeHtml(tokens[index].content);
  md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noopener noreferrer");
    return renderer.renderToken(tokens, index, options);
  };
  md.renderer.rules.table_open = () => '<div class="note-table-scroll" tabindex="0" role="region" aria-label="노트 표"><table>';
  md.renderer.rules.table_close = () => '</table></div>\n';
  // 목록의 체크박스만 변환한다. 코드·문단 속 [x]는 원문으로 남긴다.
  md.core.ruler.after("inline", "note_tasks", (state) => {
    for (let i = 0; i < state.tokens.length - 2; i++) {
      const [item, paragraph, inline] = state.tokens.slice(i, i + 3);
      if (item.type !== "list_item_open" || paragraph.type !== "paragraph_open" || inline.type !== "inline") continue;
      const first = inline.children?.[0];
      const match = first?.type === "text" && first.content.match(/^\[([ xX])\]\s+/);
      if (!match) continue;
      first.content = first.content.slice(match[0].length);
      const checkbox = new state.Token("html_inline", "", 0);
      checkbox.content = `<input type="checkbox" disabled aria-label="${match[1] === " " ? "미완료" : "완료"}"${match[1] === " " ? "" : " checked"}>`;
      inline.children.unshift(checkbox);
      item.attrJoin("class", "note-task");
    }
  });

  function render(text, title = "") {
    const tokens = md.parse(text || "", {});
    // 바깥의 강의 제목과 완전히 같은 첫 제목은 한 번만 보여 준다.
    if (title && tokens[0]?.type === "heading_open" && tokens[1]?.content === title) tokens.splice(0, 3);
    return md.renderer.render(tokens, md.options, {});
  }

  function create(doc) {
    const source = doc.getElementById("result");
    const preview = doc.getElementById("notePreview");
    const surface = doc.getElementById("noteSurface");
    const readButton = doc.getElementById("noteReadBtn");
    const editButton = doc.getElementById("noteEditBtn");
    let busy = false;

    function paint() {
      preview.innerHTML = render(source.value, doc.getElementById("resultTitle").textContent);
      if (preview.dataset.kind === "timeline") {
        for (const heading of preview.querySelectorAll("h2")) {
          const match = heading.textContent.match(/^(\d+:\d{2}(?::\d{2})?) · (음성|화면)$/);
          if (!match) continue;
          const time = doc.createElement("time");
          time.textContent = match[1];
          time.dateTime = `PT${match[1].split(":").reduce((seconds, part) => seconds * 60 + Number(part), 0)}S`;
          const label = doc.createElement("span");
          label.textContent = match[2];
          heading.replaceChildren(time, label);
        }
      }
      if (!source.value.trim()) {
        const empty = doc.createElement("p");
        empty.className = "note-empty";
        empty.textContent = busy ? "강의 내용을 노트로 정리하고 있어요…" : "아직 작성된 내용이 없습니다.";
        preview.append(empty);
      }
    }

    function edit(editing, focus = false) {
      if (editing && busy) return;
      if (!editing) paint();
      source.hidden = !editing;
      preview.hidden = editing;
      readButton.setAttribute("aria-pressed", String(!editing));
      editButton.setAttribute("aria-pressed", String(editing));
      if (focus) (editing ? source : preview).focus({ preventScroll: true });
    }

    function setBusy(value) {
      busy = value;
      source.readOnly = value;
      editButton.disabled = value;
      preview.setAttribute("aria-busy", String(value));
      if (value) edit(false);
    }

    function show(text, { kind = "summary", generating = false } = {}) {
      const wasBusy = busy;
      const follow = surface.scrollTop + surface.clientHeight >= surface.scrollHeight - 48;
      source.value = text;
      preview.dataset.kind = kind;
      setBusy(generating);
      if (!generating) edit(false);
      if (generating && follow) surface.scrollTop = surface.scrollHeight;
      else if (!generating || !wasBusy) surface.scrollTop = 0;
    }

    readButton.addEventListener("click", () => edit(false, true));
    editButton.addEventListener("click", () => edit(true, true));
    return { show, edit, setBusy };
  }

  return { render, create };
})();
if (typeof module !== "undefined" && module.exports) module.exports = NoteViewer;
