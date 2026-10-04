// Replays the product's local screen path on given images:
// frame canvas -> JPEG q.9 blob (session.js) -> createImageBitmap -> PpOcrV5.recognize -> layoutText (session.js createOcrEngine)
import { createServer } from 'node:http';
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Usage: node tools/visual-ocr-replay.mjs <image...> <out.json>
// Needs the playwright package (global install is fine) or CHROME_PATH. Inputs and output stay outside the repo:
// real lecture captures are not committed.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const images = process.argv.slice(2, -1), out = process.argv.at(-1);
const mime = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.webp': 'image/webp', '.yml': 'text/plain' };
const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><meta charset=utf-8>');
  const m = p.match(/^\/input\/(\d+)$/);
  const file = m ? images[+m[1]] : path.join(root, p);
  if (!file || !existsSync(file) || (!m && !p.startsWith('/lib/'))) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
const result = await page.evaluate(async count => {
  const { PpOcrV5 } = await import('/lib/ppocr-runtime.mjs'); await import('/lib/layout.js');
  const engine = new PpOcrV5(); const t = performance.now(); await engine.init(); const initMs = performance.now() - t;
  const cases = [];
  for (let i = 0; i < count; i++) {
    const src = await createImageBitmap(await (await fetch(`/input/${i}`)).blob());
    const canvas = new OffscreenCanvas(src.width, src.height); canvas.getContext('2d').drawImage(src, 0, 0); src.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: .9 });
    const image = await createImageBitmap(blob); const s = performance.now();
    const r = await engine.recognize(image);
    const scores = r.lines.map(l => l.confidence).filter(Number.isFinite);
    cases.push({ width: image.width, height: image.height, recognizeMs: performance.now() - s, text: layoutText(r.lines, image.width, image.height),
      confidence: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0, lines: r.lines.map(l => ({ text: l.text, confidence: +l.confidence.toFixed(2), box: l.box })) });
    image.close();
  }
  return { initMs, cases };
}, images.length);
await browser.close(); server.close();
result.cases.forEach((c, i) => c.image = path.relative(path.dirname(path.resolve(out)), path.resolve(images[i])));
await fs.writeFile(out, JSON.stringify(result, null, 2));
for (const c of result.cases) console.log(`--- ${c.image} ${c.width}x${c.height} ${Math.round(c.recognizeMs)}ms lines=${c.lines.length} meanConf=${c.confidence.toFixed(2)}\n${c.text}`);
