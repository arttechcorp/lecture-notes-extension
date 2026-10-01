// 진단 내보내기: 로컬 이벤트 로그를 운영자 공개키로만 읽을 수 있는 묶음으로 암호화한다.
// 개인키는 오프라인(tools/decrypt-diagnostic.mjs)에만 있고, 이 파일은 공개키만 다룬다 — WebCrypto만 쓰고 Node 전용 API는 쓰지 않는다.
(() => {
  const ALG = "ECDH-ES+HKDF-SHA256+A256GCM";
  const INFO = "summrizei-diagnostic-v1";
  const MAX_PLAIN = 16 * 1024 * 1024;
  const KID_RE = /^[A-Za-z0-9._:-]+$/, B64URL_RE = /^[A-Za-z0-9_-]+$/;
  const FORMAT_ERR = "진단 파일 형식이 올바르지 않습니다.";
  const DECRYPT_ERR = "진단 파일을 복호화할 수 없습니다. 키가 맞지 않거나 파일이 손상되었습니다.";
  const encode = v => new TextEncoder().encode(v);
  const sub = () => globalThis.crypto.subtle;
  const isObj = x => x !== null && typeof x === "object" && !Array.isArray(x);

  // 운영자가 `node tools/decrypt-diagnostic.mjs --generate-keypair <dir>`의 출력(kid + 공개 JWK)을 채운다.
  // 최신이 마지막 — 키 회전은 한 줄 추가뿐이고, 새 내보내기는 마지막 항목만 쓴다.
  const OPERATOR_KEYS = [];

  // lib/events.js의 PipelineEvents.FIELDS 사본 — 동기화 깨짐은 테스트가 대조해 잡는다.
  const EVENT_FIELDS = ["ts","jobId","traceId","spanId","parentSpanId","stage","unit","status","ms","bytes","model","costUsd","code","level","msg"];
  const FIELD_SET = new Set(EVENT_FIELDS);

  // 확장 페이지에는 Node 바이너리 기본형이 없어 btoa/atob로 간다. 큰 배열을 한 번에 펼치지 않게 8192바이트씩 나눈다.
  function b64(data) {
    let s = "";
    for (let i = 0; i < data.length; i += 8192) s += String.fromCharCode(...data.subarray(i, i + 8192));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64(s) {
    // 패딩이 없는 입력을 엄격하게 처리하는 환경도 있어 =를 직접 채운다.
    return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), x => x.charCodeAt(0));
  }

  async function exportBundle(events, { publicJwk, kid, now = Date.now() } = {}) {
    if (publicJwk === undefined) {
      const entry = OPERATOR_KEYS[OPERATOR_KEYS.length - 1];
      if (!entry) throw new Error("진단 파일을 암호화할 운영자 키가 설정되어 있지 않습니다. 지원팀에 문의해 주세요.");
      publicJwk = entry.publicJwk; kid = entry.kid;
    }
    if (typeof kid !== "string" || !kid || kid.length > 128 || !KID_RE.test(kid)) throw new TypeError("운영자 키 식별자(kid)가 올바르지 않습니다.");
    // 개인키 자료가 이 경로로 들어오면 안 된다 — 확장은 공개키만 다룬다.
    if (isObj(publicJwk) && "d" in publicJwk) throw new Error("공개키가 아닌 개인키가 전달되었습니다.");
    if (!isObj(publicJwk) || publicJwk.kty !== "EC" || publicJwk.crv !== "P-256" ||
        typeof publicJwk.x !== "string" || typeof publicJwk.y !== "string")
      throw new TypeError("운영자 공개키 형식이 올바르지 않습니다.");
    if (!Array.isArray(events)) throw new TypeError("보낼 진단 이벤트 목록이 배열이 아닙니다.");
    if (!Number.isFinite(now)) throw new TypeError("내보내기 시각이 올바르지 않습니다.");
    // 허용 필드·스칼라 값만 통과시킨다 — 전사·슬라이드 텍스트 같은 강의 내용이 이 경로로 새지 않게 한다.
    for (const e of events) {
      if (!isObj(e)) throw new TypeError("진단 이벤트는 평범한 객체여야 합니다.");
      for (const key of Object.keys(e)) {
        if (!FIELD_SET.has(key)) throw new TypeError("진단 파일에 허용되지 않은 필드가 있습니다: " + key);
        const v = e[key];
        if (!(v === null || v === undefined || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))))
          throw new TypeError("진단 파일에는 문자열과 숫자 값만 담을 수 있습니다: " + key);
      }
    }
    const plain = encode(JSON.stringify(events));
    if (plain.length > MAX_PLAIN) throw new Error("진단 파일이 너무 큽니다. 더 최근 로그만 내보내 주세요.");

    const s = sub();
    // 곡선 위에 없는 점 등 깨진 키는 WebCrypto의 영문 오류 대신 한국어 오류로 알린다.
    const operatorKey = await s.importKey("jwk", { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y }, { name: "ECDH", namedCurve: "P-256" }, false, [])
      .catch(() => { throw new Error("운영자 공개키를 불러올 수 없습니다."); });
    const pair = await s.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const epkRaw = new Uint8Array(await s.exportKey("raw", pair.publicKey));
    const epkJwk = await s.exportKey("jwk", pair.publicKey);
    const epk = { kty: epkJwk.kty, crv: epkJwk.crv, x: epkJwk.x, y: epkJwk.y };
    const shared = await s.deriveBits({ name: "ECDH", public: operatorKey }, pair.privateKey, 256);
    // salt를 임시 공개키에 묶어 파생 키가 정확히 이 묶음에만 대응하게 한다.
    const salt = new Uint8Array(await s.digest("SHA-256", epkRaw));
    const hkdf = await s.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    const aesKey = await s.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: encode(INFO) }, hkdf, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    // 헤더는 암호문 밖에 있으므로 AAD로 묶어 kid·alg·createdAt 변조를 감지한다.
    const header = { v: 1, kid, alg: ALG, createdAt: now };
    const ct = new Uint8Array(await s.encrypt({ name: "AES-GCM", iv, additionalData: encode(JSON.stringify(header)), tagLength: 128 }, aesKey, plain));
    return { v: 1, kid, alg: ALG, epk, iv: b64(iv), ct: b64(ct), createdAt: now };
  }

  async function decryptBundle(bundle, privateJwk) {
    const ok = isObj(bundle) && bundle.v === 1 && bundle.alg === ALG &&
      typeof bundle.kid === "string" && bundle.kid.length > 0 && bundle.kid.length <= 128 &&
      isObj(bundle.epk) && bundle.epk.kty === "EC" && bundle.epk.crv === "P-256" &&
      typeof bundle.epk.x === "string" && typeof bundle.epk.y === "string" &&
      typeof bundle.iv === "string" && B64URL_RE.test(bundle.iv) &&
      typeof bundle.ct === "string" && B64URL_RE.test(bundle.ct) &&
      Number.isFinite(bundle.createdAt);
    if (!ok) throw new Error(FORMAT_ERR);
    let iv;
    try { iv = unb64(bundle.iv); } catch { iv = null; }
    if (!iv || iv.length !== 12) throw new Error(FORMAT_ERR);
    if (!isObj(privateJwk) || privateJwk.kty !== "EC" || privateJwk.crv !== "P-256" ||
        typeof privateJwk.x !== "string" || typeof privateJwk.y !== "string" || typeof privateJwk.d !== "string")
      throw new Error("개인키 형식이 올바르지 않습니다.");
    // 개인키의 kid는 선택 사항 — 달려 있으면 어느 키로 암호화됐는지를 확인한다.
    if (typeof privateJwk.kid === "string" && privateJwk.kid !== bundle.kid)
      throw new Error("이 진단 파일은 다른 운영자 키로 암호화되었습니다 (kid: " + bundle.kid + ").");
    try {
      const s = sub();
      const priv = await s.importKey("jwk", { kty: privateJwk.kty, crv: privateJwk.crv, x: privateJwk.x, y: privateJwk.y, d: privateJwk.d }, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
      const epk = await s.importKey("jwk", { kty: bundle.epk.kty, crv: bundle.epk.crv, x: bundle.epk.x, y: bundle.epk.y }, { name: "ECDH", namedCurve: "P-256" }, true, []);
      const epkRaw = new Uint8Array(await s.exportKey("raw", epk));
      const shared = await s.deriveBits({ name: "ECDH", public: epk }, priv, 256);
      const salt = new Uint8Array(await s.digest("SHA-256", epkRaw));
      const hkdf = await s.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
      const aesKey = await s.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: encode(INFO) }, hkdf, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
      // 헤더는 암호문에 없으니 묶음의 필드를 같은 순서로 다시 직렬화해 AAD로 쓴다 — 하나라도 다르면 인증에 실패한다.
      const aad = encode(JSON.stringify({ v: bundle.v, kid: bundle.kid, alg: bundle.alg, createdAt: bundle.createdAt }));
      const events = JSON.parse(new TextDecoder().decode(await s.decrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, aesKey, unb64(bundle.ct))));
      if (!Array.isArray(events)) throw new Error("events가 아님");
      return events;
    } catch {
      throw new Error(DECRYPT_ERR);
    }
  }

  const api = { OPERATOR_KEYS, EVENT_FIELDS, ALG, exportBundle, decryptBundle };
  globalThis.Diagnostics = api;
  if (typeof module !== "undefined") module.exports = api;
})();
