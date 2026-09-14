// 7개 모델 및 종합 요약의 고품질 PDF 일괄 생성 스크립트
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const dir1 = path.join(ROOT, "electric_circuits_summaries");
const dir2 = path.join(ROOT, "electric_circuits_note_example");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
if (!fs.existsSync(CHROME_PATH)) {
  console.error("Chrome 실행 파일이 없습니다:", CHROME_PATH);
  process.exit(1);
}

// 템플릿 HTML 생성 함수 (KaTeX, SVG, 테이블, 다이어그램이 PDF에 완벽히 인쇄되도록 설정)
function createPdfHtml(title, subtitle, markdownContent) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked@13.0.2/marked.min.js"></script>
  <style>
    @page {
      size: A4;
      margin: 18mm 14mm 18mm 14mm;
      @bottom-right {
        content: counter(page);
      }
    }
    *, *::before, *::after {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Segoe UI", Roboto, sans-serif;
      font-size: 10.5pt;
      line-height: 1.6;
      color: #1e293b;
      background: #ffffff;
      margin: 0;
      padding: 0;
    }
    .doc-header {
      border-bottom: 2.5px solid #0284c7;
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    .doc-header h1 {
      font-size: 18pt;
      color: #0f172a;
      margin: 0 0 6px 0;
      font-weight: 800;
    }
    .doc-header .meta {
      font-size: 9pt;
      color: #64748b;
    }
    h1, h2, h3, h4 {
      color: #0f172a;
      font-weight: 700;
      page-break-after: avoid;
    }
    h2 {
      font-size: 13pt;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 6px;
      margin-top: 24px;
      margin-bottom: 12px;
      color: #0369a1;
    }
    h3 {
      font-size: 11.5pt;
      margin-top: 18px;
      margin-bottom: 8px;
    }
    h4 {
      font-size: 10.5pt;
      margin-top: 14px;
      margin-bottom: 6px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
      font-size: 9.5pt;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 8px 10px;
      text-align: left;
    }
    th {
      background-color: #f1f5f9 !important;
      color: #0f172a;
      font-weight: 700;
    }
    tr:nth-child(even) td {
      background-color: #f8fafc !important;
    }
    blockquote {
      border-left: 4px solid #0284c7;
      margin: 12px 0;
      padding: 6px 14px;
      background: #f0f9ff !important;
      border-radius: 0 6px 6px 0;
      color: #334155;
      font-size: 9.5pt;
    }
    code {
      font-family: Consolas, "Courier New", monospace;
      font-size: 9pt;
      background: #f1f5f9 !important;
      color: #0369a1;
      padding: 1px 5px;
      border-radius: 4px;
      border: 1px solid #e2e8f0;
    }
    pre {
      background: #0f172a !important;
      color: #f8fafc !important;
      padding: 12px;
      border-radius: 6px;
      font-size: 8.5pt;
      overflow-x: auto;
      page-break-inside: avoid;
    }
    pre code {
      background: transparent !important;
      border: none;
      color: #f8fafc !important;
    }
    svg {
      max-width: 100% !important;
      height: auto !important;
      page-break-inside: avoid !important;
      display: block;
      margin: 10px auto;
    }
    div[align="center"] {
      page-break-inside: avoid !important;
      margin: 12px 0;
    }
    .katex-display {
      margin: 10px 0 !important;
      overflow-x: auto;
      overflow-y: hidden;
    }
    ul, ol {
      margin: 8px 0;
      padding-left: 22px;
    }
    li {
      margin-bottom: 4px;
    }
    hr {
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="doc-header">
    <h1>${title}</h1>
    <div class="meta">${subtitle}</div>
  </div>
  <div id="content"></div>
  <script>
    const rawMd = ${JSON.stringify(markdownContent)};
    const contentEl = document.getElementById('content');
    contentEl.innerHTML = marked.parse(rawMd);
    renderMathInElement(contentEl, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false }
      ],
      throwOnError: false
    });
    // PDF 렌더 준비 완료 알림
    document.title = "READY_FOR_PDF";
  </script>
</body>
</html>`;
}

function generatePdfForFile(slug, title, subtitle) {
  const mdPath = path.join(dir1, `${slug}.md`);
  if (!fs.existsSync(mdPath)) {
    console.error("파일 없음:", mdPath);
    return;
  }
  const mdContent = fs.readFileSync(mdPath, "utf8");

  const tempHtmlPath = path.join(dir1, `_temp_${slug}.html`);
  const outPdfPath1 = path.join(dir1, `${slug}.pdf`);
  const outPdfPath2 = path.join(dir2, `${slug}.pdf`);

  const html = createPdfHtml(title, subtitle, mdContent);
  fs.writeFileSync(tempHtmlPath, html, "utf8");

  try {
    const cmd = `"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --run-all-compositor-stages-before-draw "--print-to-pdf=${outPdfPath1}" "${tempHtmlPath}"`;
    execSync(cmd, { stdio: "pipe" });

    if (fs.existsSync(outPdfPath1)) {
      const bytes = fs.statSync(outPdfPath1).size;
      fs.copyFileSync(outPdfPath1, outPdfPath2);
      console.log(`📄 [PDF 생성 완료] ${slug}.pdf (${(bytes / 1024).toFixed(1)} KB)`);
    } else {
      console.error(`❌ [PDF 실패] ${slug}.pdf 생성되지 않음`);
    }
  } catch (err) {
    console.error(`❌ [PDF 에러] ${slug}:`, err.message);
  } finally {
    if (fs.existsSync(tempHtmlPath)) {
      fs.unlinkSync(tempHtmlPath);
    }
  }
}

async function main() {
  console.log("=== 7개 모델 및 종합 보고서 PDF 생성 시작 ===");

  const items = [
    { slug: "00_COMPREHENSIVE_COMPARISON", title: "7개 AI 모델 반도체 물리 강의 요약 종합 보고서", subtitle: "Basic Semiconductor Physics | 마스터 그림 갤러리 및 전체 모델 비교" },
    { slug: "01_deepseek_v4_flash", title: "DeepSeek V4 Flash 0731 강의 요약 노트", subtitle: "모델 ID: deepseek/deepseek-v4-flash-0731 | 시각 다이어그램 완비본" },
    { slug: "02_qwen3.5_122b", title: "Qwen3.5 122B-A10B 강의 요약 노트", subtitle: "모델 ID: qwen/qwen3.5-122b-a10b | 시각 다이어그램 완비본" },
    { slug: "03_qwen3.8_2.4t", title: "Qwen3.8 2.4T-A95B 강의 요약 노트", subtitle: "모델 ID: qwen/qwen3.8-2.4t-a95b | 시각 다이어그램 완비본" },
    { slug: "04_gemini_3.1_flash_lite", title: "Gemini 3.1 Flash-Lite 강의 요약 노트", subtitle: "모델 ID: google/gemini-3.1-flash-lite | 시각 다이어그램 완비본" },
    { slug: "05_claude_haiku_4.5", title: "Claude Haiku 4.5 강의 요약 노트", subtitle: "모델 ID: anthropic/claude-haiku-4.5 | 시각 다이어그램 완비본" },
    { slug: "06_claude_sonnet_5", title: "Claude Sonnet 5 강의 요약 노트", subtitle: "모델 ID: anthropic/claude-sonnet-5 | 시각 다이어그램 완비본" },
    { slug: "07_gemini_3.8_flash", title: "Gemini 3.8 Flash 강의 요약 노트", subtitle: "모델 ID: google/gemini-3.8-flash | 시각 다이어그램 완비본" }
  ];

  for (const item of items) {
    generatePdfForFile(item.slug, item.title, item.subtitle);
  }

  console.log("\n✅ 모든 PDF 생성이 완료되었습니다!");
  console.log(`- 디렉토리 1: ${dir1}`);
  console.log(`- 디렉토리 2: ${dir2}`);
}

main().catch(console.error);
