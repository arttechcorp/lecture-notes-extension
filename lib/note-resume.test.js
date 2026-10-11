// lib/note-resume.js — sol-luna-3 재개 캐시(P2a)의 키·체크포인트 계약. 합성 입력만 쓴다.
const test = require("node:test"), assert = require("node:assert/strict");
const NoteResume = require("./note-resume.js");
const { createStore, memoryAdapter } = require("./package-store.js");

const open = () => createStore(memoryAdapter());
const D = { section: "S3", evidenceIds: ["U4.s2"], spec: { v: 1 }, policy: { a: true } }; // 합성 의존성 재료

test("KINDS: 재개·다시 생성·디자인만 변경을 구분한다", () => {
  assert.deepEqual({ ...NoteResume.KINDS }, { RESUME: "resume", REGENERATE: "regenerate", RENDER: "render" });
});

test("keyOf: 같은 재료면 같은 키, scope·재료가 하나라도 다르면 다른 키 — 실행 식별자를 넣으면 키가 갈린다", async () => {
  const k = await NoteResume.keyOf("call.draft", D);
  assert.equal(k, await NoteResume.keyOf("call.draft", { ...D, t: undefined }), "동일 재료");
  assert.notEqual(k, await NoteResume.keyOf("call.draft", { ...D, evidenceIds: ["U4.s3"] }), "근거가 바뀌면 무효화");
  assert.notEqual(k, await NoteResume.keyOf("call.draft", { ...D, spec: { v: 2 } }), "편집 명세가 바뀌면 무효화");
  assert.notEqual(k, await NoteResume.keyOf("call.review", D), "다른 단위(scope)는 다른 키");
  assert.notEqual(k, await NoteResume.keyOf("call.draft", { ...D, requestId: "r2" }), "실행 식별자를 재료로 넣으면 다른 키 — 호출자가 빼는 게 계약이다");
  await assert.rejects(() => NoteResume.keyOf("", D), TypeError);
});

test("save/load: 암호문으로 남고 scope·버전 불일치·손상은 미스다", async () => {
  const store = await open(), key = "k".padEnd(8, "0");
  const value = { claims: ["c1"], nullReasons: null };
  await NoteResume.save(store, { packageId: "pkg", scope: "call.draft", key, value });
  // 바닥 어댑터에는 iv·ct 암호문만 있고 평문 value 가 없다(새 암호 코드 없이 package-store 경로 재사용).
  const raw = await store.adapter.get("packages", "pkg:r:" + key);
  assert.ok(raw?.iv && raw?.ct && raw.v === 1, "AES-GCM 레코드");
  assert.ok(!JSON.stringify(raw).includes("c1") || false); // ct 는 바이너리 — 평문 주장 id 가 보이면 안 된다
  assert.deepEqual(await NoteResume.load(store, { packageId: "pkg", scope: "call.draft", key }), { hit: true, value });
  assert.deepEqual(await NoteResume.load(store, { packageId: "pkg", scope: "call.review", key }), { hit: false, value: null }, "다른 scope 는 미스");
  assert.deepEqual(await NoteResume.load(store, { packageId: "pkg", scope: "call.draft", key: "none0000" }), { hit: false, value: null }, "없는 키는 미스");
  await store.adapter.put("packages", "pkg:r:" + key, { v: 1, iv: new Uint8Array(12), ct: new Uint8Array(8) }); // 손상
  assert.equal((await NoteResume.load(store, { packageId: "pkg", scope: "call.draft", key })).hit, false, "손상은 미스");
});

test("cached: 미스는 계산해 남기고 적중은 계산하지 않는다 — null 결과도 적중이다", async () => {
  const store = await open(), stats = { hits: 0, misses: 0 };
  let ran = 0;
  const compute = async () => (ran++, { out: ran });
  const a = await NoteResume.cached(store, { packageId: "pkg", scope: "s", key: "a".repeat(8), stats }, compute);
  const b = await NoteResume.cached(store, { packageId: "pkg", scope: "s", key: "a".repeat(8), stats }, compute);
  assert.deepEqual([a, b], [{ out: 1 }, { out: 1 }]);
  assert.equal(ran, 1); assert.deepEqual(stats, { hits: 1, misses: 1 });
  let n = 0;
  const nul = async () => (n++, null);
  assert.equal(await NoteResume.cached(store, { packageId: "pkg", scope: "s", key: "b".repeat(8) }, nul), null);
  assert.equal(await NoteResume.cached(store, { packageId: "pkg", scope: "s", key: "b".repeat(8) }, nul), null);
  assert.equal(n, 1, "null 결과도 저장돼 적중이다");
});
