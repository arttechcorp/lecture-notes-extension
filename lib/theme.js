// 테마 적용 한 곳. "system" | "light" | "dark"를 실제 [data-theme]으로 풀어 <html>에 건다.
// 사이드패널·옵션 페이지가 <head>에서 같이 읽는다. 설정값이므로 storage 보관 대상이 맞다.
(() => {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  let pref = "system";

  const apply = () => {
    document.documentElement.dataset.theme =
      pref === "light" || pref === "dark" ? pref : mq.matches ? "dark" : "light";
  };

  apply(); // 저장값이 도착하기 전 한 프레임 동안 흰 화면이 번쩍이지 않게 먼저 OS 값으로
  chrome.storage.local.get("theme", ({ theme }) => {
    pref = theme || "system";
    apply();
  });

  mq.addEventListener("change", apply);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.theme) return;
    pref = changes.theme.newValue || "system"; // 옵션에서 바꾸면 열려 있는 사이드패널도 같이 바뀐다
    apply();
  });
})();
