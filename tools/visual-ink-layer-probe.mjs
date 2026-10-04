// Prototype: separate a slide's handwriting layer in time. The first frame of a slide is the base; pixels that differ from it
// in two consecutive frames are the annotation layer. Measured on synthetic sequences (f0 clean, f1 ellipse, f2 scribble+underline,
// f3 printed build-animation text, f4 arrow, f5 same as f4 with the pen parked) that go through video-like JPEG degradation.
import { createServer } from 'node:http';
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Usage: node tools/visual-ink-layer-probe.mjs <outDir> [base.png ...]   (bases: 800x600 clean slides; unknown names reuse the three-column placement)
// Needs playwright (PLAYWRIGHT_MODULE) and optionally CHROME_PATH. Writes ink-layer-report.json, <base>-f5.png, <base>-overlay.png.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [S, ...rest] = process.argv.slice(2);
const bases = (rest.length ? rest : ['three-column-text', 'linear-function-graph', 'quadratic-formula'].map(n => `eval/visual/previews/${n}.png`)).map(p => path.resolve(p));
const CFG = { CELL: 4, DIFF: 50, MINPX: 2, MINCELLS: 4, GAP: 1, PAD: 8, OCR_CONF: .9, DARK_RATIO: .7, DARK_MAX: 150, NEUTRAL_SPREAD: 40, VIDEO_Q: .55, CAPTURE_Q: .9, BRIGHT: 2 };
// circle [cx,cy,rx,ry]; scribble/under [x0,x1,y]; anim [x,baselineY]; pen3 = pen tip while the text builds; arrow [x0,y0,x1,y1]
const PLACE = {
  'three-column-text': { circle: [130, 228, 78, 22], scribble: [60, 220, 362], under: [77, 195, 426], anim: [80, 520], pen3: [380, 505], arrow: [540, 500, 700, 460] },
  'linear-function-graph': { circle: [407, 205, 52, 34], scribble: [585, 710, 108], under: [440, 505, 335], anim: [170, 100], pen3: [430, 100], arrow: [630, 410, 730, 350] },
  'quadratic-formula': { circle: [495, 347, 58, 34], scribble: [270, 520, 262], under: [75, 235, 352], anim: [80, 480], pen3: [380, 470], arrow: [520, 500, 700, 440] },
};
const mime = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.yml': 'text/plain' };
const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname, m = p.match(/^\/input\/(\d+)$/), file = m ? bases[+m[1]] : path.join(root, p);
  if (p === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><meta charset=utf-8>');
  if (!file || !existsSync(file) || (!m && !p.startsWith('/lib/'))) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
const names = bases.map(b => path.basename(b, '.png'));
const out = await page.evaluate(async ({ names, CFG, PLACE }) => {
  const { PpOcrV5 } = await import('/lib/ppocr-runtime.mjs'); await import('/lib/layout.js');
  const engine = new PpOcrV5(); await engine.init();
  const { CELL, DIFF, MINPX, MINCELLS, GAP, PAD } = CFG;
  const prng = s => () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const b64 = async cv => { const u = new Uint8Array(await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = ''; for (let k = 0; k < u.length; k += 8192) s += String.fromCharCode(...u.subarray(k, k + 8192)); return btoa(s); };
  const lev = (a, b) => { let p = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { const q = [i]; for (let j = 1; j <= b.length; j++) q[j] = Math.min(p[j] + 1, q[j - 1] + 1, p[j - 1] + (a[i - 1] !== b[j - 1])); p = q; } return p[b.length]; };
  const sim = (a, b) => { a = a.replace(/\s/g, ''); b = b.replace(/\s/g, ''); return 1 - lev(a, b) / Math.max(1, a.length, b.length); };
  // wobbly polyline: resample every 5px and add a low-frequency perpendicular wobble plus jitter
  const wob = (rng, pts, amp) => { const o = [], ph = rng() * 6.28, f = .05 + rng() * .03; let L = 0;
    for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], d = Math.hypot(x1 - x0, y1 - y0) || 1, m = Math.max(1, Math.round(d / 5));
      for (let j = 0; j < m; j++) { const t = j / m, w = amp * Math.sin(f * (L + t * d) + ph) + (rng() - .5) * amp * .5; o.push([x0 + (x1 - x0) * t - (y1 - y0) / d * w, y0 + (y1 - y0) * t + (x1 - x0) / d * w]); } L += d; }
    o.push(pts.at(-1)); return o; };
  const geom = (c, rng) => {
    const [cx, cy, rx, ry] = c.circle, ell = Array.from({ length: 64 }, (_, i) => { const a = -2 + i / 58 * Math.PI * 2.1, k = 1 + .05 * Math.sin(3 * a + 1) + (rng() - .5) * .05 + i * .0006; return [cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)]; });
    const [sx0, sx1, sy] = c.scribble, scr = wob(rng, Array.from({ length: 7 }, (_, i) => [sx0 + (sx1 - sx0) * i / 6, sy + (i % 2 ? 13 : -13)]), 2);
    const [ux0, ux1, uy] = c.under, und = wob(rng, [[ux0, uy], [ux1, uy + 3]], 1.5);
    const [ax0, ay0, ax1, ay1] = c.arrow, shaft = wob(rng, [[ax0, ay0], [ax1, ay1]], 3), g = Math.atan2(ay1 - ay0, ax1 - ax0);
    const head = [2.6, -2.6].map(d => [[ax1, ay1], [ax1 + 24 * Math.cos(g + d), ay1 + 24 * Math.sin(g + d)]]);
    return { ink: [[[ell], '#e01010', 4], [[scr], '#111', 3], [[und], '#111', 3], [[shaft, ...head], '#1030e0', 4]], pens: [ell.at(-1), und.at(-1), c.pen3, [ax1, ay1], null], anim: c.anim };
  };
  const FR = [[0, 0], [1, 1], [3, 2], [3, 3, 1], [4, 4, 1], [4, 5, 1]]; // [ink strokes drawn, pen index + 1, printed text drawn]
  const render = (cx, G, t, parts, W, H) => { const [ni, pi, an] = FR[t]; cx.lineCap = cx.lineJoin = 'round';
    if (parts.includes('i')) for (const [paths, col, w] of G.ink.slice(0, ni)) { cx.strokeStyle = col; cx.lineWidth = w; for (const p of paths) { cx.beginPath(); p.forEach(([x, y], i) => i ? cx.lineTo(x, y) : cx.moveTo(x, y)); cx.stroke(); } }
    if (parts.includes('a') && an) { cx.font = '26px "DejaVu Sans"'; cx.fillStyle = '#000'; cx.fillText('Note: added bullet', ...G.anim); }
    if (parts.includes('c') && pi) { const [x, y] = G.pens[pi - 1] || [W - 100, H - 20]; cx.save(); cx.translate(x, y); cx.rotate(-.6); cx.fillStyle = '#333'; cx.fillRect(8, -5, 60, 10); cx.fillStyle = '#999'; cx.fillRect(0, -4, 8, 8); cx.restore(); } };
  const cellsOf = (m, W, H) => { const GW = Math.ceil(W / CELL), n = new Uint16Array(GW * Math.ceil(H / CELL)); for (let i = 0; i < m.length; i++) if (m[i]) n[((i / W | 0) / CELL | 0) * GW + (i % W / CELL | 0)]++; return n.map(v => v >= MINPX ? 1 : 0); };
  const diff = (b, c) => { const m = new Uint8Array(b.length / 4); for (let i = 0, k = 0; i < m.length; i++, k += 4)
    m[i] = Math.abs((3 * (c[k] - b[k]) + 6 * (c[k + 1] - b[k + 1]) + c[k + 2] - b[k + 2]) / 10) > DIFF || Math.abs(c[k] - c[k + 1] - b[k] + b[k + 1]) > DIFF || Math.abs(c[k + 2] - c[k + 1] - b[k + 2] + b[k + 1]) > DIFF ? 1 : 0; return m; };
  const comps = (mask, GW, GH) => { const seen = new Uint8Array(mask.length), label = new Int16Array(mask.length).fill(-1), list = [], R = GAP + 1;  // 8-connected, tolerates a 1-cell gap
    for (let s = 0; s < mask.length; s++) { if (!mask[s] || seen[s]) continue; const q = [s], cells = []; seen[s] = 1; let x0 = GW, y0 = GH, x1 = 0, y1 = 0;
      while (q.length) { const c = q.pop(), x = c % GW, y = c / GW | 0; cells.push(c); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const X = x + dx, Y = y + dy, t = Y * GW + X; if (X >= 0 && Y >= 0 && X < GW && Y < GH && mask[t] && !seen[t]) { seen[t] = 1; q.push(t); } } }
      if (cells.length >= MINCELLS) { cells.forEach(c => label[c] = list.length); list.push({ id: list.length, cells, x0, y0, x1, y1 }); } }
    return { list, label }; };
  const maskOf = (cs, n) => { const m = new Uint8Array(n); cs.forEach(c => c.cells.forEach(i => m[i] = 1)); return m; };
  const score = (ann, g, prev, GW) => { const r = { tp: 0, fp: 0, fn: 0, cursorFp: 0, fpFar: 0, oldTp: 0, oldFn: 0 }, near = c => [-GW - 1, -GW, -GW + 1, -1, 1, GW - 1, GW, GW + 1].some(d => g.ink[c + d]);   // fpFar: FP with no GT ink next to it (not boundary halo)
    for (let c = 0; c < ann.length; c++) { if (g.anim[c]) continue; const a = ann[c]; if (a) g.ink[c] ? r.tp++ : (r.fp++, g.cur[c] && r.cursorFp++, near(c) || r.fpFar++); else if (g.ink[c]) r.fn++; if (prev[c]) a ? r.oldTp++ : r.oldFn++; } return r; };
  const classify = async (cur, ch, label, k, W, H, GW) => {
    const x0 = Math.max(0, k.x0 * CELL - PAD), y0 = Math.max(0, k.y0 * CELL - PAD), x1 = Math.min(W, (k.x1 + 1) * CELL + PAD), y1 = Math.min(H, (k.y1 + 1) * CELL + PAD);
    const id = new ImageData(x1 - x0, y1 - y0), d = id.data; d.fill(255); let n = 0, dark = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * W + x; if (!ch[i] || label[(y / CELL | 0) * GW + (x / CELL | 0)] !== k.id) continue;
      const s = i * 4, o = ((y - y0) * (x1 - x0) + x - x0) * 4, mx = Math.max(cur[s], cur[s + 1], cur[s + 2]), mn = Math.min(cur[s], cur[s + 1], cur[s + 2]);
      d[o] = cur[s]; d[o + 1] = cur[s + 1]; d[o + 2] = cur[s + 2]; n++; if (mx < CFG.DARK_MAX && mx - mn < CFG.NEUTRAL_SPREAD) dark++; }
    const cv = new OffscreenCanvas(id.width, id.height); cv.getContext('2d').putImageData(id, 0, 0);
    const r = await engine.recognize(cv), text = r.lines.map(l => l.text).join(' ').trim(), conf = r.lines.length ? r.lines.reduce((a, l) => a + l.confidence, 0) / r.lines.length : 0, darkRatio = n ? dark / n : 0;
    return { text, conf: +conf.toFixed(3), darkRatio: +darkRatio.toFixed(3), label: text && conf >= CFG.OCR_CONF && darkRatio >= CFG.DARK_RATIO ? 'printed-addition' : 'annotation' };
  };
  const results = [];
  for (const [bi, name] of names.entries()) {
    const src = await createImageBitmap(await (await fetch(`/input/${bi}`)).blob()), W = src.width, H = src.height, GW = Math.ceil(W / CELL), GH = Math.ceil(H / CELL);
    const G = geom(PLACE[name] || PLACE['three-column-text'], prng(1000 + bi)), rng = prng(2000 + bi), px = cv => cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const mk = () => new OffscreenCanvas(W, H), jpg = (cv, q) => cv.convertToBlob({ type: 'image/jpeg', quality: q });
    const degrade = async cv => {   // video encode -> global brightness offset -> product capture (jpeg q.9 -> createImageBitmap)
      const c2 = mk(), x2 = c2.getContext('2d', { willReadFrequently: true }); x2.drawImage(await createImageBitmap(await jpg(cv, CFG.VIDEO_Q)), 0, 0);
      const id = x2.getImageData(0, 0, W, H), off = Math.floor(rng() * (2 * CFG.BRIGHT + 1)) - CFG.BRIGHT; for (let i = 0; i < id.data.length; i += 4) for (let k = 0; k < 3; k++) id.data[i + k] += off;
      x2.putImageData(id, 0, 0); const blob = await jpg(c2, CFG.CAPTURE_Q), bmp = await createImageBitmap(blob), c3 = mk(); c3.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
      return { bmp, d: px(c3), bytes: blob.size, off }; };
    const compose = (t, parts) => { const cv = mk(), cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(src, 0, 0); render(cx, G, t, parts, W, H); return cv; };
    const gtOf = (t, parts) => { const cv = mk(), cx = cv.getContext('2d', { willReadFrequently: true }); render(cx, G, t, parts, W, H); const d = px(cv), m = new Uint8Array(W * H); for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] >= 128 ? 1 : 0; return cellsOf(m, W, H); };
    const F = [], gt = [];
    for (let t = 0; t < FR.length; t++) { F.push(await degrade(compose(t, 'iac'))); gt.push({ ink: gtOf(t, 'i'), cur: gtOf(t, 'c'), anim: gtOf(t, 'a') }); }
    const ref = await degrade(compose(3, 'a'));   // control: clean base + printed addition only (no ink, no pen)
    const N = GW * GH, base = F[0].d, ch = [], cc = [], found = { nop: [], per: [] }, ms = [], frames = { noPersist: [], persist: [] };
    for (let t = 1; t < FR.length; t++) {
      const s = performance.now(); ch[t] = diff(base, F[t].d); cc[t] = cellsOf(ch[t], W, H);
      found.nop[t] = comps(cc[t], GW, GH); if (t >= 2) found.per[t] = comps(cc[t].map((v, i) => v & cc[t - 1][i]), GW, GH); ms.push(performance.now() - s);
      const prev = t > 1 ? gt[t - 1].ink : new Uint8Array(gt[t].ink.length);
      frames.noPersist.push(score(maskOf(found.nop[t].list, N), gt[t], prev, GW)); frames.persist.push(t >= 2 ? score(maskOf(found.per[t].list, N), gt[t], prev, GW) : null);
    }
    const final = {}, T = FR.length - 1, f4b = await degrade(compose(4, 'iac'));   // f4 captured again with the pen parked: a stationary pen is 'persistent'
    const stationaryPen = score(maskOf(comps(cellsOf(diff(base, f4b.d), W, H).map((v, i) => v & cc[4][i]), GW, GH).list, N), gt[4], gt[3].ink, GW);
    for (const [v, f] of [['noPersist', found.nop[T]], ['persist', found.per[T]]]) {
      const cs = []; for (const k of f.list) { const ov = g => k.cells.filter(c => g[c]).length / k.cells.length;
        cs.push({ bbox: [k.x0 * CELL, k.y0 * CELL, (k.x1 - k.x0 + 1) * CELL, (k.y1 - k.y0 + 1) * CELL], cells: k.cells.length, animOverlap: +ov(gt[T].anim).toFixed(2), inkOverlap: +ov(gt[T].ink).toFixed(2), cursorOverlap: +ov(gt[T].cur).toFixed(2), ...await classify(F[T].d, ch[T], f.label, k, W, H, GW) }); }
      const ann = maskOf(f.list.filter((k, i) => cs[i].label === 'annotation'), N), animC = cs.filter(c => c.animOverlap > .5);
      final[v] = { components: cs, ...score(ann, gt[T], gt[T - 1].ink, GW), ann, animation: { found: animC.length > 0, printed: animC.length > 0 && animC.every(c => c.label === 'printed-addition'), handwritingAsPrinted: cs.filter(c => c.label === 'printed-addition' && c.inkOverlap > .5).length } };
    }
    const dk = new Uint8Array(W * H); for (let i = 0; i < dk.length; i++) dk[i] = (3 * base[i * 4] + 6 * base[i * 4 + 1] + base[i * 4 + 2]) / 10 < 100 ? 1 : 0; const dc = cellsOf(dk, W, H);
    const ocr = async bmp => { const r = await engine.recognize(bmp); return layoutText(r.lines, bmp.width, bmp.height); }, o0 = await ocr(F[0].bmp), o5 = await ocr(F[T].bmp), oRef = await ocr(ref.bmp);
    const ov = mk(), ox = ov.getContext('2d'), fill = (m, col) => { ox.fillStyle = col; m.forEach((v, c) => v && ox.fillRect(c % GW * CELL, (c / GW | 0) * CELL, CELL, CELL)); };
    ox.drawImage(F[T].bmp, 0, 0); fill(final.noPersist.ann.map((v, c) => v && !final.persist.ann[c] ? 1 : 0), 'rgba(0,190,255,.5)'); fill(final.persist.ann, 'rgba(255,0,255,.55)');
    ox.lineWidth = 3; ox.strokeStyle = '#0a0'; final.persist.components.forEach(c => c.label === 'printed-addition' && ox.strokeRect(...c.bbox));
    const cur = gt[T].cur.reduce((a, v, c) => v ? [Math.min(a[0], c % GW), Math.min(a[1], c / GW | 0), Math.max(a[2], c % GW), Math.max(a[3], c / GW | 0)] : a, [GW, GH, 0, 0]);
    ox.strokeStyle = '#f80'; ox.strokeRect(cur[0] * CELL, cur[1] * CELL, (cur[2] - cur[0] + 1) * CELL, (cur[3] - cur[1] + 1) * CELL);
    const raw = mk(); raw.getContext('2d').drawImage(F[T].bmp, 0, 0);
    for (const v of Object.values(final)) delete v.ann;
    results.push({ name, W, H, jpegBytesF5: F[T].bytes, brightness: F.map(f => f.off), diffMsPerFrame: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2), frames, final, stationaryPen,
      inkOnDarkBase: +(gt[T].ink.reduce((a, v, c) => a + (v && dc[c]), 0) / gt[T].ink.reduce((a, v) => a + v, 0)).toFixed(3),
      ocr: { f0: o0, f5: o5, f3PrintedOnly: oRef, simF5vsF0: +sim(o5, o0).toFixed(3), simF5vsPrintedOnly: +sim(o5, oRef).toFixed(3), simPrintedOnlyVsF0: +sim(oRef, o0).toFixed(3) }, overlay: await b64(ov), f5: await b64(raw) });
  }
  await engine.dispose(); return results;
}, { names, CFG, PLACE });
await browser.close(); server.close();
await fs.mkdir(S, { recursive: true });
for (const r of out) { await fs.writeFile(path.join(S, `${r.name}-overlay.png`), Buffer.from(r.overlay, 'base64')); await fs.writeFile(path.join(S, `${r.name}-f5.png`), Buffer.from(r.f5, 'base64')); delete r.overlay; delete r.f5; }
const P = r => r.tp + r.fp ? r.tp / (r.tp + r.fp) : null, R = r => r.tp + r.fn ? r.tp / (r.tp + r.fn) : null, Ro = r => r.oldTp + r.oldFn ? r.oldTp / (r.oldTp + r.oldFn) : null, f2 = x => x == null ? '-' : x.toFixed(2);
const sum = rs => rs.reduce((a, r) => { for (const k in r) a[k] = (a[k] || 0) + r[k]; return a; }, {});   // micro-average: pool counts across bases
const mean = xs => +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3);
const agg = { frames: { noPersist: [0, 1, 2, 3, 4].map(i => sum(out.map(r => r.frames.noPersist[i]))), persist: [null, ...[1, 2, 3, 4].map(i => sum(out.map(r => r.frames.persist[i])))] },
  final: Object.fromEntries(['noPersist', 'persist'].map(v => [v, sum(out.map(r => { const { components, animation, ...c } = r.final[v]; return c; }))])), stationaryPen: sum(out.map(r => r.stationaryPen)),
  meanDiffMs: mean(out.map(r => r.diffMsPerFrame)), meanSimF5vsF0: mean(out.map(r => r.ocr.simF5vsF0)), meanSimF5vsPrintedOnly: mean(out.map(r => r.ocr.simF5vsPrintedOnly)) };
await fs.writeFile(path.join(S, 'ink-layer-report.json'), JSON.stringify({ config: CFG, placements: PLACE, bases: out, aggregate: agg }, null, 2));
const cell = (r, v) => r ? `${f2(P(r))}/${f2(R(r))}${v === 'persist' ? ` (${f2(Ro(r))})` : ''}` : '-';   // persist: P/R (recall vs ink that is >= 1 frame old)
const rows = [];
for (const v of ['noPersist', 'persist']) for (const [name, fr, fin] of [...out.map(r => [r.name, r.frames[v], r.final[v]]), ['AGGREGATE', agg.frames[v], agg.final[v]]])
  rows.push({ base: name, variant: v, ...Object.fromEntries(fr.map((r, i) => [`f${i + 1} P/R`, cell(r, v)])), 'final P/R': cell(fin, v), 'final FP/far': `${fin.fp}/${fin.fpFar}`, 'cursorFP f1-5': fr.reduce((a, x) => a + (x?.cursorFp || 0), 0), 'cursorFP final': fin.cursorFp });
console.table(rows);
console.table(out.map(r => ({ base: r.name, size: `${r.W}x${r.H}`, 'f5 jpeg KB': +(r.jpegBytesF5 / 1024).toFixed(0), 'diff ms/frame': r.diffMsPerFrame, inkOnDarkBase: r.inkOnDarkBase, 'stationary-pen cursorFP': r.stationaryPen.cursorFp,
  'anim comps printed/found (persist)': `${r.final.persist.components.filter(c => c.animOverlap > .5 && c.label === 'printed-addition').length}/${r.final.persist.components.filter(c => c.animOverlap > .5).length}`,
  'anim printed (persist/nop)': `${r.final.persist.animation.printed}/${r.final.noPersist.animation.printed}`, 'hand->printed': r.final.persist.animation.handwritingAsPrinted + r.final.noPersist.animation.handwritingAsPrinted,
  'OCR sim f5/f0': r.ocr.simF5vsF0, 'f5/printedOnly': r.ocr.simF5vsPrintedOnly, 'printedOnly/f0': r.ocr.simPrintedOnlyVsF0 })));
console.log(`aggregate: diff ${agg.meanDiffMs}ms/frame, OCR sim f5/f0 ${agg.meanSimF5vsF0}, f5/printedOnly ${agg.meanSimF5vsPrintedOnly}, stationary-pen cursorFP ${agg.stationaryPen.cursorFp}\nreport: ${path.join(S, 'ink-layer-report.json')}`);
