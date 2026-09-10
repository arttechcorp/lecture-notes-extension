#!/usr/bin/env node
// 여러 모델을 같은 입력으로 돌려 나란히 비교한다.
//
// 왜 필요한가: 가격표로는 못 고른다. 이 제품의 값어치는 "한국어 노트 품질"
// 하나인데 그건 스펙 시트에 없다. 같은 강의를 여러 모델에 넣고 결과를 눈으로
// 봐야 정해진다.
//
// OpenRouter 키 하나로 전부 부른다. 모델 슬러그는 자주 바뀌므로 하드코딩하지
// 않고 카탈로그에서 찾아 맞춘다. 가격도 카탈로그 값을 그대로 써서, 실제 사용량
// 기준 원가를 뽑는다.
//
//   set OPENROUTER_API_KEY=sk-or-...            (Windows)
//   export OPENROUTER_API_KEY=sk-or-...         (bash)
//
//   node tools/compare-models.mjs list qwen                 카탈로그 검색
//   node tools/compare-models.mjs notes script.txt          노트 품질 비교
//   node tools/compare-models.mjs ocr slide.png             글자 인식 비교
//
// script.txt 는 확장 패널의 "인식된 텍스트 전체"를 복사해 붙이면 된다.

import fs from "node:fs";
import path from "node:path";

const KEY = process.env.OPENROUTER_API_KEY || process.argv.find((a) => a.startsWith("--key="))?.slice(6);
const API = "https://openrouter.ai/api/v1";
const KRW = Number(process.env.USD_KRW || 1450);

// 후보. 카탈로그에서 이 조각들을 모두 포함하는 첫 모델을 고른다.
// 우선순위:
//   - Qwen-VL OCR: OCR 단계 최우선 특화 모델 (가장 저렴, 고성능)
//   - Claude Haiku 4.5: 중간 등급 노트 후보 (미국 서버, 빠른 속도)
//   - DeepSeek V4 Flash: 저가 노트 후보 (피크 요금 및 레이턴시 감안)
//   - Claude Sonnet 5: 최상위 티어 유지
const CANDIDATES = {
  notes: [
    ["claude", "sonnet-5"],        // 최상위 플래그십
    ["claude", "haiku-4.5"],       // 중간 등급 노트 (미국 서버)
    ["deepseek", "v4-flash"],      // 초저가 고속 노트 (피크 요금 고려)
    ["qwen3.7-flash"],             // 초저가 비교군
    ["gemini-2.5-flash-lite"],     // 구글 저가 모델
    ["gemma-3-27b"],               // 오픈 모델 비교군
  ],
  ocr: [
    ["qwen3-vl-32b"],              // Qwen-VL OCR (특화 모델, $0.10/1M)
    ["gemini-2.5-flash-lite"],     // Gemini Vision ($0.10/1M)
    ["deepseek", "vision"],        // DeepSeek Vision ($0.22/1M)
    ["claude", "haiku-4.5"],       // Haiku Vision ($1.00/1M)
    ["claude", "sonnet-5"],        // Sonnet Vision ($2.00/1M)
  ],
};

const NOTES_PROMPT = (script) =>
  `아래는 대학 강의 영상에서 화면 인식(OCR)과 음성 인식으로 얻은 텍스트다. ` +
  `각 줄 앞의 [mm:ss]는 영상 내 위치다. 이걸로 잘 구조화된 한국어 학습 노트를 작성해라.\n` +
  `오탈자나 조각난 문장이 섞여 있으니 명백한 오독은 문맥으로 보정해라. ` +
  `주어진 텍스트에 실제로 있는 내용만 쓰고 없는 내용을 지어내지 마라. ` +
  `마크다운 본문만 출력하고 인사말이나 메타 코멘트를 붙이지 마라.\n\n${script}`;

const OCR_PROMPT =
  "이 강의 슬라이드에 보이는 텍스트를 그대로 옮겨 적어라. " +
  "줄바꿈은 유지하고, 읽을 수 없는 부분은 [?]로 표시해라. 설명이나 추측을 덧붙이지 마라.";

const die = (m) => { console.error(m); process.exit(1); };

async function catalog() {
  const res = await fetch(`${API}/models`);
  if (!res.ok) die(`카탈로그를 못 받았다: ${res.status}`);
  return (await res.json()).data;
}

// 조각을 전부 포함하는 모델을 찾는다. 두 가지를 걸러야 한다:
//   ":batch" 같은 변종 접미사 — 배치는 비동기라 대화형에 못 쓴다
//   "~" 접두사 — OpenRouter 의 비정식 라우팅
// 남은 것 중 id 가 가장 짧은 것을 고른다. 접미사가 붙을수록 곁가지라는 뜻이다.
function resolve(models, parts, needVision) {
  const hit = models
    .filter((m) => {
      const id = m.id.toLowerCase();
      if (id.startsWith("~") || id.includes(":")) return false;
      if (!parts.every((p) => id.includes(p))) return false;
      if (needVision) {
        const mods = m.architecture?.input_modalities || m.architecture?.modality || "";
        if (!String(mods).includes("image")) return false;
      }
      return Number(m.pricing?.prompt) > 0;
    })
    .sort((a, b) => a.id.length - b.id.length);
  return hit[0] || null;
}

async function call(model, content) {
  const t0 = Date.now();
  const res = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${KEY}`,
      "X-Title": "Summrizei model comparison",
    },
    body: JSON.stringify({
      model: model.id,
      messages: [{ role: "user", content }],
      max_tokens: 3000,
    }),
  });
  const ms = Date.now() - t0;
  const body = await res.json();
  if (!res.ok || body.error) {
    return { ms, error: body.error?.message || `HTTP ${res.status}`, text: "", usage: {} };
  }
  return {
    ms,
    text: body.choices?.[0]?.message?.content || "(빈 응답)",
    usage: body.usage || {},
    error: null,
  };
}

const costKrw = (model, usage) =>
  ((usage.prompt_tokens || 0) * Number(model.pricing.prompt) +
    (usage.completion_tokens || 0) * Number(model.pricing.completion)) * KRW;

async function main() {
  const rawArgs = process.argv.slice(2).filter((a) => !a.startsWith("--key="));
  const [mode, arg] = rawArgs;
  if (!mode) die("사용법: node tools/compare-models.mjs list|notes|ocr [파일] [--key=sk-or-v1-...]");

  const models = await catalog();

  if (mode === "list") {
    const q = (arg || "").toLowerCase();
    const rows = models
      .filter((m) => m.id.toLowerCase().includes(q))
      .sort((a, b) => Number(a.pricing.prompt) - Number(b.pricing.prompt))
      .slice(0, 40);
    if (!rows.length) return console.log(`"${arg}" 에 맞는 모델이 없다.`);
    console.log("모델 ID".padEnd(52) + "입력 $/1M".padStart(11) + "출력 $/1M".padStart(11) + "  이미지");
    for (const m of rows) {
      const img = String(m.architecture?.input_modalities || "").includes("image") ? "O" : "";
      console.log(
        m.id.padEnd(52) +
          (Number(m.pricing.prompt) * 1e6).toFixed(2).padStart(11) +
          (Number(m.pricing.completion) * 1e6).toFixed(2).padStart(11) +
          "  " + img
      );
    }
    return;
  }

  if (!KEY) die("OPENROUTER_API_KEY 가 없다. https://openrouter.ai/keys 에서 발급해 환경변수로 넣어라.");
  if (!arg) die(`사용법: node tools/compare-models.mjs ${mode} <파일>`);
  if (!fs.existsSync(arg)) die(`파일이 없다: ${arg}`);

  const isOcr = mode === "ocr";
  let content;
  if (isOcr) {
    const ext = path.extname(arg).slice(1).toLowerCase() || "png";
    const b64 = fs.readFileSync(arg).toString("base64");
    content = [
      { type: "text", text: OCR_PROMPT },
      { type: "image_url", image_url: { url: `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${b64}` } },
    ];
  } else {
    content = NOTES_PROMPT(fs.readFileSync(arg, "utf8").trim());
  }

  const picked = [];
  for (const parts of CANDIDATES[isOcr ? "ocr" : "notes"]) {
    const m = resolve(models, parts, isOcr);
    if (m) picked.push(m);
    else console.error(`  건너뜀 — "${parts.join(" ")}" 에 맞는 ${isOcr ? "이미지 지원 " : ""}모델이 없다`);
  }
  if (!picked.length) die("돌릴 모델이 하나도 없다.");

  console.log(`${picked.length}개 모델로 ${isOcr ? "글자 인식" : "노트 생성"} 비교\n`);
  const results = [];
  for (const m of picked) {
    process.stdout.write(`  ${m.id} ... `);
    const r = await call(m, content);
    results.push({ model: m, ...r });
    console.log(r.error ? `실패 (${r.error})` : `${(r.ms / 1000).toFixed(1)}초, ${costKrw(m, r.usage).toFixed(1)}원`);
  }

  // 결과는 파일로. 터미널에서 긴 한국어 노트를 나란히 읽기는 어렵다.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = path.join(path.dirname(arg), `compare-${mode}-${stamp}.md`);
  const lines = [
    `# ${isOcr ? "글자 인식" : "노트 생성"} 비교`,
    "",
    `입력: \`${arg}\` · 환율 ${KRW}원/달러 · ${new Date().toLocaleString("ko-KR")}`,
    "",
    "| 모델 | 입력 tok | 출력 tok | 소요 시간 | 1편 원가 | 30편(월) | 60편(월) |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const r of results) {
    if (r.error) { lines.push(`| ${r.model.id} | — | — | — | 실패 | ${r.error} | — |`); continue; }
    const c = costKrw(r.model, r.usage);
    lines.push(
      `| ${r.model.id} | ${r.usage.prompt_tokens ?? "?"} | ${r.usage.completion_tokens ?? "?"} | ` +
        `${(r.ms / 1000).toFixed(1)}초 | ${c.toFixed(1)}원 | ${Math.round(c * 30).toLocaleString()}원 | ${Math.round(c * 60).toLocaleString()}원 |`
    );
  }
  lines.push("", "> 1편 원가 = 이 입력 1회 기준. 실제로는 OCR이 슬라이드 수(약 20~40장)만큼 반복되므로 OCR은 별도 곱산이 필요합니다.", "");
  for (const r of results) {
    lines.push(`## ${r.model.id}`, "");
    lines.push(r.error ? `실패: ${r.error}` : r.text.trim(), "");
  }
  fs.writeFileSync(out, lines.join("\n"), "utf8");
  console.log(`\n결과: ${out}`);
}

main().catch((e) => die(String(e.stack || e)));
