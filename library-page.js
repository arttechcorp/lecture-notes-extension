// 보관함 목록: 암호화된 로컬 스토어에서 메타 레코드를 읽어 카드로 그린다.
// 저장 문자열은 전부 textContent/DOM 으로만 넣는다(innerHTML 금지).
(function () {
  "use strict";

  const list = document.getElementById("list");
  const emptyEl = document.getElementById("empty");
  const errorEl = document.getElementById("error");

  const STATUS = { complete: "노트 완성", partial: "일부 완성", "recognition-only": "인식 결과만" };

  // h:mm:ss(1시간 이상) 또는 m:ss. durationSec가 null이면 빈 문자열.
  const fmtDur = s => {
    if (s == null || !Number.isFinite(s)) return "";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  };
  const fmtDate = iso => {
    const d = new Date(iso);
    return Number.isNaN(d) ? "" : d.toLocaleString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  };
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function card(meta, onDelete) {
    const c = el("article", "card");
    c.append(el("h2", null, meta.title || "제목 없는 강의"));
    const metaEl = el("div", "meta");
    if (meta.host) metaEl.append(el("span", null, meta.host));
    const when = fmtDate(meta.createdAt);
    if (when) metaEl.append(el("span", null, when));
    const dur = fmtDur(meta.durationSec);
    if (dur) metaEl.append(el("span", null, dur));
    const label = STATUS[meta.status];
    if (label) metaEl.append(el("span", "badge", label));
    if (meta.counts) {
      if (meta.counts.sections != null) metaEl.append(el("span", null, `섹션 ${meta.counts.sections}`));
      if (meta.counts.questions != null) metaEl.append(el("span", null, `문제 ${meta.counts.questions}`));
    }
    c.append(metaEl);

    const actions = el("div", "row-actions");
    const open = el("a", "open-link", "열기");
    open.href = `note.html?id=${encodeURIComponent(meta.packageId)}`;
    actions.append(open);
    const del = el("button", "danger", "삭제");
    del.type = "button";
    del.addEventListener("click", () => {
      if (!confirm("이 강의의 노트와 저장된 자료를 이 기기에서 지웁니다. 되돌릴 수 없습니다.")) return;
      onDelete(meta.packageId);
    });
    actions.append(del);
    c.append(actions);
    return c;
  }

  async function render() {
    let store;
    try {
      store = await PackageStore.indexedDbAdapter().then(PackageStore.createStore);
    } catch (e) {
      errorEl.textContent = "보관함을 열지 못했습니다. 다시 시도해 주세요.";
      errorEl.hidden = false;
      return;
    }
    const metas = await NoteLibrary.list(store).catch(() => []);
    list.textContent = "";
    for (const m of metas) {
      list.append(card(m, async packageId => {
        await NoteLibrary.remove(store, packageId);
        render();
      }));
    }
    emptyEl.hidden = metas.length > 0;
  }

  render();
})();
