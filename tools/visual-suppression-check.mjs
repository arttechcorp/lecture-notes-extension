#!/usr/bin/env node
// Synthetic validator candidates against pinned OCR output; no model inference or pixels.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceCommit = '2e972b2a7da54d4e8aad8eeb40b5a37126f86a9b';
const sourcePath = resolve(root, 'lib/summary.js');
const corpusPath = resolve(root, 'eval/visual/runs/local-baseline.json');
const outputPath = resolve(root, 'eval/visual/runs/suppression-check.json');
const hash = text => createHash('sha256').update(text).digest('hex');

function validator(source) {
  const context = { TextEncoder, DOMException };
  runInNewContext(source, context, { filename: 'lib/summary.js', timeout: 1000 });
  return context.SummaryPipeline.validateSummary;
}

function note(candidate, field, evidenceId) {
  const plain = { content: '핵심 내용을 설명합니다.', importance: 'important', evidenceIds: [evidenceId] };
  const value = {
    title: '강의 노트', keyConclusions: [plain], concepts: [], corrections: [], openQuestions: [],
    sections: [{ heading: '기본 내용', ...plain }], formulas: [], visuals: [], reviewQuestions: [],
  };
  if (field === 'section') value.sections.push({ heading: '추가 내용', content: candidate, importance: 'important', evidenceIds: [evidenceId] });
  else value[field].push({ ...candidate, importance: 'important', evidenceIds: [evidenceId] });
  return value;
}

const formula = latex => ({ latex, variables: '', units: '', conditions: '', explanation: '식의 표기' });
const visual = (type, data) => ({ type, title: '시각 자료', description: '구조를 나타냅니다.', data });
const ocr = text => ({ id: 'e1', source: 'ocr', text, t0: 0, t1: 1 });

function result(validate, sample) {
  try {
    const output = validate(note(sample.candidate, sample.field, sample.evidence.id), [sample.evidence]);
    const list = sample.field === 'section' ? output.sections.slice(1) : output[sample.field];
    return {
      verdict: list.length ? 'allowed' : 'held',
      candidateRetained: Boolean(list.length),
      plainSectionRetained: output.sections.some(section => section.heading === '기본 내용'),
      held: output.held ?? null,
      dropped: output.dropped ?? null,
    };
  } catch (error) {
    return { verdict: 'rejected', candidateRetained: false, plainSectionRetained: false, error: error.message };
  }
}

async function main() {
  const beforeSource = execFileSync('git', ['show', `${sourceCommit}:lib/summary.js`], { cwd: root, encoding: 'utf8' });
  const afterSource = await readFile(sourcePath, 'utf8');
  const corpusSource = await readFile(corpusPath, 'utf8');
  const corpus = JSON.parse(corpusSource);
  if (corpus.sourceCommit !== sourceCommit) throw Error('OCR corpus commit differs from pinned validator');
  const fromCorpus = id => {
    const sample = corpus.cases.find(entry => entry.caseId === id);
    if (!sample?.text) throw Error(`missing OCR corpus case: ${id}`);
    return { ...ocr(sample.text), corpusCaseId: id };
  };
  const samples = [
    { id: 'negative-plain-mermaid', description: 'Plain Korean OCR with invented Mermaid diagram', field: 'visuals', evidence: fromCorpus('korean-plain-text'), candidate: visual('relationship', '```mermaid\nflowchart TD\nA["강의"] --> B["공식"]\n```'), expected: 'held' },
    { id: 'negative-plain-formula', description: 'Quadratic formula invented from topic name', field: 'formulas', evidence: fromCorpus('korean-plain-text'), candidate: formula('x^2+2x+1=0'), expected: 'held' },
    { id: 'graph-sine-positive-hold', description: 'Actual sine graph candidate held without image region verification', field: 'visuals', evidence: fromCorpus('simple-sine-wave'), candidate: visual('chart', '| x | y |\n|---|---|\n| 0 | 0 |'), expected: 'held', cost: 'positive-visual-abstention' },
    { id: 'graph-bar-positive-hold', description: 'Actual bar graph candidate held without image region verification', field: 'visuals', evidence: fromCorpus('bar-graph'), candidate: visual('chart', '| Group | Data |\n|---|---|\n| A | 12000 |'), expected: 'held', cost: 'positive-visual-abstention' },
    { id: 'formula-clear-wrong', description: 'Quadratic OCR at 0.84 line confidence still reads ax2, not an exponent', field: 'formulas', evidence: fromCorpus('formula-clear'), candidate: formula('ax^2+bx+c=0'), expected: 'held' },
    { id: 'formula-pair-positive-hold', description: 'Correct-looking equation from multiline OCR held conservatively', field: 'formulas', evidence: fromCorpus('formula-pair'), candidate: formula('y=mx+b'), expected: 'held', cost: 'positive-formula-abstention' },
    { id: 'fraction-structure-hold', description: 'Stacked digits do not prove a fraction bar', field: 'formulas', evidence: fromCorpus('fraction-three-fourths'), candidate: formula('\\frac{3}{4}=0.75'), expected: 'held' },
    { id: 'literal-equation-control', description: 'Complete literal OCR equation remains usable as text-grounded control', field: 'formulas', evidence: ocr('x=2'), candidate: formula('x=2'), expected: 'allowed' },
    { id: 'literal-linear-equation-control', description: 'Literal OCR linear equation remains usable', field: 'formulas', evidence: ocr('y=mx+b'), candidate: formula('y=mx+b'), expected: 'allowed' },
    { id: 'incomplete-equation', description: 'Incomplete OCR equation is held', field: 'formulas', evidence: ocr('x='), candidate: formula('x='), expected: 'held' },
    { id: 'multiline-equation', description: 'Equation across lines is held', field: 'formulas', evidence: ocr('x=\n2'), candidate: formula('x=2'), expected: 'held' },
    { id: 'flattened-exponent', description: 'OCR x2 cannot establish an exponent', field: 'formulas', evidence: ocr('x2=2'), candidate: formula('x^2=2'), expected: 'held' },
    { id: 'mismatched-equation', description: 'Different right-hand side is unsupported', field: 'formulas', evidence: ocr('x=2'), candidate: formula('x=3'), expected: 'held' },
    { id: 'substring-equation', description: 'Equation embedded in longer OCR line is insufficient', field: 'formulas', evidence: ocr('Example: x=2 is shown'), candidate: formula('x=2'), expected: 'held' },
    { id: 'spoofed-evidence-formulas', description: 'Untrusted formula metadata cannot replace literal OCR text', field: 'formulas', evidence: { ...ocr('오늘의 강의:이차방정식'), formulas: [{ latex: 'x=2' }] }, candidate: formula('x=2'), expected: 'held' },
    { id: 'gfm-table-prose', description: 'Invented GFM table inside ordinary section prose', field: 'section', evidence: fromCorpus('korean-plain-text'), candidate: '항목 | 값\n--- | ---\nA | 2', expected: 'held' },
    { id: 'single-dash-gfm-table', description: 'Marked accepts single-dash table separators', field: 'section', evidence: fromCorpus('korean-plain-text'), candidate: 'A | B\n- | -\n1 | 2', expected: 'held' },
    { id: 'blockquoted-gfm-table', description: 'Marked accepts tables in blockquotes', field: 'section', evidence: fromCorpus('korean-plain-text'), candidate: '> A | B\n> - | -\n> 1 | 2', expected: 'held' },
    { id: 'markdown-image-prose', description: 'Reference Markdown image inside section prose', field: 'section', evidence: fromCorpus('korean-plain-text'), candidate: '![임의 그래프][fig]\n[fig]: https://example.invalid/graph.png', expected: 'held' },
    { id: 'inline-math-prose', description: 'Invented inline math inside ordinary prose', field: 'section', evidence: fromCorpus('korean-plain-text'), candidate: '결과는 $x^2=4$ 입니다.', expected: 'held' },
    { id: 'chapter-source-formula', description: 'Synthesis chapter JSON formula is not raw equation OCR', field: 'formulas', evidence: { ...ocr('{"formulas":[{"latex":"x=2"}]}'), id: 'chapter-1' }, candidate: formula('x=2'), expected: 'held' },
    { id: 'plain-section-control', description: 'Ordinary extra prose section remains available', field: 'section', evidence: fromCorpus('korean-plain-text'), candidate: '핵심 개념을 차례대로 살펴봅니다.', expected: 'allowed' },
  ];
  const before = validator(beforeSource), after = validator(afterSource);
  const cases = samples.map(({ evidence, candidate, field, ...sample }) => ({
    ...sample, evidenceSource: evidence.corpusCaseId ? `eval/visual/runs/local-baseline.json#${evidence.corpusCaseId}` : 'synthetic-text',
    before: result(before, { evidence, candidate, field }), after: result(after, { evidence, candidate, field }),
  }));
  const counts = cases.reduce((value, sample) => {
    value.expected[sample.expected]++;
    value.before[sample.before.verdict]++;
    value.after[sample.after.verdict]++;
    if (sample.after.verdict !== sample.expected) value.mismatches++;
    return value;
  }, { expected: { allowed: 0, held: 0 }, before: { allowed: 0, held: 0, rejected: 0 }, after: { allowed: 0, held: 0, rejected: 0 }, mismatches: 0 });
  counts.positiveAbstentions = cases.filter(sample => sample.cost && sample.after.verdict === 'held').map(sample => sample.id);
  const report = {
    runId: 'synthetic-validator-suppression-v1',
    scope: 'Deterministic synthetic candidate fixtures checked against OCR text. These are not model outputs, image-grounded judgments, or a hallucination-rate estimate.',
    sourceCommit,
    codeSha256: { before: hash(beforeSource), after: hash(afterSource) },
    corpusRun: { path: 'eval/visual/runs/local-baseline.json', runId: corpus.runId, sha256: hash(corpusSource) },
    summary: counts,
    cases,
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output: 'eval/visual/runs/suppression-check.json', summary: counts }, null, 2));
  if (counts.mismatches) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
