// 골든 라벨 JSONL 을 /v1/judge 로 돌려 과제별 정확도·ECE·지연·비용을 잰다.
// 수동 벤치 전용 — 토큰을 들고 직접 실행할 때만 네트워크를 탄다.
// 입력 파일과 --out 은 저장소 밖이어야 한다: 강의 발화 텍스트가 repo 에 남으면 안 된다.
// 사용: node tools/judge-bench.mjs <items.jsonl> <서비스URL> <토큰> [모델] [--batch=50] [--out=<dir>]
//
// 입력: 줄당 {task, itemId, text, context?, label} — task 는
//   utterance|importance|boilerplate|figure|support 중 하나.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ece, percentile, reliabilityBins } from "./bench-metrics.mjs";

const TASKS = new Set(["utterance", "importance", "boilerplate", "figure", "support"]);
const MAX_ITEMS = 200, MAX_BYTES = 60000; // 서버 배치 한도 — 둘 다 넘기면 안 된다
const USAGE = "사용: node tools/judge-bench.mjs <items.jsonl> <서비스URL> <토큰> [모델] [--batch=50] [--out=<dir>]";
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter(a => a.startsWith("--")).map(a => {
  const i = a.indexOf("="); // 값에 = 가 들어갈 수 있어 첫 = 에서만 자른다
  return i < 0 ? [a.slice(2), ""] : [a.slice(2, i), a.slice(i + 1)];
}));
const [file, baseUrl, token, model = "openai/gpt-4.1-nano"] = args.filter(a => !a.startsWith("--"));
const batchSize = Math.max(1, Math.min(MAX_ITEMS, Number(flags.batch) || 50));
// 인자 검사는 디스크·네트워크 접근보다 먼저.
if (!file || !baseUrl || !token) { console.error(USAGE); process.exit(1); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // tools 의 부모 = repo 루트
const inside = p => p === ROOT || p.startsWith(ROOT + path.sep);
const jsonl = path.resolve(file);
if (inside(jsonl)) { console.error("거절: items.jsonl 이 저장소 안입니다. 골든 데이터는 저장소 밖에 두세요."); process.exit(1); }
if (!existsSync(jsonl)) { console.error("파일이 없습니다: " + jsonl); process.exit(1); }
const outDir = path.resolve(flags.out || path.join(path.dirname(jsonl), "results"));
if (inside(outDir)) { console.error("거절: --out 디렉터리가 저장소 안입니다."); process.exit(1); }

const items = [], invalid = [];
for (const [i, line] of readFileSync(jsonl, "utf8").split(/\r?\n/).entries()) {
  if (!line.trim()) continue;
  let x = null;
  try { x = JSON.parse(line); } catch { /* 아래에서 invalid 로 잡힌다 */ }
  if (!x || !TASKS.has(x.task) || (typeof x.itemId !== "string" && typeof x.itemId !== "number") || typeof x.text !== "string" || x.label == null) {
    invalid.push({ line: i + 1, text: line.slice(0, 80) });
    continue;
  }
  items.push({ task: x.task, itemId: String(x.itemId), text: x.text, context: x.context, label: String(x.label) }); // 라벨은 문자열로 비교
}
for (const v of invalid) console.warn(`무시: ${v.line}번 줄 — 형식이 올바르지 않습니다 (${v.text})`);
if (!items.length) { console.error("유효한 항목이 없습니다."); process.exit(1); }

const groups = new Map();
for (const it of items) {
  if (!groups.has(it.task)) groups.set(it.task, []);
  groups.get(it.task).push(it);
}

// 요청 본문에는 itemId/text/context 만 실어 보낸다 — 라벨·잡필드가 새나가면 안 된다.
const payloadOf = it => ({ itemId: it.itemId, text: it.text, ...(it.context !== undefined ? { context: it.context } : {}) });
function* batches(list) {
  let cur = [], bytes = 2; // "[]"
  for (const it of list) {
    const b = Buffer.byteLength(JSON.stringify(payloadOf(it))) + 1; // + 쉼표
    if (cur.length && (cur.length >= batchSize || bytes + b > MAX_BYTES)) { yield cur; cur = []; bytes = 2; }
    cur.push(it); bytes += b;
  }
  if (cur.length) yield cur;
}

const got = new Map(); // "task itemId" -> result
const stats = new Map([...groups.keys()].map(t => [t, { latencies: [], costUsd: 0, tokens: { prompt: 0, completion: 0 } }]));
const failures = [];
let bi = 0;
for (const [task, list] of groups) {
  const st = stats.get(task);
  for (const batch of batches(list)) {
    const started = Date.now();
    let body = null, http = 0;
    try {
      const res = await fetch(baseUrl + "/v1/judge", {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify({ task, model, requestId: `bench-judge-${Date.now()}-${bi}`, items: batch.map(payloadOf) }),
      });
      http = res.status;
      body = await res.json().catch(() => null);
    } catch (e) {
      body = { error: { code: "network", message: String((e && e.message) || e) } };
    }
    const ms = Date.now() - started;
    st.latencies.push(ms);
    const err = body && body.error; // {code,...} 이거나 옛 문자열 형태일 수 있다
    if (err || !body || !Array.isArray(body.results)) {
      const code = typeof err === "string" ? err : (err && err.code) || (body ? "no_results" : `HTTP ${http}`);
      failures.push({ task, batch: bi, items: batch.length, error: code });
      console.log(`${task}\t배치 ${bi}\t실패\t${code}`);
      bi++;
      continue; // 실패는 세고 나열할 뿐, 실행을 멈추지 않는다
    }
    bi++;
    st.costUsd += body.usage?.costUsd || 0;
    st.tokens.prompt += body.usage?.promptTokens || 0;
    st.tokens.completion += body.usage?.completionTokens || 0;
    for (const r of body.results) if (r && r.itemId != null) got.set(task + " " + String(r.itemId), r);
    console.log(`${task}\t배치 ${bi - 1}\t${batch.length}건\t${(ms / 1000).toFixed(1)}s\t$${(body.usage?.costUsd || 0).toFixed(4)}`);
  }
}

// 과제별 지표 — probs [] 는 보류(abstain): 정확도 분모에는 들어가고 오답으로 센다.
const rows = [], tasks = {};
let totCorrect = 0, totJudged = 0;
for (const [task, list] of groups) {
  const st = stats.get(task);
  const probsArr = [], goldIdx = [];
  let correct = 0, answered = 0, answeredCorrect = 0, abstained = 0, missing = 0, within1Hit = 0, within1N = 0;
  for (const it of list) {
    const r = got.get(task + " " + it.itemId);
    if (!r) { missing++; rows.push({ task, itemId: it.itemId, label: it.label, error: "no_result" }); continue; }
    const probs = Array.isArray(r.probs) ? r.probs : [];
    const ps = probs.map(p => Number(p.p) || 0);
    const gi = probs.findIndex(p => String(p.label) === it.label); // gold 가 라벨 집합에 없으면 -1 → 항상 오답
    probsArr.push(ps); goldIdx.push(gi);
    let pred = null, conf = null, ok = false;
    if (ps.length) {
      let a = 0;
      for (let j = 1; j < ps.length; j++) if (ps[j] > ps[a]) a = j;
      pred = String(probs[a].label); conf = ps[a];
      answered++;
      if (pred === it.label) { ok = true; answeredCorrect++; correct++; }
    } else abstained++;
    // importance 는 기댓값 점수가 금값 ±1 안에 드는 비율도 잰다 — 서열 과제라 1칸 오차는 반은 맞은 것이다.
    let within1 = null, score = Number.isFinite(r.score) ? r.score : null;
    if (task === "importance") {
      if (score == null && ps.length) score = probs.reduce((s, p) => s + (Number(p.label) || 0) * (Number(p.p) || 0), 0);
      if (score != null && Number.isFinite(Number(it.label))) {
        within1 = Math.abs(score - Number(it.label)) <= 1;
        within1N++; if (within1) within1Hit++;
      }
    }
    rows.push({ task, itemId: it.itemId, label: it.label, pred, conf, correct: ok, abstained: !ps.length, within1, score, probs });
  }
  const judged = list.length - missing;
  const latSum = st.latencies.reduce((s, v) => s + v, 0);
  tasks[task] = {
    items: list.length, judged, missing, abstained,
    accuracy: judged ? correct / judged : null,
    answeredAccuracy: answered ? answeredCorrect / answered : null,
    ece: ece(probsArr, goldIdx),
    bins: reliabilityBins(probsArr, goldIdx),
    latencyP50ms: percentile(st.latencies, 50), latencyP90ms: percentile(st.latencies, 90),
    meanMsPerItem: list.length ? latSum / list.length : null,
    costUsd: st.costUsd, costPer1000: judged ? st.costUsd / judged * 1000 : null,
    promptTokens: st.tokens.prompt, completionTokens: st.tokens.completion,
  };
  if (task === "importance") tasks[task].within1 = within1N ? within1Hit / within1N : null;
  totCorrect += correct; totJudged += judged;
}
const overall = { items: items.length, judged: totJudged, accuracy: totJudged ? totCorrect / totJudged : null };

mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/:/g, "-"); // 파일명에 : 는 못 쓴다
const jsonPath = path.join(outDir, `judge-bench-${stamp}.json`);
const mdPath = path.join(outDir, `judge-bench-${stamp}.md`);
writeFileSync(jsonPath, JSON.stringify({ model, date: new Date().toISOString(), batchSize, overall, tasks, failures, invalid, rows }, null, 2));

const pct = v => v == null ? "-" : (v * 100).toFixed(1) + "%";
const sec = v => v == null ? "-" : (v / 1000).toFixed(1) + "s";
const md = [`# 판정 벤치 — ${model}`, "",
  `- 날짜: ${new Date().toISOString()}`,
  `- 항목 ${items.length}개 · 무효 줄 ${invalid.length}개 · 실패 요청 ${failures.length}건`,
  `- 전체 정확도 ${pct(overall.accuracy)} (판정된 ${overall.judged}개 기준)`, ""];
for (const [task, t] of Object.entries(tasks)) {
  md.push(`## ${task}`, "", "| 지표 | 값 |", "|---|---|",
    `| 정확도 | ${pct(t.accuracy)} (${t.judged}개 중, 보류는 오답) |`,
    `| 응답 정확도 | ${pct(t.answeredAccuracy)} (${t.judged - t.abstained}개 응답 기준) |`,
    `| ECE | ${t.ece == null ? "-" : t.ece.toFixed(4)} |`,
    `| 보류 | ${t.abstained}개 |`,
    `| 결과 없음(요청 실패) | ${t.missing}개 |`);
  if (t.within1 != null) md.push(`| ±1 이내 | ${pct(t.within1)} |`);
  md.push(`| 지연 p50 / p90 | ${sec(t.latencyP50ms)} / ${sec(t.latencyP90ms)} · 항목당 ${t.meanMsPerItem == null ? "-" : t.meanMsPerItem.toFixed(0) + "ms"} |`,
    `| 비용 | $${t.costUsd.toFixed(4)} (1000건당 ${t.costPer1000 == null ? "-" : "$" + t.costPer1000.toFixed(4)}) |`, "",
    "| 신뢰도 구간 | n | 정확도 | 평균 신뢰도 |", "|---|---|---|---|");
  for (const b of t.bins) md.push(`| ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} | ${b.n} | ${pct(b.accuracy)} | ${pct(b.confidence)} |`);
  md.push("");
}
if (failures.length) {
  md.push("## 실패", "");
  for (const f of failures) md.push(`- ${f.task} 배치 ${f.batch} (${f.items}건): ${f.error}`);
  md.push("");
}
writeFileSync(mdPath, md.join("\n") + "\n");
console.log("보고서: " + mdPath);
