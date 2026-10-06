const test = require("node:test");
const assert = require("node:assert/strict");
const { STORES, memoryAdapter, createStore, Store } = require("./package-store.js");

// 왕복: JSON·바이트 복호화 결과 일치, 레코드에 평문 미포함, 매번 새 IV
test("putJson/putBytes round trip and records never contain plaintext", async () => {
  const adapter = memoryAdapter();
  const store = await createStore(adapter);
  const secret = "비밀-평문-9f2c-강의";

  await store.putJson("packages", "p1", { msg: secret, n: 42 });
  assert.deepEqual(await store.getJson("packages", "p1"), { msg: secret, n: 42 });

  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  await store.putBytes("blobs", "b1", bytes);
  assert.deepEqual(await store.getBytes("blobs", "b1"), bytes);

  assert.equal(await store.getJson("packages", "missing"), null);
  assert.equal(await store.getBytes("blobs", "missing"), null);

  // 직렬화된 레코드에 평문·키 이름이 그대로 남으면 안 된다
  const record = await adapter.get("packages", "p1");
  const serialised = JSON.stringify(record);
  assert.equal(record.v, 1);
  assert.equal(serialised.includes(secret), false);
  assert.equal(serialised.includes("msg"), false);

  await store.putJson("packages", "a", { x: 1 });
  await store.putJson("packages", "b", { x: 1 });
  const ra = await adapter.get("packages", "a"), rb = await adapter.get("packages", "b");
  assert.notDeepEqual([...ra.iv], [...rb.iv]);
});

// AAD: 다른 id로 복사하거나 schemaVersion을 바꾸면 복호화 거부
test("records are bound to store/id/schemaVersion via AAD", async () => {
  const adapter = memoryAdapter();
  const store = await createStore(adapter);
  await store.putJson("packages", "orig", { v: "data" });
  const rec = await adapter.get("packages", "orig");

  await adapter.put("packages", "copied", rec);
  await assert.rejects(() => store.getJson("packages", "copied"), /보관 데이터가 손상/);

  await adapter.put("packages", "ver", { ...rec, schemaVersion: rec.schemaVersion + 1 });
  await assert.rejects(() => store.getJson("packages", "ver"), /보관 데이터가 손상/);
});

// 입력 검증: keys·알 수 없는 저장소, 잘못된 id, 비-Uint8Array 거부
test("validation rejects keys store, unknown stores, bad ids, non-bytes", async () => {
  const store = await createStore(memoryAdapter());
  assert.deepEqual(STORES, ["keys", "packages", "blobs", "jobs", "logs"]);

  for (const s of ["keys", "nope", "", "KEYS"]) {
    await assert.rejects(() => store.putJson(s, "id1", {}), TypeError);
    await assert.rejects(() => store.getJson(s, "id1"), TypeError);
    await assert.rejects(() => store.putBytes(s, "id1", new Uint8Array(1)), TypeError);
    await assert.rejects(() => store.getBytes(s, "id1"), TypeError);
    await assert.rejects(() => store.delete(s, "id1"), TypeError);
    await assert.rejects(() => store.ids(s), TypeError);
  }

  for (const id of ["", " id", "-bad", ".dot", "a b", "한글id", "x".repeat(129)]) {
    await assert.rejects(() => store.putJson("packages", id, {}), TypeError);
    await assert.rejects(() => store.getJson("packages", id), TypeError);
    await assert.rejects(() => store.delete("packages", id), TypeError);
  }
  await store.putJson("packages", "a.b:c-d_e", 1);
  assert.equal(await store.getJson("packages", "a.b:c-d_e"), 1);

  await assert.rejects(() => store.putBytes("blobs", "ok", "not-bytes"), TypeError);
  await assert.rejects(() => store.putBytes("blobs", "ok", [1, 2, 3]), TypeError);
});

// 로그: 배치 append/read 순서·since 필터, age·bytes 프루닝과 반환 개수
test("appendLogBatch/readLogs ordering, since filter, and pruneLogs", async () => {
  const adapter = memoryAdapter();
  const store = await createStore(adapter);

  const id1 = await store.appendLogBatch([{ m: "a" }, { m: "b" }], { now: 1000 });
  const id2 = await store.appendLogBatch([{ m: "c" }], { now: 3000 });
  const id3 = await store.appendLogBatch([{ m: "d" }, { m: "e" }], { now: 2000 });
  assert.match(id1, /^[a-z0-9]+-[0-9a-f]{8}$/);
  assert.notEqual(id1, id2);
  assert.notEqual(id2, id3);

  // meta.ts 오름차순으로 배치가 펼쳐진다 (2000 배치가 3000 배치보다 앞)
  assert.deepEqual(await store.readLogs(), [{ m: "a" }, { m: "b" }, { m: "d" }, { m: "e" }, { m: "c" }]);
  assert.deepEqual(await store.readLogs({ since: 2000 }), [{ m: "d" }, { m: "e" }, { m: "c" }]);
  assert.deepEqual(await store.readLogs({ since: 4000 }), []);

  // 나이 기준: now=4000, maxAgeMs=2500 → ts 1000만 제거
  const removedAge = await store.pruneLogs({ maxAgeMs: 2500, maxBytes: Infinity, now: 4000 });
  assert.equal(removedAge, 1);
  assert.deepEqual(await store.readLogs(), [{ m: "d" }, { m: "e" }, { m: "c" }]);

  // 바이트 기준: 총합-1로 제한하면 가장 오래된 배치(ts 2000)만 제거
  const entries = await adapter.entries("logs");
  const total = entries.reduce((s, [, r]) => s + r.meta.bytes, 0);
  const removedBytes = await store.pruneLogs({ maxAgeMs: Infinity, maxBytes: total - 1, now: 4000 });
  assert.equal(removedBytes, 1);
  assert.deepEqual(await store.readLogs(), [{ m: "c" }]);

  // maxBytes=0이면 남은 배치 전부 제거
  assert.equal(await store.pruneLogs({ maxBytes: 0, now: 4000 }), 1);
  assert.deepEqual(await store.readLogs(), []);
});

// readLogs: 깨진 배치 하나는 건너뛰고 나머지 이벤트를 돌려준다
test("readLogs skips a corrupt batch and still returns the rest", async () => {
  const adapter = memoryAdapter();
  const store = await createStore(adapter);
  await store.appendLogBatch([{ m: "ok1" }], { now: 1 });
  const badId = await store.appendLogBatch([{ m: "bad" }], { now: 2 });
  await store.appendLogBatch([{ m: "ok2" }], { now: 3 });

  const rec = await adapter.get("logs", badId);
  const ct = new Uint8Array(rec.ct); ct[0] ^= 1;
  await adapter.put("logs", badId, { ...rec, ct });

  assert.deepEqual(await store.readLogs(), [{ m: "ok1" }, { m: "ok2" }]);
});

// 평문 16 MiB 초과는 암호화 전에 거부한다
test("putBytes rejects plaintext over 16 MiB", async () => {
  const store = await createStore(memoryAdapter());
  await assert.rejects(() => store.putBytes("blobs", "big", new Uint8Array(16 * 1024 * 1024 + 1)), /16 MiB/);
  await store.putBytes("blobs", "edge", new Uint8Array(16 * 1024 * 1024));
});

// wipe: 키 저장소까지 파쇄하고 새 키로 재사용, 이전 키로는 못 연다
test("wipe shreds all stores including keys and regenerates the device key", async () => {
  const adapter = memoryAdapter();
  const store = await createStore(adapter);
  await store.putJson("packages", "doc", { v: 1 });
  await store.appendLogBatch([{ m: "x" }], { now: 1 });
  const oldKey = await adapter.get("keys", "device");

  await store.wipe();
  assert.equal(await store.getJson("packages", "doc"), null);
  assert.strictEqual(await adapter.get("packages", "doc"), undefined);
  assert.deepEqual(await adapter.entries("logs"), []);

  const newKey = await adapter.get("keys", "device");
  assert.ok(newKey);
  assert.notEqual(newKey, oldKey);
  assert.equal((await adapter.entries("keys")).length, 1);

  await store.putJson("packages", "d2", { ok: true });
  assert.deepEqual(await store.getJson("packages", "d2"), { ok: true });

  // 이전 키를 쥔 Store는 새 암호문을 열지 못한다
  const stale = new Store(adapter, oldKey);
  await assert.rejects(() => stale.getJson("packages", "d2"), /보관 데이터가 손상/);
});

// createStore: 같은 어댑터에 두 번 호출하면 기기 키를 재사용한다
test("createStore reuses the same device key on one adapter", async () => {
  const adapter = memoryAdapter();
  const s1 = await createStore(adapter);
  const key = await adapter.get("keys", "device");
  const s2 = await createStore(adapter);

  assert.equal(await adapter.get("keys", "device"), key);
  assert.equal((await adapter.entries("keys")).length, 1);

  await s1.putJson("jobs", "j1", { step: 1 });
  assert.deepEqual(await s2.getJson("jobs", "j1"), { step: 1 });
});

// 동시 초기화: 경쟁하는 createStore 둘이 같은 기기 키 객체로 수렴한다
test("concurrent createStore calls converge on one device key", async () => {
  const adapter = memoryAdapter();
  const [s1, s2] = await Promise.all([createStore(adapter), createStore(adapter)]);

  assert.equal(s1.key, s2.key);
  assert.equal((await adapter.entries("keys")).length, 1);

  await s1.putJson("packages", "shared", { from: "s1" });
  assert.deepEqual(await s2.getJson("packages", "shared"), { from: "s1" });
});
test("wipe keeps the chosen library folder and the account note key (settings and login, not lecture data)", async () => {
  const { memoryAdapter, createStore } = require("./package-store");
  const a = memoryAdapter(), store = await createStore(a), folder = { handle: { kind: "directory" }, name: "Summrizei", at: 1 };
  const library = { key: { type: "secret" }, uid: "user-1", at: 1 };
  await a.put("keys", "libraryFolder", folder);
  await a.put("keys", "library", library);
  await a.put("packages", "p1", "x");
  await store.wipe();
  assert.deepEqual(await a.get("keys", "libraryFolder"), folder);
  assert.deepEqual(await a.get("keys", "library"), library);
  assert.equal(await a.get("packages", "p1"), undefined);
});
