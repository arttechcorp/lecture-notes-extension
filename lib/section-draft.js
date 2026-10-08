// 의미 초안(SectionDraft) 계약과 코드 컴파일러 — 제안서 §2 대안 B, §3 (docs/note-contract.md §8.3 과 같은 출력 모양).
// 모델은 지면(B01–B18 슬롯·색·번호·HTML)이 아닌 의미 단위만 쓴다: 평탄한 주장 목록(claims)과
// 주장을 로컬 키로 엮은 typed 관계(relations). 코드(compileDraft)가 계획 블록의 기존 봉투로 조판한다.
// 컴파일 결과는 섹션 작성 출력과 같은 모양 {gist, blocks:{blockId: Envelope|null}, checks} 에 실행 중 로컬
// 원장 ledger 를 얹는다 — claims 원장은 내용 없음(로컬 키·개념·의존·인용 id·봉투 안 위치)이지만,
// 복구 루프가 원래 초안을 대상으로 재검증해야 해서(위임서 §4.4) draft 칸에 원래 초안을 메모리에 그대로 둔다.
// 기존 검증(NoteContract.validateSection)·repair·T5·assembleNote 가 그대로 가고 저장 포맷(Note)은 바뀌지 않는다.
// 출력 스키마(outputSchemaFor)는 strict JSON Schema — 서버(server/prompts.js "draft" 단계)가 응답 형식으로
// 내리고 클라이언트가 같은 스키마로 다시 검사한다. basis 정책·allowedRefs 좁히기·영어 src 는 note-contract 와 같다.
(() => {
  const need = (name, path) => globalThis[name] || (typeof require !== "undefined" ? require(path) : null);
  const NoteContract = need("NoteContract", "./note-contract.js");
  const NoteV3 = need("NoteV3", "./note-v3.js");

  // 블록 타입 → relations 키 대응 표
  const BLOCK_KIND = {
    B03: "maps",
    B06: "comparisons",
    B07: "arguments",
    B08: "cases",
    B09: "materials",
    B10: "calcs",
    B11: "pitfalls",
    B12: "notes",
    B13: "links",
    B18: "notices",
  };

  // 주장의 의미 역할 — 지면이 아니다. B05 채움만 role→슬롯 대응을 쓰고, 나머지는 relations 가 로컬 키로 엮는다.
  const ROLES = ["definition", "intuition", "mechanism", "condition", "exception", "example", "comparison", "argument", "procedure", "calculation", "notice"];
  // 계획 섹션의 선택 필드 worker(W2-B 가 plan 스키마에 추가). 프롬프트 분기(server/prompts.js WORKER)와 같은 값 목록.
  const WORKERS = ["general", "formula", "comparison", "argument", "figure"];
  // 모델이 쓰는 로컬 주장 키 c1.. — 서버 식별자로 문장 해시를 보내지 않는다(§3). 호스트가 섹션 안에서만 해소한다.
  const CLAIM_ID = "^c[0-9]{1,3}$";
  // 작성자가 블록을 null로 둔 사유(위임서 §4.4) — 선택적 실험 메타데이터다. 없는 항목·모르는 값은 unknown.
  const NULL_REASONS = ["insufficient_evidence", "duplicate", "unsupported_format", "policy", "unknown"];
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
  function outputSchemaFor(planSection, { gist = true, policy = NoteContract.POLICY, allowedRefs = null, sourceLang, nullReasons = false, v3 = false, mode = null, explicitRelations = false } = {}) {
    const isV3Mode = v3 === true || explicitRelations === true || (mode && NoteV3?.isV3?.(mode));
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
    // v3 모드: relationId, targetBlockId, learningItemIds 선택 필드 포함 (strict JSON Schema: null 허용 필수)
    const meta = {
      status: nullableEnum(["uncertain", "conflicting", "corrected"]),
      importance: nullableEnum(["core", "supporting", "reference"]),
      ...(isV3Mode ? {
        relationId: orNull(str(64)),
        targetBlockId: orNull(pat(IDS.secBlock)),
        learningItemIds: orNull(arr(pat(IDS.learningItem), 20)),
      } : {}),
    };
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
      // 작성자 null 의 사유 지도 — 키는 이 요청의 계획 블록, 값은 NULL_REASONS. 안 채운 블록은 null.
      ...(nullReasons === true ? { nullReasons: orNull(obj(Object.fromEntries(ids.map(id => [id, nullableEnum(NULL_REASONS)])))) } : {}),
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
    const emptyCounts = {
      claims: { included: 0, merged: 0, deferred: 0, unmapped: 0, total: 0 },
      relations: { included: 0, merged: 0, deferred: 0, unmapped: 0, total: 0 },
    };
    const empty = { gist: null, blocks, checks: [], ledger: { v: 1, claims: {}, relations: [], counts: emptyCounts, draft: null } };
    if (!draft || typeof draft !== "object" || draft.sectionId !== planSection?.sectionId) return empty;
    const cmap = new Map();
    for (const c of draft.claims ?? [])
      if (c && typeof c.claimId === "string" && typeof c.text === "string" && c.text && !cmap.has(c.claimId)) cmap.set(c.claimId, c);
    // 블록 단위 작성자 사유 — 코드는 해석하지 않고 그대로 실어 둔다(사유는 사실로 신뢰하지 않고 검증이 교차 확인한다).
    const nullReasons = nullReasonsOf(draft);
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

    // 관계 대응 맵: blockId -> relation, relation -> blockId
    // v3 명시 대응: targetBlockId/learningItemIds 가 있으면 그 블록에 직접 매칭, 없으면 배열 순서로 폴백
    const blockToRelation = new Map();
    const relationToBlock = new Map();

    for (const [bType, kind] of Object.entries(BLOCK_KIND)) {
      const relList = Array.isArray(rel[kind]) ? rel[kind] : [];
      const blocksForKind = planBlocks.filter(b => b.type === bType);

      // 1단계: targetBlockId 명시 대응
      for (const r of relList) {
        if (!r || typeof r !== "object") continue;
        const targetBid = typeof r.targetBlockId === "string" ? r.targetBlockId.trim() : null;
        if (targetBid) {
          const matched = blocksForKind.find(b => b.blockId === targetBid && !blockToRelation.has(b.blockId));
          if (matched) {
            blockToRelation.set(matched.blockId, r);
            relationToBlock.set(r, matched.blockId);
          }
          // targetBlockId 가 지정된 관계는 특정 블록 대상이므로 일치하는 블록이 없으면 다른 블록에 임의 배정되지 않는다
        }
      }

      // 1b단계: learningItemIds 로 명시 대응 (targetBlockId 가 없는 관계 대상)
      for (const r of relList) {
        if (!r || typeof r !== "object" || relationToBlock.has(r) || r.targetBlockId) continue;
        if (Array.isArray(r.learningItemIds) && r.learningItemIds.length) {
          const matched = blocksForKind.find(b => !blockToRelation.has(b.blockId)
            && Array.isArray(b.learningItemIds) && b.learningItemIds.some(id => r.learningItemIds.includes(id)));
          if (matched) {
            blockToRelation.set(matched.blockId, r);
            relationToBlock.set(r, matched.blockId);
          }
        }
      }

      // 2단계: 순서 기반 폴백 (targetBlockId 가 없는 관계만 남은 빈 계획 블록에 순서대로 배정 = sol-luna-2 동작 보존)
      const unboundBlocks = blocksForKind.filter(b => !blockToRelation.has(b.blockId));
      const untargetedRelations = relList.filter(r => !relationToBlock.has(r) && (!r || typeof r !== "object" || !r.targetBlockId));
      for (let i = 0; i < Math.min(unboundBlocks.length, untargetedRelations.length); i++) {
        const b = unboundBlocks[i];
        const r = untargetedRelations[i];
        blockToRelation.set(b.blockId, r);
        relationToBlock.set(r, b.blockId);
      }
    }

    const taken = {};
    let meta = null;
    const next = (kind, pb) => {
      let r = null;
      if (pb?.blockId && blockToRelation.has(pb.blockId)) {
        r = blockToRelation.get(pb.blockId);
      } else if (!pb) {
        const l = Array.isArray(rel[kind]) ? rel[kind] : [];
        r = l[taken[kind] ?? 0] ?? null;
        taken[kind] = (taken[kind] ?? 0) + 1;
      }
      return meta = r && typeof r === "object" ? r : null;
    };

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
      B03: pb => {
        const r = next("maps", pb); if (!r) return null;
        const nodes = (Array.isArray(r.nodes) ? r.nodes : []).map((n, i) => ({ key: `n${i + 1}`, label: n.label, targetId: n.targetId ?? null }));
        const edges = (Array.isArray(r.edges) ? r.edges : [])
          .map(e => ({ from: nodes[e?.from]?.key, to: nodes[e?.to]?.key, relation: e.relation, claim: e.claim == null ? null : at(e.claim) }))
          .filter(e => e.from && e.to && (!["causes", "supports"].includes(e.relation) || e.claim));
        return nodes.length >= 2 && edges.length ? { title: r.title, nodes, edges } : null;
      },
      B06: pb => {
        const r = next("comparisons", pb); if (!r) return null;
        const entities = (Array.isArray(r.entities) ? r.entities : []).map(e => ({ label: e.label, conceptId: e.conceptId ?? null }));
        const criteria = (Array.isArray(r.criteria) ? r.criteria : [])
          .map(cr => ({ label: cr.label, cells: (Array.isArray(cr.cells) ? cr.cells : []).map(id => id == null ? null : at(id)) }))
          .filter(cr => cr.cells.some(Boolean)); // 셀이 전부 null 인 행은 계약 위반(VAL_TABLE_EMPTY_ROW)이다 — 미리 뺀다
        return entities.length >= 2 && criteria.length ? { title: r.title, entities, criteria, common: list(r.common, 4), discriminator: at(r.discriminator) } : null;
      },
      B07: pb => {
        const r = next("arguments", pb); if (!r) return null;
        const steps = (Array.isArray(r.steps) ? r.steps : []).map(s => ({ role: s.role, claim: at(s.claim) })).filter(s => s.claim);
        return steps.length >= 2 ? { title: r.title, relationType: r.relationType, question: at(r.question), steps, missingLinks: list(r.missingLinks, 3) } : null;
      },
      B08: pb => {
        const r = next("cases", pb); if (!r) return null;
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
      B09: pb => {
        const r = next("materials", pb); if (!r) return null;
        const gist = at(r.gist); if (!gist) return null;
        return { sourceTitle: r.sourceTitle, sourceKind: r.sourceKind, gist,
          quote: r.quote && typeof r.quote === "object" && typeof r.quote.text === "string" && r.quote.text ? { text: r.quote.text, evidenceIds: (Array.isArray(r.quote.evidenceIds) ? r.quote.evidenceIds : []).slice(0, 2) } : null,
          points: (Array.isArray(r.points) ? r.points : []).map(p => ({ clue: at(p.clue), reading: at(p.reading) })).filter(p => p.clue && p.reading).slice(0, 6),
          authorClaim: at(r.authorClaim), lecturerReading: at(r.lecturerReading), limits: list(r.limits, 3) };
      },
      B10: pb => {
        const r = next("calcs", pb); if (!r) return null;
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
      B11: pb => {
        const r = next("pitfalls", pb); if (!r) return null;
        const misconception = at(r.misconception), correction = at(r.correction);
        return misconception && correction ? { misconception, correction, conditions: list(r.conditions, 3), origin: r.origin } : null;
      },
      B12: pb => { const r = next("notes", pb); if (!r) return null; const note = at(r.note); return note ? { kind: r.kind, note } : null; },
      B13: pb => {
        const r = next("links", pb); if (!r) return null;
        const propositions = (Array.isArray(r.propositions) ? r.propositions : [])
          .map(p => ({ relation: p.relation, claim: at(p.claim), targetIds: Array.isArray(p.targetIds) ? p.targetIds.slice(0, 4) : [] }))
          .filter(p => p.claim && p.targetIds.length).slice(0, 5);
        return propositions.length ? { title: r.title, propositions } : null;
      },
      B18: pb => {
        const r = next("notices", pb); if (!r) return null;
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
    // 로컬 원장: 초안 주장의 로컬 키·개념·의존과 실제로 실린 봉투 위치("<blockId>#<봉투 안 경로>")를 남긴다.
    // claims 원장에는 주장 문장을 싣지 않는다(내용 없는 진단·연결용). 저장되는 Note 에는 들어가지 않는다 — 조립의
    // 의존 정리가 보류·탈락 주장에 기대는 주장을 확정 본문에서 빼는 데 쓰고, 비교 화면·커버리지 원장이 같은 주장을
    // 여기서 잇는다. draft 칸에는 원래 초안을 메모리에 보존한다(§4.4 — root 복구 뒤 종속 주장을 추측이 아니라
    // 원래 초안으로 재검증한다). 로컬 키는 이 컴파일 안에서만 유효하다 — 분할 작성 조각은 mergeLedgers 로 넘긴다.
    const ledger = { v: 1, claims: {}, draft };
    for (const c of cmap.values()) ledger.claims[c.claimId] = {
      role: c.role ?? null,
      conceptIds: (Array.isArray(c.conceptIds) ? c.conceptIds : []).filter(x => typeof x === "string"),
      dependsOn: (Array.isArray(c.dependsOn) ? c.dependsOn : []).filter(id => cmap.has(id)), // 초안에 실제 있는 키만 — 끊긴 참조는 뗀다
      evidenceIds: [], places: [],
    };
    // srcOf 에 잡힌 객체가 실제로 실린 주장이다 — 확인 항목·요지는 로컬 키가 없어 원장에 들어가지 않는다.
    const mark = (node, path, bid) => {
      const src = srcOf.get(node);
      if (src) {
        const e = ledger.claims[src.claimId];
        e.places.push(`${bid}#${path}`);
        for (const r of Array.isArray(node.evidenceIds) ? node.evidenceIds : [])
          if (typeof r === "string" && !e.evidenceIds.includes(r)) e.evidenceIds.push(r);
        return;
      }
      if (Array.isArray(node)) return node.forEach((v, i) => mark(v, `${path}/${i}`, bid));
      if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) mark(v, `${path}/${k}`, bid);
    };
    for (const [bid, env] of Object.entries(blocks)) if (env) mark(env, "", bid);

    // 보류(null)된 블록에서 참조되었던 주장들을 수집 (deferred 판별용)
    const claimsIn = node => {
      const set = new Set();
      (function walk(v) {
        if (typeof v === "string" && /^c[0-9]{1,3}$/.test(v)) set.add(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") Object.values(v).forEach(walk);
      })(node);
      return set;
    };
    const deferredClaimIds = new Set();
    for (const pb of planBlocks) {
      if (blocks[pb.blockId] === null) {
        if (blockToRelation.has(pb.blockId)) {
          const r = blockToRelation.get(pb.blockId);
          for (const cid of claimsIn(r)) deferredClaimIds.add(cid);
        }
        if (pb.type === "B05") {
          const cid = pb.conceptIds?.[0];
          if (cid) {
            for (const c of cmap.values()) {
              if (Array.isArray(c.conceptIds) && c.conceptIds.includes(cid)) deferredClaimIds.add(c.claimId);
            }
          }
        }
      }
    }

    // 모든 생성 주장·관계에 상태 included | merged | deferred | unmapped 부여
    for (const [cid, c] of Object.entries(ledger.claims)) {
      if (c.places.length > 0) {
        c.status = "included";
      } else if (deferredClaimIds.has(cid)) {
        c.status = "deferred";
      } else {
        c.status = "unmapped";
      }
    }

    const ledgerRelations = [];
    for (const [kind, list] of Object.entries(rel)) {
      if (!Array.isArray(list)) continue;
      list.forEach((r, idx) => {
        if (!r || typeof r !== "object") return;
        const assignedBid = relationToBlock.get(r) ?? null;
        let status = "unmapped";
        if (assignedBid) {
          status = blocks[assignedBid] !== null ? "included" : "deferred";
        }
        ledgerRelations.push({
          kind,
          index: idx,
          relationId: typeof r.relationId === "string" ? r.relationId : null,
          targetBlockId: typeof r.targetBlockId === "string" ? r.targetBlockId : null,
          learningItemIds: Array.isArray(r.learningItemIds) ? r.learningItemIds : null,
          assignedBlockId: assignedBid,
          status,
        });
      });
    }

    const countStatus = arr => {
      const out = { included: 0, merged: 0, deferred: 0, unmapped: 0, total: arr.length };
      for (const x of arr) if (out[x.status] !== undefined) out[x.status]++;
      return out;
    };
    ledger.counts = {
      claims: countStatus(Object.values(ledger.claims)),
      relations: countStatus(ledgerRelations),
    };
    ledger.relations = ledgerRelations;

    return { gist, blocks, checks: (Array.isArray(draft.checks) ? draft.checks : []).slice(0, 6), ledger,
      ...(Object.keys(nullReasons).length ? { nullReasons } : {}) };
  }

  // 출력의 선택 실험 칸 nullReasons({<blockId>: 사유})를 읽는다 — 없거나 열거 밖 값은 unknown 으로 둔다.
  const nullReasonsOf = output => {
    const m = output && typeof output === "object" ? output.nullReasons : null;
    const out = {};
    if (m && typeof m === "object" && !Array.isArray(m))
      for (const [k, v] of Object.entries(m)) if (typeof k === "string" && k) out[k] = NULL_REASONS.includes(v) ? v : "unknown";
    return out;
  };

  // 내용 없는 메트릭 문자열 포맷터
  const formatLedgerMetrics = ledger => {
    const c = ledger?.counts?.claims ?? { included: 0, merged: 0, deferred: 0, unmapped: 0, total: 0 };
    const r = ledger?.counts?.relations ?? { included: 0, merged: 0, deferred: 0, unmapped: 0, total: 0 };
    return `claims(inc=${c.included},mrg=${c.merged},def=${c.deferred},unm=${c.unmapped},tot=${c.total}) relations(inc=${r.included},mrg=${r.merged},def=${r.deferred},unm=${r.unmapped},tot=${r.total})`;
  };

  // 복구된 root 의 뒤를 잇는다(§4.4): 원장의 의존 그래프에서, 살아난 것으로 확인된 주장·블록 id(recoveredRoots —
  // 주장 id 는 그 주장을, 블록 id 는 그 안에 실린 주장 전부를 다시 산 것으로 본다)에 기대던 종속 주장을 의존 순서로
  // 돌려준다. 내용을 새로 추측하지 않고 원장이 보존한 원래 초안의 주장을 실어 보낸다 — 재검증·복귀는 호출자가 한다.
  // 복구되지 않은 의존이 하나라도 남은 주장은 후보가 아니다. ledger 는 조각 배열(mergeLedgers 결과)도 받는다.
  function restoreDependents(ledger, recoveredRoots) {
    const roots = new Set([].concat(recoveredRoots ?? []));
    const out = [];
    for (const f of mergeLedgers(ledger)) {
      const claims = f.claims || {}, live = new Set();
      for (const r of roots) {
        if (Object.hasOwn(claims, r)) live.add(r);
        for (const [cid, c] of Object.entries(claims))
          if (Array.isArray(c?.places) && c.places.some(p => String(p).split("#")[0] === r)) live.add(cid);
      }
      const eligible = new Map();
      for (let grew = true; grew;) {
        grew = false;
        for (const [cid, c] of Object.entries(claims)) {
          if (live.has(cid) || eligible.has(cid)) continue;
          const deps = Array.isArray(c?.dependsOn) ? c.dependsOn : [];
          if (deps.length && deps.every(d => live.has(d) || eligible.has(d))) { eligible.set(cid, c); grew = true; }
        }
      }
      for (const [cid, c] of eligible)
        out.push({ claimId: cid, claim: (f.draft?.claims ?? []).find(x => x?.claimId === cid) ?? null, dependsOn: c.dependsOn ?? [], places: c.places ?? [] });
    }
    return out;
  }

  // 분할 작성 조각의 원장을 합친다. 조각마다 초안이 따로라 로컬 키(c1..)가 겹친다 — 키를 합치지 않고
  // 조각 배열로 돌려준다(소비자는 조각 안에서만 키를 푼다).
  const mergeLedgers = (...frags) =>
    frags.flatMap(f => f == null ? [] : Array.isArray(f) ? f : [f])
      .filter(f => f && typeof f === "object" && f.claims && typeof f.claims === "object");

  const api = { outputSchemaFor, compileDraft, mergeLedgers, restoreDependents, nullReasonsOf, formatLedgerMetrics, ROLES, WORKERS, NULL_REASONS, BLOCK_KIND };
  globalThis.SectionDraft = api;
  if (typeof module !== "undefined") module.exports = api;
})();
