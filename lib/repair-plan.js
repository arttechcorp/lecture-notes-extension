// 피드백 루프 제어기(RepairPlan) — 제안서 §4.4 (우측 분석 반영, sol-luna-2 / sol-fork-2 공통).
// 실패 원인 분류, 서명 비교(동일 오류 반복 방지), 복구 예산 및 단계 결정, 비내용 메트릭 집계.
// 순수 함수 및 불변 메모리 상태 관리 — I/O 및 네트워크 없음.
(() => {
  // 지원 원인(7종) 및 대상 단위(3종)
  const CAUSES = Object.freeze([
    "no_evidence",
    "writer_null",
    "policy",
    "schema_format",
    "t5_low",
    "root_loss",
    "figure_missing",
  ]);

  const UNITS = Object.freeze(["block", "claim", "section"]);

  const ACTIONS = Object.freeze([
    "none",
    "code_normalize",
    "sol_repair",
    "regenerate_missing",
    "relink",
    "t5_minimal_edit",
    "restore_dependents",
  ]);

  // 의미 재작성(semantic rewrite)에 해당하는 원인/작업 — 대상당 최대 1회(perTargetSemantic)
  const SEMANTIC_ACTIONS = new Set([
    "writer_null",
    "regenerate_missing",
    "sol_repair",
    "t5_minimal_edit",
    "semantic",
    "rewrite",
  ]);

  // ── 1. 실패 원인 분류 (classifyFailure) ───────────────────────────────────
  // item 에서 { cause, unit, target, root? } 를 추출·정규화한다.
  function classifyFailure(item) {
    if (!item || typeof item !== "object") {
      return { cause: "writer_null", unit: "block", target: "unknown" };
    }

    // 대상 식별자(target) 결정
    let target = item.target || item.targetId || item.claimId || item.blockId || item.id || item.sectionId;
    if (!target && item.bid && item.path) target = `${item.bid}#${item.path}`;
    target = String(target || "unknown");

    // 단위(unit: 'block' | 'claim' | 'section') 결정
    let unit = item.unit;
    if (!unit || !UNITS.includes(unit)) {
      if (item.sectionId && !item.blockId && !item.id && !item.bid) unit = "section";
      else if (item.claimId || item.claim || item.path || target.includes("#")) unit = "claim";
      else unit = "block";
    }

    // 선행 원인(root) 식별
    const root = item.root || item.rootId || item.dependsOn || item.parent || undefined;

    // 오류 코드 모음
    const codes = [];
    if (item.code) codes.push(String(item.code));
    if (Array.isArray(item.errors)) {
      for (const e of item.errors) codes.push(typeof e === "string" ? e : String(e?.code || ""));
    }

    // 원인(cause) 판별
    let cause = item.cause;
    if (!cause || !CAUSES.includes(cause)) {
      if (item.cause === "cascade" || root || codes.some(c => /CASCADE|DEPENDENCY_DROPPED|TARGET_DROPPED|CALC_DROPPED|ANCHOR_DROPPED/.test(c))) {
        cause = "root_loss";
      } else if (item.nullReason === "policy" || codes.some(c => /POLICY|PLACEMENT|PERMISSION|DRM/.test(c))) {
        cause = "policy";
      } else if (item.nullReason === "insufficient_evidence" || item.hasEvidence === false || item.noEvidence === true
        || codes.some(c => /EVIDENCE_MISSING|EVIDENCE_UNKNOWN|NUMBER_MISSING|GLOBAL_EVIDENCE_NEW/.test(c))) {
        cause = "no_evidence";
      } else if (item.kind === "figure" || item.figureId || codes.some(c => /FIGURE/.test(c)) || item.cause === "figure_missing") {
        cause = "figure_missing";
      } else if (codes.some(c => /SUPPORT_LOW/.test(c)) || item.t5 || (typeof item.score === "number" && item.score < 0.5) || item.outcome === "low") {
        cause = "t5_low";
      } else if (item.nullReason === "unsupported_format" || item.salvaged != null
        || codes.some(c => /SCHEMA|TABLE_SHAPE|TABLE_EMPTY_ROW|CALC_|REF_UNKNOWN|ANSWER_SHAPE|STATUS_UNEXPLAINED|MAP_|ORIGINAL_UNSUPPORTED|QUOTE_NOT_FOUND|DUE_NOT_FOUND|DERIVED_INVALID/.test(c))) {
        cause = "schema_format";
      } else if (item.envelope === null || item.nullReason === "unknown" || item.writerHeld || codes.some(c => c === "VAL_BLOCK_DECLINED")) {
        cause = "writer_null";
      } else {
        cause = codes.some(c => /SCHEMA/.test(c)) ? "schema_format" : "writer_null";
      }
    }

    const res = { cause, unit, target };
    if (root) res.root = String(root);
    return res;
  }

  // ── 2. 오류 서명 생성 (signatureOf) ─────────────────────────────────────────
  // 오류 코드와 경로로 안정적 문자열을 구성한다 (메모리 전용, 해시 및 전송 금지).
  function signatureOf(errors) {
    if (!errors) return "";
    const list = Array.isArray(errors) ? errors : (errors.errors && Array.isArray(errors.errors) ? errors.errors : [errors]);
    if (!list.length) return "";

    const tokens = [];
    for (const err of list) {
      if (!err) continue;
      if (typeof err === "string") {
        tokens.push(err.trim().slice(0, 80));
        continue;
      }
      const code = String(err.code || "ERR").trim();
      const rawPaths = [];
      if (err.path) rawPaths.push(String(err.path));
      if (Array.isArray(err.paths)) for (const p of err.paths) if (p) rawPaths.push(String(p));
      if (Array.isArray(err.detail)) {
        for (const d of err.detail) {
          if (typeof d === "string" && (d.startsWith("/") || d.startsWith("schema:") || /^[A-Z0-9_#]+$/.test(d))) {
            rawPaths.push(d);
          }
        }
      }
      const normPaths = Array.from(new Set(rawPaths.map(p => p.trim()))).sort();
      tokens.push(normPaths.length ? `${code}:${normPaths.join(",")}` : code);
    }

    return Array.from(new Set(tokens)).sort().join(";");
  }

  // ── 3. 복구 예산 관리자 (RepairBudget) ───────────────────────────────────────
  // 공통 금액 상한, 대상별 의미 재작성 최대 1회, 원인별 시도 상한을 관리한다.
  class RepairBudget {
    constructor({ maxUsd = Infinity, perTargetSemantic = 1, perCause = 1 } = {}) {
      this.maxUsd = typeof maxUsd === "number" ? maxUsd : Infinity;
      this.perTargetSemantic = typeof perTargetSemantic === "number" ? perTargetSemantic : 1;
      this.perCause = typeof perCause === "number" ? perCause : 1;
      this.spentUsd = 0;
      this.attemptsByTargetCause = new Map(); // `${target}#${cause}` -> count
      this.semanticAttemptsByTarget = new Map(); // target -> count
      this.successfulTargets = new Set();
      this.costByCause = {};
      this.history = [];
    }

    static isSemantic(causeOrAction) {
      return SEMANTIC_ACTIONS.has(String(causeOrAction));
    }

    canAttempt(target, cause, estUsd = 0) {
      const tgt = String(target);
      const c = String(cause);

      // 이미 성공한 대상은 다시 시도하지 않는다
      if (this.successfulTargets.has(tgt)) return false;

      // 금액 예산 초과 검사
      const cost = typeof estUsd === "number" ? estUsd : 0;
      if (this.spentUsd + cost > this.maxUsd) return false;

      // 원인별 시도 상한
      const causeKey = `${tgt}#${c}`;
      const count = this.attemptsByTargetCause.get(causeKey) || 0;
      if (count >= this.perCause) return false;

      // 대상별 의미 재작성 상한 (perTargetSemantic)
      if (RepairBudget.isSemantic(c)) {
        const semCount = this.semanticAttemptsByTarget.get(tgt) || 0;
        if (semCount >= this.perTargetSemantic) return false;
      }

      return true;
    }

    record(target, cause, { ok = false, improved = false, usd = 0 } = {}) {
      const tgt = String(target);
      const c = String(cause);
      const cost = typeof usd === "number" && !Number.isNaN(usd) ? usd : 0;

      this.spentUsd += cost;
      this.costByCause[c] = (this.costByCause[c] || 0) + cost;

      const causeKey = `${tgt}#${c}`;
      this.attemptsByTargetCause.set(causeKey, (this.attemptsByTargetCause.get(causeKey) || 0) + 1);

      if (RepairBudget.isSemantic(c)) {
        this.semanticAttemptsByTarget.set(tgt, (this.semanticAttemptsByTarget.get(tgt) || 0) + 1);
      }

      if (ok) this.successfulTargets.add(tgt);

      const entry = { target: tgt, cause: c, ok: !!ok, improved: !!improved, usd: cost };
      this.history.push(entry);
      return entry;
    }

    snapshot() {
      return {
        maxUsd: this.maxUsd,
        spentUsd: this.spentUsd,
        remainingUsd: this.maxUsd === Infinity ? Infinity : Math.max(0, this.maxUsd - this.spentUsd),
        perTargetSemantic: this.perTargetSemantic,
        perCause: this.perCause,
        attempts: this.history.length,
        successes: this.successfulTargets.size,
        successfulTargets: Array.from(this.successfulTargets),
        costByCause: { ...this.costByCause },
      };
    }
  }

  // ── 표 형식 정규화 보조 (normalizeTableShape) ──────────────────────────────
  // 셀 길이를 맞추고 빈 행을 정리하되, 이미 통과한 주장은 원형 그대로 보존한다.
  function normalizeTableShape(content) {
    if (!content || typeof content !== "object") return content;
    const out = JSON.parse(JSON.stringify(content));
    const entities = Array.isArray(out.entities) ? out.entities : [];
    if (!Array.isArray(out.criteria)) return out;

    out.criteria = out.criteria
      .filter(cr => cr && Array.isArray(cr.cells) && cr.cells.some(c => c != null))
      .map(cr => {
        const cells = cr.cells.slice(0, entities.length);
        while (cells.length < entities.length) cells.push(null);
        return { ...cr, cells };
      });
    return out;
  }

  // ── 4. 다음 복구 단계 결정 (nextRepairStep) ─────────────────────────────────
  // 우선순위: 핵심 learningItem 선행 root -> 핵심 조건·예외 -> required visual -> 나머지 (score 순 아님).
  function nextRepairStep(state = {}) {
    const rawCandidates = state.failures || state.candidates || state.items || [];
    if (!Array.isArray(rawCandidates) || !rawCandidates.length) {
      return { action: "none", targets: [], reason: "no_candidates" };
    }

    const budget = state.budget instanceof RepairBudget ? state.budget : null;
    const succeeded = new Set([
      ...(Array.isArray(state.succeeded) ? state.succeeded : (state.succeeded instanceof Set ? Array.from(state.succeeded) : [])),
      ...(Array.isArray(state.recovered) ? state.recovered : []),
      ...(budget ? Array.from(budget.successfulTargets) : []),
    ].map(String));

    const relinked = new Set([
      ...(Array.isArray(state.relinked) ? state.relinked : (state.relinked instanceof Set ? Array.from(state.relinked) : [])),
    ].map(String));

    const reviewRecovered = new Set([
      ...(Array.isArray(state.reviewRecovered) ? state.reviewRecovered : (state.reviewRecovered instanceof Set ? Array.from(state.reviewRecovered) : [])),
    ].map(String));

    const aliases = state.aliases instanceof Map ? state.aliases : new Map(Object.entries(state.aliases || {}));
    const signatures = state.signatures instanceof Map ? state.signatures : new Map(Object.entries(state.signatures || {}));
    const rootStatus = state.rootStatus instanceof Map ? state.rootStatus : new Map(Object.entries(state.rootStatus || {}));

    // 우선순위 계층 계산: 1: core root, 2: condition/exception, 3: required visual, 4: rest
    function getTier(item, classified) {
      if (item.isCoreRoot || (item.isCore && classified.cause !== "root_loss" && !classified.root)) return 1;
      if (item.role === "condition" || item.role === "exception" || item.isCondition || item.isException) return 2;
      if (item.isRequiredVisual || item.requiredVisual || (item.kind === "figure" && item.required)) return 3;
      return 4;
    }

    // 후보군 파싱 및 분류
    const parsed = rawCandidates.map((c, idx) => {
      const cls = classifyFailure(c);
      const tier = getTier(c, cls);
      return { raw: c, cls, tier, idx };
    });

    // Tier 기준 정렬 (동일 Tier 내에서는 원본 순서 유지 — 점수 최저 순 아님)
    parsed.sort((a, b) => a.tier - b.tier || a.idx - b.idx);

    let skippedBudgetCount = 0;
    let skippedNoProgressCount = 0;
    let skippedNoEvidenceCount = 0;
    let rootFailedCount = 0;

    for (let i = 0; i < parsed.length; i++) {
      const { raw, cls } = parsed[i];
      const target = cls.target;
      const cause = cls.cause;

      // 1) 이미 성공한 대상은 다시 시도하지 않음
      if (succeeded.has(target)) continue;

      // 2) 검수에서 이미 복구된 대상은 새 id로 재요청 불가
      const originalId = aliases.get(target);
      if (reviewRecovered.has(target) || (originalId && reviewRecovered.has(originalId))) {
        continue;
      }

      // 3) relink 성공 시 rewrite 0회
      if (cause === "t5_low" && (relinked.has(target) || raw.relinked || raw.outcome === "relinked")) {
        continue;
      }

      // 4) 정책 거절은 모델 우회 금지
      if (cause === "policy") {
        continue;
      }

      // 5) 동일 오류 서명 + 새 근거 부재 시 재시도 중단
      const curSig = signatureOf(raw.errors || raw.signature || []);
      const prevSig = signatures.get(target);
      const hasNewEvidence = raw.hasNewEvidence === true
        || (typeof state.hasNewEvidence === "boolean" && state.hasNewEvidence)
        || (state.hasNewEvidence && typeof state.hasNewEvidence === "object" && !!state.hasNewEvidence[target]);

      if (curSig && prevSig && curSig === prevSig && !hasNewEvidence) {
        skippedNoProgressCount++;
        continue;
      }

      // 6) 근거 부족 확인
      const hasEvidence = raw.hasEvidence !== false && raw.noEvidence !== true
        && raw.nullReason !== "insufficient_evidence" && cause !== "no_evidence";
      if (!hasEvidence && (cause === "writer_null" || cause === "no_evidence" || cause === "t5_low")) {
        skippedNoEvidenceCount++;
        continue;
      }

      // 7) root loss 확인
      if (cause === "root_loss" || cls.root) {
        const rootId = cls.root;
        const isRootOk = rootId && (rootStatus.get(rootId) === true || succeeded.has(rootId));
        if (!isRootOk) {
          // root 실패 시 종속 주장은 확정 표시하지 않고 보류
          rootFailedCount++;
          continue;
        }
      }

      // 8) 실행할 action 결정
      let action = "none";
      if (cause === "root_loss" && cls.root) {
        action = "restore_dependents";
      } else if (cause === "schema_format") {
        action = raw.codeNormalized ? "sol_repair" : "code_normalize";
      } else if (cause === "writer_null") {
        action = "regenerate_missing";
      } else if (cause === "t5_low") {
        action = (!raw.relinkAttempted && !relinked.has(target)) ? "relink" : "t5_minimal_edit";
      } else if (cause === "figure_missing") {
        action = raw.codeNormalized ? "sol_repair" : "code_normalize";
      } else {
        action = "sol_repair";
      }

      // 9) 예산 한도 검사
      const estUsd = typeof raw.estUsd === "number" ? raw.estUsd
        : (action === "code_normalize" || action === "restore_dependents" ? 0 : 0.05);

      if (budget && !budget.canAttempt(target, action, estUsd) && !budget.canAttempt(target, cause, estUsd)) {
        skippedBudgetCount++;
        continue;
      }

      // 이 후보와 동일한 Tier에서 동일 action을 공유하는 대상들을 최대 12개까지 배치
      const batchTargets = [target];
      for (let j = i + 1; j < parsed.length && batchTargets.length < 12; j++) {
        const other = parsed[j];
        if (other.tier !== parsed[i].tier) break; // 동일 Tier 내에서만 배치
        const oTarget = other.cls.target;
        if (succeeded.has(oTarget) || reviewRecovered.has(oTarget)) continue;

        // 동일 action 자격 검사
        let otherAction = "none";
        if (other.cls.cause === "root_loss" && other.cls.root) {
          if (rootStatus.get(other.cls.root) === true || succeeded.has(other.cls.root)) otherAction = "restore_dependents";
        } else if (other.cls.cause === "schema_format") {
          otherAction = other.raw.codeNormalized ? "sol_repair" : "code_normalize";
        } else if (other.cls.cause === "writer_null") {
          const oHasEv = other.raw.hasEvidence !== false && other.raw.noEvidence !== true;
          if (oHasEv) otherAction = "regenerate_missing";
        } else if (other.cls.cause === "t5_low") {
          otherAction = (!other.raw.relinkAttempted && !relinked.has(oTarget)) ? "relink" : "t5_minimal_edit";
        }

        if (otherAction === action) {
          const oEst = typeof other.raw.estUsd === "number" ? other.raw.estUsd
            : (action === "code_normalize" || action === "restore_dependents" ? 0 : 0.05);
          if (!budget || budget.canAttempt(oTarget, action, oEst)) {
            batchTargets.push(oTarget);
          }
        }
      }

      const reason = raw.reason || `${action}_${cause}`;
      return { action, targets: batchTargets, reason };
    }

    // 복구 가능한 후보가 없는 경우 사유 판정
    let reason = "no_eligible_targets";
    if (skippedBudgetCount > 0) reason = "budget_exhausted";
    else if (skippedNoProgressCount > 0) reason = "no_progress";
    else if (skippedNoEvidenceCount > 0) reason = "no_evidence";
    else if (rootFailedCount > 0) reason = "root_unrecovered";
    else if (parsed.every(p => succeeded.has(p.cls.target))) reason = "all_resolved";

    return { action: "none", targets: [], reason };
  }

  // ── 5. 비내용 메트릭 집계 (metricsOf) ─────────────────────────────────────────
  // 콘텐츠 없는 지표를 대상(TARGET) 단위로 집계한다 (이벤트 건수 아님).
  function metricsOf(events = []) {
    const eligible = new Set();
    const attempted = new Set();
    const succeeded = new Set();
    const stillBad = new Set();
    const skippedNoEvidence = new Set();
    const skippedBudget = new Set();
    const stoppedNoProgress = new Set();
    const declinedRecovered = new Set();
    const rootRecovered = new Set();
    const dependentRestored = new Set();
    const costByCause = {};

    const list = Array.isArray(events) ? events : [];
    for (const ev of list) {
      if (!ev || typeof ev !== "object") continue;
      const target = ev.target || ev.targetId || ev.id || ev.blockId || ev.claimId || ev.sectionId;
      if (!target) continue;
      const tgt = String(target);

      const type = String(ev.type || ev.status || ev.code || "");
      const cause = String(ev.cause || "unknown");
      const usd = typeof ev.usd === "number" ? ev.usd : (typeof ev.costUsd === "number" ? ev.costUsd : (typeof ev.cost === "number" ? ev.cost : 0));

      if (usd > 0) {
        costByCause[cause] = (costByCause[cause] || 0) + usd;
      }

      if (type === "eligible" || type === "REPAIR_ELIGIBLE" || ev.eligible) {
        eligible.add(tgt);
      }
      if (type === "attempt" || type === "attempted" || ev.attempted) {
        attempted.add(tgt);
      }
      if (type === "succeeded" || type === "success" || type === "fixed" || ev.ok === true) {
        succeeded.add(tgt);
        stillBad.delete(tgt);
        if (ev.wasDeclined || cause === "writer_null" || ev.declined) {
          declinedRecovered.add(tgt);
        }
        if (ev.isRoot || cause === "root_loss" || ev.root) {
          rootRecovered.add(tgt);
        }
      }
      if (type === "still_bad" || type === "bad" || type === "stillBad" || ev.stillBad === true) {
        if (!succeeded.has(tgt)) {
          stillBad.add(tgt);
        }
      }
      if (type === "skipped_no_evidence" || type === "skippedNoEvidence" || ev.reason === "no_evidence") {
        skippedNoEvidence.add(tgt);
      }
      if (type === "skipped_budget" || type === "skippedBudget" || ev.reason === "budget" || ev.reason === "budget_exhausted") {
        skippedBudget.add(tgt);
      }
      if (type === "stopped_no_progress" || type === "stoppedNoProgress" || ev.reason === "no_progress" || ev.reason === "identical_signature") {
        stoppedNoProgress.add(tgt);
      }
      if (type === "declined_recovered" || type === "declinedRecovered") {
        declinedRecovered.add(tgt);
        succeeded.add(tgt);
        stillBad.delete(tgt);
      }
      if (type === "root_recovered" || type === "rootRecovered") {
        rootRecovered.add(tgt);
        succeeded.add(tgt);
        stillBad.delete(tgt);
      }
      if (type === "dependent_restored" || type === "dependentClaimsRestored" || ev.dependentRestored) {
        dependentRestored.add(tgt);
      }
    }

    return {
      repairEligible: eligible.size,
      attempted: attempted.size,
      succeeded: succeeded.size,
      stillBad: stillBad.size,
      skippedNoEvidence: skippedNoEvidence.size,
      skippedBudget: skippedBudget.size,
      stoppedNoProgress: stoppedNoProgress.size,
      declinedRecovered: declinedRecovered.size,
      rootRecovered: rootRecovered.size,
      dependentClaimsRestored: dependentRestored.size,
      costByCause,
    };
  }

  const api = {
    classifyFailure,
    signatureOf,
    RepairBudget,
    nextRepairStep,
    metricsOf,
    normalizeTableShape,
    CAUSES,
    UNITS,
    ACTIONS,
  };

  globalThis.RepairPlan = api;
  if (typeof module !== "undefined") module.exports = api;
})();
