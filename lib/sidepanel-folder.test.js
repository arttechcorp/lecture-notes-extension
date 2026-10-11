const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ensureFolder 를 소스에서 꺼내 가짜 전역으로 돌린다 — devSkipFolder 는 압축 풀린 빌드에서만 폴더를 건드리지 않는다.
const src = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
const fn = src.match(/async function ensureFolder\(\)\{.*\}/)[0];
const run = async ({ manifest, flag }) => {
  let regrants = 0;
  const g = {
    chrome: { runtime: { getManifest: () => manifest }, storage: { local: { get: async () => ({ devSkipFolder: flag }) } } },
    PackageStore: { indexedDbAdapter: async () => ({}) },
    LibraryFolder: { status: async () => ({ state: 'needs-permission' }), regrant: async () => { regrants++; } },
  };
  await new Function(...Object.keys(g), `${fn}; return ensureFolder();`)(...Object.values(g));
  return regrants;
};

test('devSkipFolder skips the permission request only on unpacked builds', async () => {
  assert.equal(await run({ manifest: {}, flag: true }), 0, '압축 풀린 빌드 + 플래그 → 건너뜀');
  assert.equal(await run({ manifest: {}, flag: undefined }), 1, '플래그 없으면 기존대로 다시 허용');
  assert.equal(await run({ manifest: { update_url: 'https://x' }, flag: true }), 1, '스토어 빌드는 플래그를 무시');
});
