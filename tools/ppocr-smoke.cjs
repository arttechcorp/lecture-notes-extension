const http = require("node:http"), fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".onnx": "application/octet-stream", ".yml": "text/yaml; charset=utf-8" };
const server = http.createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, "http://localhost").pathname).slice(1), file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep) || !/^(lib\/|tools\/ppocr-probe\.)/.test(name) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
  response.setHeader("content-type", types[path.extname(file)] || "application/octet-stream"); fs.createReadStream(file).pipe(response);
});

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  try {
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.stack || error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/tools/ppocr-probe.html`);
    await page.waitForFunction(() => globalThis.probeResult, null, { timeout: 120000 });
    const result = await page.evaluate(() => globalThis.probeResult);
    assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(errors, []);
    assert.ok(result.direct.text.includes("123456"), JSON.stringify(result));
    assert.ok(result.boxes > 0, JSON.stringify(result));
    assert.ok(result.fullText.includes("Voltage"), JSON.stringify(result));
    console.log("PASS PP-OCRv5 Korean mobile ONNX on ORT WASM", JSON.stringify(result));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
