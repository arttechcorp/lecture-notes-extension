// options.html 데이터 관리 카드: 로컬 삭제, 진단 파일 내보내기, 계정 삭제의 순서와 실패 처리.
// options.js 를 실제 settings.js·auth.js·diagnostics.js 와 같은 컨텍스트에 올리고, DOM·chrome·서비스 호출만 가짜로 둔다.
// 저장소를 실제로 지우는 쪽(offscreen)은 lib/offscreen-boundary.test.js 가 실제 PackageStore 로 확인한다.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { resolveObjectURL } = require("node:buffer");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const cli = path.join(root, "tools", "decrypt-diagnostic.mjs");

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const SESSION = { accessToken: JWT, refreshToken: "refresh-token_1", expiresAt: Date.now() + 3600e3, userId: "0b9c1c52-6f0e-4f5e-9a39-2a1d3f1d9c11", email: "student@example.com" };
const BUSY = "캡처나 백그라운드 작업이 진행 중입니다. 끝난 뒤 다시 시도하세요.";
const LOCAL_ONLY = { theme: "dark", serviceUrl: "https://service.example", summaryModel: "google/gemini-2.5-flash-lite", backgroundConsent: { personalUse: true, accessRights: true, version: "2026-10-02", at: 5 }, visionConsent: true, visionConsentVersion: "2026-10-02", visionConsentAt: 7 };
const EVENTS = [
  { ts: 1700000000000, jobId: "job-01", traceId: "tr-01", spanId: "sp-01", stage: "stt", status: "running", level: "info" },
  { ts: 1700000002400, jobId: "job-01", traceId: "tr-01", spanId: "sp-02", parentSpanId: "sp-01", stage: "stt", unit: "u-7", status: "failed", ms: 1100, bytes: 2048, model: "whisper-large-v3-turbo", costUsd: 0.011, code: "STT_RATE_LIMIT", level: "error", msg: "재시도 초과" },
];

// 운영자 키 쌍은 실제 도구로 만든다. 개인키는 임시 폴더에만 있다.
function operatorKeypair(dir) {
  const gen = spawnSync(process.execPath, [cli, "--generate-keypair", dir], { encoding: "utf8" });
  assert.equal(gen.status, 0, gen.stderr);
  const { kid, publicJwk } = JSON.parse(gen.stdout);
  return { kid, publicJwk, privateFile: path.join(dir, "private.jwk.json") };
}

async function optionsHarness({ signedIn = true, operatorKey = null, serviceUrl = "https://service.example", events = EVENTS, local = () => ({ ok: true }), deleteAccount = async () => ({ deleted: true }) } = {}) {
  const h = { order: [], sent: [], downloads: [], timers: [], confirms: [], answer: true, els: {}, data: { ...LOCAL_ONLY, serviceUrl, ...(signedIn ? { authSession: { ...SESSION } } : {}) }, local, deleteAccount };
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
    OpenRouterClient: {},
  });
  h.context = context;
  h.el = el;
  for (const file of ["lib/settings.js", "lib/auth.js", "lib/diagnostics.js"]) vm.runInContext(read(file), context, { filename: file });
  if (operatorKey) vm.runInContext("Diagnostics.OPERATOR_KEYS.push(" + JSON.stringify(operatorKey) + ")", context);
  vm.runInContext(read("options.js"), context, { filename: "options.js" });
  for (let i = 0; i < 200 && !el("visionState").textContent; i++) await new Promise(r => setImmediate(r)); // 초기화(설정 읽기·로그인 표시·플랜 확인)가 끝날 때까지
  assert.ok(el("visionState").textContent, "options.js 초기화가 끝나지 않았다");
  h.click = id => el(id).listeners.click();
  h.notice = () => el("saved").textContent;
  h.user = () => vm.runInContext("Auth.user()", context);
  h.fresh = () => { h.order.length = 0; h.sent.length = 0; h.confirms.length = 0; h.downloads.length = 0; };
  return h;
}

test("options.html has the 데이터 관리 card, loads diagnostics.js before options.js, and keeps the consent text", () => {
  const html = read("options.html"), at = name => html.indexOf(`src="${name}"`);
  for (const id of ["wipeBtn", "diagExportBtn", "diagClearBtn", "diagState", "accountDeleteBox", "accountDeleteBtn"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /<div id="accountDeleteBox" hidden>/, "로그인 전에는 계정 삭제가 보이지 않는다");
  assert.ok(at("lib/diagnostics.js") > -1 && at("lib/diagnostics.js") < at("options.js"), "diagnostics.js 는 options.js 앞");
  assert.match(html, /<h2 id="dataHeading">데이터 관리<\/h2>/);
  const code = read("options.js").split("\n").filter(line => !line.trimStart().startsWith("//")).join("\n");
  assert.equal(/chrome\.downloads/.test(code) || /"downloads"/.test(read("manifest.json")), false, "downloads 권한 없이 Blob 링크로 내려받는다");
  assert.match(read("lib/settings.js"), /TERMS_VERSION='2026-10-03'/, "동의 문구 버전은 그대로");
});

test("the export button is disabled with the explanation while OPERATOR_KEYS is empty, and stays out of the way otherwise", async () => {
  const h = await optionsHarness();
  assert.equal(h.context.Diagnostics.OPERATOR_KEYS.length, 0, "자리표시자는 비어 있다 - 가짜 키를 넣지 않는다");
  assert.equal(h.el("diagExportBtn").disabled, true);
  assert.equal(h.el("diagState").textContent, "운영자 키가 아직 설정되지 않아 내보낼 수 없습니다");
  assert.equal(h.el("diagClearBtn").disabled, false, "로그 삭제는 키와 무관하다");
  assert.equal(h.el("wipeBtn").disabled, false);
  assert.equal(h.sent.length, 0, "열기만 해서는 offscreen 에 아무것도 묻지 않는다");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "options-data-"));
  try {
    const withKey = await optionsHarness({ operatorKey: operatorKeypair(dir) });
    assert.equal(withKey.el("diagExportBtn").disabled, false);
    assert.equal(withKey.el("diagState").textContent, "");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("with an operator key the export downloads a Blob bundle that only that key opens and that holds allowlisted fields only", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "options-data-"));
  try {
    const { kid, publicJwk, privateFile } = operatorKeypair(dir);
    const h = await optionsHarness({ operatorKey: { kid, publicJwk } });
    await h.click("diagExportBtn");

    assert.deepEqual(h.sent.map(m => [m.target, m.type]), [["background", "LOGS_READ"]], "로그는 background 를 거쳐 offscreen 에서 읽는다");
    assert.equal(h.downloads.length, 1);
    const [{ href, download }] = h.downloads;
    assert.match(download, /^summrizei-diagnostic-\d{4}-\d{2}-\d{2}\.json$/);
    const text = await resolveObjectURL(href).text();
    assert.ok(!text.includes("재시도 초과") && !text.includes("STT_RATE_LIMIT") && !text.includes("job-01"), "파일 안에 로그 평문이 없다");
    const bundle = JSON.parse(text);
    assert.deepEqual(Object.keys(bundle), ["v", "kid", "alg", "epk", "iv", "ct", "createdAt"]);
    assert.equal(bundle.kid, kid);

    const file = path.join(dir, "bundle.json");
    fs.writeFileSync(file, text);
    const dec = spawnSync(process.execPath, [cli, file, privateFile], { encoding: "utf8" });
    assert.equal(dec.status, 0, dec.stderr);
    const opened = JSON.parse(dec.stdout);
    assert.deepEqual(opened, EVENTS);
    const allowed = new Set(h.context.Diagnostics.EVENT_FIELDS);
    for (const e of opened) for (const key of Object.keys(e)) assert.ok(allowed.has(key), `허용 목록 밖의 필드 ${key}`);

    assert.match(h.notice(), /진단 파일을 내려받았습니다/);
    assert.equal(h.el("diagExportBtn").disabled, false);
    assert.equal(h.timers.length, 1);
    h.timers[0].fn();
    assert.equal(resolveObjectURL(href), undefined, "Blob 주소는 곧 풀어 준다");

    // 다른 키 쌍으로는 열리지 않는다
    const other = operatorKeypair(path.join(dir, "other"));
    const wrong = spawnSync(process.execPath, [cli, file, other.privateFile], { encoding: "utf8" });
    assert.equal(wrong.status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("an event with a field outside the allowlist, or no events at all, downloads nothing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "options-data-"));
  try {
    const key = operatorKeypair(dir);
    const leaky = await optionsHarness({ operatorKey: key, events: [...EVENTS, { ts: 1, stage: "stt", level: "info", text: "강의 전사 한 줄" }] });
    await leaky.click("diagExportBtn");
    assert.equal(leaky.downloads.length, 0);
    assert.match(leaky.notice(), /허용되지 않은 필드/);
    assert.equal(leaky.timers.length, 0);

    const empty = await optionsHarness({ operatorKey: key, events: [] });
    await empty.click("diagExportBtn");
    assert.equal(empty.downloads.length, 0);
    assert.equal(empty.notice(), "내보낼 진단 로그가 없습니다.");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
