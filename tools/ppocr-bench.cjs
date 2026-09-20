// PP-OCRv5 로 슬라이드 이미지 폴더를 읽고 장당 지연·글자 수·수식 단서를 잰다.
// 사용: PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright CHROME_PATH="<chrome>" node tools/ppocr-bench.cjs <슬라이드폴더>
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const dir = path.resolve(process.argv[2] || "");
if (!fs.existsSync(dir)) { console.error("사용: node tools/ppocr-bench.cjs <슬라이드폴더>"); process.exit(1); }
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".onnx": "application/octet-stream", ".yml": "text/yaml; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const files = fs.readdirSync(dir).filter(f => [".jpg", ".jpeg"].includes(path.extname(f).toLowerCase())).sort();
if (!files.length) { console.error("jpeg 파일이 없습니다."); process.exit(1); }
const server = http.createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, "http://localhost").pathname).slice(1);
  if (name === "bench.html") { response.setHeader("content-type", "text/html; charset=utf-8"); response.end("<!doctype html><meta charset=utf-8><title>ppocr bench</title>"); return; }
  let file = path.resolve(root, name);
  if (name.startsWith("slides/")) file = path.resolve(dir, name.slice(7));
  if (!file.startsWith(root + path.sep) && !file.startsWith(dir + path.sep) || !/^(lib\/|slides\/)/.test(name) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
  response.setHeader("content-type", types[path.extname(file)] || "application/octet-stream"); fs.createReadStream(file).pipe(response);
});

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.stack || error.message));
    await page.goto(url + "/bench.html");
    const results = await page.evaluate(async files => {
      const { PpOcrV5 } = await import("/lib/ppocr-runtime.mjs");
      const engine = new PpOcrV5();
      if (engine.init) await engine.init();
      const out = [];
      for (const file of files) {
        const blob = await (await fetch("/slides/" + file)).blob();
        const image = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = image.width; canvas.height = image.height;
        canvas.getContext("2d").drawImage(image, 0, 0); image.close();
        const started = performance.now();
        try {
          const result = await engine.recognize(canvas);
          const text = result.text || "";
          out.push({ file, ms: Math.round(performance.now() - started), chars: text.length, math: /\$[^$]+\$/.test(text) || /[=∑∫^_]/.test(text), head: text.replace(/\s+/g, " ").slice(0, 80) });
        } catch (error) { out.push({ file, error: error.message }); }
      }
      await engine.dispose();
      return out;
    }, files);
    for (const row of results) console.log([row.file, row.error ? "ERROR " + row.error : row.ms + "ms", row.chars ?? "-", row.error ? "-" : row.math ? "수식단서" : "-", row.head || ""].join("\t"));
    if (errors.length) console.error("page errors:", errors);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
