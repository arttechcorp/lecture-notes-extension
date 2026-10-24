import test from "node:test";
import assert from "node:assert/strict";
import { verdict, classify } from "./debug-loop-verdict.mjs";

test("1. 모든 게이트 통과: pass true, invalid false", () => {
  const report = {
    result: "ok",
    funnel: { selected: 2, renderOk: 2 },
    inspect: { warnings: [], kinds: {} },
    steps: [],
  };
  const offline = {
    testFailed: [],
    packageOk: true,
    eval: { falseApprove: 0, falseHold: 0 },
  };
  const res = verdict({ report, offline });
  assert.equal(res.pass, true);
  assert.equal(res.invalid, false);
  assert.deepEqual(res.failures, []);
});

test("2. funnel.selected 0: invalid true, pass false", () => {
  const report = {
    result: "ok",
    funnel: { selected: 0 },
    inspect: { warnings: [], kinds: {} },
    steps: [],
  };
  const offline = {
    testFailed: [],
    packageOk: true,
    eval: { falseApprove: 0, falseHold: 0 },
  };
  const res = verdict({ report, offline });
  assert.equal(res.invalid, true);
  assert.equal(res.pass, false);
});

test("3. inspect 없음: invalid true", () => {
  const report = {
    result: "ok",
    funnel: { selected: 2 },
    steps: [],
  };
  const offline = {
    testFailed: [],
    packageOk: true,
    eval: {},
  };
  const res = verdict({ report, offline });
  assert.equal(res.invalid, true);
  assert.equal(res.pass, false);
});

test("4. baseline에 없는 testFailed: TEST: 시그니처 CODE, baseline에 있는 건 무시", () => {
  const baseline = {
    testFailed: ["known-failure.test.js"],
  };
  const offline = {
    testFailed: ["known-failure.test.js", "new-failure.test.js"],
    packageOk: true,
    eval: {},
  };
  const report = {
    result: "ok",
    funnel: { selected: 2 },
    inspect: { warnings: [] },
  };
  const res = verdict({ report, offline, baseline });
  assert.equal(res.pass, false);
  assert.equal(res.failures.length, 1);
  assert.equal(res.failures[0].signature, "TEST:new-failure.test.js");
  assert.equal(res.failures[0].class, "CODE");
});

test("5. eval.falseApprove 1: EVAL_FALSE_APPROVE", () => {
  const offline = {
    testFailed: [],
    packageOk: true,
    eval: { falseApprove: 1, falseHold: 0 },
  };
  const report = {
    result: "ok",
    funnel: { selected: 2 },
    inspect: { warnings: [] },
  };
  const res = verdict({ report, offline });
  assert.equal(res.pass, false);
  const failure = res.failures.find(f => f.signature === "EVAL_FALSE_APPROVE");
  assert.ok(failure);
  assert.equal(failure.class, "CODE");
});

test("6. inspect.warnings에 RENDER_FORMULA_FAILED: RENDER_WARN 실패, 다른 코드는 무시", () => {
  const report = {
    result: "ok",
    funnel: { selected: 2 },
    inspect: {
      warnings: [
        { code: "RENDER_FORMULA_FAILED", count: 1 },
        { code: "OTHER_NON_BLOCKING_WARN", count: 2 },
      ],
    },
  };
  const offline = {
    testFailed: [],
    packageOk: true,
    eval: {},
  };
  const res = verdict({ report, offline });
  assert.equal(res.pass, false);
  assert.equal(res.failures.length, 1);
  assert.equal(res.failures[0].signature, "RENDER_WARN:RENDER_FORMULA_FAILED");
  assert.equal(res.failures[0].class, "CODE");
});

test("7. 래칫: baseline.metrics.missing 0 인데 현재 kinds.missing 1: RATCHET:missing", () => {
  const baseline = {
    metrics: { missing: 0 },
  };
  const report = {
    result: "ok",
    funnel: { selected: 2 },
    inspect: {
      warnings: [],
      kinds: { missing: 1 },
    },
  };
  const offline = {
    testFailed: [],
    packageOk: true,
    eval: {},
  };
  const res = verdict({ report, offline, baseline });
  assert.equal(res.pass, false);
  const failure = res.failures.find(f => f.signature === "RATCHET:missing");
  assert.ok(failure);
  assert.equal(failure.class, "CODE");
  assert.equal(failure.evidence, "0 → 1");
});

test("8. steps 상태 분류: timeout은 ENV, blocked는 HUMAN", () => {
  const report = {
    result: "ok",
    funnel: { selected: 2 },
    inspect: { warnings: [] },
    steps: [
      { name: "capture#1", status: "fail", error: "Timeout 30000ms exceeded" },
      { name: "login_gate#2", status: "blocked", detail: "사용자 로그인 필요" },
    ],
  };
  const offline = {
    testFailed: [],
    packageOk: true,
    eval: {},
  };
  const res = verdict({ report, offline });
  const failStep = res.failures.find(f => f.signature === "E2E_FAIL:capture");
  assert.ok(failStep);
  assert.equal(failStep.class, "ENV");

  const blockedStep = res.failures.find(f => f.signature === "E2E_BLOCKED:login_gate");
  assert.ok(blockedStep);
  assert.equal(blockedStep.class, "HUMAN");

  assert.equal(classify("Timeout 30000ms exceeded"), "ENV");
  assert.equal(classify("사용자 로그인 필요"), "HUMAN");
});
