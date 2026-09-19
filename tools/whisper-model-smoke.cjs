const http = require("node:http"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const server = http.createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, "http://localhost").pathname).slice(1), file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep) || !/^(lib\/vendor\/transformers4\/|tools\/whisper-model-probe\.)/.test(name) || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
  response.setHeader("content-type", /\.m?js$/.test(name) ? "text/javascript" : name.endsWith(".html") ? "text/html; charset=utf-8" : name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream"); fs.createReadStream(file).pipe(response);
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launchPersistentContext(path.join(os.tmpdir(), "summrizei-whisper-probe-cache"), { headless: true, executablePath: process.env.CHROME_PATH });
  try {
    const page = browser.pages()[0] || await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.stack || error.message));
    page.on("console", message => message.type() === "error" && errors.push(message.text()));
    await page.goto(`http://127.0.0.1:${server.address().port}/tools/whisper-model-probe.html`);
    await page.waitForFunction(() => globalThis.probeResult, null, { timeout: 600000 });
    const result = await page.evaluate(() => globalThis.probeResult);
    assert.equal(result.ok, true, `${JSON.stringify(result)}\n${errors.join("\n")}`);
    console.log("PASS Whisper small q8/q4 WebGPU load and silent inference", JSON.stringify(result));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
