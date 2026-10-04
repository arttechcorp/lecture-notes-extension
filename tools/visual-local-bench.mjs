// Local, input-only PP-OCRv5 smoke benchmark. Run from this worktree with Node 22+.
import { createServer } from 'node:http';
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const worktree = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const main = worktree;
const previews = path.join(worktree, 'eval/visual/previews');
const output = path.join(worktree, 'eval/visual/runs/local-baseline.json');
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const assets = [
  'lib/ppocr-runtime.mjs', 'lib/ppocr-core.js', 'lib/layout.js',
  'lib/vendor/onnxruntime/ort.wasm.min.mjs',
  'lib/vendor/onnxruntime/ort-wasm-simd-threaded.mjs',
  'lib/vendor/onnxruntime/ort-wasm-simd-threaded.wasm',
  'lib/vendor/ppocr/PP-OCRv5_mobile_det.onnx',
  'lib/vendor/ppocr/korean_PP-OCRv5_mobile_rec.onnx',
  'lib/vendor/ppocr/korean_PP-OCRv5_mobile_rec.inference.yml',
];
const allowed = new Set(assets.map(file => '/' + file));
const mime = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.yml': 'text/plain', '.png': 'image/png' };
const files = (await fs.readdir(previews)).filter(name => name.endsWith('.png')).sort();
if (files.length !== 12) throw new Error(`Expected 12 preview PNGs, found ${files.length}`);
const inputs = files.map((name, index) => ({ id: `case-${String(index + 1).padStart(2, '0')}`, name }));
const digest = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-local-ocr-'));
let browser;
let socket;

const server = createServer((request, response) => {
  if (request.method !== 'GET') { response.writeHead(405).end(); return; }
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><meta charset="utf-8"><title>Local OCR benchmark</title>'); return; }
  const input = inputs.find(item => pathname === `/input/${item.id}.png`);
  const file = input ? path.join(previews, input.name) : allowed.has(pathname) ? path.join(main, pathname.slice(1)) : null;
  if (!file || !existsSync(file)) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(response);
});

async function retry(task, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { const result = await task(); if (result) return result; } catch { /* Chrome still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Chrome DevTools did not become ready');
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl), pending = new Map();
  let id = 0;
  const ready = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const entry = pending.get(message.id); if (!entry) return;
    pending.delete(message.id);
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
  };
  ws.onclose = event => { for (const item of pending.values()) item.reject(new Error(`Chrome disconnected (${event.code}: ${event.reason})`)); pending.clear(); };
  return { ws, async send(method, params = {}, timeoutMs = 600000) {
    await ready;
    const commandId = ++id;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(commandId); reject(new Error(`${method} timed out`)); }, timeoutMs);
      pending.set(commandId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    });
    ws.send(JSON.stringify({ id: commandId, method, params }));
    return result;
  } };
}

function browserRun(ids) {
  return (async () => {
    const { PpOcrV5 } = await import('/lib/ppocr-runtime.mjs');
    await import('/lib/layout.js');
    const engine = new PpOcrV5();
    const initStart = performance.now();
    await engine.init();
    const initMs = performance.now() - initStart;
    const cases = [];
    for (const id of ids) {
      try {
        const decodeStart = performance.now();
        const response = await fetch(`/input/${id}.png`);
        if (!response.ok) throw new Error(`Input HTTP ${response.status}`);
        const image = await createImageBitmap(await response.blob());
        const decodeMs = performance.now() - decodeStart;
        const start = performance.now();
        try {
          const result = await engine.recognize(image);
          cases.push({ id, width: image.width, height: image.height, decodeMs,
            recognizeMs: performance.now() - start, detectorMs: result.detection.inferenceMs,
            detectedBoxes: result.detection.boxes, text: result.text,
            layoutText: globalThis.layoutText(result.lines, image.width, image.height), lines: result.lines });
        } finally { image.close(); }
      } catch (error) { cases.push({ id, error: String(error.stack || error) }); }
    }
    await engine.dispose();
    return { initMs, cases, userAgent: navigator.userAgent, logicalCores: navigator.hardwareConcurrency };
  })();
}

try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const port = await retry(async () => {
    const file = path.join(profile, 'DevToolsActivePort');
    return existsSync(file) ? Number((await fs.readFile(file, 'utf8')).split(/\r?\n/)[0]) : null;
  });
  const targets = await retry(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(target => target.type === 'page'));
  socket = cdp(targets[0].webSocketDebuggerUrl);
  await socket.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await retry(async () => (await socket.send('Runtime.evaluate', { expression: 'location.origin', returnByValue: true })).result.value === `http://127.0.0.1:${server.address().port}`);
  const expression = `(${browserRun.toString()})(${JSON.stringify(inputs.map(input => input.id))})`;
  const evaluated = await socket.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, 900000);
  if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.text + ': ' + (evaluated.exceptionDetails.exception?.description || ''));
  const result = evaluated.result.value;
  if (!result?.cases || result.cases.length !== inputs.length) throw new Error('Incomplete browser benchmark result');
  const hashes = Object.fromEntries(await Promise.all(assets.map(async file => [file, await digest(path.join(main, file))])));
  const report = { runId: `local-ppocr-${new Date().toISOString()}`, engine: 'PpOcrV5 Korean mobile, ONNX Runtime WebAssembly CPU',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: main, encoding: 'utf8' }).trim(), assetSha256: hashes,
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, chromeUserAgent: result.userAgent, logicalCores: result.logicalCores },
    initMs: result.initMs, cases: await Promise.all(result.cases.map(async (row, index) => ({ ...row, caseId: inputs[index].name.replace(/\.png$/, ''), imageSha256: await digest(path.join(previews, inputs[index].name)) }))) };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, initMs: report.initMs, cases: report.cases.map(({ caseId, recognizeMs, error, lines }) => ({ caseId, recognizeMs, error, lines: lines?.length })) }, null, 2));
} finally {
  socket?.ws.close(); browser?.kill(); server.close();
  // The profile is task-owned and lives under the OS temporary directory.
  if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('visual-local-ocr-')) await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
