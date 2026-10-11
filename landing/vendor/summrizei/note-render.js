// 파이프라인 v2 H단계 렌더 엔진 (docs/architecture-v2.md §6.3·§6.6·§6.7, docs/note-contract.md §14·§15). Note JSON + 크롭 → 결정적 HTML.
// 표현(템플릿·문서 순서·고지 문구·CSS)은 전부 NoteSpec 슬롯(lib/note-spec.js)에서 온다. 여기에는 양식이 없다.
// 엔진이 책임지는 것: 모델 텍스트 이스케이프, {{F12}} 치환, 수식·도표의 display 처리, 크롭 src 허용 목록, 문항 번호, 경고 코드.
// 경고는 내용이 없다 — {code, count, ids?}만. KaTeX 은 formulas.js 처럼 불러오지 않고 주입받는다.
(() => {
  const NoteSpec = globalThis.NoteSpec || (typeof require !== "undefined" ? require("./note-spec.js") : null);
  const ChartSvg = globalThis.ChartSvg || (typeof require !== "undefined" ? require("./chart-svg.js") : null);
  // formulas.js substituteRefs·verify.js 와 같은 참조 형태. 렌더러가 치환하는 것만 참조로 센다.
  const REF = /\{\{\s*(F\d+)\s*\}\}/g;
  // 식 행으로 링크되는 {{F#}} 앞의 독립 단어 '식'+공백 — 링크 텍스트(식 N)가 그 말을 품으므로 원문에서 하나만 뗀다.
  // 인식·공식처럼 앞이 글자·숫자·_ 인 식은 독립 단어가 아니라 남긴다.
  const SIK_REF = /(^|[^\p{L}\p{N}_])식\s+(?=\{\{\s*(F\d+)\s*\}\})/gu;
  // 크롭은 blob: 이거나 래스터 data: 이미지여야 한다. 원격 URL·svg·html 은 거절한다(추적·스크립트 경로).
  const SRC_OK = /^(?:blob:[\w\-.~:\/?#@!$&()*+,;=%]+|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+\/]+={0,2})$/;
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = text => String(text ?? "").replace(/[&<>"']/g, c => ESC[c]);
  const arr = v => (Array.isArray(v) ? v : []);
  // 알 수 없는 블록 폴백이 건너뛰는 키: 문자열이지만 본문이 아니다. sec·check·sys 는 투영 블록의 운반 필드이고
  // 나머지는 내부 id 를 싣는 필드다 — 폴백에 내부 id 를 텍스트로 흘리지 않는다(note-export.js 와 같은 규칙).
  const SKIP_KEYS = new Set(["type", "id", "ids", "evidenceIds", "sectionId", "status", "importance", "emphasis", "sec", "check", "sys",
    "targetIds", "targetId", "reviewIds", "formulaIds", "figureIds", "conceptId", "conceptIds", "appliedConceptIds",
    "unitIds", "crossUnitIds", "ranges", "pointRefs", "homeBlockId", "key", "from", "to"]);
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

  function renderNote(note, { katex, crops = {}, spec = NoteSpec, options = {} } = {}) {
    // KaTeX 부재를 조용히 넘기면 모든 수식이 확인 표시로 내려간다 — 즉시 던진다.
    if (!katex || typeof katex.renderToString !== "function") throw new Error("KaTeX 객체가 필요합니다.");
    // §15 표시 옵션 — Note 를 바꾸지 않는 렌더 입력이다(§13).
    const o = options && typeof options === "object" ? options : {};
    const opts = {
      medium: o.medium === "print" ? "print" : "web",
      answers: o.answers === "inline" ? "inline" : "end",
      exam: !!o.exam, writing: !!o.writing,
      // §4.6 강조 임계 — 근거 메타의 emphasis 수치가 이 값 이상인 주장을 강조 표시한다. 기본 null=끔.
      emphasisMin: typeof o.emphasisMin === "number" && Number.isFinite(o.emphasisMin) ? o.emphasisMin : null,
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

    // B10 식 행(formulaIds)이 소개하는 등록 수식 — 문서 순서로 사람 번호(식 N)를 매긴다(§15).
    // 본문 {{F#}} 는 같은 번호로 그 행에 링크해 식을 두 번 그리지 않는다. 내부 F# 는 eq-F# 앵커 속성에만 남고
    // 화면 텍스트에는 나오지 않는다.
    const eqNum = new Map();
    for (const s of n.sections) for (const b of arr(s && s.blocks))
      if (b && b.type === "B10") for (const id of arr(b.content && b.content.formulaIds))
        if (byId.has(id) && !eqNum.has(id)) eqNum.set(id, eqNum.size + 1);

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
    // mismatch 수식은 크롭(있으면) 또는 확인 표식으로 보인다.
    // 본문 {{F#}} 참조(인라인)와 B10 식 행(디스플레이)은 같은 본체 규칙을 쓰고 KaTeX displayMode 만 다르다.
    const formulaBody = (e, id, display) => {
      const check = () => `<span class="note-f note-f-check">수식 확인 필요 <small>(${fmtTime(e.t0)})</small></span>`
        + (typeof e.text === "string" && e.text.trim() ? ` <small class="note-f-ocr">인식한 원문(미검증): ${esc(e.text)}</small>` : "");
      const isMismatch = e?.checks && (e.checks.symbols === "mismatch" || e.checks.units === "mismatch" || e.checks.parse === "failed");
      if (isMismatch) {
        const img = crop(id, "수식");
        if (img) return `<span class="note-f note-f-img">${img}</span>`;
        return check();
      }
      if (e.display === "latex") {
        if (typeof e.latex === "string" && e.latex.trim()) {
          const html = render(e.latex, display);
          if (html !== null) return html;
          warn("RENDER_FORMULA_FAILED", id);
        }
        return check();
      }
      if (e.display === "crop") {
        // 원본 이미지 수식에는 설명 문구를 붙이지 않는다(사용자 결정) — 이미지 대체 텍스트만 둔다.
        const img = crop(id, "수식");
        if (img) return `<span class="note-f note-f-img">${img}</span>`;
      }
      return check();
    };
    const formula = id => {
      // 식 행이 있는 수식은 본문에서 다시 그리지 않고 그 행으로 링크한다(§15).
      const m = eqNum.get(id);
      if (m) return `<a class="eq-ref" href="#eq-${esc(id)}">식 ${m}</a>`;
      const e = byId.get(id);
      if (!e) { warn("RENDER_REF_UNKNOWN", id); return `<span class="note-f note-f-missing">수식 확인 필요</span>`; }
      return formulaBody(e, id, false);
    };
    // B10 formulaIds 전용: 등록 수식은 eq-F# 앵커가 딸린 독립 행으로 문서에서 처음 한 번만 소개한다.
    // 같은 식이 뒤 블록에 다시 나오면 수식 본체를 반복하지 않고 첫 앵커로 가는 라벨 링크를 둔다(§15).
    // 라벨은 사람 번호(식 N) — 내부 F# 는 앵커 속성에만 남긴다.
    const eqSeen = new Set();
    const equation = id => {
      const m = eqNum.get(id);
      if (!m) { warn("RENDER_REF_UNKNOWN", id); return `<div class="equation"><span class="note-f note-f-missing">수식 확인 필요</span></div>`; }
      if (eqSeen.has(id))
        return `<div class="equation"><a class="eq-ref" href="#eq-${esc(id)}">식 ${m}</a><small class="eq-note"> — 앞에서 소개한 식</small></div>`;
      eqSeen.add(id);
      return `<div class="equation" id="eq-${esc(id)}"><span class="eq-tag">식 ${m}</span>${formulaBody(byId.get(id), id, true)}</div>`;
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
    // §14: 간단한 막대·꺾은선은 결정론적 SVG(lib/chart-svg.js)로만 다시 그린다 — 차트 렌더러는
    // 하나다. 숫자 근거 대조는 레지스트리 단계(isSimpleChart)가 끝낸 뒤라 여기선 다시 요구하지 않는다.
    const figChart = f => {
      if (!f) return null;
      const svg = ChartSvg && typeof ChartSvg.renderChartSvg === "function"
        ? ChartSvg.renderChartSvg(f, { requireGrounded: false })
        : null;
      if (!svg) { warn("RENDER_CHART_INVALID", f.id); return null; }
      return svg;
    };
    // §14: 도표 표시 상태 3단 (재조판 -> 크롭+근거설명 -> 도표 누락)
    const figure = id => {
      const f = figById.get(id);
      if (!f) { warn("RENDER_REF_UNKNOWN", id); return `<span class="note-fig note-fig-missing">도표 누락</span>`; }
      const title = typeof f.title === "string" && f.title.trim() ? `<span class="note-fig-title">${esc(f.title)}</span>` : "";
      const missing = `<p class="note-fig-missing">도표 누락 <small>(${fmtTime(f.t0)})</small></p>`;
      let body = "", src = "";
      // 1단: 검증된 재조판 (표/SVG)
      if (f.display === "table") body = figTable(f, "화면 표를 옮겨 적음") || "";
      else if (f.display === "chart") { body = figChart(f) || ""; if (body) src = `<span class="note-fig-src">화면 그래프를 옮겨 그림</span>`; }
      // 2단: 불충분하지만 크롭 있음 -> 크롭 + 근거 기반 설명 (설명 주장이 있을 때만)
      if (!body) {
        const img = crop(id, typeof f.title === "string" ? f.title : "도표 원본 이미지");
        if (img) {
          const exp = (f.explanation && typeof f.explanation === "object" && typeof f.explanation.text === "string" && f.explanation.text.trim())
            ? `<div class="note-fig-explanation">${claim(f.explanation)}</div>`
            : "";
          body = img + exp;
        }
      }
      // 3단: 둘 다 없으면 '도표 누락'
      if (!body) body = missing;
      return `<figure class="note-fig" data-fig="${esc(id)}">${title}${body}${src}</figure>`;
    };
    // 요소 본문 전용: 결과에 따옴표가 들어 있어 속성 안에 쓰면 깨진다. 속성에는 esc 만 쓴다.
    const rich = text => esc(String(text ?? "").replace(SIK_REF, (m, pre, id) => (eqNum.has(id) ? pre : m)))
      .split(/\r?\n/).map(line => line.replace(REF, (_, id) => formula(id))).join("<br>");
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

    const h = { esc, rich, claim, math, formula, equation, figure, crop, block, notice, time, opts, note: n, qno };
    if (n.noteSpecVersion !== spec.NOTE_SPEC_VERSION) warn("RENDER_SPEC_MISMATCH");
    const css = spec && typeof spec.css === "string" && spec.css ? `<style>${spec.css}</style>` : "";
    return { html: css + guard(() => spec.layout(n, h), () => ""), warnings };
  }

  const api = { renderNote };
  globalThis.NoteRender = api;
  if (typeof module !== "undefined") module.exports = api;
})();
