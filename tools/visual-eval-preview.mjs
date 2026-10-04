#!/usr/bin/env node
// Reproducible local controls, gallery, and PNG previews. No remote page assets.
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const run = promisify(execFile);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const visual = resolve(repo, 'eval/visual');
const work = resolve(repo, '.workspace/visual-evaluation');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const svg = (body, width = 900, height = 560) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/>${body}</svg>\n`;

const controls = {
  'korean-plain-text.svg': svg('<text x="60" y="130" font-family="Malgun Gothic,sans-serif" font-size="44" fill="#111">오늘의 강의: 이차방정식</text><text x="60" y="205" font-family="Malgun Gothic,sans-serif" font-size="31" fill="#333">핵심 개념을 차례대로 살펴봅니다.</text>'),
  'three-column-text.svg': svg('<text x="45" y="70" font-family="Malgun Gothic,sans-serif" font-size="33" fill="#111">강의 요약</text>' + [
    ['정의', '이차방정식은', '최고 차수가 이인', '방정식입니다.', '계수를 확인하고', '해를 구합니다.'],
    ['예시', '문제를 읽고', '주어진 조건을', '차례로 정리합니다.', '부호와 순서를', '다시 확인합니다.'],
    ['질문', '부호가 바뀌면', '해가 달라질까요?', '근의 개수는', '어떻게 알까요?', '근거를 적어 봅니다.'],
  ].map((column, i) => column.map((line, j) => `<text x="${45 + i * 290}" y="${145 + j * 55}" font-family="Malgun Gothic,sans-serif" font-size="${j ? 22 : 25}" fill="#222">${line}</text>`).join('')).join('')),
  'formula-pair.svg': svg('<text x="80" y="170" font-family="Cambria Math,serif" font-size="74" fill="#111">a² + b² = c²</text><text x="80" y="400" font-family="Cambria Math,serif" font-size="74" fill="#111">y = mx + b</text>'),
  'formula-clear.svg': svg('<text x="70" y="300" font-family="Cambria Math,serif" font-size="82" fill="#111">ax² + bx + c = 0</text>'),
  'formula-blurred.svg': svg('<defs><filter id="blur"><feGaussianBlur stdDeviation="3"/></filter></defs><text x="70" y="300" font-family="Cambria Math,serif" font-size="82" fill="#111" filter="url(#blur)">ax² + bx + c = 0</text>'),
};

async function makeControls() {
  const dir = resolve(visual, 'images/generated');
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(controls)) await writeFile(resolve(dir, name), content);
  console.log(`Wrote ${Object.keys(controls).length} deterministic SVG controls`);
}

async function entries() {
  const catalog = JSON.parse(await readFile(resolve(visual, 'sources.json'), 'utf8'));
  const found = new Map();
  for (const source of catalog.sources ?? []) found.set(`images/${source.filename}`, { id: source.id, image: `images/${source.filename}`, title: source.id });
  try {
    const manifest = JSON.parse(await readFile(resolve(visual, 'manifest.json'), 'utf8'));
    for (const sample of manifest.cases ?? []) found.set(sample.image, { id: sample.id, image: sample.image, title: `${sample.id} · ${sample.kind}` });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of Object.keys(controls)) found.set(`images/generated/${name}`, { id: name.replace(/\.svg$/, ''), image: `images/generated/${name}`, title: `generated: ${name}` });
  const items = [...found.values()].filter(item => /^(images\/)[^?\x00]*\.(svg|png|jpg|jpeg|gif|webp)$/i.test(item.image) && !item.image.split('/').includes('..'));
  const existing = [];
  for (const item of items) {
    try { if ((await stat(resolve(visual, item.image))).isFile()) existing.push(item); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return existing;
}

async function gallery() {
  const items = await entries();
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Visual evaluation gallery</title><style>body{margin:0;padding:32px;background:#f5f5f5;color:#222;font:16px system-ui}h1{margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:24px}.card{background:#fff;border:1px solid #ddd;border-radius:12px;padding:16px}.image{height:360px;display:grid;place-items:center;background:#fff}.image img{max-width:100%;max-height:100%;object-fit:contain}p{margin:12px 0 0;overflow-wrap:anywhere}</style><h1>Visual evaluation sources</h1><div class="grid">${items.map(item => `<div class="card"><div class="image"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}"></div><p>${escapeHtml(item.title)}</p></div>`).join('')}</div></html>\n`;
  await writeFile(resolve(visual, 'index.html'), html);
  console.log(`Wrote eval/visual/index.html with ${items.length} images`);
}

async function render(onlyId) {
  const all = await entries();
  const items = onlyId ? all.filter(item => item.id === onlyId) : all;
  if (!items.length) throw Error(`unknown preview id: ${onlyId}`);
  const outputDir = resolve(visual, 'previews');
  const htmlDir = resolve(work, 'raster-pages');
  await mkdir(outputDir, { recursive: true });
  await mkdir(htmlDir, { recursive: true });
  const profile = await mkdtemp(resolve(work, 'chrome-profile-'));
  try {
    for (const item of items) {
      const id = item.id.replace(/[^a-zA-Z0-9_-]/g, '-');
      const source = pathToFileURL(resolve(visual, item.image)).href;
      const page = resolve(htmlDir, `${id}.html`);
      const png = resolve(outputDir, `${id}.png`);
      await writeFile(page, `<!doctype html><html><meta charset="utf-8"><style>html,body{width:800px;height:600px;margin:0;background:#fff}body{display:grid;place-items:center}img{width:720px;height:520px;object-fit:contain}</style><img src="${escapeHtml(source)}"></html>`);
      await run(chrome, ['--headless', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=800,600', `--user-data-dir=${profile}`, `--screenshot=${png}`, pathToFileURL(page).href], { timeout: 20000, windowsHide: true });
    }
  } finally { await rm(profile, { recursive: true, force: true }).catch(() => {}); }
  console.log(`Rendered ${items.length} PNG previews in eval/visual/previews`);
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (!['controls', 'gallery', 'render'].includes(command) || args.length > (command === 'render' ? 1 : 0)) throw Error('usage: node tools/visual-eval-preview.mjs controls | gallery | render [id]');
  if (command === 'controls') await makeControls();
  if (command === 'gallery') await gallery();
  if (command === 'render') await render(args[0]);
} catch (error) { console.error(error.message); process.exitCode = 1; }
