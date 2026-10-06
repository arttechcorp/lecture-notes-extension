// docs/note-contract.md 의 실행 계약. 문서와 어긋나면 이 파일과 테스트가 기준이다(§0).
// 스키마는 Contracts 의 strict 규칙을 지킨다(객체는 additionalProperties:false + 전 속성 필수, 생략은 null).
// schemas.note 는 공급자에 보내지 않아 strict 호환이 필요 없다 — content 는 빈 스키마로 두고 type 별 슬롯을 코드가 검증한다(§8.5).
(() => {
  const need = (name, path) => globalThis[name] || (typeof require !== "undefined" ? require(path) : null);
  const Contracts = need("Contracts", "./contracts.js");
  const Verify = need("Verify", "./verify.js");
  const Formulas = need("Formulas", "./formulas.js");

  const NOTE_SPEC_VERSION = "lecture-note-2";
  const NOTE_SCHEMA_VERSION = 1;
  // §18: 가상 사례와 강의 밖 보강은 노트 생성 옵션이다(lecture-note-2). POLICY 는 기본값(둘 다 꺼짐)이고,
  // 켜는 것은 요청별 policy 다 — 서버가 계정 기능(augment)으로 막는다. 꺼진 항목의 basis 는 출력 스키마에서 빠져 모델이 만들 수 없다.
  const POLICY = { externalAugmentation: false, syntheticExamples: false };
  const AUG = { synthetic: "syntheticExamples", external: "externalAugmentation" };
  const policyOf = p => ({ externalAugmentation: p?.externalAugmentation === true, syntheticExamples: p?.syntheticExamples === true });

  // §9 표: 작성자와 권장량. 권장량은 경고·조판 힌트용이지 내용을 자르는 상한이 아니다(§8.1).
  const TYPES = {
    B01: { name: "강의 머리", writer: "code", advice: null },
    B02: { name: "한눈에", writer: "global", advice: { items: 3, claimChars: 180 } },
    B03: { name: "강의 지도", writer: "global|section", advice: { nodes: 7 } },
    B04: { name: "단원 헤더", writer: "planner+section", advice: null },
    B05: { name: "개념 설명", writer: "section", advice: { chars: 600 } },
    B06: { name: "공통 축 비교", writer: "section", advice: { entities: 3, criteria: 6 } },
    B07: { name: "논리 연결", writer: "section", advice: { steps: 5 } },
    B08: { name: "사례와 적용", writer: "section", advice: null },
    B09: { name: "자료 읽기", writer: "section", advice: null },
    B10: { name: "수식·표·그래프", writer: "section", advice: null },
    B11: { name: "헷갈리기 쉬운 점", writer: "section", advice: { perSection: 2 } },
    B12: { name: "곁설명", writer: "section", advice: { chars: 140 } },
    B13: { name: "연결 정리", writer: "global|section", advice: { propositions: 5 } },
    B14: { name: "자기 점검", writer: "section", advice: { questions: 8 } },
    B15: { name: "정답과 해설", writer: "code", advice: null },
    B16: { name: "필기 공간", writer: "code", advice: null },
    B17: { name: "확인 필요·정정", writer: "section+code", advice: null },
    B18: { name: "수업 공지", writer: "section", advice: null },
  };
  const SECTION_TYPES = ["B03", "B05", "B06", "B07", "B08", "B09", "B10", "B11", "B12", "B13", "B14", "B18"];
  const GLOBAL_TYPES = ["B02", "B03", "B13"];
  const WRITER_TYPES = [...new Set([...SECTION_TYPES, ...GLOBAL_TYPES])].sort();

  // §4 ID 체계. blockId·계산 참조는 모델이 지어내지 않고 정규화에서 코드가 위치로 부여한다.
  const IDS = {
    unit: "^U[0-9]{1,4}$",
    evidence: "^U[0-9]{1,4}\\.[stg][0-9]{1,4}$",
    formula: "^F[0-9]{1,6}$",
    figure: "^G[0-9]{1,4}$",
    concept: "^C[0-9]{1,3}$",
    section: "^S[0-9]{1,3}$",
    block: "^(S[0-9]{1,3}_B[0-9]{1,2}|GB[0-9])$",
    secBlock: "^S[0-9]{1,3}_B[0-9]{1,2}$",
    ref: "^(U[0-9]{1,4}\\.[stg][0-9]{1,4}|(S[0-9]{1,3}_B[0-9]{1,2}|GB[0-9])\\.[ic][0-9]{1,2})$",
    target: "^(S[0-9]{1,3}|S[0-9]{1,3}_B[0-9]{1,2}|GB[0-9]|C[0-9]{1,3}|S[0-9]{1,3}_B[0-9]{1,2}/P[1-6])$",
    localRef: "^[ic][0-9]{1,2}$",
    nodeKey: "^n[0-9]{1,2}$",
    code: "^[A-Z][A-Z0-9_]{1,63}$",
  };

  // contracts.js 와 같은 규칙: required 를 properties 키에서 파생해 strict 호환을 지킨다.
  const obj = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
  const arr = (items, maxItems, minItems = 0) => ({ type: "array", minItems, maxItems, items });
  const str = n => ({ type: "string", minLength: 1, maxLength: n });
  const orNull = s => ({ ...s, type: [].concat(s.type, "null") });
  const pat = source => ({ type: "string", pattern: source });
  const en = values => ({ type: "string", enum: values });
  const nonneg = { type: "number", minimum: 0 };
  const s64 = { type: "string", maxLength: 64 };
  const refId = pat(IDS.ref), evId = pat(IDS.evidence), targetId = pat(IDS.target);

  // §6 주장: 검증의 최소 단위. synthetic·external 은 생성 옵션을 켠 요청에서만 출력 스키마에 남는다(restrictBasis).
  const BASIS = ["lecture", "derived", "pedagogical", "synthetic", "external"];
  const claim = obj({ text: str(600), evidenceIds: arr(refId, 8), basis: en(BASIS) });
  const claimOrNull = orNull(claim);

  const STATUS = en(["supported", "uncertain", "conflicting", "corrected"]);
  const IMPORTANCE = en(["core", "supporting", "reference"]);
  const emphasis = arr(obj({ kind: en(["stress", "exam"]), evidenceIds: arr(evId, 3, 1) }), 2);

  // §9 슬롯(전송 상한). null 은 "강의에서 확인되지 않음 / 해당 없음", 빈 배열은 "항목 없음"이다.
  const content = {
    B02: obj({
      question: claimOrNull, mode: en(["conclusions", "issues"]),
      items: arr(obj({ claim, reason: claimOrNull, targetIds: arr(targetId, 4, 1) }), 3, 1),
    }),
    B03: obj({
      title: str(80),
      nodes: arr(obj({ key: pat(IDS.nodeKey), label: str(40), targetId: orNull(targetId) }), 12, 2),
      edges: arr(obj({
        from: pat(IDS.nodeKey), to: pat(IDS.nodeKey),
        relation: en(["includes", "part_of", "example_of", "precedes", "contrasts", "causes", "supports", "complements"]),
        claim: claimOrNull,
      }), 16, 1),
    }),
    B05: obj({
      conceptId: pat(IDS.concept), term: str(60), original: orNull(str(80)),
      definition: claim, explanation: claimOrNull, mechanism: claimOrNull,
      scope: arr(claim, 4), examples: arr(claim, 3),
    }),
    B06: obj({
      title: str(80),
      entities: arr(obj({ label: str(40), conceptId: orNull(pat(IDS.concept)) }), 6, 2),
      criteria: arr(obj({ label: str(40), cells: arr(claimOrNull, 6, 2) }), 12, 1),
      common: arr(claim, 4), discriminator: claimOrNull,
    }),
    B07: obj({
      title: str(80), relationType: en(["causal", "argument", "process", "history"]), question: claimOrNull,
      steps: arr(obj({
        role: en(["premise", "value_premise", "evidence", "reason", "claim", "counter", "condition", "step", "event", "result"]),
        claim,
      }), 8, 2),
      missingLinks: arr(claim, 3),
    }),
    B08: obj({
      caseTitle: str(80), source: en(["lecture_case", "material_case"]), situation: claim,
      points: arr(obj({ clue: claim, reading: claim }), 6, 1),
      appliedConceptIds: arr(pat(IDS.concept), 4),
      judgment: orNull(obj({ pointRefs: arr({ type: "integer", minimum: 1, maximum: 6 }, 6, 1), claim })),
      limits: arr(claim, 3),
      decision: orNull(obj({
        actor: claimOrNull, goal: claimOrNull,
        alternatives: arr(claim, 4), criteria: arr(claim, 4), tradeoffs: arr(claim, 3), missingData: arr(claim, 3),
      })),
    }),
    B09: obj({
      sourceTitle: str(120),
      sourceKind: en(["text", "historical", "philosophical", "literary", "data", "other"]),
      gist: claim,
      quote: orNull(obj({ text: str(150), evidenceIds: arr(evId, 2, 1) })),
      points: arr(obj({ clue: claim, reading: claim }), 6),
      authorClaim: claimOrNull, lecturerReading: claimOrNull, limits: arr(claim, 3),
    }),
    B10: obj({
      title: str(80), kind: en(["formula", "table", "graph", "calc"]), goal: claimOrNull,
      formulaIds: arr(pat(IDS.formula), 6), figureIds: arr(pat(IDS.figure), 3),
      variables: arr(obj({ symbol: str(40), meaning: claim, unit: orNull(str(16)) }), 10),
      assumptions: arr(claim, 5),
      inputs: arr(obj({ label: str(60), value: { type: "number" }, unit: orNull(str(16)), evidenceIds: arr(evId, 4, 1) }), 10),
      steps: arr(obj({
        label: str(60), op: en(["add", "sub", "mul", "div"]),
        a: pat(IDS.localRef), b: pat(IDS.localRef),
        value: { type: "number" }, unit: orNull(str(16)),
        digits: { type: ["integer", "null"], minimum: 0, maximum: 6 },
      }), 8),
      derived: arr(str(400), 4), reading: arr(claim, 6), result: claimOrNull,
      limits: arr(claim, 4), withheld: claimOrNull,
    }),
    B11: obj({
      misconception: claim, correction: claim,
      conditions: arr(claim, 3), origin: en(["lecture_correction", "structural_check"]),
    }),
    B12: obj({ kind: en(["term", "background", "original", "link", "hint"]), note: claim }),
    B13: obj({
      title: str(80),
      propositions: arr(obj({
        relation: en(["common", "contrast", "inclusion", "condition", "complement", "cause", "sequence"]),
        claim, targetIds: arr(targetId, 4, 1),
      }), 5, 1),
    }),
    B14: obj({
      items: arr(obj({
        kind: en(["recall", "distinguish", "apply", "argue", "calc", "interpret", "ox"]),
        prompt: claim, premise: claimOrNull, level: en(["basic", "applied", "advanced"]),
        targetIds: arr(targetId, 3, 1),
        answer: obj({
          verdict: { type: ["string", "null"], enum: ["O", "X", null] },
          explanation: claim, correction: claimOrNull,
          rubric: arr(claim, 5), alternatives: arr(str(200), 3),
          reviewIds: arr(pat(IDS.secBlock), 3, 1),
        }),
      }), 8, 1),
    }),
    B18: obj({
      items: arr(obj({
        topic: en(["exam", "assignment", "deadline", "materials", "request", "other"]),
        claim, due: orNull(str(60)),
      }), 6, 1),
    }),
  };

  // §8.3 확인 항목(B17 콘텐츠용): 계획 단계에서는 충돌을 모르므로 항상 쓸 수 있는 칸으로 둔다.
  const checkSchema = obj({
    kind: en(["recognition_uncertain", "input_conflict", "missing", "correction"]),
    claim, targetIds: arr(pat(IDS.block), 4),
    before: claimOrNull, after: claimOrNull, hold: claimOrNull,
  });

  // 출력 스키마용: 확인 항목의 대상은 그 요청의 계획 블록뿐이다(§10 d 의 plannedIds) — 요청이 아는 id 이므로
  // enum 으로 미리 좁힌다(제공자는 pattern 을 강제하지 않지만 enum 은 강제한다). 빈 enum 은 아무 값도 못 받으므로 내지 않는다.
  // 블록 안의 targetIds·targetId·reviewIds 는 다른 섹션의 계획 블록도 유효한데 요청은 자기 섹션 계획만
  // 들고 온다 — 요청이 allowedRefs(계획 전체의 유효 참조 목록)를 싣고 오면 restrictRefs 가 그 목록의 enum 으로 좁히고,
  // 없으면 패턴 그대로 두고 VAL_REF_UNKNOWN 과 조립 정리가 거른다.
  const checkSchemaFor = ids => (ids?.length
    ? obj({ ...checkSchema.properties, targetIds: arr(en([...new Set(ids)]), 4) })
    : checkSchema);

  // 봉투 스키마의 대상·복습 칸을 요청의 참조 목록 enum 으로 좁힌다. 목록이 빈 칸은 enum 이 아무 값도
  // 못 받으니 두지 않는다 — 코드 검사(VAL_REF_UNKNOWN)가 그대로 걸러낸다. 원본은 얼려 있어 복사본을 고친다.
  // ownId 는 이 봉투의 블록 id — B14 복습 위치는 자기 블록을 가리킬 수 없어서 목록에서 뺀다(한 섹션에 B14 가 여럿이면 블록마다 다르다).
  const restrictRefs = (schema, refs, ownId) => {
    if (!refs) return schema;
    const t = [...new Set(refs.targetIds || [])], r = [...new Set(refs.reviewIds || [])].filter(id => id !== ownId);
    const out = JSON.parse(JSON.stringify(schema));
    (function walk(v) {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object") return;
      const p = v.properties;
      if (p) {
        if (t.length && p.targetIds?.items?.pattern === IDS.target) p.targetIds = { ...p.targetIds, items: en(t) };
        if (t.length && p.targetId?.pattern === IDS.target) p.targetId = { ...p.targetId, enum: [...t, null] };
        if (r.length && p.reviewIds?.items?.pattern === IDS.secBlock) p.reviewIds = { ...p.reviewIds, items: en(r) };
      }
      Object.values(v).forEach(walk);
    })(out);
    return out;
  };

  // 꺼진 생성 옵션의 basis 값을 스키마에서 지운다. 원본 스키마는 얼려 있으므로 복사본을 고친다.
  function restrictBasis(schema, policy = POLICY) {
    const p = policyOf(policy), keep = BASIS.filter(b => !AUG[b] || p[AUG[b]]);
    if (keep.length === BASIS.length) return schema;
    const out = JSON.parse(JSON.stringify(schema));
    (function walk(v) {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object") return;
      if (v.properties?.basis?.enum) v.properties.basis.enum = keep;
      Object.values(v).forEach(walk);
    })(out);
    return out;
  }

  // 영어 강의(sourceLang "en")의 섹션·repair 출력: 모든 주장 객체에 src(같은 주장을 강의의 영어 표현으로 쓴 문장, lecture 가 아니면 null)를 더한다.
  // 근거 지지 판정이 영어 근거와 영어 주장을 비교하게 하려는 칸이다 — 노트 검증·조립 전에 호출자가 뗀다(노트 형식은 그대로).
  function withSource(schema) {
    const out = JSON.parse(JSON.stringify(schema));
    (function walk(v) {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object") return;
      const p = v.properties;
      if (p && Object.keys(p).length === 3 && p.text && p.evidenceIds && p.basis) { p.src = { type: ["string", "null"], maxLength: 600 }; v.required = [...v.required, "src"]; return; }
      Object.values(v).forEach(walk);
    })(out);
    return out;
  }

  // 공통 봉투는 코드가 검증한다(§3.1). content 스키마가 없는 타입(B01·B04·B15·B16·B17)은 Writer 슬롯이 없다.
  function envelopeSchema(type, policy = POLICY) {
    const c = content[type];
    if (!c) throw new Error("내용 스키마가 없는 블록 타입: " + type);
    return restrictBasis(obj({ status: STATUS, importance: IMPORTANCE, emphasis, content: c }), policy);
  }

  // §8.2: Planner 출력과 정규화된 Plan. Plan 은 모델 출력에 blockId·버전·정책을 코드가 붙인 것이다.
  const planBlock = idPattern => obj({
    ...(idPattern ? { blockId: pat(idPattern) } : {}),
    type: en(SECTION_TYPES), purpose: str(200),
    conceptIds: arr(pat(IDS.concept), 6), formulaIds: arr(pat(IDS.formula), 6), figureIds: arr(pat(IDS.figure), 3),
  });
  const planGlobal = idPattern => obj({
    ...(idPattern ? { blockId: pat(idPattern) } : {}),
    type: en(GLOBAL_TYPES), purpose: str(200), conceptIds: arr(pat(IDS.concept), 6),
  });
  const planConcepts = arr(obj({
    conceptId: pat(IDS.concept), name: str(60), homeSectionId: pat(IDS.section), depth: en(["defined", "mentioned"]),
  }), 40);
  const planSection = idPattern => obj({
    sectionId: pat(IDS.section), title: str(80), question: orNull(str(160)),
    stage: en(["understand", "relate", "apply", "check"]),
    unitIds: arr(pat(IDS.unit), 60, 1), crossUnitIds: arr(pat(IDS.unit), 10),
    blocks: arr(planBlock(idPattern), 12, 1),
  });
  const policySchema = obj({ externalAugmentation: { type: "boolean" }, syntheticExamples: { type: "boolean" } });
  const plannerOutput = obj({ concepts: planConcepts, sections: arr(planSection(null), 40, 1), global: arr(planGlobal(null), 3) });
  const planSchema = obj({
    schemaVersion: { type: "integer", const: NOTE_SCHEMA_VERSION },
    noteSpecVersion: { type: "string", const: NOTE_SPEC_VERSION },
    policy: policySchema,
    concepts: planConcepts,
    sections: arr(planSection("^S[0-9]{1,3}_B[0-9]{1,2}$"), 40, 1),
    global: arr(planGlobal("^GB[0-9]$"), 3),
  });

  // §8.5 Note: B01·B04·B15·B16·B17(시스템)은 렌더 시점에 투영하므로 저장하지 않는다.
  const t0t1 = obj({ t0: nonneg, t1: nonneg });
  const noteBlock = obj({
    id: pat(IDS.block), type: en(WRITER_TYPES), sectionId: orNull(pat(IDS.section)),
    status: STATUS, importance: IMPORTANCE, emphasis, content: {},
  });
  const noteSchema = obj({
    schemaVersion: { type: "integer", const: NOTE_SCHEMA_VERSION },
    noteSpecVersion: { type: "string", const: NOTE_SPEC_VERSION },
    promptVersion: orNull(str(32)),
    status: en(["complete", "partial"]), tier: en(["free", "paid"]),
    policy: policySchema,
    meta: obj({
      title: orNull(str(200)), course: orNull(str(200)), lectureDate: orNull(str(40)), session: orNull(str(40)),
      lang: str(16), generatedAt: str(40), processed: t0t1,
    }),
    concepts: arr(obj({
      conceptId: pat(IDS.concept), name: str(60), depth: en(["defined", "mentioned"]),
      homeBlockId: orNull(pat(IDS.block)),
    }), 40),
    global: arr(noteBlock, 3),
    sections: arr(obj({
      sectionId: pat(IDS.section), number: { type: "integer", minimum: 1 },
      title: str(80), question: orNull(str(160)), stage: en(["understand", "relate", "apply", "check"]),
      unitIds: arr(pat(IDS.unit), 60, 1), range: t0t1, gist: claimOrNull,
      blocks: arr(noteBlock, 12, 1), checks: arr(checkSchema, 6),
    }), 40),
    registry: arr(obj({
      id: pat(IDS.formula), latex: orNull({ type: "string", maxLength: 4000 }), text: orNull({ type: "string", maxLength: 4000 }),
      status: en(["verified", "reread", "image", "unverified"]), slideId: str(64), t0: nonneg,
      display: en(["latex", "crop", "check"]),
    }), 1000),
    figures: arr(obj({
      id: pat(IDS.figure), evidenceId: evId, kind: en(["table", "chart", "diagram"]),
      title: orNull(str(300)),
      cells: { type: ["array", "null"], maxItems: 200, items: arr({ type: "string", maxLength: 500 }, 30) },
      chartData: orNull(obj({
        type: en(["bar", "line"]), categories: arr(str(40), 12, 1),
        series: arr(obj({ name: str(40), values: arr({ type: "number" }, 12, 1) }), 3, 1),
        unit: orNull(str(16)), xLabel: orNull(str(40)), yLabel: orNull(str(40)),
      })),
      t0: nonneg, display: en(["table", "chart", "crop", "check"]),
    }), 200),
    sources: arr(obj({ id: evId, kind: en(["slide", "speech", "figure"]), t0: nonneg, t1: nonneg, slideId: orNull(str(64)) }), 20000),
    notices: arr(obj({ code: pat(IDS.code), count: orNull({ type: "integer", minimum: 0 }), ids: orNull(arr(s64, 200)), ranges: orNull(arr(t0t1, 200)) }), 50),
    dropped: arr(obj({ blockId: pat(IDS.block), type: en(WRITER_TYPES), codes: arr(s64, 8, 1) }), 500),
    pruned: arr(obj({ id: s64, codes: arr(s64, 4, 1) }), 500),
    advisories: arr(obj({ code: pat(IDS.code), id: s64 }), 500),
    // 끝내 불명확해서 확정 본문에서 뺀 주장·블록을 데이터로 보존한다(제안서 §4). 렌더는 이 칸을 보지 않는다 —
    // 확정 본문이 아니라 확인 필요 보관이다. claim 단위 보류는 paths+claims(봉투 안 경로와 원래 주장)에,
    // 필수 칸을 건드린 블록 보류는 envelope(보류 당시 봉투 전체)에 남는다 — 정상 조건·사례를 저장 구조에서 파괴하지 않기 위해서다.
    pending: arr(obj({
      blockId: pat(IDS.block), sectionId: orNull(pat(IDS.section)), type: en(WRITER_TYPES),
      paths: arr(s64, 8, 1), claims: arr(claim, 8), envelope: { type: ["object", "null"] },
    }), 200),
  });
  // pending 은 보존용 선택 필드다 — 이전에 저장된 노트에는 없을 수 있어 필수 목록에서 뺀다(읽기 호환, §8.5).
  noteSchema.required = noteSchema.required.filter(k => k !== "pending");

  const schemas = { claim, content, check: checkSchema, plannerOutput, plan: planSchema, note: noteSchema };

  // §3.1: 블록 키는 계획의 blockId 와 정확히 같아야 하므로 출력 스키마를 계획에서 요청마다 만든다.
  const blockProps = (planSection, ids, refs) => {
    const byId = new Map(planSection.blocks.map(b => [b.blockId, b])), props = {};
    for (const id of ids) {
      const b = byId.get(id);
      if (!b) throw new Error("계획에 없는 블록 id: " + id);
      props[id] = orNull(restrictRefs(envelopeSchema(b.type, { externalAugmentation: true, syntheticExamples: true }), refs, id));
    }
    return props;
  };

  // §8.3: { gist: C?, blocks: { <blockId>: Envelope|null }, checks: [Check](0..6) }.
  // gist 는 반으로 나눠 다시 쓸 때 첫 반쪽에만 넣는다(§12.4) — gist:false 로 키 자체를 뺀다.
  // policy 는 요청의 생성 옵션이다. 확인 항목·요지에는 가상·보강이 올 수 없지만 스키마는 같이 줄이고 코드 검사가 막는다.
  // checks 대상은 이 요청 섹션의 계획 블록 전부다 — 나눠 쓰는 조각(blockIds)과 allowedRefs 에 무관하게 ids 에서 만든다.
  function sectionOutputSchemaFor(planSection, { blockIds, gist = true, policy = POLICY, allowedRefs = null } = {}) {
    const ids = (planSection.blocks || []).map(b => b.blockId);
    return restrictBasis(obj({
      ...(gist !== false ? { gist: claimOrNull } : {}),
      blocks: obj(blockProps(planSection, blockIds ?? ids, allowedRefs)),
      checks: arr(checkSchemaFor(ids), 6),
    }), policy);
  }

  // §12.1: 실패한 블록만 키로 갖는다.
  function repairOutputSchemaFor(planSection, blockIds, policy = POLICY, allowedRefs = null) {
    if (!blockIds?.length) throw new Error("재생성할 블록 id가 없습니다.");
    return restrictBasis(obj({ blocks: obj(blockProps(planSection, blockIds, allowedRefs)) }), policy);
  }

  // §8.4: { blocks: { "GB1": Envelope|null, ... } }. 전역 블록에는 가상·보강이 허용되지 않는다.
  // targetIds·targetId 의 유효 집합은 계획 전체(빠진 블록 포함, §8.4) — 요청이 allowedRefs 를 싣고 오면 그 목록으로
  // 좁히고, 없으면 패턴 그대로 두고 VAL_REF_UNKNOWN 과 조립 정리가 거른다.
  const globalOutputSchemaFor = (planGlobal, allowedRefs = null) => obj({
    blocks: obj(Object.fromEntries(planGlobal.map(g => [g.blockId, orNull(restrictRefs(envelopeSchema(g.type), allowedRefs, g.blockId))]))),
  });

  // 유닛의 슬라이드·발화에 나온 숫자 집합 — 단원 제목·질문과 개념 이름은 B04 머리와 개념 색인으로
  // 그대로 노출되는데 Writer 검사를 거치지 않으므로 그 섹션(개념은 홈 섹션) 유닛의 숫자만 쓸 수 있다(§8.2).
  // 정규화의 검사와 보정의 제거가 같은 판정을 쓰게 하려고 한 곳에 둔다.
  const unitNumberIndex = units => new Map(units.map(u => [u.unitId,
    new Set(Verify.numbersOf(`${u.slideText ?? ""}\n${u.speech ?? ""}`, true).flatMap(n => n.values))]));
  const numBad = (unitNums, text, unitIds) =>
    Verify.numbersOf(text).filter(n => !n.values.some(v => unitIds.some(id => unitNums.get(id)?.has(v))));
  const numbersOk = (unitNums, text, unitIds) => !numBad(unitNums, text, unitIds).length;

  // §8.2: Planner 출력을 검사하고 코드가 blockId·버전·정책을 붙여 Plan 을 만든다.
  // 실패는 VAL_PLAN_INVALID 하나다 — 모델 계획은 temp 0 이라 같은 계획 재요청이 소용없어 보정하지 않고 거절한다(보정은 repairPlan).
  // detail 에는 코드·id 만 싣는다(내용 없는 오류, §10).
  function normalizePlan(output, { units = [], formulaUnits = {}, figures = [], policy = POLICY } = {}) {
    const v = Contracts.validate(plannerOutput, output);
    if (!v.ok) return { ok: false, errors: [{ code: "VAL_PLAN_INVALID", detail: v.errors.map(e => "schema:" + e.path) }] };

    const bad = [], flag = m => { if (bad.length < 20) bad.push(m); };
    const ir = new Map(units.map((u, i) => [u.unitId, i]));
    const secs = output.sections;

    secs.forEach((s, i) => { if (s.sectionId !== "S" + (i + 1)) flag("order:" + s.sectionId); });
    const seen = new Set();
    for (const s of secs) {
      if (!s.unitIds.length) flag("empty:" + s.sectionId);
      for (const id of s.unitIds) {
        if (!ir.has(id)) flag("unknown:" + id);
        else if (seen.has(id)) flag("duplicate:" + id);
        seen.add(id);
      }
    }
    for (const u of units) if (!seen.has(u.unitId)) flag("missing:" + u.unitId);

    // 강의 전개를 바꾸지 않는다: 각 섹션의 유닛이 IR 순서로 연속하고 섹션끼리 이어져야 한다.
    let expected = 0;
    for (const s of secs) {
      let broken = false;
      for (const id of s.unitIds) {
        const ix = ir.get(id);
        if (ix === undefined) continue;
        if (ix !== expected) broken = true;
        expected = ix + 1;
      }
      if (broken) flag("order:" + s.sectionId);
    }

    for (const s of secs) for (const id of s.crossUnitIds)
      if (!ir.has(id) || s.unitIds.includes(id)) flag(`cross:${s.sectionId}:${id}`);

    const secIds = new Set(secs.map(s => s.sectionId)), declared = new Set();
    for (const c of output.concepts) {
      if (declared.has(c.conceptId) || !secIds.has(c.homeSectionId)) flag("concept:" + c.conceptId);
      declared.add(c.conceptId);
    }
    const allBlocks = secs.flatMap(s => s.blocks.map((b, i) => ({ ...b, blockId: `${s.sectionId}_B${i + 1}`, sectionId: s.sectionId })));
    for (const b of allBlocks) for (const id of b.conceptIds) if (!declared.has(id)) flag("concept:" + id);
    for (const g of output.global) for (const id of g.conceptIds) if (!declared.has(id)) flag("concept:" + id);

    // defined 개념은 홈 섹션에 그 개념 하나만 다루는 B05 가 정확히 하나 있어야 한다(정의의 단일 기준 위치).
    for (const c of output.concepts) {
      const defs = allBlocks.filter(b => b.type === "B05" && b.conceptIds.includes(c.conceptId));
      const single = defs.length === 1 && defs[0].conceptIds.length === 1 && defs[0].sectionId === c.homeSectionId;
      if (c.depth === "defined" ? !single : defs.length > 0) flag("home:" + c.conceptId);
    }
    for (const b of allBlocks) if (b.type === "B05" && b.conceptIds.length !== 1) flag("home:" + b.blockId);

    // 수식·도표는 그 섹션(교차 유닛 포함)에서 나온 것만 참조할 수 있다.
    const figUnit = new Map(figures.map(f => [f.id, f.unitId]));
    for (const s of secs) {
      const own = new Set([...s.unitIds, ...s.crossUnitIds]);
      for (const b of s.blocks) {
        for (const f of b.formulaIds) if (!(formulaUnits[f] || []).some(u => own.has(u))) flag(`ref:${s.sectionId}:${f}`);
        for (const g of b.figureIds) if (!own.has(figUnit.get(g))) flag(`ref:${s.sectionId}:${g}`);
      }
    }

    for (const s of secs) if (s.blocks[0]?.type === "B12") flag("side:" + s.sectionId + "_B1"); // 곁설명은 앞 블록에 붙는다(§9 B12)

    // 단원 제목·질문과 개념 이름은 B04 머리와 개념 색인으로 그대로 노출되는데 Writer 검사를 거치지 않는다 —
    // 거기 쓴 숫자는 그 섹션(개념은 홈 섹션) 유닛의 슬라이드·발화에 있어야 한다(§8.2).
    const unitNums = unitNumberIndex(units);
    for (const s of secs) if (!numbersOk(unitNums, `${s.title}\n${s.question ?? ""}`, s.unitIds)) flag("number:" + s.sectionId);
    for (const c of output.concepts) {
      const home = secs.find(s => s.sectionId === c.homeSectionId);
      if (home && !numbersOk(unitNums, c.name, home.unitIds)) flag("number:" + c.conceptId);
    }
    const gSeen = new Set();
    for (const g of output.global) { if (gSeen.has(g.type)) flag("global:" + g.type); gSeen.add(g.type); }

    if (bad.length) return { ok: false, errors: [{ code: "VAL_PLAN_INVALID", detail: bad }] };
    const plan = {
      schemaVersion: NOTE_SCHEMA_VERSION, noteSpecVersion: NOTE_SPEC_VERSION, policy: policyOf(policy),
      concepts: output.concepts.map(c => ({ ...c })),
      sections: secs.map(s => ({ ...s, blocks: s.blocks.map((b, i) => ({ blockId: `${s.sectionId}_B${i + 1}`, ...b })) })),
      global: output.global.map((g, i) => ({ blockId: `GB${i + 1}`, ...g })),
    };
    // 정규화 결과가 Plan 스키마를 깨면 모델이 아니라 코드의 버그다.
    if (!Contracts.validate(schemas.plan, plan).ok) throw new Error("normalizePlan 결과가 Plan 스키마를 통과하지 못했습니다.");
    return { ok: true, plan };
  }

  // 제공자는 json_schema 의 pattern 을 강제하지 않아 모델이 개념·섹션 id 를 제멋대로 쓴다(필드 관찰: concepts[0].conceptId 로 4연속 거절).
  // 스키마 검사 전에 개념을 C1.., 섹션을 S1.. 로 차례대로 다시 매기고 참조를 같은 표로 옮긴다. 표에 없는 참조는 그대로 둬 repairPlan 이 뗀다.
  // 작성 출력의 지도 블록(B03) 노드 키도 같은 사정이다(필드: key·from·to 패턴 위반으로 블록이 통째로 비었다).
  // 노드를 n1.. 로 차례대로 다시 매기고 간선의 from·to 를 같은 표로 옮긴다. 표에 없는 간선 끝은 그대로 둬 검증이 거른다. 입력은 바꾸지 않는다.
  // 섹션 출력이면(sectionId) 같은 섹션 블록을 섹션 접두 없이 쓴 참조("B3", "b3")를 "S2_B3" 로 고친다(필드: targetIds 형식 위반 8건, 모양 A9).
  const fixRefs = (node, sectionId) => {
    if (Array.isArray(node)) return node.map(x => fixRefs(x, sectionId));
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, (k === "targetIds" || k === "reviewIds") && Array.isArray(v)
      ? v.map(x => { const m = typeof x === "string" && /^B([0-9]{1,2})$/i.exec(x.trim()); return m ? `${sectionId}_B${+m[1]}` : x; })
      : fixRefs(v, sectionId)]));
  };
  function canonicalMapKeys(output, sectionId = null) {
    if (!output || typeof output !== "object" || !output.blocks || typeof output.blocks !== "object") return output;
    if (sectionId && /^S[0-9]{1,3}$/.test(sectionId)) output = { ...output, blocks: fixRefs(output.blocks, sectionId) };
    const key = v => typeof v === "string" || typeof v === "number" ? String(v) : null;
    const blocks = Object.fromEntries(Object.entries(output.blocks).map(([id, env]) => {
      const c = env?.content;
      if (!c || !Array.isArray(c.nodes)) return [id, env];
      const m = new Map();
      const nodes = c.nodes.map((n, i) => { const k = key(n?.key), nk = "n" + (i + 1); if (k !== null && !m.has(k)) m.set(k, nk); return n && typeof n === "object" ? { ...n, key: nk } : n; });
      const edges = Array.isArray(c.edges) ? c.edges.map(e => e && typeof e === "object" ? { ...e, from: m.get(key(e.from)) ?? e.from, to: m.get(key(e.to)) ?? e.to } : e) : c.edges;
      return [id, { ...env, content: { ...c, nodes, edges } }];
    }));
    return { ...output, blocks };
  }

  function canonicalPlanIds(plan) {
    if (!plan || typeof plan !== "object") return plan;
    const cMap = new Map(), sMap = new Map(), key = v => typeof v === "string" || typeof v === "number" ? String(v) : null;
    const concepts = Array.isArray(plan.concepts) ? plan.concepts.map((c, i) => {
      const k = key(c?.conceptId), id = "C" + (i + 1);
      if (k !== null && !cMap.has(k)) cMap.set(k, id);
      return c && typeof c === "object" ? { ...c, conceptId: id } : c;
    }) : plan.concepts;
    const sections = Array.isArray(plan.sections) ? plan.sections.map((s, i) => {
      const k = key(s?.sectionId), id = "S" + (i + 1);
      if (k !== null && !sMap.has(k)) sMap.set(k, id);
      return s && typeof s === "object" ? { ...s, sectionId: id } : s;
    }) : plan.sections;
    // id 배열은 모양이 틀린 항목을 떼고 상한까지만 둔다(수식·도표 id 를 지어내거나 넘치게 다는 일, 필드 관찰: sections[5].blocks[1].formulaIds 4연속 거절).
    // 존재하지 않는 id 는 모양만 맞으면 남겨 repairPlan 이 섹션 소유 규칙으로 뗀다.
    const cut = (o, k, n) => typeof o[k] === "string" && o[k].length > n ? { [k]: o[k].slice(0, n) } : {}; // 글자 수 상한은 상자 크기라 자른다
    const keep = (a, re, max) => Array.isArray(a) ? a.filter(x => typeof x === "string" && re.test(x)).slice(0, max) : a;
    const ids = a => Array.isArray(a) ? keep(a.map(x => cMap.get(key(x)) ?? x), /^C[0-9]{1,3}$/, 6) : a;
    const blocks = a => Array.isArray(a) ? a.map(b => b && typeof b === "object" ? { ...b, ...cut(b, "purpose", 200), conceptIds: ids(b.conceptIds),
      ...(Array.isArray(b.formulaIds) ? { formulaIds: keep(b.formulaIds, /^F[0-9]{1,6}$/, 6) } : {}),
      ...(Array.isArray(b.figureIds) ? { figureIds: keep(b.figureIds, /^G[0-9]{1,4}$/, 3) } : {}) } : b) : a;
    return {
      ...plan,
      concepts: Array.isArray(concepts) ? concepts.slice(0, 40).map(c => c && typeof c === "object" ? { ...c, ...cut(c, "name", 60), homeSectionId: sMap.get(key(c.homeSectionId)) ?? c.homeSectionId } : c) : concepts,
      sections: Array.isArray(sections) ? sections.map(s => s && typeof s === "object" ? { ...s, ...cut(s, "title", 80), ...cut(s, "question", 160), blocks: blocks(Array.isArray(s.blocks) ? s.blocks.slice(0, 12) : s.blocks), ...(Array.isArray(s.crossUnitIds) ? { crossUnitIds: keep(s.crossUnitIds, /^U[0-9]{1,4}$/, 10) } : {}) } : s) : sections,
      global: blocks(plan.global),
    };
  }

  // §8.2: 스키마는 맞지만 의미 규칙을 깬 계획을 모델을 다시 부르지 않고 코드가 고친다.
  // 입력(plannerOutput 통과본)은 바꾸지 않고 고친 복사본을 돌려준다. fixes 는 id·코드만 싣는다(내용 없음, §10).
  // 고칠 수 없는 계획도 남는다(곁설명 하나뿐인 섹션, 유닛 60개 초과 섹션 등) — 호출자가 normalizePlan 으로 최종 판정한다.
  function repairPlan(output, { units = [], formulaUnits = {}, figures = [] } = {}) {
    const out = JSON.parse(JSON.stringify(output)), fixes = [];
    const fix = m => { if (fixes.length < 40) fixes.push(m); };
    const known = new Set(units.map(u => u.unitId)), secs = out.sections;

    // a. 유닛: 모르는 id·나중 중복을 떼고 IR 순서로 연속하게 다시 배정한다. 강의 전개는 바꾸지 않는다 —
    // 유닛의 섹션은 "잡은 섹션"과 "앞 유닛의 섹션" 중 뒤쪽(단조)이고, 아무도 못 잡은 유닛은 앞 유닛의 섹션(첫 유닛이면 첫 섹션)으로 간다.
    const claim = new Map(), seen = new Set(), ir = new Map(units.map((u, i) => [u.unitId, i]));
    secs.forEach((s, i) => {
      s.unitIds = s.unitIds.filter(id => {
        if (!known.has(id)) { fix("drop-unit:" + id); return false; }
        if (seen.has(id)) { fix("dup-unit:" + id); return false; }
        seen.add(id); claim.set(id, i); return true;
      });
      if (s.unitIds.some((id, j) => j && ir.get(id) < ir.get(s.unitIds[j - 1]))) fix("order:" + s.sectionId);
    });
    const owned = secs.map(() => []);
    let prev = -1;
    for (const u of units) {
      const i = Math.max(claim.get(u.unitId) ?? Math.max(prev, 0), prev);
      owned[i].push(u.unitId); prev = i;
      if (!claim.has(u.unitId)) fix("missing:" + u.unitId);
    }
    secs.forEach((s, i) => { s.unitIds = owned[i]; });
    // 유닛을 잃은 섹션은 버리고 블록은 앞의 남은 섹션(맨 앞이면 다음 섹션)이 흡수한다(12 상한).
    const absorb = new Map(); // 버려진 섹션의 옛 id → 블록을 흡수한 섹션 객체
    let lastKept = -1;
    secs.forEach((s, i) => {
      if (s.unitIds.length) { lastKept = i; return; }
      fix("drop-sec:" + s.sectionId);
      const to = lastKept >= 0 ? lastKept : secs.findIndex((x, j) => j > i && x.unitIds.length);
      if (to < 0) return;
      absorb.set(s.sectionId, secs[to]);
      for (const b of s.blocks) secs[to].blocks.length < 12 ? secs[to].blocks.push(b) : fix("drop-block:" + s.sectionId);
    });
    out.sections = secs.filter(s => s.unitIds.length);

    // b. 섹션 번호를 S1..Sn 으로 다시 매기고 개념 홈을 새 번호로 옮긴다 — 흡수된 섹션의 개념은 흡수한 쪽을 홈으로 삼는다.
    const homeOf = new Map();
    let renum = false;
    out.sections.forEach((s, i) => {
      const id = "S" + (i + 1);
      homeOf.set(s.sectionId, id);
      renum = renum || s.sectionId !== id;
      s.sectionId = id;
    });
    for (const [oldId, to] of absorb) homeOf.set(oldId, to.sectionId);
    if (renum) fix("renumber");
    for (const c of out.concepts) c.homeSectionId = homeOf.get(c.homeSectionId) ?? c.homeSectionId;

    // c. 교차 유닛: 모르거나 자기 섹션의 유닛은 뺀다.
    for (const s of out.sections) {
      const own = new Set(s.unitIds);
      s.crossUnitIds = s.crossUnitIds.filter(id =>
        known.has(id) && !own.has(id) ? true : (fix(`cross-drop:${s.sectionId}:${id}`), false));
    }

    // d. 개념: 나중 중복과 홈이 없는 개념을 정리하고 선언 밖 참조를 지운다.
    const declared = new Set(), secIds = new Set(out.sections.map(s => s.sectionId));
    out.concepts = out.concepts.filter(c => {
      if (declared.has(c.conceptId)) return fix("concept-drop:" + c.conceptId), false;
      declared.add(c.conceptId);
      if (secIds.has(c.homeSectionId)) return true;
      const home = out.sections.find(s => s.blocks.some(b => b.conceptIds.includes(c.conceptId)));
      if (!home) return declared.delete(c.conceptId), fix("concept-drop:" + c.conceptId), false;
      c.homeSectionId = home.sectionId; fix("concept-home:" + c.conceptId); return true;
    });
    const dropUndeclared = ids => ids.filter(id => declared.has(id) || (fix("concept-drop:" + id), false));
    for (const s of out.sections) for (const b of s.blocks) b.conceptIds = dropUndeclared(b.conceptIds);
    for (const g of out.global) g.conceptIds = dropUndeclared(g.conceptIds);

    // e. 정의: B05 는 개념 정확히 하나 — 뒤 개념을 떼고, 비면 섹션에 다른 블록이 있을 때만 버린다.
    const cleanB05 = s => {
      const kept = [];
      s.blocks.forEach((b, i) => {
        if (b.type === "B05" && b.conceptIds.length > 1) { fix(`def-trim:${s.sectionId}_B${i + 1}`); b.conceptIds = b.conceptIds.slice(0, 1); }
        if (b.type === "B05" && !b.conceptIds.length && kept.length + s.blocks.length - i - 1 > 0) fix(`def-drop:${s.sectionId}_B${i + 1}`);
        else kept.push(b);
      });
      s.blocks = kept;
    };
    for (const s of out.sections) cleanB05(s);
    // defined 개념은 홈 섹션에 정의가 정확히 하나 — 넘치는 정의는 버리고(마지막 블록이라 못 버리면 개념 규칙이
    // 없는 중립 타입 B08 로 내리고), 홈에 없으면 홈을 첫 정의의 섹션으로 옮긴다. 정의가 아예 없으면 mentioned 로 내린다.
    for (const c of out.concepts) {
      const defs = out.sections.flatMap(s => s.blocks.map((b, i) => ({ s, b, pos: `${s.sectionId}_B${i + 1}` })))
        .filter(d => d.b.type === "B05" && d.b.conceptIds[0] === c.conceptId);
      if (c.depth === "mentioned") {
        if (!defs.length) continue;
        c.depth = "defined"; fix("promote:" + c.conceptId);
      }
      if (!defs.length) { c.depth = "mentioned"; fix("demote:" + c.conceptId); continue; } // 정의 블록 없는 defined 는 언급으로 내린다
      const keep = defs.find(d => d.s.sectionId === c.homeSectionId) ?? defs[0];
      if (keep.s.sectionId !== c.homeSectionId) { c.homeSectionId = keep.s.sectionId; fix("def-home:" + c.conceptId); }
      for (const d of defs) {
        if (d === keep) continue;
        if (d.s.blocks.length > 1) { d.s.blocks = d.s.blocks.filter(x => x !== d.b); fix("def-drop:" + d.pos); }
        else { d.b.type = "B08"; fix("def-neutral:" + d.pos); }
      }
    }

    // f. 수식·도표는 그 섹션(교차 포함) 유닛에서 나온 것만 남긴다.
    const figUnit = new Map(figures.map(f => [f.id, f.unitId]));
    for (const s of out.sections) {
      const own = new Set([...s.unitIds, ...s.crossUnitIds]);
      for (const b of s.blocks) {
        b.formulaIds = b.formulaIds.filter(f => (formulaUnits[f] || []).some(u => own.has(u)) || (fix(`ref-drop:${s.sectionId}:${f}`), false));
        b.figureIds = b.figureIds.filter(g => own.has(figUnit.get(g)) || (fix(`ref-drop:${s.sectionId}:${g}`), false));
      }
    }

    // g. 첫 블록이 곁설명(B12)이면 첫 비-B12 를 앞으로 댄다 — 전부 B12 면 버릴 수 있을 때까지만 버린다.
    for (const s of out.sections) {
      if (s.blocks[0]?.type !== "B12") continue;
      fix("side:" + s.sectionId);
      const i = s.blocks.findIndex(b => b.type !== "B12");
      if (i > 0) s.blocks.unshift(s.blocks.splice(i, 1)[0]);
      else while (s.blocks.length > 1) s.blocks.shift();
    }

    // h. 제목·질문·개념 이름의 근거 없는 숫자: 질문은 비우고 제목·이름은 숫자 토큰을 지운다(numBad — 정규화와 같은 판정).
    const unitNums = unitNumberIndex(units);
    const strip = (text, unitIds) => {
      let t = String(text).normalize("NFKC");
      for (const n of numBad(unitNums, text, unitIds)) t = t.split(n.raw).join(" ");
      return t.replace(/\s+/g, " ").trim();
    };
    for (const s of out.sections) {
      if (numbersOk(unitNums, `${s.title}\n${s.question ?? ""}`, s.unitIds)) continue;
      fix("number:" + s.sectionId);
      if (s.question != null && !numbersOk(unitNums, s.question, s.unitIds)) s.question = null;
      if (!numbersOk(unitNums, s.title, s.unitIds)) s.title = strip(s.title, s.unitIds) || "단원";
    }
    const dead = new Set();
    for (const c of out.concepts) {
      const home = out.sections.find(s => s.sectionId === c.homeSectionId);
      if (!home || numbersOk(unitNums, c.name, home.unitIds)) continue;
      fix("number:" + c.conceptId);
      const name = strip(c.name, home.unitIds);
      if (name) c.name = name;
      else { dead.add(c.conceptId); fix("concept-drop:" + c.conceptId); }
    }
    if (dead.size) { // 빈 이름이 된 개념은 참조까지 지우고, 따라서 빈 B05 도 정리한다
      out.concepts = out.concepts.filter(c => !dead.has(c.conceptId));
      for (const s of out.sections) {
        for (const b of s.blocks) b.conceptIds = b.conceptIds.filter(id => !dead.has(id));
        cleanB05(s);
      }
      for (const g of out.global) g.conceptIds = g.conceptIds.filter(id => !dead.has(id));
    }

    // i. 전역 블록은 타입당 하나 — 나중 중복은 버린다.
    const gSeen = new Set();
    out.global = out.global.filter(g => gSeen.has(g.type) ? (fix("global-dup:" + g.type), false) : (gSeen.add(g.type), true));
    return { output: out, fixes };
  }

  // §7 계산 검산: 모델이 준 식을 eval 하지 않고 허용된 연산 4종을 숫자에 직접 적용한다.
  // 다음 단계는 앞 단계의 기재값으로 계산한다 — values 에는 통과한 입력·단계의 기재값만 남는다.
  function checkCalc(content) {
    const OPS = { add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => a / b };
    const errors = [], values = {}, units = {};
    const fail = (code, ref) => errors.push({ code, detail: ref ? [ref] : [] });
    (content.inputs || []).forEach((inp, i) => { const r = "i" + (i + 1); values[r] = inp.value; units[r] = inp.unit ?? null; });
    (content.steps || []).forEach((st, j) => {
      const r = "c" + (j + 1);
      // 뒤 단계·자기 자신·검산에 실패한 단계는 아직 values 에 없으므로 존재 확인이 곧 "앞선 단계" 확인이다.
      if (!Object.hasOwn(values, st.a) || !Object.hasOwn(values, st.b)) return fail("VAL_CALC_REF", r);
      const va = values[st.a], vb = values[st.b];
      if (st.op === "div" && vb === 0) return fail("VAL_CALC_DIV_ZERO", r);
      const computed = OPS[st.op](va, vb);
      const rel = 1e-9 * Math.max(1, Math.abs(computed));
      const tol = st.digits == null ? rel : 0.5 * 10 ** -st.digits + rel;
      if (!(Math.abs(st.value - computed) <= tol)) return fail("VAL_CALC_MISMATCH", r);
      if (st.op === "add" || st.op === "sub") {
        // null 도 하나의 단위값이다(단위 없는 값과 있는 값은 더할 수 없다). %−% 의 결과는 반드시 %p(§7).
        const ua = units[st.a], want = st.op === "sub" && ua === "%" && units[st.b] === "%" ? "%p" : ua;
        if (ua !== units[st.b] || (st.unit ?? null) !== want) return fail("VAL_CALC_UNIT", r);
      }
      values[r] = st.value; units[r] = st.unit ?? null;
    });
    if (content.withheld != null && (content.steps || []).length) fail("VAL_CALC_WITHHELD");
    return { ok: !errors.length, errors, values };
  }

  // §14 표시 결정. KaTeX 통과는 문법 검증일 뿐 수학적 타당성·검산을 대신하지 않는다(§14).
  function displayOf(kind, entry, hasCrop) {
    if (kind === "formula") {
      if (entry?.status === "verified" && typeof entry.latex === "string" && entry.latex.trim()) return "latex";
      return hasCrop ? "crop" : "check";
    }
    // 간단한 표·그래프 판정(table·chart)은 도표 레지스트리(lib/figures.js)가 하고, 여기서는 그 결정을 존중한다(§14).
    if (kind === "figure") return ["table", "chart"].includes(entry?.display) ? entry.display : hasCrop ? "crop" : "check";
    throw new Error("알 수 없는 표시 종류: " + kind);
  }

  // 노드 안(객체·배열, 깊이 무관)에서 evidenceIds 키에 담긴 문자열을 순서대로 중복 없이 모은다.
  function citedRefs(node) {
    const out = [], seen = new Set();
    const walk = v => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object") return;
      for (const [k, x] of Object.entries(v)) {
        if (k !== "evidenceIds" || !Array.isArray(x)) { walk(x); continue; }
        for (const r of x) if (typeof r === "string" && !seen.has(r)) { seen.add(r); out.push(r); }
      }
    };
    walk(node);
    return out;
  }

  // ===== §10 코드 검사 공통 조각 =====
  // detail 에는 id·숫자·JSON 경로만 넣는다 — 주장 텍스트는 repair 프롬프트에도 돌려보내지 않는다(§10).
  const EV_RE = new RegExp(IDS.evidence);
  const CALC_RE = /^(S[0-9]{1,3}_B[0-9]{1,2}|GB[0-9])\.[ic][0-9]{1,2}$/;
  const FREF_RE = /\{\{\s*(F\d+)\s*\}\}/g;
  const POINT_RE = /^(S[0-9]{1,3}_B[0-9]{1,2})\/P[1-6]$/;
  const SEC_BLOCK_RE = new RegExp(IDS.secBlock);
  // 영어 강의의 근거는 영어다 — 같은 뜻의 영어 강조어도 받는다(test 는 "test set" 과 겹쳐 뺀다).
  const EMPHASIS_WORDS = { stress: /중요|핵심|꼭|반드시|기억|\b(important|crucial|essential|remember|key point)/i, exam: /시험|출제|중간고사|기말고사|퀴즈|\b(exams?|midterm|final exam|quiz)/i };
  // 원어·인용·기한의 원문 대조는 NFC + 공백 접기 + 대소문자 무시로 한다(§9).
  const normSub = s => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").toLowerCase();
  const isClaim = v => !!v && typeof v === "object" && !Array.isArray(v)
    && Object.keys(v).length === 3 && ["text", "evidenceIds", "basis"].every(k => Object.hasOwn(v, k));

  // 같은 code 의 오류는 detail 을 합쳐 블록당 한 줄만 남긴다.
  // detail 을 생략하면 무조건 오류이고, 배열을 넘기면 위반 목록이라 비어 있으면 오류가 아니다.
  const pushErr = (list, code, detail) => {
    if (Array.isArray(detail) && !detail.length) return;
    let e = list.find(x => x.code === code);
    if (!e) list.push(e = { code, detail: [] });
    for (const d of detail || []) if (!e.detail.includes(d)) e.detail.push(d);
  };

  // 봉투 안의 모든 주장을 JSON 경로와 함께 모은다 — 주장이 최소 검증 단위다(§3.2).
  function claimsOf(node, path = "", out = []) {
    if (isClaim(node)) { out.push({ path, claim: node }); return out; }
    if (Array.isArray(node)) { node.forEach((v, i) => claimsOf(v, path + "/" + i, out)); return out; }
    if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) claimsOf(v, path + "/" + k, out);
    return out;
  }

  // 주장이 아닌 문자열 슬롯(§6): 제목·라벨·기한·인용문 등도 블록 단위 숫자 검사를 받는다.
  // derived 는 LaTeX 이라 숫자·원문 재현이 아니라 KaTeX·재타이핑 검사가 맡는다.
  // quote.text 는 "원문 그대로 인용"이 정상인 슬롯이라 withQuote=false 면 뺀다(원문 재현 검사용).
  const TEXT_KEYS = new Set(["title", "label", "caseTitle", "sourceTitle", "term", "original", "symbol", "unit", "due"]);
  function nonClaimStrings(node, withQuote, out = []) {
    if (Array.isArray(node)) { node.forEach(v => nonClaimStrings(v, withQuote, out)); return out; }
    if (!node || typeof node !== "object" || isClaim(node)) return out;
    for (const [k, v] of Object.entries(node)) {
      if (k === "derived") continue;
      if (typeof v === "string" && (TEXT_KEYS.has(k) || (k === "text" && withQuote))) { out.push(v); continue; }
      if (k === "alternatives" && Array.isArray(v)) { out.push(...v.filter(s => typeof s === "string")); continue; }
      nonClaimStrings(v, withQuote, out);
    }
    return out;
  }

  function allStrings(node, out = []) {
    if (typeof node === "string") { out.push(node); return out; }
    if (Array.isArray(node)) { node.forEach(v => allStrings(v, out)); return out; }
    if (node && typeof node === "object") for (const v of Object.values(node)) allStrings(v, out);
    return out;
  }

  // 근거 한 줄의 수치 집합 — 근거 쪽은 한 자리 수까지 전부 모은다(keepSmall, §6).
  const numIndex = evById => {
    const cache = new Map();
    return id => {
      if (!cache.has(id)) cache.set(id, new Set(Verify.numbersOf(evById.get(id)?.text ?? "", true).flatMap(n => n.values)));
      return cache.get(id);
    };
  };

  // 계획 조회 인덱스: 대상 존재(targetOk)·복습 위치(reviewOk)·개념 depth·섹션별 B10 목록.
  function planIndex(plan) {
    const blockType = new Map(), sectionIds = new Set(), b10BySection = new Map(), concepts = new Map();
    for (const s of plan.sections || []) {
      sectionIds.add(s.sectionId);
      for (const b of s.blocks || []) {
        blockType.set(b.blockId, b.type);
        if (b.type === "B10") {
          if (!b10BySection.has(s.sectionId)) b10BySection.set(s.sectionId, new Set());
          b10BySection.get(s.sectionId).add(b.blockId);
        }
      }
    }
    for (const g of plan.global || []) blockType.set(g.blockId, g.type);
    for (const c of plan.concepts || []) concepts.set(c.conceptId, c.depth);
    // Point 대상은 계획 단계에서 개수를 모르니 블록이 B08/B09 인지만 본다 — 위치 번호는 조립이 정리한다.
    const targetOk = t => {
      const m = POINT_RE.exec(t);
      if (m) return ["B08", "B09"].includes(blockType.get(m[1]));
      return sectionIds.has(t) || blockType.has(t) || concepts.has(t);
    };
    const reviewOk = (id, ownId) => SEC_BLOCK_RE.test(id) && blockType.has(id) && id !== ownId;
    return { blockType, sectionIds, b10BySection, concepts, targetOk, reviewOk };
  }

  // 주장 하나의 규칙(§6·§10). pedagogical 은 정해진 슬롯에만 있을 수 있고 숫자 검사를 건너뛴다 —
  // 의도적으로 틀린 문장이라 근거에 없는 수치가 정상이다. 정정된 근거는 after 와 함께 인용해야 한다.
  function claimInto(cl, path, ctx, errs) {
    const evRefs = [], calcRefs = [], unknown = [], fresh = [];
    for (const r of cl.evidenceIds) {
      if (EV_RE.test(r)) { evRefs.push(r); if (!ctx.evById.has(r)) (ctx.global ? fresh : unknown).push(r); }
      else {
        calcRefs.push(r);
        if (!ctx.calc.has(r) && !(ctx.ownVals && Object.hasOwn(ctx.ownVals, r))) unknown.push(r);
      }
    }
    pushErr(errs, "VAL_GLOBAL_EVIDENCE_NEW", fresh);
    pushErr(errs, "VAL_EVIDENCE_UNKNOWN", unknown);
    if (AUG[cl.basis]) {
      // 가상 사례·강의 밖 보강(§18): 켠 옵션이고 허용 위치일 때만. 강의 근거·숫자 검사 대상이 아니다 — 렌더가 라벨을 단다.
      if (!ctx.policy?.[AUG[cl.basis]]) pushErr(errs, "VAL_BASIS_POLICY");
      else if (!ctx.augOk?.(path, cl.basis)) pushErr(errs, "VAL_BASIS_PLACEMENT");
    } else if (cl.basis === "pedagogical") {
      if (!ctx.pedOk(path)) pushErr(errs, "VAL_BASIS_PLACEMENT");
    } else {
      if (!(cl.basis === "lecture" ? evRefs : calcRefs).length) pushErr(errs, "VAL_EVIDENCE_MISSING");
      const allowed = new Set();
      for (const r of evRefs) if (ctx.evById.has(r)) for (const v of ctx.evNums(r)) allowed.add(v);
      for (const r of calcRefs) {
        const v = ctx.calc.has(r) ? ctx.calc.get(r) : ctx.ownVals?.[r];
        if (typeof v === "number") allowed.add(v);
      }
      pushErr(errs, "VAL_NUMBER_MISSING",
        Verify.numbersOf(cl.text).filter(n => !n.values.some(v => allowed.has(v))).map(n => n.raw));
    }
    pushErr(errs, "VAL_SUPERSEDED",
      evRefs.filter(r => ctx.superseded.has(r) && !(ctx.superseded.get(r) || []).some(a => cl.evidenceIds.includes(a))));
  }

  // 스키마를 통과한 봉투의 블록 검사들(§10 e~h). ctx 는 섹션·전역이 채운 허용 집합이다.
  function inspectBlock(rec, ctx) {
    const env = rec.envelope, c = env.content, type = rec.type, errs = rec.errors;
    const local = { ...ctx, ownVals: null };
    // pedagogical 의 허용 위치는 슬롯 경로로 판별한다 — B14 X답 문항의 prompt, B11 구조 점검의 misconception.
    local.pedOk = path => {
      if (type === "B14") {
        const m = /^\/content\/items\/(\d+)\/prompt$/.exec(path);
        const it = m && c.items[+m[1]];
        return !!it && it.kind === "ox" && !!it.answer && it.answer.verdict === "X";
      }
      return type === "B11" && path === "/content/misconception" && c.origin === "structural_check";
    };
    // 가상 사례: B08 전체(사례 자체가 가상), B05 예시, B14 문항 전제. 강의 밖 보강: B05 풀이·원리·예시, B12 곁설명.
    // 정의·비교·결론·답안·공지·계산에는 둘 다 올 수 없다 — 강의 사실과 섞이지 않게 한다.
    local.augOk = (path, basis) => !ctx.global && (basis === "synthetic"
      ? type === "B08" || (type === "B05" && /^\/content\/examples\/\d+$/.test(path)) || (type === "B14" && /^\/content\/items\/\d+\/premise$/.test(path))
      : (type === "B05" && /^\/content\/(explanation|mechanism|examples\/\d+)$/.test(path)) || (type === "B12" && path === "/content/note"));
    if (type === "B10") {
      const run = checkCalc(c);
      for (const e of run.errors) pushErr(errs, e.code, e.detail.length ? e.detail : undefined);
      // 이 블록의 기재값은 같은 블록 안 주장이 곧바로 참조할 수 있다(§7).
      local.ownVals = Object.fromEntries(Object.entries(run.values).map(([k, v]) => [`${rec.id}.${k}`, v]));
      (c.inputs || []).forEach((inp, i) => {
        pushErr(errs, "VAL_EVIDENCE_UNKNOWN", inp.evidenceIds.filter(id => !ctx.evById.has(id)));
        const ok = new Set(inp.evidenceIds.flatMap(id => [...ctx.evNums(id)]));
        if (!ok.has(inp.value)) pushErr(errs, "VAL_CALC_INPUT_UNSUPPORTED", [`i${i + 1}`]);
      });
      pushErr(errs, "VAL_REF_UNKNOWN", c.formulaIds.filter(id => !ctx.formulas.has(id)));
      pushErr(errs, "VAL_REF_UNKNOWN", c.figureIds.filter(id => !ctx.figures.has(id)));
      (c.derived || []).forEach((d, i) => {
        if (!Formulas.validateDerived(d, ctx.katex).ok) pushErr(errs, "VAL_DERIVED_INVALID", [`/content/derived/${i}`]);
      });
    }
    for (const { path, claim } of claimsOf(env)) claimInto(claim, path, local, errs);
    // 계산 입력·인용·강조처럼 주장이 아닌 근거 목록도 대체된 근거만 인용하면 오래된 값이 남는다(§6 정정).
    const stale = new Set();
    (function walk(v) {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object" || isClaim(v)) return;
      if (Array.isArray(v.evidenceIds))
        for (const r of v.evidenceIds)
          if (ctx.superseded.has(r) && !(ctx.superseded.get(r) || []).some(a => v.evidenceIds.includes(a))) stale.add(r);
      for (const x of Object.values(v)) walk(x);
    })(env);
    pushErr(errs, "VAL_SUPERSEDED", [...stale]);
    // 비주장 문자열의 숫자는 블록이 인용한 모든 근거·검산값(+자기 계산값) 안이어야 한다(§6).
    const vals = new Set();
    for (const r of citedRefs(env)) {
      if (ctx.evById.has(r)) for (const v of ctx.evNums(r)) vals.add(v);
      else {
        const v = ctx.calc.has(r) ? ctx.calc.get(r) : local.ownVals?.[r];
        if (typeof v === "number") vals.add(v);
      }
    }
    if (local.ownVals) for (const v of Object.values(local.ownVals)) vals.add(v);
    const miss = new Set();
    for (const s of nonClaimStrings(c, true))
      for (const n of Verify.numbersOf(s)) if (!n.values.some(v => vals.has(v))) miss.add(n.raw);
    pushErr(errs, "VAL_NUMBER_MISSING", [...miss]);
    const all = allStrings(c).join("\n");
    pushErr(errs, "VAL_FORMULA_REF_UNKNOWN",
      [...new Set([...all.matchAll(FREF_RE)].map(m => m[1]))].filter(id => !ctx.formulas.has(id)));
    pushErr(errs, "VAL_FORMULA_RETYPED", Formulas.findRetypedLatex(all, ctx.formulaEntries));
    pushErr(errs, "VAL_VERBATIM",
      Verify.verbatimIds([...claimsOf(env).map(x => x.claim.text), ...nonClaimStrings(c, false)].join("\n"), [...ctx.evById.values()]));
    // 강조 표시는 인용 근거 텍스트에 실제 강조어가 있어야 한다(§9 공통 봉투).
    for (const em of env.emphasis || [])
      pushErr(errs, "VAL_EMPHASIS_UNSUPPORTED", (em.evidenceIds || [])
        .filter(id => !ctx.evById.has(id) || !(EMPHASIS_WORDS[em.kind] || /$^/).test(ctx.evById.get(id).text)));
    typeRules(rec, local, errs);
  }

  // 타입별 구조 규칙(§9 "코드 검사" 열). ctx.targetAll 은 전역 블록에서 모든 대상을 검사할 때 켠다.
  function typeRules(rec, ctx, errs) {
    const c = rec.envelope.content, t = rec.type, pb = rec.planBlock;
    if (t === "B05") {
      if (c.conceptId !== pb.conceptIds[0]) pushErr(errs, "VAL_CONCEPT_REF", [c.conceptId]);
      if (c.original != null && !citedRefs(rec.envelope).some(r =>
        ctx.evById.has(r) && normSub(ctx.evById.get(r).text).includes(normSub(c.original))))
        pushErr(errs, "VAL_ORIGINAL_UNSUPPORTED", ["/content/original"]);
    } else if (t === "B06") {
      c.criteria.forEach((cr, i) => {
        if (cr.cells.length !== c.entities.length) pushErr(errs, "VAL_TABLE_SHAPE", [`/content/criteria/${i}/cells`]);
        if (cr.cells.every(x => x == null)) pushErr(errs, "VAL_TABLE_EMPTY_ROW", [`/content/criteria/${i}`]);
      });
      pushErr(errs, "VAL_CONCEPT_REF", c.entities.map(e => e.conceptId).filter(id => id != null && !ctx.concepts.has(id)));
    } else if (t === "B03") {
      const keys = new Set();
      c.nodes.forEach((n, i) => {
        if (keys.has(n.key)) pushErr(errs, "VAL_MAP_REF", [`/content/nodes/${i}/key`]);
        keys.add(n.key);
        // 섹션 지도의 노드 대상도 계획에 있어야 한다(전역만 보던 누락, agy 리뷰 A3).
        if (n.targetId != null && !ctx.targetOk(n.targetId)) pushErr(errs, "VAL_REF_UNKNOWN", [`/content/nodes/${i}/targetId`]);
      });
      c.edges.forEach((e, i) => {
        if (!keys.has(e.from) || !keys.has(e.to)) pushErr(errs, "VAL_MAP_REF", [`/content/edges/${i}`]);
        if (["causes", "supports"].includes(e.relation) && !(e.claim && ["lecture", "derived"].includes(e.claim.basis)))
          pushErr(errs, "VAL_MAP_EDGE_UNSUPPORTED", [`/content/edges/${i}`]);
      });
    } else if (t === "B08") {
      if (c.judgment) pushErr(errs, "VAL_POINT_REF", c.judgment.pointRefs.filter(p => p > c.points.length));
      pushErr(errs, "VAL_CONCEPT_REF", c.appliedConceptIds.filter(id => !ctx.concepts.has(id)));
    } else if (t === "B09") {
      if (c.quote) {
        pushErr(errs, "VAL_QUOTE_NOT_FOUND", c.quote.evidenceIds.filter(id => !ctx.evById.has(id)));
        if (!c.quote.evidenceIds.some(id =>
          ctx.evById.has(id) && normSub(ctx.evById.get(id).text).includes(normSub(c.quote.text))))
          pushErr(errs, "VAL_QUOTE_NOT_FOUND", ["/content/quote/text"]);
      }
    } else if (t === "B13") {
      for (const p of c.propositions) pushErr(errs, "VAL_REF_UNKNOWN", p.targetIds.filter(id => !ctx.targetOk(id)));
    } else if (t === "B14") {
      c.items.forEach((it, i) => {
        const a = it.answer, tag = r => `Q${i + 1}:${r}`;
        if (it.kind === "ox") {
          if (a.verdict == null) pushErr(errs, "VAL_ANSWER_SHAPE", [tag("verdict")]);
          else if (a.verdict === "X") {
            if (it.prompt.basis !== "pedagogical") pushErr(errs, "VAL_ANSWER_SHAPE", [tag("prompt")]);
            if (!a.correction || !["lecture", "derived"].includes(a.correction.basis))
              pushErr(errs, "VAL_ANSWER_SHAPE", [tag("correction")]);
          } else {
            if (!["lecture", "derived"].includes(it.prompt.basis)) pushErr(errs, "VAL_ANSWER_SHAPE", [tag("prompt")]);
            if (a.correction != null) pushErr(errs, "VAL_ANSWER_SHAPE", [tag("correction")]);
          }
        } else {
          if (a.verdict != null) pushErr(errs, "VAL_ANSWER_SHAPE", [tag("verdict")]);
          if (a.correction != null) pushErr(errs, "VAL_ANSWER_SHAPE", [tag("correction")]);
          if (it.prompt.basis === "pedagogical") pushErr(errs, "VAL_ANSWER_SHAPE", [tag("prompt")]);
          if (it.kind === "argue" && !a.rubric.length) pushErr(errs, "VAL_ANSWER_SHAPE", [tag("rubric")]);
          // calc 문항 해설은 이 섹션 B10 의 검산 참조를 인용해야 한다(§10).
          if (it.kind === "calc" && !a.explanation.evidenceIds.some(r => {
            const m = CALC_RE.exec(r);
            return m && ctx.planB10.has(m[1]);
          })) pushErr(errs, "VAL_ANSWER_SHAPE", [tag("calc")]);
        }
        // 대상은 계획에 있어야 하고 개념 대상은 defined 여야 한다. 복습 위치는 계획한 다른 섹션 블록.
        pushErr(errs, "VAL_REF_UNKNOWN",
          it.targetIds.filter(id => !ctx.targetOk(id) || (ctx.concepts.has(id) && ctx.concepts.get(id) !== "defined")));
        pushErr(errs, "VAL_REF_UNKNOWN", a.reviewIds.filter(id => !ctx.reviewOk(id, rec.id)));
      });
    } else if (t === "B18") {
      c.items.forEach((it, i) => {
        if (it.due != null && !it.claim.evidenceIds.some(r =>
          ctx.evById.has(r) && normSub(ctx.evById.get(r).text).includes(normSub(it.due))))
          pushErr(errs, "VAL_DUE_NOT_FOUND", [`/content/items/${i}/due`]);
      });
    }
    if (ctx.targetAll)
      for (const it of c.items || []) if (Array.isArray(it.targetIds))
        pushErr(errs, "VAL_REF_UNKNOWN", it.targetIds.filter(id => !ctx.targetOk(id)));
  }

  // §10: 섹션 Writer 출력의 코드 검사. 한 블록의 오류가 다른 블록 검사를 막지 않는다.
  // assembleNote 에서 두 번 불린다 — 1차로 각 섹션의 정정 지도를 모으고 2차에서 합쳐진 지도를
  // superseded 로 넣는다. 블록은 B10 먼저(계산 색인), 그다음 나머지를 계획 순서로 본다.
  function validateSection({ plan, sectionId, output, evidence = [], registry = [], formulaUnits = {}, figures = [], katex, superseded = {} }) {
    if (!katex || typeof katex.renderToString !== "function") throw new TypeError("KaTeX 객체가 필요합니다.");
    const sec = (plan.sections || []).find(s => s.sectionId === sectionId);
    if (!sec) throw new Error("계획에 없는 섹션: " + sectionId);
    const secErrs = [], plannedIds = new Set(sec.blocks.map(b => b.blockId));
    const out = output && typeof output === "object" && !Array.isArray(output) ? output : null;
    const outBlocks = out && out.blocks && typeof out.blocks === "object" && !Array.isArray(out.blocks) ? out.blocks : null;
    if (!outBlocks) pushErr(secErrs, "VAL_SCHEMA");
    else for (const k of Object.keys(outBlocks)) if (!plannedIds.has(k)) pushErr(secErrs, "VAL_SCHEMA", ["/blocks/" + k]);
    // 봉투 스키마 먼저 — 실패한 블록은 더 검사하지 않는다.
    const staged = sec.blocks.map(pb => {
      const env = outBlocks && Object.hasOwn(outBlocks, pb.blockId) ? outBlocks[pb.blockId] : undefined;
      const rec = { id: pb.blockId, type: pb.type, planBlock: pb, envelope: env ?? null, errors: [] };
      if (env == null) pushErr(rec.errors, env === undefined ? "VAL_SCHEMA" : "VAL_BLOCK_DECLINED");
      else {
        const v = Contracts.validate(envelopeSchema(pb.type, plan.policy), env);
        if (!v.ok) pushErr(rec.errors, "VAL_SCHEMA", v.errors.map(e => e.path));
      }
      return rec;
    });
    // 계산 색인: 모든 검사를 통과한 B10 의 기재값만 참조로 쓸 수 있다(§7). B10 을 계획 순서로 먼저 검사해
    // 통과할 때마다 등록한다 — 실패한 계산(예: 대체된 근거로 한 계산)에 기댄 블록도 같은 repair 회차에 함께 걸린다.
    const calcIndex = new Map();
    const units = new Set([...sec.unitIds, ...sec.crossUnitIds]);
    const evById = new Map(evidence.filter(e => units.has(e.unitId)).map(e => [e.id, e]));
    const fEntries = registry.filter(f => (formulaUnits[f.id] || []).some(u => units.has(u)));
    const idx = planIndex(plan);
    const ctx = {
      evById, evNums: numIndex(evById), calc: calcIndex, ownVals: null,
      superseded: new Map(Object.entries(superseded)),
      formulas: new Set(fEntries.map(f => f.id)), formulaEntries: fEntries,
      figures: new Set(figures.filter(f => units.has(f.unitId)).map(f => f.id)),
      concepts: idx.concepts, targetOk: idx.targetOk, reviewOk: idx.reviewOk,
      planB10: idx.b10BySection.get(sectionId) || new Set(),
      global: false, targetAll: false, katex, pedOk: () => false, policy: policyOf(plan.policy), augOk: () => false,
    };
    // checks 는 블록보다 먼저 본다 — 정정 지도가 블록 주장 검사의 입력이다(§10 d).
    // 확인 항목의 주장(특히 correction 의 before)은 문제가 된 근거를 일부러 인용하므로
    // 대체 검사(VAL_SUPERSEDED)는 걸지 않는다. 깨진 확인 항목은 오류 없이 버린다(§12.1.3).
    const checkCtx = { ...ctx, superseded: new Map() };
    const checks = [];
    for (const item of Array.isArray(out?.checks) ? out.checks : []) {
      if (!Contracts.validate(checkSchema, item).ok) continue;
      if (!item.targetIds.every(t => plannedIds.has(t))) continue;
      if (item.kind === "correction"
        && !(item.before && item.after && item.before.basis === "lecture" && item.after.basis === "lecture")) continue;
      const cerr = [];
      for (const k of ["claim", "before", "after", "hold"]) if (item[k]) claimInto(item[k], "/" + k, checkCtx, cerr);
      if (!cerr.length) checks.push(item);
    }
    for (const c of checks) if (c.kind === "correction") {
      const afters = c.after.evidenceIds.filter(r => EV_RE.test(r));
      for (const r of c.before.evidenceIds.filter(r => EV_RE.test(r)))
        ctx.superseded.set(r, [...new Set([...(ctx.superseded.get(r) || []), ...afters])]);
    }
    // gist 는 오류 없이 null 로 떨군다(§12.1).
    let gist = null;
    if (out && out.gist && Contracts.validate(claim, out.gist).ok) {
      const gerr = [];
      claimInto(out.gist, "/gist", ctx, gerr);
      if (!gerr.length) gist = out.gist;
    }
    // supported 가 아닌 블록은 이 섹션의 유효한 확인 항목이 가리켜야 한다(§9 B17).
    const explained = new Set(checks.flatMap(c => c.targetIds));
    for (const rec of [...staged.filter(r => r.type === "B10"), ...staged.filter(r => r.type !== "B10")]) {
      if (!rec.envelope || rec.errors.length) continue;
      if (rec.envelope.status !== "supported" && !explained.has(rec.id)) pushErr(rec.errors, "VAL_STATUS_UNEXPLAINED");
      inspectBlock(rec, ctx);
      if (rec.type === "B10" && !rec.errors.length) {
        rec.calcRun = checkCalc(rec.envelope.content);
        for (const [k, v] of Object.entries(rec.calcRun.values)) calcIndex.set(`${rec.id}.${k}`, v);
      }
    }
    // 커버리지: 자기 유닛(교차 제외)의 절반 이상이 살아남은 주장의 근거로 인용돼야 한다.
    const cited = [], seenC = new Set();
    const collect = node => { for (const r of citedRefs(node)) if (!seenC.has(r)) { seenC.add(r); cited.push(r); } };
    const validBlocks = staged.filter(r => !r.errors.length);
    for (const r of validBlocks) collect(r.envelope);
    if (gist) collect(gist);
    for (const c of checks) collect(c);
    const evUnit = new Map(evidence.map(e => [e.id, e.unitId]));
    const hit = new Set(cited.map(r => evUnit.get(r)).filter(Boolean));
    const ownHit = sec.unitIds.filter(u => hit.has(u)).length;
    // 커버리지 부족은 경고다 — 통과한 블록까지 섹션째 버리면 노트가 더 비고(필드: 4/6 블록이 살아 있던 섹션이 빠짐),
    // 섹션 오류가 있으면 블록 repair 도 건너뛰어 커버리지가 회복될 길이 막힌다. 덜 다룬 구간은 조립의 미반영 구간 고지가 알린다.
    const warnings = [];
    if (sec.unitIds.length && ownHit / sec.unitIds.length < 0.5)
      pushErr(warnings, "VAL_COVERAGE_LOW", [`${ownHit}/${sec.unitIds.length}`]);
    const calc = {};
    for (const r of validBlocks) if (r.type === "B10")
      for (const [k, v] of Object.entries(r.calcRun?.values || {})) calc[`${r.id}.${k}`] = v;
    return {
      sectionId, ok: !secErrs.length && staged.every(r => !r.errors.length), errors: secErrs, warnings, gist,
      blocks: staged.map(r => ({ id: r.id, type: r.type, envelope: r.envelope, errors: r.errors })),
      checks, calc, cited,
    };
  }

  // §8.4: 전역 블록은 살아남은 섹션 블록이 이미 인용한 참조의 부분집합만 쓴다 — 새 근거는
  // VAL_GLOBAL_EVIDENCE_NEW. 대상은 계획에 있기만 하면 된다(빠진 대상은 조립이 정리한다).
  function validateGlobal({ plan, output, sections = [], evidence = [], registry = [], formulaUnits = {}, figures = [], katex }) {
    if (!katex || typeof katex.renderToString !== "function") throw new TypeError("KaTeX 객체가 필요합니다.");
    const evAll = new Map(evidence.map(e => [e.id, e])), evById = new Map(), calc = new Map();
    for (const s of sections) {
      for (const r of s.cited || []) if (EV_RE.test(r) && evAll.has(r)) evById.set(r, evAll.get(r));
      for (const [k, v] of Object.entries(s.calc || {})) calc.set(k, v);
    }
    const idx = planIndex(plan);
    const ctx = {
      evById, evNums: numIndex(evById), calc, ownVals: null, superseded: new Map(),
      formulas: new Set(registry.map(f => f.id)), formulaEntries: registry,
      figures: new Set(figures.map(f => f.id)),
      concepts: idx.concepts, targetOk: idx.targetOk, reviewOk: idx.reviewOk,
      planB10: new Set(), global: true, targetAll: true, katex, pedOk: () => false, policy: policyOf(plan.policy), augOk: () => false,
    };
    const outBlocks = output && typeof output === "object" && !Array.isArray(output)
      && output.blocks && typeof output.blocks === "object" && !Array.isArray(output.blocks) ? output.blocks : {};
    return {
      blocks: (plan.global || []).map(g => {
        const env = Object.hasOwn(outBlocks, g.blockId) ? outBlocks[g.blockId] : undefined;
        const rec = { id: g.blockId, type: g.type, planBlock: g, envelope: env ?? null, errors: [] };
        if (env == null) pushErr(rec.errors, env === undefined ? "VAL_SCHEMA" : "VAL_BLOCK_DECLINED");
        else {
          const v = Contracts.validate(envelopeSchema(g.type), env);
          if (!v.ok) pushErr(rec.errors, "VAL_SCHEMA", v.errors.map(e => e.path));
          else {
            inspectBlock(rec, ctx);
            // 전역 출력에는 확인 항목 칸이 없다 — supported 가 아니면 설명할 방법이 없다.
            if (env.status !== "supported") pushErr(rec.errors, "VAL_STATUS_UNEXPLAINED");
          }
        }
        return { id: rec.id, type: rec.type, envelope: rec.envelope, errors: rec.errors };
      }),
    };
  }

  // §12: 검증 → 정정 지도 → 재검증 → 의존 정리(고정점) → Note 조립.
  // 입력 객체는 절대 바꾸지 않는다 — 살아남은 봉투·확인 항목·요지만 깊은 복사해 다듬는다.
  function assembleNote({ plan, sections = [], global = null, units = [], evidence = [], registry = [], formulaUnits = {}, figures = [], crops = [], meta = {}, tier, systemNotices = [], promptVersion = null, katex }) {
    const outputs = new Map(sections.map(s => [s.sectionId, s.output]));
    const run = sup => {
      const m = new Map();
      for (const sec of plan.sections || []) {
        const output = outputs.get(sec.sectionId);
        if (output != null)
          m.set(sec.sectionId, validateSection({ plan, sectionId: sec.sectionId, output, evidence, registry, formulaUnits, figures, katex, superseded: sup }));
      }
      return m;
    };
    // 1차 검증에서 살아남은 정정 확인 항목으로 전 섹션 공통 지도를 만든다(§6).
    const sup = {};
    for (const r of run({}).values()) for (const c of r.checks) if (c.kind === "correction") {
      const afters = c.after.evidenceIds.filter(x => EV_RE.test(x));
      for (const b of c.before.evidenceIds.filter(x => EV_RE.test(x))) sup[b] = [...new Set([...(sup[b] || []), ...afters])];
    }
    const results = run(sup);
    const deep = o => JSON.parse(JSON.stringify(o));
    const unitById = new Map(units.map(u => [u.unitId, u]));
    const dropped = [], pruned = [], failedIds = new Set();
    const live = new Map(), secLive = new Map(), calcMap = new Map();
    // 확인 필요 보존(§4 제안): 호출자가 섹션 출력 옆에 실어 둔다 — 주장 단위는 claims, 블록 단위는 envelope.
    // 블록 보류는 봉투가 남아 있으므로 탈락(dropped)으로 세지 않는다.
    const pending = [], pendingIds = new Set();
    for (const s of sections) for (const p of s.pending ?? []) {
      if (pending.length >= 200) break;
      const entry = {
        blockId: p.blockId, sectionId: p.sectionId ?? s.sectionId ?? null, type: p.type,
        paths: (p.paths || []).map(String).slice(0, 8),
        claims: (p.claims || []).map(deep).slice(0, 8),
        envelope: p.envelope && typeof p.envelope === "object" ? deep(p.envelope) : null,
      };
      pending.push(entry);
      if (entry.envelope) pendingIds.add(entry.blockId);
    }
    const dropOf = b => ({ blockId: b.id, type: b.type, codes: [...new Set(b.errors.map(e => e.code))].slice(0, 8) });
    for (const sec of plan.sections || []) {
      const r = results.get(sec.sectionId);
      const valid = r ? r.blocks.filter(b => !b.errors.length) : [];
      // 실패 섹션은 아무것도 남기지 않는다 — 블록은 dropped 에도 적지 않는다(§12 b).
      if (!r || r.errors.length || !valid.length) { failedIds.add(sec.sectionId); continue; }
      for (const b of r.blocks) if (b.errors.length && !pendingIds.has(b.id)) dropped.push(dropOf(b));
      for (const [k, v] of Object.entries(r.calc)) calcMap.set(k, v);
      sec.blocks.forEach((pb, i) => {
        const b = valid.find(x => x.id === pb.blockId);
        if (b) live.set(b.id, {
          id: b.id, type: b.type, sectionId: sec.sectionId,
          env: deep(b.envelope), planBlock: pb, prev: i ? sec.blocks[i - 1].blockId : null, wrapped: null,
        });
      });
      secLive.set(sec.sectionId, { plan: sec, gist: r.gist ? deep(r.gist) : null, checks: deep(r.checks) });
    }
    if (global != null && (plan.global || []).length) {
      const surv = [...secLive.keys()].map(sid => ({ ...results.get(sid), blocks: results.get(sid).blocks.filter(b => !b.errors.length) }));
      for (const b of validateGlobal({ plan, output: global, sections: surv, evidence, registry, formulaUnits, figures, katex }).blocks) {
        if (b.errors.length) { dropped.push(dropOf(b)); continue; }
        live.set(b.id, { id: b.id, type: b.type, sectionId: null, env: deep(b.envelope), planBlock: plan.global.find(g => g.blockId === b.id), prev: null, wrapped: null });
      }
    }
    // §12.2 의존 정리. 목록 항목은 정리 전 위치 ID 를 pruned 에 남긴다 — 최종 번호는 렌더가 매긴다(§4).
    const LIST = { B02: ["items", "I"], B13: ["propositions", "R"], B14: ["items", "Q"], B18: ["items", "N"] };
    const conceptIds = new Set((plan.concepts || []).map(c => c.conceptId));
    const dropBlock = (id, code) => {
      const b = live.get(id);
      if (!b) return;
      live.delete(id);
      dropped.push({ blockId: id, type: b.type, codes: [code] });
    };
    const deadCalc = r => { const m = CALC_RE.exec(r); return !!m && (!live.has(m[1]) || !calcMap.has(r)); };
    const hasDeadCalc = node => claimsOf(node).some(({ claim }) => claim.evidenceIds.some(deadCalc));
    for (;;) {
      let changed = false;
      const liveIds = new Set([...secLive.keys(), ...live.keys(), ...conceptIds]);
      for (const b of live.values()) if (b.type === "B08" || b.type === "B09")
        (b.env.content.points || []).forEach((_, i) => liveIds.add(`${b.id}/P${i + 1}`));
      for (const [id, b] of [...live]) {
        const spec = LIST[b.type];
        if (spec) {
          const [field, prefix] = spec;
          b.wrapped ??= b.env.content[field].map((item, i) => ({ pos: i + 1, item }));
          const keep = [];
          for (const w of b.wrapped) {
            const it = w.item, codes = [];
            if ((it.targetIds || []).some(t => !liveIds.has(t))) codes.push("NOTE_TARGET_DROPPED");
            if (hasDeadCalc(it)) codes.push("NOTE_CALC_DROPPED");
            if (b.type === "B14") {
              const kept = it.answer.reviewIds.filter(r => liveIds.has(r));
              if (kept.length !== it.answer.reviewIds.length) { it.answer.reviewIds = kept; changed = true; }
              if (!kept.length) codes.push("NOTE_REVIEW_DROPPED");
            }
            if (codes.length) { pruned.push({ id: `${id}/${prefix}${w.pos}`, codes }); changed = true; }
            else keep.push(w);
          }
          b.wrapped = keep;
          if (!keep.length) { dropBlock(id, "NOTE_DEPENDENCY_DROPPED"); changed = true; continue; }
          // 목록 밖(예: B02 question)의 주장이 죽은 계산을 인용하면 블록이 간다.
          if (hasDeadCalc({ ...b.env.content, [field]: [] })) { dropBlock(id, "NOTE_CALC_DROPPED"); changed = true; }
        } else {
          if (hasDeadCalc(b.env)) { dropBlock(id, "NOTE_CALC_DROPPED"); changed = true; continue; }
          if (b.type === "B03") {
            const c = b.env.content;
            const dead = new Set(c.nodes.filter(n => n.targetId != null && !liveIds.has(n.targetId)).map(n => n.key));
            if (dead.size) {
              c.nodes = c.nodes.filter(n => !dead.has(n.key));
              c.edges = c.edges.filter(e => !dead.has(e.from) && !dead.has(e.to));
              changed = true;
            }
            if (c.nodes.length < 2 || !c.edges.length) { dropBlock(id, "NOTE_DEPENDENCY_DROPPED"); changed = true; }
          } else if (b.type === "B12" && (!b.prev || !live.has(b.prev))) {
            dropBlock(id, "NOTE_ANCHOR_DROPPED"); changed = true;
          }
        }
      }
      // 확인 항목은 정정 기록 자체가 정보다 — 죽은 대상만 지우고 항목은 남긴다(§12.2).
      // 다만 사라진 계산을 인용한 요지는 비우고, 그런 확인 항목은 뺀다(끊어진 참조 0).
      for (const st of secLive.values()) {
        if (st.gist && hasDeadCalc(st.gist)) { st.gist = null; changed = true; }
        const alive = st.checks.filter(c => !hasDeadCalc(c));
        if (alive.length !== st.checks.length) { st.checks = alive; changed = true; }
        for (const c of st.checks) {
          const kept = c.targetIds.filter(t => liveIds.has(t));
          if (kept.length !== c.targetIds.length) { c.targetIds = kept; changed = true; }
        }
      }
      for (const sid of [...secLive.keys()])
        if (![...live.values()].some(b => b.sectionId === sid)) { secLive.delete(sid); failedIds.add(sid); changed = true; }
      if (!changed) break;
    }
    for (const b of live.values()) {
      const spec = LIST[b.type];
      if (spec && b.wrapped) b.env.content[spec[0]] = b.wrapped.map(w => w.item);
    }
    const toBlock = b => ({
      id: b.id, type: b.type, sectionId: b.sectionId,
      status: b.env.status, importance: b.env.importance, emphasis: b.env.emphasis, content: b.env.content,
    });
    const secOut = [];
    (plan.sections || []).forEach((ps, i) => {
      const st = secLive.get(ps.sectionId);
      if (!st) return;
      const own = ps.unitIds.map(u => unitById.get(u)).filter(Boolean);
      secOut.push({
        sectionId: ps.sectionId, number: i + 1, title: ps.title, question: ps.question, stage: ps.stage,
        unitIds: [...ps.unitIds],
        range: own.length ? { t0: Math.min(...own.map(u => u.t0)), t1: Math.max(...own.map(u => u.t1)) } : { t0: 0, t1: 0 },
        gist: st.gist,
        blocks: ps.blocks.map(pb => live.get(pb.blockId)).filter(Boolean).map(toBlock),
        checks: st.checks,
      });
    });
    const gOrder = new Map(GLOBAL_TYPES.map((t, i) => [t, i]));
    const globalOut = [...live.values()].filter(b => b.sectionId === null)
      .sort((a, b) => gOrder.get(a.type) - gOrder.get(b.type)).map(toBlock);
    // 최종 노트에서 인용된 근거 — 노트에는 위치만 남기고 텍스트는 싣지 않는다(§8.5).
    const finalCited = new Set(), cite = n => citedRefs(n).forEach(r => finalCited.add(r));
    for (const b of live.values()) cite(b.env);
    for (const st of secLive.values()) { if (st.gist) cite(st.gist); for (const c of st.checks) cite(c); }
    const sources = evidence.filter(e => finalCited.has(e.id))
      .map(e => ({ id: e.id, kind: e.kind, t0: e.t0, t1: e.t1, slideId: e.slideId ?? null }));
    const cropSet = new Set(crops);
    const reg = registry.map(e => ({
      id: e.id, latex: e.latex ?? null, text: e.text ?? null, status: e.status,
      slideId: String(e.slideId ?? ""), t0: e.t0, display: displayOf("formula", e, cropSet.has(e.id)),
    }));
    // 비전 출력 스키마는 "" 와 빈 목록을 허용하지만 노트 스키마는 최소 1글자·1개다 — 빈 칸은 null, 그래도 안 맞는 그래프 값은 버린다(크롭·확인 표시로).
    const blank = v => typeof v === "string" && v.trim() ? v : null;
    const chartOf = d => {
      if (!d) return null;
      const c = { ...d, unit: blank(d.unit), xLabel: blank(d.xLabel), yLabel: blank(d.yLabel) };
      return Contracts.validate(schemas.note.properties.figures.items.properties.chartData, c).ok ? c : null;
    };
    const figs = figures.map(f => {
      const chartData = chartOf(f.chartData);
      return {
        id: f.id, evidenceId: f.evidenceId, kind: f.kind, title: blank(f.title), cells: f.cells ?? null,
        chartData, t0: f.t0, display: displayOf("figure", f.display === "chart" && !chartData ? {} : f, cropSet.has(f.id)),
      };
    });
    const concepts = (plan.concepts || []).map(c => ({
      conceptId: c.conceptId, name: c.name, depth: c.depth,
      // 홈 B05 가 빠지면 링크만 끊는다 — 개념 참조 자체는 유지한다(§12.2).
      homeBlockId: [...live.values()].find(b => b.type === "B05" && b.env.content.conceptId === c.conceptId)?.id ?? null,
    }));
    // §12.3 고지 — 코드·건수·id·시각 구간만 싣는다(내용 없음).
    const notices = systemNotices.map(n => ({ code: n.code, count: n.count ?? null, ids: n.ids ?? null, ranges: n.ranges ?? null }));
    const notice = (code, count = null, ids = null, ranges = null) => notices.push({ code, count, ids, ranges });
    const spanOf = unitList => unitList.length ? { t0: Math.min(...unitList.map(u => u.t0)), t1: Math.max(...unitList.map(u => u.t1)) } : { t0: 0, t1: 0 };
    if (failedIds.size) {
      const ids = (plan.sections || []).map(s => s.sectionId).filter(id => failedIds.has(id));
      notice("NOTE_SECTIONS_FAILED", ids.length, ids,
        ids.map(sid => { const ps = plan.sections.find(s => s.sectionId === sid); return spanOf(ps.unitIds.map(u => unitById.get(u)).filter(Boolean)); }));
    }
    if (dropped.length) notice("NOTE_BLOCKS_DROPPED", dropped.length, dropped.map(d => d.blockId));
    if (pruned.length) notice("NOTE_ITEMS_PRUNED", pruned.length, pruned.map(p => p.id));
    const evUnit = new Map(evidence.map(e => [e.id, e.unitId]));
    const citedUnits = new Set([...finalCited].map(r => evUnit.get(r)).filter(Boolean));
    const uncited = [], uncitedRanges = [];
    // 판정이 "강의 내용 없음"(인사·출석·잡담, 중요도 1.5 미만)으로 본 유닛은 세지 않는다 — 작성 지침이 일부러 다루지 않는 구간이다. 판정 없는(Free) 유닛은 센다.
    const chatter = uid => (unitById.get(uid)?.judge?.importance ?? 5) < 1.5;
    for (const st of secLive.values()) for (const uid of st.plan.unitIds)
      if (!citedUnits.has(uid) && !chatter(uid)) {
        uncited.push(uid);
        if (unitById.has(uid)) uncitedRanges.push({ t0: unitById.get(uid).t0, t1: unitById.get(uid).t1 });
      }
    if (uncited.length) notice("NOTE_UNITS_UNCITED", uncited.length, uncited, uncitedRanges);
    // 노트가 실제로 참조한 수식·도표만 고지로 센다 — 레지스트리 전체가 아니다(§12.3).
    const refF = new Set(), refG = new Set();
    for (const b of live.values()) {
      for (const m of allStrings(b.env.content).join("\n").matchAll(FREF_RE)) refF.add(m[1]);
      if (b.type === "B10") { for (const f of b.env.content.formulaIds) refF.add(f); for (const g of b.env.content.figureIds) refG.add(g); }
      for (const g of b.planBlock?.figureIds || []) refG.add(g);
    }
    const pick = (ids, list, want) => [...ids].filter(id => list.find(e => e.id === id)?.display === want);
    const fCrop = pick(refF, reg, "crop"), fChk = pick(refF, reg, "check"), gChk = pick(refG, figs, "check");
    if (fCrop.length) notice("NOTE_FORMULAS_IMAGE", fCrop.length, fCrop);
    if (fChk.length) notice("NOTE_FORMULAS_CHECK", fChk.length, fChk);
    if (gChk.length) notice("NOTE_FIGURES_CHECK", gChk.length, gChk);
    if (tier === "free") notice("NOTE_FIGURES_NOT_DETECTED"); // Free 는 도표 탐지가 없다(§14)
    // 가상 사례·강의 밖 보강이 실제로 남은 노트는 머리에서 알린다(§18). 라벨은 주장마다 렌더가 단다.
    const augmented = [...live.values()].some(b => claimsOf(b.env).some(({ claim }) => AUG[claim.basis]));
    if (augmented) notice("NOTE_AUGMENTED");
    // §8.1 권장량 초과는 조판 힌트(advisories)다 — 내용을 자르지 않는다.
    const advisories = [], adv = (code, id) => advisories.push({ code, id });
    let qTotal = 0;
    for (const [id, b] of live) {
      const c = b.env.content;
      if (b.type === "B06") {
        if (c.entities.length > TYPES.B06.advice.entities) adv("NOTE_ADVISORY_TABLE_WIDE", id);
        if (c.criteria.length > TYPES.B06.advice.criteria) adv("NOTE_ADVISORY_TABLE_LONG", id);
      } else if (b.type === "B03") {
        if (c.nodes.length > TYPES.B03.advice.nodes) adv("NOTE_ADVISORY_MAP_LARGE", id);
      } else if (b.type === "B14") {
        qTotal += c.items.length;
        if (c.items.length >= 2 && c.items.every(it => it.kind === "ox")) adv("NOTE_ADVISORY_OX_ONLY", id);
        c.items.forEach((it, i) => {
          if (it.kind !== "ox") return;
          const hit = [...it.targetIds, ...it.answer.reviewIds].some(t => {
            const tb = live.get(t.split("/")[0]);
            return tb && (tb.type === "B09" || (tb.type === "B07" && tb.env.content.relationType === "argument"));
          });
          if (hit) adv("NOTE_ADVISORY_OX_CONTESTED", `${id}/Q${i + 1}`);
        });
      } else if (b.type === "B05") {
        const n = [c.definition, c.explanation, c.mechanism].filter(Boolean).reduce((s, cl) => s + cl.text.length, 0);
        if (n > TYPES.B05.advice.chars) adv("NOTE_ADVISORY_LENGTH", id);
      } else if (b.type === "B12") {
        if (c.note.text.length > TYPES.B12.advice.chars) adv("NOTE_ADVISORY_LENGTH", id);
      } else if (b.type === "B02") {
        c.items.forEach((it, i) => { if (it.claim.text.length > TYPES.B02.advice.claimChars) adv("NOTE_ADVISORY_LENGTH", `${id}/I${i + 1}`); });
      }
    }
    if (qTotal > TYPES.B14.advice.questions) adv("NOTE_ADVISORY_QUESTIONS_MANY", "note");
    for (const sid of secLive.keys()) {
      const n = [...live.values()].filter(b => b.sectionId === sid && b.type === "B11").length;
      if (n > TYPES.B11.advice.perSection) adv("NOTE_ADVISORY_PITFALLS_MANY", sid);
    }
    const note = {
      schemaVersion: NOTE_SCHEMA_VERSION, noteSpecVersion: NOTE_SPEC_VERSION,
      promptVersion: promptVersion ?? null,
      // 처리 누락이 있는 노트를 완전한 노트로 표시하지 않는다(§14.1 proposal).
      status: failedIds.size || dropped.length || systemNotices.some(n => n.code === "NOTE_CAPTURE_GAP") ? "partial" : "complete",
      tier,
      policy: policyOf(plan.policy),
      meta: {
        title: meta.title ?? null, course: meta.course ?? null, lectureDate: meta.lectureDate ?? null,
        session: meta.session ?? null, lang: meta.lang ?? null, generatedAt: meta.generatedAt ?? null,
        processed: meta.processed ?? null,
      },
      concepts, global: globalOut, sections: secOut, registry: reg, figures: figs,
      sources, notices, dropped, pruned, advisories,
      ...(pending.length ? { pending } : {}),
    };
    // 조립 결과가 계약을 깨면 모델이 아니라 이 코드의 버그다 — 조용히 보내지 않고 즉시 던진다.
    const nv = Contracts.validate(schemas.note, note);
    if (!nv.ok) throw new Error("Note 조립 결과가 스키마를 통과하지 못했습니다: " + nv.errors[0].path);
    for (const b of [...note.global, ...note.sections.flatMap(s => s.blocks)]) {
      const cv = Contracts.validate(schemas.content[b.type], b.content);
      if (!cv.ok) throw new Error(`블록 ${b.id} 의 내용이 ${b.type} 슬롯을 통과하지 못했습니다: ${cv.errors[0].path}`);
    }
    return note;
  }

  const freeze = o => { for (const v of Object.values(o)) if (v && typeof v === "object") freeze(v); return Object.freeze(o); };
  const api = freeze({
    NOTE_SPEC_VERSION, NOTE_SCHEMA_VERSION, POLICY, TYPES, SECTION_TYPES, GLOBAL_TYPES, WRITER_TYPES, IDS,
    schemas, envelopeSchema, sectionOutputSchemaFor, repairOutputSchemaFor, globalOutputSchemaFor,
    normalizePlan, repairPlan, canonicalPlanIds, canonicalMapKeys, checkCalc, displayOf, citedRefs, validateSection, validateGlobal, assembleNote, restrictBasis, policyOf, AUG, withSource,
  });
  globalThis.NoteContract = api;
  if (typeof module !== "undefined") module.exports = api;
})();
