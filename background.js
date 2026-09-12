// Permissions and routing only; lecture state belongs to offscreen.
const trustedPage = sender => {
  try { const url=new URL(sender.url),base=new URL(chrome.runtime.getURL("")); return sender.id===chrome.runtime.id&&url.protocol===base.protocol&&url.host===base.host&&["/sidepanel.html","/options.html"].includes(url.pathname); }
  catch { return false; }
};
const setup = () => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
};
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
async function stopForTab(tabId){
  const contexts=await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"],documentUrls:[chrome.runtime.getURL("offscreen.html")]});
  if(contexts.length)await chrome.runtime.sendMessage({target:"session",type:"TAB_GONE",tabId});
}
chrome.tabs.onRemoved.addListener(tabId=>stopForTab(tabId).catch(()=>{}));
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.status==="loading"||change.url)stopForTab(tabId).catch(()=>{});});
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
      if(state.status==="preparing"&&!state.progress)chrome.tabs.sendMessage(state.tabId,{type:"WATCH_MEDIA",sessionId:state.sessionId},{frameId:0}).catch(()=>{});
      else if(!active)chrome.tabs.sendMessage(state.tabId,{type:"STOP_WATCH"},{frameId:0}).catch(()=>{});
    }
    return;
  }
  if (message?.target !== "background") return;
  if (!trustedPage(sender)) { reply({ ok: false, error: "허용되지 않은 요청입니다." }); return; }
  (async () => {
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
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      const probe = await chrome.tabs.sendMessage(tabId, { type: "PREFLIGHT" }, { frameId: 0 });
      if (!probe?.ok) throw new Error(probe?.error || "이 영상은 캡처할 수 없습니다.");
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
      const response = await chrome.runtime.sendMessage({ target: "session", type: "START_SESSION", streamId, options: { ...message.options, tabId, metadata: probe.metadata } });
      if (response.ok) await chrome.tabs.sendMessage(tabId, { type: "WATCH_MEDIA", sessionId: response.state.sessionId }, { frameId: 0 });
      return response;
    } finally { starting = false; }
  })().then(reply).catch(error => reply({ ok: false, error: error.message || "요청을 처리하지 못했습니다." }));
  return true;
});
