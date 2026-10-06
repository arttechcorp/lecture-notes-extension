// 의미 초안(SectionDraft) 계약과 코드 컴파일러 — 제안서 §2 대안 B, §3 (docs/note-contract.md §8.3 과 같은 출력 모양).
// 모델은 지면(B01–B18 슬롯·색·번호·HTML)이 아닌 의미 단위만 쓴다: 평탄한 주장 목록(claims)과
// 주장을 로컬 키로 엮은 typed 관계(relations). 코드(compileDraft)가 계획 블록의 기존 봉투로 조판한다.
// 컴파일 결과는 섹션 작성 출력과 같은 모양 {gist, blocks:{blockId: Envelope|null}, checks} — 기존
// 검증(NoteContract.validateSection)·repair·T5·assembleNote 가 그대로 가고 저장 포맷(Note)은 바뀌지 않는다.
// 출력 스키마(outputSchemaFor)는 strict JSON Schema — 서버(server/prompts.js "draft" 단계)가 응답 형식으로
// 내리고 클라이언트가 같은 스키마로 다시 검사한다. basis 정책·allowedRefs 좁히기·영어 src 는 note-contract 와 같다.
(() => {
  const need = (name, path) => globalThis[name] || (typeof require !== "undefined" ? require(path) : null);
  const NoteContract = need("NoteContract", "./note-contract.js");

  // 주장의 의미 역할 — 지면이 아니다. B05 채움만 role→슬롯 대응을 쓰고, 나머지는 relations 가 로컬 키로 엮는다.
  const ROLES = ["definition", "intuition", "mechanism", "condition", "exception", "example", "comparison", "argument", "procedure", "calculation", "notice"];
  // 계획 섹션의 선택 필드 worker(W2-B 가 plan 스키마에 추가). 프롬프트 분기(server/prompts.js WORKER)와 같은 값 목록.
  const WORKERS = ["general", "formula", "comparison", "argument", "figure"];
  // 모델이 쓰는 로컬 주장 키 c1.. — 서버 식별자로 문장 해시를 보내지 않는다(§3). 호스트가 섹션 안에서만 해소한다.
  const CLAIM_ID = "^c[0-9]{1,3}$";
  // calcs 관계 안에서 주장이 같은 계산의 입력·단계를 가리킬 때 쓰는 로컬 참조 — 컴파일이 그 블록의 계산 참조(<blockId>.i#/.c#)로 바꾼다.
  const LOCAL_REF = /^[ic][0-9]{1,2}$/;

  const obj = (p, required = Object.keys(p)) => ({ type: "object", additionalProperties: false, required, properties: p });
  const arr = (items, maxItems, minItems = 0) => ({ type: "array", minItems, maxItems, items });
  const str = n => ({ type: "string", minLength: 1, maxLength: n });
  // contracts.js orNull 과 같다 — null 허용은 enum 에도 null 을 넣어야 한다.
  const orNull = s => ({ ...s, type: [].concat(s.type, "null"), ...(s.enum ? { enum: [...s.enum, null] } : {}) });
  const pat = s => ({ type: "string", pattern: s });
  const en = v => ({ type: "string", enum: v });
  const nullableEnum = v => ({ type: ["string", "null"], enum: [...v, null] });

  // §8.3 확인 항목 — 섹션 작성 출력과 같은 칸이다. 대상은 이 요청의 계획 블록뿐이라 enum 으로 좁힌다
  // (note-contract 가 보내지 않는 checkSchemaFor 와 같은 좁히기라 같은 코드를 여기 둔다).
  const checkFor = ids => ids?.length
    ? obj({ ...NoteContract.schemas.check.properties, targetIds: arr(en([...new Set(ids)]), 4) })
    : NoteContract.schemas.check;

  // 봉투 스키마의 targetIds·targetId 칸을 요청의 참조 목록 enum 으로 좁힌다(note-contract restrictRefs 와 같은 규칙 —
  // B14 복습 칸이 없으니 ownId 는 쓸 일이 없다). 목록이 빈 칸은 enum 이 아무 값도 못 받으니 두고 코드 검사가 걸러낸다.
  const restrictRefs = (schema, refs) => {
    if (!refs) return schema;
    const t = [...new Set(refs.targetIds || [])];
    const out = JSON.parse(JSON.stringify(schema));
    (function walk(v) {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== "object") return;
      const p = v.properties;
      if (p && t.length) {
        if (p.targetIds?.items?.pattern === NoteContract.IDS.target) p.targetIds = { ...p.targetIds, items: en(t) };
        if (p.targetId?.pattern === NoteContract.IDS.target) p.targetId = { ...p.targetId, enum: [...t, null] };
      }
      Object.values(v).forEach(walk);
    })(out);
    return out;
  };

  // 요청별 초안 출력 스키마. relations 는 타입별 배열 — 같은 타입의 계획 블록에 계획 순서로 하나씩 대응한다
  // (초안은 블록 id 를 모른다). 관계 안의 주장 칸은 모두 로컬 키(claimId)다. strict 라 모든 칸이 필수 —
  // "없음"은 null·빈 배열로 표현한다.
  function outputSchemaFor(planSection, { gist = true, policy = NoteContract.POLICY, allowedRefs = null, sourceLang } = {}) {
    const IDS = NoteContract.IDS;
    const evId = pat(IDS.evidence), conceptId = pat(IDS.concept), target = pat(IDS.target), claimId = pat(CLAIM_ID);
    const src = sourceLang === "en" ? { src: { type: ["string", "null"], maxLength: 600 } } : {};
    // 초안 주장: 슬롯·번호 없는 의미 단위. evidenceIds 는 근거 항목 id — calcs 관계 안에서만 "i1"·"c2" 로컬 참조를 허용한다.
    const claim = obj({
      claimId, role: en(ROLES), text: str(600), basis: en(NoteContract.schemas.claim.properties.basis.enum), evidenceIds: arr(pat(IDS.ref), 8),
      conceptIds: arr(conceptId, 6), dependsOn: arr(claimId, 8),
      emphasis: orNull(obj({ kind: en(["stress", "exam"]), evidenceIds: arr(evId, 3, 1) })),
      ...src,
    });
    // 봉투 판단 칸: 모르겠으면 null — 코드가 "supported"/"supporting" 기본값으로 둔다.
    const meta = { status: nullableEnum(["uncertain", "conflicting", "corrected"]), importance: nullableEnum(["core", "supporting", "reference"]) };
    const pair = obj({ clue: claimId, reading: claimId });
    const relations = obj({
      comparisons: arr(obj({ ...meta, title: str(80),
        entities: arr(obj({ label: str(40), conceptId: orNull(conceptId) }), 6, 2),
        criteria: arr(obj({ label: str(40), cells: arr(orNull(claimId), 6, 2) }), 12, 1),
        common: arr(claimId, 4), discriminator: orNull(claimId) }), 8),
      arguments: arr(obj({ ...meta, title: str(80), relationType: en(["causal", "argument", "process", "history"]), question: orNull(claimId),
        steps: arr(obj({ role: en(["premise", "value_premise", "evidence", "reason", "claim", "counter", "condition", "step", "event", "result"]), claim: claimId }), 8, 2),
        missingLinks: arr(claimId, 3) }), 8),
      cases: arr(obj({ ...meta, caseTitle: str(80), source: en(["lecture_case", "material_case"]), situation: claimId,
        points: arr(pair, 6, 1), appliedConceptIds: arr(conceptId, 4),
        judgment: orNull(obj({ pointRefs: arr({ type: "integer", minimum: 1, maximum: 6 }, 6, 1), claim: claimId })),
        limits: arr(claimId, 3),
        decision: orNull(obj({ actor: orNull(claimId), goal: orNull(claimId), alternatives: arr(claimId, 4), criteria: arr(claimId, 4), tradeoffs: arr(claimId, 3), missingData: arr(claimId, 3) })) }), 8),
      materials: arr(obj({ ...meta, sourceTitle: str(120), sourceKind: en(["text", "historical", "philosophical", "literary", "data", "other"]),
        gist: claimId, quote: orNull(obj({ text: str(150), evidenceIds: arr(evId, 2, 1) })),
        points: arr(pair, 6), authorClaim: orNull(claimId), lecturerReading: orNull(claimId), limits: arr(claimId, 3) }), 8),
      calcs: arr(obj({ ...meta, title: str(80), kind: en(["formula", "table", "graph", "calc"]), goal: orNull(claimId),
        formulaIds: arr(pat(IDS.formula), 6), figureIds: arr(pat(IDS.figure), 3),
        variables: arr(obj({ symbol: str(40), meaning: claimId, unit: orNull(str(16)) }), 10),
        assumptions: arr(claimId, 5),
        inputs: arr(obj({ label: str(60), value: { type: "number" }, unit: orNull(str(16)), evidenceIds: arr(evId, 4, 1) }), 10),
        steps: arr(obj({ label: str(60), op: en(["add", "sub", "mul", "div"]), a: pat(IDS.localRef), b: pat(IDS.localRef), value: { type: "number" }, unit: orNull(str(16)), digits: { type: ["integer", "null"], minimum: 0, maximum: 6 } }), 8),
        derived: arr(str(400), 4), reading: arr(claimId, 6), result: orNull(claimId), limits: arr(claimId, 4), withheld: orNull(claimId) }), 8),
      pitfalls: arr(obj({ ...meta, misconception: claimId, correction: claimId, conditions: arr(claimId, 3), origin: en(["lecture_correction", "structural_check"]) }), 8),
      notes: arr(obj({ ...meta, kind: en(["term", "background", "original", "link", "hint"]), note: claimId }), 8),
      links: arr(obj({ ...meta, title: str(80),
        propositions: arr(obj({ relation: en(["common", "contrast", "inclusion", "condition", "complement", "cause", "sequence"]), claim: claimId, targetIds: arr(target, 4, 1) }), 5, 1) }), 8),
      notices: arr(obj({ ...meta, items: arr(obj({ topic: en(["exam", "assignment", "deadline", "materials", "request", "other"]), claim: claimId, due: orNull(str(60)) }), 6, 1) }), 8),
      // 지도 노드는 배열 위치다 — 간선은 노드 인덱스(0부터)로 끝을 가리키고 코드가 n1.. 키를 단다(기존 canonicalMapKeys 와 같은 사정).
      maps: arr(obj({ ...meta, title: str(80), nodes: arr(obj({ label: str(40), targetId: orNull(target) }), 12, 2),
        edges: arr(obj({ from: { type: "integer", minimum: 0 }, to: { type: "integer", minimum: 0 }, relation: en(["includes", "part_of", "example_of", "precedes", "contrasts", "causes", "supports", "complements"]), claim: orNull(claimId) }), 16, 1) }), 8),
    });
    const ids = (planSection?.blocks ?? []).map(b => b.blockId);
    let out = obj({
      sectionId: pat(IDS.section),
      ...(gist !== false ? { gist: orNull(NoteContract.schemas.claim) } : {}),
      claims: arr(claim, 120),
      relations,
      checks: arr(checkFor(ids), 6),
    });
    if (sourceLang === "en") out = NoteContract.withSource(out); // gist·checks 안의 인라인 주장에 src — 초안 claims 는 위에서 직접 얹었다
    out = NoteContract.restrictBasis(out, policy);
    if (allowedRefs) out = restrictRefs(out, allowedRefs);
    return out;
  }

  // 초안 → 섹션 작성 출력. 형식상 빈 슬롯을 채우려고 내용을 복제하지 않는다 — 재료가 없거나 필수 칸을 못 채우면
  // 그 칸은 null/빈 배열이고 블록 전체가 비면 그 블록 값은 null 이다(기존 VAL_BLOCK_DECLINED 보류 규칙).
  // 끊긴 로컬 참조도 같은 규칙이다: 선택 칸이면 null, 목록 항목이면 그 항목을 빼고, 필수 칸이면 블록을 보류한다.
  // ctx: { concepts: 계획 개념 목록 } — B05 의 term 은 개념 이름에서 가져온다(초안은 원어 original 을 쓰지 않는다 — null).
  function compileDraft(draft, planSection, ctx = {}) {
    const planBlocks = Array.isArray(planSection?.blocks) ? planSection.blocks : [];
    const blocks = Object.fromEntries(planBlocks.map(b => [b.blockId, null]));
    const empty = { gist: null, blocks, checks: [] };
    if (!draft || typeof draft !== "object" || draft.sectionId !== planSection?.sectionId) return empty;
    const cmap = new Map();
    for (const c of draft.claims ?? [])
      if (c && typeof c.claimId === "string" && typeof c.text === "string" && c.text && !cmap.has(c.claimId)) cmap.set(c.claimId, c);
    const conceptName = new Map((ctx?.concepts ?? []).map(c => [c.conceptId, c.name]));
    const rel = draft.relations && typeof draft.relations === "object" ? draft.relations : {};

    const srcOf = new Map(); // 컴파일된 주장 객체 → 초안 주장 — 봉투 emphasis 는 실제로 들어간 주장에서만 모은다
    // 로컬 키 → 봉투 주장 {text, evidenceIds, basis} (+영어 강의면 src). scope 가 있으면 "i1"·"c2" 로컬 참조를 그 블록의 계산 참조로 옮긴다.
    const at = (id, scope) => {
      const c = cmap.get(id);
      if (!c) return null;
      const o = { text: c.text, evidenceIds: (Array.isArray(c.evidenceIds) ? c.evidenceIds : []).map(x => scope && LOCAL_REF.test(String(x)) ? `${scope}.${x}` : x), basis: c.basis };
      if (Object.hasOwn(c, "src")) o.src = c.src ?? null;
      srcOf.set(o, c);
      return o;
    };
    const list = (ids, cap, scope) => (Array.isArray(ids) ? ids.slice(0, cap ?? 8) : []).map(id => at(id, scope)).filter(Boolean);
    const idsIn = (ids, allowed) => [...new Set((Array.isArray(ids) ? ids : []).filter(x => (allowed ?? []).includes(x)))];
    const emphasis = content => {
      const seen = new Set(), out = [];
      (function walk(v) {
        if (Array.isArray(v)) return v.forEach(walk);
        if (!v || typeof v !== "object") return;
        const c = srcOf.get(v);
        if (c) {
          const e = c.emphasis, k = e && typeof e.kind === "string" && Array.isArray(e.evidenceIds) ? e.kind + ":" + e.evidenceIds.join(",") : null;
          if (k && !seen.has(k)) { seen.add(k); out.push({ kind: e.kind, evidenceIds: [...e.evidenceIds] }); }
          return;
        }
        Object.values(v).forEach(walk);
      })(content);
      return out.slice(0, 2);
    };
    // 같은 타입의 typed 관계를 계획 순서로 하나씩 소비한다. meta(봉투 판단 칸)는 마지막으로 읽은 관계 것이다.
    const taken = {};
    let meta = null;
    const next = kind => { const l = Array.isArray(rel[kind]) ? rel[kind] : []; const r = l[taken[kind] ?? 0] ?? null; taken[kind] = (taken[kind] ?? 0) + 1; return meta = r && typeof r === "object" ? r : null; };

    // 타입별 슬롯 배치 — 의미 먼저 읽고 해당 블록 타입의 재료가 없으면 null 을 돌려준다(보류).
    const fill = {
      // B05 개념 설명 ← 그 개념(conceptIds)의 definition·intuition·mechanism·condition·exception·example 주장.
      // term 은 계획 개념의 이름, original 은 초안이 쓰지 않는다(근거에 실제로 나온 원어만이라 코드는 모른다 → null).
      B05: pb => {
        const cid = pb.conceptIds?.[0], term = conceptName.get(cid);
        if (!cid || !term) return null;
        const mine = [...cmap.values()].filter(c => Array.isArray(c.conceptIds) && c.conceptIds.includes(cid));
        const pick = role => { const c = mine.find(x => x.role === role); return c ? at(c.claimId) : null; };
        const definition = pick("definition");
        if (!definition) return null;
        return { conceptId: cid, term, original: null, definition, explanation: pick("intuition"), mechanism: pick("mechanism"),
          scope: list(mine.filter(c => c.role === "condition" || c.role === "exception").map(c => c.claimId), 4),
          examples: list(mine.filter(c => c.role === "example").map(c => c.claimId), 3) };
      },
      B03: () => {
        const r = next("maps"); if (!r) return null;
        const nodes = (Array.isArray(r.nodes) ? r.nodes : []).map((n, i) => ({ key: `n${i + 1}`, label: n.label, targetId: n.targetId ?? null }));
        const edges = (Array.isArray(r.edges) ? r.edges : [])
          .map(e => ({ from: nodes[e?.from]?.key, to: nodes[e?.to]?.key, relation: e.relation, claim: e.claim == null ? null : at(e.claim) }))
          .filter(e => e.from && e.to && (!["causes", "supports"].includes(e.relation) || e.claim));
        return nodes.length >= 2 && edges.length ? { title: r.title, nodes, edges } : null;
      },
      B06: () => {
        const r = next("comparisons"); if (!r) return null;
        const entities = (Array.isArray(r.entities) ? r.entities : []).map(e => ({ label: e.label, conceptId: e.conceptId ?? null }));
        const criteria = (Array.isArray(r.criteria) ? r.criteria : [])
          .map(cr => ({ label: cr.label, cells: (Array.isArray(cr.cells) ? cr.cells : []).map(id => id == null ? null : at(id)) }))
          .filter(cr => cr.cells.some(Boolean)); // 셀이 전부 null 인 행은 계약 위반(VAL_TABLE_EMPTY_ROW)이다 — 미리 뺀다
        return entities.length >= 2 && criteria.length ? { title: r.title, entities, criteria, common: list(r.common, 4), discriminator: at(r.discriminator) } : null;
      },
      B07: () => {
        const r = next("arguments"); if (!r) return null;
        const steps = (Array.isArray(r.steps) ? r.steps : []).map(s => ({ role: s.role, claim: at(s.claim) })).filter(s => s.claim);
        return steps.length >= 2 ? { title: r.title, relationType: r.relationType, question: at(r.question), steps, missingLinks: list(r.missingLinks, 3) } : null;
      },
      B08: () => {
        const r = next("cases"); if (!r) return null;
        const situation = at(r.situation);
        const points = (Array.isArray(r.points) ? r.points : []).map(p => ({ clue: at(p.clue), reading: at(p.reading) })).filter(p => p.clue && p.reading);
        if (!situation || !points.length) return null;
        const decision = r.decision && typeof r.decision === "object" ? {
          actor: at(r.decision.actor), goal: at(r.decision.goal), alternatives: list(r.decision.alternatives, 4),
          criteria: list(r.decision.criteria, 4), tradeoffs: list(r.decision.tradeoffs, 3), missingData: list(r.decision.missingData, 3),
        } : null;
        const judgment = r.judgment && typeof r.judgment === "object"
          ? { pointRefs: (Array.isArray(r.judgment.pointRefs) ? r.judgment.pointRefs : []).filter(n => Number.isInteger(n) && n >= 1 && n <= points.length), claim: at(r.judgment.claim) } : null;
        return { caseTitle: r.caseTitle, source: r.source, situation, points, appliedConceptIds: idsIn(r.appliedConceptIds, [...conceptName.keys()]),
          judgment: judgment?.claim && judgment.pointRefs.length ? judgment : null, limits: list(r.limits, 3),
          decision: decision && (decision.actor || decision.goal || decision.alternatives.length || decision.criteria.length || decision.tradeoffs.length || decision.missingData.length) ? decision : null };
      },
      B09: () => {
        const r = next("materials"); if (!r) return null;
        const gist = at(r.gist); if (!gist) return null;
        return { sourceTitle: r.sourceTitle, sourceKind: r.sourceKind, gist,
          quote: r.quote && typeof r.quote === "object" && typeof r.quote.text === "string" && r.quote.text ? { text: r.quote.text, evidenceIds: (Array.isArray(r.quote.evidenceIds) ? r.quote.evidenceIds : []).slice(0, 2) } : null,
          points: (Array.isArray(r.points) ? r.points : []).map(p => ({ clue: at(p.clue), reading: at(p.reading) })).filter(p => p.clue && p.reading).slice(0, 6),
          authorClaim: at(r.authorClaim), lecturerReading: at(r.lecturerReading), limits: list(r.limits, 3) };
      },
      B10: pb => {
        const r = next("calcs"); if (!r) return null;
        const scope = pb.blockId; // 이 계산 안의 "i1"·"c2" 는 이 블록의 계산 참조가 된다(derived 주장의 근거).
        return { title: r.title, kind: r.kind, goal: at(r.goal, scope),
          formulaIds: idsIn(r.formulaIds, pb.formulaIds), figureIds: idsIn(r.figureIds, pb.figureIds), // 계획이 허용한 수식·도표만 — 나머지는 참조 오류가 될 뿐이다
          variables: (Array.isArray(r.variables) ? r.variables : []).map(v => ({ symbol: v.symbol, meaning: at(v.meaning, scope), unit: v.unit ?? null })).filter(v => v.meaning).slice(0, 10),
          assumptions: list(r.assumptions, 5, scope),
          inputs: (Array.isArray(r.inputs) ? r.inputs : []).slice(0, 10).map(x => ({ label: x.label, value: x.value, unit: x.unit ?? null, evidenceIds: Array.isArray(x.evidenceIds) ? x.evidenceIds.slice(0, 4) : [] })),
          steps: (Array.isArray(r.steps) ? r.steps : []).slice(0, 8).map(x => ({ label: x.label, op: x.op, a: x.a, b: x.b, value: x.value, unit: x.unit ?? null, digits: x.digits ?? null })),
          derived: (Array.isArray(r.derived) ? r.derived : []).slice(0, 4),
          reading: list(r.reading, 6, scope), result: at(r.result, scope), limits: list(r.limits, 4, scope), withheld: at(r.withheld, scope) };
      },
      B11: () => {
        const r = next("pitfalls"); if (!r) return null;
        const misconception = at(r.misconception), correction = at(r.correction);
        return misconception && correction ? { misconception, correction, conditions: list(r.conditions, 3), origin: r.origin } : null;
      },
      B12: () => { const r = next("notes"); if (!r) return null; const note = at(r.note); return note ? { kind: r.kind, note } : null; },
      B13: () => {
        const r = next("links"); if (!r) return null;
        const propositions = (Array.isArray(r.propositions) ? r.propositions : [])
          .map(p => ({ relation: p.relation, claim: at(p.claim), targetIds: Array.isArray(p.targetIds) ? p.targetIds.slice(0, 4) : [] }))
          .filter(p => p.claim && p.targetIds.length).slice(0, 5);
        return propositions.length ? { title: r.title, propositions } : null;
      },
      B18: () => {
        const r = next("notices"); if (!r) return null;
        const items = (Array.isArray(r.items) ? r.items : []).map(it => ({ topic: it.topic, claim: at(it.claim), due: it.due ?? null })).filter(it => it.claim).slice(0, 6);
        return items.length ? { items } : null;
      },
      // 자기 점검 문항은 이 경로에서 만들지 않는다 — 본문 확정 뒤 별도 단계(W2-D)가 채운다. blockId 는 보존(키는 남고 값은 null).
      B14: () => null,
    };

    for (const pb of planBlocks) {
      meta = null;
      const content = fill[pb.type]?.(pb) ?? null;
      if (!content) continue;
      blocks[pb.blockId] = {
        status: meta?.status ?? "supported",
        // 개념 정의 블록은 그 개념의 단일 기준 위치라 core 기본값. 관계 블록은 모델이 importance 를 줄 수 있고 아니면 supporting.
        importance: meta?.importance ?? (pb.type === "B05" ? "core" : "supporting"),
        emphasis: emphasis(content), content,
      };
    }
    const g = draft.gist;
    const gist = g && typeof g === "object" && typeof g.text === "string" && g.text
      ? { text: g.text, evidenceIds: Array.isArray(g.evidenceIds) ? [...g.evidenceIds] : [], basis: g.basis, ...(Object.hasOwn(g, "src") ? { src: g.src } : {}) }
      : null;
    return { gist, blocks, checks: (Array.isArray(draft.checks) ? draft.checks : []).slice(0, 6) };
  }

  const api = { outputSchemaFor, compileDraft, ROLES, WORKERS };
  globalThis.SectionDraft = api;
  if (typeof module !== "undefined") module.exports = api;
})();
