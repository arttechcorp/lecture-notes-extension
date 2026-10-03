// 파이프라인 v2 H단계 렌더 엔진 (docs/architecture-v2.md §6.3·§6.6·§6.7, docs/note-contract.md §14·§15). Note JSON + 크롭 → 결정적 HTML.
// 표현(템플릿·문서 순서·고지 문구·CSS)은 전부 NoteSpec 슬롯(lib/note-spec.js)에서 온다. 여기에는 양식이 없다.
// 엔진이 책임지는 것: 모델 텍스트 이스케이프, {{F12}} 치환, 수식·도표의 display 처리, 크롭 src 허용 목록, 문항 번호, 경고 코드.
// 경고는 내용이 없다 — {code, count, ids?}만. KaTeX 은 formulas.js 처럼 불러오지 않고 주입받는다.
(() => {
  const NoteSpec = globalThis.NoteSpec || (typeof require !== "undefined" ? require("./note-spec.js") : null);
  // formulas.js substituteRefs·verify.js 와 같은 참조 형태. 렌더러가 치환하는 것만 참조로 센다.
  const REF = /\{\{\s*(F\d+)\s*\}\}/g;
  // 크롭은 blob: 이거나 래스터 data: 이미지여야 한다. 원격 URL·svg·html 은 거절한다(추적·스크립트 경로).
  const SRC_OK = /^(?:blob:[\w\-.~:\/?#@!$&()*+,;=%]+|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+\/]+={0,2})$/;
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = text => String(text ?? "").replace(/[&<>"']/g, c => ESC[c]);
  const arr = v => (Array.isArray(v) ? v : []);
  // 알 수 없는 블록 폴백이 건너뛰는 키: 문자열이지만 본문이 아니다. sec·check·sys 는 투영 블록의 운반 필드다.
  const SKIP_KEYS = new Set(["type", "id", "evidenceIds", "sectionId", "status", "importance", "emphasis", "sec", "check", "sys"]);
  const leaves = (v, out = []) => {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!SKIP_KEYS.has(k)) leaves(x, out);
    return out;
  };
  // §15 시각 표기: 한 시간 미만 m:ss, 이상 h:mm:ss. 구간은 en dash 로 잇는다.
  const fmtTime = t => {
    const s = Math.max(0, Math.round(Number(t) || 0)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
  };
  const time = (t0, t1) => (t1 == null ? fmtTime(t0) : `${fmtTime(t0)}–${fmtTime(t1)}`);
  // §6 basis 라벨 — v1 정책은 꺼져 있지만 뒤 계약이 켜면 렌더가 그대로 단다(§18·6-8).
  const BASIS_LABEL = { synthetic: ["note-label-synthetic", "가상 사례"], external: ["note-label-external", "강의 밖 보강 — 확인 필요"] };
  const CHART_INK = ["var(--accent)", "var(--ink)", "var(--muted)"];

  function renderNote(note, { katex, crops = {}, spec = NoteSpec, options = {} } = {}) {
    // KaTeX 부재를 조용히 넘기면 모든 수식이 확인 표시로 내려간다 — 즉시 던진다.
    if (!katex || typeof katex.renderToString !== "function") throw new Error("KaTeX 객체가 필요합니다.");
    // §15 표시 옵션 — Note 를 바꾸지 않는 렌더 입력이다(§13).
    const o = options && typeof options === "object" ? options : {};
    const opts = {
      medium: o.medium === "print" ? "print" : "web",
      answers: o.answers === "inline" ? "inline" : "end",
      exam: !!o.exam, writing: !!o.writing,
    };
    const src = note && typeof note === "object" ? note : {};
    const n = { ...src, meta: src.meta || {}, global: arr(src.global), sections: arr(src.sections), registry: arr(src.registry), figures: arr(src.figures), notices: arr(src.notices) };
    const byId = new Map(n.registry.filter(e => e && typeof e.id === "string").map(e => [e.id, e]));
    const figById = new Map(n.figures.filter(e => e && typeof e.id === "string").map(e => [e.id, e]));
    const cropMap = crops && typeof crops === "object" ? crops : {};
    const warnings = [];
    const warn = (code, id) => {
      let w = warnings.find(x => x.code === code);
      if (!w) warnings.push(w = { code, count: 0 });
      w.count++;
      if (typeof id === "string" && /^[FG]\d+$/.test(id)) { w.ids ??= []; if (!w.ids.includes(id)) w.ids.push(id); }
    };
    // B14 문항은 단원 순서대로 문서 전체 번호를 매긴다(§15) — q-NN 과 a-NN 이 같은 번호를 공유한다.
    const qIndex = new Map();
    for (const s of n.sections) for (const b of arr(s && s.blocks))
      if (b && b.type === "B14") arr(b.content && b.content.items).forEach((_, i) => qIndex.set(`${b.id}/${i}`, qIndex.size + 1));
    const qno = (blockId, index) => qIndex.get(`${blockId}/${index}`) ?? null;

    const render = (latex, display) => {
      try { return katex.renderToString(String(latex ?? ""), { throwOnError: true, displayMode: display }); } catch { return null; }
    };
    const crop = (id, alt = "") => {
      if (!Object.hasOwn(cropMap, id)) return "";
      const s = cropMap[id];
      if (typeof s !== "string" || !SRC_OK.test(s)) { warn("RENDER_CROP_REJECTED", id); return ""; }
      return `<img class="note-crop" src="${esc(s)}" alt="${esc(alt)}">`;
    };
    // §14: display 는 조립 때 정해진다 — 재계산하지 않는다. latex 실패·크롭 부재는 "확인 필요"로 내린다(자동 대체 없음).
    const formula = id => {
      const e = byId.get(id);
      if (!e) { warn("RENDER_REF_UNKNOWN", id); return `<span class="note-f note-f-missing">[알 수 없는 수식 ${esc(id)}]</span>`; }
      const check = () => `<span class="note-f note-f-check">수식 확인 필요 <small>(${fmtTime(e.t0)})</small></span>`
        + (typeof e.text === "string" && e.text.trim() ? ` <small class="note-f-ocr">인식 원문(미검증): ${esc(e.text)}</small>` : "");
      if (e.display === "latex") {
        if (typeof e.latex === "string" && e.latex.trim()) {
          const html = render(e.latex, false);
          if (html !== null) return html;
          warn("RENDER_FORMULA_FAILED", id);
        }
        return check();
      }
      if (e.display === "crop") {
        const img = crop(id, "원본 이미지로 표시");
        if (img) return `<span class="note-f note-f-img">${img}<span class="note-f-label">원본 이미지로 표시</span></span>`;
      }
      return check();
    };
    // §14: 간단한 표만 HTML 로 옮긴다 — 첫 행이 열 머리(thead), 첫 열이 행 머리(scope=row), 좁은 화면용 data-label.
    const figTable = (f, caption) => {
      const rows = arr(f.cells).filter(r => Array.isArray(r) && r.length);
      if (!rows.length) return null;
      const head = rows[0];
      return `<table class="note-table">${caption ? `<caption>${esc(caption)}</caption>` : ""}<thead><tr>${head.map(c => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>`
        + rows.slice(1).map(r => `<tr>${r.map((c, j) => j === 0 ? `<th scope="row">${esc(c)}</th>` : `<td data-label="${esc(head[j] ?? "")}">${esc(c)}</td>`).join("")}</tr>`).join("")
        + "</tbody></table>";
    };
    // §14: 간단한 막대·꺾은선만 노트 토큰(var())으로 다시 그린다 — 차트 라이브러리는 두지 않는다. 값 라벨은 화면에 적힌 값만.
    // 음수는 영점 기준선(y0) 아래로 그린다.
    const figChart = f => {
      const d = f.chartData;
      if (!d || !Array.isArray(d.categories) || !Array.isArray(d.series)) return null;
      const cats = d.categories.slice(0, 12).map(String), series = d.series.slice(0, 3).filter(s => s && Array.isArray(s.values));
      const vals = series.flatMap(s => s.values.filter(v => Number.isFinite(v)));
      if (!cats.length || !series.length || vals.length !== cats.length * series.length) return null;
      const W = 640, H = 250, pl = 10, pr = 10, pt = 26, pb = 28, iw = W - pl - pr, ih = H - pt - pb;
      const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
      const y = v => pt + ih - ((v - lo) / span) * ih, X = i => pl + (iw * (i + .5)) / cats.length, y0 = y(0);
      const lab = v => esc(v) + esc(d.unit || "");
      const out = [`<line class="axis" x1="${pl}" y1="${y0}" x2="${W - pr}" y2="${y0}"/>`];
      if (d.type === "line") series.forEach((s, si) => {
        out.push(`<polyline fill="none" stroke="${CHART_INK[si % 3]}" stroke-width="1.5" points="${s.values.map((v, i) => `${X(i)},${y(v).toFixed(1)}`).join(" ")}"/>`);
        s.values.forEach((v, i) => out.push(
          `<circle cx="${X(i)}" cy="${y(v).toFixed(1)}" r="2.5" fill="${CHART_INK[si % 3]}"/>`,
          `<text class="vlab" x="${X(i)}" y="${(v < 0 ? y(v) + 11 : y(v) - 6).toFixed(1)}" text-anchor="middle">${lab(v)}</text>`));
      });
      else series.forEach((s, si) => {
        const bw = (iw / cats.length) * .6 / series.length;
        s.values.forEach((v, i) => {
          const x = X(i) - (bw * series.length) / 2 + si * bw, top = Math.min(y(v), y0), bh = Math.abs(y(v) - y0);
          out.push(`<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" fill="${CHART_INK[si % 3]}"/>`,
            `<text class="vlab" x="${(x + bw / 2 - 1).toFixed(1)}" y="${(v < 0 ? top + bh + 10 : top - 4).toFixed(1)}" text-anchor="middle">${lab(v)}</text>`);
        });
      });
      cats.forEach((c, i) => out.push(`<text x="${X(i)}" y="${H - 8}" text-anchor="middle">${esc(c)}</text>`));
      const leg = series.map((s, si) => s.name ? `<tspan fill="${CHART_INK[si % 3]}">■</tspan> ${esc(s.name)}` : null).filter(Boolean);
      if (leg.length) out.push(`<text x="${pl}" y="${pt - 10}">${leg.join("   ")}</text>`);
      const axes = [d.yLabel, d.xLabel].filter(x => typeof x === "string" && x).map(esc).join(" · ");
      if (axes) out.push(`<text x="${W - pr}" y="${pt - 10}" text-anchor="end">${axes}</text>`);
      return `<svg class="note-chart" viewBox="0 0 ${W} ${H}" role="img">${out.join("")}</svg>`;
    };
    const figure = id => {
      const f = figById.get(id);
      if (!f) { warn("RENDER_REF_UNKNOWN", id); return `<span class="note-fig note-fig-missing">[알 수 없는 도표 ${esc(id)}]</span>`; }
      const title = typeof f.title === "string" && f.title.trim() ? `<span class="note-fig-title">${esc(f.title)}</span>` : "";
      const check = `<p class="note-fig-check">도표 확인 필요 <small>(${fmtTime(f.t0)})</small></p>`;
      let body = "", src = "";
      if (f.display === "table") body = figTable(f, "화면 표를 옮겨 적음") || "";
      else if (f.display === "chart") { body = figChart(f) || ""; if (body) src = `<span class="note-fig-src">화면 그래프를 옮겨 그림</span>`; }
      else if (f.display === "crop") body = crop(id, typeof f.title === "string" ? f.title : "도표 원본 이미지");
      if (!body) body = check;
      return `<figure class="note-fig" data-fig="${esc(id)}">${title}${body}${src}</figure>`;
    };
    // 요소 본문 전용: 결과에 따옴표가 들어 있어 속성 안에 쓰면 깨진다. 속성에는 esc 만 쓴다.
    const rich = text => esc(text).split(/\r?\n/).map(line => line.replace(REF, (_, id) => formula(id))).join("<br>");
    const math = (latex, mo) => render(latex, !!(mo && mo.display))
      ?? (warn("RENDER_FORMULA_FAILED"), `<code class="note-f-src">${esc(latex)}</code>`);
    // §6 주장: 본문은 rich 로, 근거 id 는 텍스트로 쓰지 않고 data-ev 속성에 둔다. synthetic·external 은 라벨을 단다.
    const claim = (c, co = {}) => {
      if (!c || typeof c.text !== "string") return "";
      const tag = co && co.tag === "span" ? "span" : "p";
      const ev = arr(c.evidenceIds).filter(x => typeof x === "string").map(esc).join(" ");
      const lab = BASIS_LABEL[c.basis] ? ` <span class="note-label ${BASIS_LABEL[c.basis][0]}">${BASIS_LABEL[c.basis][1]}</span>` : "";
      return `<${tag} class="note-claim"${ev ? ` data-ev="${ev}"` : ""}>${rich(c.text)}${lab}</${tag}>`;
    };

    // 템플릿이 던지거나 문자열을 안 주면 폴백으로 대신한다 — 렌더는 항상 문서 하나를 낸다.
    const guard = (fn, fallback) => {
      try { const out = fn(); if (typeof out === "string") return out; } catch { /* 아래 경고 */ }
      warn("RENDER_TEMPLATE_FAILED");
      return fallback();
    };
    const fallback = b => `<div class="note-fallback">${leaves(b).map(t => `<p>${rich(t)}</p>`).join("")}</div>`;
    // 모든 블록은 같은 봉투를 갖는다 — id·data-type 앵커(§15)는 슬롯이 아니라 엔진이 단다.
    const wrap = (b, inner) => {
      const id = b && typeof b.id === "string" && b.id ? ` id="${esc(b.id)}"` : "";
      const tp = b && typeof b.type === "string" ? ` data-type="${esc(b.type)}"` : "";
      return `<section class="note-block"${id}${tp}>${inner}</section>`;
    };
    const block = b => {
      const type = b && b.type, templates = (spec && spec.templates) || {};
      if (typeof type !== "string" || !Object.hasOwn(templates, type) || typeof templates[type] !== "function") {
        warn("RENDER_NO_TEMPLATE");
        return wrap(b, fallback(b));
      }
      return wrap(b, guard(() => templates[type](b, h), () => fallback(b)));
    };
    // 고지 문구는 일반 텍스트이고 여기서 이스케이프한다.
    const notice = x => esc(guard(() => spec.notice(x, h), () => ""));

    const h = { esc, rich, claim, math, formula, figure, crop, block, notice, time, opts, note: n, qno };
    if (n.noteSpecVersion !== spec.NOTE_SPEC_VERSION) warn("RENDER_SPEC_MISMATCH");
    const css = spec && typeof spec.css === "string" && spec.css ? `<style>${spec.css}</style>` : "";
    return { html: css + guard(() => spec.layout(n, h), () => ""), warnings };
  }

  const api = { renderNote };
  globalThis.NoteRender = api;
  if (typeof module !== "undefined") module.exports = api;
})();
