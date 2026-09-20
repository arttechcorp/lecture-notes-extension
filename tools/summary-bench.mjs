#!/usr/bin/env node
// lib/summary.js 요약 파이프라인의 base(822c333) vs head(eebbe42) 성능을 같은 입력으로 비교한다.
//
// 왜 필요한가: 개선 6가지(병렬화·합성 입력 축소·OCR 점진노출 접기·청크 상한 확대·selectionReason
// 축소·프롬프트 캐시)가 실제로 뭘 얼마나 줄이는지는 강의 크기에 달렸다. 1강의(1x)처럼 청크가
// 1개뿐이면 병렬화·합성 절감은 원천적으로 0이다 — 그 경계를 숫자로 보여준다.
//
// 실 API 호출 없음: service.summary 를 벽시계 지연만 있는 mock 으로 갈아끼운다. 두 리비전을 한
// 프로세스에서 require 하면 IIFE 가 globalThis.SummaryPipeline 을 서로 덮어쓰므로, 리비전마다
// 완전히 새 자식 프로세스(--worker)에서 돌린다.
//
//   node tools/summary-bench.mjs                 전체 (1x,3x,6x,12x × BYOK/서비스 × base/head)
//   node tools/summary-bench.mjs --scale=3        3x 만
//   node tools/summary-bench.mjs --scale=1,12     1x, 12x 만

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_REV = "822c333", HEAD_LABEL = "head (working tree)";
const BASE_WORKTREE = path.join(REPO_ROOT, ".worktrees", "bench-base");
const TIMELINE_FILE = path.join(REPO_ROOT, "lecture_timeline_original.md");
const ALL_SCALES = [1, 3, 6, 12];

// ---------- 타임라인 파서 ----------
// 실제 파일엔 스펙이 말한 리터럴 "슬라이드:" 줄이 없다(0건, 확인함). 대신 타임스탬프가 없는 줄은
// 바로 앞 타임스탬프 줄의 연속(같은 캡처)이다. 그래서 슬라이드 경계는 "새 [mm:ss] OCR 줄의 시작"으로
// 근사하고, 그 뒤에 이어지는 무(無)타임스탬프 줄들은 같은 slideId 를 물려받는다 — 3번 개선(점진 노출
// 접기)이 슬라이드 그룹을 필요로 하므로 이 근사가 없으면 fold 를 아예 관찰할 수 없다.
function parseTimeline(text) {
  const lines = text.split(/\r?\n/);
  const tsRe = /^\[(\d{2}):(\d{2})\]\s?(.*)$/;
  const events = []; // { t0, source, text, slideId }
  let slideCounter = 0, currentSlideId = null, currentSource = null, currentT0 = null;
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(tsRe);
    if (m) {
      currentT0 = Number(m[1]) * 60 + Number(m[2]);
      const rest = m[3];
      if (rest.startsWith("[음성]")) {
        currentSource = "asr";
        currentSlideId = null;
        events.push({ t0: currentT0, source: "asr", text: rest.replace(/^\[음성\]\s*/, "").trim(), slideId: null });
      } else {
        currentSource = "ocr";
        currentSlideId = ++slideCounter;
        events.push({ t0: currentT0, source: "ocr", text: rest.trim(), slideId: currentSlideId });
      }
      continue;
    }
    if (!line || currentT0 === null) continue; // 첫 타임스탬프 이전 잡음 줄은 버린다
    events.push({ t0: currentT0, source: currentSource, text: line, slideId: currentSource === "ocr" ? currentSlideId : null });
  }
  return events.map((e, i) => ({
    id: `ev-${i + 1}`, source: e.source, text: e.text, slideId: e.slideId,
    t0: e.t0, t1: i + 1 < events.length ? events[i + 1].t0 : e.t0 + 5,
  })).filter(e => e.text);
}

// scale 배로 늘린다. 단순 복제 금지 — 사본마다 t0/t1 을 강의 길이만큼 밀고, id 에 사본 번호를
// 붙이고, 본문 앞에 "N부 " 를 붙여 바이트 단위로 다르게 만든다. 그래야 lib/summary.js 의 요청
// 캐시(requestId = model+chunk 해시)에 걸려 두 번째 사본부터 호출이 안 나가는 왜곡을 막는다.
function scaleTimeline(events, scale) {
  const duration = Math.max(...events.map(e => e.t1)) + 5; // 사본 사이 여백
  const out = [];
  for (let copy = 0; copy < scale; copy++) {
    const shift = copy * duration, label = `${copy + 1}부 `;
    for (const e of events) {
      // slideId 도 사본마다 떼어 놓는다 — 안 그러면 preprocessEvidence 가 epoch·slideId 만 보고
      // 서로 다른 사본의 슬라이드를 같은 그룹으로 묶는다. 접두어가 달라 실제로 fold 되진 않지만
      // 그룹이 사본 수만큼 부풀어 O(n²) 비교를 불필요하게 키운다.
      out.push({ ...e, id: `${e.id}-c${copy + 1}`, t0: e.t0 + shift, t1: e.t1 + shift, text: label + e.text, slideId: e.slideId == null ? null : e.slideId + copy * 1_000_000 });
    }
  }
  return out;
}

// ---------- 자식 프로세스(worker) : 실제 리비전의 lib/summary.js 를 돌린다 ----------
async function runWorker({ dir, evidencePath, mode, delayMs }) {
  const summary = require(path.join(dir, "lib", "summary.js"));
  const orClient = require(path.join(dir, "lib", "openrouter-client.js"));
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  const byteLength = s => Buffer.byteLength(s);
  const schemaBytes = byteLength(JSON.stringify(orClient.schema));
  const model = "google/gemini-2.5-flash-lite";

  const calls = []; // { stage, count, evidenceBytes, systemBytes, schemaBytes }
  const service = {
    summary: async ({ evidence: chunk, stage }) => {
      await new Promise(resolve => setTimeout(resolve, delayMs)); // 고정 지연 — 병렬화 효과를 벽시계에 드러낸다
      const evidenceBytes = byteLength(JSON.stringify(chunk));
      const systemBytes = byteLength(orClient.systemFor(stage));
      calls.push({ stage, count: chunk.length, evidenceBytes, systemBytes, schemaBytes });
      // 전체 id 는 sections 한 필드에만 싣는다(그것만으로 커버리지 100%). keyConclusions·
      // reviewQuestions 까지 전체 id 를 반복해 싣던 첫 버전은 합성 단계에서 chapter 노트 텍스트가
      // 배로 불어나 chunkEvidence 가 다시 쪼개기만 하고 안 줄어, "전체 합성 단계가 안전 상한을
      // 초과했습니다"(depth 12 컷)로 죽었다 — 실측으로 걸린 문제라 남긴다.
      // 실제 모델은 한 항목에 청크의 모든 id 를 싶지 않고, 일부는 아예 인용하지 않는다.
      // 전량 인용 목은 두 가지를 동시에 일그러트렸다: 합성 노드가 절대 줄지 않는 최악만
      // 재게 되고(6x 가 7분에도 안 끝났다), uncited 가 항상 바었어서 합성 입력에서
      // uncited 를 걷어낸 개선이 아무 것도 재지 못했다.
      // 80% 만 인용한다 — MIN_COVERAGE(.5) 위에 있으면서 나머지는 uncited 로 드러난다.
      const ids = chunk.map(e => e.id);
      // 항목이 5건 이하면 전부 인용한다. 20% 드롭을 그대로 적용하면 1건 배치에서 인용이 0건이 되어
      // keyConclusions 가 비고 validateSummary 가 막는다 — 합성 마지만 배치가 노드 1개일 때 실제로 걸렸다.
      const cited = ids.length <= 5 ? ids.slice() : ids.filter((_, i) => i % 5 !== 0);
      const bucket = n => { const part = cited.filter((_, i) => i % 5 === n); return part.length ? part : [cited[0]]; };
      const value = {
        title: "모의 요약",
        keyConclusions: [{ content: "모의 요약 문장입니다.", importance: "important", evidenceIds: bucket(0) }],
        concepts: [], corrections: [], openQuestions: [],
        sections: [0, 1, 2, 3, 4].map(n => ({ heading: `모의 구간 ${n + 1}`, content: "모의 구간 설명입니다.", importance: "important", evidenceIds: bucket(n) })),
        formulas: [], visuals: [], reviewQuestions: [{ question: "모의 확인 질문입니까?", evidenceIds: bucket(1) }],
      };
      return { summary: value, usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 } };
    },
  };

  const settings = mode === "byok"
    ? { openRouterApiKey: "sk-or-v1-" + "a".repeat(32), remoteSummaryConsent: true, summaryModel: model }
    : { serviceUrl: "https://svc.example", appSessionToken: "app-session-token".padEnd(32, "x"), remoteSummaryConsent: true, summaryModel: model };

  // fold 효과(3번 개선)를 격리해서 잰다: preprocessEvidence 만 따로 돌려 슬라이드 접기로 filtered 된
  // 건수를 센다. generate() 안에서도 같은 함수가 도는데, 그 filtered 근거는 chunkEvidence 가 아예
  // 청크에서 빼버려 모델에 보내는 바이트에도 이미 반영된다.
  const prepared = summary.preprocessEvidence(evidence);
  const foldFiltered = prepared.filter(e => e.selectionReason === "뒤 캡처에 그대로 포함된 부분 인식").length;
  const totalFiltered = prepared.filter(e => e.selection === "filtered").length;

  // 목(mock)은 스펙대로 받은 근거 id 를 전부 인용한다. 그러면 합성이 깊어질수록(원본 청크를
  // 더 많이 묶을수록) remapSummary 가 되살리는 원본 id 목록도 그만큼 커져, 노드 텍스트가 절대
  // 줄지 않는 최악의 경우가 된다 — 대규모 배율에서 12단계 합성 안전 상한에 실제로 부딪힐 수 있다.
  // 이건 목의 결함이 아니라 "압축을 하나도 안 하는 모델을 물리면 파이프라인이 어디서 막히는가"를
  // 보여주는 실측이라 숨기지 않고 실패로 기록한다.
  let result, generateError = null;
  const started = Date.now();
  try { result = await summary.generate(evidence, { sessionId: "bench", settings, service }); }
  catch (error) { generateError = error.message; }
  const wallMs = Date.now() - started;

  if (generateError) {
    return { failed: true, error: generateError, chunkCalls: calls.filter(c => c.stage === "chunk").length, wallMs, foldFiltered, totalFiltered };
  }
  const chunkCalls = calls.filter(c => c.stage === "chunk"), synthCalls = calls.filter(c => c.stage === "synthesis");
  const sumBytes = list => list.reduce((n, c) => n + c.evidenceBytes + c.systemBytes + c.schemaBytes, 0);
  return {
    status: result.status, chunkCount: result.coverage?.total ?? chunkCalls.length,
    chunkCalls: chunkCalls.length, synthesisCalls: synthCalls.length,
    chunkBytes: sumBytes(chunkCalls), synthesisBytes: sumBytes(synthCalls),
    totalBytes: sumBytes(calls), wallMs, foldFiltered, totalFiltered,
  };
}

// ---------- 오케스트레이터 ----------
function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2]; else out[a.replace(/^--/, "")] = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.worker) {
    const result = await runWorker({ dir: args.dir, evidencePath: args.evidence, mode: args.mode, delayMs: Number(args.delay) });
    process.stdout.write(JSON.stringify(result));
    return;
  }

  // 목 지연은 병렬화를 벽시계에 드러내는 장치일 뿐이다. base/head 감소율은 지연 크기에
  // 밀리지 않으므로 호출이 많은 배율은 내려서 돌린다. 다만 배율간 벽시계 절대치 바교는 안 된다.
  const delayMs = args.delay === undefined ? 1200 : Number(args.delay);
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error(`지원하지 않는 --delay 값: ${args.delay}`);
  const scales = args.scale ? String(args.scale).split(",").map(Number) : ALL_SCALES;
  for (const s of scales) if (!ALL_SCALES.includes(s)) throw new Error(`지원하지 않는 --scale 값: ${s} (1,3,6,12 중 선택)`);

  // base 리비전을 worktree 로 꺼낸다.
  let ownWorktree = false;
  try {
    execFileSync("git", ["worktree", "list"], { cwd: REPO_ROOT }).toString();
  } catch (e) { throw new Error(`git worktree 조회 실패: ${e.message}`); }
  const listed = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: REPO_ROOT }).toString();
  if (!listed.includes(BASE_WORKTREE.replace(/\\/g, "/")) && !listed.includes(BASE_WORKTREE)) {
    execFileSync("git", ["worktree", "add", "--detach", BASE_WORKTREE, BASE_REV], { cwd: REPO_ROOT, stdio: "inherit" });
    ownWorktree = true;
  }

  const revisions = [
    { name: `base (${BASE_REV})`, dir: BASE_WORKTREE },
    { name: HEAD_LABEL, dir: REPO_ROOT },
  ];
  const modes = ["byok", "service"];

  const rawEvents = parseTimeline(readFileSync(TIMELINE_FILE, "utf8"));
  console.log(`(원본 타임라인: ${rawEvents.length}개 근거, ${readFileSync(TIMELINE_FILE, "utf8").length.toLocaleString()}자)\n`);

  const tmp = mkdtempSync(path.join(tmpdir(), "summary-bench-"));
  const rows = [];
  try {
    for (const scale of scales) {
      const evidence = scaleTimeline(rawEvents, scale);
      const evidencePath = path.join(tmp, `evidence-${scale}x.json`);
      writeFileSync(evidencePath, JSON.stringify(evidence));
      const byRevMode = {};
      for (const rev of revisions) {
        for (const mode of modes) {
          // 힙을 키운다: 6x base 워커가 기본 힙에서 OOM 으로 죽었다(status 134). 합성 노드 텍스트가
          // 예산을 넘으면 옛 글자 단위 분할 경로로 들어가 메모리를 물어뜻는다. base 수치를 실제로
          // 받아보려면 여유가 필요하다 — 이건 측정 장치의 여유지, 개선 효과를 가리는 것이 아니다.
          const out = execFileSync(process.execPath, [
            "--max-old-space-size=6144",
            fileURLToPath(import.meta.url), "--worker", `--dir=${rev.dir}`, `--evidence=${evidencePath}`, `--mode=${mode}`, `--delay=${delayMs}`,
          ], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 }).toString();
          byRevMode[`${rev.name}|${mode}`] = JSON.parse(out);
        }
      }
      const row = { scale, evidenceCount: evidence.length, byRevMode };
      rows.push(row);
      printScale(row, revisions, modes); // 마지막에 몰아 찍으면 오래 걸리는 배율에서 진행 상황이 한 줄도 안 보인다.
    }
  } finally {
    if (ownWorktree) {
      try { execFileSync("git", ["worktree", "remove", "--force", BASE_WORKTREE], { cwd: REPO_ROOT, stdio: "inherit" }); }
      catch (e) { console.error(`worktree 정리 실패(수동 확인 필요): ${e.message}`); }
    }
    rmSync(tmp, { recursive: true, force: true });
  }

  if (!rows.length) throw new Error("잴 배율이 없다.");
}

function pct(base, head) { return base ? (100 * (base - head) / base).toFixed(1) : "n/a"; }

function printScale(row, revisions, modes) {
  // 배율 하나의 표를 그 자리에서 찍는다 — 이하 본문은 원래 for 루프 속이라 한 단개 들여쓰기를 유지한다.
  {
    console.log(`### ${row.scale}x (근거 ${row.evidenceCount}건)\n`);
    console.log("| 경로 | 리비전 | 청크수 | chunk호출 | synthesis호출 | 총 입력바이트 | 벽시계(ms) | fold로 접힌 근거 |");
    console.log("|---|---|---:|---:|---:|---:|---:|---:|");
    for (const mode of modes) {
      const base = row.byRevMode[`${revisions[0].name}|${mode}`];
      const head = row.byRevMode[`${revisions[1].name}|${mode}`];
      for (const [label, r] of [[revisions[0].name, base], [revisions[1].name, head]]) {
        if (r.failed) {
          console.log(`| ${mode === "byok" ? "BYOK" : "서비스"} | ${label} | FAIL: ${r.error} (chunk호출 ${r.chunkCalls}회, ${r.wallMs}ms 소요 후 중단) | | | | | ${r.foldFiltered} |`);
        } else {
          console.log(`| ${mode === "byok" ? "BYOK" : "서비스"} | ${label} | ${r.chunkCount} | ${r.chunkCalls} | ${r.synthesisCalls} | ${r.totalBytes.toLocaleString()} | ${r.wallMs} | ${r.foldFiltered} |`);
        }
      }
      if (base.failed || head.failed) {
        console.log(`| ${mode === "byok" ? "BYOK" : "서비스"} | **감소율** | 하나 이상 실패 — 비교 불가 | | | | | |`);
      } else {
        console.log(`| ${mode === "byok" ? "BYOK" : "서비스"} | **감소율** | | | | **${pct(base.totalBytes, head.totalBytes)}%** | **${pct(base.wallMs, head.wallMs)}%** | |`);
      }
    }
    console.log("");
  }
}

main().catch(error => { console.error(error); process.exit(1); });
