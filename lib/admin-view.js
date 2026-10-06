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

  // T1 필드(status)가 있으면 우선 사용하고, 없으면 최종 노트 및 판정/보류 결과로부터 상태를 방어적으로 추론한다.
  // 상태: kept(유지), fixed(수정), relinked(재연결), pending/direct(직접 보류), collateral(블록 동반 손실), cascade(의존 연쇄 보류), unjudged(미판정)
  function inferClaimStatus(claim, context = {}) {
    if (typeof claim?.status === "string" && STATUS_LABELS[claim.status]) {
      return claim.status;
    }
    const { finalNote, droppedBlocks = [], prunedItems = [], supportScores = {}, repairs = [] } = context;
    const blockId = claim.blockId;

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
        // 주장이 최종 본문에 존재
        const wasRepaired = repairs.some(r => r.blockId === blockId && r.ok);
        if (wasRepaired) return "fixed";
        if (matched.claim.evidenceIds?.join(",") !== claim.evidenceIds?.join(",")) return "relinked";
        return "kept";
      }
      // 블록은 살았으나 주장 슬롯에서 제거됨 (예: T5 지원 미달로 해당 주장만 잘림)
      const score = supportScores[claim.claimId] ?? supportScores[claim.text];
      if (score != null && score < 0.5) return "direct";
      return "direct";
    }

    // 2. 최종 노트에서 블록이 빠짐
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
  // - judge_low_rate = 초기 low / 초기 judged
  // - collateral_loss_rate = 직접 저점수 때문이 아닌 블록/참조 보류 주장 / 검증 전 초안 주장 (같은 claimId는 한 번만)
  function calculateComparisonMetrics({ claims = [], supportScores = {}, repairs = [] } = {}) {
    let initialJudged = 0, initialLow = 0;
    for (const [id, score] of Object.entries(supportScores || {})) {
      if (typeof score === "number" && Number.isFinite(score)) {
        initialJudged++;
        if (score < 0.5) initialLow++;
      }
    }
    const judge_low_rate = initialJudged > 0 ? Number((initialLow / initialJudged).toFixed(4)) : null;

    const uniqueClaims = new Map();
    for (const c of claims) {
      if (!uniqueClaims.has(c.claimId)) uniqueClaims.set(c.claimId, c);
    }
    const totalDraftClaims = uniqueClaims.size;
    let collateralCount = 0;
    for (const c of uniqueClaims.values()) {
      if (c.status === "collateral" || c.status === "cascade") collateralCount++;
    }
    const collateral_loss_rate = totalDraftClaims > 0 ? Number((collateralCount / totalDraftClaims).toFixed(4)) : null;

    const repairStats = {
      attempted: (repairs || []).length,
      accepted: (repairs || []).filter(r => r.ok).length,
      skippedBudget: (repairs || []).filter(r => r.skippedBudget).length,
      unjudged: (repairs || []).filter(r => r.unjudged).length,
      networkFailed: (repairs || []).filter(r => r.failed).length,
    };

    return {
      judge_low_rate,
      collateral_loss_rate,
      initialJudged,
      initialLow,
      totalDraftClaims,
      collateralClaims: collateralCount,
      repairStats,
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

  // 복호화된 레코드들을 모아 네 칸 비교 화면용 전체 모델을 생성한다.
  // 규칙: 검증 전 초안 캐시가 없으면 과거 노트로 복원하지 않고 { available: false, reason: "새 실행 필요" } 반환.
  function buildComparisonModel(inputs = {}) {
    let { evidence = [], draft = null, finalNote = null, supportScores = {}, repairs = [], records = {} } = inputs;

    // records 맵이 전달된 경우 자동 추출
    if (records && typeof records === "object") {
      for (const [id, val] of Object.entries(records)) {
        const v = val?.value ?? val;
        if (!v || typeof v !== "object") continue;
        if (id === "note" || v.noteSpecVersion) finalNote ??= v;
        if (v.ir?.units && Array.isArray(v.evidence)) evidence = v.evidence;
        if (Array.isArray(v.sections) && Array.isArray(v.failed)) draft ??= v;
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
      };
    }

    const droppedBlocks = finalNote?.dropped || [];
    const prunedItems = finalNote?.pruned || [];

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
        const claims = extractClaims(env?.content, blockId);
        for (const c of claims) {
          c.status = inferClaimStatus(c, { finalNote, droppedBlocks, prunedItems, supportScores, repairs });
          c.statusLabel = STATUS_LABELS[c.status] || "미판정";
          c.sectionId = sec.sectionId;
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

    const metrics = calculateComparisonMetrics({
      claims: allClaims,
      supportScores,
      repairs,
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
      metrics,
    };
  }

  const api = {
    STATUS_LABELS,
    claimsIn,
    extractClaims,
    inferClaimStatus,
    calculateComparisonMetrics,
    filterEvidenceForClaim,
    buildComparisonModel,
  };

  globalThis.AdminView = api;
  if (typeof module !== "undefined") module.exports = api;
})();
