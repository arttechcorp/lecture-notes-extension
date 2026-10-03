// 사이드패널의 "백그라운드로 처리": 유료 계정에게만 보이고, 동의가 없으면 시작하지 않으며, 보호·미지원·실패에서는 사용자가 "실시간 모드로 시작"을 눌러야만 실시간 캡처가 시작된다.
// sidepanel.js 전체를 가짜 DOM·chrome 위에서 실행해 확인한다.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const { TERMS_VERSION } = require("./settings.js");

const BG_SENDER = { id: "ext", url: "chrome-extension://ext/background.js" }, OFFSCREEN = { id: "ext", url: "chrome-extension://ext/offscreen.html" };
const CONSENTS = { consentAccepted: true, serviceUrl: "https://service.example", appSessionToken: "static-dev-token-static-dev-token-1", backgroundConsent: { personalUse: true, accessRights: true, version: TERMS_VERSION, at: 1 }, visionConsent: true, visionConsentVersion: TERMS_VERSION, visionConsentAt: 1, remoteSummaryConsent: true };
const TAB = { id: 7, url: "https://lms.example.com/watch?id=7", title: "강의" };

const HTML = fs.readFileSync("sidepanel.html", "utf8"), HIDDEN = new Set([...HTML.matchAll(/<[^>]*\bid="([^"]+)"[^>]*\shidden[\s>][^>]*>/g)].map(m => m[1]));
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
function element(id) {
  const listeners = {}, e = {
    hidden: HIDDEN.has(id), disabled: false, textContent: "", value: "", checked: false, className: "", style: {}, dataset: {}, children: [], selectedOptions: [], classList: { add() {}, remove() {}, toggle() {} },
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn), removeEventListener() {},
    click: async () => { for (const fn of listeners.click || []) fn({ preventDefault() {} }); await flush(); }, // 사용자의 클릭은 핸들러가 끝나길 기다리지 않는다
    append: (...c) => e.children.push(...c), focus() {}, showModal() {}, close() {}, setAttribute() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }),
  };
  return e;
}

async function panel({ store = CONSENTS, tabs = [TAB], list = { ok: true, background: true, jobs: [] }, run = { ok: true }, permission = true } = {}) {
  const h = { sent: [], calls: [], elements: {}, timers: [], listeners: [], webRequest: [], store: { ...store } };
  const el = id => (h.elements[id] ??= element(id));
  const reply = m => ({ GET_STATE: { ok: true, state: null }, BG_LIST: list, BG_RUN: run, BG_CANCEL: { ok: true }, START_SESSION: { ok: true, state: null } })[m.type] ?? { ok: true };
  const chrome = {
    runtime: { id: "ext", getURL: p => `chrome-extension://ext/${p}`, lastError: undefined, openOptionsPage: () => h.calls.push("openOptionsPage"), onMessage: { addListener: fn => h.listeners.push(fn) },
      sendMessage: (m, cb) => { h.sent.push(JSON.parse(JSON.stringify(m))); Promise.resolve().then(() => cb(reply(m))); } },
    storage: { local: { get: async () => ({ ...h.store }), set: async () => {}, remove: async () => {} }, sync: { remove: async () => {} } },
    tabs: { query: async q => (q.active ? [tabs[0]] : tabs) },
    permissions: { request: async p => { h.calls.push("permissions.request:" + p.permissions.join()); return typeof permission === "function" ? permission() : permission; } },
    webRequest: { onResponseStarted: { addListener: (fn, filter, extra) => { h.calls.push("webRequest.add"); h.webRequest.push({ fn, filter, extra }); }, removeListener: fn => { h.calls.push("webRequest.remove"); h.webRequest = h.webRequest.filter(w => w.fn !== fn); } } },
    windows: { create() {} },
  };
  const context = vm.createContext({ chrome, console, URL, URLSearchParams, Promise, JSON, Object, Array, Math, Date, String, Number, Map, Set, crypto,
    document: { getElementById: el, createElement: () => element(), documentElement: { dataset: {} }, addEventListener() {} }, window: { addEventListener() {} }, location: { search: "" },
    setTimeout: (fn, ms) => { const t = { fn, ms }; h.timers.push(t); return t; }, clearTimeout: t => { h.timers = h.timers.filter(x => x !== t); } });
  for (const file of ["lib/settings.js", "lib/media-source.js", "sidepanel.js"]) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
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

test("missing consents link to settings and start nothing: no permission prompt, no BG_RUN", async () => {
  for (const store of [{ ...CONSENTS, backgroundConsent: { personalUse: true, accessRights: false, version: TERMS_VERSION, at: 1 } }, { ...CONSENTS, visionConsent: false }, { ...CONSENTS, backgroundConsent: { personalUse: true, accessRights: true, version: "1999-01-01", at: 1 } }, { ...CONSENTS, remoteSummaryConsent: false }]) {
    const h = await panel({ store });
    await h.el("bgBtn").click();
    assert.match(h.status(), /동의/);
    assert.equal(h.visible("bgOptionsLink"), true);
    assert.deepEqual(h.calls.filter(c => c.startsWith("permissions")), []);
    assert.ok(!h.types().includes("BG_RUN"));
    await h.el("bgOptionsLink").click();
    assert.ok(h.calls.includes("openOptionsPage"));
  }
  // 옵션 페이지에서 방금 동의했다면(패널이 열려 있는 동안) 저장소를 다시 읽어 진행한다
  const stale = await panel({ store: { ...CONSENTS, visionConsent: false } });
  stale.store.visionConsent = true; stale.store.visionConsentVersion = TERMS_VERSION;
  await stale.el("bgBtn").click();
  assert.ok(stale.calls.includes("permissions.request:webRequest"));
});

test("YouTube is live-mode only: nothing starts, nothing is requested", async () => {
  for (const url of ["https://www.youtube.com/watch?v=abc", "https://youtu.be/abc", "https://www.youtube-nocookie.com/embed/abc"]) {
    const h = await panel({ tabs: [{ id: 7, url, title: "yt" }] });
    await h.el("bgBtn").click();
    assert.match(h.status(), /실시간 모드만 지원/, url);
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
  assert.match(run.jobId, /^[0-9a-f-]{36}$/);
  assert.equal(h.visible("bgCancelBtn"), true);
  // MIME 으로 알려진 재생목록도 찾는다
  const mime = await panel();
  await mime.el("bgBtn").click();
  mime.hls("https://cdn.example.com/playlist", 7, { type: "xmlhttprequest", responseHeaders: [{ name: "Content-Type", value: "application/vnd.apple.mpegurl; charset=utf-8" }] });
  await mime.until(() => mime.types().includes("BG_RUN"));
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

test("progress shows stage names and counts only, and only for this job from offscreen", async () => {
  const h = await panel();
  await h.el("bgBtn").click(); h.hls("https://cdn.example.com/a.m3u8");
  await h.until(() => h.types().includes("BG_RUN"));
  const jobId = h.sent.find(m => m.type === "BG_RUN").jobId;
  h.tell({ type: "BG_PROGRESS", jobId, state: "ingesting", counts: { recv: 12, decode: 11, vision: 3, stt: 2, "weird-stage": 9 } }, OFFSCREEN);
  assert.equal(h.status(), "처리 중 · 수신·인식");
  assert.equal(h.el("bgProgress").textContent, "수신 12 · 해석 11 · 화면 3 · 음성 2");
  assert.equal(h.visible("bgCancelBtn"), true);
  h.tell({ type: "BG_PROGRESS", jobId: "other", state: "writing", counts: { write: 1 } }, OFFSCREEN);
  h.tell({ type: "BG_PROGRESS", jobId, state: "writing", counts: { write: 99 } }, { id: "ext", url: "https://evil.example/" });
  h.tell({ type: "BG_PROGRESS", jobId, state: "writing", counts: { write: 99 } }, { id: "other", url: OFFSCREEN.url });
  h.tell({ type: "BG_PROGRESS", jobId, state: "writing", counts: { write: 99 } }, { id: "ext", url: "chrome-extension://ext/sidepanel.html" });
  assert.equal(h.status(), "처리 중 · 수신·인식", "다른 작업·다른 송신자의 진행은 무시한다");
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
  // 동의 때문에 멈췄다면 설정으로 안내한다
  h.tell({ type: "BG_DONE", jobId: first.jobId, status: "paused", code: "CONSENT_SUMMARY_REQUIRED", reason: "user", message: "요약을 만들려면 동의해야 합니다." });
  assert.equal(h.visible("bgOptionsLink"), true);
  assert.equal(h.visible("bgRetryBtn"), true);
  assert.ok(!h.types().includes("START_SESSION"));
});

test("a finished job says 노트 준비됨 with notice counts and that the v2 note view is not available yet", async () => {
  const h = await panel();
  await h.el("bgBtn").click(); h.hls("https://cdn.example.com/a.m3u8");
  await h.until(() => h.types().includes("BG_RUN"));
  const jobId = h.sent.find(m => m.type === "BG_RUN").jobId;
  h.tell({ type: "BG_DONE", jobId, status: "complete", code: null, stats: { slides: 12, chunks: 8, gaps: 1 }, notices: [{ code: "NOTE_CAPTURE_GAP", count: 2 }, { code: "NOTE_GLOBAL_FAILED", count: null }] });
  const text = h.status();
  assert.match(text, /노트 준비됨/);
  assert.match(text, /슬라이드 12/);
  assert.match(text, /인식하지 못한 구간 2곳/);
  assert.match(text, /강의 전체 요약을 만들지 못했습니다/);
  assert.ok(!text.includes("NOTE_"), "날 코드는 보이지 않는다");
  assert.match(text, /v2 노트 보기는 노트 양식이 정해진 뒤에 제공됩니다/);
  assert.deepEqual(["bgRetryBtn", "bgCancelBtn", "bgLiveBtn"].map(id => h.visible(id)), [false, false, false]);
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
  h.tell({ type: "BG_DONE", jobId, status: "paused", code: "SRC_AUTH_EXPIRED", message: "로그인 세션이 만료됐습니다." });
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
  running.tell({ type: "BG_PROGRESS", jobId: "job-running1", state: "vision", counts: { recv: 3 } }, OFFSCREEN);
  assert.equal(running.el("bgProgress").textContent, "수신 3");
  const paused = await panel({ list: { ok: true, background: true, jobs: [{ jobId: "job-paused01", state: "paused", code: "QUOTA_EXCEEDED", running: false }] } });
  assert.match(paused.status(), /이어서 처리할 작업/);
  assert.equal(paused.visible("bgRetryBtn"), true);
  assert.ok(!paused.types().includes("BG_RUN"), "열자마자 시작하지 않는다");
  await paused.el("bgRetryBtn").click();
  paused.hls("https://cdn.example.com/a.m3u8");
  await paused.until(() => paused.types().includes("BG_RUN"));
  assert.equal(paused.sent.find(m => m.type === "BG_RUN").jobId, "job-paused01");
  assert.ok(!paused.types().includes("START_SESSION"));
});

test("the panel stays a thin adapter: no service client, no media fetching, no raw URLs in messages other than BG_RUN's playlist", () => {
  const html = fs.readFileSync("sidepanel.html", "utf8"), js = fs.readFileSync("sidepanel.js", "utf8");
  assert.doesNotMatch(html, /lib\/(service-client|pipeline|background-job|media-demux|media-decode)\.js/);
  assert.doesNotMatch(js, /\bfetch\(|XMLHttpRequest|ServiceClient/);
  assert.match(html, /lib\/media-source\.js/);
  for (const id of ["bgBox", "bgBtn", "bgStatus", "bgProgress", "bgRetryBtn", "bgCancelBtn", "bgLiveBtn", "bgOptionsLink"]) assert.match(html, new RegExp(`id="${id}"`), id);
});
