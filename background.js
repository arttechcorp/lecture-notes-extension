// AI 호출은 전부 사이드패널이 한다. 서비스 워커는 유휴 시 종료되므로
// "메모리에만 보관"이라는 무저장 요구사항을 지킬 수 없기 때문이다.
// 여기 남는 건 패널 열기와 최초 실행 온보딩뿐 — 강의 내용은 이 파일을 지나가지 않는다.

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  if (reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  }
});

// tabCapture.capture()는 사이드패널에서 쓸 수 없고 대상 탭도 고를 수 없다.
// MV3에서 특정 탭의 오디오를 잡는 정식 경로는 여기서 stream id를 발급받아
// 소비자(사이드패널)가 getUserMedia로 여는 것이다. 오디오는 여길 지나가지 않는다.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "GET_TAB_STREAM_ID") return;
  chrome.tabCapture.getMediaStreamId({ targetTabId: msg.tabId }, (streamId) => {
    sendResponse({ streamId, error: chrome.runtime.lastError?.message });
  });
  return true; // 비동기 응답
});
