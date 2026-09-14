// 각 모델의 순수 텍스트 본문(인젝션된 중복 다이어그램 및 중복 헤더가 모두 제거된 원문) 복원 스크립트
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const dir1 = path.join(ROOT, "electric_circuits_summaries");

const files = [
  "01_deepseek_v4_flash.md",
  "02_qwen3.5_122b.md",
  "03_qwen3.8_2.4t.md",
  "04_gemini_3.1_flash_lite.md",
  "05_claude_haiku_4.5.md",
  "06_claude_sonnet_5.md",
  "07_gemini_3.8_flash.md"
];

for (const file of files) {
  const filePath = path.join(dir1, file);
  let content = fs.readFileSync(filePath, "utf8");

  // 1. 모든 중복 헤더 제거 (최초 1개만 남기기 위해 헤더 완전 분리)
  content = content.replace(/^(?:# [^\n]+\n\n- 모델 ID:[^\n]+\n- 소요 시간:[^\n]+\n- 생성 글자 수:[^\n]+\n- 기준 강의 파일:[^\n]+(?:\n- 특징:[^\n]+)?\n\n---\n\n)+/gm, "");

  // 2. 이전에 주입된 모든 '확실한 그림 자료' 블록 및 Mermaid 코드 블록, SVG 블록 전면 제거
  // 패턴 A: ### 📊 [확실한 그림 자료 ... </div>
  content = content.replace(/### 📊 \[확실한 그림 자료[\s\S]*?<\/div>/g, "");
  // 패턴 B: 독립된 ```mermaid ... ```
  content = content.replace(/```mermaid[\s\S]*?```/g, "");
  // 패턴 C: 독립된 <div align="center" ... </div>
  content = content.replace(/<div align="center"[\s\S]*?<\/div>/g, "");
  // 패턴 D: 잔여 확실한 그림 자료 헤더
  content = content.replace(/### 📊 \[확실한 그림 자료[^\n]+/g, "");

  // 3. 제외된 내용 관련 섹션 전면 제거
  const excludePatterns = [
    /##\s*(?:⚠️|🚫|🗑️)?\s*제외(?:된|한)?\s*내용[\s\S]*$/m,
    /###\s*(?:⚠️|🚫|🗑️)?\s*제외(?:된|한)?\s*내용[\s\S]*$/m,
    /##\s*\d+[️⃣\.]?\s*제외(?:된|한)?\s*내용[\s\S]*$/m,
    /##\s*\d+[️⃣\.]?\s*기록\s*및\s*제외[\s\S]*$/m,
    /##\s*5\.\s*제외\s*기록[\s\S]*$/m
  ];
  for (const p of excludePatterns) {
    content = content.replace(p, "");
  }

  // 앞선 작성 기준 문구 정리
  content = content.replace(/> 작성 기준:.*제외.*남겼다\.\s*/g, "> 작성 기준: 제시된 타임라인 근거의 정정·예외·반례·부정·조건·숫자·단위·기호와 수식을 정확히 보존하고 핵심 내용을 체계적으로 구조화했습니다.\n");

  content = content.trim();

  // 순수 텍스트 백업 저장
  fs.writeFileSync(path.join(dir1, `_pristine_${file}`), content, "utf8");
  console.log(`[복원] ${file}: ${content.length}자 (순수 텍스트 분리 완료)`);
}
