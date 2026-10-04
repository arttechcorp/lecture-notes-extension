// offscreen.js의 BG_MODELS(백그라운드 작업이 부르는 모델)가 서버가 실제로 받는 모델인지 /v1/me로 대조한다.
// 어긋나면 작업이 클라우드 인식 비용을 쓴 뒤 invalid_model로 멈추므로(예: STT를 Groq에서 MAI로 바꿀 때) 여기서 먼저 잡는다.
// env는 운영 배포와 같은 모양이다(server/README.md "Supabase Edge Function 배포"). 모델을 바꾸면 이 env와 README를 같이 고친다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createServer } = require("../server/index.js");
const src = fs.readFileSync(new URL("../offscreen.js", import.meta.url), "utf8");
const BG_MODELS = Function("return " + src.match(/const BG_MODELS=(\{[^}]*\})/)[1])();

const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop", token = "t".repeat(40), lite = "google/gemini-2.5-flash-lite", luna = "openai/gpt-6-luna";
const ENV = {
  APP_TOKENS_JSON: JSON.stringify({ dev: token }), EXTENSION_ORIGIN: origin, OPENROUTER_API_KEY: "k",
  ALLOWED_MODELS: JSON.stringify([lite]), ALLOWED_VISION_MODELS: JSON.stringify([lite, luna]),
  ALLOWED_STT_MODELS: JSON.stringify(["microsoft/mai-transcribe-2"]), ALLOWED_JUDGE_MODELS: JSON.stringify(["openai/gpt-4.1-nano"]),
  OPENROUTER_PROVIDERS_JSON: JSON.stringify({ [lite]: ["google-vertex"], "openai/gpt-4.1-nano": ["openai"], [luna]: ["azure"] }),
  ACCOUNT_LIMITS_JSON: JSON.stringify({ dev: { models: [lite], maxRequests: 100, maxCostCents: 100, features: ["background", "stt", "vision", "judge"] } }),
};

test("every model in offscreen.js BG_MODELS is one the server's /v1/me says it accepts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-bgmodels-"));
  const server = createServer({ ...ENV, VAULT_DIR: root });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/v1/me`, { headers: { authorization: "Bearer " + token, origin } });
    assert.equal(res.status, 200);
    const me = await res.json();
    assert.deepEqual(Object.keys(BG_MODELS).sort(), ["judge", "plan", "stt", "vision", "write"]);
    assert.ok(me.models.includes(BG_MODELS.plan), `plan ${BG_MODELS.plan} ∉ ${me.models}`);
    assert.ok(me.models.includes(BG_MODELS.write), `write ${BG_MODELS.write} ∉ ${me.models}`);
    for (const route of ["vision", "stt", "judge"]) assert.ok(me.routeModels[route].includes(BG_MODELS[route]), `${route} ${BG_MODELS[route]} ∉ ${me.routeModels[route]}`);
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
