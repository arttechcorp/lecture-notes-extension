// server/auth.js 단위 테스트 — 키와 토큰은 전부 여기서 만들고, getJson 으로 JWKS fetch 를 흉내 낸다.
const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { createAuth } = require("./auth.js");

const SB = "https://proj.supabase.co", SECRET = "jwt-secret-".padEnd(40, "j"), UID = "7b1f3c52-0a4e-4d19-9c8e-5e2a6f1d3b70";
const EC1 = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }), EC2 = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }), RSA1 = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwkOf = (pair, kid) => ({ ...pair.publicKey.export({ format: "jwk" }), kid, use: "sig", alg: pair.publicKey.asymmetricKeyType === "ec" ? "ES256" : "RS256" });
const b64u = x => Buffer.from(typeof x === "string" || Buffer.isBuffer(x) ? x : JSON.stringify(x)).toString("base64url");
function mint({ alg = "ES256", kid = "ec-1", pair = EC1, secret = SECRET, claims = {}, header = {}, now = Math.floor(Date.now() / 1000) } = {}) {
  const p = { sub: UID, aud: "authenticated", role: "authenticated", iss: SB + "/auth/v1", iat: now, exp: now + 3600, ...claims };
  for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
  const data = b64u({ alg, typ: "JWT", ...(kid === null ? {} : { kid }), ...header }) + "." + b64u(p);
  const sig = alg === "HS256" ? crypto.createHmac("sha256", secret).update(data).digest()
    : alg === "ES256" ? crypto.sign("sha256", Buffer.from(data), { key: pair.privateKey, dsaEncoding: "ieee-p1363" })
    : alg === "RS256" ? crypto.sign("sha256", Buffer.from(data), pair.privateKey) : Buffer.alloc(0);
  return data + "." + b64u(sig);
}
const JWKS = { keys: [jwkOf(EC1, "ec-1"), jwkOf(RSA1, "rsa-1")] };
const offline = async () => { throw new Error("getJson must not be called"); };

test("a seeded JWKS (string or object) verifies ES256/RS256 without ever fetching", async () => {
  const auth = createAuth({ url: SB, getJson: offline, jwks: JSON.stringify(JWKS) });
  assert.deepEqual(await auth.verify(mint()), { sub: UID });
  const asObject = createAuth({ url: SB, getJson: offline, jwks: JWKS });
  assert.deepEqual(await asObject.verify(mint({ alg: "RS256", pair: RSA1, kid: "rsa-1" })), { sub: UID });
  // 깨진 JWKS 값은 무시하고 fetch 로 떨어진다.
  let calls = 0;
  const fallback = createAuth({ url: SB, getJson: async () => { calls++; return JWKS; }, jwks: "{broken" });
  assert.deepEqual(await fallback.verify(mint()), { sub: UID });
  assert.equal(calls, 1);
});

test("with a secret, HS256 uses only the secret and ES256/RS256 use only JWKS keys", async () => {
  const auth = createAuth({ url: SB, secret: SECRET, getJson: offline, jwks: JWKS });
  assert.deepEqual(await auth.verify(mint({ alg: "HS256" })), { sub: UID });
  assert.deepEqual(await auth.verify(mint()), { sub: UID });
  assert.deepEqual(await auth.verify(mint({ alg: "RS256", pair: RSA1, kid: "rsa-1" })), { sub: UID });
  // HS256 은 다른 시크릿으로 서명하면 서명 불일치다.
  const wrong = await auth.verify(mint({ alg: "HS256", secret: "other-secret-".padEnd(40, "x") }));
  assert.equal(wrong.code, "unauthorized"); assert.equal(wrong.reason, "signature");
  // ES256 의 서명 자리에 시크릿 HMAC 을 넣어도 시크릿은 절대 쓰지 않는다 — JWKS 키로만 검증해 실패한다.
  const seg = mint().split("."); seg[2] = b64u(crypto.createHmac("sha256", SECRET).update(seg[0] + "." + seg[1]).digest());
  const forged = await auth.verify(seg.join("."));
  assert.equal(forged.code, "unauthorized"); assert.equal(forged.reason, "signature");
});

test("alg confusion: an HS256 token signed with the public key bytes is rejected", async () => {
  const auth = createAuth({ url: SB, getJson: offline, jwks: JWKS });
  const r = await auth.verify(mint({ alg: "HS256", secret: EC1.publicKey.export({ type: "spki", format: "pem" }) }));
  assert.equal(r.code, "unauthorized"); assert.equal(r.reason, "alg");
  // 시크릿이 있어도 공개키 바이트는 시크릿이 아니다.
  const keyed = createAuth({ url: SB, secret: SECRET, getJson: offline, jwks: JWKS });
  const r2 = await keyed.verify(mint({ alg: "HS256", secret: EC1.publicKey.export({ type: "spki", format: "pem" }) }));
  assert.equal(r2.code, "unauthorized"); assert.equal(r2.reason, "signature");
});

test("rejections carry reasons: signature, iss hosts, expired, kid after a failed refresh", async () => {
  const now = Math.floor(Date.now() / 1000);
  const auth = createAuth({ url: SB, getJson: offline, jwks: JWKS });
  let r = await auth.verify(mint({ pair: EC2, kid: "ec-1" }));
  assert.equal(r.code, "unauthorized"); assert.equal(r.reason, "signature");
  r = await auth.verify(mint({ claims: { iss: "https://evil.supabase.co/auth/v1" } }));
  assert.equal(r.code, "unauthorized"); assert.equal(r.reason, "iss");
  assert.deepEqual(r.detail, { expectedHost: "proj.supabase.co", gotHost: "evil.supabase.co" });
  r = await auth.verify(mint({ claims: { exp: now - 60 } }));
  assert.equal(r.code, "token_expired"); assert.equal(r.reason, "expired");
  // 모르는 kid 는 한 번 새로고침하고도 없으면 "kid" 다.
  let calls = 0;
  const rotated = createAuth({ url: SB, getJson: async () => { calls++; return { keys: [jwkOf(EC2, "ec-2")] }; }, jwks: JWKS });
  r = await rotated.verify(mint({ kid: "ec-9" }));
  assert.equal(r.code, "unauthorized"); assert.equal(r.reason, "kid"); assert.equal(calls, 1);
});

test("rejection detail never carries sub, email or token material", async () => {
  const now = Math.floor(Date.now() / 1000);
  const auth = createAuth({ url: SB, getJson: offline, jwks: JWKS });
  const cases = [
    [mint({ claims: { aud: "aud-" + UID } }), "aud"], [mint({ claims: { aud: ["a", "b"] } }), "aud"], [mint({ claims: { aud: undefined } }), "aud"],
    [mint({ claims: { role: "service_role" } }), "role"], [mint({ claims: { iss: "https://evil.supabase.co/auth/v1" } }), "iss"],
    [mint({ claims: { nbf: now + 600 } }), "nbf"], [mint({ claims: { is_anonymous: true } }), "anonymous"], [mint({ claims: { sub: "not-a-uuid" } }), "sub"],
    [mint({ claims: { exp: now - 60 } }), "expired"],
  ];
  for (const [t, reason] of cases) {
    const r = await auth.verify(t);
    assert.equal(r.reason, reason);
    const text = JSON.stringify(r);
    for (const leak of [UID, t]) assert.ok(!text.includes(leak), reason + " 결과에 유출이 없다");
  }
  // aud/role detail 은 받은 문자열을 32자까지 담는다.
  const r = await auth.verify(mint({ claims: { aud: "x".repeat(50) } }));
  assert.equal(r.detail, "x".repeat(32));
});
