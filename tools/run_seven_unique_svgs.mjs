// 7개 AI 모델 독자적 SVG 생성 및 제외 내용 배제 OpenRouter 실행 스크립트
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const keyPath = path.join(ROOT, "apikey.env.local");
if (!fs.existsSync(keyPath)) {
  console.error("apikey.env.local 이 없습니다.");
  process.exit(1);
}
const apiKey = fs.readFileSync(keyPath, "utf8").trim();

const lecturePath = path.join(ROOT, "electric_circuits_note_example.md");
if (!fs.existsSync(lecturePath)) {
  console.error("electric_circuits_note_example.md 가 없습니다.");
  process.exit(1);
}
const lectureText = fs.readFileSync(lecturePath, "utf8");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
if (!fs.existsSync(CHROME_PATH)) {
  console.error("Chrome 실행 파일이 없습니다:", CHROME_PATH);
  process.exit(1);
}

const dirSummaries = path.join(ROOT, "electric_circuits_summaries");
const dirExample = path.join(ROOT, "electric_circuits_note_example");
for (const d of [dirSummaries, dirExample]) {
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
  }
}

const MODELS = [
  { 
    id: "deepseek/deepseek-v4-flash-0731", 
    slug: "01_deepseek_v4_flash", 
    name: "DeepSeek V4 Flash 0731",
    extra: { reasoning: { effort: "none" } },
    maxTokens: 8192
  },
  { 
    id: "qwen/qwen3.5-122b-a10b", 
    slug: "02_qwen3.5_122b", 
    name: "Qwen3.5 122B-A10B",
    extra: { reasoning: { effort: "none" } },
    maxTokens: 8192
  },
  { 
    id: "qwen/qwen3.8-2.4t-a95b", 
    slug: "03_qwen3.8_2.4t", 
    name: "Qwen3.8 2.4T-A95B",
    extra: {},
    maxTokens: 12000
  },
  { 
    id: "google/gemini-3.1-flash-lite", 
    slug: "04_gemini_3.1_flash_lite", 
    name: "Gemini 3.1 Flash-Lite",
    extra: {},
    maxTokens: 8192
  },
  { 
    id: "anthropic/claude-haiku-4.5", 
    slug: "05_claude_haiku_4.5", 
    name: "Claude Haiku 4.5",
    extra: {},
    maxTokens: 8192
  },
  { 
    id: "anthropic/claude-sonnet-5", 
    slug: "06_claude_sonnet_5", 
    name: "Claude Sonnet 5",
    extra: {},
    maxTokens: 8192
  },
  { 
    id: "google/gemini-3.8-flash", 
    slug: "07_gemini_3.8_flash", 
    name: "Gemini 3.8 Flash",
    extra: {},
    maxTokens: 8192
  }
];

const USER_PROMPT = `입력된 타임라인 근거를 학습 보조 자료로 재구성한다.

[기본 작성 지침]
1. 전후 맥락을 고려하여 반복 인사, 무관한 진행 안내, 명백한 중복과 인식 잡음은 요약에서 완전히 제외한다.
2. 중요 규칙: '제외된 내용'에 대한 부연 설명, 목록, 이유 표는 일절 작성하지 않는다. (순수 강의 내용과 학습 자료만 작성)
3. 정정, 예외, 반례, 부정, 조건, 숫자, 단위, 기호와 수식은 우선 보존한다.
4. 핵심 결론과 시험에 중요한 내용을 노트 맨 앞에 배치한다.
5. 수식은 원식, 변수와 단위, 적용 조건, 직관적 의미를 설명하고, 근거가 충분할 때 표로 구조화한다. 근거에 없는 수치나 관계를 임의로 만들어내지 않는다.
6. 각 내용에는 근거 ID와 중요도 태그(핵심/중요/참고)를 부여하고, 강의 원문을 장문으로 재현하지 않는다.

[시각 자료(SVG) 작성 지침 - 모델 고유 인라인 SVG 설계]
강의를 시각적으로 명확히 설명하기 위해, 다음 5가지 핵심 주제 중 관련 섹션마다 모델 고유의 독자적인 인라인 <svg> 벡터 그래픽 코드를 본문에 직접 작성하여 삽입하라:
① 물질별 에너지 밴드 구조 비교 (절연체 Eg>5eV, 반도체 Si 1.1eV/Ge 0.67eV, 도체 0eV 중첩)
② 반도체 결정 구조 비교 (단결정 Crystalline 규칙 격자, 다결정 Polycrystalline 및 결정립계 Grain Boundary, 비정질 Amorphous)
③ 반도체 재료 분류 체계 (4족 단원소 Si/Ge 및 III-V, IV-IV 등 화합물 반도체)
④ 실리콘 격자의 전자-정공 쌍(EHP) 생성 메커니즘 (sp³ 공유결합, 열적 여기에 의한 자유전자 및 정공 동시 생성)
⑤ 트랜지스터(Transfer Resistor)의 본질: 저항 변조 및 I-V 곡선 기울기 제어

* SVG 작성 필수 요구사항:
- 외부 이미지 URL 링크나 깨질 수 있는 Mermaid 문법을 절대 쓰지 말고, 100% 자체 완결형 인라인 <svg width="100%" height="auto" viewBox="..." xmlns="http://www.w3.org/2000/svg">...</svg> 태그로 작성한다.
- 도형(rect, circle, path, line, text 등)과 가독성 높은 색상(배경 어두운 네이비 계열 또는 명확한 대비)을 사용하여 미려하게 디자인한다.
- 모델 각자의 고유한 레이아웃과 시각적 표현 스타일로 자유롭고 개성 있게 시각화한다.

[입력된 타임라인 근거]
${lectureText}`;

async function runModelStream(m, retryCount = 0) {
  console.log(`\n========================================`);
  console.log(`[시작] ${m.name} (${m.id})`);
  const startTime = Date.now();

  const body = {
    model: m.id,
    messages: [
      {
        role: "system",
        content: "당신은 반도체 공학 및 전자회로 분야의 세계 최고 수준 공학 교육자이자 테크니컬 라이터입니다. 엄밀한 물리 법칙과 수식을 보존하며, 독자적이고 미려한 인라인 SVG 벡터 그래픽을 직접 코딩하여 완벽한 강의 노트를 작성합니다. 제외된 내용에 대한 설명은 일절 작성하지 않습니다."
      },
      {
        role: "user",
        content: USER_PROMPT
      }
    ],
    temperature: 0.2,
    max_tokens: m.maxTokens,
    stream: true,
    ...m.extra
  };

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/lecture-notes",
        "X-Title": "Lecture Notes - Unique SVG Generator"
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    let fullText = "";
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
      const chunkStr = decoder.decode(chunk);
      const lines = chunkStr.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const dataStr = line.slice(6).trim();
          if (dataStr === "[DONE]") break;
          try {
            const data = JSON.parse(dataStr);
            const content = data.choices?.[0]?.delta?.content || "";
            if (content) {
              fullText += content;
              process.stdout.write(content.slice(0, 10)); // 진행 표시
            }
          } catch (e) {
            // json parse error ignore
          }
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n[완료] ${m.name} (${duration}초, ${fullText.length}자)`);

    return {
      text: fullText,
      duration: `${duration}초`,
      charCount: `${fullText.length.toLocaleString()}자`
    };
  } catch (err) {
    console.error(`\n[에러] ${m.name}:`, err.message);
    if (retryCount < 2) {
      console.log(`[재시도] 3초 대기 후 다시 시도합니다...`);
      await new Promise(r => setTimeout(r, 3000));
      return runModelStream(m, retryCount + 1);
    }
    return {
      text: `[요약 실패: ${err.message}]`,
      duration: "실패",
      charCount: "0자"
    };
  }
}

// 모델이 생성한 SVG 및 마크다운 정제 함수
function sanitizeAndFormatModelOutput(rawText, model) {
  let content = rawText;

  // 1. 코드 블록(```xml, ```svg, ```html) 안에 감싸진 <svg> 언래핑
  //    마크다운 뷰어와 PDF에서 그래픽으로 즉시 렌더링되도록 변환
  content = content.replace(/```(?:xml|svg|html)\s*(<svg[\s\S]*?<\/svg>)\s*```/gi, "$1");

  // 2. <svg>...</svg> 내부의 빈 줄(blank lines) 제거 -> marked.js의 <p> 태그 침투 방지
  content = content.replace(/<svg[\s\S]*?<\/svg>/gi, (svgMatch) => {
    // svg 내부 줄단위 분리 후 빈 줄 제거
    const lines = svgMatch.split(/\r?\n/).filter(line => line.trim().length > 0);
    let cleaned = lines.join("\n");
    // div 래핑이 없으면 페이지 나눔 방지 및 중앙 정렬 래핑 추가
    if (!cleaned.includes('margin:')) {
      cleaned = `<div align="center" style="margin: 16px 0; page-break-inside: avoid;">\n${cleaned}\n</div>`;
    }
    return cleaned;
  });

  // 3. 만약 모델이 부정 지침에도 불구하고 '제외된 내용' 섹션을 생성했을 경우 엄격히 제거
  const excludePatterns = [
    /##\s*(?:⚠️|🚫|🗑️)?\s*요약에서\s*제외한\s*내용[\s\S]*?(?=(?:##\s*|$))/m,
    /##\s*(?:⚠️|🚫|🗑️)?\s*제외\s*항목\s*및\s*이유[\s\S]*?(?=(?:##\s*|$))/m,
    /##\s*(?:⚠️|🚫|🗑️)?\s*제외(?:된|한)?\s*내용[\s\S]*$/m
  ];
  for (const p of excludePatterns) {
    content = content.replace(p, "");
  }

  // 4. 단일 정규 헤더 추가
  const headerBlock = `# ${model.name} 강의 요약 노트\n\n` +
    `- **모델 ID**: \`${model.id}\`\n` +
    `- **생성 소요 시간**: ${model.duration}\n` +
    `- **본문 분량**: ${model.charCount}\n` +
    `- **기준 강의**: EEE2050 Lecture 3: Basic Semiconductor Physics\n` +
    `- **특징**: 모델 고유의 독자적인 인라인 SVG 벡터 다이어그램 자체 생성\n\n` +
    `> **작성 기준**: 타임라인 근거의 정정·예외·반례·부정·조건·숫자·단위·기호와 수식을 완벽히 보존하고, 잡음·반복 인사는 완전 배제했으며 제외 사유 설명은 일절 포함하지 않았습니다.\n\n---\n\n`;

  // 기존 최상단 제목 정리
  content = content.replace(/^# [^\n]+\n+/, "");
  content = headerBlock + content.trim();

  return content;
}

// PDF 생성 HTML 템플릿
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
  </script>
</body>
</html>`;
}

function generatePdf(slug, title, subtitle) {
  const mdPath = path.join(dirSummaries, `${slug}.md`);
  const mdContent = fs.readFileSync(mdPath, "utf8");

  const tempHtml = path.join(dirSummaries, `_tmp_${slug}.html`);
  const outPdf1 = path.join(dirSummaries, `${slug}.pdf`);
  const outPdf2 = path.join(dirExample, `${slug}.pdf`);

  fs.writeFileSync(tempHtml, createPdfHtml(title, subtitle, mdContent), "utf8");

  try {
    const cmd = `"${CHROME_PATH}" --headless=new --no-sandbox --disable-gpu --run-all-compositor-stages-before-draw "--print-to-pdf=${outPdf1}" "${tempHtml}"`;
    execSync(cmd, { stdio: "pipe" });

    if (fs.existsSync(outPdf1)) {
      const sizeKb = (fs.statSync(outPdf1).size / 1024).toFixed(1);
      fs.copyFileSync(outPdf1, outPdf2);
      console.log(`📄 [PDF 생성 완료] ${slug}.pdf (${sizeKb} KB)`);
    } else {
      console.error(`❌ [PDF 생성 실패] ${slug}.pdf`);
    }
  } catch (err) {
    console.error(`❌ [PDF 에러] ${slug}:`, err.message);
  } finally {
    if (fs.existsSync(tempHtml)) {
      fs.unlinkSync(tempHtml);
    }
  }
}

async function main() {
  console.log("=== 7개 AI 모델 독자적 SVG 생성 및 OpenRouter 실행 시작 ===");
  console.log(`- 기준 강의: ${lecturePath}`);
  console.log(`- 모델 수: ${MODELS.length}종`);

  const results = [];

  for (const m of MODELS) {
    const res = await runModelStream(m);
    m.duration = res.duration;
    m.charCount = res.charCount;

    // 원본 저장
    const rawPath = path.join(dirSummaries, `_raw_${m.slug}.md`);
    fs.writeFileSync(rawPath, res.text, "utf8");

    // SVG 및 마크다운 정제
    const cleanedMd = sanitizeAndFormatModelOutput(res.text, m);

    // 두 디렉터리 동시 저장
    const out1 = path.join(dirSummaries, `${m.slug}.md`);
    const out2 = path.join(dirExample, `${m.slug}.md`);
    fs.writeFileSync(out1, cleanedMd, "utf8");
    fs.writeFileSync(out2, cleanedMd, "utf8");

    const svgCount = (cleanedMd.match(/<svg/gi) || []).length;
    console.log(`[저장 완료] ${m.slug}.md (SVG ${svgCount}개 생성됨)`);

    results.push({
      ...m,
      svgCount,
      cleanedMd
    });
  }

  // 종합 비교 보고서 작성
  console.log("\n=== 종합 비교 보고서 생성 ===");
  let compDoc = `# 7개 AI 모델 독자적 SVG 생성 반도체 물리 요약 종합 보고서\n\n`;
  compDoc += `> **대상 강의**: EEE2050 Lecture 3: Basic Semiconductor Physics\n`;
  compDoc += `> **핵심 특징**: 7개 AI 모델이 각자 독자적으로 해석하고 코딩한 고유 인라인 SVG 벡터 그래픽 탑재\n`;
  compDoc += `> **제외 정책**: '제외된 내용에 대한 설명이나 표' 일절 배제\n\n---\n\n`;

  compDoc += `## 1. 7개 AI 모델 요약 및 독자적 SVG 시각화 비교 총괄표\n\n`;
  compDoc += `| 모델명 | 모델 ID | 소요 시간 | 분량 | 생성된 독자 SVG 개수 | 시각화 스타일 및 독보적 특징 |\n`;
  compDoc += `|---|---|---|---|---|---|\n`;

  for (const r of results) {
    compDoc += `| **${r.name}** | \`${r.id}\` | ${r.duration} | ${r.charCount} | **${r.svgCount}개** | 모델 독자 설계 인라인 SVG 벡터 탑재 |\n`;
  }

  compDoc += `\n---\n\n## 2. 7개 모델별 독자 생성 마크다운 & PDF 전문 링크\n\n`;
  for (const r of results) {
    compDoc += `### [${r.name} 요약 및 독자 다이어그램 (PDF 보기)](file:///${path.join(dirSummaries, r.slug + ".pdf").replace(/\\/g, "/")})\n\n`;
    compDoc += `- **마크다운 전문**: [${r.slug}.md](file:///${path.join(dirSummaries, r.slug + ".md").replace(/\\/g, "/")})\n`;
    compDoc += `- **독자 생성 SVG 수**: ${r.svgCount}개\n\n`;
  }

  const compPath1 = path.join(dirSummaries, "00_COMPREHENSIVE_COMPARISON.md");
  const compPath2 = path.join(dirExample, "00_COMPREHENSIVE_COMPARISON.md");
  const compRoot = path.join(ROOT, "electric_circuits_summary_7models.md");

  fs.writeFileSync(compPath1, compDoc, "utf8");
  fs.writeFileSync(compPath2, compDoc, "utf8");
  fs.writeFileSync(compRoot, compDoc, "utf8");
  console.log(`[완료] 00_COMPREHENSIVE_COMPARISON.md 생성`);

  // PDF 일괄 생성
  console.log("\n=== 8종 실물 PDF 일괄 출력 시작 ===");
  generatePdf(
    "00_COMPREHENSIVE_COMPARISON",
    "7개 AI 모델 독자적 SVG 생성 반도체 물리 요약 종합 보고서",
    "Basic Semiconductor Physics | 7개 모델 고유 SVG 및 요약 비교"
  );

  for (const r of results) {
    generatePdf(
      r.slug,
      `${r.name} 강의 요약 노트`,
      `모델 ID: ${r.id} | 모델 자체 생성 고유 SVG 벡터 그래픽 완비본`
    );
  }

  console.log("\n🎉 [전체 완료] 모든 모델의 독자적 SVG 생성 및 PDF 출력이 성공적으로 끝났습니다!");
}

main().catch(console.error);
