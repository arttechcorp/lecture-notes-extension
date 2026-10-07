// lib/admin-view.js
// 개발 전용 비교 화면 순수 로직 (제안서 §4, docs/architecture-v2.md, T4)
// 네 칸 뷰: 근거 → 검증 전 초안 → 점수/복구/이유 → 최종 노트
// 메모리 내 복호화 데이터만 다루며, 서버로 본문·해시·근거 문자열을 전송하지 않는다.
(() => {
  const STATUS_LABELS = {
    kept: "유지",
    fixed: "수정",
    relinked: "재연결",
    pending: "직접 보류",
    direct: "직접 보류",
    collateral: "블록 동반 손실",
    cascade: "의존 연쇄 보류",
    unjudged: "미판정",
  };

  // 노드 안의 모든 주장({ text, evidenceIds, basis })을 재귀 탐색해 추출한다.
  function claimsIn(node, path = "", out = []) {
    if (node && typeof node === "object" && !Array.isArray(node) && typeof node.text === "string" && Array.isArray(node.evidenceIds) && typeof node.basis === "string") {
      out.push({ path, claim: node });
      return out;
    }
    if (Array.isArray(node)) node.forEach((v, i) => claimsIn(v, `${path}/${i}`, out));
    else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) claimsIn(v, `${path}/${k}`, out);
    }
    return out;
  }

  // 블록 내용에서 고유 claimId를 붙여 평탄화된 주장 목록을 추출한다.
  function extractClaims(content, blockId = "") {
    const raw = claimsIn(content);
    return raw.map(({ path, claim }, index) => {
      const claimId = blockId ? `${blockId}#${path || index}` : `c#${index}`;
      return {
        claimId,
        path,
        text: claim.text,
        evidenceIds: Array.isArray(claim.evidenceIds) ? [...claim.evidenceIds] : [],
        basis: claim.basis,
        blockId,
        status: claim.status ?? null,
      };
    });
  }

  // T1 필드(status)·T5 결과(outcome)가 있으면 우선 사용하고, 없으면 최종 노트 및 판정/보류 결과로부터 상태를 방어적으로 추론한다.
  // 상태: kept(유지), fixed(수정), relinked(재연결), pending/direct(직접 보류), collateral(블록 동반 손실), cascade(의존 연쇄 보류), unjudged(미판정)
  function inferClaimStatus(claim, context = {}) {
    if (typeof claim?.status === "string" && STATUS_LABELS[claim.status]) {
      return claim.status;
    }
    const { finalNote, droppedBlocks = [], prunedItems = [], supportScores = {}, repairs = [] } = context;
    const pending = context.pending ?? finalNote?.pending ?? [];
    const blockId = claim.blockId;
    // 확인 필요 보존(pending): 블록째 보류면 envelope 이 남고, 주장 단위 보류면 paths 에 뺀 경로가 남는다.
    const pend = pending.find(p => p.blockId === blockId);

    // 1. 최종 노트에 블록이 살아남았는지 확인
    let finalBlock = null;
    if (finalNote) {
      for (const sec of finalNote.sections || []) {
        finalBlock = (sec.blocks || []).find(b => b.id === blockId);
        if (finalBlock) break;
      }
      if (!finalBlock) {
        finalBlock = (finalNote.global || []).find(b => b.id === blockId);
      }
    }

    if (finalBlock) {
      // 블록이 살아남음: 주장이 그대로 남아있는지 검사
      const survivingClaims = claimsIn(finalBlock.envelope?.content || finalBlock.content);
      const matched = survivingClaims.find(c => c.claim.text === claim.text);
      if (matched) {
        // 주장이 최종 본문에 존재 — 복구 수락은 주장 단위로만 본다. 같은 블록의 다른 주장 수락을 이 주장에 물려주지 않는다.
        // claimId 없는 옛날 repairs 항목은 블록 단위로만 비교할 수 있어 블록 일치로 본다.
        const wasRepaired = repairs.some(r => r.ok && (r.claimId ? r.claimId === claim.claimId : r.blockId === blockId));
        if (wasRepaired) return "fixed";
        if (matched.claim.evidenceIds?.join(",") !== claim.evidenceIds?.join(",")) return "relinked";
        return "kept";
      }
      // 블록은 살았으나 주장 슬롯에서 제거됨 — 보류 보존 목록(경로 또는 보존된 주장 텍스트)에 있으면 pending, 아니면 직접 보류
      if (pend && (pend.paths?.includes(claim.path) || pend.claims?.some(pc => pc.text === claim.text))) return "pending";
      const score = supportScores[claim.claimId] ?? supportScores[claim.text];
      if (score != null && score < 0.5) return "direct";
      return "direct";
    }

    // 2. 최종 노트에서 블록이 빠짐 — 봉투째 보류면 pending, 주장 단위로 보존된 것도 pending,
    //    나머지는 dropped 의 직접/동반/연쇄 판별로 넘긴다(주장 보류와 별개로 블록이 다른 사유로 떨어졌을 수 있다).
    if (pend?.envelope) return "pending";
    if (pend && (pend.paths?.includes(claim.path) || pend.claims?.some(pc => pc.text === claim.text))) return "pending";
    const dropEntry = (droppedBlocks || []).find(d => d.blockId === blockId);
    if (dropEntry) {
      if (dropEntry.cause === "cascade") return "cascade";
      // 직접 보류인지 블록 동반 손실인지 판별:
      // 이 주장 자체가 저점수(<0.5)이거나 검증 실패 원인인가?
      const score = supportScores[claim.claimId] ?? supportScores[claim.text];
      if (score != null) {
        if (score < 0.5) return "direct";
        // 주장의 지지 점수는 양호한데 블록 전체가 다른 이유로 떨어졌다면 블록 동반 손실
        return "collateral";
      }
      // 판정 점수가 없는 경우
      if (dropEntry.codes?.includes("VAL_SUPPORT_LOW")) {
        return "collateral";
      }
      return "direct";
    }

    // 3. pruned 대상에 속하는지 확인
    const isPruned = (prunedItems || []).some(p => p.id && p.id.startsWith(blockId));
    if (isPruned) return "cascade";

    return "unjudged";
  }

  // 지표 계산 (제안서 §4)
  // - judge_low_rate = 초기 low / 초기 judged — 분모는 이 초안에서 실제 점수가 있는 주장 수다. 주장별로
  //   claimId 키 우선·text 키 보조로 한 번만 읽으므로 두 키가 같은 주장을 가리켜도 중복으로 세지 않고,
  //   다른 실행의 잔여 키도 초안 주장에 매칭되지 않아 자연히 빠진다.
  // - collateral_loss_rate = 직접 저점수 때문이 아닌 블록/참조 보류 주장 / 검증 전 초안 주장 (같은 claimId는 한 번만)
  // - 복구: repairs 입력이 정본(measured). 암호화 기록만 있으면 outcomes 에서 수락(relinked·fixed)과
  //   필요(저점수 주장 수)는 복원되지만 실제 시도는 복원되지 않는다 — 예산 건너뜀·미시도를 시도와 구분할
  //   수 없으므로 attempted 는 null(미측정)이고 recovery.needed 가 기록 분모다. 건너뜀·호출 실패·재판정
  //   누락도 기록에 없어 명시 입력일 때만 숫자다.
  function calculateComparisonMetrics({ claims = [], supportScores = {}, repairs = [], outcomes = {} } = {}) {
    const uniqueClaims = new Map();
    for (const c of claims) {
      if (!uniqueClaims.has(c.claimId)) uniqueClaims.set(c.claimId, c);
    }
    const list = [...uniqueClaims.values()];
    const scoreOf = c => supportScores?.[c.claimId] ?? (typeof c.text === "string" ? supportScores?.[c.text] : undefined);
    const outcomeOf = c => outcomes?.[c.claimId] ?? (typeof c.text === "string" ? outcomes?.[c.text] : undefined);

    let initialJudged = 0, initialLow = 0, relinked = 0, fixed = 0, outcomeClaims = 0;
    if (list.length) {
      for (const c of list) {
        const sc = scoreOf(c);
        if (typeof sc === "number" && Number.isFinite(sc)) { initialJudged++; if (sc < 0.5) initialLow++; }
        const oc = outcomeOf(c);
        if (oc != null) { outcomeClaims++; if (oc === "relinked") relinked++; else if (oc === "fixed") fixed++; }
      }
    } else {
      // 주장 목록이 없는 직접 호출은 맵 항목 전수를 센다(하위 호환).
      for (const sc of Object.values(supportScores || {})) if (typeof sc === "number" && Number.isFinite(sc)) { initialJudged++; if (sc < 0.5) initialLow++; }
      for (const oc of Object.values(outcomes || {})) { outcomeClaims++; if (oc === "relinked") relinked++; else if (oc === "fixed") fixed++; }
    }
    const judge_low_rate = initialJudged > 0 ? Number((initialLow / initialJudged).toFixed(4)) : null;

    const totalDraftClaims = uniqueClaims.size;
    let collateralCount = 0;
    for (const c of uniqueClaims.values()) {
      if (c.status === "collateral" || c.status === "cascade") collateralCount++;
    }
    const collateral_loss_rate = totalDraftClaims > 0 ? Number((collateralCount / totalDraftClaims).toFixed(4)) : null;

    const explicitRepairs = (repairs || []).length > 0;
    const repairStats = {
      attempted: explicitRepairs ? repairs.length : null,
      accepted: explicitRepairs ? repairs.filter(r => r.ok).length : relinked + fixed,
      skippedBudget: explicitRepairs ? repairs.filter(r => r.skippedBudget).length : null,
      unjudged: explicitRepairs ? repairs.filter(r => r.unjudged).length : null,
      networkFailed: explicitRepairs ? repairs.filter(r => r.failed).length : null,
      measured: explicitRepairs,
    };

    return {
      judge_low_rate,
      collateral_loss_rate,
      initialJudged,
      initialLow,
      totalDraftClaims,
      collateralClaims: collateralCount,
      repairStats,
      outcomeClaims,
      recovery: { needed: initialLow, relinked, fixed, recovered: relinked + fixed },
    };
  }

  // 선택한 주장의 근거 id와 일치하는 근거 목록만 필터링한다.
  function filterEvidenceForClaim(evidenceList = [], claimOrIds = null) {
    if (!claimOrIds) return evidenceList;
    const ids = Array.isArray(claimOrIds)
      ? new Set(claimOrIds)
      : new Set(claimOrIds.evidenceIds || []);
    if (!ids.size) return [];
    return (evidenceList || []).filter(e => ids.has(e.id));
  }

  // 학습 항목 커버리지 원장(제안서 §3): Note.coverage.items 는 id·kind·importance·status·reason·sectionId 뿐이다 — 항목 텍스트는 없다.
  const COVERAGE_STATUS_LABELS = { included: "포함", merged: "병합", deferred: "보류", excluded: "제외" };
  const COVERAGE_REASON_LABELS = { duplicate: "중복", off_lecture: "수업 밖", unrecognizable: "인식 불가", out_of_scope: "범위 밖" };
  function coverageLedger(note) {
    const items = Array.isArray(note?.coverage?.items) ? note.coverage.items : null;
    if (!items) return null;
    const counts = { included: 0, merged: 0, deferred: 0, excluded: 0 };
    for (const it of items) if (counts[it.status] !== undefined) counts[it.status]++;
    return { items, counts, total: items.length };
  }

  // 복호화된 레코드들을 모아 네 칸 비교 화면용 전체 모델을 생성한다.
  // 규칙: 검증 전 초안 캐시가 없으면 과거 노트로 복원하지 않고 { available: false, reason: "새 실행 필요" } 반환.
  function buildComparisonModel(inputs = {}) {
    let { evidence = [], draft = null, finalNote = null, supportScores = {}, repairs = [], records = {} } = inputs;
    let support = null, input = null;
    const supportCands = [];

    // records 맵이 전달된 경우 자동 추출
    if (records && typeof records === "object") {
      for (const [id, val] of Object.entries(records)) {
        const v = val?.value ?? val;
        if (!v || typeof v !== "object") continue;
        if (id === "note" || v.noteSpecVersion) finalNote ??= v;
        if (id === "input") input ??= v;
        if (v.ir?.units && Array.isArray(v.evidence)) evidence = v.evidence;
        if (Array.isArray(v.sections) && Array.isArray(v.failed)) draft ??= v;
        // validating 단계 캐시의 주장별 첫 점수·결과 맵(stages.js support 필드). 재실행 캐시가 여러 개일 수 있어 모아 둔다.
        if (v.support && typeof v.support === "object") supportCands.push(v.support);
        if (v.importance && typeof v.importance === "object") {
          // importance 캐시
        }
      }
    }

    // 초안 캐시 부재 시 불변식 강제
    if (!draft || !Array.isArray(draft.sections) || !draft.sections.length) {
      return {
        available: false,
        reason: "새 실행 필요",
        evidence: evidence || [],
        finalNote: finalNote || null,
        coverage: coverageLedger(finalNote),
      };
    }

    const droppedBlocks = finalNote?.dropped || [];
    const prunedItems = finalNote?.pruned || [];
    const pending = finalNote?.pending || [];

    // 초안의 모든 섹션/블록/주장 평탄화 및 상태 판정
    const sections = [];
    const allClaims = [];

    for (const sec of draft.sections) {
      const secOutput = sec.output || {};
      const blocks = [];
      const blocksObj = secOutput.blocks || {};

      for (const [blockKey, env] of Object.entries(blocksObj)) {
        const blockId = env?.id || blockKey;
        const blockType = env?.type || "";
        // 경로는 봉투 루트 기준(/content/...) — stages.js 의 pending.paths·support 맵 키와 같은 기준이어야 한다.
        const claims = extractClaims(env, blockId);
        for (const c of claims) {
          c.sectionId = sec.sectionId;
          c.type = blockType;
          allClaims.push(c);
        }
        blocks.push({
          blockId,
          type: blockType,
          envelope: env,
          claims,
        });
      }

      sections.push({
        sectionId: sec.sectionId,
        title: secOutput.title ?? sec.title ?? sec.sectionId,
        gist: secOutput.gist ?? null,
        blocks,
      });
    }

    // 재실행으로 validating 캐시가 여러 개면 현재 초안의 claimId 와 가장 많이 겹치는 support 맵을 고른다.
    if (supportCands.length) {
      const ids = new Set(allClaims.map(c => c.claimId));
      let best = -1;
      for (const cand of supportCands) {
        const keys = Object.keys({ ...(cand.scores || {}), ...(cand.outcomes || {}) });
        const hit = keys.reduce((n, k) => n + (ids.has(k) ? 1 : 0), 0);
        if (hit > best) { best = hit; support = cand; }
      }
    }

    // 지지 점수 맵은 기록이 정본 — 명시 supportScores 가 오면 같은 키만 덮어쓴다. 암호화 기록만 불러와도
    // 실시간 메모리 경로와 같은 주장 점수·복구 분모가 나와야 한다(후속 검토 §4).
    const recScores = support?.scores && typeof support.scores === "object" ? support.scores : {};
    const recOutcomes = support?.outcomes && typeof support.outcomes === "object" ? support.outcomes : {};
    const effScores = { ...recScores, ...(supportScores || {}) };
    // 복구 기록: repairs 입력이 없으면 결과 맵의 fixed 수락을 주장 단위로 복원해 추론에 쓴다 —
    // 블록 단위로 두면 같은 블록의 다른 주장까지 복구 성공으로 잘못 표시된다. relinked 는 복구 호출이 아니라
    // 근거 재연결이라 repairs 로 만들지 않는다(추론 경로가 evidenceIds 비교로 알아낸다).
    let effRepairs = repairs || [];
    if (!effRepairs.length) {
      effRepairs = Object.keys(recOutcomes)
        .filter(id => recOutcomes[id] === "fixed")
        .map(id => ({ claimId: id, blockId: String(id).split("#")[0], ok: true }));
    }

    for (const c of allClaims) {
      c.status = inferClaimStatus(c, { finalNote, droppedBlocks, prunedItems, supportScores: effScores, repairs: effRepairs, pending });
      c.statusLabel = STATUS_LABELS[c.status] || "미판정";
    }

    if (support) {
      for (const c of allClaims) {
        const sc = support.scores?.[c.claimId];
        if (typeof sc === "number" && Number.isFinite(sc)) c.score = sc;
        const oc = support.outcomes?.[c.claimId];
        // T5 결과는 추론보다 정본이다 — 있으면 상태로 쓴다(shadow 실행은 이 값이 가상의 보류 판정이다).
        if (typeof oc === "string" && STATUS_LABELS[oc]) {
          c.outcome = oc;
          c.status = oc;
          c.statusLabel = STATUS_LABELS[oc];
        }
      }
    }

    const metrics = calculateComparisonMetrics({
      claims: allClaims,
      supportScores: effScores,
      repairs,
      outcomes: recOutcomes,
    });

    return {
      available: true,
      evidence: evidence || [],
      draft: {
        sections,
        failed: draft.failed || [],
      },
      claims: allClaims,
      finalNote: finalNote || null,
      input: input || null,
      coverage: coverageLedger(finalNote),
      metrics,
    };
  }

  // 평가 경로(실험 arm) 추정: 입력 옵션의 judgeShadow → shadow, 최종 노트에 pending 보존이 있으면 preserve,
  // 둘 다 아니면 예전 삭제 경로 current_delete. 확신 못 하면 화면에서 운영자가 바꾼다.
  function detectEvalPath({ input = null, note = null } = {}) {
    if (input?.options?.judgeShadow === true) return "shadow";
    if (note?.pending?.length) return "preserve";
    return "current_delete";
  }

  // 패키지 메타의 createdAt 을 덮는 작업을 찾는다 — 겹치는 게 여러 개면 가장 늦게 끝난 것, 없으면 null.
  function jobForPackage(jobs = [], createdAt = null) {
    const t = Date.parse(createdAt ?? "");
    if (!Number.isFinite(t)) return null;
    const hit = (jobs || []).filter(j => Number.isFinite(j.start) && Number.isFinite(j.end) && j.start <= t && t <= j.end + 60000);
    if (!hit.length) return null;
    hit.sort((a, b) => b.end - a.end);
    return hit[0];
  }

  // 평가 하네스(tools/eval-notes.mjs)용 실행 기록 — 로컬 다운로드 전용, 서버 전송 경로가 없다.
  // claims[].status 는 그 경로의 최종 결정(유지·보류), score 는 첫 Jev 점수(없으면 null), required 는
  // 필수 학습 항목 표시(W2-B coverage 가 생기기 전엔 null).
  function buildEvalExport(model, { packageId = null, lectureId = null, path = null, run = {} } = {}) {
    if (!model?.available) return null;
    return {
      tool: "summrizei-eval-run",
      version: 1,
      exportedAt: new Date().toISOString(),
      packageId: packageId ?? null,
      lectureId: lectureId || packageId || null,
      path: path || detectEvalPath({ input: model.input, note: model.finalNote }),
      run: {
        jobId: run.jobId ?? null,
        costUsd: Number.isFinite(run.costUsd) ? run.costUsd : null,
        ms: Number.isFinite(run.ms) ? run.ms : null,
        // 비용 보고 커버리지: 관측 수/호출 수 — costObs < costCalls 면 일부 호출만 비용이 보고된 부분 측정이다.
        costObs: Number.isInteger(run.costObs) && run.costObs >= 0 ? run.costObs : null,
        costCalls: Number.isInteger(run.costCalls) && run.costCalls >= 0 ? run.costCalls : null,
      },
      claims: (model.claims || []).map(c => ({
        claimId: c.claimId,
        blockId: c.blockId ?? null,
        sectionId: c.sectionId ?? null,
        pointer: c.path ?? null,
        type: c.type ?? null,
        basis: c.basis ?? null,
        text: c.text ?? "",
        evidenceIds: Array.isArray(c.evidenceIds) ? c.evidenceIds : [],
        score: Number.isFinite(c.score) ? c.score : null,
        status: c.status ?? "unjudged",
        required: c.required === true ? true : null,
      })),
      evidence: (model.evidence || []).map(e => ({ id: e.id ?? null, kind: e.kind ?? null, unitId: e.unitId ?? null, text: e.text ?? "" })),
      coverage: model.finalNote?.coverage ?? null,
    };
  }

  const api = {
    STATUS_LABELS,
    COVERAGE_STATUS_LABELS,
    COVERAGE_REASON_LABELS,
    coverageLedger,
    claimsIn,
    extractClaims,
    inferClaimStatus,
    calculateComparisonMetrics,
    filterEvidenceForClaim,
    buildComparisonModel,
    detectEvalPath,
    jobForPackage,
    buildEvalExport,
  };

  globalThis.AdminView = api;
  if (typeof module !== "undefined") module.exports = api;
})();
