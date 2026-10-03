const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Diagnostics = require("./diagnostics.js");

const { EVENT_FIELDS, exportBundle } = Diagnostics;

const sampleEvents = () => [
  { ts: 1700000000000, jobId: "job-01", traceId: "tr-01", spanId: "sp-01", stage: "stt", status: "running", level: "info" },
  { ts: 1700000001234, jobId: "job-01", traceId: "tr-01", spanId: "sp-01", stage: "stt", status: "done", ms: 1234, bytes: 823412, model: "whisper-large-v3-turbo", costUsd: 0.011, level: "info" },
  { ts: 1700000002400, jobId: "job-01", traceId: "tr-01", spanId: "sp-02", parentSpanId: "sp-01", stage: "stt", unit: "u-7", status: "failed", ms: 1100, code: "STT_RATE_LIMIT", level: "error", msg: "한국어 구간 재시도 초과" },
];

// 묶음 형태: 평문 v2 헤더(시각·확장 버전) + 로그 본문 — 더는 암호문 필드가 없다
test("exportBundle wraps events in a plaintext v:2 bundle", async () => {
  const events = sampleEvents();
  const now = 1700000000000;
  const bundle = await exportBundle(events, { now, version: "0.0.0-test" });

  assert.deepEqual(Object.keys(bundle), ["v", "createdAt", "version", "events"]);
  assert.equal(bundle.v, 2);
  assert.equal(bundle.createdAt, now);
  assert.equal(bundle.version, "0.0.0-test");
  assert.deepEqual(bundle.events, events);

  const bare = await exportBundle(events);
  assert.equal(bare.version, null, "버전을 넘기지 않으면 null");
  assert.equal(typeof bare.createdAt, "number");
});

// 출력 이벤트는 허용 필드만 담은 사본 — 상속 프로퍼티도 출력에 나타나지 않고 입력도 건드리지 않는다
test("exportBundle copies only allowed fields and never mutates input", () => {
  const events = sampleEvents();
  const before = JSON.stringify(events);
  const sneaky = Object.create({ transcript: "강의 전사" });
  Object.assign(sneaky, { ts: 1700000003000, stage: "stt", level: "info" });
  const bundle = exportBundle([...events, sneaky]);

  assert.equal(JSON.stringify(events), before);
  const copy = bundle.events.at(-1);
  assert.equal("transcript" in copy, false, "상속된 필드는 허용 목록 검사를 비켜 가도 출력에 나타나지 않는다");
  assert.deepEqual(Object.keys(copy), ["ts", "stage", "level"]);
  copy.stage = "mutated";
  assert.equal(sneaky.stage, "stt", "출력은 사본이라 원본에 영향이 없다");
});

// 내보내기 검증: 필드 허용 목록·스칼라 값·크기 상한·시각
test("exportBundle validates events and now", () => {
  assert.throws(() => exportBundle([{ stage: "stt", text: "슬라이드 본문" }]), /허용되지 않은 필드.*text/);
  assert.throws(() => exportBundle([{ stage: "stt", transcript: "발화 내용" }]), /허용되지 않은 필드.*transcript/);
  assert.throws(() => exportBundle([{ stage: "stt", msg: { nested: 1 } }]), /문자열과 숫자/);
  assert.throws(() => exportBundle([{ stage: "stt", msg: ["a"] }]), /문자열과 숫자/);
  assert.throws(() => exportBundle([{ stage: "stt", ms: NaN }]), /문자열과 숫자/);
  assert.throws(() => exportBundle("not-an-array"), TypeError);
  assert.throws(() => exportBundle({ stage: "stt" }), TypeError);
  assert.throws(() => exportBundle([null]), /평범한 객체/);
  assert.throws(() => exportBundle([["a"]]), /평범한 객체/);
  assert.throws(() => exportBundle(sampleEvents(), { now: NaN }), /시각/);
  assert.throws(() => exportBundle(sampleEvents(), { now: Infinity }), /시각/);

  const big = Array.from({ length: 100 }, () => ({ stage: "stt", msg: "x".repeat(200000) }));
  assert.throws(() => exportBundle(big), /너무 큽니다/);
});

// EVENT_FIELDS ↔ PipelineEvents.FIELDS 동기화 감시
test("EVENT_FIELDS stays in sync with PipelineEvents.FIELDS", () => {
  const eventsPath = path.join(__dirname, "events.js");
  // lib/events.js가 아직 합류하지 않았으면 검사할 대상이 없다.
  if (!fs.existsSync(eventsPath)) return;
  const PipelineEvents = require("./events.js");
  assert.deepEqual(EVENT_FIELDS, PipelineEvents.FIELDS);
});

// 브라우저 안전: Node 전용 기본형·모듈 로더가 소스에 없어야 한다
test("diagnostics.js is browser-safe", () => {
  const src = fs.readFileSync(path.join(__dirname, "diagnostics.js"), "utf8");
  assert.equal(src.includes("Buffer"), false);
  assert.equal(src.includes("require("), false);
});
