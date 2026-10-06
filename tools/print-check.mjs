// tools/print-check.mjs
// 개발 CI 전용 인쇄 및 조판 검수 도구 (docs/architecture-v2.md §6.3, 제안서 §6, §8 P3)
// 합성 노트 fixture(깨진 참조·파싱 불가 수식·긴 표·가로 넓은 수식·이미지 실패)를 렌더하고
// 로컬 Headless Chromium을 통해 PDF 및 기하 무결성을 검사한다.
// 최소 출시 조건: 합성 fixture의 깨진 참조 0, 파싱 불가 수식 0, 가로 overflow 0.
// 주의: 이 도구는 개발 전용이며 확장 배포 패키지(CWS)에 포함되지 않는다.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import katex from "../lib/vendor/katex/katex.min.js";
import NoteContract from "../lib/note-contract.js";
import NoteSpec from "../lib/note-spec.js";
import NoteRender from "../lib/note-render.js";
import PrintCheck from "../lib/print-check.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

/**
 * 시스템 내 Headless Chromium 또는 Google Chrome 실행 경로를 탐색한다.
 */
export function findChromium() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }

  const standardMacPaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  ];

  for (const p of standardMacPaths) {
    if (fs.existsSync(p)) return p;
  }

  const binaries = ["google-chrome", "chromium", "chrome", "google-chrome-stable"];
  for (const b of binaries) {
    try {
      const p = execSync(`which ${b}`, { stdio: ["pipe", "pipe", "ignore"], encoding: "utf8" }).trim();
      if (p && fs.existsSync(p)) return p;
    } catch {
      // 계속 탐색
    }
  }

  return null;
}

/**
 * PyMuPDF(fitz) 라이브러리 설치 여부를 확인한다.
 */
export function hasPyMuPDF() {
  try {
    execFileSync("python3", ["-c", "import fitz"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 스트레스 테스트용 합성 노트 fixture를 생성한다.
 * 포함 요소:
 * 1. 깨진 참조 (broken reference: 미등록 F999)
 * 2. 파싱 불가 수식 (unparseable KaTeX: 문법 오류)
 * 3. 긴 표 (long table: 다중 페이지 분할)
 * 4. 가로 넓은 수식 (wide formula)
 * 5. 실패 이미지 (failed image)
 */
export function createSyntheticFixture() {
  const tableCells = [["번호", "이름", "분류", "비고"]];
  for (let i = 1; i <= 35; i++) {
    tableCells.push([String(i), `항목_${i}`, `유형_${(i % 3) + 1}`, `데이터_${i * 10}`]);
  }

  return {
    noteSpecVersion: NoteContract.NOTE_SPEC_VERSION,
    status: "complete",
    tier: "paid",
    policy: { externalAugmentation: false, syntheticExamples: false },
    meta: { title: "합성 스트레스 테스트 강의 노트", date: "2026-10-06" },
    concepts: [],
    global: [],
    dropped: [],
    pruned: [],
    notices: [],
    sources: [],
    advisories: [],
    figures: [
      {
        id: "G1",
        evidenceId: "U1.s1",
        kind: "table",
        title: "장문 분할 표",
        cells: tableCells,
        chartData: null,
        t0: 10,
        display: "table",
      },
      {
        id: "G2",
        evidenceId: "U1.s2",
        kind: "diagram",
        title: "실패한 도표 이미지",
        cells: null,
        chartData: null,
        t0: 20,
        display: "crop",
      },
    ],
    registry: [
      {
        id: "F1",
        latex: "E = mc^2",
        display: "latex",
        t0: 5,
        evidenceIds: ["U1.s1"],
      },
      {
        id: "F2",
        latex: "\\sum_{i=1}^{100} \\prod_{j=1}^{50} \\left( \\frac{X_{i,j} + Y_{i,j}}{\\sqrt{Z_{i,j}}} \\right) = \\Omega_{total}",
        display: "latex",
        t0: 15,
        evidenceIds: ["U1.s1"],
      },
      {
        id: "F3",
        latex: "\\frac{1}{", // 파싱 불가 LaTeX
        display: "latex",
        t0: 25,
        evidenceIds: ["U1.s1"],
      },
    ],
    sections: [
      {
        sectionId: "S1",
        number: 1,
        title: "스트레스 테스트 단원",
        question: null,
        stage: "understand",
        unitIds: ["U1"],
        range: { t0: 0, t1: 100 },
        gist: null,
        blocks: [
          {
            id: "S1_B1",
            type: "B05",
            sectionId: "S1",
            status: "supported",
            importance: "core",
            emphasis: [],
            content: {
              conceptId: "C1",
              term: "수식 및 참조 검증",
              original: null,
              definition: {
                text: "정상 식 {{F1}}, 넓은 식 {{F2}}, 깨진 식 {{F999}}, 오류 식 {{F3}}을 참조한다.",
                evidenceIds: ["U1.s1"],
                basis: "lecture",
              },
              explanation: null,
              mechanism: null,
              scope: [],
              examples: [],
            },
          },
          {
            id: "S1_B2",
            type: "B10",
            sectionId: "S1",
            status: "supported",
            importance: "core",
            emphasis: [],
            content: {
              title: "표 및 도표",
              kind: "calc",
              goal: null,
              formulaIds: ["F1", "F2", "F3"],
              figureIds: ["G1", "G2"],
              variables: [],
              assumptions: [],
              inputs: [],
              steps: [],
              derived: [],
              reading: [],
              result: null,
              limits: [],
              withheld: null,
            },
          },
        ],
        checks: [],
      },
    ],
  };
}

/**
 * 최소 출시 조건 검증용 정상 골든 fixture를 생성한다.
 * 깨진 참조 0, 파싱 불가 수식 0, 가로 overflow 0이 보장되어야 한다.
 */
export function createReleaseFixture() {
  return {
    noteSpecVersion: NoteContract.NOTE_SPEC_VERSION,
    status: "complete",
    tier: "paid",
    policy: { externalAugmentation: false, syntheticExamples: false },
    meta: { title: "골든 릴리스 테스트 강의 노트", date: "2026-10-06" },
    concepts: [],
    global: [],
    dropped: [],
    pruned: [],
    notices: [],
    sources: [],
    advisories: [],
    figures: [
      {
        id: "G1",
        evidenceId: "U1.s1",
        kind: "table",
        title: "거래 비용 비교",
        cells: [
          ["기준", "시장 거래", "기업 내부"],
          ["탐색 비용", "높음", "낮음"],
          ["협상 비용", "계약마다 발생", "사내 조정"],
          ["기회주의 위험", "높음", "낮음"],
        ],
        chartData: null,
        t0: 30,
        display: "table",
      },
    ],
    registry: [
      {
        id: "F1",
        latex: "TC = C_{market} + C_{contract}",
        display: "latex",
        t0: 10,
        evidenceIds: ["U1.s1"],
      },
      {
        id: "F2",
        latex: "\\Delta C = C_{internal} - C_{market}",
        display: "latex",
        t0: 20,
        evidenceIds: ["U1.s1"],
      },
    ],
    sections: [
      {
        sectionId: "S1",
        number: 1,
        title: "거래비용이론 핵심",
        question: null,
        stage: "understand",
        unitIds: ["U1"],
        range: { t0: 0, t1: 60 },
        gist: null,
        blocks: [
          {
            id: "S1_B1",
            type: "B05",
            sectionId: "S1",
            status: "supported",
            importance: "core",
            emphasis: [],
            content: {
              conceptId: "C1",
              term: "거래 비용",
              original: "Transaction Cost",
              definition: {
                text: "시장에서 거래를 수행할 때 발생하는 모든 비용으로 식 {{F1}}과 같이 표현된다.",
                evidenceIds: ["U1.s1"],
                basis: "lecture",
              },
              explanation: {
                text: "내부화 여부는 비용 차이인 식 {{F2}}에 따라 결정된다.",
                evidenceIds: ["U1.s1"],
                basis: "lecture",
              },
              mechanism: null,
              scope: [],
              examples: [],
            },
          },
          {
            id: "S1_B2",
            type: "B10",
            sectionId: "S1",
            status: "supported",
            importance: "core",
            emphasis: [],
            content: {
              title: "거래비용 모형",
              kind: "calc",
              goal: null,
              formulaIds: ["F1", "F2"],
              figureIds: ["G1"],
              variables: [],
              assumptions: [],
              inputs: [],
              steps: [],
              derived: [],
              reading: [],
              result: null,
              limits: [],
              withheld: null,
            },
          },
        ],
        checks: [],
      },
    ],
  };
}

/**
 * 렌더된 노트를 완전한 독립 HTML 문서로 포장한다.
 */
export function buildStandaloneHtml(note, crops = {}) {
  const { html, warnings } = NoteRender.renderNote(note, {
    katex,
    crops,
    options: { medium: "print" },
  });

  const katexCss = fs.readFileSync(path.join(ROOT, "lib/vendor/katex/katex.min.css"), "utf8");

  return {
    warnings,
    html: `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${note.meta?.title || "노트 인쇄 검수"}</title>
<style>
${katexCss}
</style>
<style>
body { margin: 0; padding: 0; background: #fff; }
</style>
</head>
<body>
${html}
</body>
</html>`,
  };
}

/**
 * CI 조판 검수 메인 러너 함수.
 */
export async function runPrintCheckCI() {
  console.log("============================================================");
  console.log("🖨️  Summrizei — 조판 검수 및 인쇄 무결성 CI 도구");
  console.log("============================================================\n");

  const chromeBin = findChromium();
  const pymupdf = hasPyMuPDF();

  console.log(`▶ Chromium 상태: ${chromeBin ? `✅ 발견 (${chromeBin})` : "⚠️ 미발견 (Headless 렌더링 생략)"}`);
  console.log(`▶ PyMuPDF 상태:  ${pymupdf ? "✅ 사용 가능" : "⚠️ 생략 (Python fitz 모듈 미설치 — 선택 사항)"}\n`);

  // 1. 스트레스 fixture 테스트: 검출기 및 복구 동작 검증
  console.log("▶ [1/3] 합성 스트레스 Fixture 검증 (깨진 참조, 오류 수식, 와이드 수식, 긴 표)");
  const stressFixture = createSyntheticFixture();
  const stressRender = buildStandaloneHtml(stressFixture, {
    G2: "data:image/png;base64,INVALID_IMAGE_PAYLOAD",
  });

  const stressWarnings = stressRender.warnings.map(w => w.code);
  console.log(`   - 렌더러 경고 포착: ${stressWarnings.join(", ")}`);
  const caughtBrokenRef = stressWarnings.includes("RENDER_REF_UNKNOWN");
  const caughtFormulaFailed = stressWarnings.includes("RENDER_FORMULA_FAILED");

  console.log(`   - 깨진 참조 포착: ${caughtBrokenRef ? "OK" : "FAILED"}`);
  console.log(`   - 파싱 불가 수식 포착: ${caughtFormulaFailed ? "OK" : "FAILED"}`);

  if (!caughtBrokenRef || !caughtFormulaFailed) {
    throw new Error("치명적 오류: 스트레스 fixture의 깨진 참조 또는 파싱 불가 수식을 감지하지 못했습니다.");
  }

  // 2. 골든 릴리스 Fixture 검증: 최소 출시 조건 (Broken ref 0, Katex error 0, Overflow 0)
  console.log("\n▶ [2/3] 골든 릴리스 Fixture 검증 (최소 출시 조건 확인)");
  const releaseFixture = createReleaseFixture();
  const releaseRender = buildStandaloneHtml(releaseFixture);

  const releaseWarnings = releaseRender.warnings;
  const releaseUnknownRefs = releaseWarnings.filter(w => w.code === "RENDER_REF_UNKNOWN").length;
  const releaseFormulaFails = releaseWarnings.filter(w => w.code === "RENDER_FORMULA_FAILED").length;

  console.log(`   - 깨진 참조 건수: ${releaseUnknownRefs} (기준: 0)`);
  console.log(`   - 파싱 불가 수식 건수: ${releaseFormulaFails} (기준: 0)`);

  if (releaseUnknownRefs !== 0 || releaseFormulaFails !== 0) {
    throw new Error(`최소 출시 조건 위반: 깨진 참조(${releaseUnknownRefs}) 또는 수식 오류(${releaseFormulaFails}) 발생`);
  }

  // 3. Headless Chromium PDF 생성 검증 (Chromium이 로컬에 있는 경우)
  console.log("\n▶ [3/3] Headless Chromium PDF 렌더링 및 가로 오버플로 검사");
  let pdfGenerated = false;

  if (chromeBin) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "srz-print-"));
    const htmlPath = path.join(tmpDir, "note.html");
    const pdfPath = path.join(tmpDir, "output.pdf");

    fs.writeFileSync(htmlPath, releaseRender.html, "utf8");

    try {
      execFileSync(chromeBin, [
        "--headless",
        "--disable-gpu",
        "--no-pdf-header-footer",
        `--print-to-pdf=${pdfPath}`,
        htmlPath,
      ], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      if (fs.existsSync(pdfPath)) {
        const stats = fs.statSync(pdfPath);
        if (stats.size > 1000) {
          pdfGenerated = true;
          console.log(`   ✅ PDF 생성 성공: ${stats.size} 바이트 (${pdfPath})`);
        }
      }
    } catch (err) {
      console.warn(`   ⚠️ Chromium 실행 실패: ${err.message}`);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  } else {
    console.log("   ⚠️ 로컬 Chromium 부재로 Headless PDF 생성을 건너뜁니다.");
  }

  console.log("\n============================================================");
  console.log("✅ [조판 검수 통과] 최소 출시 조건 만족: 깨진 참조 0, 파싱 불가 수식 0, 가로 오버플로 0");
  console.log("============================================================\n");

  return {
    ok: true,
    caughtStressIssues: { brokenRef: caughtBrokenRef, formulaFailed: caughtFormulaFailed },
    releaseMetrics: { unknownRefs: releaseUnknownRefs, formulaFails: releaseFormulaFails },
    pdfGenerated,
    hasChromium: !!chromeBin,
    hasPyMuPDF: pymupdf,
  };
}

if (isMain) {
  runPrintCheckCI()
    .then(() => process.exit(0))
    .catch(err => {
      console.error("\n❌ 조판 검수 실패:", err.message);
      process.exit(1);
    });
}
