// 웹 /library 와 확장 사이의 다리(콘텐츠 스크립트, manifest content_scripts). 페이지가 같은 창 postMessage 로
// {srz:"lib", id, op:"list"|"read", name} 를 보내면 background 를 거쳐 보관함 폴더의 파일 이름·암호문만 돌려준다.
// 복호화는 페이지가 로그인 계정 키로 한다 — 여기를 지나가는 것은 암호문뿐이다.
(() => {
  window.addEventListener("message", async e => {
    const m = e.data;
    if (e.source !== window || e.origin !== location.origin || m?.srz !== "lib" || typeof m.id !== "string" || !["list", "read"].includes(m.op)) return;
    let r;
    try { r = await chrome.runtime.sendMessage({ target: "background", type: "LIB_FILES", op: m.op, name: typeof m.name === "string" ? m.name : undefined }); }
    catch { r = null; }
    window.postMessage({ ...(r || { ok: false, code: "unavailable" }), srz: "lib-reply", id: m.id }, location.origin);
  });
})();
