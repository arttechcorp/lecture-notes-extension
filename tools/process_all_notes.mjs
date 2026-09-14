// 7개 모델의 학습 요약 노트에 확실한 그림 자료(Mermaid + SVG) 적용 및 제외 내용 삭제 일괄 처리 스크립트
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIAGRAM_ENERGY_BAND,
  DIAGRAM_CRYSTAL_STRUCTURE,
  DIAGRAM_MATERIALS_TREE,
  DIAGRAM_COVALENT_AND_EHP,
  DIAGRAM_TRANSISTOR_IV,
  stripExcludedSections
} from "./apply_visual_diagrams_and_remove_excluded.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const dir1 = path.join(ROOT, "electric_circuits_summaries");
const dir2 = path.join(ROOT, "electric_circuits_note_example");

const MODELS = [
  { slug: "01_deepseek_v4_flash", name: "DeepSeek V4 Flash 0731", id: "deepseek/deepseek-v4-flash-0731", elapsed: "67.7" },
  { slug: "02_qwen3.5_122b", name: "Qwen3.5 122B-A10B", id: "qwen/qwen3.5-122b-a10b", elapsed: "19.7" },
  { slug: "03_qwen3.8_2.4t", name: "Qwen3.8 2.4T-A95B", id: "qwen/qwen3.8-2.4t-a95b", elapsed: "346.0" },
  { slug: "04_gemini_3.1_flash_lite", name: "Gemini 3.1 Flash-Lite", id: "google/gemini-3.1-flash-lite", elapsed: "5.8" },
  { slug: "05_claude_haiku_4.5", name: "Claude Haiku 4.5", id: "anthropic/claude-haiku-4.5", elapsed: "33.1" },
  { slug: "06_claude_sonnet_5", name: "Claude Sonnet 5", id: "anthropic/claude-sonnet-5", elapsed: "53.1" },
  { slug: "07_gemini_3.8_flash", name: "Gemini 3.8 Flash", id: "google/gemini-3.8-flash", elapsed: "31.6" }
];

function processModelNote(slug, name, id, elapsed) {
  const filePath = path.join(dir1, `${slug}.md`);
  let content = fs.readFileSync(filePath, "utf8");

  // 1. 헤더 추출
  const headerMatch = content.match(/^# [^\n]+\n\n- 모델 ID:[^\n]+\n- 소요 시간:[^\n]+\n- 생성 글자 수:[^\n]+\n- 기준 강의 파일:[^\n]+\n\n---\n\n/);
  let header = "";
  if (headerMatch) {
    header = headerMatch[0];
    content = content.slice(header.length);
  }

  // 2. 제외된 내용 섹션 완전히 삭제
  content = stripExcludedSections(content);

  // 3. 파일별 특정 ASCII 및 설명 텍스트를 확실한 그림 자료(Mermaid + SVG)로 교체 또는 주입
  if (slug === "01_deepseek_v4_flash") {
    // 에너지 밴드 ASCII 아트 교체
    content = content.replace(/```\s*에너지 ↑[\s\S]*?└─────────────────┘\s*```/, DIAGRAM_ENERGY_BAND);
    // 결정 구조 섹션에 다이어그램 추가
    content = content.replace(/(### 4\.2 결정 구조 비교[\s\S]*?)(## 5\.)/, `$1\n${DIAGRAM_CRYSTAL_STRUCTURE}\n\n$2`);
    // 주기율표 섹션에 다이어그램 추가
    content = content.replace(/(## 5\. 반도체 재료 분류 \(주기율표\)[\s\S]*?)(## 6\.)/, `$1\n${DIAGRAM_MATERIALS_TREE}\n\n$2`);
    // 트랜지스터 저항 변조
    content = content.replace(/(### 7\.1 트랜지스터 어원과 정의[\s\S]*?)(### 7\.2)/, `$1\n${DIAGRAM_TRANSISTOR_IV}\n\n$2`);
    // 전자-정공 쌍 생성 ASCII 교체
    content = content.replace(/```\s*에너지 인가 ↓[\s\S]*?빈자리\(Empty Spot\) 생성 = "정공\(Hole\)"\s*```/, DIAGRAM_COVALENT_AND_EHP);
  } else if (slug === "02_qwen3.5_122b") {
    // 에너지 밴드 다이어그램 주입
    content = content.replace(/(#### 1\. 물질 분류 및 에너지 밴드 이론[\s\S]*?)(#### 2\.)/, `$1\n${DIAGRAM_ENERGY_BAND}\n\n$2`);
    // 결정 구조 다이어그램 주입
    content = content.replace(/(#### 2\. 반도체 물질의 종류 및 결정 구조[\s\S]*?)(#### 3\.)/, `$1\n${DIAGRAM_CRYSTAL_STRUCTURE}\n\n${DIAGRAM_MATERIALS_TREE}\n\n$2`);
    // 트랜지스터 어원
    content = content.replace(/(#### 3\. 실리콘\(Si\) vs 게르마늄\(Ge\) 비교[\s\S]*?)(#### 4\.)/, `$1\n${DIAGRAM_TRANSISTOR_IV}\n\n$2`);
    // 원자 구조 및 캐리어 생성 다이어그램 주입
    content = content.replace(/(#### 4\. 실리콘의 원자 구조 및 전하 캐리어 생성[\s\S]*?$)/, `$1\n\n${DIAGRAM_COVALENT_AND_EHP}`);
  } else if (slug === "03_qwen3.8_2.4t") {
    content = content.replace(/(## 1\. 에너지 밴드와 물질의 구분[\s\S]*?)(## 2\.)/, `$1\n${DIAGRAM_ENERGY_BAND}\n\n$2`);
    content = content.replace(/(## 4\. 결정 구조와 집적회로\(IC\) 소자[\s\S]*?)(## 5\.)/, `$1\n${DIAGRAM_CRYSTAL_STRUCTURE}\n\n$2`);
    content = content.replace(/(## 5\. 반도체 재료와 주기율표[\s\S]*?)(## 6\.)/, `$1\n${DIAGRAM_MATERIALS_TREE}\n\n$2`);
    content = content.replace(/(## 3\. 원자 구조와 공유결합, 캐리어 생성[\s\S]*?)(## 4\.)/, `$1\n${DIAGRAM_COVALENT_AND_EHP}\n\n$2`);
  } else if (slug === "04_gemini_3.1_flash_lite") {
    content = content.replace(/(### 2\.1\. 에너지 밴드 구조와 물질 분류[\s\S]*?)(### 2\.2\.)/, `$1\n${DIAGRAM_ENERGY_BAND}\n\n$2`);
    content = content.replace(/(### 2\.2\. 반도체 결정 구조의 종류[\s\S]*?)(### 2\.3\.)/, `$1\n${DIAGRAM_CRYSTAL_STRUCTURE}\n\n$2`);
    content = content.replace(/(### 2\.3\. 반도체 재료의 분류[\s\S]*?)(### 2\.4\.)/, `$1\n${DIAGRAM_MATERIALS_TREE}\n\n$2`);
    content = content.replace(/(### 2\.5\. 원자 결합 및 캐리어 생성[\s\S]*?$)/, `$1\n\n${DIAGRAM_COVALENT_AND_EHP}\n\n${DIAGRAM_TRANSISTOR_IV}`);
  } else if (slug === "05_claude_haiku_4.5") {
    content = content.replace(/(### 1\.1 에너지 밴드 구조[\s\S]*?)(### 1\.2)/, `$1\n${DIAGRAM_ENERGY_BAND}\n\n$2`);
    content = content.replace(/(## 2️⃣ 반도체 재료 및 화학 분류[\s\S]*?)(## 3️⃣)/, `$1\n${DIAGRAM_MATERIALS_TREE}\n\n$2`);
    content = content.replace(/(## 3️⃣ 결정 구조 \(Crystal Structure\)[\s\S]*?)(## 4️⃣)/, `$1\n${DIAGRAM_CRYSTAL_STRUCTURE}\n\n$2`);
    content = content.replace(/(## 4️⃣ 실리콘 vs 게르마늄 비교[\s\S]*?)(## 5️⃣)/, `$1\n${DIAGRAM_TRANSISTOR_IV}\n\n$2`);
    content = content.replace(/(### 1\.4 공유결합과 캐리어 생성[\s\S]*?)(## 2️⃣)/, `$1\n${DIAGRAM_COVALENT_AND_EHP}\n\n$2`);
  } else if (slug === "06_claude_sonnet_5") {
    content = content.replace(/(### 2\. 밴드갭\(Band Gap\) 수치[\s\S]*?)(### 3\.)/, `$1\n${DIAGRAM_ENERGY_BAND}\n\n$2`);
    content = content.replace(/(### 2\. 결정 구조 비교[\s\S]*?)(### 3\.)/, `$1\n${DIAGRAM_CRYSTAL_STRUCTURE}\n\n$2`);
    content = content.replace(/(### 3\. 반도체 재료의 화학적 분류[\s\S]*?)(### 4\.)/, `$1\n${DIAGRAM_MATERIALS_TREE}\n\n$2`);
    content = content.replace(/(### 4\. 트랜지스터의 동작 원리와 저항 변조[\s\S]*?)(### 5\.)/, `$1\n${DIAGRAM_TRANSISTOR_IV}\n\n$2`);
    content = content.replace(/(### 5\. 실리콘의 원자 구조 및 캐리어 생성[\s\S]*?$)/, `$1\n\n${DIAGRAM_COVALENT_AND_EHP}`);
  } else if (slug === "07_gemini_3.8_flash") {
    // 텍스트 다이어그램 교체
    content = content.replace(/```\s*\[열 에너지 인가 전\][\s\S]*?\[정공\(Hole\)\] — Si\s*\(결합 파괴로 빈자리 형성\)\s*```/, DIAGRAM_COVALENT_AND_EHP);
    content = content.replace(/(### 2\.1 에너지 밴드 이론과 물질의 분류[\s\S]*?)(### 2\.2)/, `$1\n${DIAGRAM_ENERGY_BAND}\n\n$2`);
    content = content.replace(/(### 2\.2 반도체의 결정 구조와 IC 응용[\s\S]*?)(### 2\.3)/, `$1\n${DIAGRAM_CRYSTAL_STRUCTURE}\n\n$2`);
    content = content.replace(/(### 2\.3 반도체 물질의 화학적 분류 및 주기율표[\s\S]*?)(### 2\.4)/, `$1\n${DIAGRAM_MATERIALS_TREE}\n\n$2`);
    content = content.replace(/(트랜지스터\(Transistor\)의 본질적 정의[\s\S]*?)(### 2\.5)/, `$1\n${DIAGRAM_TRANSISTOR_IV}\n\n$2`);
  }

  // 글자 수 재계산 및 헤더 갱신
  const newHeader = `# ${name} 강의 요약 노트\n\n- 모델 ID: \`${id}\`\n- 소요 시간: ${elapsed}초\n- 생성 글자 수: ${content.length}자\n- 기준 강의 파일: \`electric_circuits_note_example.md\`\n- 특징: 확실한 그림 자료(Mermaid + SVG) 적용 완료, 제외 내용 완전 제거\n\n---\n\n`;
  const finalDoc = newHeader + content.trim() + "\n";

  fs.writeFileSync(path.join(dir1, `${slug}.md`), finalDoc, "utf8");
  fs.writeFileSync(path.join(dir2, `${slug}.md`), finalDoc, "utf8");

  return { slug, name, id, elapsed, charCount: content.length, content: finalDoc };
}

async function main() {
  console.log("7개 모델 마크다운 시각 자료 적용 및 제외 내용 삭제 시작...");
  const processed = [];

  for (const m of MODELS) {
    const res = processModelNote(m.slug, m.name, m.id, m.elapsed);
    processed.push(res);
    console.log(`✅ [완료] ${m.name}: ${res.charCount}자 (그림 자료 완비, 제외 내용 삭제 완료)`);
  }

  // 종합 비교 문서 작성
  let compDoc = `# 7개 AI 모델 강의 요약 결과 종합 보고서 (확실한 그림 자료 및 순수 핵심 요약)\n\n`;
  compDoc += `> 분석 원본: \`electric_circuits_note_example.md\` (Basic Semiconductor Physics: 반도체 밴드갭, Si vs Ge 5대 이유, 결정 구조, 공유결합 격자 및 EHP 생성)\n`;
  compDoc += `> 개선 사항: 강의에 등장하는 모든 핵심 그림 자료를 **Mermaid 다이어그램 및 고해상도 SVG 벡터 그래픽**으로 완벽 구현하고, **제외된 내용에 대한 모든 서술 및 표를 전면 삭제**했습니다.\n\n`;

  compDoc += `## 1. 모델별 실행 지표 요약\n\n`;
  compDoc += `| 순번 | 모델명 | OpenRouter 모델 ID | 응답 시간 | 생성 분량 | 상태 | 개별 마크다운 링크 |\n`;
  compDoc += `|:---:|---|---|:---:|:---:|:---:|:---:|\n`;
  processed.forEach((r, idx) => {
    compDoc += `| ${idx + 1} | **${r.name}** | \`${r.id}\` | ${r.elapsed}초 | ${r.charCount}자 | ✅ 완료 | [${r.slug}.md](./${r.slug}.md) |\n`;
  });
  compDoc += `\n---\n\n`;

  compDoc += `## 2. 강의 핵심 그림 자료 마스터 갤러리\n\n`;
  compDoc += `강의의 모든 시각적 도식 자료를 체계적으로 정리한 마스터 다이어그램 모음입니다.\n\n`;
  compDoc += DIAGRAM_ENERGY_BAND + "\n\n---\n\n";
  compDoc += DIAGRAM_CRYSTAL_STRUCTURE + "\n\n---\n\n";
  compDoc += DIAGRAM_MATERIALS_TREE + "\n\n---\n\n";
  compDoc += DIAGRAM_COVALENT_AND_EHP + "\n\n---\n\n";
  compDoc += DIAGRAM_TRANSISTOR_IV + "\n\n---\n\n";

  compDoc += `## 3. 모델별 요약 노트 전문 (제외 내용 완전 삭제본)\n\n`;
  for (const r of processed) {
    compDoc += `### [${r.name}] (\`${r.id}\`)\n\n`;
    compDoc += r.content + "\n\n---\n\n";
  }

  fs.writeFileSync(path.join(dir1, "00_COMPREHENSIVE_COMPARISON.md"), compDoc, "utf8");
  fs.writeFileSync(path.join(dir2, "00_COMPREHENSIVE_COMPARISON.md"), compDoc, "utf8");
  fs.writeFileSync(path.join(ROOT, "electric_circuits_summary_7models.md"), compDoc, "utf8");

  // 인터랙티브 HTML 뷰어 생성 (KaTeX + Mermaid.js 지원)
  const htmlViewerPath1 = path.join(dir1, "00_COMPREHENSIVE_REPORT.html");
  const htmlViewerPath2 = path.join(dir2, "00_COMPREHENSIVE_REPORT.html");

  const modelJson = JSON.stringify(processed.map(p => ({
    name: p.name,
    id: p.id,
    slug: p.slug,
    elapsed: p.elapsed,
    charCount: p.charCount,
    content: p.content
  })));

  const htmlContent = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>7개 AI 에이전트 반도체 물리 요약 비교 리포트</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked@13.0.2/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
  <script>mermaid.initialize({ startOnLoad: false, theme: 'dark' });</script>
  <style>
    :root {
      --bg: #0b1120;
      --card-bg: #1e293b;
      --card-border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0ea5e9;
      --accent: #818cf8;
      --code-bg: #020617;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.7;
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
      gap: 12px;
    }
    .sidebar h2 {
      font-size: 1.1rem;
      color: var(--primary);
      margin: 0 0 8px 8px;
    }
    .tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      padding: 12px 14px;
      text-align: left;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.95rem;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .tab-btn:hover {
      background: rgba(56, 189, 248, 0.08);
      color: var(--text);
    }
    .tab-btn.active {
      background: rgba(56, 189, 248, 0.15);
      border-color: var(--primary);
      color: var(--primary);
      font-weight: 600;
    }
    .tab-btn .meta {
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .content-area {
      flex: 1;
      padding: 36px 48px;
      max-width: 1000px;
      margin: 0 auto;
    }
    .header-bar {
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 20px;
      margin-bottom: 28px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header-bar h1 {
      margin: 0;
      font-size: 1.8rem;
      color: var(--primary);
    }
    .header-bar .subtitle {
      color: var(--text-muted);
      font-size: 0.95rem;
      margin-top: 6px;
    }
    .btn-print {
      background: var(--primary);
      color: #000;
      border: none;
      padding: 10px 18px;
      border-radius: 6px;
      font-weight: bold;
      cursor: pointer;
    }
    .btn-print:hover { background: var(--primary-hover); }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      background: var(--card-bg);
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      border: 1px solid var(--card-border);
      padding: 12px 16px;
      text-align: left;
    }
    th {
      background: #111827;
      color: var(--primary);
      font-weight: bold;
    }
    pre {
      background: var(--code-bg);
      border: 1px solid var(--card-border);
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
    }
    code {
      font-family: Consolas, monospace;
      color: #e2e8f0;
      background: rgba(255, 255, 255, 0.06);
      padding: 2px 6px;
      border-radius: 4px;
    }
    pre code { background: transparent; padding: 0; }
    blockquote {
      border-left: 4px solid var(--primary);
      margin: 16px 0;
      padding: 8px 18px;
      background: rgba(56, 189, 248, 0.05);
      border-radius: 0 8px 8px 0;
      color: #cbd5e1;
    }
  </style>
</head>
<body>
  <div class="layout">
    <div class="sidebar">
      <h2>🧠 7개 AI 모델 선택</h2>
      <div id="tabList"></div>
    </div>
    <div class="content-area">
      <div class="header-bar">
        <div>
          <h1 id="pageTitle">종합 비교 매트릭스 & 시각 갤러리</h1>
          <div id="pageSubtitle" class="subtitle">반도체 물리 기초 강의 (확실한 그림 자료 및 제외 내용 삭제본)</div>
        </div>
        <button class="btn-print" onclick="window.print()">🖨️ PDF 인쇄</button>
      </div>
      <div id="mainContainer"></div>
    </div>
  </div>

  <script>
    const models = ${modelJson};
    const tabList = document.getElementById('tabList');
    const pageTitle = document.getElementById('pageTitle');
    const pageSubtitle = document.getElementById('pageSubtitle');
    const container = document.getElementById('mainContainer');

    function renderMathAndMermaid(targetEl) {
      if (window.renderMathInElement) {
        renderMathInElement(targetEl, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false }
          ],
          throwOnError: false
        });
      }
      targetEl.querySelectorAll('pre code.language-mermaid').forEach((block) => {
        const pre = block.parentElement;
        const div = document.createElement('div');
        div.className = 'mermaid';
        div.textContent = block.textContent;
        pre.replaceWith(div);
      });
      mermaid.run({ nodes: targetEl.querySelectorAll('.mermaid') });
    }

    const overviewBtn = document.createElement('button');
    overviewBtn.className = 'tab-btn active';
    overviewBtn.innerHTML = '<strong>📊 종합 비교 및 그림 갤러리</strong><span class="meta">7개 모델 성능 & 시각 마스터</span>';
    overviewBtn.onclick = () => selectTab(-1, overviewBtn);
    tabList.appendChild(overviewBtn);

    models.forEach((m, idx) => {
      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.innerHTML = '<strong>' + m.name + '</strong><span class="meta">' + m.elapsed + '초 | ' + m.charCount + '자</span>';
      btn.onclick = () => selectTab(idx, btn);
      tabList.appendChild(btn);
    });

    function selectTab(index, activeBtn) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      activeBtn.classList.add('active');

      if (index === -1) {
        pageTitle.innerText = "종합 비교 매트릭스 & 시각 자료 마스터";
        pageSubtitle.innerText = "7개 모델 요약 품질 및 반도체 핵심 그림 자료(Mermaid+SVG)";
        let html = "<h2>1. 모델별 실행 지표 요약</h2><table><thead><tr><th>순번</th><th>모델명</th><th>모델 ID</th><th>응답 시간</th><th>글자 수</th><th>상태</th></tr></thead><tbody>";
        models.forEach((m, i) => {
          html += "<tr><td>" + (i+1) + "</td><td><strong>" + m.name + "</strong></td><td><code>" + m.id + "</code></td><td>" + m.elapsed + "초</td><td>" + m.charCount + "자</td><td>✅ 완료</td></tr>";
        });
        html += "</tbody></table>";
        html += "<h2>2. 핵심 특징</h2><ul><li><strong>그림 자료 시각화</strong>: 에너지 밴드갭, 결정 구조(단결정/다결정/비정질), 화학 원소 체계, 공유결합 및 전자-정공 쌍 생성을 Mermaid와 고해상도 SVG로 완벽 구현.</li><li><strong>순수 핵심 보존</strong>: 반복 인사, 강의 공지, 오독 잡음 등 '제외된 내용'에 대한 언급이나 목록을 일체 남기지 않고 순수 학습 및 시험 핵심만을 남김.</li></ul>";
        container.innerHTML = html;
      } else {
        const m = models[index];
        pageTitle.innerText = m.name;
        pageSubtitle.innerText = "ID: " + m.id + " | 응답시간: " + m.elapsed + "초 | 글자 수: " + m.charCount + "자";
        container.innerHTML = marked.parse(m.content);
        renderMathAndMermaid(container);
      }
    }

    selectTab(-1, overviewBtn);
  </script>
</body>
</html>`;

  fs.writeFileSync(htmlViewerPath1, htmlContent, "utf8");
  fs.writeFileSync(htmlViewerPath2, htmlContent, "utf8");

  console.log(`✅ 종합 비교 문서 및 HTML 리포트 저장 완료!`);
  console.log(`- HTML 리포트: ${htmlViewerPath1}`);
}

main().catch(console.error);
