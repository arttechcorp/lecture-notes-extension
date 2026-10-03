import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../supabase/functions/delete-account/index.js";

const URL0 = "https://supa.example";
const KEY = "service-role-key-xyz";
const TOKEN = "user-token-abc";
const ID = "123e4567-e89b-42d3-a456-426614174000";
const ENV = { url: URL0, key: KEY };

const post = () => new Request("https://fn.local/delete-account", { method: "POST", headers: { authorization: "Bearer " + TOKEN } });
const res = (status, body = null) => new Response(body, { status });

// 호출을 [method, url, 파싱한 body] 로 기록하고 URL 패턴으로 응답한다.
function fakeFetch({ objects = 0, rpcStatus = 200, rpcText = "", userStatus = 200, storageDeleteStatus = 200, adminStatus = 204 } = {}) {
  const calls = [];
  const names = Array.from({ length: objects }, (_, i) => `obj${i}.bin`);
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push([init.method || "GET", url, body]);
    if (url === URL0 + "/auth/v1/user") return userStatus === 200 ? res(200, JSON.stringify({ id: ID })) : res(userStatus, "{}");
    if (url === URL0 + "/rest/v1/rpc/delete_account_data") return rpcStatus === 200 ? res(200, "null") : res(rpcStatus, rpcText);
    if (url === URL0 + "/storage/v1/object/list/vault") return res(200, JSON.stringify(names.slice(body.offset, body.offset + 100).map(name => ({ name }))));
    if (url === URL0 + "/storage/v1/object/vault") return res(storageDeleteStatus, "{}");
    if (url === URL0 + "/auth/v1/admin/users/" + ID) return res(adminStatus);
    throw new Error("unexpected url " + url);
  };
  return { fetch, calls };
}

test("happy path: user -> rpc -> list pages -> delete chunks -> admin delete", async () => {
  const { fetch, calls } = fakeFetch({ objects: 150 });
  const r = await handle(post(), ENV, fetch);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { deleted: true });

  assert.deepEqual(calls.map(([m, u]) => [m, u]), [
    ["GET", URL0 + "/auth/v1/user"],
    ["POST", URL0 + "/rest/v1/rpc/delete_account_data"],
    ["POST", URL0 + "/storage/v1/object/list/vault"],
    ["POST", URL0 + "/storage/v1/object/list/vault"],
    ["DELETE", URL0 + "/storage/v1/object/vault"],
    ["DELETE", URL0 + "/storage/v1/object/vault"],
    ["DELETE", URL0 + "/auth/v1/admin/users/" + ID],
  ]);
  assert.deepEqual(calls[1][2], { p_user: ID });
  assert.deepEqual(calls[2][2], { prefix: ID + "/", limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } });
  assert.equal(calls[3][2].offset, 100);
  assert.equal(calls[4][2].prefixes.length, 100);
  assert.equal(calls[5][2].prefixes.length, 50);
  for (const p of [...calls[4][2].prefixes, ...calls[5][2].prefixes]) assert.ok(p.startsWith(ID + "/"));
});

test("no storage objects: bulk delete is skipped", async () => {
  const { fetch, calls } = fakeFetch();
  const r = await handle(post(), ENV, fetch);
  assert.equal(r.status, 200);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(([, u]) => u !== URL0 + "/storage/v1/object/vault"));
});

test("active_subscription stops before storage and auth calls", async () => {
  const { fetch, calls } = fakeFetch({ objects: 5, rpcStatus: 400, rpcText: '{"message":"active_subscription"}' });
  const r = await handle(post(), ENV, fetch);
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: "active_subscription" });
  assert.equal(calls.length, 2);
});

test("missing Authorization: 401 and fetch never called", async () => {
  const { fetch, calls } = fakeFetch();
  const r = await handle(new Request("https://fn.local/delete-account", { method: "POST" }), ENV, fetch);
  assert.equal(r.status, 401);
  assert.equal(calls.length, 0);
});

test("bad token (user endpoint 401): 401 and no rpc call", async () => {
  const { fetch, calls } = fakeFetch({ userStatus: 401 });
  const r = await handle(post(), ENV, fetch);
  assert.equal(r.status, 401);
  assert.equal(calls.length, 1);
});

test("admin delete 404 still succeeds", async () => {
  const { fetch } = fakeFetch({ objects: 3, adminStatus: 404 });
  const r = await handle(post(), ENV, fetch);
  assert.equal(r.status, 200);
});

test("storage delete 500 maps to account_delete_failed", async () => {
  const { fetch } = fakeFetch({ objects: 1, storageDeleteStatus: 500 });
  const r = await handle(post(), ENV, fetch);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: "account_delete_failed" });
});

test("OPTIONS is 204 with CORS, GET is 405", async () => {
  const opt = await handle(new Request("https://fn.local", { method: "OPTIONS" }), ENV);
  assert.equal(opt.status, 204);
  assert.equal(opt.headers.get("access-control-allow-origin"), "*");
  assert.equal(await opt.text(), "");
  const get = await handle(new Request("https://fn.local", { method: "GET" }), ENV);
  assert.equal(get.status, 405);
  assert.deepEqual(await get.json(), { error: "method_not_allowed" });
});

test("service key and user token never appear in response bodies", async () => {
  const bodies = [];
  bodies.push(await (await handle(new Request("https://fn.local", { method: "GET" }), ENV)).text());
  bodies.push(await (await handle(new Request("https://fn.local", { method: "POST" }), ENV)).text());
  bodies.push(await (await handle(post(), ENV, fakeFetch({ objects: 2 }).fetch)).text());
  bodies.push(await (await handle(post(), ENV, fakeFetch({ userStatus: 401 }).fetch)).text());
  bodies.push(await (await handle(post(), ENV, fakeFetch({ rpcStatus: 400, rpcText: "active_subscription" }).fetch)).text());
  bodies.push(await (await handle(post(), ENV, fakeFetch({ objects: 1, storageDeleteStatus: 500 }).fetch)).text());
  for (const b of bodies) {
    assert.ok(!b.includes(KEY));
    assert.ok(!b.includes(TOKEN));
  }
});
