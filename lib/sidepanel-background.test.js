// 사이드패널의 "백그라운드로 처리": 유료 계정에게만 보이고, 동의가 없으면 시작하지 않으며, 보호·미지원·실패에서는 사용자가 "실시간 모드로 시작"을 눌러야만 실시간 캡처가 시작된다.
// sidepanel.js 전체를 가짜 DOM·chrome 위에서 실행해 확인한다.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const { TERMS_VERSION } = require("./settings.js");

const BG_SENDER = { id: "ext", url: "chrome-extension://ext/background.js" }, OFFSCREEN = { id: "ext", url: "chrome-extension://ext/offscreen.html" };
const CONSENTS = { consentAccepted: true, serviceUrl: "https://service.example", appSessionToken: "static-dev-token-static-dev-token-1", backgroundConsent: { personalUse: true, accessRights: true, version: TERMS_VERSION, at: 1 }, visionConsent: true, visionConsentVersion: TERMS_VERSION, visionConsentAt: 1, remoteSummaryConsent: true, summaryConsentVersion: TERMS_VERSION, summaryConsentAt: 1 };
// 패널이 참조하는 Account·NoteFile·PackageStore 는 테스트 VM에 없다 — 가짜를 심어 온보딩 단계를 채우거나 비운다.
const fakeAccount = (plan = "free") => { const acc = { SITE: "https://site.example", session: { access_token: "t" }, signIns: 0,
  getSession: async () => acc.session, fetchAccount: async () => ({ plan, minutes_limit: 60, minutes_used: 1 }), decodeUser: () => ({ email: "u@example.com", name: "U" }),
  fetchLibraryKey: async () => "ab".repeat(32), signIn: async () => { acc.signIns++; acc.session = { access_token: "t" }; }, signOut: async () => { acc.session = null; } }; return acc; };
const TAB = { id: 7, url: "https://lms.example.com/watch?id=7", title: "강의" };

const HTML = fs.readFileSync("sidepanel.html", "utf8"), HIDDEN = new Set([...HTML.matchAll(/<[^>]*\bid="([^"]+)"[^>]*\shidden[\s>][^>]*>/g)].map(m => m[1]));
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
function element(id) {
  const listeners = {}; let text = "";
  const e = {
    hidden: HIDDEN.has(id), disabled: false, value: "", checked: false, className: "", style: {}, dataset: {}, children: [], selectedOptions: [], open: false, modal: false, classList: { add() {}, remove() {}, toggle() {} },
    get textContent() { return text; }, set textContent(v) { text = v; e.children = []; }, // textContent 대입은 자식도 지운다 — 붙여 둔 버튼이 남으면 가짜 DOM의 버그다
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn), removeEventListener() {},
    click: async () => { for (const fn of listeners.click || []) fn({ preventDefault() {} }); await flush(); }, // 사용자의 클릭은 핸들러가 끝나길 기다리지 않는다
    _fire: (type, ev = {}) => { for (const fn of listeners[type] || []) fn(ev); }, // 체크박스 change처럼 click이 아닌 이벤트를 보낸다
    append: (...c) => e.children.push(...c), insertBefore: (c, ref) => { const i = e.children.indexOf(ref); e.children.splice(i < 0 ? e.children.length : i, 0, c); return c; }, focus() {}, showModal: () => { e.open = true; e.modal = true; }, close: () => { e.open = false; e.modal = false; }, setAttribute() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }),
  };
  return e;
}

async function panel({ store = CONSENTS, tabs = [TAB], list = { ok: true, background: true, jobs: [] }, run = { ok: true }, permission = true, scan = [], account = fakeAccount(), folder = { state: "ok", name: "Summrizei" }, ensureKey = async () => ({ key: {}, uid: "u1", at: 1 }), start = { ok: true, state: null } } = {}) {
  const h = { sent: [], calls: [], elements: {}, timers: [], listeners: [], webRequest: [], store: { ...store } };
  const el = id => (h.elements[id] ??= element(id));
  const reply = m => ({ GET_STATE: { ok: true, state: null }, BG_LIST: list, BG_RUN: run, BG_CANCEL: { ok: true }, BG_DISCARD: { ok: true }, LIB_REGENERATE: { ok: true, status: "complete", saved: "file" }, START_SESSION: start })[m.type] ?? { ok: true };
  const chrome = {
    runtime: { id: "ext", getURL: p => `chrome-extension://ext/${p}`, lastError: undefined, openOptionsPage: () => h.calls.push("openOptionsPage"), onMessage: { addListener: fn => h.listeners.push(fn) },
      sendMessage: (m, cb) => { h.sent.push(JSON.parse(JSON.stringify(m))); Promise.resolve().then(() => cb(reply(m))); } },
    storage: { local: { get: async () => ({ ...h.store }), set: async () => {}, remove: async () => {} }, sync: { remove: async () => {} } },
    tabs: { query: async q => (q.active ? [tabs[0]] : tabs), create: url => h.calls.push("tabs.create:" + (url.url || url)) },
    permissions: { request: async p => { h.calls.push("permissions.request:" + p.permissions.join()); return typeof permission === "function" ? permission() : permission; } },
    scripting: { executeScript: async req => { h.calls.push("scripting.executeScript"); h.scanReq = req; return scan.map(result => ({ result })); } }, // scan은 프레임별 리소스 주소 목록; null이면 호출이 거부된다
    webRequest: { onResponseStarted: { addListener: (fn, filter, extra) => { h.calls.push("webRequest.add"); h.webRequest.push({ fn, filter, extra }); }, removeListener: fn => { h.calls.push("webRequest.remove"); h.webRequest = h.webRequest.filter(w => w.fn !== fn); } } },
    windows: { create() {} },
  };
  const context = vm.createContext({ chrome, console, URL, URLSearchParams, Promise, JSON, Object, Array, Math, Date, String, Number, Map, Set, crypto, TextEncoder,
    document: { getElementById: el, createElement: () => element(), documentElement: { dataset: {} }, addEventListener() {} }, window: { addEventListener() {} }, location: { search: "" },
    setTimeout: (fn, ms) => { const t = { fn, ms }; h.timers.push(t); return t; }, clearTimeout: t => { h.timers = h.timers.filter(x => x !== t); } });
  for (const file of ["lib/settings.js", "lib/media-source.js", "lib/package-store.js", "lib/library.js", "lib/note-export.js", "sidepanel.js"]) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  context.Account = account; // 스크립트가 만들지 않는 전역만 나중에 심는다(package-store.js가 globalThis를 덮어쓰므로 어댑터만 바꾼다)
  h.folder = { ...folder }; h.picked = 0; h.regranted = 0;
  context.NoteFile = { ensureLibraryKey: ensureKey, loadLibraryKey: async () => ({}) };
  context.LibraryFolder = { status: async () => ({ ...h.folder }), pick: async () => { h.picked++; return (h.folder = { state: "ok", name: "Notes" }); }, regrant: async () => { h.regranted++; return (h.folder = { ...h.folder, state: "ok" }); },
    adoptSettings: async (a, load, save) => { if (!h.backupSettings) return false; await save(h.backupSettings); return true; }, watchSettings: () => {} };
  context.PackageStore = { ...context.PackageStore, indexedDbAdapter: async () => ({}) };
  h.until = async pred => { for (let i = 0; i < 200 && !pred(); i++) await new Promise(r => setImmediate(r)); assert.ok(pred(), "기다리던 일이 일어나지 않았다"); };
  h.el = el;
  h.types = () => h.sent.map(m => m.type);
  h.tell = (message, sender = BG_SENDER) => h.listeners.forEach(fn => fn({ target: "panel", ...message }, sender));
  h.status = () => el("bgStatus").textContent;
  h.visible = id => el(id).hidden === false;
  h.hls = (url, tabId = 7, extra = {}) => h.webRequest.slice().forEach(w => w.fn({ tabId, url, type: "xmlhttprequest", responseHeaders: [], ...extra }));
  await h.until(() => h.types().includes("GET_STATE")); // 시작 흐름이 끝날 때까지
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  return h;
}

test("the control is hidden unless the account's /v1/me features include background, and Free users cause no background traffic", async () => {
  const free = await panel({ list: { ok: true, background: false, jobs: [] } });
  assert.equal(free.visible("bgBox"), false);
  const unreachable = await panel({ list: { ok: false, error: "x" } });
  assert.equal(unreachable.visible("bgBox"), false);
  const unconfigured = await panel({ store: { consentAccepted: true } }); // 서비스 연결이 없으면 묻지도 않는다
  assert.equal(unconfigured.visible("bgBox"), false);
  assert.ok(!unconfigured.types().includes("BG_LIST"));
  const paid = await panel();
  assert.equal(paid.visible("bgBox"), true);
  assert.deepEqual(paid.sent.filter(m => m.type === "BG_LIST").length, 1);
  for (const h of [free, unreachable, unconfigured, paid]) assert.ok(!h.types().includes("BG_RUN") && !h.types().includes("START_SESSION"));
});

test("missing consents ask inline: '동의하고 계속' opens the consent step and the same job continues only once consents pass", async () => {
  // 외부 요약 처리 동의는 필수가 아니다 — 없으면 인식만 만들 뿐 시작을 막지 않는다(아래 테스트에서 따로 확인).
  for (const store of [{ ...CONSENTS, backgroundConsent: { personalUse: true, accessRights: false, version: TERMS_VERSION, at: 1 } }, { ...CONSENTS, visionConsent: false }, { ...CONSENTS, backgroundConsent: { personalUse: true, accessRights: true, version: "1999-01-01", at: 1 } }]) {
    const h = await panel({ store });
    await h.el("bgBtn").click();
    assert.match(h.status(), /동의/);
    assert.equal(h.visible("bgConsentBtn"), true);
    assert.deepEqual(h.calls.filter(c => c.startsWith("permissions")), []);
    assert.ok(!h.types().includes("BG_RUN"));
  }
  // 동의하고 계속 → 동의 단계를 마치면 저장소를 다시 읽어 같은 작업을 이어 시작한다
  const h = await panel({ store: { ...CONSENTS, visionConsent: false } });
  await h.el("bgBtn").click();
  assert.equal(h.visible("bgConsentBtn"), true);
  h.store.visionConsent = true; h.store.visionConsentVersion = TERMS_VERSION; h.store.visionConsentAt = 1; // 온보딩에서 방금 동의
  await h.el("bgConsentBtn").click();
  await h.el("obDone").click();
  await h.until(() => h.calls.includes("permissions.request:webRequest"));
  h.hls("https://cdn.example.com/a.m3u8");
  await h.until(() => h.types().includes("BG_RUN"));
  // 동의를 마치지 못하고 온보딩이 닫히면(다른 단계로 대체되면) 시작하지 않는다
  const bail = await panel({ store: { ...CONSENTS, visionConsent: false } });
  await bail.el("bgBtn").click();
  await bail.el("bgConsentBtn").click();
  await bail.el("storePassBtn").click(); // 다른 온보딩이 열려 consent 대기가 false로 끝난다
  assert.deepEqual(bail.calls.filter(c => c.startsWith("permissions")), []);
  assert.ok(!bail.types().includes("BG_RUN"));
});

test("without remoteSummaryConsent the job still starts after telling the user it will be recognition-only, with an inline 동의하기", async () => {
  const h = await panel({ store: { ...CONSENTS, remoteSummaryConsent: false } });
  await h.el("bgBtn").click();
  assert.match(h.el("bgProgress").textContent, /외부 요약 처리에 동의하지 않아 인식 결과만 만듭니다/, "시작 전에 알려야 한다");
  assert.equal(h.visible("bgSummaryLink"), true);
  h.hls("https://cdn.example.com/a.m3u8");
  await h.until(() => h.types().includes("BG_RUN"), "동의가 없어도 작업은 시작된다");
  assert.match(h.el("bgProgress").textContent, /인식 결과만 만듭니다/);
  // 인라인 동의하기는 동의 단계를 열고, 마치면 링크를 거둔다
  h.store.remoteSummaryConsent = true; h.store.summaryConsentVersion = TERMS_VERSION; h.store.summaryConsentAt = 1;
  await h.el("bgSummaryLink").click();
  await h.el("obDone").click();
  assert.equal(h.visible("bgSummaryLink"), false);
  // 동의가 있으면 안내가 없다
  const consented = await panel();
  await consented.el("bgBtn").click();
  assert.equal(consented.el("bgProgress").textContent, "");
  assert.equal(consented.visible("bgSummaryLink"), false);
});

test("YouTube is live-mode only: the button is disabled and the notice shown before any click", async () => {
  for (const url of ["https://www.youtube.com/watch?v=abc", "https://youtu.be/abc", "https://www.youtube-nocookie.com/embed/abc"]) {
    const h = await panel({ tabs: [{ id: 7, url, title: "yt" }] });
    assert.equal(h.el("bgBtn").disabled, true, `${url}: 클릭 전부터 비활성이다`);
    assert.match(h.status(), /실시간 캡처만 지원/, url);
    await h.el("bgBtn").click(); // 비활성이어도 경로 자체는 막혀 있다
    assert.deepEqual(h.calls.filter(c => c.startsWith("permissions") || c.startsWith("webRequest")), []);
    assert.ok(!h.types().includes("BG_RUN") && !h.types().includes("START_SESSION"));
    assert.equal(h.visible("bgLiveBtn"), false);
  }
  // lib/background-job.js 와 같은 호스트 목록이다
  const list = /YOUTUBE\s*=\s*(\/.*\/i)/, mine = fs.readFileSync("sidepanel.js", "utf8").match(list)[1], theirs = fs.readFileSync("lib/background-job.js", "utf8").match(list)[1];
  assert.equal(mine, theirs);
});

test("on click it asks for webRequest first, watches only the lecture tab for an HLS playlist, then stops watching and sends BG_RUN", async () => {
  const h = await panel();
  const click = h.el("bgBtn").click();
  assert.equal(h.calls[0], "permissions.request:webRequest", "권한 요청이 클릭 제스처 안의 첫 호출이다");
  await click;
  assert.equal(h.webRequest.length, 1);
  const { filter, extra } = h.webRequest[0];
  assert.equal(filter.tabId, 7);
  assert.deepEqual([...filter.types], ["media", "xmlhttprequest"]);
  assert.deepEqual([...extra], ["responseHeaders"]);
  assert.equal(h.el("bgBtn").disabled, true);
  h.hls("https://cdn.example.com/other.m3u8", 99); // 다른 탭의 요청
  h.hls("https://cdn.example.com/seg1.ts", 7); // 세그먼트는 소스 후보가 아니다
  h.hls("https://cdn.example.com/video.mp4", 7);
  assert.equal(h.webRequest.length, 1);
  assert.ok(!h.types().includes("BG_RUN"));
  h.hls("https://cdn.example.com/master.m3u8?sig=abc", 7);
  assert.equal(h.webRequest.length, 0, "찾으면 바로 관찰을 끝낸다");
  assert.equal(h.timers.length, 0);
  await h.until(() => h.types().includes("BG_RUN"));
  const run = h.sent.find(m => m.type === "BG_RUN");
  assert.deepEqual({ ...run, jobId: typeof run.jobId }, { type: "BG_RUN", target: "background", jobId: "string", tabId: 7, source: { playlistUrl: "https://cdn.example.com/master.m3u8?sig=abc" } }, "페이지 주소는 background 가 탭에서 읽는다");
  assert.match(run.jobId, /^lec-[0-9a-f]{32}$/);
  assert.equal(h.visible("bgCancelBtn"), true);
  // MIME 으로 알려진 재생목록도 찾는다
  const mime = await panel();
  await mime.el("bgBtn").click();
  mime.hls("https://cdn.example.com/playlist", 7, { type: "xmlhttprequest", responseHeaders: [{ name: "Content-Type", value: "application/vnd.apple.mpegurl; charset=utf-8" }] });
  await mime.until(() => mime.types().includes("BG_RUN"));
});

test("an already-playing lecture: the per-frame resource scan finds the loaded playlist and BG_RUN goes out without watching the network", async () => {
  const h = await panel({ scan: [["https://cdn.example.com/seg1.ts", "https://cdn.example.com/loaded.m3u8"], ["https://cdn.example.com/player.m3u8?sig=2"]] });
  const click = h.el("bgBtn").click();
  assert.equal(h.calls[0], "permissions.request:webRequest", "권한 요청이 스캔보다 먼저다 — 클릭 제스처 안의 첫 호출");
  await click;
  assert.equal(h.calls[1], "scripting.executeScript");
  assert.deepEqual({ ...h.scanReq.target }, { tabId: 7, allFrames: true });
  await h.until(() => h.types().includes("BG_RUN"));
  assert.equal(h.sent.find(m => m.type === "BG_RUN").source.playlistUrl, "https://cdn.example.com/player.m3u8?sig=2", "목록이 있는 프레임의 마지막 hls가 이긴다");
  assert.deepEqual(h.calls.filter(c => c.startsWith("webRequest")), [], "스캔이 찾으면 네트워크는 보지 않는다");
  assert.equal(h.timers.length, 0, "기다리지도 않는다");
});

test("a scan that finds DASH or MP4 but no HLS fails fast with the format message and a live-mode button", async () => {
  for (const [urls, re] of [[["https://cdn.example.com/manifest.mpd"], /DASH 방식이라 아직/], [["https://cdn.example.com/lecture.mp4"], /MP4 파일 방식이라 아직/]]) {
    const h = await panel({ scan: [urls] });
    await h.el("bgBtn").click();
    await h.until(() => re.test(h.status()));
    assert.match(h.status(), /실시간 캡처를 쓰세요\./);
    assert.equal(h.visible("bgLiveBtn"), true, "문구가 가리키는 실시간 모드 버튼을 단다");
    assert.equal(h.visible("bgRetryBtn"), false, "같은 영상을 다시 찾아도 같은 방식이다");
    assert.deepEqual(h.calls.filter(c => c.startsWith("webRequest")), [], "관찰하지 않고 바로 끝낸다");
    assert.ok(!h.types().includes("BG_RUN") && !h.types().includes("START_SESSION"));
  }
  // HLS가 같이 보이면 HLS가 이긴다 — 페이지의 다른 mp4가 목록을 가리지 않는다
  const h = await panel({ scan: [["https://cdn.example.com/poster.mp4", "https://cdn.example.com/m.m3u8"]] });
  await h.el("bgBtn").click();
  await h.until(() => h.types().includes("BG_RUN"));
  assert.equal(h.sent.find(m => m.type === "BG_RUN").source.playlistUrl, "https://cdn.example.com/m.m3u8");
});

test("a scan that finds nothing — or fails outright — still falls back to the webRequest watch", async () => {
  for (const scan of [[[]], null]) {
    const h = await panel({ scan });
    await h.el("bgBtn").click();
    assert.deepEqual(h.calls.slice(0, 2), ["permissions.request:webRequest", "scripting.executeScript"], "권한 요청 뒤 스캔, 그다음 관찰");
    assert.equal(h.webRequest.length, 1, "스캔이 비면 오늘의 관찰로 넘어간다");
    h.hls("https://cdn.example.com/a.m3u8");
    await h.until(() => h.types().includes("BG_RUN"));
  }
});

test("no playlist, a refused permission or a refused BG_RUN each end with a message and nothing started", async () => {
  const none = await panel();
  await none.el("bgBtn").click();
  assert.equal(none.timers.length, 1);
  assert.equal(none.timers[0].ms <= 15000, true, "몇 초만 본다");
  none.timers[0].fn();
  await none.until(() => none.webRequest.length === 0 && /찾지 못했습니다/.test(none.status()));
  assert.ok(none.calls.includes("webRequest.remove"));
  assert.equal(none.visible("bgRetryBtn"), true);
  assert.deepEqual([none.types().includes("BG_RUN"), none.types().includes("START_SESSION")], [false, false]);
  const denied = await panel({ permission: false });
  await denied.el("bgBtn").click();
  await denied.until(() => /찾지 못했습니다/.test(denied.status()));
  assert.deepEqual([denied.calls.includes("webRequest.add"), denied.types().includes("BG_RUN")], [false, false]);
  const busy = await panel({ run: { ok: false, busy: true, error: "이미 백그라운드 작업이 진행 중입니다. 끝난 뒤 다시 시도하세요." } });
  await busy.el("bgBtn").click(); busy.hls("https://cdn.example.com/a.m3u8");
  await busy.until(() => /이미 백그라운드 작업/.test(busy.status()));
  assert.equal(busy.visible("bgRetryBtn"), true);
  assert.equal(busy.el("bgBtn").disabled, false);
});

test("progress shows the stage count, label and elapsed clock, and only for this job from offscreen", async () => {
  const h = await panel();
  await h.el("bgBtn").click(); h.hls("https://cdn.example.com/a.m3u8");
  await h.until(() => h.types().includes("BG_RUN"));
  const jobId = h.sent.find(m => m.type === "BG_RUN").jobId;
  h.tell({ type: "BG_PROGRESS", jobId, state: "ingesting", counts: { recv: 12, decode: 11, vision: 3, stt: 2, "weird-stage": 9 } }, OFFSCREEN);
  assert.equal(h.status(), "단계 3/9 · 수신·인식");
  assert.equal(h.el("bgProgress").textContent, "수신 12 · 해석 11 · 화면 3 · 음성 2");
  assert.equal(h.el("bgBar").hidden, false);
  assert.equal(h.el("bgBar").value, 3);
  assert.equal(h.el("bgTime").hidden, false);
  assert.match(h.el("bgTime").textContent, /^\d{2}:\d{2}$/);
  assert.equal(h.visible("bgCancelBtn"), true);
  h.tell({ type: "BG_PROGRESS", jobId: "other", state: "writing", counts: { write: 1 } }, OFFSCREEN);
  h.tell({ type: "BG_PROGRESS", jobId, state: "writing", counts: { write: 99 } }, { id: "ext", url: "https://evil.example/" });
  h.tell({ type: "BG_PROGRESS", jobId, state: "writing", counts: { write: 99 } }, { id: "other", url: OFFSCREEN.url });
  h.tell({ type: "BG_PROGRESS", jobId, state: "writing", counts: { write: 99 } }, { id: "ext", url: "chrome-extension://ext/sidepanel.html" });
  assert.equal(h.status(), "단계 3/9 · 수신·인식", "다른 작업·다른 송신자의 진행은 무시한다");
  await h.el("bgCancelBtn").click();
  assert.ok(h.types().includes("BG_CANCEL"));
});

test("protected, unsupported or unreadable sources show the pipeline's message and offer live mode, which starts only on the user's click", async () => {
  for (const code of ["SRC_PROTECTED", "SRC_UNSUPPORTED_HOST", "SRC_BAD_PLAYLIST"]) {
    const h = await panel();
    await h.el("bgBtn").click(); h.hls("https://cdn.example.com/a.m3u8");
    await h.until(() => h.types().includes("BG_RUN"));
    const jobId = h.sent.find(m => m.type === "BG_RUN").jobId, message = `${code} 안내: 실시간 모드로 진행할지 선택해 주세요.`;
    h.tell({ type: "BG_DONE", jobId, status: "failed", code, reason: null, suggest: "live", message });
    assert.equal(h.status(), message);
    assert.equal(h.visible("bgLiveBtn"), true);
    assert.equal(h.visible("bgRetryBtn"), false, "보호된 영상은 다시 시도해도 같다");
    // 아무리 기다려도 실시간 캡처는 시작되지 않는다
    for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r));
    h.timers.splice(0).forEach(t => t.fn());
    assert.ok(!h.types().includes("START_SESSION"), `${code}: 클릭 전에 START_SESSION 이 나갔다`);
    await h.el("bgLiveBtn").click();
    await h.until(() => h.types().includes("START_SESSION"));
    assert.equal(h.types().filter(t => t === "START_SESSION").length, 1);
    assert.equal(h.sent.find(m => m.type === "START_SESSION").options.tabId, 7);
  }
  // 제안이 없는 실패에는 실시간 모드 버튼도 없다
  const h = await panel();
  await h.el("bgBtn").click(); h.hls("https://cdn.example.com/a.m3u8");
  await h.until(() => h.types().includes("BG_RUN"));
  const jobId = h.sent.find(m => m.type === "BG_RUN").jobId;
  h.tell({ type: "BG_DONE", jobId, status: "failed", code: "SRC_NOT_IN_PLAN", message: "현재 요금제에서는 백그라운드 처리를 쓸 수 없습니다." });
  assert.equal(h.visible("bgLiveBtn"), false);
  h.tell({ type: "BG_DONE", jobId, status: "failed", code: "UNKNOWN" });
  assert.match(h.status(), /UNKNOWN/);
  // 결말은 background.js 가 전한 것만 믿는다
  const spoof = await panel();
  await spoof.el("bgBtn").click(); spoof.hls("https://cdn.example.com/a.m3u8");
  await spoof.until(() => spoof.types().includes("BG_RUN"));
  const id = spoof.sent.find(m => m.type === "BG_RUN").jobId, before = spoof.status();
  for (const sender of [OFFSCREEN, { id: "ext", url: "https://evil.example/" }, { id: "other", url: BG_SENDER.url }, { id: "ext", url: "chrome-extension://ext/sidepanel.html" }]) spoof.tell({ type: "BG_DONE", jobId: id, status: "failed", code: "SRC_PROTECTED", suggest: "live", message: "가짜" }, sender);
  assert.equal(spoof.status(), before);
  assert.equal(spoof.visible("bgLiveBtn"), false);
});

test("a paused job offers 다시 시도, which resumes the same job id; an expired lecture session looks for the playlist again", async () => {
  const h = await panel();
  await h.el("bgBtn").click(); h.hls("https://cdn.example.com/a.m3u8");
  await h.until(() => h.types().includes("BG_RUN"));
  const first = h.sent.find(m => m.type === "BG_RUN");
  h.tell({ type: "BG_DONE", jobId: first.jobId, status: "paused", code: "NET_UNREACHABLE", reason: "network", message: "네트워크에 연결할 수 없거나 응답이 늦습니다." });
  assert.equal(h.status(), "네트워크에 연결할 수 없거나 응답이 늦습니다.");
  assert.equal(h.visible("bgRetryBtn"), true);
  assert.equal(h.el("bgBtn").disabled, false);
  h.calls.length = 0;
  await h.el("bgRetryBtn").click();
  await h.until(() => h.types().filter(t => t === "BG_RUN").length === 2);
  const again = h.sent.filter(m => m.type === "BG_RUN")[1];
  assert.deepEqual({ ...again }, { ...first }, "같은 jobId, 같은 소스, 같은 탭");
  assert.deepEqual(h.calls, [], "다시 권한을 묻거나 관찰하지 않는다");
  // 로그인 세션 만료: 강의 탭을 다시 연 뒤라 주소가 바뀌었을 수 있다
  h.tell({ type: "BG_DONE", jobId: first.jobId, status: "paused", code: "SRC_AUTH_EXPIRED", reason: "auth", message: "로그인 세션이 만료됐습니다. 강의 탭을 다시 열어 주세요." });
  await h.el("bgRetryBtn").click();
  assert.ok(h.calls.includes("webRequest.add"));
  h.hls("https://cdn.example.com/new-signature/a.m3u8");
  await h.until(() => h.types().filter(t => t === "BG_RUN").length === 3);
  const renewed = h.sent.filter(m => m.type === "BG_RUN")[2];
  assert.equal(renewed.jobId, first.jobId);
  assert.equal(renewed.source.playlistUrl, "https://cdn.example.com/new-signature/a.m3u8");
  // 요약 동의가 없어 멈췄다면 재시도가 아니라 '노트 만들기'를 단다(인라인 동의 → LIB_REGENERATE)
  h.tell({ type: "BG_DONE", jobId: first.jobId, status: "paused", code: "CONSENT_SUMMARY_REQUIRED", reason: "user", message: "요약을 만들려면 동의해야 합니다.", packageId: "Lp1-paused1" });
  assert.equal(h.visible("bgMakeBtn"), true);
  assert.equal(h.visible("bgRetryBtn"), false, "동의 문제는 재시도로 풀리지 않는다");
  assert.ok(!h.types().includes("START_SESSION"));
});

test("a finished job keeps the stats and notice lines and renders the shared save box from saved+packageId", async () => {
  const h = await panel();
  await h.el("bgBtn").click(); h.hls("https://cdn.example.com/a.m3u8");
  await h.until(() => h.types().includes("BG_RUN"));
  const jobId = h.sent.find(m => m.type === "BG_RUN").jobId;
  h.tell({ type: "BG_DONE", jobId, status: "complete", code: null, packageId: "Lp1-abc123", saved: "file", stats: { slides: 12, chunks: 8, gaps: 1 }, notices: [{ code: "NOTE_CAPTURE_GAP", count: 2 }, { code: "NOTE_GLOBAL_FAILED", count: null }] });
  const text = h.status();
  assert.match(text, /노트 준비됨/);
  assert.match(text, /슬라이드 12/);
  assert.match(text, /인식하지 못한 구간 2곳/);
  assert.match(text, /강의 전체 요약을 만들지 못했습니다/);
  assert.ok(!text.includes("NOTE_"), "날 코드는 보이지 않는다");
  // 저장 안내는 상태 문장이 아니라 공용 저장 상자(renderSaved)가 그린다
  assert.equal(h.el("bgSave").hidden, false);
  const savedText = h.el("bgSave").children.map(c => c.textContent).join("\n");
  assert.match(savedText, /암호화해 보관함 폴더에 저장/);
  assert.equal(h.el("bgBar").hidden, true, "결말이 오면 진행 막대와 시계를 멈춘다");
  assert.equal(h.el("bgTime").hidden, true);
  assert.deepEqual(["bgRetryBtn", "bgCancelBtn", "bgLiveBtn", "bgMakeBtn", "bgConsentBtn"].map(id => h.visible(id)), [false, false, false, false, false]);
  h.tell({ type: "BG_DONE", jobId, status: "partial", stats: { slides: 1, chunks: 1, gaps: 0 }, notices: [] });
  assert.match(h.status(), /노트 준비됨 \(일부 섹션 제외\)/);
  h.tell({ type: "BG_DONE", jobId, status: "cancelled" });
  assert.match(h.status(), /취소/);
  assert.equal(h.el("bgBtn").disabled, false);
});

test("notice lines format ranges, sum the pruned codes into one line, hide advisory hints and ids, and keep raw codes only when unknown", async () => {
  const h = await panel();
  await h.el("bgBtn").click(); h.hls("https://cdn.example.com/a.m3u8");
  await h.until(() => h.types().includes("BG_RUN"));
  const jobId = h.sent.find(m => m.type === "BG_RUN").jobId;
  h.tell({ type: "BG_DONE", jobId, status: "complete", stats: { slides: 3, chunks: 2 }, notices: [
    { code: "NOTE_CAPTURE_GAP", ranges: [{ t0: 725, t1: 820 }, { t0: 3730, t1: 3780 }, { t0: 100, t1: 110 }, { t0: 200, t1: 210 }, { t0: 300, t1: 310 }] },
    { code: "NOTE_TARGET_DROPPED", count: 2 },
    { code: "NOTE_CALC_DROPPED", count: 1 },
    { code: "NOTE_ADVISORY_LAYOUT", count: 5 },
    { code: "NOTE_UNITS_UNCITED", count: 1, ids: ["secret-id-9"] },
    { code: "NOTE_SOMETHING_NEW", count: 3 },
  ]});
  const text = h.status();
  assert.match(text, /인식하지 못한 구간 1곳 \(12:05–13:40, 1:02:10–1:03:00, 1:40–1:50 외 2곳\)/, "m:ss 아래는 분:초, 한 시간부터는 시:분:초, 3곳까지만 나열한다");
  assert.match(text, /연결된 내용이 빠져 함께 뺀 항목 3건/, "여러 pruned 코드는 한 줄로 합산한다");
  assert.match(text, /노트에 반영되지 않은 강의 구간 1곳/);
  assert.ok(!text.includes("ADVISORY"), "렌더러 힌트는 사용자 고지가 아니다");
  assert.ok(!text.includes("secret-id-9"), "고지 id는 절대 보이지 않는다");
  assert.match(text, /기타 고지: NOTE_SOMETHING_NEW×3/);
});

test("each pause reason gets its own button: quota has no retry, expired auth is labelled, the label resets, and unknown codes fall back to the 문의 안내", async () => {
  const h = await panel();
  await h.el("bgBtn").click(); h.hls("https://cdn.example.com/a.m3u8");
  await h.until(() => h.types().includes("BG_RUN"));
  const jobId = h.sent.find(m => m.type === "BG_RUN").jobId;
  h.tell({ type: "BG_DONE", jobId, status: "paused", code: "QUOTA_EXCEEDED", message: "이번 달 한도를 다 썼습니다." });
  assert.equal(h.status(), "이번 달 한도를 다 썼습니다.");
  assert.equal(h.visible("bgRetryBtn"), false, "할당량 초과는 다시 시도해도 같다");
  assert.equal(h.visible("bgBilling"), true, "요금제 보기 링크를 단다");
  h.tell({ type: "BG_DONE", jobId, status: "paused", code: "SRC_AUTH_EXPIRED", message: "로그인 세션이 만료됐습니다." });
  assert.equal(h.visible("bgBilling"), false, "다음 화면으로 링크가 새면 안 된다");
  assert.equal(h.visible("bgRetryBtn"), true);
  assert.equal(h.el("bgRetryBtn").textContent, "강의 탭을 연 뒤 다시 시도");
  h.tell({ type: "BG_DONE", jobId, status: "paused", code: "NET_UNREACHABLE", message: "네트워크가 늦습니다." });
  assert.equal(h.el("bgRetryBtn").textContent, "다시 시도", "표시 이름이 다음 화면으로 새면 안 된다");
  h.tell({ type: "BG_DONE", jobId, status: "paused", code: "SOMETHING_ODD", message: null });
  assert.equal(h.status(), "백그라운드 처리를 마치지 못했습니다. 같은 문제가 반복되면 메뉴의 고객지원으로 문의해 주세요. (코드: SOMETHING_ODD)");
  h.tell({ type: "BG_DONE", jobId, status: "failed", code: null, message: null });
  assert.equal(h.status(), "백그라운드 처리를 마치지 못했습니다. 같은 문제가 반복되면 메뉴의 고객지원으로 문의해 주세요.", "코드가 없으면 괄호도 없다");
});

test("reopening the panel reports a running job or one that can be resumed with its own id", async () => {
  const running = await panel({ list: { ok: true, background: true, jobs: [{ jobId: "job-running1", state: "ingesting", code: null, running: true }] } });
  assert.equal(running.visible("bgCancelBtn"), true);
  assert.equal(running.visible("bgRetryBtn"), false);
  assert.equal(running.el("bgBar").hidden, false);
  running.tell({ type: "BG_PROGRESS", jobId: "job-running1", state: "judging", counts: { recv: 3 } }, OFFSCREEN);
  assert.equal(running.el("bgProgress").textContent, "수신 3");
  assert.equal(running.status(), "단계 5/9 · 판정");
  // 멈춘 작업은 단계 이름과 짧은 사유, 그리고 이어 하기·버리기 버튼으로 알린다
  const reasons = [["SRC_AUTH_EXPIRED", "ingesting", /강의 로그인이 만료됨/], ["NET_UNREACHABLE", "writing", /네트워크 오류/], ["SOMETHING_ODD", "refining", /코드 SOMETHING_ODD/]];
  for (const [code, state, re] of reasons) {
    const j = await panel({ list: { ok: true, background: true, jobs: [{ jobId: "job-" + code, state, code, running: false }] } });
    assert.match(j.status(), /이어서 처리할 작업이 있습니다:/, code);
    assert.match(j.status(), re, code);
    assert.equal(j.visible("bgRetryBtn"), true);
    assert.equal(j.visible("bgDiscardBtn"), true);
  }
  const paused = await panel({ list: { ok: true, background: true, jobs: [{ jobId: "job-paused01", state: "ingesting", code: "QUOTA_EXCEEDED", running: false }] } });
  assert.match(paused.status(), /이어서 처리할 작업이 있습니다: 수신·인식 — 이번 달 한도 도달/);
  assert.equal(paused.visible("bgRetryBtn"), true);
  assert.ok(!paused.types().includes("BG_RUN"), "열자마자 시작하지 않는다");
  await paused.el("bgRetryBtn").click();
  paused.hls("https://cdn.example.com/a.m3u8");
  await paused.until(() => paused.types().includes("BG_RUN"));
  assert.equal(paused.sent.find(m => m.type === "BG_RUN").jobId, "job-paused01");
  assert.ok(!paused.types().includes("START_SESSION"));
});

test("the resume row's 작업 버리기 confirms then sends BG_DISCARD and hides the resume UI", async () => {
  const h = await panel({ list: { ok: true, background: true, jobs: [{ jobId: "job-paused01", state: "writing", code: "NET_UNREACHABLE", running: false }] } });
  assert.match(h.status(), /이어서 처리할 작업이 있습니다: 작성 — 네트워크 오류/);
  assert.equal(h.visible("bgDiscardBtn"), true);
  await h.el("bgDiscardBtn").click();
  const d = h.sent.find(m => m.type === "BG_DISCARD");
  assert.equal(d.jobId, "job-paused01");
  assert.equal(h.visible("bgDiscardBtn"), false, "버리면 이어 하기 UI를 거둔다");
  assert.equal(h.visible("bgRetryBtn"), false);
  assert.ok(!h.types().includes("BG_RUN"));
});

test("CONSENT_SUMMARY_REQUIRED offers 노트 만들기 (inline consent → LIB_REGENERATE → shared save box), not retry", async () => {
  const h = await panel({ store: { ...CONSENTS, remoteSummaryConsent: false } });
  await h.el("bgBtn").click(); h.hls("https://cdn.example.com/a.m3u8");
  await h.until(() => h.types().includes("BG_RUN"));
  const jobId = h.sent.find(m => m.type === "BG_RUN").jobId;
  h.tell({ type: "BG_DONE", jobId, status: "paused", code: "CONSENT_SUMMARY_REQUIRED", reason: "user", packageId: "Lp1-abc123" });
  assert.equal(h.status(), "인식을 마쳤습니다. 노트를 만들려면 외부 요약 처리에 동의하세요.");
  assert.equal(h.visible("bgMakeBtn"), true);
  assert.equal(h.visible("bgRetryBtn"), false, "재시도 버튼은 달지 않는다");
  // 노트 만들기 → 요약 동의가 없으면 동의 단계부터 → 이어서 LIB_REGENERATE → 응답의 saved로 저장 상자를 그린다
  h.store.remoteSummaryConsent = true; h.store.summaryConsentVersion = TERMS_VERSION; h.store.summaryConsentAt = 1;
  await h.el("bgMakeBtn").click();
  await h.el("obDone").click();
  await h.until(() => h.types().includes("LIB_REGENERATE"));
  const regen = h.sent.find(m => m.type === "LIB_REGENERATE");
  assert.equal(regen.packageId, "Lp1-abc123");
  assert.deepEqual(regen.options, { syntheticExamples: false, externalAugmentation: false });
  assert.equal(h.el("bgSave").hidden, false);
  assert.match(h.el("bgSave").children.map(c => c.textContent).join("\n"), /암호화해 보관함 폴더에 저장/);
  assert.match(h.status(), /노트 준비됨/);
});

test("the main button derives the job id from the tab URL: same lecture same id, different id different job, fragment ignored", async () => {
  const runId = async url => {
    const h = await panel({ tabs: [{ id: 7, url, title: "강의" }] });
    await h.el("bgBtn").click(); h.hls("https://cdn.example.com/a.m3u8");
    await h.until(() => h.types().includes("BG_RUN"));
    return h.sent.find(m => m.type === "BG_RUN").jobId;
  };
  const a = await runId("https://lms.example.com/viewer.php?id=4522324");
  assert.match(a, /^lec-[0-9a-f]{32}$/);
  assert.match(a, /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/, "작업 번호 모양 규칙을 지킨다");
  assert.equal(await runId("https://lms.example.com/viewer.php?id=4522324"), a, "같은 강의는 같은 번호 — 이전 작업을 이어 쓴다");
  assert.equal(await runId("https://lms.example.com/viewer.php?id=4522324#week3"), a, "조각은 무시한다");
  assert.notEqual(await runId("https://lms.example.com/viewer.php?id=9999999"), a, "다른 강의는 다른 번호");
  assert.notEqual(await runId("https://lms.example.com/other.php?id=4522324"), a, "경로도 다르면 다른 번호");
  // 재시도의 명시된 번호가 유지되는지는 위 "paused ... retry" 테스트(같은 jobId)가 본다
});

test("a BG_RUN reply with already:true shows the resume notice; already+done shows the done notice and the save box rides the next BG_DONE", async () => {
  const h = await panel({ run: { ok: true, already: true, state: "planning" } });
  await h.el("bgBtn").click(); h.hls("https://cdn.example.com/a.m3u8");
  await h.until(() => h.types().includes("BG_RUN"));
  await h.until(() => /이전에 처리한 강의입니다/.test(h.status()));
  assert.equal(h.status(), "이전에 처리한 강의입니다. 인식 결과를 다시 쓰고 이어서 노트를 만듭니다.");
  assert.equal(h.visible("bgCancelBtn"), true, "이어 도는 작업은 취소할 수 있다");
  const done = await panel({ run: { ok: true, already: true, state: "done" } });
  await done.el("bgBtn").click(); done.hls("https://cdn.example.com/a.m3u8");
  await done.until(() => done.types().includes("BG_RUN"));
  await done.until(() => done.status() === "이미 노트를 만든 강의입니다.");
  const jobId = done.sent.find(m => m.type === "BG_RUN").jobId;
  done.tell({ type: "BG_DONE", jobId, status: "done", code: null, packageId: "Lp1-abc123", saved: "file" });
  assert.equal(done.status(), "이미 노트를 만든 강의입니다.");
  assert.equal(done.el("bgSave").hidden, false, "끝난 작업의 저장 안내를 그대로 그린다");
  assert.match(done.el("bgSave").children.map(c => c.textContent).join("\n"), /암호화해 보관함 폴더에 저장/);
});

// ── 실시간 캡처: 요금제별 인식 라우팅·온보딩 게이트·인증 오류·노트 실패 상태 ──
test("start() opens the missing onboarding steps even when consentAccepted is true, and starts only after they finish", async () => {
  const account = fakeAccount();
  const h = await panel({ account });
  account.session = null; // 로그인이 풀렸다 — 시작 시점에 다시 보면 account 단계가 필요하다
  await h.el("startBtn").click();
  assert.equal(h.el("onboard").hidden, false, "부족한 단계가 있으면 온보딩이 먼저다");
  assert.ok(!h.types().includes("START_SESSION"));
  await h.el("obDone").click(); // 가짜 클릭은 disabled를 무시한다 — 실제로는 로그인해야 눌러진다
  await h.until(() => h.types().includes("START_SESSION"));
});

test("a paid plan without cloud consent gets the consent step, cannot finish it without obCloud, then starts in cloud mode", async () => {
  const h = await panel({ account: fakeAccount("essential"), store: { ...CONSENTS, visionConsent: false } });
  await h.el("startBtn").click();
  assert.equal(h.el("onboard").hidden, false);
  h.el("obSummary").checked = true; h.el("obSummary")._fire("change");
  assert.equal(h.el("obDone").disabled, true, "유료는 클라우드 인식 동의 없이 동의 단계를 끝낼 수 없다");
  h.el("obCloud").checked = true; h.el("obCloud")._fire("change");
  assert.equal(h.el("obDone").disabled, false);
  h.store.visionConsent = true; h.store.visionConsentVersion = TERMS_VERSION; h.store.visionConsentAt = 1; // 온보딩에서 방금 동의
  await h.el("obDone").click();
  await h.until(() => h.types().includes("START_SESSION"));
  const o = h.sent.find(m => m.type === "START_SESSION").options;
  assert.equal(o.recognition, "cloud");
  assert.deepEqual([o.ocrEnabled, o.whisperEnabled, o.ocrEngine], [true, true, "vision-cloud"]);
});

test("free stays on-device: recognition:'local' and the on-device engines in START_SESSION options", async () => {
  const h = await panel();
  await h.el("startBtn").click();
  await h.until(() => h.types().includes("START_SESSION"));
  const o = h.sent.find(m => m.type === "START_SESSION").options;
  assert.equal(o.recognition, "local");
  assert.equal(o.ocrEngine, "ppocr-v5-wasm");
});

test("an auth-coded failure shows a Google login button that signs in and clears the alert", async () => {
  const account = fakeAccount();
  const h = await panel({ account, start: { ok: false, error: "로그인이 필요합니다.", code: "AUTH_REQUIRED" } });
  await h.el("startBtn").click();
  await h.until(() => h.el("readyAlert").hidden === false);
  const b = h.el("readyAlert").children.at(-1);
  assert.equal(b.textContent, "Google로 로그인");
  await b.click();
  assert.equal(account.signIns, 1);
  assert.equal(h.el("readyAlert").hidden, true, "로그인하고 계정을 다시 확인한 뒤 알림을 거둔다");
});

test("obCheck starts the account fetch and the library key fetch together", async () => {
  const account = fakeAccount("essential"), started = [];
  let release;
  account.fetchAccount = () => { started.push("account"); return new Promise(r => { release = r; }); };
  await panel({ account, ensureKey: async () => (started.push("key"), null) });
  assert.deepEqual(started, ["account", "key"], "계정 조회가 끝나기 전에 키 열기도 시작됐다");
  release({ plan: "essential" });
});

test("the auth alert login sends step timings and asks BG_LIST again so a paid card shows without reopening the panel", async () => {
  const account = fakeAccount("essential");
  const h = await panel({ account, start: { ok: false, error: "로그인이 필요합니다.", code: "AUTH_REQUIRED" } });
  const lists = () => h.types().filter(t => t === "BG_LIST").length;
  const before = lists();
  await h.el("startBtn").click();
  await h.until(() => h.el("readyAlert").hidden === false);
  await h.el("readyAlert").children.at(-1).click();
  await h.until(() => lists() > before);
  assert.equal(h.visible("bgBox"), true, "패널을 다시 열지 않아도 유료 카드가 보인다");
  const msgs = h.sent.filter(m => m.type === "DIAG_EVENT").map(m => m.event.msg);
  for (const name of ["settings", "session", "account", "library_key", "render", "total"]) assert.ok(msgs.includes(name), name);
});

test("a failed note generation shows '노트 실패' and one primary 다시 시도, never '노트 준비됨'", async () => {
  const h = await panel();
  h.tell({ type: "SESSION_STATE", state: { sessionId: "s1", generation: 1, status: "completed", error: "요약을 만들지 못했습니다.", counts: { visual: 2, audio: 1 } } }, OFFSCREEN);
  assert.equal(h.el("donePill").textContent, "노트 실패");
  assert.ok(!/노트 준비됨/.test(h.el("status").textContent));
  assert.equal(h.visible("retryNoteBtn"), true);
  assert.equal(h.visible("notesBtn"), false, "실패 상태에는 다시 시도 버튼 하나다");
  await h.el("retryNoteBtn").click();
  await h.until(() => h.types().includes("GENERATE_NOTES"));
  h.tell({ type: "SESSION_STATE", state: { sessionId: "s1", generation: 2, status: "completed", counts: { visual: 2, audio: 1 }, summary: { status: "complete", note: { sections: [] }, saved: "file" } } }, OFFSCREEN);
  assert.notEqual(h.el("donePill").textContent, "노트 실패");
  assert.equal(h.visible("retryNoteBtn"), false);
});

test("voice defaults on: the engine step mirrors the setting, an off voice warns on the ready card, and the drawer toggle saves", async () => {
  // 온보딩 엔진 단계는 저장된 설정을 그대로 미리 채운다 — 새 사용자 기본값은 켜짐
  const fresh = await panel({ store: { ...CONSENTS, consentAccepted: false } });
  assert.equal(fresh.el("onboard").hidden, false);
  assert.equal(fresh.el("obWhisper").checked, true);
  const declined = await panel({ store: { ...CONSENTS, consentAccepted: false, whisperEnabled: false } });
  assert.equal(declined.el("obWhisper").checked, false, "저장된 선택을 그대로 보여 준다");
  // 로컬에서 음성이 꺼져 있으면 준비 카드는 '꺼짐'이 아니라 경고로 시작 전에 알린다
  const h = await panel({ store: { ...CONSENTS, whisperEnabled: false } });
  assert.equal(h.el("markVoice").className, "mark warn");
  assert.equal(h.el("voiceState").textContent, "꺼짐 — 음성은 기록되지 않습니다");
  assert.equal(h.el("whisperEnabledToggle").checked, false);
  assert.equal(h.el("whisperField").hidden, false);
  // 서랍 토글을 켜면 설정에 저장하고 준비 카드도 바로 고친다
  h.el("whisperEnabledToggle").checked = true;
  h.el("whisperEnabledToggle")._fire("change");
  await flush();
  assert.equal(h.el("markVoice").className, "mark");
  assert.match(h.el("voiceState").textContent, /Whisper .* \(로컬\)/);
  h.store.whisperEnabled = true; // 가짜 저장소의 set은 no-op — 저장 효과는 테스트가 심는다
  await h.el("startBtn").click();
  await h.until(() => h.types().includes("START_SESSION"));
  assert.equal(h.sent.find(m => m.type === "START_SESSION").options.whisperEnabled, true);
  // 꺼진 설정은 시작 옵션과 게이트에도 그대로다 — 둘 다 끄면 시작을 막는다
  const off = await panel({ store: { ...CONSENTS, whisperEnabled: false, ocrEnabled: false } });
  await off.el("startBtn").click();
  assert.match(off.el("readyAlert").textContent, /화면 또는 음성 인식 중 하나를 켜세요/);
  assert.ok(!off.types().includes("START_SESSION"));
  // 유료(서버 인식)에서는 OCR 행처럼 받아쓰기 토글도 숨긴다
  const paid = await panel({ account: fakeAccount("essential") });
  assert.equal(paid.el("whisperField").hidden, true);
  assert.equal(paid.el("ocrField").hidden, true);
  assert.equal(paid.el("voiceState").textContent, "음성 인식 · 서버");
});

test("the region check applies in cloud mode too, where the OCR toggle is hidden", async () => {
  // 유료 + 클라우드 인식 동의 → 서버 인식. OCR 토글이 숨겨져 있어도 영역 지정은 요구한다
  const h = await panel({ account: fakeAccount("essential") });
  assert.equal(h.el("ocrField").hidden, true);
  h.el("modeSelect").value = "region";
  await h.el("startBtn").click();
  assert.match(h.el("readyAlert").textContent, /슬라이드 영역을 드래그/);
  assert.match(h.el("cropHint").textContent, /슬라이드 영역을 드래그/);
  assert.ok(!h.types().includes("START_SESSION"));
  h.el("modeSelect").value = "slide";
  await h.el("startBtn").click();
  await h.until(() => h.types().includes("START_SESSION"));
  // 로컬 + OCR 켜짐도 같은 요구다(기존 동작)
  const local = await panel();
  local.el("modeSelect").value = "region";
  await local.el("startBtn").click();
  assert.match(local.el("readyAlert").textContent, /슬라이드 영역을 드래그/);
  assert.ok(!local.types().includes("START_SESSION"));
});

test("an auth-coded error keeps its login button when the same text re-renders without a code, and drops it when the text changes", async () => {
  const account = fakeAccount();
  const h = await panel({ account, start: { ok: false, error: "로그인이 필요합니다.", code: "AUTH_REQUIRED" } });
  await h.el("startBtn").click();
  await h.until(() => h.el("readyAlert").hidden === false);
  assert.equal(h.el("readyAlert").children.at(-1)?.textContent, "Google로 로그인");
  // 같은 문구가 코드 없이 다시 그려져도(render → setError(state.error)) 버튼은 남는다
  h.tell({ type: "SESSION_STATE", state: { sessionId: "s1", generation: 1, status: "failed", error: "로그인이 필요합니다.", counts: { visual: 0, audio: 0 } } }, OFFSCREEN);
  assert.equal(h.el("readyAlert").children.at(-1)?.textContent, "Google로 로그인");
  // 문구가 바뀌면 기억도 지운다
  h.tell({ type: "SESSION_STATE", state: { sessionId: "s1", generation: 2, status: "failed", error: "다른 오류입니다.", counts: { visual: 0, audio: 0 } } }, OFFSCREEN);
  assert.equal(h.el("readyAlert").textContent, "다른 오류입니다.");
  assert.equal(h.el("readyAlert").children.length, 0, "다른 문구에는 로그인 버튼이 새지 않는다");
});

test("the panel stays a thin adapter: no service client, no media fetching, no raw URLs in messages other than BG_RUN's playlist", () => {
  const html = fs.readFileSync("sidepanel.html", "utf8"), js = fs.readFileSync("sidepanel.js", "utf8");
  assert.doesNotMatch(html, /lib\/(service-client|pipeline|background-job|media-demux|media-decode)\.js/);
  assert.doesNotMatch(js, /\bfetch\(|XMLHttpRequest|ServiceClient/);
  assert.match(html, /lib\/media-source\.js/);
  for (const id of ["bgBox", "bgBtn", "bgStatus", "bgProgress", "bgBar", "bgTime", "bgSave", "bgRetryBtn", "bgCancelBtn", "bgLiveBtn", "bgConsentBtn", "bgSummaryLink", "bgMakeBtn", "bgDiscardBtn", "bgBilling"]) assert.match(html, new RegExp(`id="${id}"`), id);
});

test("onboarding never hides the settings drawer: an open drawer is close()d, and after onboarding finishes it re-opens visible and modal", async () => {
  const h = await panel();
  await h.el("settingsToggle").click(); // 변경 버튼 — 서랍을 모달로 연다
  assert.equal(h.el("settingsDrawer").open, true);
  h.folder = { state: "none", name: "" }; // 폴더가 사라진 채 시작하면 폴더 온보딩이 열린다
  await h.el("startBtn").click();
  await h.until(() => h.el("onboard").hidden === false);
  assert.equal(h.el("settingsDrawer").open, false, "열려 있던 서랍은 close()로 닫는다");
  assert.equal(h.el("settingsDrawer").hidden, false, "hidden은 건드리지 않는다 — 숨긴 모달이 패널을 얼렸다");
  await h.el("obFolderBtn").click();
  await h.el("obDone").click();
  assert.equal(h.el("onboard").hidden, true, "온보딩을 마치면 준비 화면으로 돌아간다");
  await h.el("settingsToggle").click();
  assert.equal(h.el("settingsDrawer").hidden, false);
  assert.equal(h.el("settingsDrawer").open, true);
  assert.equal(h.el("settingsDrawer").modal, true, "showModal로 연 보이는 모달이다");
});

test("the folder step opens only when no folder was chosen, needs a pick before 시작, and writes existing notes into it", async () => {
  const h = await panel({ folder: { state: "none", name: "" } }); // 폴더가 없으면 폴더 단계가 열린다
  await h.el("startBtn").click();
  await h.until(() => h.el("onboard").hidden === false);
  assert.equal(h.el("obDone").disabled, true, "폴더를 고르기 전에는 끝낼 수 없다");
  await h.el("obFolderBtn").click();
  assert.equal(h.picked, 1, "사용자 클릭 안에서 폴더 선택 창을 연다");
  assert.equal(h.el("obFolderName").textContent, "선택한 폴더: Notes");
  assert.equal(h.el("obDone").disabled, false);
  await h.el("obDone").click();
  assert.ok(h.types().includes("LIB_EXPORT_ALL"), "이전에 만든 노트도 새 폴더에 써 둔다");
  assert.equal(h.el("onboard").hidden, true);
});

test("picking a folder that holds a settings backup brings those settings in and says so", async () => {
  const h = await panel({ folder: { state: "none", name: "" } });
  h.backupSettings = { theme: "dark" };
  await h.el("storePassBtn").click();
  assert.equal(h.picked, 1);
  assert.equal(h.el("status").textContent, "보관함 폴더의 설정 백업을 불러왔습니다.");
});

test("a folder whose permission lapsed does not block 시작; the ready card offers 다시 허용 and re-grants without a picker", async () => {
  const h = await panel({ folder: { state: "needs-permission", name: "Summrizei" } });
  assert.equal(h.el("onboard").hidden, true, "권한만 거둬진 폴더는 온보딩을 막지 않는다");
  assert.equal(h.el("storeState").textContent, "보관함 폴더 권한 필요");
  assert.equal(h.el("storePassBtn").textContent, "다시 허용");
  await h.el("storePassBtn").click();
  assert.equal(h.regranted, 1);
  assert.equal(h.picked, 0);
  assert.equal(h.el("storeState").textContent, "보관함 폴더 · Summrizei");
  assert.equal(h.el("storePassBtn").hidden, true);
  assert.ok(h.types().includes("LIB_EXPORT_ALL"));
});

test("the line under the start button follows the recognition route: on-device text locally, service text in cloud mode", async () => {
  const local = await panel();
  assert.equal(local.el("legalLine").textContent, "화면·음성 인식은 기기 안에서 하고, 노트는 로그인한 계정으로 Summrizei 서비스가 만듭니다.");
  const cloud = await panel({ account: fakeAccount("essential") });
  assert.equal(cloud.el("legalLine").textContent, "화면·음성은 Summrizei 서비스에서 인식하고 저장하지 않습니다. 노트도 로그인한 계정으로 서비스가 만듭니다.", "유료 + 클라우드 인식 동의면 서비스 문구로 바뀐다");
});

// ── background.js 의 노트 파일 배선: LIB_EXPORT_ALL·BG_DISCARD·✓ 배지. 서비스 워커를 가짜 chrome 위에서 실행해 확인한다. ──
const PAGE = { id: "ext", url: "chrome-extension://ext/sidepanel.html" }, OPTS = { id: "ext", url: "chrome-extension://ext/options.html" };
function bgWorker({ badge = "", found = [], offscreenReply = { ok: true } } = {}) {
  const handlers = {}, event = name => ({ addListener: fn => { handlers[name] = fn; } });
  const log = { sent: [], downloads: [], queries: [], shown: [], badge: [] };
  const chrome = {
    runtime: { id: "ext", getURL: p => `chrome-extension://ext/${p}`, onInstalled: event("installed"), onStartup: event("startup"), onMessage: event("message"),
      getContexts: async () => [{}], // offscreen 문서가 이미 있다
      sendMessage: async m => { log.sent.push(JSON.parse(JSON.stringify(m))); return m.target === "session" ? offscreenReply : undefined; } },
    sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
    action: { onClicked: event("action"), getBadgeText: async () => badge,
      setBadgeText: async o => { badge = o.text; log.badge.push("text:" + o.text); },
      setBadgeBackgroundColor: async o => log.badge.push("color:" + o.color) },
    commands: { onCommand: event("command") },
    tabs: { onRemoved: event("removed"), onUpdated: event("updated"), get: async () => { throw new Error("no tab"); }, sendMessage: async () => {} },
    storage: { local: { setAccessLevel: async () => {}, get: async () => ({}), set: async () => {}, remove: async () => {} }, sync: { remove: async () => {} } },
    power: { requestKeepAwake() {}, releaseKeepAwake() {} },
    declarativeNetRequest: { getSessionRules: async () => [], updateSessionRules: async () => {} },
    downloads: {
      download: async o => { log.downloads.push(o); return 42; },
      search: async q => { log.queries.push(q); return found; },
      show: async id => log.shown.push("show:" + id),
      showDefaultFolder: async () => log.shown.push("default"),
    },
  };
  const context = vm.createContext({ chrome, console, URL, URLSearchParams, TextEncoder, AbortSignal, btoa, crypto: globalThis.crypto, fetch: async () => { throw new Error("no network expected"); }, setTimeout });
  context.importScripts = (...files) => files.forEach(f => vm.runInContext(fs.readFileSync(f, "utf8"), context, { filename: f }));
  vm.runInContext(fs.readFileSync("background.js", "utf8"), context, { filename: "background.js" });
  const ask = (message, sender) => new Promise(resolve => {
    const async = handlers.message(message, sender, resolve);
    if (async !== true) setImmediate(() => resolve(undefined));
  }).then(r => r === undefined ? undefined : JSON.parse(JSON.stringify(r)));
  return { ask, log };
}

test("note files are no longer routed through background downloads: LIB_EXPORT and LIB_SHOW are gone", async () => {
  const b = bgWorker();
  for (const type of ["LIB_EXPORT", "LIB_SHOW"])
    for (const sender of [PAGE, OFFSCREEN]) assert.notEqual((await b.ask({ target: "background", type, packageId: "Lp1-abc123", fileName: "x-Lp1-abc123.summrizei", text: '{"format":"summrizei-note"}' }, sender))?.downloadId, 42, type);
  assert.equal(b.log.downloads.length, 0);
});

test("LIB_FILES answers only this extension's bridge on the site's /library tab and forwards list/read to offscreen", async () => {
  const b = bgWorker({ offscreenReply: { ok: true, folder: "Summrizei", names: ["a-p1.summrizei"] } });
  const tab = { id: 3 }, site = { id: "ext", tab, url: "https://summrizei.vercel.app/library" };
  assert.deepEqual(await b.ask({ target: "background", type: "LIB_FILES", op: "list" }, site), { ok: true, folder: "Summrizei", names: ["a-p1.summrizei"] });
  assert.deepEqual(b.log.sent.at(-1), { target: "session", type: "LIB_FILES", op: "list" });
  assert.equal((await b.ask({ target: "background", type: "LIB_FILES", op: "read", name: "a-p1.summrizei" }, { ...site, url: "http://localhost:8911/library.html" })).ok, true);
  assert.equal(b.log.sent.at(-1).name, "a-p1.summrizei");
  for (const sender of [
    { id: "ext", tab, url: "https://summrizei.vercel.app/account" }, { id: "ext", tab, url: "https://evil.example/library" },
    { id: "other", tab, url: "https://summrizei.vercel.app/library" }, { id: "ext", url: "https://summrizei.vercel.app/library" }, PAGE, OFFSCREEN,
  ]) assert.deepEqual(await b.ask({ target: "background", type: "LIB_FILES", op: "list" }, sender), { ok: false, error: "허용되지 않은 요청입니다." }, JSON.stringify(sender));
  assert.deepEqual(await b.ask({ target: "background", type: "LIB_FILES", op: "write" }, site), { ok: false, code: "bad-request" });
});

test("BG_DONE forwards saved to the panel and raises a ✓ badge, unless a live capture keeps ON", async () => {
  const b = bgWorker();
  await b.ask({ target: "background", type: "BG_DONE", jobId: "job-12345678", status: "complete", saved: "file" }, OFFSCREEN);
  assert.equal(b.log.sent.find(m => m.type === "BG_DONE").saved, "file");
  await flush(); // 배지는 응답과 따로 도는 비동기 작업이다
  assert.deepEqual(b.log.badge, ["text:✓", "color:#2f7d4f"]);
  // 허용 목록 밖의 saved는 null로 보내고, 실패 결말은 배지를 바꾸지 않는다
  await b.ask({ target: "background", type: "BG_DONE", jobId: "job-12345678", status: "failed", saved: "everything" }, OFFSCREEN);
  assert.equal(b.log.sent.filter(m => m.type === "BG_DONE").at(-1).saved, null);
  await flush();
  assert.deepEqual(b.log.badge, ["text:✓", "color:#2f7d4f"]);
  // 실시간 캡처("ON")가 도는 동안에는 ✓로 덮지 않는다
  const live = bgWorker({ badge: "ON" });
  await live.ask({ target: "background", type: "BG_DONE", jobId: "job-12345678", status: "paused", saved: "no-folder" }, OFFSCREEN);
  assert.equal(live.log.sent.find(m => m.type === "BG_DONE").saved, "no-folder");
  await flush();
  assert.deepEqual(live.log.badge, []);
});

test("PANEL_OPENED from our pages clears the ✓ badge only", async () => {
  const done = bgWorker({ badge: "✓" });
  assert.deepEqual(await done.ask({ target: "background", type: "PANEL_OPENED" }, PAGE), { ok: true });
  assert.deepEqual(done.log.badge, ["text:"]);
  const live = bgWorker({ badge: "ON" });
  assert.deepEqual(await live.ask({ target: "background", type: "PANEL_OPENED" }, OPTS), { ok: true });
  assert.deepEqual(live.log.badge, [], "실시간 캡처 표시는 지우지 않는다");
  // offscreen·웹 페이지는 배지를 건드리지 못한다
  for (const sender of [OFFSCREEN, { id: "ext", url: "https://evil.example/", tab: { id: 1 } }])
    assert.equal((await live.ask({ target: "background", type: "PANEL_OPENED" }, sender)).ok, false);
});

test("LIB_EXPORT_ALL and a valid BG_DISCARD ride the offscreen forward", async () => {
  const b = bgWorker({ offscreenReply: { ok: true, n: 3 } });
  assert.deepEqual(await b.ask({ target: "background", type: "LIB_EXPORT_ALL" }, PAGE), { ok: true, n: 3 });
  assert.deepEqual(b.log.sent.at(-1), { target: "session", type: "LIB_EXPORT_ALL" });
  await b.ask({ target: "background", type: "BG_DISCARD", jobId: "job-12345678" }, PAGE);
  assert.deepEqual(b.log.sent.at(-1), { target: "session", type: "BG_DISCARD", jobId: "job-12345678" });
  for (const jobId of ["x", "-abcdefgh", "has space", "a".repeat(65), undefined])
    assert.equal((await b.ask({ target: "background", type: "BG_DISCARD", jobId }, PAGE)).ok, false, String(jobId));
  assert.equal((await b.ask({ target: "background", type: "LIB_EXPORT_ALL" }, OFFSCREEN)).ok, false);
  assert.equal((await b.ask({ target: "background", type: "BG_DISCARD", jobId: "job-12345678" }, OFFSCREEN)).ok, false);
});

test("DIAG_EVENT rides the offscreen forward from our pages only", async () => {
  const b = bgWorker({ offscreenReply: { ok: true } });
  const event = { stage: "login", code: "LOGIN_TIMING", ms: 42, msg: "auth_window" };
  assert.deepEqual(await b.ask({ target: "background", type: "DIAG_EVENT", event }, PAGE), { ok: true });
  assert.deepEqual(b.log.sent.at(-1), { target: "session", type: "DIAG_EVENT", event });
  assert.deepEqual(await b.ask({ target: "background", type: "DIAG_EVENT", event }, OPTS), { ok: true });
  for (const sender of [OFFSCREEN, { id: "ext", url: "https://evil.example/", tab: { id: 1 } }, { id: "other", url: PAGE.url }])
    assert.equal((await b.ask({ target: "background", type: "DIAG_EVENT", event }, sender)).ok, false, JSON.stringify(sender));
});
