// lib/chart-svg.js
// 결정론적 차트 SVG 렌더러 (docs/note-contract.md §14, 제안서 §5).
// 도표 kind chart 이고 관측 데이터가 있으면 축·단위·범례·표본 범위를 명시한 결정론적 SVG를 생성한다.
// 숫자가 근거(OCR/근거 텍스트)에 없으면 절대 그리지 않는다(null 반환).
(() => {
  const Formulas = globalThis.Formulas || (typeof require !== "undefined" ? require("./formulas.js") : null);
  const numTok = Formulas?.numericTokens ?? (s =>
    (String(s ?? "").normalize("NFKC").replace(/(?<=\d),(?=\d{3}(?!\d))/g, "").match(/\d+(?:\.\d+)?|\.\d+/g) || []));

  const CHART_INK = ["var(--accent)", "var(--ink)", "var(--muted)"];
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = text => String(text ?? "").replace(/[&<>"']/g, c => ESC[c]);

  // 근거 텍스트(ocrText)의 숫자 다중집합에서 tokens 를 하나씩 소비한다.
  function numbersCovered(tokens, ocrText) {
    if (typeof ocrText !== "string" || !ocrText.trim()) return false;
    const have = new Map();
    for (const t of numTok(ocrText)) have.set(t, (have.get(t) || 0) + 1);
    for (const t of tokens) {
      const c = have.get(t) || 0;
      if (!c) return false;
      have.set(t, c - 1);
    }
    return true;
  }

  // 2D cells 테이블로부터 chartData 구조를 유도한다 (kind: chart 인데 cells 만 있는 경우 지원).
  function parseChartFromCells(cells, { type = "bar", title = null, unit = null } = {}) {
    if (!Array.isArray(cells) || cells.length < 2) return null;
    const [header, ...rows] = cells;
    if (!Array.isArray(header) || header.length < 2) return null;
    const xLabel = String(header[0] ?? "").trim();
    const seriesNames = header.slice(1).map(h => String(h ?? "").trim());
    if (seriesNames.some(s => !s)) return null;

    const categories = [];
    const seriesValues = seriesNames.map(() => []);

    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== header.length) return null;
      const cat = String(row[0] ?? "").trim();
      if (!cat) return null;
      categories.push(cat);
      for (let j = 1; j < row.length; j++) {
        const raw = String(row[j] ?? "").replace(/,/g, "").trim();
        const v = Number(raw);
        if (!Number.isFinite(v)) return null;
        seriesValues[j - 1].push(v);
      }
    }

    if (!categories.length || categories.length > 12 || seriesNames.length > 3) return null;

    const series = seriesNames.map((name, i) => ({ name, values: seriesValues[i] }));
    return {
      type: type === "line" ? "line" : "bar",
      categories,
      series,
      unit: unit ? String(unit).trim() : null,
      xLabel: xLabel || null,
      yLabel: title ? String(title).trim() : null,
    };
  }

  // 근거(OCR)에 숫자가 모두 존재하는지 검증한다.
  function isGrounded(chartData, ocrText) {
    if (!chartData || !Array.isArray(chartData.series)) return false;
    if (typeof ocrText !== "string") return false;
    const tokens = chartData.series.flatMap(s => (s.values || []).map(v => String(Math.abs(v))));
    return numbersCovered(tokens, ocrText);
  }

  // 결정론적 차트 SVG 생성 함수
  // 축, 단위, 범례, 표본 범위를 명시하며 디자인 토큰 색상을 사용한다.
  function renderChartSvg(figOrData, { ocrText = null, sampleRange = null, requireGrounded = true } = {}) {
    if (!figOrData) return null;

    let d = figOrData.chartData;
    if (!d && figOrData.cells) {
      d = parseChartFromCells(figOrData.cells, {
        title: figOrData.title,
        unit: figOrData.unit,
      });
    } else if (!d && Array.isArray(figOrData.categories) && Array.isArray(figOrData.series)) {
      d = figOrData;
    }

    if (!d || !Array.isArray(d.categories) || !Array.isArray(d.series)) return null;
    const cats = d.categories.slice(0, 12).map(String);
    const series = d.series.slice(0, 3).filter(s => s && Array.isArray(s.values));
    if (!cats.length || !series.length) return null;
    if (!series.every(s => s.values.length === cats.length && s.values.every(Number.isFinite))) return null;

    // 근거 대조: 숫자가 근거에 없으면 그리지 않는다
    const effectiveOcr = ocrText ?? figOrData.ocrText ?? null;
    if (requireGrounded) {
      if (!isGrounded(d, effectiveOcr)) return null;
    }

    const vals = series.flatMap(s => s.values);
    const W = 640, H = 250, pl = 10, pr = 10, pt = 32, pb = 46, iw = W - pl - pr, ih = H - pt - pb;
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
    const y = v => Number((pt + ih - ((v - lo) / span) * ih).toFixed(1));
    const X = i => Number((pl + (iw * (i + 0.5)) / cats.length).toFixed(1));
    const y0 = y(0);

    const unitStr = d.unit ? ` (${d.unit})` : "";
    const lab = v => esc(v) + esc(d.unit || "");

    const out = [`<line class="axis" x1="${pl}" y1="${y0}" x2="${W - pr}" y2="${y0}"/>`];

    // 데이터 렌더링 (꺾은선 또는 막대)
    if (d.type === "line") {
      series.forEach((s, si) => {
        const strokeColor = CHART_INK[si % CHART_INK.length];
        const pts = s.values.map((v, i) => `${X(i)},${y(v)}`).join(" ");
        out.push(`<polyline fill="none" stroke="${strokeColor}" stroke-width="1.5" points="${pts}"/>`);
        s.values.forEach((v, i) => {
          out.push(
            `<circle cx="${X(i)}" cy="${y(v)}" r="2.5" fill="${strokeColor}"/>`,
            `<text class="vlab" x="${X(i)}" y="${(v < 0 ? y(v) + 11 : y(v) - 6).toFixed(1)}" text-anchor="middle">${lab(v)}</text>`,
          );
        });
      });
    } else {
      series.forEach((s, si) => {
        const fillColor = CHART_INK[si % CHART_INK.length];
        const bw = Number(((iw / cats.length) * 0.6 / series.length).toFixed(1));
        s.values.forEach((v, i) => {
          const xPos = Number((X(i) - (bw * series.length) / 2 + si * bw).toFixed(1));
          const top = Math.min(y(v), y0);
          const bh = Number(Math.abs(y(v) - y0).toFixed(1));
          out.push(
            `<rect class="chart-bar" x="${xPos}" y="${top}" width="${Math.max(1, (bw - 2).toFixed(1))}" height="${bh}" fill="${fillColor}"/>`,
            `<text class="vlab" x="${Number((xPos + bw / 2 - 1).toFixed(1))}" y="${(v < 0 ? top + bh + 10 : top - 4).toFixed(1)}" text-anchor="middle">${lab(v)}</text>`,
          );
        });
      });
    }

    // X축 카테고리 레이블
    cats.forEach((c, i) => {
      out.push(`<text class="cat-label" x="${X(i)}" y="${H - 12}" text-anchor="middle">${esc(c)}</text>`);
    });

    // 범례 (Legend)
    const leg = series.map((s, si) => s.name ? `<tspan fill="${CHART_INK[si % CHART_INK.length]}">■</tspan> ${esc(s.name)}` : null).filter(Boolean);
    if (leg.length) {
      out.push(`<text class="chart-legend" x="${pl}" y="${pt - 14}">${leg.join("   ")}</text>`);
    }

    // 축 레이블 및 단위 (Axes & Unit)
    const axes = [d.yLabel, d.xLabel].filter(x => typeof x === "string" && x.trim()).map(esc).join(" · ");
    const axesWithUnit = axes ? `${axes}${esc(unitStr)}` : unitStr ? esc(unitStr.trim()) : "";
    if (axesWithUnit) {
      out.push(`<text class="chart-axes" x="${W - pr}" y="${pt - 14}" text-anchor="end">${axesWithUnit}</text>`);
    }

    // 표본 범위 (Sample range) 명시
    const effRange = sampleRange ?? d.sampleRange ?? (cats.length > 1 ? `표본: ${cats[0]}~${cats[cats.length - 1]}` : `표본 수: ${cats.length}`);
    if (effRange) {
      out.push(`<text class="chart-sample" x="${W - pr}" y="${H - 12}" text-anchor="end">${esc(effRange)}</text>`);
    }

    return `<svg class="note-chart" viewBox="0 0 ${W} ${H}" role="img">${out.join("")}</svg>`;
  }

  const api = { renderChartSvg, parseChartFromCells, isGrounded, numbersCovered };
  globalThis.ChartSvg = api;
  if (typeof module !== "undefined") module.exports = api;
})();
