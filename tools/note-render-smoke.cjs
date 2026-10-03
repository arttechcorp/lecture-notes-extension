// 노트 렌더 스모크: 진짜 Chrome + 패키지 closure 파일로 note.html의 샌드박스 렌더를 본다.
// 정식 Chrome(M137+)은 --load-extension을 거부하므로, closure를 그대로 http://localhost로 서빙한다 —
// note/library 페이지는 chrome.*를 한 줄도 쓰지 않아(IndexedDB+crypto만) 렌더 경로는 동일하다.
// Playwright 없이 DevTools 프로토콜을 직접 쓴다(Node WebSocket). 사용:
//   CHROME_PATH=<Chrome 경로> node tools/note-render-smoke.cjs
// 산출물은 /tmp/v2orch/smoke/ 아래에 둔다.
const assert = require("node:assert/strict"), http = require("node:http"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), cp = require("node:child_process");
const REPO = path.resolve(__dirname, "..");
const OUT = "/tmp/v2orch/smoke";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const NOTE = require(REPO + "/tools/note-fixture/expected-note.json");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nrsmoke-"));
const log = (...a) => console.log(...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 패키지 closure 그대로 임시 디렉터리에 펼쳐 http로 서빙한다 ──
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf" };
async function stageSite() {
  const { resolveRuntimeClosure } = await import(REPO + "/tools/package-cws.mjs");
  const { files } = resolveRuntimeClosure();
  const dir = path.join(tmp, "site");
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.copyFileSync(path.join(REPO, f), path.join(dir, f)); }
  const srv = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
    if (!p.startsWith(dir) || !fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404); return res.end("nf"); }
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => srv.listen(0, "localhost", r));
  return `http://localhost:${srv.address().port}`;
}

// ── 아주 얇은 CDP 클라이언트 ──
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pend = new Map(); this.listeners = [];
    ws.addEventListener("message", e => {
      const m = JSON.parse(e.data);
      if (m.id && this.pend.has(m.id)) { const { ok, bad } = this.pend.get(m.id); this.pend.delete(m.id); m.error ? bad(new Error(m.error.message)) : ok(m.result); }
      else for (const f of this.listeners) f(m);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((ok, bad) => this.pend.set(id, { ok, bad }));
  }
  on(fn) { this.listeners.push(fn); }
}
const evl = async (cdp, sessionId, expr) => {
  const r = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error("evaluate 실패: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
};
const until = async (fn, what, ms = 20000) => { for (const t0 = Date.now(); Date.now() - t0 < ms;) { const v = await fn(); if (v) return v; await sleep(150); } throw new Error("기다리던 일이 일어나지 않았다: " + what); };

// 1x1 빨간 PNG — cropUrls의 매직 바이트 판별을 통과한다(G2 figure가 crop 표시라 크롭이 필요하다).
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_BYTES = `new Uint8Array([${[...Buffer.from(PNG, "base64")].join(",")}])`;
const META = {
  packageId: "Lsmoke-1", title: "경영학원론(가상) 6주차 — 스모크", host: "lms.example.ac.kr", source: "background", tier: "paid",
  status: "complete", durationSec: 1260, noteSpecVersion: "lecture-note-2",
  options: { syntheticExamples: true, externalAugmentation: true, exam: false }, counts: { sections: 5, questions: 6 },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const base = await stageSite();
  const profile = path.join(tmp, "profile");
  log("[chrome]", CHROME, "| site:", base);
  const chrome = cp.spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  chrome.stderr.on("data", () => {});
  process.on("exit", () => { try { chrome.kill("SIGKILL"); } catch {} });

  // DevToolsActivePort 에 ws 주소가 생긴다.
  const portFile = path.join(profile, "DevToolsActivePort");
  await until(() => fs.existsSync(portFile) && fs.readFileSync(portFile, "utf8").trim().length > 0, "DevToolsActivePort", 15000);
  const [port, wsPath] = fs.readFileSync(portFile, "utf8").trim().split("\n");
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  const cdp = new CDP(ws);

  const attach = async url => {
    const { targetId } = await cdp.send("Target.createTarget", { url });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    return { targetId, sessionId };
  };

  // 스토어를 채운다 — 페이지 자체 스크립트(PackageStore/NoteLibrary) 그대로.
  const seed = await attach(`${base}/library.html`);
  await until(() => evl(cdp, seed.sessionId, `typeof PackageStore==='object'&&typeof NoteLibrary==='object'`).catch(() => false), "library.html 스크립트 로드");
  const seeded = await evl(cdp, seed.sessionId, `(async()=>{
    const store=await PackageStore.indexedDbAdapter().then(PackageStore.createStore);
    await NoteLibrary.saveResult(store,{packageId:${JSON.stringify(META.packageId)},meta:${JSON.stringify(META)},input:{tier:"paid",slides:[],transcript:{segments:[]}},note:${JSON.stringify(NOTE)},crops:{G2:${PNG_BYTES}}});
    return (await NoteLibrary.list(store)).map(m=>m.packageId+":"+m.status).join(",");
  })()`);
  assert.match(seeded, /Lsmoke-1:complete/, "보관함 시드 실패");
  log("[seed]", seeded);

  // note.html?id=… : 메시지 수집 훅을 문서 생성 전에 심고 열어, 샌드박스 렌더가 끝나길 기다린다.
  const notePage = await attach("about:blank");
  await cdp.send("Page.enable", {}, notePage.sessionId);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__msgs=[];window.addEventListener('message',e=>{if(e.data&&e.data.type)__msgs.push({type:e.data.type,h:e.data.height,w:e.data.warnings})});` }, notePage.sessionId);
  await cdp.send("Page.navigate", { url: `${base}/note.html?id=Lsmoke-1` }, notePage.sessionId);
  const msgs = await until(async () => {
    const m = await evl(cdp, notePage.sessionId, `window.__msgs`);
    return m && m.some(x => x.type === "RENDER_HEIGHT") && m.some(x => x.type === "RENDER_WARNINGS") ? m : null;
  }, "샌드박스 RENDER_HEIGHT/RENDER_WARNINGS");
  const warn = msgs.find(m => m.type === "RENDER_WARNINGS");
  assert.ok(warn, "RENDER_WARNINGS가 와야 한다");
  assert.deepEqual(warn.w || [], [], "렌더 경고 없이 그려져야 한다: " + JSON.stringify(warn.w));
  const height = Math.max(...msgs.filter(m => m.type === "RENDER_HEIGHT").map(m => m.h));
  assert.ok(height > 400, "렌더 높이가 나와야 한다: " + height);
  const frameH = await evl(cdp, notePage.sessionId, `document.getElementById('renderFrame').style.height`);
  log("[note.html] iframe height:", frameH, "| warnings:", JSON.stringify(warn.w));
  assert.equal(await evl(cdp, notePage.sessionId, `document.getElementById('title').textContent`), "경영학원론(가상) 6주차 — 스모크");

  // 스크린샷 1280 → 400
  for (const w of [1280, 400]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 600 }, notePage.sessionId);
    await sleep(700); // 리사이즈 → 재렌더 높이 반영
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, notePage.sessionId);
    fs.writeFileSync(path.join(OUT, `note-${w}.png`), Buffer.from(shot.data, "base64"));
    log("[shot]", `note-${w}.png`);
  }

  // sandbox.html 을 최상위로 열어 렌더 결과 DOM을 직접 검사한다(섹션 제목·경고).
  const sand = await attach("about:blank");
  await cdp.send("Page.enable", {}, sand.sessionId);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__msgs=[];window.addEventListener('message',e=>{if(e.data&&e.data.type)__msgs.push({type:e.data.type,w:e.data.warnings})});` }, sand.sessionId);
  await cdp.send("Page.navigate", { url: `${base}/sandbox.html` }, sand.sessionId);
  await evl(cdp, sand.sessionId, `window.postMessage({type:'RENDER_NOTE',note:${JSON.stringify(NOTE)},crops:{},options:{}},'*');'sent'`);
  const sandMsgs = await until(async () => {
    const m = await evl(cdp, sand.sessionId, `window.__msgs`);
    return m && m.some(x => x.type === "RENDER_WARNINGS") ? m : null;
  }, "샌드박스 자체 렌더");
  const sandWarn = sandMsgs.find(m => m.type === "RENDER_WARNINGS");
  assert.deepEqual(sandWarn.w || [], [], "샌드박스 렌더 경고: " + JSON.stringify(sandWarn.w));
  const bodyText = await evl(cdp, sand.sessionId, `document.body.innerText`);
  for (const t of ["원가는 생산량에 어떻게 반응하는가", "몇 개를 팔아야 손실을 면하는가", "기업의 경계를 두 관점은 어떻게 설명하는가"])
    assert.ok(bodyText.includes(t), "섹션 제목이 보여야 한다: " + t);
  log("[sandbox] section titles visible, warnings:", JSON.stringify(sandWarn.w));

  // 인쇄 매체로 다시 렌더한 뒤 PDF — NoteRender를 페이지 안에서 직접 부른다.
  await evl(cdp, sand.sessionId, `(async()=>{
    const {html}=NoteRender.renderNote(${JSON.stringify(NOTE)},{katex,crops:{},options:{medium:'print'}});
    document.getElementById('content').innerHTML=html;
    await document.fonts.ready;
    await Promise.all([...document.querySelectorAll('img')].map(i=>i.decode().catch(()=>{})));
    return html.length;})()`);
  const pdf = await cdp.send("Page.printToPDF", { landscape: false, printBackground: true }, sand.sessionId);
  fs.writeFileSync(path.join(OUT, "note-print.pdf"), Buffer.from(pdf.data, "base64"));
  log("[pdf]", "note-print.pdf", fs.statSync(path.join(OUT, "note-print.pdf")).size, "bytes");

  console.log(`\n✅ note-render smoke OK — 산출물: ${OUT}/note-1280.png, note-400.png, note-print.pdf`);
  ws.close(); chrome.kill("SIGKILL");
  process.exit(0);
})().catch(e => { console.error("❌", e); process.exit(1); });
