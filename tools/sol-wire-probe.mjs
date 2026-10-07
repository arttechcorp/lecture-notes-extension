#!/usr/bin/env node
// sol-wire-probe — server/note-session.js 의 solBody() 가 만드는 실제 plan 단계 본문을
// OpenRouter /api/v1/responses 에 보내고, 필드 하나씩만 바꾼 변형으로 400/404 거절 원인을 가른다.
//   사용: OPENROUTER_API_KEY=… node tools/sol-wire-probe.mjs [sol-session|sol-luna-tool|sol-fork|sol-luna-2|sol-fork-2]
// v2 모드의 기준 본문은 dev(고정 V2_DEV)+P(계획 작업·응답·고정 앵커)+일회성 작업(breakpoint 없음)의 작성 호출 모양이다.
// 키는 env 에서만 읽는다 — 출력·파일·로그·요청 본문에 절대 싣지 않고 파일은 읽지 않는다.
// 강의 내용이 아닌 합성 본문만 보낸다(작은 system + 작은 task). 각 변형의 출력은
// label·HTTP 상태·error.code/type/param·message 앞 160자·보고 비용뿐이다 — 요청 본문은 인쇄하지 않는다.
// 상한: 최대 24요청 · 요청당 20s · 누적 비용 $0.05 · 재시도 없음.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const NoteSession = require("../server/note-session.js");

const ENDPOINT = "https://openrouter.ai/api/v1/responses";
export const MAX_REQUESTS = 24, TIMEOUT_MS = 20000, COST_CAP_USD = 0.05;

// 실제 전선과 같은 모양의 합성 plan 본문 — 시스템·작업 내용은 작은 합성 문구다(비용 캡을 지키기 위해
// 운영 시스템 전문은 싣지 않는다 — 검증 대상은 전선 필드지 프롬프트 크기가 아니다).
// 탐색용 최소 출력: max_output_tokens 64, reasoning effort low.
export function baseBody(mode) {
  const v2 = NoteSession.V2.includes(mode);
  return NoteSession.solBody({
    stage: v2 ? "draft" : "plan",
    system: v2 ? NoteSession.V2_DEV : "You are a synthetic note-pipeline wire probe. Reply with a single JSON object.",
    // v2: 계획 작업+공급자 출력+고정 앵커=P, 그 뒤 breakpoint 없는 일회성 작업 — 실제 fork 작성 호출과 같은 꼴.
    items: v2
      ? [NoteSession.taskItem("plan", { demo: "wire-probe" }, undefined, { type: "object" }),
        { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "{}" }] },
        NoteSession.anchorItem(),
        NoteSession.taskItem("draft", { demo: "wire-probe" }, undefined, { type: "object" }, "synthetic write instructions", false)]
      : [NoteSession.taskItem("plan", { demo: "wire-probe" }, undefined, { type: "object" })],
    params: { max_tokens: 64, reasoning: { effort: "low" } },
    providers: ["azure", "azure/us", "azure/eu"],
    session: { v: 1, id: "sol-wire-probe", mode },
    mode,
    choice: "none",
  });
}

// 변형 행렬 — 각 항목은 기준 본문의 필드 하나만 바꾼다. 이미 제거한 원인 후보(seed, parallel_tool_calls)는
// 다시 싣는 방향으로 검증한다: 기준이 통과하고 추가 변형이 같은 오류를 재현하면 원인 확정이다.
const GENERIC = [
  ["no_text_format", b => { delete b.text; }],
  ["with_seed", b => { b.seed = 7; }],
  ["no_session_id", b => { delete b.session_id; }],
  ["no_prompt_cache_options", b => { delete b.prompt_cache_options; }],
  ["no_include", b => { delete b.include; }],
  ["no_reasoning_context", b => { delete b.reasoning.context; }],
  ["no_require_parameters", b => { b.provider = { ...b.provider, require_parameters: false }; }],
];
const SOLO_ONLY = [ // 입력 모양·크기 후보 — 도구 없는 모드(sol-session·sol-fork)에서 본다(도구 모드는 요청 상한에 자리가 없다)
  ["no_dev_breakpoint", b => { delete b.input[0].content[0].prompt_cache_breakpoint; }],
  ["no_task_breakpoint", b => { for (const p of b.input[1].content || []) delete p.prompt_cache_breakpoint; }],
  ["task_string_content", b => { b.input[1] = { role: "user", content: b.input[1].content[0].text }; }],
  ["big_max_output_tokens", b => { b.max_output_tokens = 24000; }],
];
const TOOL_ONLY = [
  ["with_parallel_tool_calls", b => { b.parallel_tool_calls = false; }],
  ["no_tool_choice", b => { delete b.tool_choice; }],
  ["tool_choice_function", b => { b.tool_choice = { type: "function", name: NoteSession.TOOL }; }],
  ["no_tools", b => { delete b.tools; delete b.tool_choice; }],
];
const V2_ONLY = [ // v2 접두 계약 후보 — 고정 앵커와 일회성 suffix 의 breakpoint 유무가 전선에서 받아들여지는지 본다
  ["no_anchor", b => { b.input.splice(b.input.length - 2, 1); }],
  ["task_breakpoint", b => { b.input.at(-1).content[0].prompt_cache_breakpoint = { mode: "explicit" }; }],
];
export const matrix = mode =>
  [["baseline", () => {}], ...GENERIC,
    ...(mode === "sol-luna-tool" ? TOOL_ONLY : NoteSession.V2.includes(mode) ? [...SOLO_ONLY, ...V2_ONLY] : SOLO_ONLY)]
    .map(([label, mutate]) => ({ mode, label, mutate }));

// 변형을 순서대로 보낸다. 재시도 없이 한 번씩 — 요청 수·비용 상한을 넘기 전에 멈춘다.
export async function run({ fetcher = fetch, key = process.env.OPENROUTER_API_KEY, log = console.log, modes = NoteSession.MODES } = {}) {
  if (typeof key !== "string" || !key) throw new Error("OPENROUTER_API_KEY required");
  let sent = 0, spent = 0; const rows = [];
  const stop = () => sent >= MAX_REQUESTS || spent >= COST_CAP_USD;
  for (const mode of modes) {
    for (const { label, mutate } of matrix(mode)) {
      if (stop()) { log(JSON.stringify({ stopped: true, sent, spentUsd: spent })); return rows; }
      const body = baseBody(mode); mutate(body);
      sent++;
      const rec = { mode, label };
      try {
        const r = await fetcher(ENDPOINT, {
          method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { authorization: "Bearer " + key, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        rec.status = r.status;
        const j = await r.json().catch(() => null);
        const e = j && typeof j === "object" && j.error && typeof j.error === "object" ? j.error : {};
        rec.code = e.code ?? null; rec.type = e.type ?? null; rec.param = e.param ?? null;
        rec.errorType = typeof e.metadata?.error_type === "string" ? e.metadata.error_type : null;
        rec.message = typeof e.message === "string" ? e.message.slice(0, 160) : null;
        rec.cost = typeof j?.usage?.cost === "number" ? j.usage.cost : null;
        if (r.ok) rec.outs = Array.isArray(j?.output) ? j.output.map(o => o && o.type).join("+") : null;
        if (rec.cost !== null) spent += rec.cost;
      } catch (x) {
        rec.status = null; rec.code = "fetch_" + String(x?.name || "error").toLowerCase();
      }
      rows.push(rec); log(JSON.stringify(rec));
    }
  }
  log(JSON.stringify({ done: true, sent, spentUsd: spent }));
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only = process.argv[2];
  await run({ modes: only && NoteSession.MODES.includes(only) ? [only] : undefined });
}
