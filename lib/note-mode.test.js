// devNoteMode 실험 스위치의 닫힘 규칙(offscreen.js): 설정 묶음이 통째로 없거나, 플래그가 켜져 있는데
// 여섯 실험 모드가 아니면 노트 작업을 시작하지 않는다 — 기본 모델로 조용히 떨어지는 회귀(2026-10-07 실황 실험) 방지.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "..");

// offscreen.js 를 최소 의존성으로 올린다 — bgMessage 의 설정 가드와 noteModeOf·GENERATE_NOTES 게이트만 부른다.
function harness({ session = false } = {}) {
  const h = { sent: [] };
  let listener;
  const context = vm.createContext({
    URL, AbortController, crypto, console, Map, Set, Promise, setTimeout, clearTimeout, btoa, atob,
    chrome: { runtime: { id: "extension-id", getManifest: () => ({ version: "1.0.0" }), getURL: p => `chrome-extension://extension-id/${p}`,
      sendMessage: async m => (h.sent.push(JSON.parse(JSON.stringify(m))), { ok: true }),
      onMessage: { addListener: fn => { listener = fn; } }, onConnect: { addListener() {} } } },
    // 저장소 없는 환경: LogSink 타이머가 테스트 프로세스를 잡아두지 않게 indexedDbAdapter는 실패시킨다(가드는 저장소 전에 멈춘다).
    PackageStore: { indexedDbAdapter: async () => { throw new Error("no store"); }, createStore: async a => a },
  });
  vm.runInContext(fs.readFileSync(path.join(root, "lib", "events.js"), "utf8"), context, { filename: "events.js" });
  vm.runInContext(fs.readFileSync(path.join(root, "lib", "pipeline.js"), "utf8"), context, { filename: "pipeline.js" }); // Pipeline.pipelineError·codeOf
  vm.runInContext(fs.readFileSync(path.join(root, "offscreen.js"), "utf8"), context, { filename: "offscreen.js" });
  if (session) vm.runInContext(`session={status:"completed",id:"session-id",generation:1,error:null,summaryAttempt:0,slideDocs:[],gaps:[],options:{},store:{snapshot:()=>[]},publish:()=>{},log:()=>{},state(){return{status:this.status};}}`, context);
  h.send = (message, url = "background.js") => new Promise(r => listener({ target: "session", ...message }, { id: "extension-id", url: `chrome-extension://extension-id/${url}` }, r)).then(r => JSON.parse(JSON.stringify(r)));
  h.events = () => JSON.parse(vm.runInContext("JSON.stringify(bus.recent())", context));
  h.modeOf = s => vm.runInContext(`noteModeOf(${JSON.stringify(s) ?? "undefined"})`, context);
  return h;
}

const SOURCE = { playlistUrl: "https://cdn.example.com/a.m3u8", pageUrl: "https://lms.example.com/" };
const SETTINGS = { serviceUrl: "https://service.example", appSessionToken: "static-dev-token-static-dev-token-1", remoteSummaryConsent: true };

test("noteModeOf returns the mode for the six experiment values and null when unset", () => {
  const h = harness();
  for (const s of [undefined, {}, { devNoteMode: "" }, { devNoteMode: null }]) assert.equal(h.modeOf(s), null, JSON.stringify(s));
  for (const m of ["independent", "sol-session", "sol-luna-tool", "sol-fork", "sol-luna-2", "sol-fork-2"]) assert.equal(h.modeOf({ devNoteMode: m }), m);
});

test("noteModeOf fails closed when devNoteMode is set but unreadable — no silent default-model fallback", () => {
  const h = harness();
  for (const bad of ["bogus", " sol-session", "SOL-SESSION", 42, ["sol-session"], { mode: "independent" }])
    assert.throws(() => h.modeOf({ devNoteMode: bad }), e => e?.code === "NOTE_MODE_INVALID", JSON.stringify(bad));
  assert.ok(h.events().some(e => e.code === "NOTE_MODE_INVALID"), "명확한 이벤트가 진단에 남는다");
});

test("BG_RUN and LIB_REGENERATE refuse to start a note run when the settings object is missing", async () => {
  const h = harness();
  const run = await h.send({ type: "BG_RUN", jobId: "job-12345678", source: SOURCE });
  assert.equal(run.ok, false);
  assert.match(run.error, /설정/);
  const regen = await h.send({ type: "LIB_REGENERATE", packageId: "Lp1-abc123", options: { syntheticExamples: false, externalAugmentation: false } });
  assert.equal(regen.ok, false);
  assert.match(regen.error, /설정/);
  for (const bad of [undefined, null, "devNoteMode=sol-session", [SETTINGS]]) {
    const r = await h.send({ type: "BG_RUN", jobId: "job-abcdefgh", source: SOURCE, settings: bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  assert.equal(h.events().filter(e => e.code === "NOTE_SETTINGS_MISSING").length, 6, "거절마다 코드가 남는다");
  assert.ok(!h.sent.some(m => m.type === "BG_REFERER"), "거절된 요청은 아무것도 시작하지 않는다");
});

test("GENERATE_NOTES refuses to start when the settings object is missing", async () => {
  const h = harness({ session: true });
  const r = await h.send({ type: "GENERATE_NOTES" });
  assert.equal(r.ok, false);
  assert.match(r.error, /설정/);
  assert.ok(h.events().some(e => e.code === "NOTE_SETTINGS_MISSING" && e.jobId === "session-id"));
});
