import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { handle } from "../supabase/functions/billing-webhook/index.js";

const URL0 = "https://supa.example";
const KEY = "service-role-key-xyz";
const SECRET = "groble-secret-current";
const PREV = "groble-secret-previous";
const PLANS = JSON.stringify({ "opt-ess": { plan: "essential", edu: false }, "opt-edu": { plan: "essential", edu: true }, "ctn-pro": { plan: "professional", edu: false } });
const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const TS = Math.floor(NOW / 1000);
const UID = "123e4567-e89b-42d3-a456-426614174000";
const UID2 = "9a0b1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d";
const EMAIL = "buyer@example.com";
const ENV = { url: URL0, key: KEY, secret: SECRET, previousSecret: PREV, plans: PLANS, now: () => NOW };

// Groble는 "<timestamp>.<raw body>"를 HMAC-SHA256 hex로 서명한다 — 테스트도 같은 식으로 만든다.
const sign = (secret, ts, body) => createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
const ev = (type, object = {}, extra = {}) => ({ id: "evt_1", type, version: 1, occurredAt: "2026-10-03T11:59:00Z", data: { object }, ...extra });
const OBJ = (over = {}) => ({ sellerReference: UID, buyer: { email: EMAIL }, content: { id: "ctn-pro" }, options: [], subscription: { status: "active", nextBillingDate: "2026-11-10", activatedAt: "2026-10-03T11:00:00Z", billingCycleMonths: 1 }, ...over });
function post(body, { secret = SECRET, ts = TS, headers = {}, sigBody } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://fn.local/billing-webhook", { method: "POST", body: raw, headers: { "x-groble-signature": sign(secret, ts, sigBody ?? raw), "x-groble-timestamp": String(ts), ...headers } });
}
const res = (status, body = "null") => new Response(body, { status });

// 호출을 [method, url, 파싱한 body, headers]로 기록한다. pages는 이메일 폴백의 admin users 응답(페이지 번호 → users 배열).
function fakeFetch({ rpcStatus = 200, rpcResult = "applied", pages = {}, merchants = {} } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push([init.method || "GET", url, init.body ? JSON.parse(init.body) : null, init.headers || null]);
    if (url === URL0 + "/rest/v1/rpc/apply_billing_event") return res(rpcStatus, JSON.stringify(rpcResult));
    const mu = /\/rest\/v1\/billing_events\?select=user_id&merchant_uid=eq\.([^&]+)&user_id=not\.is\.null&limit=1$/.exec(url);
    if (mu) return res(200, JSON.stringify(merchants[decodeURIComponent(mu[1])] ? [{ user_id: merchants[decodeURIComponent(mu[1])] }] : []));
    const m = /\/auth\/v1\/admin\/users\?per_page=1000&page=(\d+)$/.exec(url);
    if (m) return res(200, JSON.stringify({ users: pages[+m[1]] || [] }));
    throw new Error("unexpected url " + url);
  };
  return { fetch, calls };
}

test("completed: RPC 본문을 필드별로 검사", async () => {
  const { fetch, calls } = fakeFetch();
  const r = await handle(post(ev("subscription_payment.completed", OBJ())), ENV, fetch);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { result: "applied" });
  assert.equal(r.headers.get("content-type"), "application/json");
  assert.equal(r.headers.get("cache-control"), "no-store");

  assert.equal(calls.length, 1); // sellerReference가 UUID라 어드민 조회 없이 바로 RPC
  const [m, u, b, h] = calls[0];
  assert.equal(m, "POST");
  assert.equal(u, URL0 + "/rest/v1/rpc/apply_billing_event");
  assert.equal(h.apikey, KEY);
  assert.equal(h.authorization, "Bearer " + KEY);
  assert.equal(b.p_event_id, "evt_1");
  assert.equal(b.p_type, "subscription_payment.completed");
  assert.equal(b.p_user, UID);
  assert.equal(b.p_plan, "professional");
  assert.equal(b.p_edu, false);
  assert.equal(b.p_external_id, "ctn-pro:" + UID);
  assert.equal(b.p_starts, "2026-10-03T11:00:00Z");
  assert.equal(b.p_ends, "2026-11-13T14:59:59.000Z"); // 2026-11-10T23:59:59+09:00 + 유예 3일
});

test("이전 시크릿과 Signature-Previous 헤더도 로테이션 중 수용", async () => {
  const r1 = await handle(post(ev("subscription_payment.completed", OBJ()), { secret: PREV }), ENV, fakeFetch().fetch);
  assert.equal(r1.status, 200);
  const r2 = await handle(post(ev("subscription_payment.completed", OBJ()), { headers: { "x-groble-signature": "0".repeat(64), "x-groble-signature-previous": sign(SECRET, TS, JSON.stringify(ev("subscription_payment.completed", OBJ()))) } }), ENV, fakeFetch().fetch);
  assert.equal(r2.status, 200);
});

test("bad signature -> 401 bad_signature", async () => {
  const { fetch, calls } = fakeFetch();
  const r = await handle(post(ev("subscription_payment.completed", OBJ()), { secret: "wrong-secret" }), ENV, fetch);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: "bad_signature" });
  assert.equal(calls.length, 0);
});

test("stale timestamp -> 401 stale_timestamp", async () => {
  const r = await handle(post(ev("subscription_payment.completed", OBJ()), { ts: TS - 301 }), ENV, fakeFetch().fetch);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: "stale_timestamp" });
});

test("다른 바디로 만든 서명 -> 401", async () => {
  const good = JSON.stringify(ev("subscription_payment.completed", OBJ()));
  const r = await handle(post(good, { sigBody: good.replace("evt_1", "evt_9") }), ENV, fakeFetch().fetch);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: "bad_signature" });
});

test("unknown type -> 200 ignored, fetch 없음", async () => {
  const { fetch, calls } = fakeFetch();
  const r = await handle(post(ev("payment.completed", OBJ())), ENV, fetch);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ignored: true });
  assert.equal(calls.length, 0);
});

test("subscription_payment.failed도 호출 없이 ignored", async () => {
  const { fetch, calls } = fakeFetch();
  const r = await handle(post(ev("subscription_payment.failed", OBJ())), ENV, fetch);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ignored: true });
  assert.equal(calls.length, 0);
});

test("completed인데 플랜이 맵에 없으면 ignored unknown_plan", async () => {
  const { fetch, calls } = fakeFetch();
  const r = await handle(post(ev("subscription_payment.completed", OBJ({ content: { id: "ctn-x" }, options: [{ optionId: "opt-x" }] }))), ENV, fetch);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ignored: "unknown_plan" });
  assert.equal(calls.length, 0);
});

test("optionId 매칭이 content.id보다 우선", async () => {
  const { fetch, calls } = fakeFetch();
  const r = await handle(post(ev("subscription_payment.completed", OBJ({ options: [{ optionId: "opt-x" }, { optionId: "opt-edu" }] }))), ENV, fetch);
  assert.equal(r.status, 200);
  assert.equal(calls[0][2].p_plan, "essential");
  assert.equal(calls[0][2].p_edu, true);
});

test("sellerReference가 UUID가 아니면 이메일로 페이지를 넘겨 찾는다", async () => {
  const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: UID, email: "u" + i + "@x.example" }));
  const { fetch, calls } = fakeFetch({ pages: { 1: page1, 2: [{ id: UID2, email: "BUYER@EXAMPLE.COM" }] } });
  const r = await handle(post(ev("subscription_payment.completed", OBJ({ sellerReference: "ref-not-uuid" }))), ENV, fetch);
  assert.equal(r.status, 200);
  assert.deepEqual(calls.map(([m, u]) => [m, u]), [
    ["GET", URL0 + "/auth/v1/admin/users?per_page=1000&page=1"],
    ["GET", URL0 + "/auth/v1/admin/users?per_page=1000&page=2"],
    ["POST", URL0 + "/rest/v1/rpc/apply_billing_event"],
  ]);
  assert.equal(calls[2][2].p_user, UID2); // 대소문자 무시 이메일 매치
});

test("이메일로도 못 찾으면 ignored unknown_user", async () => {
  const { fetch, calls } = fakeFetch({ pages: { 1: [{ id: UID, email: "other@x.example" }] } });
  const r = await handle(post(ev("subscription_payment.completed", OBJ({ sellerReference: "nope" }))), ENV, fetch);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ignored: "unknown_user" });
  assert.equal(calls.length, 1); // 어드민 조회만 하고 RPC는 안 부른다
});

test("idempotency key 헤더가 envelope.id보다 우선", async () => {
  const { fetch, calls } = fakeFetch();
  const r = await handle(post(ev("subscription_payment.completed", OBJ(), { id: "evt_env" }), { headers: { "x-groble-idempotency-key": "idk_9" } }), ENV, fetch);
  assert.equal(r.status, 200);
  assert.equal(calls[0][2].p_event_id, "idk_9");
});

test("RPC 실패 -> 503 apply_failed", async () => {
  const { fetch } = fakeFetch({ rpcStatus: 500 });
  const r = await handle(post(ev("subscription_payment.completed", OBJ())), ENV, fetch);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: "apply_failed" });
});

test("cancel_requested: serviceEndsAt이 ends, 플랜 미해석이면 null", async () => {
  const { fetch, calls } = fakeFetch();
  const r = await handle(post(ev("subscription.cancel_requested", OBJ({ content: { id: "ctn-x" }, serviceEndsAt: "2026-12-01T00:00:00Z" }))), ENV, fetch);
  assert.equal(r.status, 200);
  const b = calls[0][2];
  assert.equal(b.p_type, "subscription.cancel_requested");
  assert.equal(b.p_ends, "2026-12-01T00:00:00Z");
  assert.equal(b.p_starts, null);
  assert.equal(b.p_plan, null);
  assert.equal(b.p_edu, null);
});

test("terminated: terminatedAt이 ends, 없으면 now", async () => {
  const f1 = fakeFetch();
  let r = await handle(post(ev("subscription.terminated", OBJ({ termination: { terminatedAt: "2026-10-02T00:00:00Z" } }))), ENV, f1.fetch);
  assert.equal(r.status, 200);
  assert.equal(f1.calls[0][2].p_ends, "2026-10-02T00:00:00Z");
  const f2 = fakeFetch();
  r = await handle(post(ev("subscription.terminated", OBJ({ content: { id: "ctn-x" } }))), ENV, f2.fetch);
  assert.equal(f2.calls[0][2].p_ends, new Date(NOW).toISOString());
});

test("refunded: ends는 now", async () => {
  const { fetch, calls } = fakeFetch();
  const r = await handle(post(ev("subscription_payment.refunded", OBJ())), ENV, fetch);
  assert.equal(r.status, 200);
  assert.equal(calls[0][2].p_type, "subscription_payment.refunded");
  assert.equal(calls[0][2].p_ends, new Date(NOW).toISOString());
});

test("nextBillingDate 없으면 billingCycleMonths*31일 + 3일", async () => {
  const { fetch, calls } = fakeFetch();
  const o = OBJ({ subscription: { status: "active", activatedAt: "2026-10-03T11:00:00Z", billingCycleMonths: 12 } });
  const r = await handle(post(ev("subscription_payment.completed", o)), ENV, fetch);
  assert.equal(r.status, 200);
  assert.equal(calls[0][2].p_ends, new Date(NOW + 12 * 31 * 86400000 + 3 * 86400000).toISOString());
});

test("nextBillingDate가 전체 ISO 시각이어도 앞 날짜만 쓰고, 날짜 모양이 아니면 추정으로 간다", async () => {
  // "2026-11-10T05:00:00Z"+"T23:59:59+09:00"는 Invalid Date다 — 앞 10자만 취해 날짜만 온 것과 같은 결과여야 한다.
  const f1 = fakeFetch();
  const o1 = OBJ({ subscription: { status: "active", nextBillingDate: "2026-11-10T05:00:00Z", activatedAt: "2026-10-03T11:00:00Z", billingCycleMonths: 1 } });
  const r = await handle(post(ev("subscription_payment.completed", o1)), ENV, f1.fetch);
  assert.equal(r.status, 200);
  assert.equal(f1.calls[0][2].p_ends, "2026-11-13T14:59:59.000Z", "날짜만 온 경우와 동일: 11-10 말일 KST + 3일");
  const f2 = fakeFetch();
  const o2 = OBJ({ subscription: { status: "active", nextBillingDate: "11/10/2026", activatedAt: "2026-10-03T11:00:00Z", billingCycleMonths: 1 } });
  await handle(post(ev("subscription_payment.completed", o2)), ENV, f2.fetch);
  assert.equal(f2.calls[0][2].p_ends, new Date(NOW + 31 * 86400000 + 3 * 86400000).toISOString(), "날짜 모양이 아니면 추정치");
});

test("apply_billing_event가 unknown_user를 돌려주면 재시도를 끊고 200 ignored", async () => {
  const { fetch, calls } = fakeFetch({ rpcResult: "unknown_user" });
  const r = await handle(post(ev("subscription_payment.completed", OBJ())), ENV, fetch);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ignored: "unknown_user" });
  assert.equal(calls.length, 1, "RPC 결과가 ignored로 바뀐다 — Groble은 200이면 재시도하지 않는다");
});

test("GET -> 405, secret 없으면 500 misconfigured", async () => {
  const g = await handle(new Request("https://fn.local/billing-webhook", { method: "GET" }), ENV);
  assert.equal(g.status, 405);
  assert.deepEqual(await g.json(), { error: "method_not_allowed" });
  const m = await handle(post(ev("subscription_payment.completed", OBJ())), { ...ENV, secret: null }, fakeFetch().fetch);
  assert.equal(m.status, 500);
  assert.deepEqual(await m.json(), { error: "misconfigured" });
});

test("잘못된 JSON과 id 규칙 위반 -> 400 bad_payload", async () => {
  const r1 = await handle(post("not json"), ENV, fakeFetch().fetch);
  assert.equal(r1.status, 400);
  assert.deepEqual(await r1.json(), { error: "bad_payload" });
  const r2 = await handle(post({ type: "payment.completed" }), ENV, fakeFetch().fetch);
  assert.equal(r2.status, 400); // id가 없고 헤더도 없다
});

test("응답에 이메일과 user id가 나오지 않는다", async () => {
  const bodies = [];
  bodies.push(await (await handle(new Request("https://fn.local/x", { method: "GET" }), ENV)).text());
  bodies.push(await (await handle(post(ev("payment.completed", OBJ())), ENV, fakeFetch().fetch)).text());
  bodies.push(await (await handle(post(ev("subscription_payment.completed", OBJ({ sellerReference: "bad" }))), ENV, fakeFetch({ pages: { 1: [] } }).fetch)).text());
  bodies.push(await (await handle(post("not json"), ENV, fakeFetch().fetch)).text());
  bodies.push(await (await handle(post(ev("subscription_payment.completed", OBJ()), { secret: "x" }), ENV, fakeFetch().fetch)).text());
  bodies.push(await (await handle(post(ev("subscription_payment.completed", OBJ())), ENV, fakeFetch().fetch)).text());
  for (const b of bodies) {
    assert.ok(!b.includes(EMAIL));
    assert.ok(!b.includes(UID));
    assert.ok(!b.includes(KEY));
  }
});

test("환불(sellerReference 없음): 결제번호로 완료 때의 계정을 찾고, 결제번호를 RPC에 넘긴다", async () => {
  const { fetch, calls } = fakeFetch({ merchants: { "ord-1": UID2 } });
  const r = await handle(post(ev("subscription_payment.refunded", OBJ({ sellerReference: undefined, merchantUid: "ord-1", buyer: { email: "other@example.com" } }))), ENV, fetch);
  assert.equal(r.status, 200);
  assert.equal(calls.length, 2); // 결제번호 조회 → RPC, 메일 폴백은 타지 않는다
  const b = calls[1][2];
  assert.equal(b.p_user, UID2);
  assert.equal(b.p_merchant, "ord-1");
  assert.equal(b.p_external_id, "ctn-pro:" + UID2);
});

test("완료: 결제번호를 함께 남기고, 결제번호로 못 찾으면 메일 폴백", async () => {
  let { fetch, calls } = fakeFetch();
  await handle(post(ev("subscription_payment.completed", OBJ({ merchantUid: "ord-2" }))), ENV, fetch);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].p_merchant, "ord-2");
  ({ fetch, calls } = fakeFetch({ pages: { 1: [{ id: UID, email: EMAIL }] } }));
  const r = await handle(post(ev("subscription_payment.refunded", OBJ({ sellerReference: undefined, merchantUid: "ord-x" }))), ENV, fetch);
  assert.equal(r.status, 200);
  assert.deepEqual(calls.map(c => c[1].replace(URL0, "").split("?")[0]), ["/rest/v1/billing_events", "/auth/v1/admin/users", "/rest/v1/rpc/apply_billing_event"]);
  assert.equal(calls[2][2].p_user, UID);
});
