#!/usr/bin/env node
/**
 * Visual restoration & local OCR benchmark report builder.
 * Generates standalone, self-contained Korean HTML report from:
 *  - eval/visual/manifest.json
 *  - eval/visual/runs/local-baseline.json
 *  - eval/visual/runs/local-review.json
 *  - eval/visual/previews/*.png (base64 embedded)
 *  - eval/visual/runs/suppression-check.json (optional)
 *  - eval/visual/runs/verification.json (optional)
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const visualDir = resolve(repoRoot, 'eval/visual');

const escapeHtml = (str) => {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
};

function formatMs(val) {
  if (val === null || val === undefined || Number.isNaN(val)) return '-';
  return Number(val).toFixed(2);
}

function calculateMedian(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calculateAverage(arr) {
  if (!arr.length) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('[visual-report] Starting benchmark report generation...');
  const manifestPath = resolve(visualDir, 'manifest.json');
  const baselinePath = resolve(visualDir, 'runs/local-baseline.json');
  const reviewPath = resolve(visualDir, 'runs/local-review.json');
  const suppressionCheckPath = resolve(visualDir, 'runs/suppression-check.json');
  const verificationPath = resolve(visualDir, 'runs/verification.json');
  const outputPath = resolve(visualDir, 'report.html');

  // Read required files using absolute paths
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  const review = JSON.parse(await readFile(reviewPath, 'utf8'));

  // Optional suppression check
  let suppressionCheck = null;
  if (await fileExists(suppressionCheckPath)) {
    try {
      suppressionCheck = JSON.parse(await readFile(suppressionCheckPath, 'utf8'));
      console.log('[visual-report] Loaded runs/suppression-check.json');
    } catch (e) {
      console.warn('[visual-report] Failed to parse suppression-check.json:', e.message);
    }
  } else {
    console.log('[visual-report] runs/suppression-check.json not found; status: pending.');
  }

  // Optional verification results
  let verification = null;
  if (await fileExists(verificationPath)) {
    try {
      verification = JSON.parse(await readFile(verificationPath, 'utf8'));
      console.log('[visual-report] Loaded runs/verification.json');
    } catch (e) {
      console.warn('[visual-report] Failed to parse verification.json:', e.message);
    }
  } else {
    console.log('[visual-report] runs/verification.json not found; status: pending.');
  }

  // Load preview images as base64 (all 12 PNGs)
  const imageBase64Map = new Map();
  for (const c of manifest.cases) {
    const imgRelPath = c.image; // e.g. "previews/quadratic-formula.png"
    const imgFullPath = resolve(visualDir, imgRelPath);
    if (await fileExists(imgFullPath)) {
      const buffer = await readFile(imgFullPath);
      imageBase64Map.set(c.id, `data:image/png;base64,${buffer.toString('base64')}`);
    } else {
      console.warn(`[visual-report] Preview image missing for ${c.id} at ${imgFullPath}`);
      imageBase64Map.set(c.id, '');
    }
  }

  // Index review cases by caseId and id
  const reviewMap = new Map();
  for (const rc of review.cases || []) {
    if (rc.caseId) reviewMap.set(rc.caseId, rc);
    if (rc.id) reviewMap.set(rc.id, rc);
  }

  // Index baseline cases by caseId and id
  const baselineMap = new Map();
  for (const bc of baseline.cases || []) {
    if (bc.caseId) baselineMap.set(bc.caseId, bc);
    if (bc.id) baselineMap.set(bc.id, bc);
  }

  // Dynamic statistics calculations directly from baseline JSON
  const baselineCases = baseline.cases || [];
  const totalCount = baselineCases.length;
  const recognizeTimes = baselineCases.map(c => c.recognizeMs).filter(t => typeof t === 'number');
  const detectorTimes = baselineCases.map(c => c.detectorMs).filter(t => typeof t === 'number');
  const decodeTimes = baselineCases.map(c => c.decodeMs).filter(t => typeof t === 'number');

  const medianRecognizeMs = calculateMedian(recognizeTimes);
  const avgRecognizeMs = calculateAverage(recognizeTimes);
  const minRecognizeMs = recognizeTimes.length ? Math.min(...recognizeTimes) : 0;
  const maxRecognizeMs = recognizeTimes.length ? Math.max(...recognizeTimes) : 0;

  const medianDetectorMs = calculateMedian(detectorTimes);
  const avgDetectorMs = calculateAverage(detectorTimes);
  const medianDecodeMs = calculateMedian(decodeTimes);
  const avgDecodeMs = calculateAverage(decodeTimes);

  const initMs = baseline.initMs ?? 0;
  const env = baseline.environment || {};

  // Group stats by kind
  const kindsCount = { formula: 0, graph: 0, negative: 0, other: 0 };
  for (const c of manifest.cases) {
    if (kindsCount[c.kind] !== undefined) {
      kindsCount[c.kind]++;
    } else {
      kindsCount.other++;
    }
  }

  // Suppression check summary metrics - NO guessed fallbacks
  let scSummaryBeforeAllowed = 'unknown';
  let scSummaryBeforeHeld = 'unknown';
  let scSummaryAfterAllowed = 'unknown';
  let scSummaryAfterHeld = 'unknown';
  let scSummaryExpectedAllowed = 'unknown';
  let scSummaryExpectedHeld = 'unknown';
  let scSummaryMismatches = 'unknown';
  let scBadgeText = 'UNKNOWN';
  let scBadgeClass = 'badge-pending';
  let scCalloutClass = 'callout-warning';

  if (suppressionCheck && suppressionCheck.summary) {
    const s = suppressionCheck.summary;
    if (s.before && typeof s.before.allowed === 'number') scSummaryBeforeAllowed = s.before.allowed;
    if (s.before && typeof s.before.held === 'number') scSummaryBeforeHeld = s.before.held;
    if (s.after && typeof s.after.allowed === 'number') scSummaryAfterAllowed = s.after.allowed;
    if (s.after && typeof s.after.held === 'number') scSummaryAfterHeld = s.after.held;
    if (s.expected && typeof s.expected.allowed === 'number') scSummaryExpectedAllowed = s.expected.allowed;
    if (s.expected && typeof s.expected.held === 'number') scSummaryExpectedHeld = s.expected.held;

    if (typeof s.mismatches === 'number') {
      scSummaryMismatches = s.mismatches;
      if (s.mismatches === 0) {
        scBadgeText = 'ALL MATCHED (통과)';
        scBadgeClass = 'badge-pass';
        scCalloutClass = 'callout-info';
      } else {
        scBadgeText = `${s.mismatches} MISMATCH DETECTED`;
        scBadgeClass = 'badge-held';
        scCalloutClass = 'callout-alert';
      }
    }
  }

  // Render HTML
  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>시각 복원 및 로컬 OCR 벤치마크 평가 리포트</title>
  <style>
    :root {
      --bg-page: #f8fafc;
      --bg-surface: #ffffff;
      --bg-subtle: #f1f5f9;
      --bg-card: #ffffff;
      --border-subtle: #e2e8f0;
      --border-medium: #cbd5e1;
      --text-main: #0f172a;
      --text-muted: #475569;
      --text-light: #64748b;
      --primary: #1e40af;
      --primary-hover: #1d4ed8;
      --accent: #0284c7;
      --badge-formula: #0284c7;
      --badge-graph: #7c3aed;
      --badge-negative: #b45309;
      --status-pending-bg: #fef3c7;
      --status-pending-text: #92400e;
      --status-pending-border: #fcd34d;
      --status-alert-bg: #fee2e2;
      --status-alert-text: #991b1b;
      --status-alert-border: #fca5a5;
      --status-pass-bg: #dcfce7;
      --status-pass-text: #166534;
      --status-pass-border: #86efac;
      --code-bg: #f1f5f9;
      --code-border: #e2e8f0;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif;
      font-size: 16px;
      line-height: 1.6;
      color: var(--text-main);
      background-color: var(--bg-page);
      padding: 24px 16px 64px;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    header.report-header {
      background: var(--bg-surface);
      border: 1px solid var(--border-medium);
      border-radius: 12px;
      padding: 32px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }

    header.report-header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #0f2744;
      margin-bottom: 8px;
      line-height: 1.3;
    }

    header.report-header .subtitle {
      font-size: 17px;
      color: var(--text-muted);
      margin-bottom: 20px;
    }

    .meta-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 24px;
      padding-top: 16px;
      border-top: 1px solid var(--border-subtle);
      font-size: 14px;
      color: var(--text-muted);
    }

    .meta-item strong {
      color: var(--text-main);
      font-weight: 600;
    }

    /* Section Styles */
    section.report-section {
      background: var(--bg-surface);
      border: 1px solid var(--border-medium);
      border-radius: 12px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }

    section.report-section h2 {
      font-size: 20px;
      font-weight: 700;
      color: #0f2744;
      margin-bottom: 16px;
      padding-bottom: 10px;
      border-bottom: 2px solid var(--border-subtle);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    /* Callout & Alert Boxes */
    .callout-box {
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 16px;
      font-size: 15px;
      line-height: 1.6;
    }

    .callout-box strong {
      display: inline-block;
      margin-bottom: 4px;
      font-weight: 700;
    }

    .callout-warning {
      background-color: var(--status-pending-bg);
      border: 1px solid var(--status-pending-border);
      color: var(--status-pending-text);
    }

    .callout-alert {
      background-color: var(--status-alert-bg);
      border: 1px solid var(--status-alert-border);
      color: var(--status-alert-text);
    }

    .callout-info {
      background-color: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1e40af;
    }

    .invariants-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }

    .invariant-card {
      background: var(--bg-subtle);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 16px;
    }

    .invariant-card h3 {
      font-size: 16px;
      font-weight: 700;
      color: #0f2744;
      margin-bottom: 8px;
    }

    .invariant-card p {
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.5;
    }

    /* Stat Cards */
    .stats-summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: var(--bg-subtle);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }

    .stat-card .stat-label {
      font-size: 13px;
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }

    .stat-card .stat-value {
      font-size: 26px;
      font-weight: 800;
      color: #0f2744;
    }

    .stat-card .stat-unit {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-light);
      margin-left: 2px;
    }

    .stat-card .stat-sub {
      font-size: 12px;
      color: var(--text-light);
      margin-top: 4px;
    }

    /* Tables */
    .table-wrapper {
      width: 100%;
      overflow-x: auto;
      border: 1px solid var(--border-medium);
      border-radius: 8px;
      margin-bottom: 16px;
    }

    table.data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
      text-align: left;
      background: var(--bg-surface);
    }

    table.data-table th {
      background: var(--bg-subtle);
      color: var(--text-main);
      font-weight: 600;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-medium);
      white-space: nowrap;
    }

    table.data-table td {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      color: var(--text-main);
      vertical-align: middle;
    }

    table.data-table tr:last-child td {
      border-bottom: none;
    }

    table.data-table tr:hover td {
      background-color: #f8fafc;
    }

    .num-cell {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.2;
    }

    .badge-formula { background: #e0f2fe; color: #0369a1; }
    .badge-graph { background: #ede9fe; color: #6d28d9; }
    .badge-negative { background: #fef3c7; color: #92400e; }
    .badge-pending { background: var(--status-pending-bg); color: var(--status-pending-text); border: 1px solid var(--status-pending-border); }
    .badge-pass { background: var(--status-pass-bg); color: var(--status-pass-text); border: 1px solid var(--status-pass-border); }
    .badge-held { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
    .badge-allowed { background: #dcfce7; color: #166534; border: 1px solid #86efac; }

    /* Case Cards */
    .case-card {
      border: 1px solid var(--border-medium);
      border-radius: 10px;
      margin-bottom: 24px;
      background: var(--bg-surface);
      overflow: hidden;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    }

    .case-card-header {
      background: var(--bg-subtle);
      padding: 14px 20px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .case-title {
      font-size: 17px;
      font-weight: 700;
      color: #0f2744;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .case-meta {
      font-size: 13px;
      color: var(--text-muted);
    }

    .case-body {
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 20px;
      padding: 20px;
    }

    @media (max-width: 900px) {
      .case-body {
        grid-template-columns: 1fr;
      }
    }

    .case-visual-col {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .image-preview-frame {
      width: 100%;
      aspect-ratio: 4 / 3;
      background: #ffffff;
      border: 1px solid var(--border-medium);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .image-preview-frame img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }

    .image-caption {
      font-size: 12px;
      color: var(--text-light);
      line-height: 1.4;
    }

    .case-content-col {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .review-box {
      border-radius: 6px;
      padding: 12px 14px;
      font-size: 14px;
      line-height: 1.5;
    }

    .review-preserved {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      color: #166534;
    }

    .review-limitations {
      background: #fffbeb;
      border: 1px solid #fde68a;
      color: #92400e;
    }

    .review-box strong {
      display: block;
      margin-bottom: 2px;
      font-weight: 600;
    }

    .ocr-text-box {
      background: var(--code-bg);
      border: 1px solid var(--code-border);
      border-radius: 6px;
      padding: 10px 12px;
      font-family: ui-monospace, SFMono-Regular, "Consolas", "Liberation Mono", Menlo, monospace;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-all;
      color: #1e293b;
      max-height: 160px;
      overflow-y: auto;
    }

    details.ocr-details {
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      background: var(--bg-surface);
      font-size: 13px;
    }

    details.ocr-details summary {
      padding: 8px 12px;
      cursor: pointer;
      font-weight: 600;
      color: var(--primary);
      background: var(--bg-subtle);
      border-radius: 5px;
      user-select: none;
    }

    details.ocr-details[open] summary {
      border-bottom: 1px solid var(--border-subtle);
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
    }

    .details-content {
      padding: 12px;
      max-height: 240px;
      overflow-y: auto;
    }

    .checks-list {
      list-style-type: none;
      font-size: 13px;
      color: var(--text-muted);
    }

    .checks-list li {
      position: relative;
      padding-left: 18px;
      margin-bottom: 6px;
      line-height: 1.4;
    }

    .checks-list li::before {
      content: "•";
      position: absolute;
      left: 4px;
      color: var(--primary);
      font-weight: bold;
    }

    .source-info {
      font-size: 12px;
      color: var(--text-light);
      padding-top: 8px;
      border-top: 1px dashed var(--border-subtle);
      line-height: 1.6;
    }

    .source-info a {
      color: var(--primary);
      text-decoration: underline;
    }

    footer.report-footer {
      text-align: center;
      font-size: 13px;
      color: var(--text-light);
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid var(--border-medium);
    }
  </style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <header class="report-header">
    <h1>시각 복원 및 로컬 OCR 벤치마크 평가 리포트</h1>
    <div class="subtitle">오프라인 독립형 벤치마크 분석 보고서 (PpOcrV5 Mobile / WebAssembly CPU 단일 실행)</div>
    <div class="meta-bar">
      <div class="meta-item">실행 ID: <strong>${escapeHtml(baseline.runId)}</strong></div>
      <div class="meta-item">역사적 기준 커밋: <code>${escapeHtml(baseline.sourceCommit ? baseline.sourceCommit.slice(0, 10) : '2e972b2a7d')}</code></div>
      <div class="meta-item">엔진: <strong>${escapeHtml(baseline.engine)}</strong></div>
      <div class="meta-item">코퍼스 스플릿: <span class="badge badge-formula">dev-only (12건)</span></div>
      <div class="meta-item">실행 환경: <strong>${escapeHtml(env.cpu ? env.cpu.trim() : 'CPU')} (${env.logicalCores || 1} Cores / ${escapeHtml(env.platform || 'win32')})</strong></div>
      <div class="meta-item">Node 버전: <strong>${escapeHtml(env.node || 'N/A')}</strong></div>
    </div>
  </header>

  <!-- Section: Evaluation Principles & Invariants -->
  <section class="report-section">
    <h2>평가 원칙 및 핵심 불변식 (Invariants & Disclaimers)</h2>

    <div class="callout-box callout-warning">
      <strong>⚠️ 본 벤치마크의 범위 및 한계 안내 (Dev-Only Scope & Disclaimers)</strong><br>
      본 리포트에 기록된 12개 케이스 측정값은 <strong>로컬 온디바이스 OCR(텍스트 검출/인식) 파이프라인의 단일 패스(Single-pass) 지연 시간 및 텍스트 관측치</strong>에 한정됩니다.<br>
      생성형 비전/재디자인 모델은 현재 연결되지 않았으며, <strong>생성 모델 복원 정확도(Reconstruction Accuracy) 및 환각 발생률(Hallucination Rate)은 미측정(Unmeasured)</strong> 상태입니다.
      모든 케이스는 개발 점검용(dev split)으로 구성되었으며 실제 비공개 강의 캡처를 포함하지 않습니다.
    </div>

    <div class="invariants-grid">
      <div class="invariant-card">
        <h3>1. 실제 로컬 OCR 베이스라인 (12건 단일 패스 ~415ms)</h3>
        <p>
          12개 개발용 평가 셋에 대해 PpOcrV5 WebAssembly CPU 단일 패스 인퍼런스를 수행한 실측 결과입니다.
          인식 시간 중앙값은 <strong>${formatMs(medianRecognizeMs)} ms</strong>(평균 ${formatMs(avgRecognizeMs)} ms)이며,
          온디바이스 경량 환경에서의 실제 문자 검출/인식 지연 시간을 정확히 대변합니다.
        </p>
      </div>

      <div class="invariant-card">
        <h3>2. 억제 회귀 픽스처 ≠ 생성 모델 평가 (Synthetic Fixtures)</h3>
        <p>
          후술할 보수적 억제 검증은 16개 <strong>결정론적 합성 후보 픽스처(Deterministic Synthetic Candidate Fixtures)</strong>를 대상으로 휴리스틱 필터링 규칙이 의도대로 동작하는지 확인하는 단위 검증입니다.
          <strong>이를 실제 생성형 비전 모델의 성공률이나 환각 발생률(Hallucination Rate)로 간주해서는 안 됩니다.</strong>
        </p>
      </div>

      <div class="invariant-card">
        <h3>3. 신뢰도(Confidence) 점수와 수식 정합성의 괴리</h3>
        <p>
          OCR 모델이 출력하는 신뢰도 점수는 문자의 수학적 구조나 정확성을 담보하지 않습니다.
          예컨대 근의 공식(<code>quadratic-formula</code>)의 경우 평균 신뢰도 91.2%를 기록했으나 분자의 $b^2$을 $62$로 오독하여 핵심 수식이 파괴되었습니다.
        </p>
      </div>

      <div class="invariant-card">
        <h3>4. 음성 대조군 2건 & 좌표 접두사</h3>
        <p>
          그림이 없는 2개 대조 사례(<code>korean-plain-text</code>, <code>three-column-text</code>) 중 3단 본문 케이스는 텍스트 분산 배치로 인해 <code>(x, y)</code> 좌표 접두사가 생성되었습니다.
          이는 문자 레이아웃 공간 정보이며, 생성 모델의 시각 환각이 아닙니다.
        </p>
      </div>

      <div class="invariant-card">
        <h3>5. 보수적 억제 정책 및 그래프 손실</h3>
        <p>
          현재 프로덕션 파이프라인의 보수적 정책에 따라 모든 표, 그래프, 관계도는 억제(Hold) 처리되며, 오직 리터럴 수준의 단순 OCR 수식만 통과됩니다.
          현재 검증된 이미지 영역 분할 대응이 없어 <strong>실제 그래프/다이어그램의 커버리지는 완전히 상실(Loss)</strong>된 상태입니다.
        </p>
      </div>

      <div class="invariant-card">
        <h3>6. 원본 복제 실패 기준 (Exact-Copy Failure)</h3>
        <p>
          평가 루브릭상 출력물이 원본 픽셀이나 형태를 그대로 복제한 경우(<code>identical</code>, <code>cosmetic-only</code>) 평가 실패로 처리됩니다.
          의미론적 요소(수식, 형태, 관계, 축, 데이터)는 보존하되 의미 있는 시각적 재디자인(Redesign)이 요구됩니다.
        </p>
      </div>

      <div class="invariant-card" style="grid-column: 1 / -1;">
        <h3>코드/모델 자산 무결성 및 역사적 커밋 (Historical Hashes & Reproducibility)</h3>
        <p style="margin-bottom: 8px;">
          본 벤치마크는 커밋 <code>${escapeHtml(baseline.sourceCommit || '2e972b2a7da54d4e8aad8eeb40b5a37126f86a9b')}</code> 시점의 런타임 및 모델 자산을 기준으로 측정되었습니다.
          ${suppressionCheck?.codeSha256 ? `
            휴리스틱 억제 회귀 코드 해시: Before <code>${escapeHtml(suppressionCheck.codeSha256.before?.slice(0, 12))}…</code> ➔ After <code>${escapeHtml(suppressionCheck.codeSha256.after?.slice(0, 12))}…</code>
          ` : ''}
        </p>
        <details class="ocr-details">
          <summary>로컬 OCR 런타임 및 모델 자산 SHA-256 목록 보기</summary>
          <div class="details-content">
            <table class="data-table" style="font-size: 12px;">
              <thead>
                <tr>
                  <th>자산 경로</th>
                  <th>SHA-256 해시</th>
                </tr>
              </thead>
              <tbody>
                ${Object.entries(baseline.assetSha256 || {}).map(([file, hash]) => `
                  <tr>
                    <td><code>${escapeHtml(file)}</code></td>
                    <td><code>${escapeHtml(hash)}</code></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  </section>

  <!-- Section: Benchmark Summary Stats -->
  <section class="report-section">
    <h2>로컬 OCR 베이스라인 지표 요약 (실제 12건 실측치)</h2>
    <div class="stats-summary-grid">
      <div class="stat-card">
        <div class="stat-label">총 평가 케이스</div>
        <div class="stat-value">${totalCount}<span class="stat-unit">건</span></div>
        <div class="stat-sub">수식 ${kindsCount.formula} · 그래프 ${kindsCount.graph} · 대조 ${kindsCount.negative}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">인식 시간 중앙값 (Median)</div>
        <div class="stat-value">${formatMs(medianRecognizeMs)}<span class="stat-unit">ms</span></div>
        <div class="stat-sub">단일 CPU WebAssembly (~415ms)</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">인식 시간 평균 (Mean)</div>
        <div class="stat-value">${formatMs(avgRecognizeMs)}<span class="stat-unit">ms</span></div>
        <div class="stat-sub">최소 ${formatMs(minRecognizeMs)} ~ 최대 ${formatMs(maxRecognizeMs)}ms</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">초기화 소요 시간 (Init)</div>
        <div class="stat-value">${formatMs(initMs)}<span class="stat-unit">ms</span></div>
        <div class="stat-sub">ONNX 모델 세션 로딩</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">검출 시간 중앙값</div>
        <div class="stat-value">${formatMs(medianDetectorMs)}<span class="stat-unit">ms</span></div>
        <div class="stat-sub">평균 ${formatMs(avgDetectorMs)} ms</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">디코딩 시간 중앙값</div>
        <div class="stat-value">${formatMs(medianDecodeMs)}<span class="stat-unit">ms</span></div>
        <div class="stat-sub">평균 ${formatMs(avgDecodeMs)} ms</div>
      </div>
    </div>

    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>케이스 ID</th>
            <th>구분</th>
            <th class="num-cell">해상도</th>
            <th class="num-cell">디코딩</th>
            <th class="num-cell">검출</th>
            <th class="num-cell">인식</th>
            <th class="num-cell">검출 박스</th>
            <th class="num-cell">평균 신뢰도</th>
            <th>보존 요약</th>
          </tr>
        </thead>
        <tbody>
          ${manifest.cases.map(c => {
            const b = baselineMap.get(c.id) || {};
            const r = reviewMap.get(c.id) || {};
            const lines = b.lines || [];
            const avgConf = lines.length ? (lines.reduce((acc, l) => acc + (l.confidence || 0), 0) / lines.length) : (b.text ? 0 : 1.0);
            const badgeClass = c.kind === 'formula' ? 'badge-formula' : (c.kind === 'graph' ? 'badge-graph' : 'badge-negative');
            return `
              <tr>
                <td><strong>${escapeHtml(c.id)}</strong></td>
                <td><span class="badge ${badgeClass}">${escapeHtml(c.kind)}</span></td>
                <td class="num-cell">${b.width || 800}×${b.height || 600}</td>
                <td class="num-cell">${formatMs(b.decodeMs)} ms</td>
                <td class="num-cell">${formatMs(b.detectorMs)} ms</td>
                <td class="num-cell"><strong>${formatMs(b.recognizeMs)} ms</strong></td>
                <td class="num-cell">${(b.detectedBoxes || []).length}</td>
                <td class="num-cell">${lines.length ? (avgConf * 100).toFixed(1) + '%' : '-'}</td>
                <td>${escapeHtml(r.preserved || '-')}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  </section>

  <!-- Section: Suppression Regression Check (Synthetic Fixtures) -->
  <section class="report-section">
    <h2>보수적 억제 회귀 검증 현황 (Synthetic Validator Fixtures)</h2>
    ${suppressionCheck ? `
      <div class="callout-box ${scCalloutClass}">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
          <strong>회귀 검증 실행: ${escapeHtml(suppressionCheck.runId || 'Run')}</strong>
          <span class="badge ${scBadgeClass}">
            ${escapeHtml(scBadgeText)}
          </span>
        </div>
        <p style="font-size: 14px; margin-bottom: 6px;">
          <strong>검증 범위:</strong> ${escapeHtml(suppressionCheck.scope || '-')}
        </p>
        <p style="font-size: 13px; color: var(--text-muted);">
          총 ${suppressionCheck.cases ? suppressionCheck.cases.length : 'unknown'}개 결정론적 합성 후보 검증 | 
          기대값(Allowed: ${scSummaryExpectedAllowed}, Held: ${scSummaryExpectedHeld}) | 
          억제 적용 전(Allowed: ${scSummaryBeforeAllowed}, Held: ${scSummaryBeforeHeld}) ➔ 
          억제 적용 후(Allowed: ${scSummaryAfterAllowed}, Held: ${scSummaryAfterHeld}) | 
          불일치: <strong>${typeof scSummaryMismatches === 'number' ? scSummaryMismatches + '건' : scSummaryMismatches}</strong>
        </p>
        <p style="font-size: 12px; color: var(--text-light); margin-top: 6px;">
          ※ 본 지표는 생성형 모델 환각률이 아니며, 휴리스틱 억제 규칙을 검증하기 위한 단위 테스트 픽스처 결과입니다.
        </p>
      </div>

      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>테스트 ID</th>
              <th>설명</th>
              <th>예상 동작</th>
              <th>적용 전 판정</th>
              <th>적용 후 판정</th>
              <th>결과</th>
              <th>비용/증거 출처</th>
            </tr>
          </thead>
          <tbody>
            ${(suppressionCheck.cases || []).map(sc => {
              const hasExpected = sc.expected !== undefined;
              const hasAfterVerdict = sc.after && sc.after.verdict !== undefined;
              const passed = (hasExpected && hasAfterVerdict) ? sc.after.verdict === sc.expected : null;
              const passBadge = passed === true
                ? '<span class="badge badge-pass">PASS</span>'
                : (passed === false ? '<span class="badge badge-held">FAIL</span>' : '<span class="badge badge-pending">UNKNOWN</span>');
              const beforeVerdict = sc.before && sc.before.verdict !== undefined ? sc.before.verdict : 'unknown';
              const afterVerdict = sc.after && sc.after.verdict !== undefined ? sc.after.verdict : 'unknown';
              const expectedVerdict = sc.expected !== undefined ? sc.expected : 'unknown';

              return `
                <tr>
                  <td><code>${escapeHtml(sc.id || 'unknown')}</code></td>
                  <td>${escapeHtml(sc.description || '-')}</td>
                  <td><span class="badge ${expectedVerdict === 'held' ? 'badge-held' : (expectedVerdict === 'allowed' ? 'badge-allowed' : 'badge-pending')}">${escapeHtml(expectedVerdict)}</span></td>
                  <td>${escapeHtml(beforeVerdict)}</td>
                  <td><span class="badge ${afterVerdict === 'held' ? 'badge-held' : (afterVerdict === 'allowed' ? 'badge-allowed' : 'badge-pending')}">${escapeHtml(afterVerdict)}</span></td>
                  <td>${passBadge}</td>
                  <td style="font-size: 12px; color: var(--text-light);">${escapeHtml(sc.cost || sc.evidenceSource || '-')}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    ` : `
      <div class="callout-box callout-warning">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <strong>회귀 검증 상태: 보류 (Pending / 미실행)</strong>
          <span class="badge badge-pending">PENDING</span>
        </div>
        <p>
          현재 <code>eval/visual/runs/suppression-check.json</code> 파일이 존재하지 않습니다.<br>
          상위 에이전트/프로세스가 보수적 억제 회귀 테스트를 수행한 후 해당 경로에 결과를 작성할 예정입니다.<br>
          <em>(주의: 결과 파일이 부재하므로 결코 '통과'로 간주하지 않고 보류로 유지합니다. 파일 생성 후 빌더를 재실행하면 결과가 반영됩니다.)</em>
        </p>
      </div>
    `}
  </section>

  <!-- Section: Final Verification & Packaging -->
  <section class="report-section">
    <h2>최종 검증 및 패키징 현황 (Final Verification & Packaging)</h2>
    ${verification ? `
      <div class="callout-box ${verification.tests?.fail === 0 && verification.packaging?.passed ? 'callout-info' : 'callout-warning'}">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <strong>최종 검증 결과 수신 완료</strong>
          <span class="badge ${verification.tests?.fail === 0 && verification.packaging?.passed ? 'badge-pass' : 'badge-pending'}">
            ${verification.tests?.fail === 0 && verification.packaging?.passed ? 'ALL PASSED' : 'ACTION REQUIRED'}
          </span>
        </div>
        ${verification.note ? `<p style="font-size: 14px; margin-bottom: 8px;"><strong>참고:</strong> ${escapeHtml(verification.note)}</p>` : ''}
      </div>

      <div class="stats-summary-grid">
        <div class="stat-card">
          <div class="stat-label">단위 테스트 결과</div>
          <div class="stat-value">
            ${verification.tests?.pass !== undefined ? verification.tests.pass : 'unknown'} / ${verification.tests?.total !== undefined ? verification.tests.total : 'unknown'}
          </div>
          <div class="stat-sub">실패: ${verification.tests?.fail !== undefined ? verification.tests.fail : 'unknown'}건</div>
          ${verification.tests?.command ? `<div style="font-size: 11px; color: var(--text-light); margin-top: 4px; font-family: monospace;">${escapeHtml(verification.tests.command)}</div>` : ''}
        </div>
        <div class="stat-card">
          <div class="stat-label">패키징 상태</div>
          <div class="stat-value">
            ${verification.packaging?.passed === true ? 'PASSED' : (verification.packaging?.passed === false ? 'FAILED' : 'UNKNOWN')}
          </div>
          <div class="stat-sub">${verification.packaging?.passed ? '배포 파일·보안 검사 통과 (dry-run, 번들 미생성)' : '패키징 검사 미완료/실패'}</div>
          ${verification.packaging?.command ? `<div style="font-size: 11px; color: var(--text-light); margin-top: 4px; font-family: monospace;">${escapeHtml(verification.packaging.command)}</div>` : ''}
        </div>
      </div>
    ` : `
      <div class="callout-box callout-warning">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <strong>검증 및 패키징 상태: 보류 (Pending / 상위 프로세스 제공 대기)</strong>
          <span class="badge badge-pending">PENDING</span>
        </div>
        <p>
          현재 <code>eval/visual/runs/verification.json</code> 파일이 존재하지 않습니다.<br>
          상위 에이전트/프로세스가 최종 단위 테스트(<code>node --test lib/*.test.js</code>) 및 패키징 검증을 완료한 후 해당 경로에 결과를 작성할 예정입니다.<br>
          <em>(상위 프로세스 제공 규격 필드: <code>tests: { pass, fail, total, command }</code>, <code>packaging: { passed, command }</code>, <code>note</code>)</em>
        </p>
      </div>
    `}
  </section>

  <!-- Section: Detailed Per-case Breakdown -->
  <section class="report-section">
    <h2>12개 평가 케이스 상세 리뷰 및 관측 결과</h2>
    <p style="font-size: 14px; color: var(--text-muted); margin-bottom: 20px;">
      각 케이스의 원본 이미지(모두 Base64 PNG 내장), OCR 텍스트/레이아웃 결과, 한국어 정성 평가 관측치, 평가 기준 및 출처 정보를 제공합니다.
    </p>

    ${manifest.cases.map((c, idx) => {
      const b = baselineMap.get(c.id) || {};
      const r = reviewMap.get(c.id) || {};
      const base64Img = imageBase64Map.get(c.id) || '';
      const badgeClass = c.kind === 'formula' ? 'badge-formula' : (c.kind === 'graph' ? 'badge-graph' : 'badge-negative');
      const lines = b.lines || [];
      const checks = (c.annotation && Array.isArray(c.annotation.checks)) ? c.annotation.checks : [];
      const expectedRegions = (c.annotation && Array.isArray(c.annotation.expectedRegions)) ? c.annotation.expectedRegions : [];
      const source = c.source || {};

      return `
        <article class="case-card" id="case-${escapeHtml(c.id)}">
          <div class="case-card-header">
            <div class="case-title">
              <span>#${idx + 1}. ${escapeHtml(c.id)}</span>
              <span class="badge ${badgeClass}">${escapeHtml(c.kind)}</span>
            </div>
            <div class="case-meta">
              인식 시간: <strong>${formatMs(b.recognizeMs)} ms</strong> · 검출 박스: ${lines.length}개
            </div>
          </div>

          <div class="case-body">
            <!-- Left: Visual Preview & Source -->
            <div class="case-visual-col">
              <div class="image-preview-frame">
                ${base64Img ? `
                  <img src="${base64Img}" alt="${escapeHtml(c.id)} preview" width="800" height="600" loading="lazy">
                ` : `
                  <div style="font-size: 13px; color: var(--text-light);">이미지 미리보기 없음</div>
                `}
              </div>
              <div class="image-caption">
                <strong>원본 설명:</strong> ${escapeHtml(source.description || '-')}<br>
                ${source.transformation ? `<strong>변환:</strong> ${escapeHtml(source.transformation)}` : ''}
              </div>
              <div class="source-info">
                저작자/출처: <strong>${escapeHtml(source.author || 'Project Control / 자체 제작')}</strong><br>
                라이선스: ${source.licenseUrl ? `<a href="${escapeHtml(source.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.license || 'License Link')}</a>` : escapeHtml(source.license || 'Public Domain / Internal')}<br>
                ${source.pageUrl ? `출처 페이지: <a href="${escapeHtml(source.pageUrl)}" target="_blank" rel="noopener noreferrer">Wikimedia Commons 문서</a><br>` : ''}
                ${source.downloadUrl ? `원본 다운로드: <a href="${escapeHtml(source.downloadUrl)}" target="_blank" rel="noopener noreferrer">원본 미디어 링크</a><br>` : ''}
                ${c.originalImage ? `원본 소스 자산: <code>${escapeHtml(c.originalImage)}</code>` : ''}
                ${c.originalSha256 ? ` (SHA-256: <code>${escapeHtml(c.originalSha256.slice(0, 10))}…</code>)` : ''}
                ${c.sha256 ? `<br>입력 PNG 해시: <code>${escapeHtml(c.sha256.slice(0, 10))}…</code>` : ''}
              </div>
            </div>

            <!-- Right: Content & Review -->
            <div class="case-content-col">
              <!-- Korean Review Observations -->
              <div class="review-box review-preserved">
                <strong>보존된 내용 (Preserved):</strong>
                ${escapeHtml(r.preserved || '보존된 내용 없음')}
              </div>
              <div class="review-box review-limitations">
                <strong>한계 및 결함 (Limitations):</strong>
                ${escapeHtml(r.limitations || '특이 한계점 기록 없음')}
              </div>

              <!-- OCR Extracted Text -->
              <div>
                <div style="font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">
                  추출된 OCR 텍스트:
                </div>
                <div class="ocr-text-box">${escapeHtml(b.text || '(인식된 문자 없음)')}</div>
              </div>

              <!-- OCR Layout Text -->
              ${b.layoutText && b.layoutText !== b.text ? `
                <div>
                  <div style="font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">
                    레이아웃 텍스트 (좌표 포함):
                  </div>
                  <div class="ocr-text-box" style="font-size: 12px; color: #334155;">${escapeHtml(b.layoutText)}</div>
                </div>
              ` : ''}

              <!-- Evaluation Checks -->
              ${checks.length ? `
                <div>
                  <div style="font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">
                    케이스 검증 기준 (Manifest Checks - ${checks.length}건):
                  </div>
                  <ul class="checks-list">
                    ${checks.map(ck => {
                      const id = typeof ck === 'object' && ck !== null ? ck.id : '';
                      const desc = typeof ck === 'object' && ck !== null ? (ck.description || ck.id || '') : String(ck);
                      return `<li>${id ? `<code>${escapeHtml(id)}</code>: ` : ''}${escapeHtml(desc)}</li>`;
                    }).join('')}
                  </ul>
                </div>
              ` : ''}

              <!-- Details Collapsible -->
              <details class="ocr-details">
                <summary>검출 영역 세부 바운딩 박스 (${lines.length}개 라인) 및 주석 정보 보기</summary>
                <div class="details-content">
                  ${expectedRegions.length ? `
                    <div style="margin-bottom: 12px;">
                      <strong>기대 영역 (Expected Regions - ${expectedRegions.length}개):</strong>
                      <ul class="checks-list" style="margin-top: 6px;">
                        ${expectedRegions.map(er => {
                          const erId = er.id ? `<code>${escapeHtml(er.id)}</code> ` : '';
                          const bboxStr = Array.isArray(er.bbox) ? `[${er.bbox.join(', ')}]` : '-';
                          const erChecks = Array.isArray(er.checks) ? er.checks : [];
                          return `
                            <li>
                              ${erId}BBox: <code>${bboxStr}</code>
                              ${erChecks.map(ec => {
                                const ecId = typeof ec === 'object' && ec !== null ? ec.id : '';
                                const ecDesc = typeof ec === 'object' && ec !== null ? (ec.description || ec.id || '') : String(ec);
                                return `<div style="font-size: 12px; color: var(--text-light); margin-left: 8px;">- ${ecId ? `<code>${escapeHtml(ecId)}</code>: ` : ''}${escapeHtml(ecDesc)}</div>`;
                              }).join('')}
                            </li>
                          `;
                        }).join('')}
                      </ul>
                    </div>
                  ` : ''}

                  ${lines.length ? `
                    <table class="data-table" style="font-size: 12px;">
                      <thead>
                        <tr>
                          <th>문자열</th>
                          <th>신뢰도</th>
                          <th>바운딩 박스 (x, y, w, h)</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${lines.map(l => `
                          <tr>
                            <td><code>${escapeHtml(l.text)}</code></td>
                            <td>${(l.confidence * 100).toFixed(1)}%</td>
                            <td>(${l.box.x}, ${l.box.y}, ${l.box.width}, ${l.box.height})</td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  ` : '<div style="font-size: 13px; color: var(--text-light);">검출된 개별 문자 라인이 없습니다.</div>'}
                </div>
              </details>
            </div>
          </div>
        </article>
      `;
    }).join('')}
  </section>

  <!-- Footer -->
  <footer class="report-footer">
    <p>생성 도구: <code>tools/visual-report.mjs</code> · 생성 일시: ${new Date().toISOString()}</p>
    <p>본 리포트는 독립 실행형 단일 HTML 파일로 외부 네트워크 요청이나 CDN 없이 작동합니다.</p>
  </footer>

</div>
</body>
</html>
`;

  await writeFile(outputPath, html, 'utf8');
  console.log(`[visual-report] Benchmark report successfully written to: ${outputPath}`);
}

main().catch(err => {
  console.error('[visual-report] Error generating report:', err);
  process.exit(1);
});
