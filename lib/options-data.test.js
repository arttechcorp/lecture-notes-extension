// options.html 데이터 관리 카드: 로컬 삭제, 진단 파일 내보내기, 계정 삭제의 순서와 실패 처리.
// options.js 를 실제 settings.js·auth.js·diagnostics.js 와 같은 컨텍스트에 올리고, DOM·chrome·서비스 호출만 가짜로 둔다.
// 저장소를 실제로 지우는 쪽(offscreen)은 lib/offscreen-boundary.test.js 가 실제 PackageStore 로 확인한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { resolveObjectURL } = require("node:buffer");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const SESSION = { accessToken: JWT, refreshToken: "refresh-token_1", expiresAt: Date.now() + 3600e3, userId: "0b9c1c52-6f0e-4f5e-9a39-2a1d3f1d9c11", email: "student@example.com" };
const BUSY = "캡처나 백그라운드 작업이 진행 중입니다. 끝난 뒤 다시 시도하세요.";
const LOCAL_ONLY = { theme: "dark", serviceUrl: "https://service.example", backgroundConsent: { personalUse: true, accessRights: true, version: "2026-10-02", at: 5 }, visionConsent: true, visionConsentVersion: "2026-10-02", visionConsentAt: 7 };
const EVENTS = [
  { ts: 1700000000000, jobId: "job-01", traceId: "tr-01", spanId: "sp-01", stage: "stt", status: "running", level: "info" },
  { ts: 1700000002400, jobId: "job-01", traceId: "tr-01", spanId: "sp-02", parentSpanId: "sp-01", stage: "stt", unit: "u-7", status: "failed", ms: 1100, bytes: 2048, model: "whisper-large-v3-turbo", costUsd: 0.011, code: "STT_RATE_LIMIT", level: "error", msg: "재시도 초과" },
];

async function optionsHarness({ signedIn = true, serviceUrl = "https://service.example", events = EVENTS, local = () => ({ ok: true }), deleteAccount = async () => ({ deleted: true }), extra = {}, globals = "" } = {}) {
  const h = { order: [], sent: [], downloads: [], timers: [], confirms: [], answer: true, els: {}, data: { ...LOCAL_ONLY, serviceUrl, ...extra, ...(signedIn ? { authSession: { ...SESSION } } : {}) }, local, deleteAccount };
  const el = id => h.els[id] ??= { id, hidden: false, disabled: false, textContent: "", value: "", checked: false, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
  const stored = h.data;
  const context = vm.createContext({
    URL, Blob, AbortSignal, TextEncoder, TextDecoder, crypto, btoa, atob, console,
    document: { getElementById: el, createElement: () => ({ click() { h.downloads.push({ href: this.href, download: this.download }); } }) },
    confirm: message => { h.confirms.push(message); return h.answer; },
    setTimeout: (fn, ms) => { h.timers.push({ fn, ms }); return 0; },
    // 서버 로그아웃(최선 노력)이 부르는 유일한 fetch. 순서 기록에만 쓴다.
    fetch: async url => { if (String(url).includes("/logout")) h.order.push("signOut"); return { ok: true }; },
    chrome: {
      storage: { local: { get: async keys => Object.fromEntries([].concat(keys).filter(k => k in stored).map(k => [k, stored[k]])), set: async obj => { Object.assign(stored, obj); }, remove: async keys => { for (const k of [].concat(keys)) delete stored[k]; } }, sync: { remove: async () => {} } },
      runtime: { sendMessage: async message => {
        h.sent.push(JSON.parse(JSON.stringify(message))); // 컨텍스트 밖으로 꺼내 비교할 수 있게 복사한다
        h.order.push(message.type + (message.dryRun ? ":dry" : ""));
        return message.type === "LOGS_READ" ? { ok: true, events } : h.local(message);
      } },
    },
    ServiceClient: { me: async () => ({ features: [] }), deleteAccount: async o => { h.order.push("deleteAccount"); h.deleteArgs = JSON.parse(JSON.stringify(o)); return h.deleteAccount(o); } },
  });
  h.context = context;
  h.el = el;
  for (const file of ["lib/settings.js", "lib/auth.js", "lib/account.js", "lib/diagnostics.js"]) vm.runInContext(read(file), context, { filename: file });
  if (globals) vm.runInContext(globals, context, { filename: "test-globals.js" });
  vm.runInContext(read("options.js"), context, { filename: "options.js" });
  for (let i = 0; i < 200 && !el("authState").textContent; i++) await new Promise(r => setImmediate(r)); // 초기화(설정 읽기·로그인 표시·플랜 확인)가 끝날 때까지
  assert.ok(el("authState").textContent, "options.js 초기화가 끝나지 않았다");
  h.click = id => el(id).listeners.click();
  h.notice = () => el("saved").textContent;
  h.user = () => vm.runInContext("Auth.user()", context);
  h.fresh = () => { h.order.length = 0; h.sent.length = 0; h.confirms.length = 0; h.downloads.length = 0; };
  return h;
}

test("options.html has the 데이터 관리 and 보관함 PIN cards, loads the storage libs before options.js, and drops the v1 copy", () => {
  const html = read("options.html"), at = name => html.indexOf(`src="${name}"`);
  for (const id of ["wipeBtn", "diagExportBtn", "diagClearBtn", "diagState", "accountDeleteBox", "accountDeleteBtn"]) assert.match(html, new RegExp(`id="${id}"`));
  for (const id of ["keyForm", "keyPass1", "keySaveBtn", "keyState", "summaryConsentState", "visionConsentState", "bgState", "summaryWithdrawBtn", "visionWithdrawBtn", "bgWithdrawBtn"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.ok(!html.includes('id="keyPass2"'), "PIN은 확인 없이 한 번만 입력한다");
  assert.match(html, /<input id="keyPass1"[^>]*inputmode="numeric"[^>]*pattern="\[0-9\]\{4\}"[^>]*maxlength="4"[^>]*autocomplete="off"/, "PIN 입력은 숫자 4자리");
  assert.match(html, /<div id="accountDeleteBox" hidden>/, "로그인 전에는 계정 삭제가 보이지 않는다");
  assert.ok(at("lib/auth.js") > -1 && at("lib/auth.js") < at("lib/account.js") && at("lib/account.js") < at("options.js"), "account.js 는 auth.js 뒤, options.js 앞");
  assert.ok(at("lib/diagnostics.js") > -1 && at("lib/diagnostics.js") < at("options.js"), "diagnostics.js 는 options.js 앞");
  assert.ok(at("lib/package-store.js") > -1 && at("lib/package-store.js") < at("options.js"), "package-store.js 는 options.js 앞");
  assert.ok(at("lib/note-file.js") > -1 && at("lib/note-file.js") < at("options.js"), "note-file.js 는 options.js 앞");
  assert.match(html, /<h2 id="dataHeading">데이터 관리<\/h2>/);
  assert.match(html, /보관함 PIN/);
  assert.match(html, /summrizei\.vercel\.app\/library/);
  for (const stale of ["Tesseract", "ZERO CLOUD", "API 키"]) assert.ok(!html.includes(stale), `v1 잔재 ${stale}`);
  for (const removed of ["remoteSummaryConsent", "bgPersonalCb", "bgAccessCb", "visionWarn", "visionCb", "visionState"]) assert.ok(!html.includes(`id="${removed}"`), `동의를 받던 요소 ${removed} 는 없어야 한다`);
  const code = read("options.js").split("\n").filter(line => !line.trimStart().startsWith("//")).join("\n");
  assert.equal(/chrome\.downloads/.test(code), false, "진단 파일은 Blob 링크로 내려받는다(downloads 권한은 노트 파일 저장용으로 background만 쓴다)");
  assert.match(read("lib/settings.js"), /TERMS_VERSION='2026-10-03'/, "동의 문구 버전은 그대로");
});

test("the export button is enabled at load - the log holds no lecture content, so no operator key is needed", async () => {
  const h = await optionsHarness();
  assert.equal(h.el("diagExportBtn").disabled, false);
  assert.equal(h.el("diagState").textContent, "");
  assert.equal(h.el("diagClearBtn").disabled, false);
  assert.equal(h.el("wipeBtn").disabled, false);
  assert.equal(h.sent.length, 0, "열기만 해서는 offscreen 에 아무것도 묻지 않는다");
});

test("the export downloads a plaintext JSON bundle with v:2 and the LOGS_READ events", async () => {
  const h = await optionsHarness();
  await h.click("diagExportBtn");

  assert.deepEqual(h.sent.map(m => [m.target, m.type]), [["background", "LOGS_READ"]], "로그는 background 를 거쳐 offscreen 에서 읽는다");
  assert.equal(h.downloads.length, 1);
  const [{ href, download }] = h.downloads;
  assert.match(download, /^summrizei-diagnostic-\d{4}-\d{2}-\d{2}\.json$/);
  const bundle = JSON.parse(await resolveObjectURL(href).text());
  assert.equal(bundle.v, 2);
  assert.equal(bundle.version, null, "가짜 chrome.runtime 에는 getManifest 가 없다");
  assert.deepEqual(bundle.events, EVENTS, "로그가 평문으로 담긴다 - 허용 필드뿐이라 암호화하지 않는다");
  const allowed = new Set(h.context.Diagnostics.EVENT_FIELDS);
  for (const e of bundle.events) for (const key of Object.keys(e)) assert.ok(allowed.has(key), `허용 목록 밖의 필드 ${key}`);

  assert.match(h.notice(), /진단 파일을 내려받았습니다/);
  assert.equal(h.el("diagExportBtn").disabled, false);
  assert.equal(h.timers.length, 1);
  h.timers[0].fn();
  assert.equal(resolveObjectURL(href), undefined, "Blob 주소는 곧 풀어 준다");
});

test("an event with a field outside the allowlist, or no events at all, downloads nothing", async () => {
  const leaky = await optionsHarness({ events: [...EVENTS, { ts: 1, stage: "stt", level: "info", text: "강의 전사 한 줄" }] });
  await leaky.click("diagExportBtn");
  assert.equal(leaky.downloads.length, 0);
  assert.match(leaky.notice(), /허용되지 않은 필드/);
  assert.equal(leaky.timers.length, 0);

  const empty = await optionsHarness({ events: [] });
  await empty.click("diagExportBtn");
  assert.equal(empty.downloads.length, 0);
  assert.equal(empty.notice(), "내보낼 진단 로그가 없습니다.");
});

test("the wipe button asks first, sends one WIPE_LOCAL, and leaves settings, consents and the login alone; log deletion sends LOGS_CLEAR only", async () => {
  const h = await optionsHarness();
  const before = JSON.stringify(h.data);
  h.answer = false;
  await h.click("wipeBtn");
  assert.equal(h.confirms.length, 1);
  assert.match(h.confirms[0], /되돌릴 수 없습니다/);
  assert.match(h.confirms[0], /설정·동의·로그인은 지우지 않습니다/);
  assert.deepEqual(h.sent, [], "취소하면 아무것도 보내지 않는다");

  h.answer = true;
  await h.click("wipeBtn");
  assert.deepEqual(h.sent, [{ target: "background", type: "WIPE_LOCAL" }]);
  assert.match(h.notice(), /모두 삭제했습니다/);
  assert.equal(JSON.stringify(h.data), before, "chrome.storage(설정·동의·로그인)는 그대로");
  assert.equal((await h.user()).email, "student@example.com");
  assert.equal(h.el("wipeBtn").disabled, false);

  h.fresh();
  await h.click("diagClearBtn");
  assert.equal(h.confirms.length, 0);
  assert.deepEqual(h.sent, [{ target: "background", type: "LOGS_CLEAR" }]);
  assert.equal(h.notice(), "진단 로그를 삭제했습니다.");
  assert.equal(JSON.stringify(h.data), before);
});

test("a refusal from offscreen (capture or job running) is shown as is and the button works again", async () => {
  const h = await optionsHarness({ local: () => ({ ok: false, error: BUSY }) });
  await h.click("wipeBtn");
  assert.equal(h.notice(), BUSY);
  assert.equal(h.el("wipeBtn").disabled, false);
  await h.click("diagClearBtn");
  assert.equal(h.el("diagClearBtn").disabled, false);
});

test("the account deletion button shows only while signed in", async () => {
  assert.equal((await optionsHarness({ signedIn: true })).el("accountDeleteBox").hidden, false);
  assert.equal((await optionsHarness({ signedIn: false })).el("accountDeleteBox").hidden, true);
});

test("account deletion goes server first, then the local wipe, then sign-out, and ends signed out", async () => {
  const h = await optionsHarness();
  const settingsBefore = { ...h.data };
  delete settingsBefore.authSession;
  h.fresh();
  await h.click("accountDeleteBtn");

  assert.equal(h.confirms.length, 1);
  assert.match(h.confirms[0], /영구 삭제/);
  assert.match(h.confirms[0], /되돌릴 수 없습니다/);
  assert.deepEqual(h.order, ["WIPE_LOCAL:dry", "deleteAccount", "WIPE_LOCAL", "signOut"], "지울 수 있는지 확인 -> 서버 -> 이 기기 -> 로그아웃");
  assert.deepEqual(h.deleteArgs, { baseUrl: "https://service.example", token: JWT }, "로그인 토큰으로만 부른다");
  assert.equal(await h.user(), null);
  assert.ok(!("authSession" in h.data), "로그인 세션이 지워졌다");
  for (const [key, value] of Object.entries(settingsBefore)) assert.deepEqual(h.data[key], value, `${key} 는 그대로`);
  assert.equal(h.el("accountDeleteBox").hidden, true);
  assert.equal(h.el("authState").textContent, "로그인하지 않았습니다.");
  assert.match(h.notice(), /계정과 서버 데이터를 삭제했습니다/);
});

test("a cancelled confirm does nothing at all", async () => {
  const h = await optionsHarness();
  h.answer = false;
  h.fresh();
  await h.click("accountDeleteBtn");
  assert.equal(h.confirms.length, 1);
  assert.deepEqual(h.order, []);
});

test("a server failure leaves the local data and the login intact and can be retried", async () => {
  for (const failure of [async () => { throw new Error("서비스 요청을 완료하지 못했습니다 (500)."); }, async () => ({ deleted: false }), async () => ({}), async () => null]) {
    const h = await optionsHarness({ deleteAccount: failure });
    h.fresh();
    await h.click("accountDeleteBtn");
    assert.deepEqual(h.order, ["WIPE_LOCAL:dry", "deleteAccount"], "서버 뒤의 단계는 하나도 실행하지 않는다");
    assert.deepEqual(h.data.authSession, SESSION, "로그인 세션 그대로");
    assert.equal((await h.user()).email, "student@example.com");
    assert.equal(h.el("accountDeleteBox").hidden, false);
    assert.equal(h.el("accountDeleteBtn").disabled, false);
    assert.match(h.notice(), /서비스 요청을 완료하지 못했습니다|삭제를 확인하지 않았습니다/);
    assert.doesNotMatch(h.notice(), /삭제했습니다/);

    h.deleteAccount = async () => ({ deleted: true });
    h.fresh();
    await h.click("accountDeleteBtn");
    assert.deepEqual(h.order, ["WIPE_LOCAL:dry", "deleteAccount", "WIPE_LOCAL", "signOut"], "다시 누르면 끝까지 간다");
  }
});

test("while a capture or job runs the server is never touched", async () => {
  const h = await optionsHarness({ local: () => ({ ok: false, error: BUSY }) });
  h.fresh();
  await h.click("accountDeleteBtn");
  assert.deepEqual(h.order, ["WIPE_LOCAL:dry"], "되돌릴 수 없는 서버 삭제는 이 기기를 지울 수 있을 때만");
  assert.equal(h.notice(), BUSY);
  assert.deepEqual(h.data.authSession, SESSION);
});

test("if the local wipe fails after the server deleted the account, the user is signed out and told what is left", async () => {
  const h = await optionsHarness({ local: m => m.dryRun ? { ok: true } : { ok: false, error: BUSY } });
  h.fresh();
  await h.click("accountDeleteBtn");
  assert.deepEqual(h.order, ["WIPE_LOCAL:dry", "deleteAccount", "WIPE_LOCAL", "signOut"]);
  assert.equal(await h.user(), null, "없는 계정의 로그인 상태를 남기지 않는다");
  assert.match(h.notice(), /계정은 삭제했지만 이 기기의 데이터는 지우지 못했습니다/);
  assert.ok(h.notice().includes(BUSY));
  assert.equal(h.el("accountDeleteBox").hidden, true);
  assert.equal(h.el("wipeBtn").disabled, false, "남은 로컬 데이터는 첫 버튼으로 다시 지울 수 있다");
});

test("without a login there is nothing to delete and nothing is sent (an empty service address means the default service)", async () => {
  const h = await optionsHarness({ serviceUrl: "", signedIn: false });
  h.fresh();
  await h.click("accountDeleteBtn");
  assert.deepEqual(h.order, []);
  assert.equal(h.notice(), "서비스 연결을 먼저 설정하세요.");
});

// 동의는 사이드 패널이 받는다. 설정 페이지는 기록을 보여 주고 철회만 한다.
test("the consent rows show the stored records and 철회 clears them after a confirm", async () => {
  const V = "2026-10-03"; // TERMS_VERSION과 같아야 '동의함'으로 본다
  const h = await optionsHarness({ extra: {
    remoteSummaryConsent: true, summaryConsentVersion: V, summaryConsentAt: 1759536000000,
    visionConsent: true, visionConsentVersion: V, visionConsentAt: 1759536000000,
    backgroundConsent: { personalUse: true, accessRights: true, version: V, at: 1759536000000 },
  } });

  for (const id of ["summaryConsentState", "visionConsentState", "bgState"]) assert.match(h.el(id).textContent, /^동의함/);
  assert.match(h.el("visionConsentState").textContent, /^동의함 · \d{4}-\d{2}-\d{2}$/);
  for (const id of ["summaryWithdrawBtn", "visionWithdrawBtn", "bgWithdrawBtn"]) assert.equal(h.el(id).hidden, false);

  // 취소하면 아무것도 바뀌지 않는다
  h.answer = false;
  h.fresh();
  await h.click("summaryWithdrawBtn");
  assert.equal(h.confirms.length, 1);
  assert.equal(h.data.remoteSummaryConsent, true);

  h.answer = true;
  h.fresh();
  await h.click("summaryWithdrawBtn");
  assert.match(h.confirms[0], /요약 서비스로 전송되지 않아/);
  assert.equal(h.data.remoteSummaryConsent, false);
  assert.match(h.el("summaryConsentState").textContent, /^동의하지 않음 — 사이드 패널/);
  assert.equal(h.el("summaryWithdrawBtn").hidden, true);
  assert.match(h.notice(), /동의를 철회했습니다/);

  await h.click("visionWithdrawBtn");
  assert.match(h.confirms.at(-1), /고화질 화면 인식이 꺼지고/);
  assert.equal(h.data.visionConsent, false);
  assert.equal(h.data.ocrEngine, "ppocr-v5-wasm");
  assert.match(h.el("visionConsentState").textContent, /^동의하지 않음/);
  assert.equal(h.el("serverRecog").hidden, true, "계정을 못 읽으면 온디바이스 카드 그대로");

  await h.click("bgWithdrawBtn");
  assert.match(h.confirms.at(-1), /백그라운드 처리를 쓸 수 없습니다/);
  assert.deepEqual({ ...h.data.backgroundConsent }, { personalUse: false, accessRights: false, version: "", at: 0 });
  assert.match(h.el("bgState").textContent, /^동의하지 않음/);
});

test("with no stored consents every row says it is granted on first use in the side panel", async () => {
  const h = await optionsHarness(); // LOCAL_ONLY 의 동의 버전은 TERMS_VERSION보다 낡았다
  for (const id of ["summaryConsentState", "visionConsentState", "bgState"]) assert.equal(h.el(id).textContent, "동의하지 않음 — 사이드 패널에서 처음 사용할 때 동의합니다");
  for (const id of ["summaryWithdrawBtn", "visionWithdrawBtn", "bgWithdrawBtn"]) assert.equal(h.el(id).hidden, true);
});

test("the 보관함 PIN card saves the library key and re-saves stored note files through background", async () => {
  const h = await optionsHarness({
    local: () => ({ ok: true, count: 4, failed: 0 }),
    globals: "globalThis.PackageStore={indexedDbAdapter:async()=>({stub:true})};globalThis.NoteFile={saved:null,isPin:s=>/^\\d{4}$/.test(s),loadLibraryKey:async()=>null,saveLibraryKey:async(a,p)=>(NoteFile.saved=p,{salt:'s',at:1})};",
  });
  assert.equal(h.el("keyState").textContent, "설정 안 됨");
  assert.equal(h.el("keySaveBtn").textContent, "PIN 정하기");

  // 숫자 4자리가 아니면 저장도 재저장도 하지 않고 입력칸만 비운다
  h.fresh();
  h.el("keyPass1").value = "12345";
  await h.el("keyForm").listeners.submit({ preventDefault() {} });
  assert.equal(h.confirms.length, 0);
  assert.deepEqual(h.sent, []);
  assert.equal(h.notice(), "숫자 4자리를 입력하세요.");
  assert.equal(h.el("keyPass1").value, "");

  h.el("keyPass1").value = "0427";
  await h.el("keyForm").listeners.submit({ preventDefault() {} });
  assert.match(h.confirms[0], /새 PIN으로/);
  assert.match(h.confirms[0], /그 암호로 열어야 합니다/);
  assert.equal(vm.runInContext("NoteFile.saved", h.context), "0427");
  assert.deepEqual(h.sent, [{ target: "background", type: "LIB_EXPORT_ALL" }]);
  assert.match(h.notice(), /노트 파일 4개를 새 PIN으로 다시 저장했습니다/);
  assert.equal(h.el("keyPass1").value, "");
});

test("without note-file.js the PIN form is disabled instead of failing", async () => {
  const h = await optionsHarness();
  assert.equal(h.el("keyState").textContent, "이 기능을 쓸 수 없습니다.");
  assert.equal(h.el("keySaveBtn").disabled, true);
  assert.equal(h.el("keyPass1").disabled, true);
});

test("ymd only renders finite positive timestamps, so epoch zero and junk never reach the UI", async () => {
  const h = await optionsHarness();
  const ymd = expr => vm.runInContext(`ymd(${expr})`, h.context);
  for (const bad of ["0", "-1", "NaN", "Infinity", "-Infinity", "'2026-01-01'", "null", "undefined", "{}"]) assert.equal(ymd(bad), "", bad);
  assert.match(ymd("1759536000000"), /^\d{4}-\d{2}-\d{2}$/);
});

test("a broken IndexedDB disables the 보관함 PIN form and the rest of init still runs", async () => {
  const h = await optionsHarness({
    globals: "globalThis.PackageStore={indexedDbAdapter:async()=>{throw new Error('IndexedDB가 막혔습니다');}};globalThis.NoteFile={loadLibraryKey:async()=>null,saveLibraryKey:async()=>({})};",
  });
  assert.equal(h.el("keyState").textContent, "이 기능을 쓸 수 없습니다.");
  for (const id of ["keyPass1", "keySaveBtn"]) assert.equal(h.el(id).disabled, true);
  assert.ok(h.el("authState").textContent, "키 카드가 죽어도 그 뒤 초기화가 간다");
});

test("a successful wipe re-reads the library key so the card shows 설정 안 됨 without a reload", async () => {
  let ctx;
  const h = await optionsHarness({
    local: () => { ctx.__wiped = true; return { ok: true }; }, // 실제 WIPE_LOCAL 은 offscreen 에서 키를 지운다
    globals: "globalThis.PackageStore={indexedDbAdapter:async()=>({stub:true})};globalThis.NoteFile={loadLibraryKey:async()=>globalThis.__wiped?null:{salt:'s',at:1759536000000},saveLibraryKey:async()=>({})};",
  });
  ctx = h.context;
  assert.match(h.el("keyState").textContent, /^설정됨 · \d{4}-\d{2}-\d{2}$/);
  assert.equal(h.el("keySaveBtn").textContent, "PIN 바꾸기");

  await h.click("wipeBtn");
  assert.deepEqual(h.sent, [{ target: "background", type: "WIPE_LOCAL" }]);
  assert.match(h.notice(), /모두 삭제했습니다/);
  assert.equal(h.el("keyState").textContent, "설정 안 됨");
  assert.equal(h.el("keySaveBtn").textContent, "PIN 정하기");
});

// v2 플랜 카드: 계정(플랜·사용량·링크), 플랜에 따른 인식 카드, 노트 옵션, 개발자 카드.
// Account.fetchAccount 는 my_account RPC 한 줄을 돌려준다 - globals 로 계정을 심는다.
test("the plan label maps free/essential/professional and falls back to the raw id; minutes show only when limited", async () => {
  for (const [plan, label] of [["free", "Free"], ["essential", "Essential"], ["professional", "Pro"], ["edu-pro", "edu-pro"]]) {
    const h = await optionsHarness({ globals: `Account.fetchAccount=async()=>({plan:'${plan}'});` });
    assert.equal(h.el("planState").textContent, `${label} 플랜`, plan);
    assert.equal(h.el("accountPlanBox").hidden, false);
    assert.equal(h.el("billingLink").href, "https://summrizei.vercel.app/account/billing");
    assert.equal(h.el("libraryLink").href, "https://summrizei.vercel.app/library");
  }
  const limited = await optionsHarness({ globals: "Account.fetchAccount=async()=>({plan:'professional',minutes_used:7,minutes_limit:600});" });
  assert.equal(limited.el("planState").textContent, "Pro 플랜 · 이번 달 7/600분");
});

test("a failed account fetch keeps the page working and shows the plan as 확인 못 함", async () => {
  for (const globals of ["Account.fetchAccount=async()=>null;", "Account.fetchAccount=async()=>{throw new Error('down');}"]) {
    const h = await optionsHarness({ globals });
    assert.equal(h.el("planState").textContent, "플랜: 확인 못 함");
    assert.equal(h.el("accountPlanBox").hidden, false);
    assert.equal(h.el("serverRecog").hidden, true, "플랜을 모르면 서버 인식으로 바꾸지 않는다");
    assert.equal(h.el("ocrCard").hidden, false);
    assert.equal(h.el("noteOptsCard").hidden, true);
    assert.equal(h.el("authState").textContent, "student@example.com 계정으로 로그인했습니다.");
  }
});

test("a paid plan swaps the on-device controls for the server status and shows note options; free keeps them", async () => {
  const V = "2026-10-03"; // TERMS_VERSION과 같아야 클라우드 인식 동의가 '완료'다
  const paid = await optionsHarness({
    extra: { visionConsent: true, visionConsentVersion: V, visionConsentAt: 9 },
    globals: "Account.fetchAccount=async()=>({plan:'essential',minutes_limit:null});",
  });
  for (const id of ["ocrCard", "whisperToggle", "whisperModelField", "speedField"]) assert.equal(paid.el(id).hidden, true, id);
  assert.equal(paid.el("serverRecog").hidden, false);
  assert.equal(paid.el("serverConsentState").textContent, "클라우드 인식 동의: 완료");
  assert.equal(paid.el("noteOptsCard").hidden, false);
  assert.equal(paid.el("whisperLang").value, "ko", "언어 선택은 모두에게 남는다");
  assert.equal(paid.el("voiceHeading").textContent, "화면·음성 인식", "유료 플랜에서 헤딩이 바뀐다");
  assert.equal(paid.el("bannerRecogText").textContent, "화면과 음성은 서버에서 인식하고 저장하지 않습니다.", "유료 플랜에서 배너 텍스트가 바뀐다");

  // 노트 옵션은 change 즉시 noteOptions 로 저장된다
  paid.el("noteSyntheticCb").checked = true;
  await paid.el("noteSyntheticCb").listeners.change();
  assert.deepEqual({ ...paid.data.noteOptions }, { syntheticExamples: true, externalAugmentation: false });
  paid.el("noteAugmentCb").checked = true;
  await paid.el("noteAugmentCb").listeners.change();
  assert.deepEqual({ ...paid.data.noteOptions }, { syntheticExamples: true, externalAugmentation: true });

  const noConsent = await optionsHarness({ globals: "Account.fetchAccount=async()=>({plan:'professional'});" });
  assert.equal(noConsent.el("serverConsentState").textContent, "클라우드 인식 동의: 필요 — 사이드 패널에서 동의");

  const free = await optionsHarness({ globals: "Account.fetchAccount=async()=>({plan:'free'});" });
  for (const id of ["ocrCard", "whisperToggle", "whisperModelField", "speedField"]) assert.equal(free.el(id).hidden, false, id);
  assert.equal(free.el("serverRecog").hidden, true);
  assert.equal(free.el("noteOptsCard").hidden, true);
  assert.equal(free.el("voiceHeading").textContent, "음성 받아쓰기", "무료 플랜에서 헤딩이 원래대로");
  assert.equal(free.el("bannerRecogText").textContent, "화면과 음성은 기기 안에서 인식합니다", "무료 플랜에서 배너 텍스트가 원래대로");
});

test("signed out there is no plan box and the on-device controls stay", async () => {
  const h = await optionsHarness({ signedIn: false });
  assert.equal(h.el("accountPlanBox").hidden, true);
  assert.equal(h.el("planState").textContent, "");
  assert.equal(h.el("ocrCard").hidden, false);
  assert.equal(h.el("serverRecog").hidden, true);
  assert.equal(h.el("noteOptsCard").hidden, true);
});

test("the developer card shows only on unpacked builds - hidden once the manifest has update_url", async () => {
  assert.equal((await optionsHarness()).el("devCard").hidden, false, "가짜 chrome.runtime 에는 getManifest 가 없다 - 개발 빌드로 본다");
  const packed = await optionsHarness({ globals: "chrome.runtime.getManifest=()=>({update_url:'https://clients2.google.com/service/update2/crx'});" });
  assert.equal(packed.el("devCard").hidden, true);
});
