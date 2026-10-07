// sol-wire-probe 단위 테스트 — mock fetch 로 행렬 크기·키 비노출·비용 상한·재시도 없음을 검증한다.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { baseBody, matrix, run, MAX_REQUESTS, COST_CAP_USD } from "./sol-wire-probe.mjs";

const require = createRequire(import.meta.url);
const NoteSession = require("../server/note-session.js");

const KEY = "sk-probe-test-secret-key";

test("baseBody: 실제 solBody 전선 — 탐색용 캡을 얹은 plan 본문", () => {
  const b = baseBody("sol-luna-tool");
  assert.equal(b.model, NoteSession.SOL);
  assert.equal(b.store, false);
  assert.equal(b.max_output_tokens, 64);
  assert.equal(b.reasoning.effort, "low");
  assert.equal(b.reasoning.context, "all_turns");
  assert.deepEqual(b.provider.only, ["azure", "azure/us", "azure/eu"]);
  assert.equal(b.provider.zdr, true);
  assert.equal(b.provider.data_collection, "deny");
  assert.equal(b.provider.require_parameters, true);
  assert.equal(b.provider.allow_fallbacks, false);
  assert.equal(b.tool_choice, "none");
  assert.equal(b.tools[0].name, "write_note");
  assert.ok(!("seed" in b) && !("parallel_tool_calls" in b));
});

test("matrix: 모드별 baseline + 필드 하나만 바꾼 변형, 전체 ≤ 24요청", () => {
  const solo = matrix("sol-session"), tool = matrix("sol-luna-tool");
  assert.equal(solo[0].label, "baseline");
  assert.equal(tool[0].label, "baseline");
  assert.ok(solo.length + tool.length <= MAX_REQUESTS, "행렬 전체가 요청 상한 안");
  // 도구 모드만 tools/tool_choice/parallel_tool_calls 변형을 갖는다.
  assert.ok(tool.some(v => v.label === "with_parallel_tool_calls"));
  assert.ok(tool.some(v => v.label === "tool_choice_function"));
  assert.ok(solo.some(v => v.label === "big_max_output_tokens"));
  assert.ok(solo.every(v => !["with_parallel_tool_calls", "no_tools"].includes(v.label)));
});

test("run: 응답 행만 인쇄하고 키는 어디에도 안 새고, 비용 상한에서 멈춘다", async () => {
  const lines = [], sent = [];
  const fetcher = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ status: "completed", output: [{ type: "message", content: [] }], usage: { cost: 0.03 } }) };
  };
  const rows = await run({ fetcher, key: KEY, log: l => lines.push(l), modes: ["sol-session"] });
  const out = lines.join("\n");
  assert.ok(!out.includes(KEY), "출력에 키가 없다");
  assert.ok(!out.includes("synthetic note-pipeline"), "요청 본문은 인쇄하지 않는다");
  // 요청당 $0.03 보고 → 2회째에 $0.06 으로 캡 도달, 3번째는 나가지 않는다.
  assert.equal(sent.length, 2);
  assert.equal(rows.length, 2);
  assert.ok(lines.at(-1).includes('"stopped":true'));
  // 모든 요청이 같은 헤더 상한(타임아웃 신호 존재)으로 나갔고 재시도가 없다 — fetcher 호출 수가 곧 전부다.
  const again = await run({ fetcher, key: KEY, log: () => {}, modes: ["sol-session"] });
  assert.equal(again.length, 2);
});

test("run: 4xx 봉투에서 code/type/param·message 160자까지만 인쇄한다", async () => {
  const lines = [];
  const long = "x".repeat(300);
  const fetcher = async () => ({ ok: false, status: 404, json: async () => ({ error: { code: "no_endpoints", type: "routing", param: "tools", message: long, metadata: { error_type: "no_endpoints" } } }) });
  const rows = await run({ fetcher, key: KEY, log: l => lines.push(l), modes: ["sol-session"] });
  assert.equal(rows.length, matrix("sol-session").length, "오류에도 행렬 끝까지 간다");
  assert.equal(rows[1].code, "no_endpoints");
  assert.equal(rows[1].param, "tools");
  assert.equal(rows[1].errorType, "no_endpoints");
  assert.equal(rows[1].message.length, 160);
});

test("run: 키가 없으면 아무것도 보내지 않고 실패한다", async () => {
  let called = false;
  await assert.rejects(run({ fetcher: async () => { called = true; }, key: "", log: () => {} }), /OPENROUTER_API_KEY/);
  assert.equal(called, false);
});
