// 자동 디버깅 루프의 판정기: 오프라인 게이트 결과 + e2e report.json(+console.ndjson)을 읽어 pass/fail을 코드로 낸다.
// LLM이 판정하지 않는다. 평가 기준이므로 루프의 에이전트는 이 파일을 고치지 못한다(docs/superpowers/specs/2026-10-11-debug-loop-design.md §3, §4-B).
//
//   node tools/debug-loop-verdict.mjs --run <runDir> --offline <offline.json> [--baseline <baseline.json>] [--negative-yt]
//
// offline.json  = { testFailed: [이름...], packageOk: bool, eval: { falseApprove, falseHold } }
// baseline.json = offline.json 모양 + metrics(아래 metricsOf 결과). 없으면 래칫은 건너뛴다.
// 출력(JSON): { pass, invalid, failures: [{ signature, class, evidence }], metrics }
// class: CODE(고칠 수 있음) | ENV(복구·재시도) | SERVER(배포 필요) | HUMAN(멈추고 알림) | POLICY
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BAD_WARN = /^RENDER_(FORMULA_FAILED|CHART_INVALID|TEMPLATE_FAILED|REF_UNKNOWN|SPEC_MISMATCH)$/;
const YT_MSG = "실시간 캡처만 지원";

// 오류 문구 → 분류. 첫 일치가 이긴다. 순서가 곧 우선순위다.
const CLASS_RULES = [
  ["HUMAN", /401|로그인|동의|한도|quota|onboarding|needs a human|권한을 허용|re-?grant/i],
  ["SERVER", /\b409\b|\b426\b|note_spec_mismatch|origin_not_allowed|배포/i],
  ["ENV", /ECONNREFUSED|warm browser|:9333|not running|version mismatch|queue_busy|Timeout \d+ms|browser has been closed|Target page/i],
];
export const classify = text => (CLASS_RULES.find(([, re]) => re.test(text || "")) || ["CODE"])[0];

const stepName = n => String(n).replace(/#\d+$/, "");

// 래칫 지표: 기준선보다 나빠지면 실패. 비율은 선택된 그림이 있을 때만 의미가 있다.
export function metricsOf(report) {
  const f = report.funnel || {}, k = report.inspect?.kinds || {}, c = report.formulaChecks || {};
  return {
    selected: f.selected ?? null,
    renderOkRatio: f.selected > 0 ? (f.renderOk ?? 0) / f.selected : null,
    missing: k.missing ?? null,
    parseFail: c.parseFail ?? null,
    symMismatch: c.symMismatch ?? null,
  };
}

export function verdict({ report, offline = {}, baseline = null, pageErrors = 0, negativeYt = false }) {
  const failures = [], add = (signature, cls, evidence) => failures.push({ signature, class: cls, evidence: String(evidence ?? "").slice(0, 300) });
  let invalid = false;

  // ---- 오프라인 게이트 ----
  const known = new Set(baseline?.testFailed || []);
  for (const name of offline.testFailed || []) if (!known.has(name)) add(`TEST:${name}`, "CODE", "기준선에 없던 새 테스트 실패");
  if (offline.packageOk === false) add("PACKAGE_DRY_RUN", "CODE", "package-cws --dry-run 실패");
  if (offline.eval?.falseApprove > 0) add("EVAL_FALSE_APPROVE", "CODE", `falseApprove=${offline.eval.falseApprove} (틀린 그림 승인 — 절대 0)`);
  if (offline.eval?.falseHold > 0) add("EVAL_FALSE_HOLD", "CODE", `falseHold=${offline.eval.falseHold}`);

  // ---- 음성 시나리오: YouTube 백그라운드는 안내와 함께 막혀야 한다 ----
  if (negativeYt) {
    const steps = report.steps || [];
    const text = steps.map(s => `${s.detail || ""} ${s.error || ""}`).join(" ");
    if (steps.some(s => stepName(s.name) === "bg_progress" && s.status === "ok")) add("YT_BG_STARTED", "POLICY", "YouTube 백그라운드가 시작됐다");
    if (!text.includes(YT_MSG)) add("YT_BG_NO_NOTICE", "CODE", `안내 문구("${YT_MSG}")가 화면에 없다`);
    return { pass: failures.length === 0, invalid: false, failures, metrics: {} };
  }

  // ---- e2e ----
  if (report.result === "aborted") add("E2E_ABORTED", "ENV", "실행이 끝까지 가지 못했다");
  for (const s of report.steps || []) {
    if (s.status === "blocked") add(`E2E_BLOCKED:${stepName(s.name)}`, "HUMAN", s.detail);
    else if (s.status === "fail") add(`E2E_FAIL:${stepName(s.name)}`, classify(s.error || s.detail), s.error || s.detail);
  }
  if (pageErrors > 0) add("PAGE_ERROR", "CODE", `확장 콘솔 pageerror ${pageErrors}건`);
  if (report.diagErrors > 0) add("DIAG_ERROR", "CODE", `진단 level=error ${report.diagErrors}건`);

  const ins = report.inspect;
  if (!ins) invalid = true; // 렌더 검사가 없었다 → 통과로 칠 수 없다
  else for (const w of ins.warnings || []) if (BAD_WARN.test(w.code)) add(`RENDER_WARN:${w.code}`, "CODE", `count=${w.count}`);
  if (!(report.funnel?.selected >= 1)) invalid = true; // 그림이 한 번도 다뤄지지 않은 실행은 무효

  // ---- 래칫 ----
  const metrics = metricsOf(report), base = baseline?.metrics;
  if (base && !invalid) {
    const worse = (m, lowerIsBetter) => metrics[m] != null && base[m] != null && (lowerIsBetter ? metrics[m] > base[m] : metrics[m] < base[m]);
    for (const [m, lower] of [["renderOkRatio", false], ["missing", true], ["parseFail", true], ["symMismatch", true]])
      if (worse(m, lower)) add(`RATCHET:${m}`, "CODE", `${base[m]} → ${metrics[m]}`);
  }

  return { pass: failures.length === 0 && !invalid, invalid, failures, metrics };
}

// 한 줄씩 JSON인 console.ndjson 에서 확장 pageerror 만 센다.
export function countPageErrors(file) {
  try { return fs.readFileSync(file, "utf8").split("\n").filter(l => l.includes('"type":"pageerror"')).length; } catch { return 0; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), opt = k => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  const run = opt("--run"), off = opt("--offline"), base = opt("--baseline");
  if (!run || !off) { console.error("Usage: node tools/debug-loop-verdict.mjs --run <runDir> --offline <offline.json> [--baseline <baseline.json>] [--negative-yt]"); process.exit(2); }
  const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
  const out = verdict({ report: read(path.join(run, "report.json")), offline: read(off), baseline: base ? read(base) : null, pageErrors: countPageErrors(path.join(run, "console.ndjson")), negativeYt: a.includes("--negative-yt") });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.pass ? 0 : 1);
}
