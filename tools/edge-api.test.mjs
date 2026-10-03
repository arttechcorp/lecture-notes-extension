// supabase/functions/api: 커밋된 묶음이 소스와 같고, Deno 어댑터를 거친 요청이 Node 서버와 같은 처리기로 답하는지 본다.
// 실제 Deno·Supabase 없이 Node에서 같은 묶음(ESM)을 불러 확인한다. 배포 런타임 차이는 배포 뒤 스모크로 본다(server/README.md).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build, OUT } from "./build-edge.mjs";
import { adapt } from "../supabase/functions/api/adapter.js";
import Server from "../supabase/functions/api/server.bundle.js";

const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop", token = "a".repeat(40), model = "google/gemini-2.5-flash-lite";
const BASE = "https://proj.supabase.co/functions/v1/api";

test("the committed edge bundle matches the server sources (run node tools/build-edge.mjs)", () => {
  assert.equal(fs.readFileSync(OUT, "utf8"), build());
});

test("requests through the Deno adapter reach the same handler: auth, CORS, routing, bodies", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-edge-test-"));
  try {
    const server = Server.createServer({ APP_TOKENS_JSON: JSON.stringify({ A: token }), EXTENSION_ORIGIN: origin, OPENROUTER_API_KEY: "k", OPENROUTER_PROVIDERS_JSON: JSON.stringify({ [model]: ["p"] }), VAULT_DIR: root });
    const call = adapt(server.handle);
    const go = (route, init = {}) => call(new Request(BASE + route, { ...init, headers: { authorization: "Bearer " + token, origin, "content-type": "application/json", ...init.headers } }));
    const me = await go("/v1/me");
    assert.equal(me.status, 200);
    assert.equal((await me.json()).accountId, "A");
    assert.equal(me.headers.get("access-control-allow-origin"), origin);
    // 게이트웨이가 접두사를 떼어 보내도 같다.
    assert.equal((await call(new Request("https://edge/api/v1/me", { headers: { authorization: "Bearer " + token, origin } }))).status, 200);
    assert.equal((await go("/v1/me", { headers: { origin: "https://evil.example" } })).status, 403);
    assert.equal((await go("/v1/me", { headers: { authorization: "Bearer nope" } })).status, 401);
    const pre = await go("/v1/me", { method: "OPTIONS" });
    assert.equal(pre.status, 204);
    assert.equal(await pre.text(), "");
    assert.equal((await go("/v1/nowhere")).status, 404);
    // 본문이 있는 라우트: 보관함 왕복(정적 토큰 계정은 VAULT_DIR 파일).
    const envelope = { v: 1 };
    const put = await go("/v1/vault/obj-1", { method: "PUT", body: JSON.stringify({ envelope }) });
    assert.ok([200, 400].includes(put.status), "본문이 처리기까지 갔다(봉투 검증 결과)");
    const big = await go("/v1/write", { method: "POST", body: "x".repeat(300 * 1024) });
    assert.equal(big.status, 413);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
