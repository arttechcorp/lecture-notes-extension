// 진단 내보내기: 로컬 이벤트 로그를 평문 JSON 묶음으로 내보낸다.
// 로그는 허용 필드(단계·시간·오류 코드 등 스칼라)만 담아 강의 내용이 애초에 없으므로 별도 암호화는 하지 않는다.
(() => {
  const MAX_PLAIN = 16 * 1024 * 1024;
  const encode = v => new TextEncoder().encode(v);
  const isObj = x => x !== null && typeof x === "object" && !Array.isArray(x);

  // lib/events.js의 PipelineEvents.FIELDS 사본 — 동기화 깨짐은 테스트가 대조해 잡는다.
  const EVENT_FIELDS = ["ts","jobId","traceId","spanId","parentSpanId","stage","unit","status","ms","bytes","model","costUsd","code","level","msg"];
  const FIELD_SET = new Set(EVENT_FIELDS);

  function exportBundle(events, { now = Date.now(), version } = {}) {
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
    if (encode(JSON.stringify(out)).length > MAX_PLAIN) throw new Error("진단 파일이 너무 큽니다. 더 최근 로그만 내보내 주세요.");
    return { v: 2, createdAt: now, version: version ?? null, events: out };
  }

  const api = { EVENT_FIELDS, exportBundle };
  globalThis.Diagnostics = api;
  if (typeof module !== "undefined") module.exports = api;
})();
