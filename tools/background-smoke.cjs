// 백그라운드 처리 스모크: 진짜 Chrome(for Testing) + 압축 해제된 확장(패키지 closure 그대로) + 로컬 HLS 픽스처 + 가짜 제공자를 단 진짜 server/index.js.
// 사용: PLAYWRIGHT_MODULE=<playwright 경로> CHROME_PATH=<H.264/AAC 를 디코드하는 Chrome 또는 Chrome for Testing> node tools/background-smoke.cjs [happy|protected|resume|cancel|paint|all]
const assert = require("node:assert/strict"), http = require("node:http"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), cp = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/opt/node-tools/node_modules/playwright");
const REPO = path.resolve(__dirname, "..");
const { TERMS_VERSION } = require(REPO + "/lib/settings.js");
const { createServer } = require(REPO + "/server/index.js");
const Pipeline = require(REPO + "/lib/pipeline.js");
const WHICH = process.argv[2] || "all";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bgsmoke-"));
const log = (...a) => console.log(...a);

// ── 확장: 패키지 closure 만 복사하고 webRequest 를 필수 권한으로 옮긴다(헤드리스에서는 선택 권한 허용 창을 누를 수 없다) ──
async function stageExtension() {
  const { resolveRuntimeClosure } = await import(REPO + "/tools/package-cws.mjs");
  const { files } = resolveRuntimeClosure();
  const dir = path.join(tmp, "ext");
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.copyFileSync(path.join(REPO, f), path.join(dir, f)); }
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  if (process.env.WEBREQUEST_REQUIRED === "1") { m.permissions.push("webRequest"); m.optional_permissions = []; } // 기본은 출시 매니페스트 그대로(webRequest 는 선택 권한 — 패널의 클릭에서 요청한다)
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m, null, 2));
  return { dir, files: files.length, manifest: m };
}

// ── HLS 픽스처 + CDN(Referer 검사) + 강의 사이트 ──
function makeFixtures() {
  const out = path.join(tmp, "fx");
  cp.execFileSync("node", [REPO + "/tools/make-hls-fixture.mjs", out], { stdio: ["ignore", "ignore", "inherit"] });
  // 말하듯 끊기는 오디오(2초 소리 1초 쉼) + 4초마다 바뀌는 슬라이드 6장. plain 픽스처의 사인파는 VAD 가 말로 보지 않아 STT 경로가 돌지 않는다.
  const dir = path.join(out, "speech"); fs.mkdirSync(dir, { recursive: true });
  const colors = ["ff0000", "00ff00", "0000ff", "ffff00", "ff00ff", "00ffff"];
  const v = colors.map((c, i) => `color=c=0x${c}:s=320x180:r=10:d=4[v${i}]`);
  const graph = [...v, `${colors.map((_, i) => `[v${i}]`).join("")}concat=n=6:v=1:a=0[v]`, `sine=frequency=300:sample_rate=44100:duration=24,volume='if(lt(mod(t\\,3)\\,2)\\,1\\,0)':eval=frame[a]`].join(";");
  cp.execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-force_key_frames", "expr:gte(t,n_forced*2)", "-sc_threshold", "0", "-f", "hls", "-hls_time", "8", "-hls_playlist_type", "vod", "-hls_segment_filename", path.join(dir, "seg%d.ts"), path.join(dir, "index.m3u8")], { stdio: ["ignore", "inherit", "inherit"] });
  return out;
}
const cdn = { log: [], expired: false };
function startCdn(fx, lecture) {
  const types = { ".m3u8": "application/vnd.apple.mpegurl", ".ts": "video/mp2t", ".key": "application/octet-stream" };
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x"), ref = req.headers.referer || null;
    cdn.log.push({ path: url.pathname, referer: ref, origin: req.headers.origin || null });
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (!ref || !ref.startsWith(lecture.origin + "/") || cdn.expired) { res.statusCode = 403; return res.end("forbidden"); } // Referer 를 요구하는 CDN(만료 흉내 포함)
    const file = path.join(fx, path.normalize(url.pathname));
    if (!file.startsWith(fx) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=3600"); // 확장은 no-store 로 요청한다
    res.end(fs.readFileSync(file));
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r(srv)));
}
function startLecture(cdnPort) {
  const lecture = { origin: null, hits: [] };
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    lecture.hits.push(url.pathname);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const src = url.searchParams.get("src") || "speech";
    // 플레이어 흉내: 재생목록을 1초마다 다시 요청한다(웹 요청 관찰 창에 반드시 걸린다). 페이지 자신의 요청은 평소처럼 나간다.
    res.end(`<!doctype html><title>Synthetic lecture ${src}</title><h1>lecture</h1><script>
      setInterval(()=>fetch("http://127.0.0.1:${cdnPort}/${src}/index.m3u8").catch(()=>{}),1000);
    </script>`);
  });
  return new Promise(r => srv.listen(0, "localhost", () => { lecture.origin = "http://localhost:" + srv.address().port; lecture.srv = srv; r(lecture); }));
}

// ── 가짜 제공자(진짜 서버의 deps.fetch): 요청 본문에서 단위 id 를 읽어 계약에 맞는 출력을 만든다 ──
const SENTINEL = "SMOKE-SENTINEL-내용";
const provider = { delay: 0, calls: { vision: 0, stt: 0, judge: 0, plan: 0, section: 0, global: 0, repair: 0 }, images: 0 };
const TOPICS = ["미분의 정의와 극한", "적분의 기본 정리", "행렬의 고유값 분해", "확률변수의 기댓값", "벡터 공간과 기저", "푸리에 변환 개요", "경제학의 한계효용", "회로의 키르히호프 법칙"];
const ok = body => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
const chat = (content, extra = {}) => ok({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) }, ...extra }], usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0001 } });
async function fakeProviders(url, options) {
  if (url.startsWith("https://api.groq.com/")) {
    provider.calls.stt++;
    return ok({ duration: 30, segments: [{ start: 0, end: 4, text: `${TOPICS[provider.calls.stt % TOPICS.length]}에 대해 설명하겠습니다`, no_speech_prob: 0.01, avg_logprob: -0.2, compression_ratio: 1.2 }, { start: 4, end: 9, text: "이 부분은 시험에 자주 나오니 잘 기억해 두세요", no_speech_prob: 0.02, avg_logprob: -0.25, compression_ratio: 1.3 }], words: [] });
  }
  assert.equal(url, "https://openrouter.ai/api/v1/chat/completions", url);
  const body = JSON.parse(options.body), name = body.response_format?.json_schema?.name;
  if (body.logprobs) { provider.calls.judge++; return ok({ choices: [{ logprobs: { content: [{ token: "A", logprob: 0, top_logprobs: [{ token: "A", logprob: Math.log(0.9) }, { token: "B", logprob: Math.log(0.1) }] }] } }], usage: { prompt_tokens: 10, completion_tokens: 1, cost: 0.00001 } }); }
  if (name === "slide_doc") {
    provider.calls.vision++;
    if (provider.delay) await new Promise(r => setTimeout(r, provider.delay));
    const img = body.messages[1].content.find(p => p.type === "image_url").image_url.url;
    assert.match(img, /^data:image\/jpeg;base64,/); provider.images++;
    const n = provider.calls.vision;
    return chat({ blocks: [{ text: `${TOPICS[n % TOPICS.length]} ${n}번째 슬라이드`, role: "title", bbox: { x: 0.1, y: 0.1, w: 0.6, h: 0.1 }, conf: 0.9 }], formulas: [], figures: [] });
  }
  const user = JSON.parse(body.messages[1].content);
  if (name === "lecture_note_plan") { provider.calls.plan++; return chat({ sections: [{ sectionId: "S1", title: "전체 흐름", unitIds: user.ir.units.map(u => u.unitId), blocks: [{ type: "text", purpose: "강의 전체를 요약한다" }] }] }); }
  if (name === "lecture_note_section") { provider.calls.section++; return chat({ blocks: [{ type: "text", heading: "핵심 정리", body: `슬라이드와 설명을 묶어 정리한 요약입니다 ${provider.calls.section}`, evidenceIds: user.units.map(u => u.unitId), derived: [] }] }); }
  if (name === "lecture_note_global") { provider.calls.global++; return chat({ blocks: [{ type: "text", heading: "전체 개요", body: `강의 전체를 여는 개요입니다 ${provider.calls.global}`, evidenceIds: user.sections.flatMap(s => s.blocks.flatMap(b => b.evidenceIds)).slice(0, 5), derived: [] }] }); }
  throw new Error("unexpected provider call " + name);
}

(async () => {
  const fx = makeFixtures(), ext = await stageExtension();
  log(`확장 closure ${ext.files}개 복사, 권한: ${ext.manifest.permissions.join(",")} | 선택: ${(ext.manifest.optional_permissions || []).join(",")}`);
  const context = await chromium.launchPersistentContext(path.join(tmp, "profile"), {
    executablePath: process.env.CHROME_PATH, headless: true, ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging", "--autoplay-policy=no-user-gesture-required"],
  });
  const deadline = setTimeout(() => { console.error("스모크 시간 초과"); process.exit(1); }, 5 * 60 * 1000);
  let server, lectureSrv, cdnSrv;
  try {
    const cdpBrowser = await context.browser().newBrowserCDPSession();
    const { id } = await cdpBrowser.send("Extensions.loadUnpacked", { path: ext.dir });
    const worker = context.serviceWorkers().find(w => w.url().startsWith(`chrome-extension://${id}/`)) || await context.waitForEvent("serviceworker", { timeout: 15000 });
    log("확장 id", id);
    // 서버(진짜 server/index.js)
    const token = "smoke-dev-token-".padEnd(40, "z"), lite = "google/gemini-2.5-flash-lite", nano = "openai/gpt-4.1-nano";
    const vault = path.join(tmp, "vault");
    server = createServer({
      APP_TOKENS_JSON: JSON.stringify({ A: token }), EXTENSION_ORIGIN: "chrome-extension://" + id, OPENROUTER_API_KEY: "mock-operator-key", GROQ_API_KEY: "mock-groq-key",
      ALLOWED_MODELS: JSON.stringify([lite]), ALLOWED_VISION_MODELS: JSON.stringify([lite]), ALLOWED_STT_MODELS: JSON.stringify(["whisper-large-v3-turbo"]), ALLOWED_JUDGE_MODELS: JSON.stringify([nano]),
      OPENROUTER_PROVIDERS_JSON: JSON.stringify({ [lite]: ["test-provider"], [nano]: ["test-provider"] }), VAULT_DIR: vault,
      ACCOUNT_LIMITS_JSON: JSON.stringify({ A: { models: [lite], maxRequests: 5000, maxCostCents: 5000, features: ["vision", "stt", "judge", "background"] } }), RATE_PER_MIN: "100000",
    }, { fetch: fakeProviders });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const serviceUrl = "http://127.0.0.1:" + server.address().port;
    // 강의 사이트 + CDN
    const lecture0 = { origin: null };
    cdnSrv = await startCdn(fx, lecture0);
    const lecture = await startLecture(cdnSrv.address().port); lectureSrv = lecture.srv; lecture0.origin = lecture.origin;
    // 설정(동의·서비스)
    await worker.evaluate(s => chrome.storage.local.set(s), {
      consentAccepted: true, ocrEnabled: true, whisperEnabled: false, serviceUrl, appSessionToken: token, remoteSummaryConsent: true, visionConsent: true, visionConsentVersion: TERMS_VERSION, visionConsentAt: Date.now(),
      backgroundConsent: { personalUse: true, accessRights: true, version: TERMS_VERSION, at: Date.now() },
    });
    // 서비스 워커 계측: 절전 방지·실시간 캡처 시도·DNR 규칙을 기록한다(상태가 아니라 시험용 관찰)
    await worker.evaluate(() => {
      globalThis.__obs = { awake: [], capture: 0, rules: [] };
      const p = chrome.power, req = p.requestKeepAwake.bind(p), rel = p.releaseKeepAwake.bind(p);
      p.requestKeepAwake = l => { __obs.awake.push("request:" + l); return req(l); };
      p.releaseKeepAwake = () => { __obs.awake.push("release"); return rel(); };
      const t = chrome.tabCapture, g = t.getMediaStreamId.bind(t);
      t.getMediaStreamId = o => { __obs.capture++; return g(o); };
      const d = chrome.declarativeNetRequest, u = d.updateSessionRules.bind(d);
      d.updateSessionRules = async o => { const r = await u(o); __obs.rules.push({ remove: o.removeRuleIds || [], add: (o.addRules || []).map(x => ({ id: x.id, domains: x.condition.requestDomains, tabIds: x.condition.tabIds, referer: x.action.requestHeaders[0].value })) }); return r; };
    });
    const results = {};
    const runCase = async (name, fn) => { if (WHICH !== "all" && WHICH !== name) return; log(`\n=== ${name} ===`); results[name] = await fn(); log(`PASS ${name}`); };
    const openLecture = async src => {
      const page = await context.newPage();
      await page.goto(`${lecture.origin}/lecture.html?src=${src}`);
      const tabs = await worker.evaluate(() => chrome.tabs.query({}));
      const tab = tabs.find(t => t.url.includes(`src=${src}`));
      return { page, tabId: tab.id, url: tab.url };
    };
    const openPanel = async tabId => {
      const panel = await context.newPage();
      panel.on("pageerror", e => log("PANEL ERROR", e.message));
      await panel.goto(`chrome-extension://${id}/sidepanel.html?tabId=${tabId}`);
      await panel.waitForFunction(() => document.getElementById("bgBox") && !document.getElementById("bgBox").hidden, null, { timeout: 30000 });
      return panel;
    };
    const status = panel => panel.evaluate(() => ({ text: document.getElementById("bgStatus").textContent, progress: document.getElementById("bgProgress").textContent, live: !document.getElementById("bgLiveBtn").hidden, retry: !document.getElementById("bgRetryBtn").hidden, cancel: !document.getElementById("bgCancelBtn").hidden, options: !document.getElementById("bgOptionsLink").hidden }));
    const waitText = (panel, re, timeout = 120000) => panel.waitForFunction(r => new RegExp(r).test(document.getElementById("bgStatus").textContent), re.source, { timeout });
    const obs = () => worker.evaluate(() => JSON.parse(JSON.stringify(__obs)));
    const idb = panel => panel.evaluate(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open("summrizei"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const dump = s => new Promise((res, rej) => { const tx = db.transaction(s), o = tx.objectStore(s), k = o.getAllKeys(), v = o.getAll(); tx.oncomplete = () => res(k.result.map((key, i) => [key, v.result[i]])); tx.onerror = () => rej(tx.error); });
      const out = { stores: [...db.objectStoreNames] };
      for (const s of ["packages", "jobs"]) out[s] = (await dump(s)).map(([key, v]) => ({ key, keys: Object.keys(v || {}), ct: v?.ct?.byteLength ?? null, plain: JSON.stringify(v).includes("SMOKE") }));
      out.caches = await caches.keys();
      return out;
    });

    await runCase("happy", async () => {
      const { page, tabId, url } = await openLecture("speech");
      const panel = await openPanel(tabId);
      cdn.log.length = 0;
      await panel.click("#bgBtn");
      const t0 = Date.now(), tick = setInterval(async () => { try { const s = await status(panel); log(`  [${Math.round((Date.now() - t0) / 1000)}s]`, JSON.stringify(s.text), s.progress, "| CDN", cdn.log.length, "| 제공자", JSON.stringify(provider.calls)); } catch {} }, 5000);
      try { await waitText(panel, /노트 준비됨|마치지 못했습니다|실패|오류/, 90000); } finally { clearInterval(tick); }
      const s = await status(panel);
      log("패널:", JSON.stringify(s.text));
      assert.match(s.text, /슬라이드 \d+/); assert.match(s.text, /고지 \d+건/); assert.match(s.text, /v2 노트 보기/);
      // 확장의 요청과 페이지 자신의 요청은 둘 다 Referer 가 탭의 출처(`origin/`)다 — 규칙은 브라우저 기본 정책이 보내는 값만 재현한다.
      // 둘은 CORS Origin 헤더로 가른다: 호스트 권한이 있는 확장의 요청에는 Origin 이 없다.
      const mine = cdn.log.filter(r => r.origin === null);
      const theirs = cdn.log.filter(r => r.origin !== null);
      log(`CDN 요청: 확장 ${mine.length}건, 페이지 ${theirs.length}건`, JSON.stringify(cdn.log.map(r => [r.path, r.referer, r.origin])));
      assert.ok(mine.length >= 4, "재생목록 + 세그먼트를 받았다");
      log("제공자 호출(작업 직후):", JSON.stringify(provider.calls));
      for (const r of mine) assert.equal(r.referer, lecture.origin + "/", "확장 요청의 Referer 는 탭의 출처다: " + r.path);
      for (const r of theirs) assert.equal(r.referer, lecture.origin + "/", "페이지 자신의 요청은 건드리지 않는다(기본 Referer)");
      assert.ok(mine.some(r => r.path.endsWith(".m3u8")) && mine.some(r => r.path.endsWith(".ts")));
      assert.ok(!cdn.log.some(r => r.path.endsWith(".key")));
      const o = await obs();
      log("절전 방지:", o.awake.join(" → "), "| DNR:", JSON.stringify(o.rules));
      assert.deepEqual(o.awake, ["request:system", "release"]);
      assert.equal(o.capture, 0, "실시간 캡처는 시작되지 않았다");
      const added = o.rules.find(r => r.add.length).add[0];
      assert.deepEqual([added.id, added.domains, added.tabIds, added.referer], [900002, ["127.0.0.1"], [-1], lecture.origin + "/"]);
      assert.deepEqual(o.rules.at(-1), { remove: [900002], add: [] }, "끝나면 규칙을 제거했다");
      assert.deepEqual((await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).map(r => r.id), []);
      // 제공자 호출
      log("제공자 호출:", JSON.stringify(provider.calls));
      assert.ok(provider.calls.vision >= 3 && provider.calls.stt >= 1 && provider.calls.plan === 1 && provider.calls.section >= 1 && provider.calls.global === 1 && provider.calls.judge >= 1);
      // 저장소: 암호문뿐, Cache Storage 비어 있음
      const d = await idb(panel);
      log("IndexedDB:", JSON.stringify({ stores: d.stores, packages: d.packages.length, jobs: d.jobs.length, caches: d.caches }));
      assert.deepEqual(d.caches, []);
      assert.ok(d.packages.length > 0 && d.packages.every(r => r.keys.sort().join() === "ct,iv,meta,schemaVersion,v" && r.ct > 0 && !r.plain));
      assert.ok(d.jobs.length === 1);
      // 서버 사용량 파일에 강의 내용이 없다
      const usage = fs.readFileSync(path.join(vault, "usage.json"), "utf8");
      assert.ok(!usage.includes("슬라이드") && !usage.includes("미분"));
      // BG_LIST: 끝난 작업은 이어 할 수 없으니 보이지 않는다
      const list = await panel.evaluate(() => new Promise(r => chrome.runtime.sendMessage({ target: "background", type: "BG_LIST" }, r)));
      log("BG_LIST:", JSON.stringify(list));
      assert.deepEqual(list.jobs, []);
      await page.close(); await panel.close();
      return { cdnMine: mine.length, calls: { ...provider.calls } };
    });

    await runCase("protected", async () => {
      const { page, tabId, url: tabUrl } = await openLecture("aes");
      const panel = await openPanel(tabId);
      cdn.log.length = 0;
      const before = await obs();
      await panel.click("#bgBtn");
      await waitText(panel, /보호된 영상/);
      const s = await status(panel);
      log("패널:", JSON.stringify(s));
      assert.equal(s.text, Pipeline.CODES.SRC_PROTECTED.userMessage);
      assert.equal(s.live, true, "실시간 모드로 시작 버튼이 나온다"); assert.equal(s.retry, false);
      await new Promise(r => setTimeout(r, 3000));
      const o = await obs();
      assert.equal(o.capture, before.capture, "클릭 전에는 실시간 캡처를 시도하지 않았다");
      assert.ok(await panel.locator("#stageLive").isHidden() && await panel.locator("#stageReady").isVisible(), "화면이 실시간 모드로 넘어가지 않았다");
      assert.ok(!cdn.log.some(r => r.path.endsWith(".key")), "키 URI 는 가져오지 않는다");
      assert.ok(cdn.log.some(r => r.path.endsWith(".m3u8") && r.referer === lecture.origin + "/"), "재생목록은 가져왔다");
      assert.ok(!cdn.log.some(r => r.path.endsWith(".ts")), "세그먼트는 받지 않았다");
      assert.deepEqual(o.awake.slice(before.awake.length), ["request:system", "release"]);
      // 사용자가 누르면 그제서야 시작을 시도한다(헤드리스에서는 확장 호출 없이 tabCapture 가 거절된다 - 시도 자체가 클릭 뒤임을 본다)
      await panel.evaluate(() => { document.getElementById("modeSelect").value = "slide"; });
      await panel.click("#bgLiveBtn");
      await panel.waitForFunction(() => !document.getElementById("readyAlert").hidden || !document.getElementById("stageLive").hidden, null, { timeout: 20000 });
      const after = await obs();
      log("클릭 뒤 tabCapture 시도:", after.capture - before.capture, "| 알림:", JSON.stringify(await panel.locator("#readyAlert").textContent()));
      assert.ok(after.capture - before.capture >= 1);
      await page.close(); await panel.close();
    });

    await runCase("resume", async () => {
      const { page, tabId } = await openLecture("speech");
      const panel = await openPanel(tabId);
      cdn.expired = true; cdn.log.length = 0;
      await panel.click("#bgBtn");
      await waitText(panel, /로그인 세션이 만료/);
      let s = await status(panel);
      log("만료:", JSON.stringify(s));
      assert.equal(s.retry, true);
      const listed = await panel.evaluate(() => new Promise(r => chrome.runtime.sendMessage({ target: "background", type: "BG_LIST" }, r)));
      log("BG_LIST:", JSON.stringify(listed));
      assert.deepEqual(listed.jobs.map(j => [j.state, j.code, j.running]), [["paused", "SRC_AUTH_EXPIRED", false]]);
      assert.ok(!JSON.stringify(listed).includes("http"));
      cdn.expired = false;
      await panel.click("#bgRetryBtn"); // 같은 jobId 로 다시 찾고 다시 보낸다
      await waitText(panel, /노트 준비됨/);
      log("재개 완료:", JSON.stringify((await status(panel)).text));
      const d = await idb(panel);
      assert.ok(d.jobs.length >= 1);
      const o = await obs(); assert.equal(o.awake.at(-1), "release");
      await page.close(); await panel.close();
    });

    await runCase("cancel", async () => {
      const { page, tabId } = await openLecture("speech");
      const panel = await openPanel(tabId);
      provider.delay = 1500;
      const before = await obs();
      await panel.click("#bgBtn");
      await panel.waitForFunction(() => /처리 중/.test(document.getElementById("bgStatus").textContent) && !document.getElementById("bgCancelBtn").hidden, null, { timeout: 60000 });
      const running = await status(panel);
      log("진행:", JSON.stringify(running.text), running.progress);
      // 돌고 있는 동안 두 번째 BG_RUN 은 거절되고 첫 작업의 절전 방지는 그대로다
      const second = await panel.evaluate(tabId => new Promise(r => chrome.runtime.sendMessage({ target: "background", type: "BG_RUN", jobId: "second-job-0001", tabId, source: { playlistUrl: location.origin } }, r)), tabId);
      log("두 번째 BG_RUN:", JSON.stringify(second));
      const second2 = await panel.evaluate(tabId => new Promise(r => chrome.runtime.sendMessage({ target: "background", type: "BG_RUN", jobId: "second-job-0002", tabId, source: { playlistUrl: "http://127.0.0.1:1/other.m3u8" } }, r)), tabId);
      log("두 번째 BG_RUN(올바른 주소):", JSON.stringify(second2));
      assert.equal(second2.ok, false); assert.equal(second2.busy, true); assert.match(second2.error, /이미 백그라운드 작업이 진행 중/);
      assert.deepEqual((await obs()).awake.slice(before.awake.length), ["request:system", "request:system"], "거절된 요청이 첫 작업의 절전 방지를 풀지 않았다");
      assert.ok(!(await obs()).awake.slice(before.awake.length).includes("release"));
      await panel.click("#bgCancelBtn");
      await waitText(panel, /취소했습니다/, 60000);
      provider.delay = 0;
      const o = await obs();
      log("취소 뒤 절전 방지:", o.awake.slice(before.awake.length).join(" → "));
      assert.equal(o.awake.at(-1), "release");
      assert.deepEqual((await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).map(r => r.id), []);
      const list = await panel.evaluate(() => new Promise(r => chrome.runtime.sendMessage({ target: "background", type: "BG_LIST" }, r)));
      assert.deepEqual(list.jobs, [], "취소된 작업은 이어 할 수 없다");
      assert.equal((await obs()).capture, 1, "실시간 캡처는 protected 사례의 클릭 한 번뿐이다");
      await page.close(); await panel.close();
    });

    await runCase("paint", async () => {
      // offscreen 문서를 일반 탭으로 열어 paintMasks 를 진짜 createImageBitmap·OffscreenCanvas 로 시험한다(합성 슬라이드는 반복 워터마크가 없어 작업 중에는 칠할 일이 없다)
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/offscreen.html`);
      const r = await page.evaluate(async () => {
        const c = new OffscreenCanvas(200, 100), g = c.getContext("2d");
        g.fillStyle = "rgb(200,100,50)"; g.fillRect(0, 0, 200, 100);
        g.fillStyle = "rgb(0,0,0)"; g.fillRect(60, 30, 40, 20); // 워터마크 자리
        g.fillStyle = "rgb(10,200,10)"; g.fillRect(150, 70, 20, 20); // 상자 밖 내용
        const src = await c.convertToBlob({ type: "image/jpeg", quality: 0.95 });
        const out = await paintMasks(src, [{ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }, { x: 0.95, y: 0.9, w: 0.2, h: 0.2 }]);
        const bmp = await createImageBitmap(out), d = new OffscreenCanvas(200, 100), dg = d.getContext("2d", { willReadFrequently: true });
        dg.drawImage(bmp, 0, 0);
        const px = (x, y) => [...dg.getImageData(x, y, 1, 1).data].slice(0, 3);
        return { type: out.type, size: out.size, inBox: px(80, 40), cornerBox: px(197, 95), outside: px(160, 80), ring: px(55, 40) };
      });
      log("paint:", JSON.stringify(r));
      const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 12);
      assert.equal(r.type, "image/jpeg"); assert.ok(near(r.inBox, [200, 100, 50]), "상자가 둘레 색으로 칠해졌다"); assert.ok(near(r.cornerBox, [200, 100, 50]));
      assert.ok(near(r.outside, [10, 200, 10]), "상자 밖 내용은 그대로"); await page.close();
    });

    log("\n결과:", JSON.stringify(results));
  } finally {
    clearTimeout(deadline);
    await context.close().catch(() => {});
    for (const s of [server, lectureSrv, cdnSrv]) s?.close?.();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(0);
})().catch(e => { console.error("SMOKE FAIL", e); process.exit(1); });

