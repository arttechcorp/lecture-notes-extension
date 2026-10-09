// 확장과 서버가 공유하는 버전드 계약. 같은 스키마가 LLM strict JSON Schema로도 나가므로
// 모든 객체 스키마는 additionalProperties:false + 전 속성 필수로 유지한다.
(() => {
  const CONTRACT_VERSION = 1;
  const MAX_ERRORS = 20;
  const TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);
  const KEYWORDS = new Set(["type", "properties", "required", "additionalProperties", "enum", "const", "items", "minItems", "maxItems", "minLength", "maxLength", "pattern", "minimum", "maximum"]);
  const patterns = new Map();
  const patternOf = src => { let r = patterns.get(src); if (!r) { r = new RegExp(src, "u"); patterns.set(src, r); } return r; };
  const typeOf = v => Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
  const typeIs = (t, v) => t === "integer" ? Number.isInteger(v) : t === "number" ? Number.isFinite(v) : typeOf(v) === t;
  const equal = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
  const strLen = s => [...s].length;

  // 오탈자 키워드가 검증값과 무관하게 스키마 어디에 있든 즉시 실패시킨다.
  function lint(s) {
    if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error("스키마가 올바르지 않습니다.");
    for (const k of Object.keys(s)) if (!KEYWORDS.has(k)) throw new Error("지원하지 않는 스키마 키워드: " + k);
    if (s.additionalProperties !== undefined && s.additionalProperties !== false) throw new Error("additionalProperties는 false만 지원합니다.");
    for (const t of [].concat(s.type || [])) if (!TYPES.has(t)) throw new Error("알 수 없는 타입: " + t);
    for (const p of Object.values(s.properties || {})) lint(p);
    if (s.items) lint(s.items);
  }

  function check(s, v, path, errors) {
    if (errors.length >= MAX_ERRORS) return;
    const fail = (p, m) => { if (errors.length < MAX_ERRORS) errors.push({ path: p, message: m }); };
    if (s.type !== undefined && ![].concat(s.type).some(t => typeIs(t, v))) {
      fail(path, "타입이 다릅니다: " + [].concat(s.type).join("|"));
      return;
    }
    if (Object.hasOwn(s, "const") && !equal(v, s.const)) fail(path, "값이 다릅니다");
    if (s.enum !== undefined && !s.enum.some(e => equal(e, v))) fail(path, "허용된 값이 아닙니다");
    const kind = typeOf(v);
    if (kind === "object") {
      const props = s.properties || {};
      for (const name of s.required || []) if (!Object.hasOwn(v, name)) fail(path + "/" + name, "필수 속성이 없습니다");
      if (s.additionalProperties === false) for (const k of Object.keys(v)) if (!Object.hasOwn(props, k)) fail(path + "/" + k, "허용되지 않는 속성입니다");
      for (const k of Object.keys(props)) {
        if (errors.length >= MAX_ERRORS) return;
        if (Object.hasOwn(v, k)) check(props[k], v[k], path + "/" + k, errors);
      }
    } else if (kind === "array") {
      if (s.minItems !== undefined && v.length < s.minItems) fail(path, "항목이 부족합니다");
      if (s.maxItems !== undefined && v.length > s.maxItems) fail(path, "항목이 너무 많습니다");
      if (s.items) for (let i = 0; i < v.length && errors.length < MAX_ERRORS; i++) check(s.items, v[i], path + "/" + i, errors);
    } else if (kind === "string") {
      if (s.minLength !== undefined && strLen(v) < s.minLength) fail(path, "길이가 부족합니다");
      if (s.maxLength !== undefined && strLen(v) > s.maxLength) fail(path, "길이가 너무 깁니다");
      if (s.pattern !== undefined && !patternOf(s.pattern).test(v)) fail(path, "패턴과 다릅니다");
    } else if (kind === "number" && Number.isFinite(v)) {
      if (s.minimum !== undefined && v < s.minimum) fail(path, "최솟값 미만입니다");
      if (s.maximum !== undefined && v > s.maximum) fail(path, "최댓값을 넘습니다");
    }
  }

  function validate(schema, value) {
    lint(schema);
    const errors = [];
    check(schema, value, "", errors);
    return errors.length ? { ok: false, errors } : { ok: true };
  }
  function assertValid(schema, value, label) {
    const r = validate(schema, value);
    if (r.ok) return value;
    const e = r.errors[0];
    throw new Error(label + " 형식이 올바르지 않습니다: " + e.path + " " + e.message);
  }
  function isStrictCompatible(s) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return false;
    if (s.properties || [].concat(s.type || []).includes("object")) {
      const names = Object.keys(s.properties || {}), req = s.required;
      if (s.additionalProperties !== false || !Array.isArray(req) || req.length !== names.length || !names.every(n => req.includes(n))) return false;
    }
    for (const p of Object.values(s.properties || {})) if (!isStrictCompatible(p)) return false;
    return !s.items || isStrictCompatible(s.items);
  }

  // required를 properties 키에서 파생 — 한쪽만 바꿔 strict가 깨지는 실수를 원천 차단.
  const obj = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
  const arr = (items, maxItems) => ({ type: "array", maxItems, items });
  const str = maxLength => ({ type: "string", maxLength });
  // null 허용은 enum 에도 null 을 넣어야 한다 — enum 은 타입과 무관하게 무조건 검사되므로
  // 그대로 두면 null 이 "허용된 값이 아닙니다"로 걸린다.
  const orNull = s => ({ ...s, type: [].concat(s.type, "null"), ...(s.enum ? { enum: [...s.enum, null] } : {}) });
  const prob = { type: "number", minimum: 0, maximum: 1 };
  const nonneg = { type: "number", minimum: 0 };
  const count = { type: "integer", minimum: 0 };
  const version = { type: "integer", const: CONTRACT_VERSION };
  const bbox = obj({ x: prob, y: prob, w: prob, h: prob });

  // 블록 role 열거는 evidenceItem 도 그대로 쓴다 — 한 목록을 두 곳에 베끼면 어긋난다.
  const blockRole = { type: "string", enum: ["title", "body", "header", "footer", "watermark", "page_number", "figure_label"] };
  // 필기 표시(null 허용 — strict 스키마는 칸을 뺄 수 없어 null=필기 아님): 필기 마스크와 겹치는 블록에 인식 쪽이 true 를 단다(mis-sol-hai §4.2).
  const slideBlock = obj({ id: str(32), text: str(4000), role: blockRole, bbox: orNull(bbox), conf: orNull(prob), ink: orNull({ type: "boolean" }) });
  const slideDoc = obj({
    schemaVersion: version, slideId: str(64), t0: nonneg, t1: nonneg, engine: str(64), model: orNull(str(128)),
    blocks: arr(slideBlock, 400),
    formulas: arr(obj({
      id: str(32), latex: orNull(str(4000)), text: orNull(str(4000)), bbox: orNull(bbox), conf: orNull(prob),
      status: { type: "string", enum: ["verified", "reread", "image", "unverified"] },
    }), 100),
    figures: arr(obj({
      id: str(32), bbox,
      kind: { type: "string", enum: ["table", "chart", "diagram", "photo", "decorative"] },
      title: orNull(str(300)),
      cells: orNull({ type: "array", maxItems: 200, items: arr(str(500), 30) }),
      chartSummary: orNull(str(1000)),
      // 간단한 그래프 판정(§14)에 쓰는 구조화 값 — 비전이 못 읽으면 null 이고 그때는 크롭만 한다.
      chartData: orNull(obj({
        type: { type: "string", enum: ["bar", "line"] },
        categories: arr(str(40), 12),
        series: arr(obj({ name: str(40), values: arr({ type: "number" }, 12) }), 3),
        unit: orNull(str(16)), xLabel: orNull(str(40)), yLabel: orNull(str(40)),
      })),
      conf: orNull(prob),
    }), 50),
  });
  const transcript = obj({
    schemaVersion: version, engine: str(64), model: orNull(str(128)), lang: str(16),
    segments: arr(obj({
      id: str(32), t0: nonneg, t1: nonneg, text: str(4000),
      words: arr(obj({ w: str(100), t0: nonneg, t1: nonneg }), 2000),
      noSpeechProb: orNull(prob), avgLogprob: orNull({ type: "number" }), compressionRatio: orNull(nonneg),
      status: { type: "string", enum: ["kept", "filtered"] },
    }), 20000),
  });
  const unit = obj({
    schemaVersion: version, unitId: str(32), slideId: orNull(str(64)), t0: nonneg, t1: nonneg,
    slideText: str(20000), speech: str(40000),
    features: obj({
      dwell: nonneg, speechChars: count, emphasis: count, deixis: count, repeat: count,
      hasFormula: { type: "boolean" }, hasFigure: { type: "boolean" },
    }),
    judge: obj({ importance: orNull({ type: "number", minimum: 1, maximum: 5 }), lectureProb: orNull(prob) }),
  });
  // 요약 블록이 인용하는 단위별 근거 조각. id 의 s/t/g 접미사는 kind 와 짝을 이룬다.
  const evidenceItem = obj({
    id: { type: "string", pattern: "^U[0-9]{1,4}\\.[stg][0-9]{1,4}$" },
    unitId: { type: "string", pattern: "^U[0-9]{1,4}$" },
    kind: { type: "string", enum: ["slide", "speech", "figure", "handwriting"] },
    t0: nonneg, t1: nonneg,
    slideId: orNull(str(64)),
    sourceId: str(64),
    role: orNull(blockRole),
    text: { type: "string", minLength: 1, maxLength: 4000 },
  });
  const judgeResult = obj({
    itemId: str(64),
    task: { type: "string", enum: ["utterance", "importance", "boilerplate", "figure", "support"] },
    probs: arr(obj({ label: str(64), p: prob }), 255),
    score: orNull({ type: "number" }),
    // 판정 확신 — Jev 답의 confidence, noul 은 |2p-1|, logprob 경로는 null 이다.
    confidence: orNull(prob), model: str(128),
  });
  const errorEnvelope = obj({
    error: obj({
      code: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
      message: str(300), retryable: { type: "boolean" }, retryAfterMs: orNull(count),
    }),
  });

  const freeze = o => { for (const v of Object.values(o)) if (v && typeof v === "object") freeze(v); return Object.freeze(o); };
  const SCHEMAS = freeze({ bbox, slideDoc, transcript, unit, evidenceItem, judgeResult, errorEnvelope });
  // 제공자는 strict json_schema 의 pattern·길이·개수 같은 제약을 강제하지 않는다. 스키마에 어긋난 출력 전체를 버리지 않고
  // 어긋난 가장 바깥 null 허용 칸은 null 로, 배열은 어긋난 항목만 빼서 살린다 — 블록 하나가 섹션 하나를 죽이지 않게(빈 블록은 호출자가 repair 한다).
  // 고친 개수를 돌려준다. 결과가 여전히 어긋나면(필수 칸 등) 호출자가 검사에서 거절한다.
  function salvage(schema, value) {
    let n = 0;
    // 안쪽부터 고친다: 어긋난 가장 깊은 null 허용 칸만 null, 배열은 고쳐도 안 맞는 항목만 뺀다. 고친 결과도 안 맞을 때만 이 칸 전체를 null 로 —
    // 필드: 블록 안 한 칸(설명·인용 번호 하나)의 형식 오류로 블록이 통째로 비고, repair 도 그 블록을 한 번도 살리지 못했다.
    const walk = (sc, v) => {
      if (check1(sc, v)) return v;
      let out = v;
      if (Array.isArray(v) && sc.items) {
        const fixed = v.map(x => walk(sc.items, x)), kept = fixed.filter(x => check1(sc.items, x));
        n += v.length - kept.length; out = kept;
        if (sc.maxItems != null && out.length > sc.maxItems) { n++; out = out.slice(0, sc.maxItems); }
      } else if (v && typeof v === "object" && !Array.isArray(v) && sc.properties) out = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sc.properties[k] ? walk(sc.properties[k], x) : x]));
      if (out !== v && check1(sc, out)) return out;
      if ([].concat(sc.type).includes("null")) { n++; return null; }
      return out;
    };
    const check1 = (sc, v) => { const e = []; check(sc, v, "", e); return !e.length; };
    lint(schema);
    return { value: walk(schema, value), fixed: n };
  }
  const api = { CONTRACT_VERSION, SCHEMAS, validate, assertValid, isStrictCompatible, salvage };
  globalThis.Contracts = api;
  if (typeof module !== "undefined") module.exports = api;
})();
