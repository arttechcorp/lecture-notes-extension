// 진단 내보내기: 로컬 이벤트 로그와 환경 정보를 평문 JSON 묶음으로 내보낸다.
// 로그는 허용 필드(단계·시간·오류 코드 등 스칼라)만, 환경 정보는 ENV_KEYS 허용 키만 담는다 —
// 강의 내용·토큰·PIN이 이 묶음에 애초에 없으므로 별도 암호화는 하지 않는다.
(() => {
  const MAX_PLAIN = 16 * 1024 * 1024;
  const encode = v => new TextEncoder().encode(v);
  const isObj = x => x !== null && typeof x === "object" && !Array.isArray(x);

  // lib/events.js의 PipelineEvents.FIELDS 사본 — 동기화 깨짐은 테스트가 대조해 잡는다.
  const EVENT_FIELDS = ["ts","jobId","traceId","spanId","parentSpanId","requestId","stage","unit","status","ms","bytes","model","costUsd","code","level","msg"];
  const FIELD_SET = new Set(EVENT_FIELDS);

  // env 묶음의 섹션 → 허용 키. 여기 없는 키(토큰·PIN·임의 설정·강의 내용)는 검증이 걸러 낸다.
  const ENV_KEYS = Object.freeze({
    app: Object.freeze(["version","extensionId","installType"]),
    browser: Object.freeze(["userAgent","platform","language","languages","timeZone","utcOffsetMin","hardwareConcurrency","deviceMemory","webgpu","online"]),
    storage: Object.freeze(["usageBytes","quotaBytes","persisted"]),
    permissions: Object.freeze(["permissions","origins"]),
    settings: Object.freeze(["ocrEngine","whisperModel","whisperLang","sttModel","visionModel","backgroundMode","remoteSummaryConsent","visionConsent","visionConsentVersion","backgroundConsentVersion","serviceHost","libraryPinSet"]),
    auth: Object.freeze(["signedIn","userId","tokenExpiresInSec"]),
    server: Object.freeze(["ok","ms","code","httpStatus","plan","minutesUsed","minutesLimit","currentPeriodEnd","cancelAtPeriodEnd"]),
    logs: Object.freeze(["count","firstTs","lastTs"]),
  });
  const envValue = v => v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 300)
    || (Array.isArray(v) && v.length <= 64 && v.every(x => typeof x === "string" && x.length <= 300));

  // 환경 정보도 이벤트와 같은 규칙이다: 허용 섹션·키의 스칼라 값(또는 문자열 배열)만 통과시킨다.
  function checkEnv(env) {
    if (!isObj(env)) throw new TypeError("진단 환경 정보는 평범한 객체여야 합니다.");
    for (const section of Object.keys(env)) {
      const keys = ENV_KEYS[section];
      if (!keys) throw new TypeError("진단 파일에 허용되지 않은 환경 섹션이 있습니다: " + section);
      const part = env[section];
      if (!isObj(part)) throw new TypeError("진단 환경 섹션은 평범한 객체여야 합니다: " + section);
      for (const key of Object.keys(part)) {
        if (!keys.includes(key)) throw new TypeError("진단 파일에 허용되지 않은 환경 키가 있습니다: " + section + "." + key);
        if (!envValue(part[key])) throw new TypeError("진단 파일의 환경 값 형식이 올바르지 않습니다: " + section + "." + key);
      }
    }
  }

  function exportBundle(events, { now = Date.now(), version, env = null } = {}) {
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
    const out = events.map(e => ({ ...e }));
    let envOut = null;
    if (env !== null && env !== undefined) {
      checkEnv(env);
      envOut = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, { ...v }]));
    }
    if (encode(JSON.stringify({ env: envOut, events: out })).length > MAX_PLAIN) throw new Error("진단 파일이 너무 큽니다. 더 최근 로그만 내보내 주세요.");
    return { v: 3, createdAt: now, version: version ?? null, env: envOut, events: out };
  }

  const api = { EVENT_FIELDS, ENV_KEYS, exportBundle };
  globalThis.Diagnostics = api;
  if (typeof module !== "undefined") module.exports = api;
})();
