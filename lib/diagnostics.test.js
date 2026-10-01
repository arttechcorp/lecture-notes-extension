const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Diagnostics = require("./diagnostics.js");

const { OPERATOR_KEYS, EVENT_FIELDS, ALG, exportBundle, decryptBundle } = Diagnostics;
const DECRYPT_ERR = /복호화할 수 없습니다/;
const FORMAT_ERR = /형식이 올바르지 않습니다/;

async function opKeys() {
  const pair = await globalThis.crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const privateJwk = await globalThis.crypto.subtle.exportKey("jwk", pair.privateKey);
  const { kty, crv, x, y } = privateJwk;
  return { publicJwk: { kty, crv, x, y }, privateJwk };
}

const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
// base64url 문자 하나를 다른 유효 문자로 바꾼다 — 변조 시나리오용.
const flipChar = s => {
  const i = Math.floor(s.length / 2);
  const alt = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".replace(s[i], "")[0];
  return s.slice(0, i) + alt + s.slice(i + 1);
};

const sampleEvents = () => [
  { ts: 1700000000000, jobId: "job-01", traceId: "tr-01", spanId: "sp-01", stage: "stt", status: "running", level: "info" },
  { ts: 1700000001234, jobId: "job-01", traceId: "tr-01", spanId: "sp-01", stage: "stt", status: "done", ms: 1234, bytes: 823412, model: "whisper-large-v3-turbo", costUsd: 0.011, level: "info" },
  { ts: 1700000002400, jobId: "job-01", traceId: "tr-01", spanId: "sp-02", parentSpanId: "sp-01", stage: "stt", unit: "u-7", status: "failed", ms: 1100, code: "STT_RATE_LIMIT", level: "error", msg: "한국어 구간 재시도 초과" },
];

// 왕복: 묶음 형태·키 순서, 본문 비노출, 임시 키 비결정성
test("exportBundle→decryptBundle round trip", async () => {
  const { publicJwk, privateJwk } = await opKeys();
  const events = sampleEvents();
  const now = 1700000000000;
  const bundle = await exportBundle(events, { publicJwk, kid: "op-test", now });

  assert.deepEqual(Object.keys(bundle), ["v", "kid", "alg", "epk", "iv", "ct", "createdAt"]);
  assert.equal(bundle.v, 1);
  assert.equal(bundle.kid, "op-test");
  assert.equal(bundle.alg, ALG);
  assert.equal(bundle.createdAt, now);
  assert.equal(bundle.epk.kty, "EC");
  assert.equal(bundle.epk.crv, "P-256");
  assert.equal(typeof bundle.epk.x, "string");
  assert.equal(typeof bundle.epk.y, "string");
  assert.equal("d" in bundle.epk, false);
  assert.equal(unb64(bundle.iv).length, 12);
  // 이벤트 본문은 암호문 밖 어디에도 보이면 안 된다.
  assert.equal(JSON.stringify(bundle).includes("재시도 초과"), false);
  assert.deepEqual(await decryptBundle(bundle, privateJwk), events);

  const again = await exportBundle(events, { publicJwk, kid: "op-test", now });
  assert.notDeepEqual(again.epk, bundle.epk);
  assert.notEqual(again.iv, bundle.iv);
  assert.notEqual(again.ct, bundle.ct);
  assert.deepEqual(await decryptBundle(again, privateJwk), events);
});

// 변조: ct·iv·epk·절단 모두 인증 실패로 거부
test("tampered bundle fails to decrypt", async () => {
  const { publicJwk, privateJwk } = await opKeys();
  const bundle = await exportBundle(sampleEvents(), { publicJwk, kid: "op-test" });
  await assert.rejects(() => decryptBundle({ ...bundle, ct: flipChar(bundle.ct) }, privateJwk), DECRYPT_ERR);
  await assert.rejects(() => decryptBundle({ ...bundle, iv: flipChar(bundle.iv) }, privateJwk), DECRYPT_ERR);
  const other = await opKeys();
  await assert.rejects(() => decryptBundle({ ...bundle, epk: other.publicJwk }, privateJwk), DECRYPT_ERR);
  await assert.rejects(() => decryptBundle({ ...bundle, ct: bundle.ct.slice(0, -4) }, privateJwk), DECRYPT_ERR);
});

// 다른 운영자 키로는 열 수 없다
test("wrong operator private key cannot decrypt", async () => {
  const a = await opKeys(), b = await opKeys();
  const bundle = await exportBundle(sampleEvents(), { publicJwk: a.publicJwk, kid: "op-a" });
  await assert.rejects(() => decryptBundle(bundle, b.privateJwk), DECRYPT_ERR);
});

// AAD: kid·createdAt은 인증에 묶이고, alg·누락 멤버는 형식 오류다
test("AAD fields and kid are authenticated", async () => {
  const { publicJwk, privateJwk } = await opKeys();
  const events = sampleEvents();
  const bundle = await exportBundle(events, { publicJwk, kid: "op-a", now: 1700000000000 });

  await assert.rejects(() => decryptBundle({ ...bundle, kid: "op-b" }, privateJwk), DECRYPT_ERR);
  await assert.rejects(() => decryptBundle({ ...bundle, createdAt: bundle.createdAt + 1 }, privateJwk), DECRYPT_ERR);
  await assert.rejects(() => decryptBundle({ ...bundle, alg: "AES-GCM" }, privateJwk), FORMAT_ERR);

  await assert.rejects(() => decryptBundle(bundle, { ...privateJwk, kid: "op-b" }), /다른 운영자 키/);
  assert.deepEqual(await decryptBundle(bundle, { ...privateJwk, kid: "op-a" }), events);

  const { ct, ...missing } = bundle;
  await assert.rejects(() => decryptBundle(missing, privateJwk), FORMAT_ERR);
});

// 내보내기 검증: 필드 허용 목록·스칼라 값·운영자 키·크기 상한
test("exportBundle validates events and operator key", async () => {
  const { publicJwk, privateJwk } = await opKeys();
  const kid = "op-test";

  await assert.rejects(() => exportBundle([{ stage: "stt", text: "슬라이드 본문" }], { publicJwk, kid }), /허용되지 않은 필드.*text/);
  await assert.rejects(() => exportBundle([{ stage: "stt", transcript: "발화 내용" }], { publicJwk, kid }), /허용되지 않은 필드.*transcript/);
  await assert.rejects(() => exportBundle([{ stage: "stt", msg: { nested: 1 } }], { publicJwk, kid }), /문자열과 숫자/);
  await assert.rejects(() => exportBundle([{ stage: "stt", msg: ["a"] }], { publicJwk, kid }), /문자열과 숫자/);
  await assert.rejects(() => exportBundle("not-an-array", { publicJwk, kid }), TypeError);
  await assert.rejects(() => exportBundle({ stage: "stt" }, { publicJwk, kid }), TypeError);

  await assert.rejects(() => exportBundle(sampleEvents(), { publicJwk: { ...publicJwk, d: privateJwk.d }, kid }), /개인키/);
  await assert.rejects(() => exportBundle(sampleEvents(), { publicJwk }), TypeError);
  // 곡선 위에 없는 점은 WebCrypto 영문 오류가 아니라 한국어 오류로 거부한다.
  await assert.rejects(() => exportBundle(sampleEvents(), { publicJwk: { ...publicJwk, y: publicJwk.x }, kid }), /운영자 공개키/);

  // 운영자가 OPERATOR_KEYS를 실제 키로 채워도 테스트가 깨지지 않게 비우고 시작해 끝에 되돌린다.
  const saved = OPERATOR_KEYS.splice(0);
  try {
    await assert.rejects(() => exportBundle(sampleEvents()), /운영자 키/);
    OPERATOR_KEYS.push({ kid: "op-old", publicJwk: (await opKeys()).publicJwk }, { kid, publicJwk });
    const bundle = await exportBundle(sampleEvents());
    assert.equal(bundle.kid, kid); // 마지막(최신) 항목을 쓴다
    assert.deepEqual(await decryptBundle(bundle, privateJwk), sampleEvents());
  } finally {
    OPERATOR_KEYS.splice(0, OPERATOR_KEYS.length, ...saved);
  }

  const big = Array.from({ length: 100 }, () => ({ stage: "stt", msg: "x".repeat(200000) }));
  await assert.rejects(() => exportBundle(big, { publicJwk, kid }), /너무 큽니다/);
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

// CLI 스모크: 사용법·키 생성·복호화 왕복·오류 경로
test("decrypt-diagnostic.mjs CLI", async () => {
  const cliPath = path.join(__dirname, "..", "tools", "decrypt-diagnostic.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diag-test-"));
  try {
    const run = (...args) => spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });

    const noArgs = run();
    assert.equal(noArgs.status, 2);
    assert.ok(noArgs.stderr.length > 0);

    const keysDir = path.join(tmp, "keys");
    const gen = run("--generate-keypair", keysDir);
    assert.equal(gen.status, 0, gen.stderr);
    const out = JSON.parse(gen.stdout);
    assert.match(out.kid, /^op-\d{6}-[0-9a-f]{8}$/);
    assert.equal(out.publicJwk.kty, "EC");
    assert.equal(out.publicJwk.crv, "P-256");
    assert.equal("d" in out.publicJwk, false);
    const keyFile = path.join(keysDir, "private.jwk.json");
    const keyJson = JSON.parse(fs.readFileSync(keyFile, "utf8"));
    assert.equal(typeof keyJson.d, "string");
    assert.equal(keyJson.kid, out.kid);
    if (process.platform !== "win32") assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);

    // 같은 자리에 다시 생성해도 기존 개인키를 덮어쓰지 않는다.
    const before = fs.readFileSync(keyFile, "utf8");
    const gen2 = run("--generate-keypair", keysDir);
    assert.equal(gen2.status, 1);
    assert.equal(fs.readFileSync(keyFile, "utf8"), before);

    const events = sampleEvents();
    const bundle = await exportBundle(events, { publicJwk: out.publicJwk, kid: out.kid });
    const bundleFile = path.join(tmp, "bundle.json");
    fs.writeFileSync(bundleFile, JSON.stringify(bundle));

    const dec = run(bundleFile, keyFile);
    assert.equal(dec.status, 0, dec.stderr);
    assert.deepEqual(JSON.parse(dec.stdout), events);

    // kid를 뗀 다른 개인키 — kid 불일치가 아니라 복호화 실패 경로를 탄다.
    const keys2 = path.join(tmp, "keys2");
    assert.equal(run("--generate-keypair", keys2).status, 0);
    const wrong = JSON.parse(fs.readFileSync(path.join(keys2, "private.jwk.json"), "utf8"));
    delete wrong.kid;
    const wrongFile = path.join(tmp, "wrong.jwk.json");
    fs.writeFileSync(wrongFile, JSON.stringify(wrong));
    const dec2 = run(bundleFile, wrongFile);
    assert.equal(dec2.status, 1);
    assert.match(dec2.stderr, /복호화/);

    assert.equal(run(path.join(tmp, "nope.json"), keyFile).status, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
