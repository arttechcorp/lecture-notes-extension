// Replays the product's screen path (lib/session.js captureVisual/processImages) on a real lecture video:
// ffmpeg frames at the product's 500 ms sampling -> VisualGate.inspect -> slide base OCR once, same-slide re-captures through
// InkLayer.inkOnly -> JPEG q.9 -> PP-OCRv5 -> layoutText -> EvidenceStore ("(판서) " prefix on the ink layer).
// Usage: node tools/visual-video-replay.mjs <video> <outDir> [--from sec] [--to sec] [--fps 2] [--mode ocr|vision]
// Needs system ffmpeg (/usr/bin/ffmpeg or PATH) and playwright (PLAYWRIGHT_MODULE / CHROME_PATH like visual-ocr-replay.mjs).
// The video, the extracted frames, the OCR text and every output stay in <outDir>, which must be outside the repo: lecture
// material is never committed. The in-page loop mirrors session.js by hand; keep the two in step.
// vision mode has no cloud call here: it only shows which frames the gate would submit (each one is an API call), with a fixed latency.
import { createServer } from 'node:http';
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [video, outArg, ...flags] = process.argv.slice(2);
const opt = { from: 0, to: null, fps: 2, mode: 'ocr' };
for (let i = 0; i < flags.length; i += 2) { const k = flags[i]?.replace(/^--/, ''); if (!(k in opt) || flags[i + 1] === undefined) throw new Error(`unknown or incomplete option ${flags[i]}`); opt[k] = k === 'mode' ? flags[i + 1] : Number(flags[i + 1]); }
if (!video || !outArg || !['ocr', 'vision'].includes(opt.mode) || !(opt.fps > 0) || !Number.isFinite(opt.from) || (opt.to !== null && !(opt.to > opt.from))) throw new Error('usage: node tools/visual-video-replay.mjs <video> <outDir> [--from sec] [--to sec] [--fps 2] [--mode ocr|vision]');
const out = path.resolve(outArg), rel = path.relative(root, out);
if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error(`outDir must be outside the repo (${root}): lecture frames and OCR text are never committed`);
if (!existsSync(video)) throw new Error(`no such video: ${video}`);

const frames = path.join(out, 'frames');
await fs.rm(frames, { recursive: true, force: true }); await fs.mkdir(frames, { recursive: true }); await fs.mkdir(path.join(out, 'accepted'), { recursive: true });
execFileSync(existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : 'ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(opt.from), '-i', path.resolve(video), ...(opt.to ? ['-t', String(opt.to - opt.from)] : []), '-vf', `fps=${opt.fps}`, '-q:v', '2', path.join(frames, '%06d.jpg')], { stdio: ['ignore', 'inherit', 'inherit'] });
const count = (await fs.readdir(frames)).filter(f => f.endsWith('.jpg')).length;
if (!count) throw new Error('ffmpeg produced no frames');

const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const mime = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.yml': 'text/plain' };
const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><meta charset=utf-8>');
  const file = p.startsWith('/frames/') ? path.join(frames, path.basename(p)) : p.startsWith('/lib/') ? path.join(root, p) : null;
  if (!file || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
for (const lib of ['visual-gate', 'ink-layer', 'layout', 'evidence']) await page.addScriptTag({ url: `/lib/${lib}.js` });
await page.exposeFunction('save', (name, b64) => fs.writeFile(path.join(out, 'accepted', name), Buffer.from(b64, 'base64')));
await page.exposeFunction('say', line => console.log(line));
const result = await page.evaluate(async ({ count, fps, from, mode }) => {
  const VISION_MS = 3000, PNG_W = 960;   // vision: no cloud call is made, the gate just stays pending this long
  const vision = mode === 'vision';
  const gate = new VisualGate(vision ? { mode: 'vision' } : {}), store = new EvidenceStore();
  let engine = null, initMs = 0;
  if (!vision) { const { PpOcrV5 } = await import('/lib/ppocr-runtime.mjs'); engine = new PpOcrV5(); const t = performance.now(); await engine.init(); initMs = performance.now() - t; }
  const lev = (a, b) => { let p = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { const q = [i]; for (let j = 1; j <= b.length; j++) q[j] = Math.min(p[j] + 1, q[j - 1] + 1, p[j - 1] + (a[i - 1] !== b[j - 1])); p = q; } return p[b.length]; };
  const sim = (a, b) => { a = a.replace(/\s/g, ''); b = b.replace(/\s/g, ''); return 1 - lev(a, b) / Math.max(1, a.length, b.length); };
  // Same steps as createOcrEngine + the JPEG encode in captureVisual; ms covers both (the gate stays pending for the whole time).
  async function ocr(canvas) {
    const s = performance.now(), blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: .9 }), image = await createImageBitmap(blob);
    try {
      const r = await engine.recognize(image), c = r.lines.map(l => l.confidence).filter(Number.isFinite);
      return { text: layoutText(r.lines, image.width, image.height), confidence: c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0, ms: performance.now() - s };
    } finally { image.close(); }
  }
  async function png(panels) {
    const w = Math.round(Math.min(PNG_W, panels[0].width)), h = Math.round(panels[0].height * w / panels[0].width), cv = new OffscreenCanvas(w * panels.length + 4 * (panels.length - 1), h), cx = cv.getContext('2d');
    cx.fillStyle = '#888'; cx.fillRect(0, 0, cv.width, cv.height); panels.forEach((p, k) => cx.drawImage(p, k * (w + 4), 0, w, h));
    return new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); cv.convertToBlob({ type: 'image/png' }).then(b => f.readAsDataURL(b)); });
  }
  const entries = [], quiet = s => s.replace(/\s+/g, ' ').trim();
  let base = null, slideText = '', done = null, size = null;
  for (let i = 0; i < count; i++) {
    const t = from + i / fps;
    if (done && done.at <= t) { gate.complete(done.sample); done = null; }   // OCR finished in video time: frames in between were skipped, as in the product
    if (i % 600 === 599) await say(`... ${i + 1}/${count} frames, t=${t.toFixed(0)}s`);
    const bmp = await createImageBitmap(await (await fetch(`/frames/${String(i + 1).padStart(6, '0')}.jpg`)).blob());
    const W = bmp.width, H = bmp.height; size = [W, H];
    const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0); bmp.close();
    const choice = gate.inspect(canvas, t * 1000, i === 0);
    if (!choice.accept) continue;
    const entry = { t, slideId: choice.slideId, fresh: choice.fresh }, name = () => `${String(entries.length).padStart(4, '0')}_t${t.toFixed(1)}_s${choice.slideId}_${entry.layer}.png`;
    let panels = [canvas], ink = null;
    if (vision) {
      Object.assign(entry, { layer: 'submitted', text: '' }); done = { at: t + VISION_MS / 1000, sample: choice.sample };
    } else {
      const pixels = ctx.getImageData(0, 0, W, H);
      if (choice.fresh || !base || base.width !== W || base.height !== H) base = pixels;
      else {
        const s = performance.now(); ink = InkLayer.inkOnly(base, pixels); entry.inkMs = performance.now() - s;
        // Old behaviour for comparison: the whole frame, handwriting and slide text mixed. Not part of the simulated latency.
        const full = await ocr(canvas); entry.full = { text: quiet(full.text), ms: full.ms, simToSlide: sim(full.text, slideText) };
        if (!ink) { gate.complete(choice.sample); Object.assign(entry, { layer: 'added-empty', text: '' }); }   // as in the product: no OCR, the gate is released at once
      }
      if (entry.layer !== 'added-empty') {
        let source = canvas;
        if (ink) { source = new OffscreenCanvas(W, H); source.getContext('2d').putImageData(new ImageData(ink.data, W, H), 0, 0); panels = [canvas, source]; entry.cells = ink.cells; }
        const o = await ocr(source), text = ink && o.text.trim() ? `(판서) ${o.text}` : o.text;
        if (!ink) slideText = o.text;
        const item = store.add({ source: 'ocr', time: t, t1: t, text, confidence: o.confidence, slideId: choice.slideId });
        Object.assign(entry, { layer: ink ? 'added' : 'slide', text: quiet(text), stored: !!item, ocrMs: o.ms, confidence: +o.confidence.toFixed(2) });
        done = { at: t + o.ms / 1000, sample: choice.sample };
      }
    }
    entry.png = name(); entries.push(entry);
    await save(entry.png, await png(panels));
    await say(`${String(t.toFixed(1)).padStart(7)}s  slide ${String(entry.slideId).padStart(2)}  ${entry.layer.padEnd(11)} ${entry.text.slice(0, 60)}${entry.full ? `   [full-frame vs slide ${entry.full.simToSlide.toFixed(2)}]` : ''}${entry.stored === false ? '   (dropped: ' + (entry.text.trim() ? 'duplicate' : 'empty') + ')' : ''}`);
  }
  if (engine) await engine.dispose();
  return { initMs, size, entries };
}, { count, fps: opt.fps, from: opt.from, mode: opt.mode });
await browser.close(); server.close();

const stat = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: xs.length, mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1), p50: +q(.5).toFixed(1), p95: +q(.95).toFixed(1), max: +s.at(-1).toFixed(1) }; };
const E = result.entries, layer = l => E.filter(e => e.layer === l), sims = E.filter(e => e.full).map(e => +e.full.simToSlide.toFixed(3));
const report = {
  config: { video: path.basename(video), ...opt, frames: count, frameSize: result.size, ocrInitMs: Math.round(result.initMs) },
  counts: { frames: count, accepted: E.length, slides: layer('slide').length || layer('submitted').filter(e => e.fresh).length, added: layer('added').length, addedStored: layer('added').filter(e => e.stored).length, addedEmpty: layer('added-empty').length, submitted: layer('submitted').length },
  ocrMs: { slide: stat(layer('slide').map(e => e.ocrMs)), added: stat(layer('added').map(e => e.ocrMs)), fullFrameOfAdded: stat(E.filter(e => e.full).map(e => e.full.ms)) },
  similarity: { fullFrameVsSlideText: { n: sims.length, mean: sims.length ? +(sims.reduce((a, b) => a + b, 0) / sims.length).toFixed(3) : null, min: sims.length ? Math.min(...sims) : null, values: sims } },
  timeline: E,
};
await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\nframes ${count} (${result.size.join('x')}), accepted ${E.length}: ${JSON.stringify(report.counts)}\nOCR ms ${JSON.stringify(report.ocrMs)}\nfull-frame OCR vs slide text similarity ${JSON.stringify({ ...report.similarity.fullFrameVsSlideText, values: undefined })}\nreport: ${path.join(out, 'report.json')}`);
