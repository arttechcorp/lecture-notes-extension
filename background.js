// Permissions and routing only; lecture state belongs to offscreen.
// Auth(로그인 토큰 읽기·갱신)는 요청이 올 때마다 storage에서 읽는다. 전역에 세션을 두지 않는다.
importScripts("lib/settings.js", "lib/auth.js", "lib/account.js", "lib/media-source.js");
const trustedPage = sender => {
  try { const url=new URL(sender.url),base=new URL(chrome.runtime.getURL("")); return sender.id===chrome.runtime.id&&url.protocol===base.protocol&&url.host===base.host&&["/sidepanel.html","/options.html"].includes(url.pathname); }
  catch { return false; }
};
// 토큰 요청은 offscreen 문서(chrome.storage가 없다)도 보낸다. 같은 확장의 offscreen.html 그 자체만 허용한다.
// 웹 /library 의 다리(lib/library-bridge.js): 이 확장의 콘텐츠 스크립트이고, 그 탭 주소가 사이트(개발용 localhost 포함)의 /library 일 때만.
const libraryPage = sender => {
  try { const u = new URL(sender.url); return sender.id === chrome.runtime.id && !!sender.tab && (u.origin === "https://summrizei.vercel.app" || u.protocol === "http:" && u.hostname === "localhost") && /^\/library(\.html)?$/.test(u.pathname); }
  catch { return false; }
};
const offscreenPage = sender => sender.id === chrome.runtime.id && !sender.tab && sender.url === chrome.runtime.getURL("offscreen.html");
// ── 유료 백그라운드 작업(docs/architecture-v2.md §6.1, §17) ──
// 작업 상태는 offscreen이 갖는다. 여기는 절전 방지와 Referer 규칙만 맡고 전역에 아무것도 두지 않는다: chrome.power와 DNR 세션 규칙은 브라우저가 상태를 쥔다.
// ponytail: offscreen이 BG_DONE 없이 사라지면 절전 방지와 규칙이 남는다(확장을 다시 불러오거나 브라우저를 재시작하면 풀린다). 서비스 워커 시작 때 offscreen 문서가 없으면 풀어 주는 정리를 더할 수 있다.
const BG_RULE = 900002; // admin.js 소스 진단 규칙(900001)과 겹치지 않는다
const OFFSCREEN_ONLY = new Set(["BG_REFERER", "BG_DONE", "DIAG_EXPORT", "LIBRARY_KEY"]); // 패널이 Referer 규칙을 걸거나 작업 종료·파일 쓰기를 흉내 내지 못하게 한다
const BG_SETTINGS = ["serviceUrl", "appSessionToken", "whisperLang", "remoteSummaryConsent", "visionConsent", "visionConsentVersion", "backgroundConsent", "noteOptions", "devWriteModel"];
// 동의 기록은 패널이 보낸 값이 아니라 저장소에서 읽는다. 로그인 세션(authSession)은 offscreen에 넘기지 않는다 — 토큰은 AUTH_TOKEN으로만 건넨다.
const bgSettings = async () => { const s = await loadSettings(); return Object.fromEntries(BG_SETTINGS.map(k => [k, s[k]])); };
async function bgRun(message) {
  const tab = Number.isInteger(message.tabId) ? await chrome.tabs.get(message.tabId).catch(() => null) : null, playlistUrl = message.source?.playlistUrl;
  if (!/^https?:/.test(tab?.url || "") || !/^https?:\/\//i.test(playlistUrl || "")) throw new Error("일반 웹 강의 탭에서 시작하세요.");
  // Referer의 출처는 패널이 보낸 문자열이 아니라 사용자가 보고 있는 탭이다. 브라우저 기본 정책(strict-origin-when-cross-origin)이
  // 교차 출처 미디어 요청에 보내는 값과 같게 출처만 쓴다 — 경로(강의 id 등)는 싣지 않는다.
  // 과목은 보관함 안 하위 폴더 이름이 된다(lib/library-folder.js COURSE_RE와 같은 모양) — 맞지 않으면 과목 없이 둔다.
  const course = typeof message.source?.course === "string" && /^(?![. ])[^/\\:*?"<>|\x00-\x1f\x7f]{1,40}(?<![. ])$/.test(message.source.course) ? message.source.course : null;
  const source = { playlistUrl, pageUrl: new URL(tab.url).origin + "/", course };
  chrome.power.requestKeepAwake("system");
  let reply;
  try { await ensureOffscreen(); reply = await chrome.runtime.sendMessage({ target: "session", type: "BG_RUN", jobId: message.jobId, source, settings: await bgSettings() }); }
  catch (error) { reply = { ok: false, error: error.message }; }
  if (!reply?.ok && !reply?.busy) chrome.power.releaseKeepAwake(); // 이미 도는 작업이 있으면(busy) 그 작업의 절전 방지는 그대로 둔다
  return reply ?? { ok: false, error: "백그라운드 처리를 시작하지 못했습니다." };
}
// offscreen이 새 호스트로 나가기 전에 부른다: 그 호스트를 규칙의 requestDomains에 더한다(없으면 규칙을 만든다). 규칙은 tabIds:[-1]이라 확장 자신의 요청에만 걸린다.
async function bgReferer({ host, referer }) {
  const rules = chrome.declarativeNetRequest, old = (await rules.getSessionRules()).find(rule => rule.id === BG_RULE);
  const requestDomains = [...new Set([...(old?.condition.requestDomains || []), host])];
  await rules.updateSessionRules({ removeRuleIds: [BG_RULE], addRules: [LectureMedia.refererRule({ ruleId: BG_RULE, requestDomains, referer })] });
  return { ok: true };
}
// 작업이 어떤 결말로 끝나든(완료·일시정지·실패·취소) 절전 방지와 규칙을 풀고, 패널에는 내용 없는 결말만 전한다.
const PKG_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/, JOB_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;
const BG_SAVED = new Set(["file", "no-folder", "no-key", "failed"]);
async function bgDone({ jobId, status, code, reason, suggest, message, stats, notices, packageId, saved }) {
  chrome.power.releaseKeepAwake();
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [BG_RULE] }).catch(() => {});
  // 끝난 작업은 ✓ 배지로 알린다 — 실시간 캡처("ON", 아래 SESSION_STATE 경로)가 도는 동안에는 덮지 않는다.
  if (["complete", "partial", "done", "paused"].includes(status)) (async () => { if (await chrome.action.getBadgeText({}) !== "ON") { await chrome.action.setBadgeText({ text: "✓" }); await chrome.action.setBadgeBackgroundColor({ color: "#2f7d4f" }); } })().catch(() => {});
  chrome.runtime.sendMessage({ target: "panel", type: "BG_DONE", jobId, status, code, reason, suggest, message, stats, notices, packageId: typeof packageId === "string" && PKG_ID.test(packageId) ? packageId : null, saved: BG_SAVED.has(saved) ? saved : null }).catch(() => {});
  return { ok: true };
}
// 끝난 백그라운드 작업의 진단 기록(JSON, 내용 없는 이벤트)을 Downloads/Summrizei/diagnostics/ 에 쓴다. 같은 작업은 덮어쓴다.
async function diagExport({ jobId, text }) {
  if (typeof jobId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/.test(jobId) || typeof text !== "string" || text.length > 8 * 1024 * 1024 || !text.startsWith('{\n  "v":')) return { ok: false, error: "진단 파일 요청이 올바르지 않습니다." };
  const day = new Date().toISOString().slice(0, 10);
  const downloadId = await chrome.downloads.download({ url: "data:application/json;base64," + btoa(unescape(encodeURIComponent(text))), filename: `Summrizei/diagnostics/summrizei-diagnostic-${day}-${jobId}.json`, conflictAction: "overwrite", saveAs: false });
  return { ok: true, downloadId };
}
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
  if (!(message.type === "LIB_FILES" ? libraryPage(sender) : OFFSCREEN_ONLY.has(message.type) ? offscreenPage(sender) : trustedPage(sender) || message.type === "AUTH_TOKEN" && offscreenPage(sender))) { reply({ ok: false, error: "허용되지 않은 요청입니다." }); return; }
  (async () => {
    if (message.type === "AUTH_TOKEN") return { ok: true, token: await Auth.token() };
    // 노트 암호화 키(hex): offscreen 이 기기에 이 계정 키가 없을 때만 묻는다(보관함 비우기 뒤·패널에서 못 받은 채 끝난 작업).
    if (message.type === "LIBRARY_KEY") { const session = await Account.getSession(); if (!session) return { ok: false, error: "로그인이 필요합니다." }; return { ok: true, hex: await Account.fetchLibraryKey(session) }; }
    if (message.type === "BG_REFERER") return bgReferer(message);
    if (message.type === "BG_DONE") return bgDone(message);
    if (message.type === "BG_RUN") return bgRun(message);
    if (message.type === "BG_LIST") { await ensureOffscreen(); return chrome.runtime.sendMessage({ target: "session", type: "BG_LIST", settings: await bgSettings() }); } // BG_CANCEL은 아래의 일반 전달을 탄다
    if (message.type === "DIAG_EXPORT") return diagExport(message);
    // 보관함 폴더의 파일 이름·암호문만 건넨다 — 읽기는 폴더 핸들을 가진 offscreen 이 한다.
    if (message.type === "LIB_FILES") {
      if (!["list", "read"].includes(message.op) || message.op === "read" && (typeof message.name !== "string" || message.name.length > 260)) return { ok: false, code: "bad-request" };
      await ensureOffscreen();
      return chrome.runtime.sendMessage({ target: "session", type: "LIB_FILES", op: message.op, name: message.op === "read" ? message.name : undefined });
    }
    if (message.type === "LIB_EXPORT_ALL") { await ensureOffscreen(); return chrome.runtime.sendMessage({ target: "session", type: "LIB_EXPORT_ALL" }); }
    if (message.type === "PANEL_OPENED") { try { if (await chrome.action.getBadgeText({}) === "✓") await chrome.action.setBadgeText({ text: "" }); } catch { /* 배지를 못 읽어도 패널 열기는 성공 */ } return { ok: true }; }
    if (message.type === "BG_DISCARD" && (typeof message.jobId !== "string" || !JOB_ID.test(message.jobId))) return { ok: false, error: "작업 요청이 올바르지 않습니다." }; // 유효한 것만 아래 일반 전달을 탄다
    if (message.type === "LIB_REGENERATE") {
      // 모양만 검사해 넘긴다 — 동의·요금제 판정은 offscreen이 한다. 노트를 다시 만드는 몇 분 동안 절전 방지를 든다.
      const o = message.options, opts = o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length === 2 && typeof o.syntheticExamples === "boolean" && typeof o.externalAugmentation === "boolean";
      if (typeof message.packageId !== "string" || !PKG_ID.test(message.packageId) || !opts) return { ok: false, error: "다시 만들기 요청이 올바르지 않습니다." };
      chrome.power.requestKeepAwake("system");
      const reply = await ensureOffscreen().then(async () => chrome.runtime.sendMessage({ target: "session", type: "LIB_REGENERATE", packageId: message.packageId, options: { syntheticExamples: o.syntheticExamples, externalAugmentation: o.externalAugmentation }, settings: await bgSettings() })).catch(error => ({ ok: false, error: error.message }));
      if (!reply?.busy) chrome.power.releaseKeepAwake(); // busy면 진행 중인 작업(또는 다른 재생성)의 절전 방지가 남아 있어 놓지 않는다
      return reply ?? { ok: false, error: "다시 만들기를 부르지 못했습니다." };
    }
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
      const pending = chrome.runtime.sendMessage({ target: "session", type: "START_SESSION", streamId, settings: message.settings, options: { ...message.options, tabId, sessionId, watchFrameId, metadata: picked?.meta || {} } });
      if (watchFrameId != null) chrome.tabs.sendMessage(tabId, { type: "WATCH_MEDIA", sessionId, speedCorrection: message.options?.speedCorrection === true }, { frameId: watchFrameId }).catch(() => {});
      if (watchFrameId > 0) chrome.tabs.sendMessage(tabId, { type: "FRAME_WATCH", sessionId }, { frameId: 0 }).catch(() => {});
      return await pending;
    } finally { starting = false; }
  })().then(reply).catch(error => reply({ ok: false, error: error.message || "요청을 처리하지 못했습니다." }));
  return true;
});
