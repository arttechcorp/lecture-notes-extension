#!/usr/bin/env node
// Review-driven visual evaluation. It never infers semantics from pixels.
import { readFile, stat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultManifest = resolve(repo, 'eval/visual/manifest.json');
const oneOf = (value, choices, label) => { if (!choices.includes(value)) throw Error(`invalid ${label}`); };
const required = (value, label) => { if (typeof value !== 'string' || !value.trim()) throw Error(`missing ${label}`); };
const object = (value, label) => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`invalid ${label}`); };
const rate = (n, d) => d ? n / d : null;

async function jsonFile(path) {
  if ((await stat(path)).size > 2 * 1024 * 1024) throw Error('JSON file exceeds 2 MB');
  return JSON.parse(await readFile(path, 'utf8'));
}

function assetPath(root, path, label) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /^[a-z]:/i.test(path) || path.split(/[\\/]/).includes('..'))
    throw Error(`invalid ${label} path`);
  const resolved = resolve(root, path);
  const rel = relative(root, resolved);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error(`invalid ${label} path`);
  return resolved;
}

async function existingAsset(root, path, label) {
  const candidate = assetPath(root, path, label);
  const actual = await realpath(candidate);
  const rel = relative(await realpath(root), actual);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error(`invalid ${label} path`);
  if (!(await stat(actual)).isFile()) throw Error(`invalid ${label} file`);
  return actual;
}

function checksOf(checks, label, used) {
  if (!Array.isArray(checks)) throw Error(`invalid ${label} checks`);
  for (const check of checks) {
    object(check, label);
    required(check.id, `${label} check id`);
    required(check.description, `${label} check description`);
    if (used.has(check.id)) throw Error(`duplicate check id: ${check.id}`);
    used.add(check.id);
  }
}

async function loadManifest(path) {
  const manifest = await jsonFile(path);
  object(manifest, 'manifest');
  if (manifest.version !== 1 || !Array.isArray(manifest.cases)) throw Error('invalid manifest version/cases');
  const root = dirname(path);
  const caseIds = new Set(), regionIds = new Set(), checkIds = new Set();
  const groupSplits = new Map();
  for (const sample of manifest.cases) {
    object(sample, 'case');
    required(sample.id, 'case id');
    if (caseIds.has(sample.id)) throw Error(`duplicate case id: ${sample.id}`);
    caseIds.add(sample.id);
    oneOf(sample.kind, ['formula', 'graph', 'negative'], `${sample.id} kind`);
    oneOf(sample.split, ['dev', 'holdout'], `${sample.id} split`);
    required(sample.group, `${sample.id} group`);
    if (groupSplits.has(sample.group) && groupSplits.get(sample.group) !== sample.split) throw Error(`group split mismatch: ${sample.group}`);
    groupSplits.set(sample.group, sample.split);
    if (!/^[a-f0-9]{64}$/i.test(sample.sha256 ?? '')) throw Error(`invalid ${sample.id} sha256`);
    object(sample.source, `${sample.id} source`);
    for (const field of ['pageUrl', 'downloadUrl', 'licenseUrl']) {
      const value = sample.source[field];
      if (value !== null && (typeof value !== 'string' || !value.startsWith('https://'))) throw Error(`invalid ${sample.id} source ${field}`);
    }
    required(sample.source.author, `${sample.id} source author`);
    required(sample.source.license, `${sample.id} source license`);
    required(sample.source.retrievedAt, `${sample.id} source retrievedAt`);
    if (Number.isNaN(Date.parse(sample.source.retrievedAt))) throw Error(`invalid ${sample.id} source retrievedAt`);
    if (!sample.source.pageUrl && !sample.source.downloadUrl) required(sample.source.description, `${sample.id} generated source description`);
    object(sample.annotation, `${sample.id} annotation`);
    oneOf(sample.annotation.status, ['reviewed', 'pending'], `${sample.id} annotation status`);
    if (sample.annotation.status === 'reviewed') required(sample.annotation.reviewer, `${sample.id} annotation reviewer`);
    if (!Array.isArray(sample.annotation.expectedRegions)) throw Error(`invalid ${sample.id} expectedRegions`);
    const regions = sample.annotation.expectedRegions;
    if (sample.kind === 'negative' ? regions.length !== 0 : regions.length === 0) throw Error(`invalid ${sample.id} region count`);
    checksOf(sample.annotation.checks, sample.id, checkIds);
    for (const region of regions) {
      object(region, `${sample.id} region`);
      required(region.id, `${sample.id} region id`);
      if (regionIds.has(region.id)) throw Error(`duplicate region id: ${region.id}`);
      regionIds.add(region.id);
      const bbox = region.bbox;
      if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) || bbox[2] <= 0 || bbox[3] <= 0 || bbox[0] + bbox[2] > 1 || bbox[1] + bbox[3] > 1)
        throw Error(`invalid ${sample.id} bbox`);
      checksOf(region.checks, `${sample.id} region ${region.id}`, checkIds);
      if (!region.checks.length) throw Error(`missing ${sample.id} region checks`);
    }
    if (sample.kind === 'negative' && !sample.annotation.checks.length) throw Error(`missing ${sample.id} negative checks`);
    const image = await existingAsset(root, sample.image, `${sample.id} image`);
    const digest = createHash('sha256').update(await readFile(image)).digest('hex');
    if (digest.toLowerCase() !== sample.sha256.toLowerCase()) throw Error(`checksum mismatch: ${sample.id}`);
    if (sample.originalImage !== undefined || sample.originalSha256 !== undefined) {
      if (!sample.originalImage || !/^[a-f0-9]{64}$/i.test(sample.originalSha256 ?? '')) throw Error(`invalid ${sample.id} original asset`);
      const original = await existingAsset(root, sample.originalImage, `${sample.id} original image`);
      const originalDigest = createHash('sha256').update(await readFile(original)).digest('hex');
      if (originalDigest.toLowerCase() !== sample.originalSha256.toLowerCase()) throw Error(`original checksum mismatch: ${sample.id}`);
    }
  }
  return { manifest, root };
}

function expectedChecks(sample) {
  return [...sample.annotation.checks, ...sample.annotation.expectedRegions.flatMap(region => region.checks)].map(check => check.id);
}

async function loadReviews(path, samples, root) {
  const reviews = await jsonFile(path);
  object(reviews, 'reviews');
  required(reviews.runId, 'runId');
  required(reviews.reviewer, 'reviewer');
  if (!Array.isArray(reviews.cases)) throw Error('invalid review cases');
  const cases = new Map(), known = new Map(samples.map(sample => [sample.id, sample]));
  for (const entry of reviews.cases) {
    object(entry, 'review case');
    required(entry.id, 'review case id');
    if (!known.has(entry.id)) throw Error(`unknown review case id: ${entry.id}`);
    if (cases.has(entry.id)) throw Error(`duplicate review case id: ${entry.id}`);
    cases.set(entry.id, entry);
    oneOf(entry.status, ['rendered', 'abstained'], `${entry.id} status`);
    if (entry.design !== undefined) oneOf(entry.design, ['changed', 'identical', 'cosmetic-only', 'unknown'], `${entry.id} design`);
    object(entry.checks, `${entry.id} checks`);
    const ids = new Set(expectedChecks(known.get(entry.id)));
    for (const [id, decision] of Object.entries(entry.checks)) {
      if (!ids.has(id)) throw Error(`unknown check id: ${id}`);
      oneOf(decision, ['pass', 'fail', 'unknown'], `${entry.id} check ${id}`);
    }
    if (entry.output !== undefined) assetPath(root, entry.output, `${entry.id} output`);
    if (entry.notes !== undefined && typeof entry.notes !== 'string') throw Error(`invalid ${entry.id} notes`);
  }
  return { reviews, cases };
}

async function score(manifestPath, reviewPath) {
  const { manifest, root } = await loadManifest(manifestPath);
  if (manifest.cases.some(sample => sample.annotation.status !== 'reviewed')) throw Error('all annotations must be reviewed before scoring');
  const { reviews, cases } = await loadReviews(reviewPath, manifest.cases, root);
  const counts = { total: manifest.cases.length, pass: 0, fail: 0, hold: 0, missing: 0 };
  const byKind = Object.fromEntries(['formula', 'graph', 'negative'].map(kind => [kind, { total: 0, pass: 0, fail: 0, hold: 0, missing: 0 }]));
  let positive = 0, positivePass = 0, positiveRendered = 0, positiveAbstained = 0, negative = 0, negativeRendered = 0;
  const results = [];
  for (const sample of manifest.cases) {
    const entry = cases.get(sample.id);
    const reasons = [];
    let verdict = 'hold';
    if (!entry) {
      counts.missing++;
      reasons.push('missing review');
    } else {
      const decisions = expectedChecks(sample).map(id => entry.checks[id]);
      if (entry.status === 'rendered' && sample.kind !== 'negative') {
        positiveRendered++;
        if (!entry.output) reasons.push('missing output path');
        else {
          try {
            const output = await existingAsset(root, entry.output, `${sample.id} output`);
            const image = await existingAsset(root, sample.image, `${sample.id} image`);
            if ((await readFile(output)).equals(await readFile(image))) reasons.push('identical source bytes');
          } catch (error) {
            if (/ENOENT/.test(error.message)) reasons.push('missing output file');
            else throw error;
          }
        }
        if (entry.design === 'identical' || entry.design === 'cosmetic-only') reasons.push(`design ${entry.design}`);
        else if (entry.design !== 'changed') reasons.push('design unknown');
      } else if (entry.status === 'abstained' && sample.kind !== 'negative') {
        positiveAbstained++;
        reasons.push('positive abstention');
      } else if (entry.status === 'rendered' && sample.kind === 'negative') {
        negativeRendered++;
        reasons.push('negative rendered');
      }
      if (decisions.includes('fail')) reasons.push('failed check');
      if (decisions.some(decision => decision !== 'pass' && decision !== 'fail')) reasons.push('missing or unknown check');
      if (reasons.some(reason => ['identical source bytes', 'design identical', 'design cosmetic-only', 'negative rendered', 'failed check', 'missing output path', 'missing output file'].includes(reason))) verdict = 'fail';
      else if (!reasons.length) verdict = 'pass';
    }
    if (sample.kind === 'negative') negative++;
    else { positive++; if (verdict === 'pass') positivePass++; }
    counts[verdict]++;
    byKind[sample.kind].total++;
    byKind[sample.kind][verdict]++;
    if (!entry) byKind[sample.kind].missing++;
    results.push({ id: sample.id, verdict, reasons });
  }
  return { runId: reviews.runId, reviewer: reviews.reviewer, reviewDriven: true, counts, byKind,
    metrics: {
      positivePassRate: rate(positivePass, positive),
      positiveAttemptAccuracy: rate(positivePass, positiveRendered),
      positiveAbstentionRate: rate(positiveAbstained, positive),
      negativeFalsePositiveRate: rate(negativeRendered, negative),
      holdRate: rate(counts.hold, counts.total),
      reviewCoverage: rate(cases.size, counts.total),
      annotationCoverage: rate(manifest.cases.filter(sample => sample.annotation.status === 'reviewed').length, counts.total),
    }, cases: results };
}

async function main() {
  const [command, arg1, arg2, ...rest] = process.argv.slice(2);
  if (rest.length) throw Error('too many arguments');
  if (command === 'validate' && !arg2) {
    const { manifest } = await loadManifest(resolve(arg1 ?? defaultManifest));
    console.log(JSON.stringify({ valid: true, cases: manifest.cases.length, annotationCoverage: rate(manifest.cases.filter(sample => sample.annotation.status === 'reviewed').length, manifest.cases.length) }, null, 2));
  } else if (command === 'template' && !arg2) {
    const { manifest } = await loadManifest(resolve(arg1 ?? defaultManifest));
    console.log(JSON.stringify({ runId: '', reviewer: '', cases: manifest.cases.map(sample => ({ id: sample.id, status: '', ...(sample.kind === 'negative' ? {} : { output: '', design: '' }), checks: Object.fromEntries(expectedChecks(sample).map(id => [id, 'unknown'])) })) }, null, 2));
  } else if (command === 'score' && arg1) {
    console.log(JSON.stringify(await score(resolve(arg2 ?? defaultManifest), resolve(arg1)), null, 2));
  } else throw Error('usage: node tools/visual-eval.mjs validate [manifest] | template [manifest] | score <reviews.json> [manifest]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

export { loadManifest, score };
