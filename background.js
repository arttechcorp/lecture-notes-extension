// AI 호출은 전부 사이드패널이 한다. 서비스 워커는 유휴 시 종료되므로
// "메모리에만 보관"이라는 무저장 요구사항을 지킬 수 없기 때문이다.
// 여기 남는 건 패널 열기와 최초 실행 온보딩뿐 — 강의 내용은 이 파일을 지나가지 않는다.

// 온보딩은 사이드패널 안에서 끝난다. 설치 즉시 새 탭을 띄우면 맥락이 끊기고,
// 정작 확장을 열기도 전에 설정 화면부터 보게 된다. 자세한 안내가 필요하면
// 패널의 "설정"에서 옵션 페이지로 갈 수 있다.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
