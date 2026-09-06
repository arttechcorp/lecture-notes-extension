// AI 호출은 전부 사이드패널이 한다. 서비스 워커는 유휴 시 종료되므로
// "메모리에만 보관"이라는 무저장 요구사항을 지킬 수 없기 때문이다.
// 여기 남는 건 패널 열기와 최초 실행 온보딩뿐 — 강의 내용은 이 파일을 지나가지 않는다.

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  if (reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  }
});
