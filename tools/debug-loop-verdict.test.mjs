import test from "node:test";
import assert from "node:assert/strict";
import { verdict, classify } from "./debug-loop-verdict.mjs";

const okReport = (over = {}) => ({
  result: "ok",
  steps: [{ name: "start#1", status: "ok" }],
  funnel: { selected: 2, renderOk: 2 },
  formulaChecks: { parseFail: 0, symMismatch: 0 },
  diagErrors: 0,
  inspect: { warnings: [], kinds: { table: 1, chart: 1 } },
  ...over,
});
const sigs = r => r.failures.map(f => f.signature);

test("모든 게이트를 통과하면 pass", () => {
  const r = verdict({ report: okReport(), offline: { testFailed: [], packageOk: true, eval: { falseApprove: 0, falseHold: 0 } } });
  assert.deepEqual([r.pass, r.invalid, r.failures], [true, false, []]);
});

test("그림이 한 번도 다뤄지지 않은 실행(selected 0)은 무효 — 통과로 치지 않는다", () => {
  const r = verdict({ report: okReport({ funnel: { selected: 0, renderOk: 0 } }) });
  assert.equal(r.invalid, true);
  assert.equal(r.pass, false);
});

test("렌더 검사(inspect)가 없으면 무효", () => {
  const r = verdict({ report: okReport({ inspect: undefined }) });
  assert.equal(r.invalid, true);
  assert.equal(r.pass, false);
});

test("기준선에 없는 새 테스트 실패만 CODE 실패로 센다", () => {
  const r = verdict({ report: okReport(), offline: { testFailed: ["old", "new"] }, baseline: { testFailed: ["old"] } });
  assert.deepEqual(sigs(r), ["TEST:new"]);
  assert.equal(r.failures[0].class, "CODE");
});

test("falseApprove는 실패, falseHold도 실패", () => {
  assert.deepEqual(sigs(verdict({ report: okReport(), offline: { eval: { falseApprove: 1, falseHold: 0 } } })), ["EVAL_FALSE_APPROVE"]);
  assert.deepEqual(sigs(verdict({ report: okReport(), offline: { eval: { falseApprove: 0, falseHold: 2 } } })), ["EVAL_FALSE_HOLD"]);
});

test("지정한 렌더 경고만 실패이고 다른 코드는 무시한다", () => {
  const r = verdict({ report: okReport({ inspect: { warnings: [{ code: "RENDER_FORMULA_FAILED", count: 2 }, { code: "RENDER_SOMETHING_ELSE", count: 1 }], kinds: {} } }) });
  assert.deepEqual(sigs(r), ["RENDER_WARN:RENDER_FORMULA_FAILED"]);
});

test("래칫: missing이 기준선보다 늘면 실패, 같으면 통과", () => {
  const baseline = { testFailed: [], metrics: { missing: 0, renderOkRatio: 1, parseFail: 0, symMismatch: 0 } };
  const worse = verdict({ report: okReport({ inspect: { warnings: [], kinds: { missing: 1 } } }), baseline });
  assert.deepEqual(sigs(worse), ["RATCHET:missing"]);
  assert.equal(verdict({ report: okReport({ inspect: { warnings: [], kinds: { missing: 0 } } }), baseline }).pass, true);
});

test("단계 실패는 문구로 분류한다: 타임아웃=ENV, blocked=HUMAN, 그 밖=CODE", () => {
  const steps = [
    { name: "start#1", status: "fail", error: "page.click: Timeout 30000ms exceeded." },
    { name: "preflight#1", status: "blocked", detail: "onboarding/consent screen is showing — needs a human" },
    { name: "stop#1", status: "fail", error: "슬라이드 인식 결과 형식이 올바르지 않습니다" },
  ];
  const r = verdict({ report: okReport({ result: "fail", steps }) });
  assert.deepEqual(r.failures.map(f => [f.signature, f.class]), [["E2E_FAIL:start", "ENV"], ["E2E_BLOCKED:preflight", "HUMAN"], ["E2E_FAIL:stop", "CODE"]]);
  assert.equal(classify("401 unauthorized"), "HUMAN");
  assert.equal(classify("409 note_spec_mismatch"), "SERVER");
});

test("YouTube 음성 시나리오: 안내 문구가 있고 백그라운드가 시작되지 않아야 통과", () => {
  const good = { steps: [{ name: "preflight#1", status: "ok", detail: '{"bgStatus":"이 사이트는 실시간 캡처만 지원합니다."}' }] };
  assert.equal(verdict({ report: good, negativeYt: true }).pass, true);
  assert.deepEqual(sigs(verdict({ report: { steps: [] }, negativeYt: true })), ["YT_BG_NO_NOTICE"]);
  const started = { steps: [...good.steps, { name: "bg_progress#1", status: "ok" }] };
  assert.deepEqual(sigs(verdict({ report: started, negativeYt: true })), ["YT_BG_STARTED"]);
});
