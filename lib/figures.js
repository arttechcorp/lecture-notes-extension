// 도표는 요약이 다시 그리지 않는다 — 레지스트리가 안정 id G# 를 부여하고(§4), 간단한
// 표·그래프만 검증 뒤 HTML로 옮기며(docs/note-contract.md §14), 나머지는 원본 크롭이나
// "확인 필요" 표식으로 내린다. 크롭은 키프레임에서 도표 영역만 잘라 WebP로 만든다 —
// 슬라이드 전체는 저장하지 않는다(docs/architecture-v2.md §6.7).
(() => {
  // 숫자 대조는 Formulas.crossCheck 와 같은 방식이다(§14) — 토큰화를 재사용한다.
  const Formulas = globalThis.Formulas || (typeof require !== "undefined" ? require("./formulas.js") : null);
  const numTok = Formulas?.numericTokens ?? (s =>
    (String(s ?? "").normalize("NFKC").replace(/(?<=\d),(?=\d{3}(?!\d))/g, "").match(/\d+(?:\.\d+)?|\.\d+/g) || []));
  const FIG_KINDS = new Set(["table", "chart", "diagram"]);
  const keyOf = (slideId, figId) => String(slideId) + "/" + String(figId);

  // 차이 해시 — 9×8 면적 평균으로 축소하고 각 행의 "왼쪽<오른쪽" 비교 비트를
  // row-major로 이은 64비트다. 채널 4개(RGBA) 샘플은 먼저 휘도로 접는다.
  function dHash(sample) {
    const { width: W, height: H, data } = sample || {};
    if (!W || !H || !data?.length) throw new TypeError("해시할 샘플이 없습니다");
    const lum = sample.channels === 4
      ? i => (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000
      : i => data[i];
    const GW = 9, GH = 8, bits = [];
    for (let ty = 0; ty < GH; ty++) {
      const y0 = ty * H / GH, y1 = (ty + 1) * H / GH, row = [];
      for (let tx = 0; tx < GW; tx++) {
        const x0 = tx * W / GW, x1 = (tx + 1) * W / GW;
        let sum = 0, area = 0;
        for (let sy = Math.floor(y0); sy < Math.min(H, Math.ceil(y1)); sy++) {
          const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
          for (let sx = Math.floor(x0); sx < Math.min(W, Math.ceil(x1)); sx++) {
            const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
            sum += lum(sy * W + sx) * wx * wy; area += wx * wy;
          }
        }
        row.push(area ? sum / area : 0);
      }
      for (let tx = 0; tx + 1 < GW; tx++) bits.push(row[tx] < row[tx + 1] ? 1 : 0);
    }
    let hex = "";
    for (let i = 0; i < bits.length; i += 4)
      hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
    return hex;
  }

  // 16진 해시 두 개의 다른 비트 수 — 짧은 쪽은 0으로 채워 맞춘다.
  function hamming(a, b) {
    const A = String(a ?? ""), B = String(b ?? "");
    let n = 0;
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      let x = (parseInt(A[i] || "0", 16) ^ parseInt(B[i] || "0", 16)) | 0;
      for (; x; x >>>= 1) n += x & 1;
    }
    return n;
  }

  // ocrText 의 숫자 다중집합에서 tokens 를 하나씩 소비한다 — 하나라도 모자라면
  // 화면에 없는 숫자를 지어낸 것이라 단순 표·그래프로 인정하지 않는다.
  function numbersCovered(tokens, ocrText) {
    const have = new Map();
    for (const t of numTok(ocrText)) have.set(t, (have.get(t) || 0) + 1);
    for (const t of tokens) {
      const c = have.get(t) || 0;
      if (!c) return false;
      have.set(t, c - 1);
    }
    return true;
  }

  // §14 간단한 표 — 직사각형·빈 칸 없음·열≤5·행≤12·셀 숫자가 같은 영역의 로컬 OCR에 있다.
  // 비교할 OCR이 없으면 숫자 없는 표만 옮겨 적을 수 있다 — 숫자는 검증 없이 못 믿는다.
  function isSimpleTable(cells, { ocrText = null } = {}) {
    if (!Array.isArray(cells) || !cells.length || cells.length > 12) return false;
    if (!cells.every(r => Array.isArray(r) && r.length)) return false;
    const cols = cells[0].length;
    if (cols > 5 || cells.some(r => r.length !== cols)) return false;
    const text = cells.flat().map(c => String(c ?? ""));
    if (text.some(c => !c.trim())) return false;
    if (typeof ocrText === "string") return numbersCovered(text.flatMap(numTok), ocrText);
    return !/\d/.test(text.join(" ").normalize("NFKC"));
  }

  // §14 간단한 그래프 — 막대·꺾은선, 계열≤3, 항목≤12, 모든 값이 화면 숫자와 맞고 축
  // 이름이 읽혀야 다시 그린다. 눈금만 보이는 그래프는 눈대중으로 복원하지 않고 크롭한다.
  function isSimpleChart(chartData, { ocrText = null } = {}) {
    const d = chartData;
    if (!d || (d.type !== "bar" && d.type !== "line")) return false;
    const cats = d.categories, series = d.series;
    if (!Array.isArray(cats) || !cats.length || cats.length > 12) return false;
    if (!Array.isArray(series) || !series.length || series.length > 3) return false;
    if (!series.every(s => Array.isArray(s?.values) && s.values.length === cats.length && s.values.every(Number.isFinite))) return false;
    const label = s => typeof s === "string" && s.trim();
    if (!label(d.xLabel) && !label(d.yLabel)) return false;
    if (typeof ocrText !== "string") return false;   // 미검증 차트는 다시 그리지 않는다
    return numbersCovered(series.flatMap(s => s.values.map(v => String(Math.abs(v)))), ocrText);
  }

  // 도표 레지스트리 — 근거가 된 도표(텍스트가 있는 표·차트·다이어그램)만 모아
  // (t0, bbox.y, bbox.x) 순으로 놓고, 같은 kind 끼리 dHash 해밍 ≤6 이면 한 도표로 합친다.
  // 합치면 가장 완성된 버전(채워진 셀 수 → 면적 → 이른 등장)을 대표로 두되 첫 등장 시각을
  // 유지하고, 번호 G# 는 합친 뒤에 단다 — 번호가 곧 노트의 "도표 n" 이다.
  function buildFigureRegistry(slides, { unitOf, evidence = [], hashes = {}, ocr = {}, crops = [] } = {}) {
    const figEv = new Map();
    for (const e of evidence || [])
      if (e && e.kind === "figure") figEv.set(e.unitId + "|" + e.slideId + "|" + e.sourceId, e);
    const cands = [];
    for (const slide of slides || []) {
      const unitId = typeof unitOf === "function" ? unitOf(slide.slideId) : null;
      if (unitId == null) continue;   // 단위에 속하지 않는 슬라이드의 도표는 근거가 아니다
      for (const fig of slide.figures || []) {
        if (!fig || !FIG_KINDS.has(fig.kind)) continue;
        const ev = figEv.get(unitId + "|" + String(slide.slideId) + "|" + String(fig.id));
        if (!ev) continue;            // 텍스트가 없어 근거가 안 된 도표는 건너뛴다
        cands.push({ slide, fig, unitId, evidenceId: ev.id });
      }
    }
    const bx = f => f.bbox && Number.isFinite(f.bbox.x) ? f.bbox.x : Infinity;
    const by = f => f.bbox && Number.isFinite(f.bbox.y) ? f.bbox.y : Infinity;
    cands.sort((a, z) => a.slide.t0 - z.slide.t0 || by(a.fig) - by(z.fig) || bx(a.fig) - bx(z.fig));

    const filled = c => (c.fig.cells || []).reduce((n, r) => n + (r || []).filter(v => String(v ?? "").trim()).length, 0);
    const area = c => (c.fig.bbox ? c.fig.bbox.w * c.fig.bbox.h : 0);
    const better = (a, b) => filled(a) - filled(b) || area(a) - area(b) || b.slide.t0 - a.slide.t0;
    // 해시 없는 도표는 절대 합치지 않는다. 비교는 그룹의 모든 멤버 해시와 한다 —
    // A~B, B~C 처럼 이어진 근접쌍도 한 그룹이다.
    const groups = [];
    for (const c of cands) {
      const h = hashes[keyOf(c.slide.slideId, c.fig.id)];
      const g = h ? groups.find(g => g.kind === c.fig.kind && g.hashes.some(x => hamming(x, h) <= 6)) : null;
      if (!g) groups.push({ kind: c.fig.kind, rep: c, t0: c.slide.t0, hashes: h ? [h] : [] });
      else { g.hashes.push(h); if (better(c, g.rep) > 0) g.rep = c; }
    }

    const cropSet = new Set(crops || []);
    return groups.map((g, i) => {
      const { slide, fig, unitId, evidenceId } = g.rep;
      const key = keyOf(slide.slideId, fig.id), ocrText = ocr[key] ?? null;
      let display;
      if (fig.kind === "table" && isSimpleTable(fig.cells, { ocrText })) display = "table";
      else if (fig.kind === "chart" && isSimpleChart(fig.chartData, { ocrText })) display = "chart";
      else display = cropSet.has(key) ? "crop" : "check";
      return {
        id: "G" + (i + 1), evidenceId, unitId,
        slideId: String(slide.slideId), t0: g.t0,
        kind: fig.kind, title: fig.title ?? null,
        cells: fig.cells ?? null, chartData: fig.chartData ?? null,
        display, cropKey: key,
      };
    });
  }

  // 비전 bbox(0~1 비율)를 비트맵 좌표로 옮겨 도표 영역만 잘라낸다. 긴 변은 maxSide 로
  // 내리고 WebP로 돌려준다. DOM 전역은 쓰지 않는다 — 캔버스 팩토리는 호출자가 주입한다.
  async function cropFigure(bitmap, bbox, { createCanvas, maxSide = 1200, quality = 0.8 } = {}) {
    const W = bitmap?.width || 0, H = bitmap?.height || 0;
    const x0 = (bbox?.x ?? NaN) * W, y0 = (bbox?.y ?? NaN) * H;
    const sx = Math.max(0, Math.min(W, x0)), sy = Math.max(0, Math.min(H, y0));
    const sw = Math.max(0, Math.min(W, x0 + (bbox?.w ?? NaN) * W) - sx);
    const sh = Math.max(0, Math.min(H, y0 + (bbox?.h ?? NaN) * H) - sy);
    if (!(sw > 0 && sh > 0)) throw new TypeError("빈 도표 영역은 자를 수 없습니다");
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
    const canvas = createCanvas(w, h);
    canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
    return canvas.convertToBlob({ type: "image/webp", quality });
  }

  const api = { dHash, hamming, isSimpleTable, isSimpleChart, buildFigureRegistry, cropFigure };
  globalThis.Figures = api;
  if (typeof module !== "undefined") module.exports = api;
})();
