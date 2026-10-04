#!/usr/bin/env node
// Bounded public-image discovery and curated Wikimedia downloads for visual evaluation.
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const visual = resolve(repo, 'eval/visual');
const images = resolve(visual, 'images');
const keyFile = resolve(repo, '../..', 'apikey.env.local');
const queries = [
  'Wikimedia Commons quadratic formula equation SVG',
  'Wikimedia Commons simple parabola sine linear function graph SVG',
  'Wikimedia Commons simple bar chart graph SVG',
];

function contained(root, candidate) {
  const rel = relative(root, candidate);
  return rel && !rel.startsWith('..') && !isAbsolute(rel);
}

function keyFrom(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const keys = lines.map(line => {
    if (line.startsWith('EXA_API_KEY=')) return line.slice('EXA_API_KEY='.length).trim().replace(/^['"]|['"]$/g, '');
    if (line.includes('=')) return null;
    return line;
  }).filter(Boolean);
  if (keys.length !== 1) throw Error(keys.length ? 'ambiguous Exa key file' : 'no Exa key found');
  return keys[0];
}

async function exaKey() {
  if (process.env.EXA_API_KEY?.trim()) return process.env.EXA_API_KEY.trim();
  return keyFrom(await readFile(keyFile, 'utf8'));
}

function publicHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

async function boundedBody(response, maxBytes) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error('response exceeds size limit');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

async function search() {
  const key = await exaKey();
  const searches = [];
  for (const query of queries) {
    let response;
    try {
      response = await fetch('https://api.exa.ai/search', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'x-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ query, type: 'auto', includeDomains: ['commons.wikimedia.org'], numResults: 5,
          contents: { text: { maxCharacters: 7000 }, extras: { imageLinks: 3 } } }),
      });
    } catch { throw Error('Exa request failed (network or timeout)'); }
    if (!response.ok) throw Error(`Exa returned HTTP ${response.status}`);
    const data = JSON.parse((await boundedBody(response, 1024 * 1024)).toString('utf8'));
    searches.push({ query, costDollars: data.costDollars?.total ?? null, results: (data.results ?? []).slice(0, 5).map(result => ({
      title: String(result.title ?? '').slice(0, 300),
      url: publicHttps(result.url), author: String(result.author ?? '').slice(0, 200),
      image: publicHttps(result.image),
      imageLinks: (result.extras?.imageLinks ?? []).slice(0, 3).map(publicHttps).filter(Boolean),
      text: String(result.text ?? '').slice(0, 7000),
    })).filter(result => result.url) });
  }
  await mkdir(visual, { recursive: true });
  await writeFile(resolve(visual, 'discovery.json'), `${JSON.stringify({ retrievedAt: new Date().toISOString(), searches }, null, 2)}\n`);
  console.log(`Saved ${searches.reduce((n, search) => n + search.results.length, 0)} public results to eval/visual/discovery.json`);
}

function imageType(bytes, contentType, name) {
  const ext = extname(name).toLowerCase();
  const signatures = {
    '.png': ['image/png', bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))],
    '.jpg': ['image/jpeg', bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))],
    '.jpeg': ['image/jpeg', bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))],
    '.gif': ['image/gif', /^GIF8[79]a/.test(bytes.subarray(0, 6).toString('ascii'))],
    '.webp': ['image/webp', bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'],
  };
  if (ext === '.svg') {
    const svg = bytes.toString('utf8');
    const safe = /<svg[\s>]/i.test(svg) && !/<\s*(script|foreignObject|iframe|object|embed|image)\b|\bon[a-z]+\s*=|\b(?:href|src)\s*=\s*['"](?!#)[^'"]+|@import\b|url\s*\(\s*['"]?(?!#)[^)'"\s]+|<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(svg);
    return contentType === 'image/svg+xml' && safe;
  }
  return signatures[ext]?.[0] === contentType && signatures[ext][1];
}

async function download(urlText, output) {
  const url = new URL(urlText);
  if (url.protocol !== 'https:' || !['commons.wikimedia.org', 'upload.wikimedia.org'].includes(url.hostname) || url.username || url.password)
    throw Error('download URL must be public HTTPS Wikimedia Commons');
  if (!output || isAbsolute(output) || output.split(/[\\/]/).includes('..')) throw Error('output must be relative to eval/visual/images');
  const target = resolve(images, output);
  if (!contained(images, target)) throw Error('output must be inside eval/visual/images');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) }).catch(() => { throw Error('download failed (network or timeout)'); });
  if (!response.ok) throw Error(`download returned HTTP ${response.status}`);
  const bytes = await boundedBody(response, 5 * 1024 * 1024);
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (!imageType(bytes, contentType, target)) throw Error('unsupported image type, invalid signature, or unsafe SVG');
  await mkdir(dirname(target), { recursive: true });
  if (!contained(await realpath(images), await realpath(dirname(target))) && dirname(target) !== images)
    throw Error('output directory resolves outside images');
  await writeFile(target, bytes, { flag: 'wx' });
  console.log(`Saved ${relative(repo, target)} (${bytes.length} bytes)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'search' && args.length === 0) await search();
    else if (command === 'download' && args.length === 2) await download(...args);
    else throw Error('usage: node tools/visual-eval-collect.mjs search | download <Wikimedia HTTPS URL> <image filename>');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export { imageType };
