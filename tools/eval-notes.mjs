// 노트 품질 평가 하네스(개발 전용 — package-cws 가 tools/ 를 패키지에서 제외한다).
// 제안서 §4 평가 설계 구현: admin 비교 화면의 "평가용보내기" 실행 기록 JSON 과 사람 라벨을 받아
// 경로(arm)별 false withhold/false accept·필수 항목 보존율·ECE(점수 10구간)·라벨러 일치도(Cohen κ)·
// API 미응답 제외 정확도·전체 판정 성공률·비용·p50/p95 지연을 로컬에서만 계산한다.
// 네트워크·유료 호출 없음. 입력 파일과 --out 디렉터리는 저장소 밖이어야 한다(평문 강의 내용이 repo 에 남으면 안 된다).
//
// 사용:
//   node tools/eval-notes.mjs sample --runs=a.json,b.json [--out=<dir>] [--per=40]
//       강의당 N개 층화 표본 라벨링 시트(<강의id>.labels.csv)와 운영자용 키(<강의id>.key.json)를 쓴다.
//   node tools/eval-notes.mjs eval --runs=a.json,b.json --labels=<labels.csv|json> [--tuning=t.json,...] [--out=<dir>]
//       평가 지표 리포트(eval-report-*.json/.md). --tuning 실행 기록과 강의 id 가 겹치면 오류로 멈춘다.
//
// 실행 기록 형식(lib/admin-view.js buildEvalExport):
//   { tool:"summrizei-eval-run", version:1, lectureId, path:"current_delete"|"shadow"|"preserve",
//     run:{jobId?,costUsd?,ms?}, claims:[{claimId,blockId,sectionId,pointer,type,basis,text,evidenceIds,score,status,required}],
//     evidence:[{id,kind,unitId,text}], coverage? }
// 라벨 형식(docs/eval-protocol.md): CSV 헤더 lectureId,claimId,label_a,label_b,adjudicated[,required]
//   또는 JSON 배열 {claimId, lectureId?, label_a|a, label_b|b, adjudicated|final, required}. 라벨 값:
//   supported | contradicted | insufficient | ambiguous.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { percentile } from "./bench-metrics.mjs";

export const LABELS = new Set(["supported", "contradicted", "insufficient", "ambiguous"]);
export const EVAL_PATHS = new Set(["current_delete", "shadow", "preserve"]);
// 최종 결정 분류: 확정 본문에서 빠진 상태(보류)와 본문에 남은 상태(수용).
// unjudged 는 판정이 없었을 뿐 본문에는 남아 있다 — 학생에게 그대로 보이므로 수용으로 센다.
export const WITHHELD = new Set(["direct", "pending", "collateral", "cascade"]);
export const ACCEPTED = new Set(["kept", "fixed", "relinked", "unjudged"]);
// 층화 점수 구간: 낮음(<0.5=삭제 문턱) / 경계(0.5–0.7) / 높음(≥0.7) / 미판정(점수 없음). stages.js bins 과 맞춘다.
const LOW = 0.5, BORDER = 0.7;
const BANDS = ["low", "border", "high", "unjudged"];
const ROLES = ["definition", "condition", "exception", "example", "other"];

const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = v => (typeof v === "string" && v ? v : null);
const fail = m => { throw new Error(m); };

// ── 실행 기록 파싱 ────────────────────────────────────────────────────────────

export function parseRun(raw, file = "") {
  const at = file ? `${file}: ` : "";
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`${at}실행 기록이 JSON 객체가 아닙니다`);
  if (!EVAL_PATHS.has(raw.path)) fail(`${at}path 는 ${[...EVAL_PATHS].join("|")} 중 하나여야 합니다(받은 값: ${raw.path})`);
  if (!Array.isArray(raw.claims)) fail(`${at}claims 배열이 없습니다`);
  const evidence = new Map();
  for (const e of Array.isArray(raw.evidence) ? raw.evidence : []) {
    if (e && typeof e.id === "string") evidence.set(e.id, { id: e.id, kind: str(e.kind), unitId: str(e.unitId), text: String(e.text ?? "") });
  }
  const claims = [], seen = new Set();
  let dupes = 0, invalid = 0;
  for (const c of raw.claims) {
    if (!c || typeof c.claimId !== "string" || !c.claimId) { invalid++; continue; }
    if (seen.has(c.claimId)) { dupes++; continue; } // 같은 claimId 는 한 번만 센다(지표 규칙)
    seen.add(c.claimId);
    claims.push({
      claimId: c.claimId,
      blockId: str(c.blockId), sectionId: str(c.sectionId), pointer: str(c.pointer),
      type: str(c.type), basis: str(c.basis),
      text: String(c.text ?? ""),
      evidenceIds: (Array.isArray(c.evidenceIds) ? c.evidenceIds : []).filter(x => typeof x === "string"),
      score: num(c.score) != null && c.score >= 0 && c.score <= 1 ? c.score : null,
      status: typeof c.status === "string" ? c.status : "unjudged",
      required: c.required === true,
    });
  }
  const run = raw.run && typeof raw.run === "object" ? raw.run : {};
  return {
    lectureId: String(raw.lectureId ?? raw.packageId ?? (file ? path.basename(file, ".json") : "unknown")),
    path: raw.path,
    claims, evidence,
    run: {
      jobId: str(run.jobId), costUsd: num(run.costUsd), ms: num(run.ms),
      latencies: (Array.isArray(run.latencies) ? run.latencies : []).map(num).filter(x => x != null),
    },
    coverage: raw.coverage && typeof raw.coverage === "object" ? raw.coverage : null,
    invalidClaims: invalid, duplicateClaims: dupes,
  };
}

// 필수 학습 항목 표시 수집 — claim.required 플래그 + coverage(W2-B) 의 알려진 모양들을 모두 받는다.
// 어느 쪽도 없으면 빈 집합 → 보존율은 "측정 안 됨"으로 보고한다.
export function requiredIdsOf(run) {
  const out = new Set(run.claims.filter(c => c.required).map(c => c.claimId));
  const cov = run.coverage;
  if (cov && typeof cov === "object") {
    for (const v of [].concat(cov.requiredClaims ?? [], cov.required ?? [])) if (typeof v === "string") out.add(v);
    for (const it of [].concat(cov.items ?? [], cov.learningItems ?? [])) {
      if (!it || typeof it !== "object") continue;
      if (it.required === true || it.importance === "core")
        for (const id of [].concat(it.claimIds ?? it.claims ?? [])) if (typeof id === "string") out.add(id);
    }
  }
  return out;
}

// ── 라벨 파싱 (CSV 또는 JSON) ────────────────────────────────────────────────

// 최소 CSV: 따옴표 필드·필드 안 줄바꿈·"" 이스케이프를 지원한다.
export function parseCsv(text) {
  const rows = [[]];
  let field = "", quoted = false, i = 0;
  const push = () => { rows.at(-1).push(field); field = ""; };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") push();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      push(); rows.push([]);
    } else field += ch;
    i++;
  }
  push();
  return rows.filter(r => r.length > 1 || r[0] !== "");
}

const normLabel = v => {
  const s = String(v ?? "").trim().toLowerCase().replace(/[-_ ]/g, "");
  if (!s) return null;
  const aliased = s === "insufficientevidence" ? "insufficient" : s;
  return LABELS.has(aliased) ? aliased : `invalid:${s.slice(0, 20)}`;
};

// 라벨 행 → {key, a, b, final, required, rawLabel?}. final 은 조정값 우선, 없으면 두 라벨러가 일치할 때만.
export function parseLabels(text, file = "") {
  const at = file ? `${file}: ` : "";
  const rows = [];
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return rows;
  const pushRow = r => {
    if (!r || typeof r !== "object") return;
    const claimId = str(r.claimId ?? r.claim ?? r.id);
    if (!claimId) return;
    const a = normLabel(r.label_a ?? r.a ?? r.labelA);
    const b = normLabel(r.label_b ?? r.b ?? r.labelB);
    const adj = normLabel(r.adjudicated ?? r.final ?? r.label);
    const bad = [a, b, adj].find(v => v && v.startsWith("invalid:"));
    const final = adj ?? (a && a === b ? a : null);
    rows.push({ lectureId: str(r.lectureId ?? r.lecture), claimId, a, b, final, required: r.required === true || r.required === "true", invalid: bad ?? null });
    return rows.at(-1);
  };
  if (trimmed[0] === "[" || trimmed[0] === "{") {
    const data = JSON.parse(trimmed);
    if (Array.isArray(data)) for (const r of data) pushRow(r);
    else if (Array.isArray(data?.rows)) for (const r of data.rows) pushRow(r);
    else for (const [claimId, v] of Object.entries(data || {})) {
      if (v && typeof v === "object") pushRow({ claimId, ...v });
      else pushRow({ claimId, label: v });
    }
    return rows;
  }
  const grid = parseCsv(trimmed);
  if (grid.length < 2) return rows;
  const head = grid[0].map(h => String(h).trim().toLowerCase());
  const col = (...names) => head.findIndex(h => names.includes(h));
  const ci = {
    lecture: col("lectureid", "lecture", "강의"), claim: col("claimid", "claim", "주장"),
    a: col("label_a", "labela", "a", "라벨a"), b: col("label_b", "labelb", "b", "라벨b"),
    adj: col("adjudicated", "final", "label", "조정"), required: col("required", "필수"),
  };
  if (ci.claim < 0) fail(`${at}라벨 파일에 claimId 열이 없습니다`);
  for (const r of grid.slice(1)) {
    pushRow({
      lectureId: ci.lecture >= 0 ? r[ci.lecture] : null, claimId: r[ci.claim],
      label_a: ci.a >= 0 ? r[ci.a] : null, label_b: ci.b >= 0 ? r[ci.b] : null,
      adjudicated: ci.adj >= 0 ? r[ci.adj] : null, required: ci.required >= 0 ? r[ci.required] : null,
    });
  }
  return rows;
}

// 라벨러 두 명이 모두 라벨한 행만으로 Cohen κ — 4범주 nominal.
export function cohenKappa(rows) {
  const pairs = rows.filter(r => r.a && r.b && !String(r.a).startsWith("invalid:") && !String(r.b).startsWith("invalid:"));
  const n = pairs.length;
  if (!n) return { kappa: null, pairs: 0, agreement: null };
  const cats = new Map(), agree = pairs.filter(r => r.a === r.b).length;
  for (const r of pairs) {
    for (const [k, v] of [[r.a, "a"], [r.b, "b"]]) {
      const c = cats.get(k) ?? { a: 0, b: 0 };
      c[v]++; cats.set(k, c);
    }
  }
  let pe = 0;
  for (const c of cats.values()) pe += (c.a / n) * (c.b / n);
  const po = agree / n;
  return { kappa: pe === 1 ? (po === 1 ? 1 : null) : (po - pe) / (1 - pe), pairs: n, agreement: po };
}

// ── 층화 표본 추출 ───────────────────────────────────────────────────────────

export const bandOf = score => score == null ? "unjudged" : score < LOW ? "low" : score < BORDER ? "border" : "high";

// 주장의 지면 역할 층 — 봉투 안 경로(pointer)의 슬롯 이름으로 추정한다. 없으면 other.
const ROLE_RE = [
  ["definition", /definition|^term$|explanation|mechanism|^original$|concept/i],
  ["condition", /condition|scope|assumption|premise|requirement|missinglink|missingdata/i],
  ["exception", /exception|counter|^limits?$|caution|misconception|correction|warning|tradeoff/i],
  ["example", /example|instance|illustration|casetitle|situation|^case/i],
];
export function roleOf(claim) {
  const segs = String(claim.pointer ?? "").split("/").filter(Boolean);
  for (const [role, re] of ROLE_RE) if (segs.some(s => re.test(s))) return role;
  return "other";
}

// 결정적 의사 난수 순서 — claimId 해시(FNV-1a)로 정렬하므로 같은 입력은 항상 같은 표본을 낸다.
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// 강의 하나의 주장 목록에서 층화 표본을 고른다: (점수 구간 × 역할) 칸을 순회하며 한 칸씩 돌아가며 뽑는다.
// 반환: { sheet: [{lectureId, claimId, claim, evidence}], key: [{claimId, band, role, score, status}] }.
export function stratifiedSheet(run, per = 40) {
  const cells = new Map();
  for (const c of run.claims) {
    const band = bandOf(c.score), role = roleOf(c), key = `${band}|${role}`;
    const cell = cells.get(key) ?? cells.set(key, []).get(key);
    cell.push(c);
  }
  for (const list of cells.values()) list.sort((x, y) => fnv(`${run.lectureId}::${x.claimId}`) - fnv(`${run.lectureId}::${y.claimId}`));
  // 칸 순서 고정: 점수 구간 바깥 × 역할 안쪽.
  const order = [];
  for (const b of BANDS) for (const r of ROLES) if (cells.has(`${b}|${r}`)) order.push(`${b}|${r}`);
  const picked = [];
  while (picked.length < per) {
    let took = false;
    for (const k of order) {
      if (picked.length >= per) break;
      const c = cells.get(k).shift();
      if (c) { picked.push({ c, k }); took = true; }
    }
    if (!took) break;
  }
  // 시트 행도 해시 순 — 라벨러가 초안 순서·층을 추측하지 못하게 한다.
  picked.sort((x, y) => fnv(`${run.lectureId}#${x.c.claimId}`) - fnv(`${run.lectureId}#${y.c.claimId}`));
  return {
    sheet: picked.map(({ c }) => ({
      lectureId: run.lectureId, claimId: c.claimId, claim: c.text,
      evidence: c.evidenceIds.map(id => run.evidence.get(id)?.text ?? "").filter(Boolean).join("\n---\n"),
    })),
    key: picked.map(({ c, k }) => ({ claimId: c.claimId, band: k.split("|")[0], role: k.split("|")[1], score: c.score, status: c.status })),
  };
}

const csvCell = v => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function sheetCsv(sheet) {
  const rows = [["lectureId", "claimId", "claim", "evidence", "label_a", "label_b", "adjudicated"].join(",")];
  for (const r of sheet) rows.push([r.lectureId, r.claimId, r.claim, r.evidence, "", "", ""].map(csvCell).join(","));
  return rows.join("\n") + "\n";
}

// ── 지표 ─────────────────────────────────────────────────────────────────────

// 점수 구간 10칸 ECE: score = p(supported). acc = 그 칸에서 사람이 supported 라 한 비율.
export function scoreBins(rows) {
  const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, score: 0, supported: 0 }));
  for (const r of rows) {
    const b = bins[Math.min(9, Math.max(0, Math.floor(r.claim.score * 10)))];
    b.n++; b.score += r.claim.score;
    if (r.label === "supported") b.supported++;
  }
  return bins.map(b => ({ ...b, confidence: b.n ? b.score / b.n : null, accuracy: b.n ? b.supported / b.n : null }));
}
export const eceOf = bins => {
  const n = bins.reduce((s, b) => s + b.n, 0);
  return n ? bins.reduce((s, b) => s + (b.n / n) * (b.n ? Math.abs(b.accuracy - b.confidence) : 0), 0) : null;
};

// 한 경로(arm)의 지표. rows = {claim, label} — label 은 조정 완료 최종 라벨(null = 라벨 없음·불일치 미조정).
export function pathMetrics(runs, labelFor) {
  const rows = [];
  const statusCounts = {};
  let judgeTarget = 0, judgeAnswered = 0;
  const costs = [], latencies = [];
  let requiredTotal = 0, requiredPreserved = 0, requiredVerified = 0;
  for (const run of runs) {
    const reqIds = requiredIdsOf(run);
    for (const c of run.claims) {
      const label = labelFor(run.lectureId, c.claimId);
      const required = reqIds.has(c.claimId) || label?.required === true;
      rows.push({ claim: c, label: label?.final ?? null, required });
      statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1;
      // 판정 대상은 lecture 근거 주장뿐이다(stages.js T5). basis 없으면 대상으로 친다.
      if (c.basis == null || c.basis === "lecture") {
        judgeTarget++;
        if (c.score != null) judgeAnswered++;
      }
      if (required) {
        requiredTotal++;
        if (ACCEPTED.has(c.status)) {
          requiredPreserved++;
          if (label?.final === "supported") requiredVerified++;
        }
      }
    }
    if (run.run.costUsd != null) costs.push(run.run.costUsd);
    if (run.run.ms != null) latencies.push(run.run.ms);
    latencies.push(...run.run.latencies);
  }
  const supported = rows.filter(r => r.label === "supported");
  const unsupported = rows.filter(r => r.label === "contradicted" || r.label === "insufficient");
  const ambiguous = rows.filter(r => r.label === "ambiguous").length;
  const unlabeled = rows.filter(r => r.label == null).length;
  const falseWithhold = supported.filter(r => WITHHELD.has(r.claim.status)).length;
  const falseAccept = unsupported.filter(r => ACCEPTED.has(r.claim.status)).length;
  // API 미응답(score 없음)·ambiguous·미라벨 제외 정확도: score>=0.5 를 지지로 예측.
  const answered = rows.filter(r => r.claim.score != null && (r.label === "supported" || r.label === "contradicted" || r.label === "insufficient"));
  const correct = answered.filter(r => (r.claim.score >= LOW) === (r.label === "supported")).length;
  const bins = scoreBins(answered);
  return {
    runs: runs.length,
    claims: rows.length, labeled: rows.length - unlabeled, unlabeled,
    supported: supported.length, unsupported: unsupported.length, ambiguous,
    false_withhold: { rate: supported.length ? falseWithhold / supported.length : null, withheld: falseWithhold, of: supported.length },
    false_accept: { rate: unsupported.length ? falseAccept / unsupported.length : null, accepted: falseAccept, of: unsupported.length },
    accuracy_responded: { rate: answered.length ? correct / answered.length : null, correct, of: answered.length },
    judge_success: { rate: judgeTarget ? judgeAnswered / judgeTarget : null, answered: judgeAnswered, of: judgeTarget },
    ece: { value: eceOf(bins), bins, scored: answered.length },
    required_coverage: requiredTotal
      ? { rate: requiredPreserved / requiredTotal, preserved: requiredPreserved, verified: requiredVerified, of: requiredTotal }
      : null,
    cost: { totalUsd: costs.length ? costs.reduce((s, v) => s + v, 0) : null, runsReported: costs.length },
    latency: { p50ms: percentile(latencies, 50), p95ms: percentile(latencies, 95), samples: latencies.length },
    status_counts: statusCounts,
  };
}

// 같은 강의 id 가 튜닝·평가 양쪽에 있으면 누수다 — 섞이면 오류 목록을 돌려준다(빈 배열 = 정상).
export function checkLeakage(evalRuns, tuningRuns) {
  const tune = new Set((tuningRuns || []).map(r => r.lectureId));
  return [...new Set((evalRuns || []).map(r => r.lectureId).filter(id => tune.has(id)))];
}

// 라벨 조회: lectureId 있는 행은 강의+claimId 로, 없는 행은 claimId 가 전체 실행 기록에서 유일할 때만 단다.
export function buildLabelIndex(rows, runs) {
  const byPair = new Map(), byClaim = new Map();
  for (const r of rows) {
    if (r.lectureId) byPair.set(`${r.lectureId}::${r.claimId}`, r);
    else byClaim.set(r.claimId, r);
  }
  const pairs = new Set(), claimRuns = new Map();
  for (const run of runs) for (const c of run.claims) {
    pairs.add(`${run.lectureId}::${c.claimId}`);
    claimRuns.set(c.claimId, (claimRuns.get(c.claimId) ?? 0) + 1);
  }
  const misses = [];
  const labelFor = (lectureId, claimId) => {
    if (!pairs.has(`${lectureId}::${claimId}`)) return null; // 그 실행에 없는 주장에는 라벨을 붙이지 않는다
    const hit = byPair.get(`${lectureId}::${claimId}`) ?? (claimRuns.get(claimId) === 1 ? byClaim.get(claimId) : null);
    if (!hit) return null;
    if (hit.invalid) { misses.push(`${lectureId}::${claimId}`); return null; }
    return hit;
  };
  return { labelFor, misses };
}

export function evaluate({ evalRuns, tuningRuns = [], labelRows = [] } = {}) {
  const leakage = checkLeakage(evalRuns, tuningRuns);
  if (leakage.length) fail(`튜닝·평가 강의 누수: ${leakage.join(", ")} — 같은 강의가 양쪽에 있습니다`);
  const { labelFor, misses } = buildLabelIndex(labelRows, evalRuns);
  const byPath = new Map();
  for (const r of evalRuns) {
    const g = byPath.get(r.path) ?? byPath.set(r.path, []).get(r.path);
    g.push(r);
  }
  const paths = {};
  for (const [p, rs] of byPath) paths[p] = pathMetrics(rs, labelFor);
  // κ 는 평가 실행 기록에 실제로 있는 주장의 라벨 쌍만으로 계산한다.
  const inEval = new Set(), bare = new Set();
  for (const r of evalRuns) for (const c of r.claims) { inEval.add(`${r.lectureId}::${c.claimId}`); bare.add(c.claimId); }
  const kappa = cohenKappa(labelRows.filter(r => (r.lectureId && inEval.has(`${r.lectureId}::${r.claimId}`)) || (!r.lectureId && bare.has(r.claimId))));
  return {
    tool: "summrizei-eval-report", version: 1, generatedAt: new Date().toISOString(),
    lectures: [...new Set(evalRuns.map(r => r.lectureId))],
    tuningLectures: [...new Set(tuningRuns.map(r => r.lectureId))],
    leakage: { ok: true, shared: [] },
    labelRows: labelRows.length, invalidLabels: misses,
    interRater: kappa,
    paths,
    caveat: "표본 크기(강의당 40)는 탐색용이다 — 정확도 보증이 아니다(제안서 §4·docs/eval-protocol.md).",
  };
}

// ── 보고서 ───────────────────────────────────────────────────────────────────

const pct = v => (v == null ? "-" : (v * 100).toFixed(1) + "%");
const ms = v => (v == null ? "-" : Math.round(v) + "ms");
export function reportMd(report) {
  const md = ["# 노트 품질 평가", "", `- 생성: ${report.generatedAt}`, `- 평가 강의: ${report.lectures.join(", ") || "-"} · 튜닝 강의: ${report.tuningLectures.join(", ") || "-"}`,
    `- 라벨 행 ${report.labelRows}개 · 무효 라벨 ${report.invalidLabels.length}개 · 라벨러 일치도 κ=${report.interRater.kappa == null ? "-" : report.interRater.kappa.toFixed(3)}(쌍 ${report.interRater.pairs}, 일치율 ${pct(report.interRater.agreement)})`, ""];
  for (const [p, m] of Object.entries(report.paths)) {
    md.push(`## ${p}`, "", `| 지표 | 값 |`, `|---|---|`,
      `| 주장 / 라벨됨 | ${m.claims} / ${m.labeled} (미라벨 ${m.unlabeled}, ambiguous ${m.ambiguous}) |`,
      `| false withhold | ${pct(m.false_withhold.rate)} (${m.false_withhold.withheld}/${m.false_withhold.of} supported) |`,
      `| false accept | ${pct(m.false_accept.rate)} (${m.false_accept.accepted}/${m.false_accept.of} unsupported) |`,
      `| 응답 정확도 | ${pct(m.accuracy_responded.rate)} (${m.accuracy_responded.correct}/${m.accuracy_responded.of}, 미응답·ambiguous 제외) |`,
      `| 판정 성공률 | ${pct(m.judge_success.rate)} (${m.judge_success.answered}/${m.judge_success.of}) |`,
      `| ECE | ${m.ece.value == null ? "-" : m.ece.value.toFixed(4)} (점수 있는 라벨 ${m.ece.scored}개) |`,
      `| 필수 항목 보존 | ${m.required_coverage ? `${pct(m.required_coverage.rate)} (${m.required_coverage.preserved}/${m.required_coverage.of}, 사람 확인 지지 ${m.required_coverage.verified})` : "측정 안 됨"} |`,
      `| 비용 | ${m.cost.totalUsd == null ? "-" : "$" + m.cost.totalUsd.toFixed(4)} (보고된 실행 ${m.cost.runsReported}개) |`,
      `| 지연 p50 / p95 | ${ms(m.latency.p50ms)} / ${ms(m.latency.p95ms)} (표본 ${m.latency.samples}) |`,
      `| 상태 분포 | ${Object.entries(m.status_counts).map(([k, n]) => `${k}=${n}`).join(" ") || "-"} |`, "");
  }
  md.push(`> ${report.caveat}`, "");
  return md.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = `사용:
  node tools/eval-notes.mjs sample --runs=a.json,b.json [--out=<dir>] [--per=40]
  node tools/eval-notes.mjs eval --runs=a.json,b.json --labels=<labels.csv|json> [--tuning=t.json,...] [--out=<dir>]
모든 입출력은 저장소 밖이어야 합니다.`;

export async function main(argv = process.argv.slice(2)) {
  const flags = Object.fromEntries(argv.filter(a => a.startsWith("--")).map(a => {
    const i = a.indexOf("=");
    return i < 0 ? [a.slice(2), ""] : [a.slice(2, i), a.slice(i + 1)];
  }));
  const [cmd] = argv.filter(a => !a.startsWith("--"));
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const inside = p => p === ROOT || p.startsWith(ROOT + path.sep);
  const readJson = f => {
    const p = path.resolve(f);
    if (inside(p)) fail(`거절: ${p} 는 저장소 안입니다. 평가 산출물은 저장소 밖에 두세요.`);
    if (!existsSync(p)) fail(`파일이 없습니다: ${p}`);
    return { path: p, data: JSON.parse(readFileSync(p, "utf8")) };
  };
  const loadRuns = list => (list ? list.split(",").filter(Boolean).map(f => parseRun(readJson(f).data, f)) : []);

  if (cmd === "sample") {
    const runs = loadRuns(flags.runs);
    if (!runs.length) fail(USAGE);
    const per = Math.max(1, Number(flags.per) || 40);
    const outDir = path.resolve(flags.out || ".");
    if (inside(outDir)) fail("거절: --out 디렉터리가 저장소 안입니다.");
    mkdirSync(outDir, { recursive: true });
    // 강의별 한 장의 시트 — 같은 강의의 실행이 여러 개면 점수가 가장 많은(preserve 우선) 기록으로 층화한다.
    const pathRank = { preserve: 0, current_delete: 1, shadow: 2 };
    const byLecture = new Map();
    for (const r of runs) {
      const prev = byLecture.get(r.lectureId);
      const score = rr => (pathRank[rr.path] ?? 9) * 1e6 - rr.claims.filter(c => c.score != null).length;
      if (!prev || score(r) < score(prev)) byLecture.set(r.lectureId, r);
    }
    for (const [lectureId, run] of byLecture) {
      const { sheet, key } = stratifiedSheet(run, per);
      const safe = lectureId.replace(/[^\w.-]+/g, "_").slice(0, 60) || "lecture";
      const csvPath = path.join(outDir, `${safe}.labels.csv`), keyPath = path.join(outDir, `${safe}.key.json`);
      writeFileSync(csvPath, sheetCsv(sheet));
      writeFileSync(keyPath, JSON.stringify({ lectureId, path: run.path, per, picked: key.length, key }, null, 2));
      console.log(`${lectureId}: ${sheet.length}개 → ${csvPath}`);
    }
    return;
  }

  if (cmd === "eval") {
    if (!flags.labels) fail(USAGE);
    const evalRuns = loadRuns(flags.runs), tuningRuns = loadRuns(flags.tuning);
    if (!evalRuns.length) fail(USAGE);
    const labelFile = path.resolve(flags.labels);
    if (inside(labelFile)) fail(`거절: ${labelFile} 는 저장소 안입니다.`);
    if (!existsSync(labelFile)) fail(`파일이 없습니다: ${labelFile}`);
    const labelRows = parseLabels(readFileSync(labelFile, "utf8"), flags.labels);
    const report = evaluate({ evalRuns, tuningRuns, labelRows });
    const outDir = path.resolve(flags.out || ".");
    if (inside(outDir)) fail("거절: --out 디렉터리가 저장소 안입니다.");
    mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const jsonPath = path.join(outDir, `eval-report-${stamp}.json`), mdPath = path.join(outDir, `eval-report-${stamp}.md`);
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    writeFileSync(mdPath, reportMd(report));
    console.log("리포트: " + mdPath);
    return;
  }
  fail(USAGE);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error("오류: " + (e?.message || e)); process.exit(1); });
}
