// 7개 모델 OpenRouter 요약 실행 및 개별/종합 md 파일 저장 스크립트
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

const lecturePath = path.join(ROOT, "electric_circuits_note_example.md");
if (!fs.existsSync(lecturePath)) {
  console.error("electric_circuits_note_example.md 가 없습니다.");
  process.exit(1);
}
const lectureText = fs.readFileSync(lecturePath, "utf8");

// 출력 디렉토리 설정
const outDir = path.join(ROOT, "electric_circuits_summaries");
const copyDir = path.join(ROOT, "electric_circuits_note_example");
for (const d of [outDir, copyDir]) {
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
    maxTokens: 16000
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

const USER_PROMPT = `입력된 타임라인 근거를 학습 보조 자료로 재구성한다. 전후 맥락을 고려하여 반복 인사, 무관한 진행 안내, 명백한 중복과 인식 잡음은 요약에서 제외하되 제외 이유를 기록한다. 정정, 예외, 반례, 부정, 조건, 숫자, 단위, 기호와 수식은 우선 보존한다.

핵심 결론과 시험에 중요한 내용을 노트 맨 앞에 배치한다. 수식은 원식, 변수와 단위, 적용 조건, 직관적 의미를 설명하고, 근거가 충분할 때 표·도표·그래프로 구조화한다. 근거에 없는 수치나 관계를 만들어내지 않는다.

각 내용에는 근거 ID와

\`\`\`
핵심/중요/참고
\`\`\`

중요도 태그를 부여하고, 강의 원문을 장문으로 재현하지 않는다.

[입력된 타임라인 근거]
${lectureText}`;

async function runModelStream(m, retryCount = 0) {
  console.log(`\n========================================`);
  console.log(`[시작] ${m.name} (${m.id}) 호출 시작... (maxTokens: ${m.maxTokens}, 재시도: ${retryCount})`);
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
        "X-Title": "Lecture Notes Evaluator"
      },
      body: JSON.stringify(bodyPayload)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`❌ [HTTP 에러] ${m.name} ${res.status}: ${errText.slice(0, 200)}`);
      if (retryCount < 2 && (res.status === 429 || res.status >= 500)) {
        const waitMs = (retryCount + 1) * 3000;
        console.log(`⏳ ${waitMs}ms 후 재시도...`);
        await new Promise(r => setTimeout(r, waitMs));
        return runModelStream(m, retryCount + 1);
      }
      return { ...m, success: false, error: `${res.status}: ${errText.slice(0, 200)}`, elapsed: ((Date.now() - t0)/1000).toFixed(1) };
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
        console.log(`⏳ [수신 중] ${m.name}: 내용 ${content.length}자 / 생각 ${reasoning.length}자 (경과: ${elapsed}초)`);
      }
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    if (!content.trim() && reasoning.trim()) {
      content = reasoning;
    }

    if (!content.trim()) {
      throw new Error("응답 본문이 비어있습니다.");
    }

    console.log(`✅ [완료] ${m.name} (${elapsed}초, ${content.length}자)`);

    const fileHeader = `# ${m.name} 강의 요약 노트\n\n- 모델 ID: \`${m.id}\`\n- 소요 시간: ${elapsed}초\n- 생성 글자 수: ${content.length}자\n- 기준 강의 파일: \`electric_circuits_note_example.md\`\n\n---\n\n`;
    const fullText = fileHeader + content;

    const outPath = path.join(outDir, `${m.slug}.md`);
    fs.writeFileSync(outPath, fullText, "utf8");

    const copyPath = path.join(copyDir, `${m.slug}.md`);
    fs.writeFileSync(copyPath, fullText, "utf8");

    return {
      ...m,
      success: true,
      elapsed,
      charCount: content.length,
      content,
      filePath: outPath
    };
  } catch (err) {
    console.error(`❌ [예외 발생] ${m.name}:`, err.message);
    if (retryCount < 2) {
      const waitMs = (retryCount + 1) * 3000;
      console.log(`⏳ ${waitMs}ms 후 재시도...`);
      await new Promise(r => setTimeout(r, waitMs));
      return runModelStream(m, retryCount + 1);
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    return { ...m, success: false, error: err.message, elapsed };
  }
}

async function main() {
  console.log(`총 7개 모델 요약 생성 실행 시작 (입력: electric_circuits_note_example.md, ${lectureText.length}자)`);
  const results = [];

  // 2개씩 병렬 실행하여 안정성 및 속도 확보
  for (let i = 0; i < MODELS.length; i += 2) {
    const batch = MODELS.slice(i, i + 2);
    const batchResults = await Promise.all(batch.map(m => runModelStream(m)));
    results.push(...batchResults);
  }

  console.log(`\n전체 7개 모델 실행 완료! 종합 비교 문서 생성 중...`);

  // 종합 비교 Markdown 생성
  let compDoc = `# 7개 AI 모델 강의 요약 결과 종합 보고서\n\n`;
  compDoc += `> 분석 원본: \`electric_circuits_note_example.md\` (Basic Semiconductor Physics: 반도체 밴드갭, Si vs Ge, 결정 구조, 공유결합 등)\n`;
  compDoc += `> 실행 일시: 2026-09-13\n\n`;

  compDoc += `## 1. 모델별 실행 성능 요약\n\n`;
  compDoc += `| 순번 | 모델명 | OpenRouter 모델 ID | 소요 시간 | 생성 글자 수 | 상태 | 개별 파일 링크 |\n`;
  compDoc += `|:---:|---|---|:---:|:---:|:---:|:---:|\n`;
  results.forEach((r, idx) => {
    compDoc += `| ${idx + 1} | **${r.name}** | \`${r.id}\` | ${r.elapsed}초 | ${r.charCount || 0}자 | ${r.success ? '✅ 성공' : '❌ 실패'} | [${r.slug}.md](./${r.slug}.md) |\n`;
  });
  compDoc += `\n---\n\n`;

  compDoc += `## 2. 모델별 요약 노트 전문\n\n`;
  for (const r of results) {
    compDoc += `### [${r.name}] (${r.id})\n\n`;
    compDoc += `*소요 시간: ${r.elapsed}초 | 생성 분량: ${r.charCount || 0}자*\n\n`;
    compDoc += (r.content || r.error || "결과 없음") + `\n\n---\n\n`;
  }

  fs.writeFileSync(path.join(outDir, "00_COMPREHENSIVE_COMPARISON.md"), compDoc, "utf8");
  fs.writeFileSync(path.join(copyDir, "00_COMPREHENSIVE_COMPARISON.md"), compDoc, "utf8");
  fs.writeFileSync(path.join(ROOT, "electric_circuits_summary_7models.md"), compDoc, "utf8");

  console.log(`✅ 개별 및 종합 md 파일 저장 완료!`);
  console.log(`- 디렉토리 1: ${outDir}`);
  console.log(`- 디렉토리 2: ${copyDir}`);
  console.log(`- 루트 파일: ${path.join(ROOT, "electric_circuits_summary_7models.md")}`);
}

main().catch(console.error);
