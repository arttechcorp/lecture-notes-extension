const http = require("node:http"), fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const server = http.createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, "http://localhost").pathname).slice(1), file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep) || !/^(lib\/vendor\/transformers4\/|tools\/whisper-webgpu-probe\.)/.test(name) || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
  response.setHeader("content-type", /\.m?js$/.test(name) ? "text/javascript" : name.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream"); fs.createReadStream(file).pipe(response);
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  try {
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.stack || error.message));
    page.on("requestfailed", request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    await page.goto(`http://127.0.0.1:${server.address().port}/tools/whisper-webgpu-probe.html`);
    try { await page.waitForFunction(() => globalThis.probeResult, null, { timeout: 60000 }); }
    catch (error) { throw new Error(`${error.message}\n${errors.join("\n")}\n${await page.locator("#result").textContent()}`); }
    const result = await page.evaluate(() => globalThis.probeResult); assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.maxBufferSize >= 268435456, JSON.stringify(result));
    console.log("PASS Transformers.js 4 WebGPU runtime probe", JSON.stringify(result));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
