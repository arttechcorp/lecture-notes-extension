#!/usr/bin/env node
// 요약 응답이 다이어그램/수식 규약(멘션 펜스, 슬래시 분수 금지, LaTeX 구분자 등)을
// 얼마나 어기는지 모델별로 반복 측정한다.
//
// 왜 필요한가: 프롬프트에 규칙을 적어둬도 모델이 지키는지는 실측해야 안다.
// sample-lecture.txt 를 근거로 실제 summary() 를 여러 번 불러, 위반을 항목별로
// 세어 비율로 보고한다.
//
//   set OPENROUTER_API_KEY=sk-or-...            (Windows)
//   node tools/diagram-violation-probe.mjs --dry-run             파싱만 확인 (무료)
//   node tools/diagram-violation-probe.mjs --n=3 --models=a,b    실행
//   node tools/diagram-violation-probe.mjs --out=path.json       출력 경로 지정
//   node tools/diagram-violation-probe.mjs --corpus=file.txt     입력 코퍼스 지정

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { summary, MODELS } = require(path.join(ROOT, "lib", "openrouter-client.js"));

const DEFAULT_MODELS = ["google/gemini-2.5-flash-lite", "google/gemini-3.8-flash", "anthropic/claude-haiku-4.5"];

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

function readApiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  const file = path.join(ROOT, "apikey.env.local");
  if (!fs.existsSync(file)) throw new Error("OPENROUTER_API_KEY 가 없고 apikey.env.local 파일도 없다.");
  const raw = fs.readFileSync(file, "utf8").trim();
  return (raw.includes("=") ? raw.slice(raw.indexOf("=") + 1) : raw).trim();
}

// "[MM:SS] [음성]? text" 줄을 evidence 항목으로 바꾼다.
function parseCorpus(text) {
  const lines = text.split(/\r?\n/);
  const evidence = [];
  let i = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(/^\s*\[(\d{1,2}):(\d{2})\]\s*(\[음성\]\s*)?(.*)$/);
    if (!m) continue;
    const t0 = Number(m[1]) * 60 + Number(m[2]);
    evidence.push({
      id: `e-${i}`,
      text: m[4].trim(),
      source: m[3] ? "asr" : "ocr",
      t0,
      t1: t0,
      selection: "included",
      selectionReason: "학습 근거로 보존",
    });
    i++;
  }
  return evidence;
}

// visuals[].data 안에서 mermaid 소스를 찾는다: 펜스로 감싼 것과, 키워드로 시작하는 맨몸 소스 둘 다.
const MERMAID_START = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|mindmap|journey|gantt|pie)\b/i;
function findMermaidSources(data) {
  if (typeof data !== "string") return { sources: [], fenced: false };
  const fenceMatch = data.match(/```[ \t]*mermaid\s*\n([\s\S]*?)```/i);
  if (fenceMatch) return { sources: [fenceMatch[1]], fenced: true };
  return { sources: MERMAID_START.test(data.trim()) ? [data] : [], fenced: false };
}

function mermaidSubChecks(src) {
  const hits = [];
  const trimmed = src.trim();
  if (/^graph\s/i.test(trimmed)) hits.push("legacy_graph");
  if (/\b\w+\s*\[(?!")[^\]\n]*[^"\]\s][^\]\n]*\]/.test(src)) hits.push("unquoted_node_label");
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^\s*subgraph\s+(.*)$/);
    if (m && /\s/.test(m[1]) && !m[1].includes('"')) hits.push("unquoted_subgraph");
  }
  if (src.includes("$")) hits.push("dollar_in_label");
  return [...new Set(hits)];
}

const UNESCAPED_DOLLAR = /(^|[^\\])\$/;
const TEX_DELIM = /\\\(|\\\)|\\\[|\\\]/;
const SLASH_FRACTION = /\b\d+\s*\/\s*\d+\b/;

// summary 객체를 훑어 위반을 센다. { violations: {code: {hits, denom}}, mermaidSubHits: {name: count} }
function scanSummary(s) {
  const v = {
    V1_relationship_no_fence: { hits: 0, denom: 0 },
    V2_table_fenced: { hits: 0, denom: 0 },
    V3_latex_has_dollar: { hits: 0, denom: 0 },
    V4_prose_tex_delims: { hits: 0, denom: 0 },
    V5_mermaid_syntax: { hits: 0, denom: 0 },
    V6_slash_fraction: { hits: 0, denom: 0 },
  };
  const mermaidSubHits = {};
  const visuals = Array.isArray(s.visuals) ? s.visuals : [];
  const formulas = Array.isArray(s.formulas) ? s.formulas : [];

  for (const vis of visuals) {
    const raw = typeof vis?.data === "string" ? vis.data : "";
    if (vis?.type === "relationship") {
      v.V1_relationship_no_fence.denom++;
      if (!/```[ \t]*mermaid/i.test(raw)) v.V1_relationship_no_fence.hits++;
    }
    if (vis?.type === "table" || vis?.type === "chart") {
      v.V2_table_fenced.denom++;
      if (/```/.test(raw)) v.V2_table_fenced.hits++;
    }
    const { sources } = findMermaidSources(raw);
    for (const src of sources) {
      v.V5_mermaid_syntax.denom++;
      const subHits = mermaidSubChecks(src);
      if (subHits.length) v.V5_mermaid_syntax.hits++;
      for (const name of subHits) mermaidSubHits[name] = (mermaidSubHits[name] || 0) + 1;
    }
  }

  for (const f of formulas) {
    v.V3_latex_has_dollar.denom++;
    if (typeof f?.latex === "string" && UNESCAPED_DOLLAR.test(f.latex)) v.V3_latex_has_dollar.hits++;
  }

  // V4/V6 프로즈 필드 모으기
  const prose = [];
  if (typeof s.title === "string") prose.push(s.title);
  for (const list of [s.keyConclusions, s.concepts, s.corrections, s.openQuestions]) {
    for (const it of Array.isArray(list) ? list : []) if (typeof it?.content === "string") prose.push(it.content);
  }
  for (const sec of Array.isArray(s.sections) ? s.sections : []) {
    if (typeof sec?.heading === "string") prose.push(sec.heading);
    if (typeof sec?.content === "string") prose.push(sec.content);
  }
  for (const f of formulas) {
    for (const k of ["explanation", "variables", "units", "conditions"]) if (typeof f?.[k] === "string") prose.push(f[k]);
  }
  for (const vis of visuals) {
    if (typeof vis?.title === "string") prose.push(vis.title);
    if (typeof vis?.description === "string") prose.push(vis.description);
  }
  for (const q of Array.isArray(s.reviewQuestions) ? s.reviewQuestions : []) {
    if (typeof q?.question === "string") prose.push(q.question);
  }

  v.V4_prose_tex_delims.denom = prose.length;
  for (const p of prose) if (TEX_DELIM.test(p)) v.V4_prose_tex_delims.hits++;

  v.V6_slash_fraction.denom = prose.length + formulas.length;
  for (const p of prose) if (SLASH_FRACTION.test(p)) v.V6_slash_fraction.hits++;
  for (const f of formulas) if (typeof f?.latex === "string" && SLASH_FRACTION.test(f.latex)) v.V6_slash_fraction.hits++;

  return { violations: v, mermaidSubHits, visualCount: visuals.length, relationshipCount: visuals.filter((x) => x?.type === "relationship").length, formulaCount: formulas.length };
}

async function main() {
  const corpus = arg("corpus", path.join(ROOT, "tools", "sample-lecture.txt"));
  const evidence = parseCorpus(fs.readFileSync(corpus, "utf8"));
  if (hasFlag("dry-run")) {
    console.log(`evidence 항목 수: ${evidence.length}`);
    console.log(JSON.stringify(evidence.slice(0, 2), null, 2));
    return;
  }

  const n = Number(arg("n", "3"));
  const models = (arg("models", "") || DEFAULT_MODELS.join(",")).split(",").map((m) => m.trim()).filter(Boolean);
  for (const m of models) if (!MODELS[m]) throw new Error(`알 수 없는 모델: ${m} (MODELS 키가 아니다)`);

  const apiKey = readApiKey();
  const runs = [];

  for (const model of models) {
    for (let attempt = 0; attempt < n; attempt++) {
      const t0 = Date.now();
      try {
        const { summary: s, usage } = await summary({ apiKey, model, evidence, stage: "chunk", timeoutMs: 120000 });
        const scan = scanSummary(s);
        runs.push({ model, attempt, ms: Date.now() - t0, usage, ...scan, summaryRaw: s });
      } catch (e) {
        runs.push({ model, attempt, ms: Date.now() - t0, error: String(e?.message || e) });
      }
    }
  }

  const stamp = new Date().toISOString().replace(/:/g, "-");
  const outPath = arg("out", path.join("C:\\Users\\부지환\\AppData\\Local\\Temp\\claude\\C--Users-----OneDrive-Desktop-vibe-coding-claude-workspace-lecture-notes\\6c7458ea-7b53-4702-8fb9-3d609326a9d2\\scratchpad", `violation-probe-${stamp}.json`));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(runs, null, 2), "utf8");

  printTable(models, runs);
  console.log(`\n원본 기록: ${outPath}`);
}

const VCODES = ["V1_relationship_no_fence", "V2_table_fenced", "V3_latex_has_dollar", "V4_prose_tex_delims", "V5_mermaid_syntax", "V6_slash_fraction"];

function printTable(models, runs) {
  for (const model of models) {
    const mine = runs.filter((r) => r.model === model);
    const ok = mine.filter((r) => !r.error);
    const failed = mine.length - ok.length;
    console.log(`\n${model}  (runs ok=${ok.length} failed=${failed})`);
    const totals = {};
    for (const code of VCODES) totals[code] = { hits: 0, denom: 0 };
    let cost = 0;
    const subHits = {};
    for (const r of ok) {
      for (const code of VCODES) {
        totals[code].hits += r.violations[code].hits;
        totals[code].denom += r.violations[code].denom;
      }
      cost += r.usage?.costUsd || 0;
      for (const [k, c] of Object.entries(r.mermaidSubHits || {})) subHits[k] = (subHits[k] || 0) + c;
    }
    for (const code of VCODES) {
      const { hits, denom } = totals[code];
      const pct = denom ? ((hits / denom) * 100).toFixed(1) : "n/a";
      console.log(`  ${code.padEnd(26)} ${String(hits).padStart(3)}/${String(denom).padEnd(4)} (${pct}%)`);
    }
    console.log(`  총 비용: $${cost.toFixed(4)}`);
    const subList = Object.entries(subHits).map(([k, c]) => `${k}=${c}`).join(", ") || "없음";
    console.log(`  V5 세부: ${subList}`);
  }
}

main().catch((e) => { console.error(String(e?.stack || e)); process.exit(1); });
