// tools/figure-trace.mjs
// 도표(Figure/Asset) 생명주기 및 퍼널 단계별 추적 도구 (docs/architecture-v2.md §5, 제안서 §8.1)
// 내용 없는 진단 이벤트(FIGURE_FUNNEL, COVERAGE 등)와 도표 ID 목록을 바탕으로
// asset 단위: 선택(funnel selection) -> 계획 배정(plan assignment) -> 본문 참조(body reference) -> 렌더(rendered)
// 각 단계의 분모(denominator)를 출력하고, 분모가 상이할 경우 경고를 보고한다.
// 원칙: 강의 내용·원문 누출 금지, 오직 ID·수치·상태 코드만 출력한다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

// k=v 파싱 헬퍼 (내용 없는 진단 이벤트 메시지 전용)
export function parseKvPairs(msg) {
  const pairs = {};
  for (const part of String(msg || "").trim().split(/\s+/)) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      const k = part.slice(0, idx);
      const v = part.slice(idx + 1);
      pairs[k] = Number.isFinite(Number(v)) ? Number(v) : v;
    }
  }
  return pairs;
}

/**
 * 진단 내보내기 입력(JSON 문자열, 객체, NDJSON)으로부터 이벤트 목록을 파싱한다.
 */
export function parseDiagnosticEvents(input) {
  if (!input) return [];

  // 파일 경로 문자열인 경우
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (fs.existsSync(input)) {
      const content = fs.readFileSync(input, "utf8").trim();
      return parseDiagnosticEvents(content);
    }

    // NDJSON 또는 JSON 문자열
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return parseDiagnosticEvents(parsed);
      } catch {
        // NDJSON 행 파싱 시도
      }
    }

    const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const events = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch {
        // 비 JSON 이벤트 줄 무시
      }
    }
    return events;
  }

  // 배열인 경우
  if (Array.isArray(input)) {
    return input;
  }

  // 객체인 경우 (exportData.events 또는 exportData 자체)
  if (typeof input === "object") {
    if (Array.isArray(input.events)) return input.events;
    if (input.code && input.msg) return [input];
  }

  return [];
}

/**
 * 도표 생명주기 및 퍼널 추적 순수 함수.
 * @param {object|array|string} diagnosticExport 내용 없는 진단 내보내기 또는 이벤트 목록
 * @param {object} [options]
 * @param {string[]} [options.assetIds] 추적할 도표/자산 ID 목록 (미지정 시 이벤트/진단에서 자동 수집)
 * @returns {object} { summary, assets, denominators, warnings }
 */
export function traceFigures(diagnosticExport, options = {}) {
  const events = parseDiagnosticEvents(diagnosticExport);
  const rawObj = (typeof diagnosticExport === "object" && !Array.isArray(diagnosticExport)) ? diagnosticExport : {};

  // 1. FIGURE_FUNNEL 및 COVERAGE 이벤트 집계 추출
  let funnelRaw = null;
  let coverageRaw = null;
  const perAssetEvents = new Map(); // id -> { selected, plan, ref, render, reasons: [] }
  const renderWarnings = new Map(); // id -> [code]

  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;

    if (ev.code === "FIGURE_FUNNEL") {
      funnelRaw = parseKvPairs(ev.msg);
    } else if (ev.code === "COVERAGE") {
      coverageRaw = parseKvPairs(ev.msg);
    } else if (ev.code === "RENDER_REF_UNKNOWN" || ev.code === "RENDER_CROP_REJECTED" || ev.code === "RENDER_CHART_INVALID") {
      const targetId = ev.unit || ev.msg || (Array.isArray(ev.ids) ? ev.ids[0] : null);
      if (targetId) {
        const list = renderWarnings.get(targetId) || [];
        list.push(ev.code);
        renderWarnings.set(targetId, list);
      }
    } else if (ev.code === "FIGURE_TRACE" || ev.code === "FIGURE_ASSET") {
      const kv = parseKvPairs(ev.msg);
      const id = kv.id || ev.unit;
      if (id) {
        perAssetEvents.set(id, {
          selected: kv.selected !== undefined ? Boolean(kv.selected) : null,
          planAssigned: kv.plan !== undefined ? Boolean(kv.plan) : (kv.planAssigned !== undefined ? Boolean(kv.planAssigned) : null),
          bodyReferenced: kv.text !== undefined ? Boolean(kv.text) : (kv.body !== undefined ? Boolean(kv.body) : (kv.ref !== undefined ? Boolean(kv.ref) : null)),
          rendered: kv.rendered !== undefined ? Boolean(kv.rendered) : (kv.render !== undefined ? Boolean(kv.render) : null),
          reason: kv.reason || null,
        });
      }
    }
  }

  // 2. 도표/자산 ID 목록 확정 (options.assetIds 우선, 없으면 진단 데이터 및 이벤트에서 수집)
  let candidateIds = [];
  if (Array.isArray(options.assetIds) && options.assetIds.length > 0) {
    candidateIds = [...new Set(options.assetIds)];
  } else if (Array.isArray(options.filterIds) && options.filterIds.length > 0) {
    candidateIds = [...new Set(options.filterIds)];
  } else {
    const idSet = new Set();
    // rawObj 에서 도표 ID 수집
    if (Array.isArray(rawObj.figures)) {
      rawObj.figures.forEach(f => f?.id && idSet.add(f.id));
    }
    if (rawObj.note?.figures && Array.isArray(rawObj.note.figures)) {
      rawObj.note.figures.forEach(f => f?.id && idSet.add(f.id));
    }
    if (rawObj.plan) {
      for (const s of rawObj.plan.sections || []) {
        for (const b of s.blocks || []) {
          for (const g of b.figureIds || []) idSet.add(g);
        }
      }
      for (const g of rawObj.plan.global || []) {
        for (const figId of g.figureIds || []) idSet.add(figId);
      }
    }
    for (const id of perAssetEvents.keys()) idSet.add(id);
    for (const id of renderWarnings.keys()) idSet.add(id);
    candidateIds = [...idSet].sort();
  }

  // 3. rawObj(figures, plan, note, crops) 기반 참조 집합 구축
  const figuresInRegistry = new Map();
  if (Array.isArray(rawObj.figures)) {
    for (const f of rawObj.figures) if (f?.id) figuresInRegistry.set(f.id, f);
  } else if (Array.isArray(rawObj.note?.figures)) {
    for (const f of rawObj.note.figures) if (f?.id) figuresInRegistry.set(f.id, f);
  }

  const planFigureSet = new Set();
  if (rawObj.plan) {
    for (const s of rawObj.plan.sections || []) {
      for (const b of s.blocks || []) {
        for (const g of b.figureIds || []) planFigureSet.add(g);
      }
    }
    for (const g of rawObj.plan.global || []) {
      for (const figId of g.figureIds || []) planFigureSet.add(figId);
    }
  }

  const noteFigureSet = new Set();
  if (rawObj.note) {
    for (const b of [...(rawObj.note.global || []), ...(rawObj.note.sections || []).flatMap(s => s.blocks || [])]) {
      if (b?.type === "B10" && Array.isArray(b.content?.figureIds)) {
        b.content.figureIds.forEach(id => noteFigureSet.add(id));
      }
      if (Array.isArray(b?.planBlock?.figureIds)) {
        b.planBlock.figureIds.forEach(id => noteFigureSet.add(id));
      }
    }
  }

  const cropSet = new Set([
    ...(Array.isArray(rawObj.crops) ? rawObj.crops : []),
    ...(rawObj.cropMap ? Object.keys(rawObj.cropMap) : []),
    ...(rawObj.cropsMap ? Object.keys(rawObj.cropsMap) : []),
  ]);

  // 4. Asset 단위 상태 판정: selection -> plan -> body -> rendered
  const assetReports = candidateIds.map(id => {
    const evInfo = perAssetEvents.get(id);
    const regFig = figuresInRegistry.get(id);
    const warns = renderWarnings.get(id) || [];

    // Stage 1: selection
    let selected = true;
    let selReason = null;
    if (evInfo?.selected !== null && evInfo?.selected !== undefined) {
      selected = evInfo.selected;
      if (!selected) selReason = evInfo.reason || "not_selected";
    } else if (regFig) {
      if (regFig.display === "check") {
        selected = false;
        selReason = "rejected_quality";
      } else {
        selected = true;
      }
    }

    // Stage 2: plan assignment
    let planAssigned = false;
    let planReason = null;
    if (evInfo?.planAssigned !== null && evInfo?.planAssigned !== undefined) {
      planAssigned = evInfo.planAssigned;
      if (!planAssigned) planReason = "unassigned_in_plan";
    } else if (planFigureSet.size > 0) {
      planAssigned = planFigureSet.has(id);
      if (!planAssigned) planReason = "unassigned_in_plan";
    } else if (funnelRaw?.planAssigned !== undefined) {
      // 개별 정보 부재 시 기본값
      planAssigned = selected;
    } else {
      planAssigned = selected;
    }

    // Stage 3: body reference
    let bodyReferenced = false;
    let bodyReason = null;
    if (evInfo?.bodyReferenced !== null && evInfo?.bodyReferenced !== undefined) {
      bodyReferenced = evInfo.bodyReferenced;
      if (!bodyReferenced) bodyReason = "unreferenced_in_body";
    } else if (noteFigureSet.size > 0) {
      bodyReferenced = noteFigureSet.has(id);
      if (!bodyReferenced) bodyReason = "unreferenced_in_body";
    } else if (funnelRaw?.textRef !== undefined || funnelRaw?.textReferenced !== undefined) {
      bodyReferenced = planAssigned;
    } else {
      bodyReferenced = planAssigned;
    }

    // Stage 4: rendered
    let rendered = false;
    let renderReason = null;
    if (evInfo?.rendered !== null && evInfo?.rendered !== undefined) {
      rendered = evInfo.rendered;
      if (!rendered) renderReason = evInfo.reason || "render_failed";
    } else if (warns.includes("RENDER_REF_UNKNOWN")) {
      rendered = false;
      renderReason = "ref_unknown";
    } else if (warns.includes("RENDER_CROP_REJECTED")) {
      rendered = false;
      renderReason = "crop_rejected";
    } else if (warns.includes("RENDER_CHART_INVALID")) {
      rendered = false;
      renderReason = "chart_invalid";
    } else if (regFig) {
      if (regFig.display === "table" || regFig.display === "chart") {
        rendered = bodyReferenced;
      } else if (regFig.display === "crop") {
        const hasCrop = cropSet.has(id) || cropSet.has(regFig.cropKey);
        rendered = bodyReferenced && hasCrop;
        if (!hasCrop) renderReason = "crop_missing";
      } else if (regFig.display === "check" || regFig.display === "missing") {
        rendered = false;
        renderReason = "render_missing";
      } else {
        rendered = bodyReferenced;
      }
    } else {
      rendered = bodyReferenced;
    }

    // 탈락 지점(failStage) 및 사유(failReason) 결정
    let failStage = null;
    let failReason = null;
    if (!selected) {
      failStage = "funnel_selection";
      failReason = selReason || "not_selected";
    } else if (!planAssigned) {
      failStage = "plan_assignment";
      failReason = planReason || "unassigned_in_plan";
    } else if (!bodyReferenced) {
      failStage = "body_reference";
      failReason = bodyReason || "unreferenced_in_body";
    } else if (!rendered) {
      failStage = "rendered";
      failReason = renderReason || "render_failed";
    }

    return {
      id,
      selected,
      planAssigned,
      bodyReferenced,
      rendered,
      failStage,
      failReason,
    };
  });

  // 5. 단계별 분모(denominator) 계산 및 불일치 경고
  const warnings = [];

  // 분모 결정
  let denomSelection = candidateIds.length;
  let denomPlan = candidateIds.length;
  let denomBody = candidateIds.length;
  let denomRendered = candidateIds.length;
  let denominatorsDiffer = false;

  // 원시 FIGURE_FUNNEL 이벤트가 제공된 경우의 단계별 분모 검사 (spec 8.1 핵심)
  // 이전 funnel 구현: cropExist=25, selected=21, planAssigned=16, textRef=6, renderOk=4
  // 단계마다 분모가 서로 달라 단순 누락률 계산 불가
  if (funnelRaw) {
    const fCrop = funnelRaw.cropExist ?? null;
    const fSel = funnelRaw.selected ?? null;
    const fPlan = funnelRaw.planAssigned ?? null;
    const fText = funnelRaw.textReferenced ?? funnelRaw.textRef ?? null;
    const fRend = funnelRaw.renderSuccess ?? funnelRaw.renderOk ?? null;

    // 만약 개별 assetIds가 지정되지 않았고 funnel 이벤트 수치가 있다면
    // 이벤트 기준의 각 단계 집계 단위를 분모와 함께 기록한다
    if (candidateIds.length === 0 && fSel !== null) {
      denomSelection = fCrop !== null ? fCrop : fSel;
      denomPlan = fSel !== null ? fSel : (fPlan ?? 0);
      denomBody = fPlan !== null ? fPlan : (fText ?? 0);
      denomRendered = fText !== null ? fText : (fRend ?? 0);

      const dSet = new Set([denomSelection, denomPlan, denomBody, denomRendered]);
      if (dSet.size > 1) {
        denominatorsDiffer = true;
        warnings.push(`단계별 집계 분모 상이(selection=${denomSelection}, plan=${denomPlan}, body=${denomBody}, rendered=${denomRendered}) — 동일 asset 단위 추적 필요 (spec 8.1)`);
      }
    }
  }

  // 코호트 추적인 경우 (candidateIds 가 존재하는 경우)
  if (candidateIds.length > 0) {
    denomSelection = candidateIds.length;
    denomPlan = candidateIds.length;
    denomBody = candidateIds.length;
    denomRendered = candidateIds.length;

    // 만약 외부 옵션으로 단계별 분모가 별도 제공된 경우 비교
    if (options.denominators) {
      if (options.denominators.selection) denomSelection = options.denominators.selection;
      if (options.denominators.plan) denomPlan = options.denominators.plan;
      if (options.denominators.body) denomBody = options.denominators.body;
      if (options.denominators.rendered) denomRendered = options.denominators.rendered;

      const dSet = new Set([denomSelection, denomPlan, denomBody, denomRendered]);
      if (dSet.size > 1) {
        denominatorsDiffer = true;
        warnings.push(`단계별 집계 분모 상이(selection=${denomSelection}, plan=${denomPlan}, body=${denomBody}, rendered=${denomRendered}) — 동일 asset 단위 추적 필요 (spec 8.1)`);
      }
    }
  }

  // 집계 수치
  const selectedCount = assetReports.filter(a => a.selected).length;
  const planAssignedCount = assetReports.filter(a => a.planAssigned).length;
  const bodyReferencedCount = assetReports.filter(a => a.bodyReferenced).length;
  const renderedCount = assetReports.filter(a => a.rendered).length;

  return {
    summary: {
      funnel: {
        cropExist: {
          count: funnelRaw?.cropExist ?? denomSelection,
          denominator: denomSelection,
        },
        selected: {
          count: candidateIds.length > 0 ? selectedCount : (funnelRaw?.selected ?? 0),
          denominator: denomSelection,
        },
        planAssigned: {
          count: candidateIds.length > 0 ? planAssignedCount : (funnelRaw?.planAssigned ?? 0),
          denominator: denomPlan,
        },
        bodyReferenced: {
          count: candidateIds.length > 0 ? bodyReferencedCount : (funnelRaw?.textReferenced ?? funnelRaw?.textRef ?? 0),
          denominator: denomBody,
        },
        rendered: {
          count: candidateIds.length > 0 ? renderedCount : (funnelRaw?.renderSuccess ?? funnelRaw?.renderOk ?? 0),
          denominator: denomRendered,
        },
      },
      coverage: coverageRaw,
      assetCount: candidateIds.length,
      denominatorsDiffer,
      warning: denominatorsDiffer ? warnings[0] : null,
    },
    denominators: {
      selection: denomSelection,
      plan: denomPlan,
      body: denomBody,
      rendered: denomRendered,
    },
    assets: assetReports,
    warnings,
  };
}

/**
 * 콘텐츠 없는 보고서 텍스트 서식화 (오직 ID, 수치, 분모, 코드만 포함).
 */
export function formatFigureTraceReport(traceResult) {
  const { summary, assets, denominators, warnings } = traceResult;
  const lines = [];

  lines.push("============================================================");
  lines.push("📊 도표(Figure/Asset) 생명주기 및 퍼널 추적 보고서 (spec 8.1)");
  lines.push("============================================================\n");

  const f = summary.funnel;
  lines.push("▶ 퍼널 단계별 집계 및 분모:");
  lines.push(`  - cropExist:       ${f.cropExist.count} / ${f.cropExist.denominator}`);
  lines.push(`  - selected:        ${f.selected.count} / ${f.selected.denominator}`);
  lines.push(`  - planAssigned:    ${f.planAssigned.count} / ${f.planAssigned.denominator}`);
  lines.push(`  - bodyReferenced:  ${f.bodyReferenced.count} / ${f.bodyReferenced.denominator}`);
  lines.push(`  - rendered:        ${f.rendered.count} / ${f.rendered.denominator}`);

  if (summary.denominatorsDiffer) {
    lines.push(`\n⚠️  경고: ${summary.warning}`);
  } else {
    lines.push(`\n✅  분모 일치: 동일 asset 단위(D=${denominators.selection}) 추적 확인`);
  }

  if (assets.length > 0) {
    lines.push(`\n▶ Asset ID별 생명주기 추적 (${assets.length}건):`);
    for (const a of assets) {
      const s = a.selected ? "OK" : "FAIL";
      const p = a.planAssigned ? "OK" : "FAIL";
      const b = a.bodyReferenced ? "OK" : "FAIL";
      const r = a.rendered ? "OK" : "FAIL";
      const res = a.failStage ? `탈락: ${a.failStage} (${a.failReason})` : "완료: 렌더 성공";
      lines.push(`  [${a.id}] sel:${s} | plan:${p} | body:${b} | rend:${r} -> ${res}`);
    }
  }

  lines.push("\n============================================================");
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  let filePath = null;
  let assetIds = null;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ids" && args[i + 1]) {
      assetIds = args[++i].split(",").map(s => s.trim()).filter(Boolean);
    } else if (args[i] === "--json") {
      jsonOutput = true;
    } else if (!filePath && !args[i].startsWith("--")) {
      filePath = args[i];
    }
  }

  let inputData = null;
  if (filePath) {
    if (!fs.existsSync(filePath)) {
      console.error(`오류: 파일을 찾을 수 없습니다: ${filePath}`);
      process.exit(1);
    }
    inputData = fs.readFileSync(filePath, "utf8");
  } else {
    // stdin 파이프 읽기 시도
    if (!process.stdin.isTTY) {
      inputData = fs.readFileSync(0, "utf8");
    }
  }

  if (!inputData) {
    console.log("사용법: node tools/figure-trace.mjs <diagnostic.json|events.ndjson> [--ids G1,G2,...] [--json]");
    process.exit(0);
  }

  const result = traceFigures(inputData, { assetIds });
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatFigureTraceReport(result));
  }
}

if (isMain) {
  main().catch(err => {
    console.error("오류 발생:", err.message);
    process.exit(1);
  });
}
