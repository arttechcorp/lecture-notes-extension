const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryAdapter, createStore } = require("./package-store.js");
const Lib = require("./library.js");

const meta = (packageId, over = {}) => ({
  packageId, title: "선형대수 3주차", host: "lms.example.ac.kr",
  source: "background", tier: "paid", status: "complete",
  createdAt: "2026-10-01T09:00:00.000Z", durationSec: 3480,
  noteSpecVersion: "lecture-note-2",
  options: { syntheticExamples: false, externalAugmentation: false, exam: true },
  counts: { sections: 6, questions: 9 },
  ...over,
});
const NOTE = { noteSpecVersion: "lecture-note-2", sections: [{ sectionId: "s1", title: "행렬", blocks: [] }], registry: [] };
const INPUT = { slides: [{ slideId: "s1" }], transcript: { segments: [] }, tier: "paid" };
const at = iso => ({ now: () => new Date(iso) });

// 저장 → 목록 → 열람 왕복. 메타 레코드는 암호문이라 평문이 남지 않는다.
test("saveResult → list → load roundtrip", async () => {
  const adapter = memoryAdapter(), store = await createStore(adapter);
  const pkg = "Lp1-aaaaaa";
  const stored = await Lib.saveResult(store, {
    packageId: pkg, meta: meta(pkg), input: INPUT, note: NOTE,
    crops: { F1: new Uint8Array([1, 2, 3]), G2: new Uint8Array([4]) },
  }, at("2026-10-02T10:00:00Z"));

  assert.equal(Lib.metaId(pkg), "Lp1-aaaaaa:meta");
  assert.equal(Lib.cropId(pkg, "F1"), "Lp1-aaaaaa:crop:F1");
  assert.equal(stored.createdAt, "2026-10-01T09:00:00.000Z");
  assert.equal(stored.updatedAt, "2026-10-02T10:00:00.000Z");

  const listed = await Lib.list(store);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].packageId, pkg);

  const got = await Lib.load(store, pkg);
  assert.deepEqual(got.meta, stored);
  assert.deepEqual(got.note, NOTE);
  assert.deepEqual(got.input, INPUT);
  assert.equal(await Lib.load(store, "없는pkg"), null);

  // 메타 레코드는 암호문이다 — 제목 평문이 직렬화에 남으면 안 된다
  const serialised = JSON.stringify(await adapter.get("packages", Lib.metaId(pkg)));
  assert.equal(serialised.includes("선형대수"), false);
});

// 다시 저장: createdAt은 첫 값을 유지하고 updatedAt만 바뀐다. input을 생략하면 이전 입력이 남는다.
test("second save keeps createdAt and input, bumps updatedAt", async () => {
  const adapter = memoryAdapter(), store = await createStore(adapter);
  const pkg = "Lp2-bbbbbb";
  await Lib.saveResult(store, { packageId: pkg, meta: meta(pkg), input: INPUT, note: NOTE }, at("2026-10-02T10:00:00Z"));
  const again = await Lib.saveResult(store, {
    packageId: pkg,
    meta: meta(pkg, { createdAt: "1999-01-01T00:00:00Z", title: "다른 제목" }),
    note: NOTE,
  }, at("2026-10-03T10:00:00Z"));

  assert.equal(again.createdAt, "2026-10-01T09:00:00.000Z");
  assert.equal(again.updatedAt, "2026-10-03T10:00:00.000Z");
  assert.equal(again.title, "다른 제목");
  assert.deepEqual((await Lib.load(store, pkg)).input, INPUT);
});

// host에 전체 URL이 오면 호스트명만 남긴다(경로·쿼리·포트는 버린다)
test("host keeps only the hostname from a full URL", async () => {
  const store = await createStore(memoryAdapter());
  const m = await Lib.saveResult(store, {
    packageId: "Lp3-cccccc",
    meta: meta("Lp3-cccccc", { host: "https://lms.example.ac.kr:8443/course/12?v=3#frag" }),
    note: NOTE,
  });
  assert.equal(m.host, "lms.example.ac.kr");

  const bare = await Lib.saveResult(store, {
    packageId: "Lp4-dddddd",
    meta: meta("Lp4-dddddd", { host: "lms.example.ac.kr/path?q=1" }),
    note: NOTE,
  });
  assert.equal(bare.host, "lms.example.ac.kr");
});

// 모르는 필드는 저장하지 않는다(options 안쪽도 마찬가지)
test("unknown meta fields are dropped", async () => {
  const store = await createStore(memoryAdapter());
  const pkg = "Lp5-eeeeee";
  const m = await Lib.saveResult(store, {
    packageId: pkg,
    meta: meta(pkg, { pageUrl: "https://lms.example.ac.kr/lecture/9", secret: "x", options: { exam: true, extra: "y" } }),
    note: NOTE,
  });
  assert.deepEqual(Object.keys(m).sort(), ["counts", "createdAt", "durationSec", "host", "noteSpecVersion", "options", "packageId", "source", "status", "tier", "title", "updatedAt"].sort());
  assert.deepEqual(m.options, { syntheticExamples: false, externalAugmentation: false, exam: true });
});

// 인식만 한 결과는 노트가 없다 — 이전 노트 레코드를 지운다. 잘못된 메타 값은 거절한다.
test("recognition-only save deletes an older note; bad meta values throw", async () => {
  const store = await createStore(memoryAdapter());
  const pkg = "Lp6-ffffff";
  await Lib.saveResult(store, { packageId: pkg, meta: meta(pkg), input: INPUT, note: NOTE });
  const m = await Lib.saveResult(store, { packageId: pkg, meta: meta(pkg, { status: "recognition-only", counts: null }), note: null });
  assert.equal(m.status, "recognition-only");
  assert.equal(await store.getJson("packages", Lib.noteId(pkg)), null);
  assert.equal((await Lib.load(store, pkg)).note, null);

  await assert.rejects(() => Lib.saveResult(store, { packageId: pkg, meta: meta(pkg, { status: "nope" }) }), TypeError);
  await assert.rejects(() => Lib.saveResult(store, { packageId: pkg, meta: meta("다른pkg") }), TypeError);
  await assert.rejects(() => Lib.saveResult(store, { packageId: pkg, meta: meta(pkg, { title: "x".repeat(201) }) }), TypeError);
  await assert.rejects(() => Lib.saveResult(store, { packageId: pkg, meta: meta(pkg, { counts: { sections: 1.5, questions: 0 } }) }), TypeError);
});

// 크롭: F#/G# 바이트 왕복. 잘못된 식별자와 비-Uint8Array는 거절한다.
test("crops roundtrip and bad crop ids throw", async () => {
  const store = await createStore(memoryAdapter());
  const pkg = "Lp7-000000";
  const f1 = new Uint8Array([9, 8, 7]), g12 = new Uint8Array([6]);
  await Lib.saveResult(store, { packageId: pkg, meta: meta(pkg), note: NOTE, crops: { F1: f1, G12: g12 } });

  const got = await Lib.crops(store, pkg);
  assert.deepEqual(got.F1, f1);
  assert.deepEqual(got.G12, g12);
  assert.deepEqual(await Lib.crops(store, "다른pkg"), {});

  for (const id of ["H1", "F", "F1234567", "f1", "G-2"]) {
    await assert.rejects(() => Lib.saveResult(store, { packageId: pkg, meta: meta(pkg), crops: { [id]: new Uint8Array(1) } }), TypeError);
  }
  await assert.rejects(() => Lib.saveResult(store, { packageId: pkg, meta: meta(pkg), crops: { F1: [1, 2] } }), TypeError);
});

// 목록은 updatedAt 최신순. 복호화가 안 되는 메타는 건너뛰고 나머지를 돌려준다.
test("list is newest-first and skips a corrupted meta", async () => {
  const adapter = memoryAdapter(), store = await createStore(adapter);
  await Lib.saveResult(store, { packageId: "Lo1-111111", meta: meta("Lo1-111111"), note: NOTE }, at("2026-10-01T00:00:00Z"));
  await Lib.saveResult(store, { packageId: "Lo3-333333", meta: meta("Lo3-333333"), note: NOTE }, at("2026-10-03T00:00:00Z"));
  await Lib.saveResult(store, { packageId: "Lo2-222222", meta: meta("Lo2-222222"), note: NOTE }, at("2026-10-02T00:00:00Z"));

  // 어댑터로 직접 쓴 깨진 레코드 — 복호화에 실패해 목록에서 빠진다
  await adapter.put("packages", "b0rked:meta", { v: 1, schemaVersion: 1, iv: new Uint8Array(12), ct: new Uint8Array(4) });
  assert.deepEqual((await Lib.list(store)).map(m => m.packageId), ["Lo3-333333", "Lo2-222222", "Lo1-111111"]);
});

// 삭제: `<pkg>:` 접두어 레코드를 packages·blobs 양쪽에서 지우고 개수를 돌려준다. "pkg10"은 남는다.
test("remove deletes every prefixed record but not a same-prefix package", async () => {
  const adapter = memoryAdapter(), store = await createStore(adapter);
  await Lib.saveResult(store, { packageId: "pkg1", meta: meta("pkg1"), input: INPUT, note: NOTE, crops: { F1: new Uint8Array(1) } });
  // background-job의 파생물(sd·tr·gaps)과 파이프라인 단계 캐시(s:<hash>)도 같은 접두어다
  await store.putJson("packages", "pkg1:sd:1", { s: 1 });
  await store.putJson("packages", "pkg1:tr:0", { t: 0 });
  await store.putJson("packages", "pkg1:gaps", []);
  await store.putJson("packages", "pkg1:s:deadbeef", { value: 1 });
  await Lib.saveResult(store, { packageId: "pkg10", meta: meta("pkg10"), note: NOTE });

  const n = await Lib.remove(store, "pkg1");
  // packages 7개(meta·note·input·sd:1·tr:0·gaps·s:hash) + blobs 1개(crop:F1)
  assert.equal(n, 8);
  assert.equal(await Lib.load(store, "pkg1"), null);
  assert.deepEqual(await Lib.crops(store, "pkg1"), {});
  assert.equal(await store.getJson("packages", "pkg1:sd:1"), null);
  assert.equal(await store.getJson("packages", "pkg1:s:deadbeef"), null);
  assert.equal((await Lib.load(store, "pkg10")).meta.packageId, "pkg10");
});

// 패키지 id: "L" + base36 시작 시각 + "-" + hex 6자. 스토어 id 규칙에 맞고 매번 다르다.
test("packageIdFor makes store-valid fresh ids", async () => {
  const store = await createStore(memoryAdapter());
  const a = Lib.packageIdFor({ host: "lms.example.ac.kr", title: "강의", startedAt: 1759516800000 });
  assert.match(a, /^L[0-9a-z]+-[0-9a-f]{6}$/);
  assert.equal(a.includes("lms"), false); // 호스트·제목은 식별자에 들어가지 않는다
  await store.putJson("packages", Lib.metaId(a), { packageId: a }); // id 규칙에 걸리지 않는다
  assert.notEqual(Lib.packageIdFor({}), Lib.packageIdFor({}));

  const b = Lib.packageIdFor({ startedAt: new Date("2026-10-03T00:00:00Z") });
  assert.equal(b.slice(1).split("-")[0], new Date("2026-10-03T00:00:00Z").getTime().toString(36));
});
