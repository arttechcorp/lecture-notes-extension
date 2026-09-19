// Permissions and routing only; lecture state belongs to offscreen.
const trustedPage = sender => {
  try { const url=new URL(sender.url),base=new URL(chrome.runtime.getURL("")); return sender.id===chrome.runtime.id&&url.protocol===base.protocol&&url.host===base.host&&["/sidepanel.html","/options.html"].includes(url.pathname); }
  catch { return false; }
};
const captureError = error => {
  const message = error?.message || "";
  if (/Extension has not been invoked|Chrome pages cannot be captured/i.test(message)) {
    return new Error("이 강의 탭에서 확장을 호출해야 합니다. 강의 창을 클릭한 뒤 Alt+Shift+S로 캡처 창을 열어 시작하세요. 단축키가 반응하지 않으면 Chrome 확장 프로그램의 단축키 설정에서 ‘현재 강의 탭의 캡처 창 열기’를 확인하세요.");
  }
  return error instanceof Error ? error : new Error(message || "탭 캡처를 시작하지 못했습니다.");
};
const setup = () => {
  // Auto-opening skips the action grant needed by tabCapture, even with <all_urls>.
  // Reset the persisted setting on reload; simply removing the old call is insufficient.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
};
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
function openCaptureWindow(tab) {
  if (!Number.isInteger(tab?.id) || !/^https?:/.test(tab.url || "")) return;
  return chrome.windows.create({ url: chrome.runtime.getURL(`sidepanel.html?tabId=${tab.id}`), type: "popup", width: 480, height: 760 });
}
chrome.action.onClicked.addListener(tab => {
  if (Number.isInteger(tab.id)) chrome.sidePanel.open({ tabId: tab.id }).catch(() => openCaptureWindow(tab)).catch(console.error);
});
// A named command grants activeTab without depending on a popup window's toolbar.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "open-capture-panel") openCaptureWindow(tab)?.catch(console.error);
});
async function stopForTab(tabId){
  frameReports.delete(tabId);
  const contexts=await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"],documentUrls:[chrome.runtime.getURL("offscreen.html")]});
  if(contexts.length)await chrome.runtime.sendMessage({target:"session",type:"TAB_GONE",tabId});
}
chrome.tabs.onRemoved.addListener(tabId=>stopForTab(tabId).catch(()=>{}));
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.status==="loading"||change.url)stopForTab(tabId).catch(()=>{});});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const frameReports = new Map();
// Inject into every frame, collect FRAME_READY announces, and pick the largest unblocked video frame.
async function pickWatchFrame(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] });
  await delay(1400);
  const frames = [...(frameReports.get(tabId) || new Map()).values()];
  frameReports.delete(tabId);
  return { frames, picked: frames.filter(f => f.hasVideo && !f.blocked).sort((a, b) => b.area - a.area)[0] };
}
let creating = null, starting = false;
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL("offscreen.html")] });
  if (contexts.length) return;
  if (!creating) creating = chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA", "WORKERS"], justification: "Process one user-started lecture in memory while its panel is closed." }).finally(() => { creating = null; });
  await creating;
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if(message?.target==="panel"&&message.type==="SESSION_STATE"&&sender.id===chrome.runtime.id&&!sender.tab&&sender.url===chrome.runtime.getURL("offscreen.html")){
    const state=message.state,active=["preparing","running","paused","draining","summarizing"].includes(state.status);
    chrome.action.setBadgeText({text:active?"ON":""}).catch(()=>{});
    if(Number.isInteger(state.tabId)){
      const wf=state.watchFrameId;
      if(state.status==="preparing"&&!state.progress){
        if(wf!=null)chrome.tabs.sendMessage(state.tabId,{type:"WATCH_MEDIA",sessionId:state.sessionId},{frameId:wf}).catch(()=>{});
        if(wf>0)chrome.tabs.sendMessage(state.tabId,{type:"FRAME_WATCH",sessionId:state.sessionId},{frameId:0}).catch(()=>{});
      }
      else if(!active){
        chrome.tabs.sendMessage(state.tabId,{type:"STOP_WATCH"},{frameId:0}).catch(()=>{});
        if(wf>0)chrome.tabs.sendMessage(state.tabId,{type:"STOP_WATCH"},{frameId:wf}).catch(()=>{});
      }
    }
    return;
  }
  if(message?.target==="background"&&message.type==="FRAME_READY"){
    const tabId=sender.tab?.id;
    if(sender.id===chrome.runtime.id&&Number.isInteger(tabId)){
      let frames=frameReports.get(tabId);
      if(!frames)frameReports.set(tabId,frames=new Map());
      frames.set(sender.frameId,{frameId:sender.frameId,hasVideo:!!message.hasVideo,blocked:!!message.blocked,area:message.area||0,url:message.url,meta:message.meta||null});
      reply({ok:true});
    }
    return;
  }
  if (message?.target !== "background") return;
  if (!trustedPage(sender)) { reply({ ok: false, error: "허용되지 않은 요청입니다." }); return; }
  (async () => {
    if (message.type === "GET_PREVIEW") {
      const tabId = message.tabId;
      if (!Number.isInteger(tabId)) throw new Error("미리보기를 가져올 탭을 선택하세요.");
      const tab = await chrome.tabs.get(tabId);
      if (!/^https?:/.test(tab.url || "")) throw new Error("일반 웹 강의 탭에서 미리보기를 가져오세요.");
      const { frames, picked } = await pickWatchFrame(tabId);
      if (!picked) throw new Error(frames.some(f => f.hasVideo && f.blocked) ? "보호된 강의는 미리보기를 지원하지 않습니다." : "이 페이지의 영상을 찾지 못했습니다.");
      const res = await chrome.tabs.sendMessage(tabId, { type: "PREVIEW" }, { frameId: picked.frameId });
      if (!res?.ok) throw new Error(res?.error || "미리보기를 가져오지 못했습니다.");
      return { ok: true, dataUrl: res.dataUrl };
    }
    await ensureOffscreen();
    if (message.type !== "START_SESSION") return chrome.runtime.sendMessage({ ...message, target: "session" });
    if (starting) throw new Error("이미 세션을 준비하고 있습니다.");
    starting = true;
    try {
      const current = await chrome.runtime.sendMessage({ target: "session", type: "GET_STATE" });
      if (current.state && !["disposed", "completed", "failed"].includes(current.state.status)) throw new Error("현재 세션을 먼저 중지하세요.");
      const tabId = message.options?.tabId;
      if (!Number.isInteger(tabId)) throw new Error("캡처할 강의 탭을 선택하세요.");
      const tab = await chrome.tabs.get(tabId);
      if (!/^https?:/.test(tab.url || "")) throw new Error("일반 웹 강의 탭에서 시작하세요.");
      const { frames, picked } = await pickWatchFrame(tabId);
      if (!picked && frames.some(f => f.hasVideo && f.blocked)) throw new Error("보호된 강의는 캡처하지 않습니다.");
      const watchFrameId = picked ? picked.frameId : null;
      let streamId;
      try { streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }); }
      catch (error) { throw captureError(error); }
      const sessionId = crypto.randomUUID();
      const pending = chrome.runtime.sendMessage({ target: "session", type: "START_SESSION", streamId, options: { ...message.options, tabId, sessionId, watchFrameId, metadata: picked?.meta || {} } });
      if (watchFrameId != null) chrome.tabs.sendMessage(tabId, { type: "WATCH_MEDIA", sessionId, speedCorrection: message.options?.speedCorrection === true }, { frameId: watchFrameId }).catch(() => {});
      if (watchFrameId > 0) chrome.tabs.sendMessage(tabId, { type: "FRAME_WATCH", sessionId }, { frameId: 0 }).catch(() => {});
      return await pending;
    } finally { starting = false; }
  })().then(reply).catch(error => reply({ ok: false, error: error.message || "요청을 처리하지 못했습니다." }));
  return true;
});
