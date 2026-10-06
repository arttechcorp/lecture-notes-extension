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

  // 크롭 소스 픽셀의 짧은 변 하한 — 이보다 작으면 PP-OCR 판독을 숫자 대조에 못 쓴다(저해상도 표시).
  const FIG_CROP_MIN_SIDE = 64;

  // 자를 상자를 정한다 — 모든 크롭 호출이 거치는 유일한 검증 지점이다. 비전 bbox(0~1 비율)는
  // 유한·양수이고 프레임 안에 있어야 한다 — 아니면 CROP_BAD_BBOX(소스 픽셀 0인 빈 영역도 같다).
  // 유효한 상자에는 패딩을 더하는데 프레임 픽셀 상한(padPx)과 원본 상자 비율(padRatio) 둘 다로 묶는다 —
  // 작은 상자가 테두리 몇 픽셀로 "읽을 수 있는" 크기가 되는 일은 없다. 패딩 뒤에도 프레임의 whole(기본
  // 90%) 이상이면 슬라이드 통째라 CROP_WHOLE_FRAME 으로 거절한다(D2). 저해상도 판정(lowRes)과
  // 소스 크기(srcW·srcH)는 패딩 전 원본 소스 픽셀로 잰다 — 테두리가 품질 지표를 오염시키지 못한다.
  function cropBox(bbox, W, H, { padPx = 24, padRatio = 0.05, whole = 0.9, minSide = FIG_CROP_MIN_SIDE } = {}) {
    const b = bbox || {}, E = 1e-6;
    if (!(W > 0) || !(H > 0)) return { code: "CROP_BAD_BBOX" };
    const x0 = b.x, y0 = b.y, x1 = x0 + b.w, y1 = y0 + b.h;
    if (![x0, y0, x1, y1].every(Number.isFinite) || !(b.w > 0 && b.h > 0) || x0 < -E || y0 < -E || x1 > 1 + E || y1 > 1 + E)
      return { code: "CROP_BAD_BBOX" };
    const srcW = b.w * W, srcH = b.h * H;
    if (srcW < 1 || srcH < 1) return { code: "CROP_BAD_BBOX" }; // 소스 픽셀이 없다 = 빈 영역
    const px = Math.min(padPx / W, padRatio * b.w), py = Math.min(padPx / H, padRatio * b.h);
    const x = Math.max(0, x0 - px), y = Math.max(0, y0 - py), w = Math.min(1, x1 + px) - x, h = Math.min(1, y1 + py) - y;
    if (w * h >= whole) return { code: "CROP_WHOLE_FRAME" };
    const sx = Math.floor(x * W), sy = Math.floor(y * H);
    const sw = Math.max(1, Math.ceil((x + w) * W) - sx), sh = Math.max(1, Math.ceil((y + h) * H) - sy);
    return { box: { x, y, w, h }, sx, sy, sw, sh, srcW, srcH, lowRes: srcW < minSide || srcH < minSide };
  }

  // 크롭 후보를 고른다 — kind 필터와 "같은 kind·같은 상자" 중복 제거·상자 검증을 상한(cap) 전에 한다.
  // 유효 후보는 소스 픽셀 면적이 큰 순으로 놓는다(동률은 문서 순서 — 안정 정렬) — 다이어그램도 텍스트
  // 유무와 무관하게 후보다. 거절은 rejected 에 {f, code}, 상한으로 빠진 수는 omitted 로 돌려준다.
  function cropCandidates(list, W, H, { kinds = null, cap = Infinity } = {}) {
    const seen = new Set(), items = [], rejected = [];
    for (const f of list || []) {
      if (!f || !f.bbox || !f.id || (kinds && !kinds.has(f.kind))) continue;
      const k = `${f.kind}|${f.bbox.x},${f.bbox.y},${f.bbox.w},${f.bbox.h}`;
      if (seen.has(k)) continue; seen.add(k);
      const r = cropBox(f.bbox, W, H);
      if (r.code) { rejected.push({ f, code: r.code }); continue; }
      items.push({ f, r });
    }
    items.sort((a, z) => z.r.srcW * z.r.srcH - a.r.srcW * a.r.srcH);
    return { items: items.slice(0, cap), rejected, omitted: Math.max(0, items.length - cap) };
  }

  // 근거가 될 수 있는 도표 텍스트(preprocess.figText 와 같은 판정: 제목·셀·차트 요약). 전부 비면
  // figure 근거가 안 돼 노트 레지스트리에 오르지 않는다 — 텍스트 없는 도표는 크롭만 남는다.
  function figureHasText(f) {
    return Boolean(String(f?.title ?? "").trim()
      || (f?.cells || []).some(r => (r || []).some(c => String(c ?? "").trim()))
      || String(f?.chartSummary ?? "").trim());
  }

  // 도표 크롭의 숫자 대조용 독립 OCR — 실시간 경로와 같은 기기 안 PP-OCRv5 런타임(lib/ppocr-runtime.mjs,
  // session.js 가 띄우는 엔진)을 지연 로드해 하나만 쓴다. 초기화가 던지면 새 엔진도 내려 메모리를 풀고,
  // 실패(null)도 약속째 캐시에 둬 이 작업 안의 다음 크롭이 엔진을 다시 띄우지 않게 한다 — 캐시를 비우는 건
  // 작업 끝의 cropOcrDispose 몫이라 다음 작업이 재시도한다.
  // 두 번째 인식 엔진이나 네트워크 요청은 만들지 않는다.
  let cropOcrP = null;
  function cropOcr() {
    if (cropOcrP) return cropOcrP;
    const p = cropOcrP = (async () => {
      let engine = null;
      try {
        const C = globalThis.PpOcrV5 ?? (await import(chrome.runtime.getURL("lib/ppocr-runtime.mjs"))).PpOcrV5;
        engine = new C(); await engine.init(); return engine;
      } catch {
        try { await engine?.dispose?.(); } catch { /* 정리 실패는 무시한다 */ }
        return null;
      }
    })();
    return p;
  }
  // 진행 중이던 크롭 작업이 다 끝난 뒤(작업의 finally) 부른다 — 엔진을 내려 메모리를 풀고, 실패한
  // 초기화(null)도 캐시를 비워 다음 작업이 재시도하게 한다.
  async function cropOcrDispose() {
    const p = cropOcrP; cropOcrP = null;
    try { await (await p)?.dispose?.(); } catch { /* 정리 실패는 무시한다 */ }
  }

  // 검증된 비율 상자를 비트맵 좌표로 옮겨 도표 영역만 잘라낸다 — cropBox 의 검사·패딩을 그대로 거치고,
  // 거절은 코드를 단 TypeError 다. 긴 변은 maxSide 로 내리고 WebP로 돌려준다 — 소스 픽셀을 키워 복원된
  // 척하지 않는다(scale ≤ 1). DOM 전역은 쓰지 않는다 — 캔버스 팩토리는 호출자가 주입한다.
  // info 를 넘기면 cropBox 결과(패딩 영역·소스 픽셀·저해상도 표시)를 채워 준다(블롭 반환은 그대로).
  async function cropFigure(bitmap, bbox, { createCanvas, maxSide = 1200, quality = 0.8, info, ...box } = {}) {
    const r = cropBox(bbox, bitmap?.width || 0, bitmap?.height || 0, box);
    if (r.code) throw Object.assign(new TypeError("자를 수 없는 도표 영역입니다"), { code: r.code });
    if (info) Object.assign(info, r);
    const scale = Math.min(1, maxSide / Math.max(r.sw, r.sh));
    const w = Math.max(1, Math.round(r.sw * scale)), h = Math.max(1, Math.round(r.sh * scale));
    const canvas = createCanvas(w, h);
    canvas.getContext("2d").drawImage(bitmap, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
    return canvas.convertToBlob({ type: "image/webp", quality });
  }

  const api = { dHash, hamming, isSimpleTable, isSimpleChart, buildFigureRegistry, cropBox, cropCandidates, cropFigure, figureHasText, cropOcr, cropOcrDispose };
  globalThis.Figures = api;
  if (typeof module !== "undefined") module.exports = api;
})();
