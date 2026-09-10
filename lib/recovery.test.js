const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    value: "", textContent: "", hidden: false, style: {}, selectedOptions: [],
    addEventListener() {}, dispatchEvent() {}, appendChild() {}, append() {},
    scrollIntoView() {},
  });
  return elements.get(id);
}
let saved = { consentAccepted: true, whisperEnabled: false, outputFormat: "summary" };
let calls = 0;
const context = vm.createContext({
  document: { getElementById: element, createElement: () => element(Symbol()) },
  window: { addEventListener() {} }, Event: class {},
  AudioCapturer: class {},
  chrome: { storage: { local: { get: async () => ({}) } }, tabs: { query: async () => [] } },
  loadSettings: async () => ({ ...saved }), saveSettings: async () => {},
  PROVIDER_LABEL: { gemini: "Gemini" }, formatTime: String,
  setInterval: () => 1, clearInterval() {}, setTimeout() {},
  buildSummaryBody: () => ({}),
  callRemote: async () => { calls++; return { text: "요약 결과", input: 1, output: 1 }; },
});

(async () => {
  vm.runInContext(read("sidepanel.js"), context);
  await new Promise(setImmediate);
  await vm.runInContext(`(async () => {
    transcript = [{ time: 1, text: "강의 내용" }];
    setStage("live");
    await generateNotes();
  })()`, context);
  assert.equal(calls, 0, "키 없이는 API를 호출하면 안 된다");
  assert.equal(element("stageDone").hidden, false, "키가 없어도 재시도 화면이 보여야 한다");
  assert.equal(element("notesBtn").disabled, false);
  assert.equal(vm.runInContext("transcript.length", context), 1);
  saved.apiKey = "test-key";
  saved.provider = "gemini";
  await vm.runInContext("generateNotes()", context);
  assert.equal(calls, 1);
  assert.equal(element("result").value, "요약 결과");
  assert.equal(element("donePill").textContent, "노트 완성");
  await vm.runInContext("Promise.all([generateNotes(), generateNotes()])", context);
  assert.equal(calls, 2, "중복 요약 요청을 차단해야 한다");
  await vm.runInContext('transcript = []; setStage("live"); finishCapture()', context);
  assert.equal(element("stageReady").hidden, false, "빈 캡처 후 다시 시작할 수 있어야 한다");

  const local = {}, sync = {};
  const area = (data) => ({
    get: async () => ({ ...data }), set: async (patch) => Object.assign(data, patch),
    remove: async (key) => { delete data[key]; },
  });
  const settingsContext = vm.createContext({ chrome: { storage: { local: area(local), sync: area(sync) } } });
  vm.runInContext(read("lib/settings.js"), settingsContext);
  await vm.runInContext('saveApiKey("synced-key", true)', settingsContext);
  assert.equal(local.syncKey, true);
  delete local.apiKey;
  assert.equal((await vm.runInContext("loadSettings()", settingsContext)).apiKey, "synced-key");
  await vm.runInContext('saveApiKey("local-key", false)', settingsContext);
  assert.equal(local.syncKey, false);
  assert.equal(sync.apiKey, undefined);
  assert.equal((await vm.runInContext("loadSettings()", settingsContext)).apiKey, "local-key");

  let connect, message;
  const sent = [];
  const captureContext = vm.createContext({
    window: {}, document: { title: "테스트 강의" },
    chrome: { runtime: { onConnect: { addListener: (fn) => { connect = fn; } } } },
  });
  // 캔버스/OCR 대신 이미 캡처된 마지막 배치를 넣고 실제 STOP 핸들러를 실행한다.
  const content = read("content.js").replace(/\}\)\(\);\s*$/, `
    window.seedCapture = () => { capturing = true; batch = [{ frame: "frame", time: 3 }]; };
  })();`);
  vm.runInContext(content, captureContext);
  connect({ name: "capture", postMessage: (msg) => sent.push(msg),
    onMessage: { addListener: (fn) => { message = fn; } }, onDisconnect: { addListener() {} } });
  captureContext.window.seedCapture();
  message({ type: "STOP" });
  assert.deepEqual(sent.map((msg) => msg.type), ["frames", "done"]);
  assert.equal(sent[0].frames[0], "frame");
  assert.equal(sent[1].title, "테스트 강의");
  message({ type: "STOP" });
  assert.equal(sent.length, 2, "중복 STOP은 완료를 중복 전송하지 않는다");
  console.log("recovery: all tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
