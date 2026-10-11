// VisualSpec → SVG 도해 생성기 — 제안서 §4, §9.3 P2b.
// 모델이 출력한 정형 VisualSpec JSON 을 검증(validateVisualSpec)하고,
// 결정적 SVG 도해 문자열(renderVisualSvg)로 변환한다.
// 본문과 결합할 수 있는 구조 도해(argument_map, timeline, flow)만 다루며,
// 숫자가 없는 자료에 통계 그래프(chart)를 만들지 않는다.
// 보안 불변조건: 모든 텍스트 이스케이프, <script>·on* 이벤트·외부 URL·<foreignObject>·style 주입 금지.
(() => {
  const ALLOWED_KINDS = ["argument_map", "timeline", "flow"];
  const ALLOWED_RELATIONS = [
    "supports", "causes", "contrasts", "precedes",
    "includes", "part_of", "example_of", "complements",
  ];
  const RELATION_LABELS = {
    supports: "지지",
    causes: "인과",
    contrasts: "대조",
    precedes: "선행",
    includes: "포함",
    part_of: "부분",
    example_of: "예시",
    complements: "보완",
  };
  const KIND_LABELS = {
    argument_map: "논증 지도",
    timeline: "타임라인",
    flow: "흐름도",
  };

  const MAX_NODES = 20;
  const MAX_EDGES = 30;
  const MAX_EVIDENCE_PER_EDGE = 8;

  // 디자인 토큰 — docs/note-format-study-2026-10-02/page-design-spec.md 및 assets/brand-tokens.json 기준
  const TOKENS = {
    canvas: "#F7F7F4",
    surface: "#FFFFFF",
    ink: "#18181B",
    body: "#27272A",
    muted: "#64646D",
    line: "#DCDCD8",
    surfaceSubtle: "#F0F0ED",
    accent: "#FF5600",
    accentSubtle: "#FFF1E8",
    accentText: "#A63700",
    dark: "#202020",
    fontSans: "ui-sans-serif, system-ui, -apple-system, sans-serif",
    fontMono: "Geist Mono, Menlo, monospace",
  };

  // 흑백(인쇄)에서도 구분되는 선 모양 — relation 별 고유 dash 패턴
  const RELATION_STROKES = {
    supports: { dash: "none", width: "1.5", color: "#27272A" },
    causes: { dash: "none", width: "2.5", color: "#18181B" },
    contrasts: { dash: "6,4", width: "1.5", color: "#64646D" },
    precedes: { dash: "3,3", width: "1.5", color: "#64646D" },
    includes: { dash: "8,3,2,3", width: "1.5", color: "#27272A" },
    part_of: { dash: "8,3,2,3", width: "1.5", color: "#64646D" },
    example_of: { dash: "4,3", width: "1.5", color: "#64646D" },
    complements: { dash: "5,3", width: "1.5", color: "#27272A" },
  };

  // XML 특수문자 이스케이프
  function escapeXml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  // 스크립트·외부 URL·이벤트 핸들러 제거
  function sanitizeText(str) {
    if (str == null) return "";
    let s = String(str);
    s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    s = s.replace(/javascript:[^\s"'>]*/gi, "");
    s = s.replace(/https?:\/\/[^\s"'>]*/gi, "[link]");
    s = s.replace(/data:[^\s"'>]*/gi, "");
    s = s.replace(/on\w+\s*=/gi, "");
    s = s.replace(/<foreignObject\b[^<]*(?:(?!<\/foreignObject>)<[^<]*)*<\/foreignObject>/gi, "");
    return s;
  }

  // VisualSpec 검증 — 노드의 claimId, 간선의 evidenceId 가 원장에 존재하는지 확인.
  // spec 에는 자유 텍스트가 올 수 없다.
  function validateVisualSpec(spec, ledger) {
    const errors = [];
    const err = (code, detail) => { errors.push({ code, detail: detail != null ? [String(detail)] : [] }); };

    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      return { ok: false, errors: [{ code: "VAL_SPEC_INVALID", detail: ["spec must be an object"] }] };
    }

    if (typeof spec.visualId !== "string" || !spec.visualId.trim()) {
      err("VAL_VISUAL_ID_MISSING");
    }

    if (!ALLOWED_KINDS.includes(spec.kind)) {
      err("VAL_KIND_INVALID", spec.kind);
    }

    if (spec.targetBlockId != null && typeof spec.targetBlockId !== "string") {
      err("VAL_TARGET_BLOCK_INVALID", spec.targetBlockId);
    }

    if (!Array.isArray(spec.nodes) || spec.nodes.length === 0) {
      err("VAL_NODES_EMPTY");
    } else {
      if (spec.nodes.length > MAX_NODES) {
        err("VAL_NODES_LIMIT", spec.nodes.length);
      }
      const nodeIds = new Set();
      const ledgerClaims = ledger?.claims ?? {};
      const validClaimIds = new Set(Object.keys(ledgerClaims));
      if (Array.isArray(ledger?.draft?.claims)) {
        for (const c of ledger.draft.claims) if (c?.claimId) validClaimIds.add(c.claimId);
      }

      for (let i = 0; i < spec.nodes.length; i++) {
        const n = spec.nodes[i];
        if (!n || typeof n !== "object") {
          err("VAL_NODE_INVALID", i);
          continue;
        }
        if (typeof n.id !== "string" || !n.id.trim()) {
          err("VAL_NODE_ID_MISSING", i);
        } else {
          if (nodeIds.has(n.id)) {
            err("VAL_NODE_DUP_ID", n.id);
          }
          nodeIds.add(n.id);
        }

        // spec 에 자유 텍스트 불가: 노드 내용은 반드시 원장에서 claimId 로 참조한다
        if (n.text !== undefined || n.label !== undefined || n.content !== undefined) {
          err("VAL_NODE_FREE_TEXT", n.id || i);
        }
        if (typeof n.claimId !== "string" || !n.claimId.trim()) {
          err("VAL_CLAIM_ID_MISSING", n.id || i);
        } else if (!validClaimIds.has(n.claimId)) {
          err("VAL_CLAIM_NOT_FOUND", n.claimId);
        }
      }

      const edges = Array.isArray(spec.edges) ? spec.edges : [];
      if (spec.edges !== undefined && !Array.isArray(spec.edges)) {
        err("VAL_EDGES_INVALID");
      } else {
        if (edges.length > MAX_EDGES) {
          err("VAL_EDGES_LIMIT", edges.length);
        }

        const validEvidenceIds = new Set();
        for (const c of Object.values(ledgerClaims)) {
          for (const ev of (Array.isArray(c?.evidenceIds) ? c.evidenceIds : [])) validEvidenceIds.add(ev);
        }
        if (Array.isArray(ledger?.draft?.claims)) {
          for (const c of ledger.draft.claims) {
            for (const ev of (Array.isArray(c?.evidenceIds) ? c.evidenceIds : [])) validEvidenceIds.add(ev);
          }
        }
        if (Array.isArray(ledger?.evidence)) {
          for (const ev of ledger.evidence) validEvidenceIds.add(ev?.id || ev);
        }

        const seenEdgeKeys = new Set();
        for (let j = 0; j < edges.length; j++) {
          const e = edges[j];
          if (!e || typeof e !== "object") {
            err("VAL_EDGE_INVALID", j);
            continue;
          }
          if (!nodeIds.has(e.from)) {
            err("VAL_EDGE_ENDPOINT_INVALID", `from:${e.from}`);
          }
          if (!nodeIds.has(e.to)) {
            err("VAL_EDGE_ENDPOINT_INVALID", `to:${e.to}`);
          }
          const edgeKey = `${e.from}->${e.to}:${e.relation}`;
          if (seenEdgeKeys.has(edgeKey)) {
            err("VAL_EDGE_DUP", edgeKey);
          }
          seenEdgeKeys.add(edgeKey);

          if (!ALLOWED_RELATIONS.includes(e.relation)) {
            err("VAL_RELATION_INVALID", e.relation);
          }
          if (e.evidenceIds !== undefined) {
            if (!Array.isArray(e.evidenceIds)) {
              err("VAL_EDGE_EVIDENCE_INVALID", j);
            } else {
              if (e.evidenceIds.length > MAX_EVIDENCE_PER_EDGE) {
                err("VAL_EDGE_EVIDENCE_LIMIT", e.evidenceIds.length);
              }
              for (const ev of e.evidenceIds) {
                if (typeof ev !== "string" || !validEvidenceIds.has(ev)) {
                  err("VAL_EVIDENCE_NOT_FOUND", ev);
                }
              }
            }
          }
        }
      }
    }

    return { ok: errors.length === 0, errors };
  }

  // 주장 내용 해소 헬퍼
  function resolveText(cid, resolveClaim) {
    if (!cid) return "";
    let val = null;
    if (typeof resolveClaim === "function") {
      val = resolveClaim(cid);
    } else if (resolveClaim && typeof resolveClaim === "object") {
      if (resolveClaim instanceof Map) {
        val = resolveClaim.get(cid);
      } else if (Array.isArray(resolveClaim?.draft?.claims)) {
        val = resolveClaim.draft.claims.find(c => c?.claimId === cid)?.text;
      } else if (resolveClaim.claims && resolveClaim.claims[cid]?.text) {
        val = resolveClaim.claims[cid].text;
      } else {
        val = resolveClaim[cid];
      }
    }
    const strVal = typeof val === "string" ? val : (val && typeof val === "object" && typeof val.text === "string" ? val.text : String(val ?? cid));
    return sanitizeText(strVal);
  }

  // 텍스트 줄바꿈 헬퍼 (SVG tspan 용)
  function wrapLines(text, maxCharsPerLine = 16, maxLines = 3) {
    const clean = sanitizeText(text).trim();
    if (!clean) return [];
    const lines = [];
    let cur = "";
    for (const ch of clean) {
      cur += ch;
      if (cur.length >= maxCharsPerLine) {
        lines.push(cur);
        cur = "";
        if (lines.length === maxLines - 1) break;
      }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    if (clean.length > maxCharsPerLine * maxLines && lines.length === maxLines) {
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxCharsPerLine - 1) + "…";
    }
    return lines;
  }

  // 화살표 마커 defs
  function renderDefs() {
    return `<defs>`
      + `<marker id="vs-arrow-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`
      + `<path d="M 0 1 L 10 5 L 0 9 z" fill="${TOKENS.ink}" />`
      + `</marker>`
      + `<marker id="vs-arrow-muted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`
      + `<path d="M 0 1 L 10 5 L 0 9 z" fill="${TOKENS.muted}" />`
      + `</marker>`
      + `</defs>`;
  }

  // argument_map 렌더러 — 층(layer) 기반 위→아래 배치
  function renderArgumentMap(spec, resolveClaim) {
    const nodes = (spec.nodes || []).slice(0, MAX_NODES);
    const edges = (spec.edges || []).slice(0, MAX_EDGES);

    // in-degree 계산으로 층(layer) 할당
    const inDegree = new Map(nodes.map(n => [n.id, 0]));
    const outEdges = new Map(nodes.map(n => [n.id, []]));
    for (const e of edges) {
      if (inDegree.has(e.to)) inDegree.set(e.to, inDegree.get(e.to) + 1);
      if (outEdges.has(e.from)) outEdges.get(e.from).push(e.to);
    }

    const layers = [];
    const assigned = new Set();
    let current = nodes.filter(n => inDegree.get(n.id) === 0).map(n => n.id);
    if (!current.length && nodes.length) current = [nodes[0].id];

    while (current.length) {
      layers.push(current);
      current.forEach(id => assigned.add(id));
      const nextLayer = new Set();
      for (const id of current) {
        for (const target of (outEdges.get(id) || [])) {
          if (!assigned.has(target)) nextLayer.add(target);
        }
      }
      current = [...nextLayer];
    }
    // 미배치된 고립 노드는 마지막 층에 추가
    const unplaced = nodes.filter(n => !assigned.has(n.id)).map(n => n.id);
    if (unplaced.length) layers.push(unplaced);

    const svgWidth = 720;
    const nodeW = 190;
    const nodeH = 68;
    const gapY = 50;
    const padTop = 30;
    const padBottom = 20;

    const totalHeight = padTop + layers.length * nodeH + Math.max(0, layers.length - 1) * gapY + padBottom;

    // 노드 좌표 계산 (결정적)
    const nodePos = new Map();
    for (let l = 0; l < layers.length; l++) {
      const layer = layers[l];
      const count = layer.length;
      const gapX = count > 1 ? Math.min(30, Math.floor((svgWidth - 40 - count * nodeW) / (count - 1))) : 0;
      const layerWidth = count * nodeW + (count - 1) * gapX;
      const startX = Math.floor((svgWidth - layerWidth) / 2);
      const y = padTop + l * (nodeH + gapY);

      for (let i = 0; i < count; i++) {
        const x = startX + i * (nodeW + gapX);
        nodePos.set(layer[i], { x, y });
      }
    }

    let parts = [];
    parts.push(renderDefs());

    // 간선 렌더링
    for (const e of edges) {
      const p1 = nodePos.get(e.from);
      const p2 = nodePos.get(e.to);
      if (!p1 || !p2) continue;

      const stroke = RELATION_STROKES[e.relation] || { dash: "none", width: "1.5", color: "#64646D" };
      const marker = stroke.color === TOKENS.ink ? "url(#vs-arrow-solid)" : "url(#vs-arrow-muted)";

      // 연결 좌표: 출발 노드 하단(또는 중간) → 도착 노드 상단
      const fromX = Math.round(p1.x + nodeW / 2);
      const fromY = Math.round(p1.y + nodeH);
      const toX = Math.round(p2.x + nodeW / 2);
      const toY = Math.round(p2.y);

      // 곡선 경로 (베지어)
      const midY = Math.round((fromY + toY) / 2);
      const pathD = `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;

      parts.push(`<path d="${pathD}" fill="none" stroke="${stroke.color}" stroke-width="${stroke.width}" stroke-dasharray="${stroke.dash}" marker-end="${marker}" />`);

      // 관계 라벨 배지
      const labelText = RELATION_LABELS[e.relation] || e.relation;
      const lblX = Math.round((fromX + toX) / 2);
      const lblY = midY;
      const badgeW = Math.max(34, labelText.length * 12 + 10);
      const badgeH = 18;

      parts.push(`<g transform="translate(${lblX - Math.round(badgeW / 2)}, ${lblY - Math.round(badgeH / 2)})">`
        + `<rect width="${badgeW}" height="${badgeH}" rx="9" fill="${TOKENS.surface}" stroke="${TOKENS.line}" stroke-width="1" />`
        + `<text x="${Math.round(badgeW / 2)}" y="12" fill="${TOKENS.muted}" font-size="10" font-family="${TOKENS.fontSans}" text-anchor="middle">${escapeXml(labelText)}</text>`
        + `</g>`);
    }

    // 노드 박스 렌더링
    for (const n of nodes) {
      const pos = nodePos.get(n.id);
      if (!pos) continue;

      const rawText = resolveText(n.claimId, resolveClaim);
      const lines = wrapLines(rawText, 17, 3);

      parts.push(`<g transform="translate(${pos.x}, ${pos.y})">`
        + `<rect width="${nodeW}" height="${nodeH}" rx="4" fill="${TOKENS.surface}" stroke="${TOKENS.line}" stroke-width="1" />`
        + `<text x="10" y="16" fill="${TOKENS.muted}" font-size="10" font-family="${TOKENS.fontMono}">[${escapeXml(n.id)}]</text>`);

      for (let li = 0; li < lines.length; li++) {
        const lineY = 32 + li * 15;
        parts.push(`<text x="10" y="${lineY}" fill="${TOKENS.body}" font-size="11" font-family="${TOKENS.fontSans}">${escapeXml(lines[li])}</text>`);
      }
      parts.push(`</g>`);
    }

    return { width: svgWidth, height: totalHeight, body: parts.join("\n") };
  }

  // timeline / flow 렌더러 — 순서 기반 선형 배치
  function renderTimelineFlow(spec, resolveClaim) {
    const nodes = (spec.nodes || []).slice(0, MAX_NODES);
    const edges = (spec.edges || []).slice(0, MAX_EDGES);

    const svgWidth = 720;
    const isTimeline = spec.kind === "timeline";
    const nodeW = 180;
    const nodeH = 70;
    const gapX = 35;
    const padTop = 30;
    const padLeft = 20;

    // 1행에 최대 3개 배치 (넘치면 다단)
    const perRow = 3;
    const rows = Math.ceil(Math.max(1, nodes.length) / perRow);
    const rowGap = 70;
    const totalHeight = padTop + rows * nodeH + (rows - 1) * rowGap + 30;

    const nodePos = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const r = Math.floor(i / perRow);
      const c = r % 2 === 0 ? (i % perRow) : (perRow - 1 - (i % perRow)); // 지그재그 흐름
      const x = padLeft + c * (nodeW + gapX);
      const y = padTop + r * (nodeH + rowGap);
      nodePos.set(nodes[i].id, { x, y, index: i + 1 });
    }

    let parts = [];
    parts.push(renderDefs());

    // 타임라인 기준선 (timeline 일 때)
    if (isTimeline && nodes.length > 1) {
      for (let r = 0; r < rows; r++) {
        const y = padTop + r * (nodeH + rowGap) + Math.round(nodeH / 2);
        const x1 = padLeft;
        const x2 = padLeft + (Math.min(nodes.length - r * perRow, perRow) - 1) * (nodeW + gapX) + nodeW;
        parts.push(`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${TOKENS.grid}" stroke-width="2" stroke-dasharray="4,4" />`);
      }
    }

    // 간선 렌더링 (명시 간선 또는 연속 순서)
    const renderedEdges = edges.length ? edges : nodes.slice(0, -1).map((n, idx) => ({
      from: n.id, to: nodes[idx + 1].id, relation: isTimeline ? "precedes" : "causes",
    }));

    for (const e of renderedEdges) {
      const p1 = nodePos.get(e.from);
      const p2 = nodePos.get(e.to);
      if (!p1 || !p2) continue;

      const stroke = RELATION_STROKES[e.relation] || { dash: "none", width: "1.5", color: "#64646D" };
      const marker = stroke.color === TOKENS.ink ? "url(#vs-arrow-solid)" : "url(#vs-arrow-muted)";

      const fromX = Math.round(p1.x + nodeW);
      const fromY = Math.round(p1.y + nodeH / 2);
      const toX = Math.round(p2.x);
      const toY = Math.round(p2.y + nodeH / 2);

      // 같은 행이면 수평 화살표, 다른 행이면 곡선
      let pathD = "";
      if (Math.abs(fromY - toY) < 10) {
        pathD = `M ${fromX} ${fromY} L ${toX} ${toY}`;
      } else {
        const midX = Math.round((fromX + toX) / 2);
        pathD = `M ${fromX} ${fromY} C ${fromX + 20} ${fromY}, ${toX - 20} ${toY}, ${toX} ${toY}`;
      }

      parts.push(`<path d="${pathD}" fill="none" stroke="${stroke.color}" stroke-width="${stroke.width}" stroke-dasharray="${stroke.dash}" marker-end="${marker}" />`);

      const labelText = RELATION_LABELS[e.relation] || e.relation;
      if (labelText) {
        const lblX = Math.round((fromX + toX) / 2);
        const lblY = Math.round((fromY + toY) / 2) - 8;
        parts.push(`<text x="${lblX}" y="${lblY}" fill="${TOKENS.muted}" font-size="9" font-family="${TOKENS.fontSans}" text-anchor="middle">${escapeXml(labelText)}</text>`);
      }
    }

    // 노드 박스
    for (const n of nodes) {
      const pos = nodePos.get(n.id);
      if (!pos) continue;

      const rawText = resolveText(n.claimId, resolveClaim);
      const lines = wrapLines(rawText, 16, 3);
      const stepBadge = isTimeline ? `STEP ${pos.index}` : `단계 ${pos.index}`;

      parts.push(`<g transform="translate(${pos.x}, ${pos.y})">`
        + `<rect width="${nodeW}" height="${nodeH}" rx="4" fill="${TOKENS.surface}" stroke="${TOKENS.line}" stroke-width="1" />`
        + `<rect x="6" y="6" width="46" height="15" rx="3" fill="${TOKENS.surfaceSubtle}" />`
        + `<text x="29" y="17" fill="${TOKENS.dark}" font-size="9" font-family="${TOKENS.fontMono}" text-anchor="middle">${escapeXml(stepBadge)}</text>`
        + `<text x="58" y="17" fill="${TOKENS.muted}" font-size="9" font-family="${TOKENS.fontMono}">[${escapeXml(n.id)}]</text>`);

      for (let li = 0; li < lines.length; li++) {
        const lineY = 34 + li * 14;
        parts.push(`<text x="10" y="${lineY}" fill="${TOKENS.body}" font-size="11" font-family="${TOKENS.fontSans}">${escapeXml(lines[li])}</text>`);
      }
      parts.push(`</g>`);
    }

    return { width: svgWidth, height: totalHeight, body: parts.join("\n") };
  }

  // 접근성용 텍스트 대체 설명 생성
  function buildAccessibleDesc(spec, resolveClaim) {
    const kindName = KIND_LABELS[spec.kind] || spec.kind;
    const nodeLines = (spec.nodes || []).map(n => `[${n.id}] ${resolveText(n.claimId, resolveClaim)}`);
    const edgeLines = (spec.edges || []).map(e => {
      const relName = RELATION_LABELS[e.relation] || e.relation;
      const evs = Array.isArray(e.evidenceIds) && e.evidenceIds.length ? ` (근거: ${e.evidenceIds.join(", ")})` : "";
      return `[${e.from}] → (${relName}${evs}) [${e.to}]`;
    });

    let desc = `${kindName} (${spec.visualId}):\n주장 항목:\n- ${nodeLines.join("\n- ")}`;
    if (edgeLines.length) {
      desc += `\n관계 연결:\n- ${edgeLines.join("\n- ")}`;
    }
    return desc;
  }

  // 결정적 SVG 도해 문자열 렌더러
  function renderVisualSvg(spec, resolveClaim) {
    if (!spec || typeof spec !== "object") return "";
    const kind = spec.kind || "argument_map";
    if (!ALLOWED_KINDS.includes(kind)) return "";

    const rendered = kind === "argument_map"
      ? renderArgumentMap(spec, resolveClaim)
      : renderTimelineFlow(spec, resolveClaim);

    const visualId = sanitizeText(spec.visualId || "도해");
    const title = `${escapeXml(visualId)} (${KIND_LABELS[kind] || kind})`;
    const desc = buildAccessibleDesc(spec, resolveClaim);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rendered.width} ${rendered.height}" width="100%" height="${rendered.height}" role="img" aria-label="${escapeXml(title)}">\n`
      + `<title>${escapeXml(title)}</title>\n`
      + `<desc>${escapeXml(desc)}</desc>\n`
      + rendered.body + "\n"
      + `</svg>`;
  }

  const api = {
    validateVisualSpec,
    renderVisualSvg,
    ALLOWED_KINDS,
    ALLOWED_RELATIONS,
    RELATION_LABELS,
    KIND_LABELS,
    MAX_NODES,
    MAX_EDGES,
    TOKENS,
  };

  globalThis.VisualSpec = api;
  if (typeof module !== "undefined") module.exports = api;
})();
