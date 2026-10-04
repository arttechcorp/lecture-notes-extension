import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { score, loadManifest } from './visual-eval.mjs';
import { imageType } from './visual-eval-collect.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'visual-eval-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>x=1</text></svg>');
  await writeFile(join(root, 'source.svg'), original);
  await writeFile(join(root, 'changed.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><text style="fill:blue">x=1</text></svg>');
  await writeFile(join(root, 'copy.svg'), original);
  const source = { pageUrl: null, downloadUrl: null, author: 'fixture', license: 'CC0', licenseUrl: null,
    retrievedAt: '2026-10-02T00:00:00Z', description: 'generated fixture' };
  const annotation = (id, positive) => ({ status: 'reviewed', reviewer: 'annotator',
    expectedRegions: positive ? [{ id: `region-${id}`, bbox: [0, 0, 1, 1], checks: [{ id: `core-${id}`, description: 'Core meaning preserved' }] }] : [],
    checks: [{ id: `semantic-${id}`, description: positive ? 'No hallucination' : 'No visual emitted' }] });
  const sample = (id, kind) => ({ id, kind, group: 'test', split: 'dev', image: 'source.svg',
    sha256: createHash('sha256').update(original).digest('hex'), source, annotation: annotation(id, kind !== 'negative') });
  const manifest = { version: 1, cases: [sample('formula', 'formula'), sample('negative', 'negative')] };
  const manifestPath = join(root, 'manifest.json');
  const reviewsPath = join(root, 'reviews.json');
  const review = (id, status, output) => ({ id, status, ...(output ? { output } : {}),
    ...(id === 'formula' ? { design: 'changed' } : {}),
    checks: id === 'formula' ? { 'core-formula': 'pass', 'semantic-formula': 'pass' } : { 'semantic-negative': 'pass' } });
  const reviews = { runId: 'test-run', reviewer: 'independent', cases: [review('formula', 'rendered', 'changed.svg'), review('negative', 'abstained')] };
  const save = async () => { await writeFile(manifestPath, JSON.stringify(manifest)); await writeFile(reviewsPath, JSON.stringify(reviews)); };
  await save();
  return { root, manifest, reviews, manifestPath, reviewsPath, save };
}

test('changed design and completed checks pass; negative abstention passes', async t => {
  const f = await fixture(t);
  const result = await score(f.manifestPath, f.reviewsPath);
  assert.deepEqual(result.counts, { total: 2, pass: 2, fail: 0, hold: 0, missing: 0 });
  assert.equal(result.metrics.negativeFalsePositiveRate, 0);
  assert.equal(result.metrics.positiveAttemptAccuracy, 1);
  assert.equal(result.metrics.holdRate, 0);
  assert.equal(result.byKind.formula.pass, 1);
  assert.equal(result.byKind.negative.pass, 1);
});

test('exact copy fails even when reviewer declares changed', async t => {
  const f = await fixture(t);
  f.reviews.cases[0].output = 'copy.svg';
  await f.save();
  const result = await score(f.manifestPath, f.reviewsPath);
  assert.equal(result.cases[0].verdict, 'fail');
  assert.ok(result.cases[0].reasons.includes('identical source bytes'));
});

test('core failure dominates unknown checks', async t => {
  const f = await fixture(t);
  f.reviews.cases[0].checks['core-formula'] = 'fail';
  f.reviews.cases[0].checks['semantic-formula'] = 'unknown';
  await f.save();
  assert.equal((await score(f.manifestPath, f.reviewsPath)).cases[0].verdict, 'fail');
});

test('missing review is hold and missing; all abstain cannot report perfect accuracy', async t => {
  const f = await fixture(t);
  f.reviews.cases = [{ id: 'formula', status: 'abstained', checks: {} }];
  await f.save();
  const result = await score(f.manifestPath, f.reviewsPath);
  assert.deepEqual(result.counts, { total: 2, pass: 0, fail: 0, hold: 2, missing: 1 });
  assert.equal(result.metrics.positivePassRate, 0);
  assert.equal(result.metrics.positiveAttemptAccuracy, null);
  assert.equal(result.metrics.reviewCoverage, 0.5);
  assert.equal(result.metrics.holdRate, 1);
  assert.equal(result.byKind.negative.missing, 1);
});

test('negative rendered always fails', async t => {
  const f = await fixture(t);
  f.reviews.cases[1].status = 'rendered';
  await f.save();
  const result = await score(f.manifestPath, f.reviewsPath);
  assert.equal(result.cases[1].verdict, 'fail');
  assert.equal(result.metrics.negativeFalsePositiveRate, 1);
});

test('missing rendered output fails', async t => {
  const f = await fixture(t);
  f.reviews.cases[0].output = 'missing.svg';
  await f.save();
  assert.equal((await score(f.manifestPath, f.reviewsPath)).cases[0].verdict, 'fail');
});

test('fake and duplicate review case IDs are rejected', async t => {
  const f = await fixture(t);
  f.reviews.cases.push({ id: 'fake', status: 'abstained', checks: {} });
  await f.save();
  await assert.rejects(score(f.manifestPath, f.reviewsPath), /unknown review case id/);
  f.reviews.cases[2].id = 'formula';
  await f.save();
  await assert.rejects(score(f.manifestPath, f.reviewsPath), /duplicate review case id/);
});

test('invalid paths and corrupted checksums are rejected', async t => {
  const f = await fixture(t);
  f.manifest.cases[0].image = '../source.svg';
  await f.save();
  await assert.rejects(loadManifest(f.manifestPath), /invalid formula image path/);
  f.manifest.cases[0].image = 'source.svg';
  f.manifest.cases[0].sha256 = '0'.repeat(64);
  await f.save();
  await assert.rejects(loadManifest(f.manifestPath), /checksum mismatch/);
});

test('a source group cannot cross dev and holdout', async t => {
  const f = await fixture(t);
  f.manifest.cases[1].split = 'holdout';
  await f.save();
  await assert.rejects(loadManifest(f.manifestPath), /group split mismatch/);
});

test('annotation author may independently review a reconstruction', async t => {
  const f = await fixture(t);
  f.reviews.reviewer = 'annotator';
  await f.save();
  assert.equal((await score(f.manifestPath, f.reviewsPath)).counts.pass, 2);
});

test('download guard rejects active SVG CSS and external references', () => {
  const okay = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path style="filter:url(#shade)"/></svg>');
  assert.equal(imageType(okay, 'image/svg+xml', 'safe.svg'), true);
  for (const bad of ['<style>@import "https://evil.test/x.css"</style>', '<path style="filter:url(https://evil.test/x)"/>', '<use href="javascript:alert(1)"/>']) {
    assert.equal(imageType(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${bad}</svg>`), 'image/svg+xml', 'bad.svg'), false);
  }
});

test('linked original asset is checked when a PNG is the evaluated input', async t => {
  const f = await fixture(t);
  f.manifest.cases[0].originalImage = 'source.svg';
  f.manifest.cases[0].originalSha256 = f.manifest.cases[0].sha256;
  await f.save();
  assert.equal((await loadManifest(f.manifestPath)).manifest.cases.length, 2);
  f.manifest.cases[0].originalSha256 = '0'.repeat(64);
  await f.save();
  await assert.rejects(loadManifest(f.manifestPath), /original checksum mismatch/);
});
