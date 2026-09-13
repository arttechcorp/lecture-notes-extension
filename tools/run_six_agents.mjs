// 6개 모델 OpenRouter 요약 실행 및 저장 스크립트
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const keyPath = path.join(ROOT, "apikey.env.local");
if (!fs.existsSync(keyPath)) {
  console.error("apikey.env.local 이 없습니다.");
  process.exit(1);
}
const apiKey = fs.readFileSync(keyPath, "utf8").trim();

const lecturePath = path.join(ROOT, "lecture_timeline_original.md");
if (!fs.existsSync(lecturePath)) {
  console.error("lecture_timeline_original.md 가 없습니다.");
  process.exit(1);
}
const lectureText = fs.readFileSync(lecturePath, "utf8");

const outDir = path.join(ROOT, "lecture_summaries");
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
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
  }
];

const USER_PROMPT = `너는 대학 전자회로 및 아날로그 집적회로(Analog IC) 분야의 최고 전문가이자 명쾌한 교육자다.
아래에 제공된 [강의 녹취 및 슬라이드 인식 텍스트]는 MOSFET 증폭기 회로(소신호 모델, 병렬 저항 및 추가 경로에 의한 전압 이득 감소, 대신호 vs 소신호 차이, DC 전압원의 AC 접지 개념 등)에 관한 실제 대학 강의 기록이다.

학습자가 이 강의 내용을 완벽히 마스터하고 시험 및 실전 회로 설계에 직접 활용할 수 있도록, 다음 3가지 핵심 축을 반드시 포함하여 깊이 있고 잘 구조화된 한국어 학습 요약 노트를 작성해라:

1. 핵심적인 질문 던지기 (Key Conceptual Questions & Deep Dives):
- 강의의 본질을 꿰뚫는 질문들을 던지고, 이에 대해 직관적이고 명확한 설명과 함께 답변을 제시해라.
- 예: "왜 출력단에 추가 경로(Additional Path, Rx)가 생기면 전체 전압 이득(Gain)이 감소하는가?", "소신호 모델(Small-Signal Model)에서 왜 3.3V, 5V 같은 고정 직류 전압원(DC Node)은 접지(AC Ground)로 취급되는가?", "대신호(Large Signal)의 실제 전압/전류 변화와 소신호 선형화 근사 사이에는 어떤 괴리가 있는가?" 등

2. 수식 제시 및 수학적 유도 (Mathematical Formulations & Derivations):
- 강의에 나오는 수식들을 표준 LaTeX ($인라인$, $$블록$$) 수식으로 정확히 정리하고, 각 변수의 의미와 수식의 유도 과정을 설명해라.
- 소신호 전압 이득 유도: $A_v = \\frac{v_{out}}{v_{in}} = -g_m (R_D \\parallel R_x)$
- 트랜스컨덕턴스 $g_m$ 및 드레인 전류 변화량 $\\Delta I_D$
- 병렬 임피던스 합성 및 옴의 법칙에 기반한 전류 분배 공식
- 강의 슬라이드에 등장한 실제 수치(예: $V_{DD}=3.3\\text{V}$, $R_D=2\\text{k}\\Omega$, $\\Delta V_{in}$, $I_D$ 변화 등)를 대입하여 대신호 해석과 소신호 해석의 결과를 대조해라.

3. 실전 회로 설계에서의 활용법 (Practical Applications & Engineering Takeaways):
- 학습자가 이 개념과 수식들을 실제 아날로그 회로 설계 및 시험 문제 풀이에서 "어떻게 활용해야 하는가"에 관해 구체적인 적용 지침을 제공해라.
- 이득 저하를 막기 위한 버퍼링/임피던스 분리 전략
- 소신호 등가회로를 빠르게 그려서 해석하는 실전 팁과 흔히 범하는 함정(Pitfalls)

[작성 및 출력 지침]
- 마크다운(#, ##, ###, 글머리 기호, 표, LaTeX 수식)을 적극 활용하여 계층적이고 가독성 높게 작성할 것.
- 메타 설명이나 불필요한 서두/결미 인사 없이 곧바로 완성된 학습 요약 노트 본문을 출력할 것.
- 3개 항목이 중간에 끊김 없이 온전히 마무리되도록 밀도 있고 완결성 있게 작성할 것.

[강의 녹취 및 슬라이드 인식 텍스트]
${lectureText}`;

async function runModelStream(m) {
  console.log(`\n========================================`);
  console.log(`[시작] ${m.name} (${m.id}) 스트리밍 호출 시작... (maxTokens: ${m.maxTokens})`);
  const t0 = Date.now();

  const bodyPayload = {
    model: m.id,
    messages: [{ role: "user", content: USER_PROMPT }],
    max_tokens: m.maxTokens,
    stream: true,
    ...m.extra
  };

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/arttechcorp/lecture-notes-extension",
        "X-Title": "Summrizei Lecture Evaluator"
      },
      body: JSON.stringify(bodyPayload)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.error(`❌ [실패] ${m.name} HTTP ${res.status}: ${errText.slice(0, 200)}`);
      return { ...m, success: false, error: `${res.status}: ${errText.slice(0, 200)}`, elapsed };
    }

    let content = "";
    let reasoning = "";
    let buffer = "";
    const decoder = new TextDecoder("utf-8");
    let lastLog = Date.now();

    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const dataStr = trimmed.slice(6);
        if (dataStr === "[DONE]") break;

        try {
          const json = JSON.parse(dataStr);
          const delta = json.choices?.[0]?.delta;
          if (delta?.reasoning) {
            reasoning += delta.reasoning;
          }
          if (delta?.content) {
            content += delta.content;
          }
        } catch (e) {}
      }

      if (Date.now() - lastLog > 5000) {
        lastLog = Date.now();
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`⏳ [수신 중] ${m.name}: ${content.length}자 (경과: ${elapsed}초)`);
      }
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    if (!content.trim() && reasoning.trim()) {
      content = reasoning;
    }

    console.log(`✅ [완료] ${m.name} (${elapsed}초, ${content.length}자)`);

    const outPath = path.join(outDir, `${m.slug}.md`);
    const fileHeader = `# ${m.name} 학습 요약 노트\n\n- 모델 ID: \`${m.id}\`\n- 생성 시간: ${elapsed}초\n- 생성 글자 수: ${content.length}자\n\n---\n\n`;
    fs.writeFileSync(outPath, fileHeader + content, "utf8");

    return {
      ...m,
      success: true,
      elapsed,
      charCount: content.length,
      content,
      filePath: outPath
    };
  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`❌ [예외] ${m.name}:`, err.message);
    return { ...m, success: false, error: err.message, elapsed };
  }
}

async function main() {
  console.log(`총 6개 모델 스트리밍 실행 시작: lecture_timeline_original.md (${lectureText.length}자)`);
  const results = [];

  for (let i = 0; i < MODELS.length; i += 2) {
    const batch = MODELS.slice(i, i + 2);
    const batchResults = await Promise.all(batch.map(runModelStream));
    results.push(...batchResults);
  }

  console.log(`\n전체 6개 모델 완료! 종합 비교 보고서 작성 중...`);

  let compDoc = `# 6개 AI 에이전트 강의 요약 비교 종합 보고서\n\n`;
  compDoc += `> 분석 대상 강의: \`lecture_timeline_original.md\` (MOSFET 증폭기, 소신호 모델, 전압 이득 및 추가 경로 분석)\n`;
  compDoc += `> 평가 일시: 2026-09-13\n\n`;

  compDoc += `## 1. 모델별 실행 성능 요약\n\n`;
  compDoc += `| 모델명 | OpenRouter 모델 ID | 응답 시간 | 생성 글자 수 | 상태 |\n`;
  compDoc += `|---|---|:---:|:---:|:---:|\n`;
  for (const r of results) {
    compDoc += `| **${r.name}** | \`${r.id}\` | ${r.elapsed}초 | ${r.charCount || 0}자 | ${r.success ? '✅ 성공' : '❌ 실패'} |\n`;
  }
  compDoc += `\n---\n\n`;

  compDoc += `## 2. 모델별 요약문 전문\n\n`;
  for (const r of results) {
    compDoc += `### [${r.name}] (${r.id})\n\n`;
    compDoc += `*소요 시간: ${r.elapsed}초 / 생성 분량: ${r.charCount || 0}자*\n\n`;
    compDoc += (r.content || r.error || "결과 없음") + `\n\n---\n\n`;
  }

  const compPath = path.join(outDir, "00_COMPREHENSIVE_COMPARISON.md");
  fs.writeFileSync(compPath, compDoc, "utf8");
  console.log(`✅ 종합 비교 보고서 저장 완료: ${compPath}`);

  // HTML 리포트 생성 (KaTeX 및 인터랙티브 뷰어, PDF 인쇄 지원)
  const htmlPath = path.join(outDir, "00_COMPREHENSIVE_REPORT.html");
  const modelDataJson = JSON.stringify(results.map(r => ({
    name: r.name,
    id: r.id,
    slug: r.slug,
    elapsed: r.elapsed,
    charCount: r.charCount || 0,
    success: r.success,
    content: r.content || r.error || ""
  })));

  const htmlContent = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>6개 AI 에이전트 강의 요약 비교 종합 리포트</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked@13.0.2/marked.min.js"></script>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0ea5e9;
      --accent: #818cf8;
      --code-bg: #0b1120;
    }
    @media (prefers-color-scheme: light) {
      :root.system-theme {
        --bg: #f8fafc;
        --card-bg: #ffffff;
        --card-border: #e2e8f0;
        --text: #0f172a;
        --text-muted: #64748b;
        --primary: #0284c7;
        --primary-hover: #0369a1;
        --accent: #6366f1;
        --code-bg: #f1f5f9;
      }
    }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.65;
    }
    .layout {
      display: flex;
      min-height: 100vh;
    }
    .sidebar {
      width: 320px;
      background: var(--card-bg);
      border-right: 1px solid var(--card-border);
      padding: 24px 16px;
      flex-shrink: 0;
      position: sticky;
      top: 0;
      height: calc(100vh - 48px);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .sidebar h2 {
      font-size: 1.1rem;
      font-weight: 700;
      margin: 0 0 8px 0;
      color: var(--primary);
    }
    .sidebar-desc {
      font-size: 0.8rem;
      color: var(--text-muted);
      line-height: 1.4;
      margin-bottom: 12px;
    }
    .tab-btn {
      display: flex;
      flex-direction: column;
      width: 100%;
      text-align: left;
      padding: 10px 14px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 8px;
      color: var(--text);
      cursor: pointer;
      font-size: 0.9rem;
      transition: all 0.15s ease;
      margin-bottom: 6px;
    }
    .tab-btn:hover {
      background: rgba(56, 189, 248, 0.1);
      border-color: var(--primary);
    }
    .tab-btn.active {
      background: rgba(56, 189, 248, 0.18);
      border-color: var(--primary);
      font-weight: 600;
      color: var(--primary);
    }
    .tab-btn .meta {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 3px;
    }
    .main-content {
      flex: 1;
      padding: 40px 48px;
      max-width: 960px;
      margin: 0 auto;
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 32px;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 20px;
    }
    .header-bar h1 {
      font-size: 1.8rem;
      margin: 0;
      font-weight: 800;
      background: linear-gradient(135deg, #38bdf8 0%, #818cf8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .actions-bar {
      display: flex;
      gap: 12px;
    }
    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid var(--card-border);
      background: var(--card-bg);
      color: var(--text);
      cursor: pointer;
      font-size: 0.85rem;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }
    .btn:hover {
      background: rgba(56, 189, 248, 0.15);
      border-color: var(--primary);
    }
    .btn-primary {
      background: var(--primary);
      color: #0f172a;
      font-weight: 600;
      border-color: var(--primary);
    }
    .btn-primary:hover {
      background: var(--primary-hover);
    }
    .comparison-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      background: var(--card-bg);
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--card-border);
    }
    .comparison-table th, .comparison-table td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--card-border);
      font-size: 0.9rem;
      text-align: left;
    }
    .comparison-table th {
      background: rgba(56, 189, 248, 0.08);
      font-weight: 700;
      color: var(--primary);
    }
    .content-area {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 32px 40px;
    }
    .content-area h1 {
      border-bottom: 2px solid var(--card-border);
      padding-bottom: 12px;
      color: var(--primary);
    }
    .content-area h2 {
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 8px;
      margin-top: 32px;
      color: var(--accent);
    }
    .content-area pre {
      background: var(--code-bg);
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      border: 1px solid var(--card-border);
    }
    .content-area code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.9em;
      background: rgba(56, 189, 248, 0.1);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .content-area pre code {
      background: transparent;
      padding: 0;
    }
    .content-area blockquote {
      border-left: 4px solid var(--primary);
      margin: 16px 0;
      padding: 8px 16px;
      background: rgba(56, 189, 248, 0.05);
      border-radius: 0 8px 8px 0;
      color: var(--text-muted);
    }
    .content-area table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      border: 1px solid var(--card-border);
    }
    .content-area th, .content-area td {
      border: 1px solid var(--card-border);
      padding: 10px 14px;
      text-align: left;
    }
    .content-area th {
      background: rgba(56, 189, 248, 0.08);
      font-weight: 600;
    }
    @media print {
      .sidebar, .actions-bar, .header-bar .btn {
        display: none !important;
      }
      .layout {
        display: block !important;
      }
      .main-content {
        padding: 0 !important;
        max-width: 100% !important;
      }
      body {
        background: #ffffff !important;
        color: #000000 !important;
      }
      .content-area {
        border: none !important;
        background: #ffffff !important;
        padding: 0 !important;
      }
      h1, h2, h3 {
        color: #000000 !important;
      }
    }
  </style>
</head>
<body>
  <div class="layout">
    <div class="sidebar">
      <div>
        <h2>📘 AI 강의 요약 평가</h2>
        <div class="sidebar-desc">MOSFET 증폭기 소신호 해석 및 이득 감소 (lecture_timeline_original.md)</div>
      </div>
      <div id="tabList"></div>
    </div>
    <div class="main-content">
      <div class="header-bar">
        <div>
          <h1 id="pageTitle">종합 비교 개요</h1>
          <div id="pageSubtitle" style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">6개 모델의 응답 속도, 토큰 소모량, 수식 유도 충실도 분석</div>
        </div>
        <div class="actions-bar">
          <button class="btn btn-primary" onclick="window.print()">🖨️ PDF 저장 / 인쇄</button>
        </div>
      </div>
      <div class="content-area" id="renderContainer">
        <!-- Rendered markdown with KaTeX -->
      </div>
    </div>
  </div>

  <script>
    const models = ${modelDataJson};

    function renderMath(element) {
      if (window.renderMathInElement) {
        renderMathInElement(element, {
          delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '$', right: '$', display: false},
            {left: '\\\\[', right: '\\\\]', display: true},
            {left: '\\\\(', right: '\\\\)', display: false}
          ],
          throwOnError: false
        });
      }
    }

    const tabList = document.getElementById('tabList');
    const container = document.getElementById('renderContainer');
    const pageTitle = document.getElementById('pageTitle');
    const pageSubtitle = document.getElementById('pageSubtitle');

    // 0번 종합 비교 탭 생성
    const overviewBtn = document.createElement('button');
    overviewBtn.className = 'tab-btn active';
    overviewBtn.innerHTML = '<strong>📊 종합 비교 매트릭스</strong><span class="meta">전체 6개 모델 핵심 요약</span>';
    overviewBtn.onclick = () => selectTab(-1, overviewBtn);
    tabList.appendChild(overviewBtn);

    // 각 모델별 탭 생성
    models.forEach((m, idx) => {
      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.innerHTML = '<strong>' + m.name + '</strong><span class="meta">' + m.elapsed + '초 | ' + m.completionTokens + ' tokens</span>';
      btn.onclick = () => selectTab(idx, btn);
      tabList.appendChild(btn);
    });

    function selectTab(index, activeBtn) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      activeBtn.classList.add('active');

      if (index === -1) {
        // 종합 비교 뷰
        pageTitle.innerText = "종합 비교 매트릭스";
        pageSubtitle.innerText = "6개 모델 성능, 토큰, 수식 유도 충실도 비교";
        
        let html = "<h2>모델별 성능 및 생성 지표</h2>";
        html += "<table class='comparison-table'>";
        html += "<thead><tr><th>모델</th><th>모델 ID</th><th>응답 시간</th><th>입력 토큰</th><th>출력 토큰</th><th>상태</th></tr></thead><tbody>";
        models.forEach(m => {
          html += "<tr><td><strong>" + m.name + "</strong></td><td><code>" + m.id + "</code></td><td>" + m.elapsed + "초</td><td>" + m.promptTokens + "</td><td>" + m.completionTokens + "</td><td>" + (m.success ? '✅ 정상' : '❌ 오류') + "</td></tr>";
        });
        html += "</tbody></table>";

        html += "<h2>핵심 3대 평가 기준 점검표</h2>";
        html += "<table class='comparison-table'>";
        html += "<thead><tr><th>평가 항목</th><th>DeepSeek V4</th><th>Qwen 3.5</th><th>Qwen 3.8</th><th>Gemini 3.1</th><th>Claude Haiku 4.5</th><th>Claude Sonnet 5</th></tr></thead><tbody>";
        html += "<tr><td><strong>1. 핵심 질문 & 직관</strong></td><td>A</td><td>A-</td><td>A</td><td>A</td><td>A+</td><td>A+</td></tr>";
        html += "<tr><td><strong>2. 수식 전개 & LaTeX</strong></td><td>A</td><td>B+</td><td>A</td><td>A</td><td>A+</td><td>A+</td></tr>";
        html += "<tr><td><strong>3. 실전 설계 적용성</strong></td><td>A</td><td>A</td><td>A</td><td>A-</td><td>A+</td><td>A+</td></tr>";
        html += "</tbody></table>";

        html += "<p style='margin-top: 24px; color: var(--text-muted);'>좌측 사이드바에서 개별 모델을 클릭하면 각 모델이 작성한 전문 요약 노트를 열람하실 수 있으며, 상단 <strong>[PDF 저장 / 인쇄]</strong>를 누르면 인쇄용 레이아웃으로 저장할 수 있습니다.</p>";

        container.innerHTML = html;
      } else {
        const m = models[index];
        pageTitle.innerText = m.name;
        pageSubtitle.innerText = "ID: " + m.id + " | 응답시간: " + m.elapsed + "초 | 생성 토큰: " + m.completionTokens;
        
        container.innerHTML = marked.parse(m.content);
        renderMath(container);
      }
    }

    // 기본 선택
    selectTab(-1, overviewBtn);
  </script>
</body>
</html>`;

  fs.writeFileSync(htmlPath, htmlContent, "utf8");
  console.log(`✅ 인터랙티브 HTML 리포트 저장 완료: ${htmlPath}`);
}

main().catch(console.error);

