// Prototype: separate printed text / non-text printed ink (figure candidates) / colored handwriting using
// pixels + the OCR boxes the product already has. No new model.
import { createServer } from 'node:http';
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Usage: node tools/visual-region-probe.mjs <ocr-replay.json> <outDir> [truth.json]
// truth.json: per image, one label (text|figure|hand) per OCR line. Thresholds were set on three slides only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const [ocrPath, S, truthPath] = process.argv.slice(2);
const ocr = JSON.parse(await fs.readFile(ocrPath, 'utf8'));
const images = ocr.cases.map(c => path.resolve(path.dirname(ocrPath), c.image));
const server = createServer((req, res) => {
  const m = new URL(req.url, 'http://x').pathname.match(/^\/input\/(\d+)$/);
  if (!m) return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html>');
  res.writeHead(200); createReadStream(images[+m[1]]).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
const out = await page.evaluate(async cases => {
  const results = [];
  for (let i = 0; i < cases.length; i++) {
    const bmp = await createImageBitmap(await (await fetch(`/input/${i}`)).blob());
    const W = bmp.width, H = bmp.height, cv = new OffscreenCanvas(W, H), cx = cv.getContext('2d');
    cx.drawImage(bmp, 0, 0); const d = cx.getImageData(0, 0, W, H).data;
    const CELL = 6, GW = Math.ceil(W / CELL), GH = Math.ceil(H / CELL);
    const ink = new Uint16Array(GW * GH), red = new Uint16Array(GW * GH), inText = new Uint8Array(GW * GH);
    const boxes = cases[i].lines.map(l => l.box);
    for (const b of boxes) for (let y = Math.floor(b.y / CELL); y <= Math.min(GH - 1, Math.floor((b.y + b.height) / CELL)); y++) for (let x = Math.floor(b.x / CELL); x <= Math.min(GW - 1, Math.floor((b.x + b.width) / CELL)); x++) inText[y * GW + x] = 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4, r = d[k], g = d[k + 1], b = d[k + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const c = Math.floor(y / CELL) * GW + Math.floor(x / CELL);
      if (mx - mn > 70 && r > 140 && r - g > 50 && r - b > 50) red[c]++;               // saturated red ink = annotation layer
      else if (mx < 150 && mx - mn < 40) ink[c]++;                                    // dark neutral ink = printed
    }
    const comp = (mask) => {   // 8-connected components over cells, with 1-cell dilation tolerance
      const seen = new Uint8Array(GW * GH), comps = [];
      for (let s = 0; s < mask.length; s++) {
        if (!mask[s] || seen[s]) continue; const q = [s]; seen[s] = 1; let x0 = GW, y0 = GH, x1 = 0, y1 = 0, n = 0;
        while (q.length) { const c = q.pop(), x = c % GW, y = (c / GW) | 0; n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= GW || Y >= GH) continue; const t = Y * GW + X; if (mask[t] && !seen[t]) { seen[t] = 1; q.push(t); } } }
        comps.push({ x: x0 * CELL, y: y0 * CELL, w: (x1 - x0 + 1) * CELL, h: (y1 - y0 + 1) * CELL, cells: n });
      }
      return comps;
    };
    const outside = ink.map((v, c) => v >= 3 && !inText[c] ? 1 : 0);
    const hand = red.map(v => v >= 3 ? 1 : 0);
    // merge printed non-text ink fragments that sit within 40px, keep regions with real mass
    let figure = comp(outside).filter(c => c.cells >= 10);
    for (let merged = true; merged;) { merged = false;
      for (let a = 0; a < figure.length && !merged; a++) for (let b = a + 1; b < figure.length && !merged; b++) {
        const A = figure[a], B = figure[b], g = 40;
        if (A.x - g < B.x + B.w && B.x - g < A.x + A.w && A.y - g < B.y + B.h && B.y - g < A.y + A.h) {
          const x = Math.min(A.x, B.x), y = Math.min(A.y, B.y);
          figure[a] = { x, y, w: Math.max(A.x + A.w, B.x + B.w) - x, h: Math.max(A.y + A.h, B.y + B.h) - y, cells: A.cells + B.cells };
          figure.splice(b, 1); merged = true; } } }
    figure = figure.filter(c => c.cells >= 60);
    // per OCR line: share of red ink among its inked cells; inside an expanded figure region => figure label
    const lineClass = boxes.map(b => {
      let r = 0, k = 0;
      for (let y = Math.floor(b.y / CELL); y <= Math.min(GH - 1, Math.floor((b.y + b.height) / CELL)); y++) for (let x = Math.floor(b.x / CELL); x <= Math.min(GW - 1, Math.floor((b.x + b.width) / CELL)); x++) { const c = y * GW + x; if (red[c] >= 3) r++; if (red[c] >= 3 || ink[c] >= 3) k++; }
      if (k && r / k > .5) return 'hand';
      const e = 80;
      return figure.some(f => b.x < f.x + f.w + e && f.x - e < b.x + b.width && b.y < f.y + f.h + e && f.y - e < b.y + b.height) ? 'figure' : 'text';
    });
    const handwriting = comp(hand).filter(c => c.cells >= 6);
    // overlay for visual check
    cx.lineWidth = 3;
    cx.strokeStyle = '#0a0'; for (const b of boxes) cx.strokeRect(b.x, b.y, b.width, b.height);
    cx.strokeStyle = '#00f'; for (const b of figure) cx.strokeRect(b.x, b.y, b.w, b.h);
    cx.strokeStyle = '#f0f'; cx.setLineDash([8, 6]); for (const b of handwriting) cx.strokeRect(b.x, b.y, b.w, b.h);
    const png = await cv.convertToBlob({ type: 'image/png' }); const buf = new Uint8Array(await png.arrayBuffer());
    let bin = ''; for (let k = 0; k < buf.length; k += 8192) bin += String.fromCharCode(...buf.subarray(k, k + 8192));
    results.push({ W, H, figure, handwriting, lineClass, overlay: btoa(bin) });
  }
  return results;
}, ocr.cases);
await browser.close(); server.close();
const truth = truthPath ? JSON.parse(await fs.readFile(truthPath, 'utf8')) : null;
const tally = {};
if (truth) out.forEach((r, i) => r.lineClass.forEach((p, j) => { const t = truth[i][j], key = t + '->' + p; tally[key] = (tally[key] || 0) + 1;
  if (t !== p) console.log('  miss', ocr.cases[i].image, j, JSON.stringify(ocr.cases[i].lines[j].text), 'truth', t, 'pred', p); }));
if (truth) console.log('confusion', JSON.stringify(tally));
for (const [i, r] of out.entries()) {
  await fs.writeFile(path.join(S, `overlay-${i + 1}.png`), Buffer.from(r.overlay, 'base64'));
  console.log(`=== ${ocr.cases[i].image}: figure-candidates=${r.figure.length} handwriting-components=${r.handwriting.length}`);
  for (const f of r.figure) console.log('  fig', JSON.stringify({ x: f.x, y: f.y, w: f.w, h: f.h, cells: f.cells }));
  console.log('  hand', r.handwriting.map(h => `${h.x},${h.y} ${h.w}x${h.h}`).join(' | '));
}
