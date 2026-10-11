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
    for (const s of n.sections) for (const b of arr(s && s.blocks)) {
      if (b && b.type === "B10") for (const id of arr(b.content && b.content.formulaIds))
        if (byId.has(id) && !eqNum.has(id)) eqNum.set(id, eqNum.size + 1);
      // 작성자 해설이 둘 곳으로 정한 수식(formulaNotes → registry[].blockId)도 같은 문서 순서로 번호를 잇는다.
      // 문서 흐름에 서지 않는 블록(B14·B18)은 홈이 될 수 없다 — 번호만 매기고 식이 안 그려지는 끊긴 앵커를 막는다.
      if (b && b.type !== "B14" && b.type !== "B18")
        for (const e of n.registry) if (e.blockId === b.id && byId.has(e.id) && !eqNum.has(e.id)) eqNum.set(e.id, eqNum.size + 1);
    }

    // 모델 LaTeX 입구 보정 — KaTeX 에서 뜻이 다른 맨 문자만 이스케이프한다.
    // bare % 는 줄 끝까지 주석이라 throw 없이 뒤가 잘린다 — "PB(33.64%)"가 "PB(33.64"로 나갔다(mis-sol-hai-28).
    // 홀수 개 백슬래시 뒤(\% 처럼 이미 이스케이프된 것)는 그대로 둔다. bare &·# 는 환경 밖에서 파싱 오류라
    // 앰퍼샌드·샵으로 둔다 — 정렬 환경(\begin{…}) 안의 & 는 열 구분자라 건드리지 않는다.
    const tex = s => {
      let t = String(s ?? "");
      const bare = (ch, rep) => { t = t.replace(new RegExp(`(\\\\*)${ch}`, "g"), (m, bs) => (bs.length % 2 ? m : bs + rep)); };
      bare("%", "\\%"); bare("#", "\\#");
      if (!/\\begin\s*\{/.test(t)) bare("&", "\\&");
      return t;
    };
    // 한 줄 display 수식은 KaTeX 가 스스로 줄을 바꾸지 못한다 — 쪽 폭(인쇄 A4 본문 686px)을 넘으면
    // 인쇄에서 잘린다(mis-sol-hai-28: eq-F9/eq-F10 OVERFLOW_X. % 보정으로 잘리던 꼬리가 다시
    // 그려지면서 실제 폭이 드러난 것). 추정 폭이 예산을 넘으면 최상위 관계 뒤·이항 연산자 앞에서
    // gathered 줄로 나누고, 끊을 곳이 없는 긴 식은 단계 축소 클래스를 단다(읽기 하한 70%).
    const EQ_BUDGET = 660;   // .equation 안쪽 보수 폭(px) — A4 본문 686px·.note 704px 모두 안쪽
    const EQ_UNIT = 9.4;     // .equation 15px·KaTeX 1.21em 기준 문자 1개 평균 전진폭(px)
    // 문자 단위 폭 추정 — 실측이 아니라 보수 추정이라 분수 괄호 안까지 합산해 약간 넓게 잡는다.
    const CMDW = {
      cdot: 1, times: 1.2, div: 1.2, cdots: 2.6, ldots: 2.6, dotsb: 2.6, dotsc: 2.6, dotsi: 2.6,
      frac: 0, dfrac: 0, tfrac: 0, sqrt: 1.4, sum: 1.8, prod: 1.8, int: 1.2, lim: 1,
      leq: 1.4, le: 1.4, geq: 1.4, ge: 1.4, neq: 1.4, ne: 1.4, approx: 1.4, sim: 1.4, cong: 1.4, equiv: 1.4,
      to: 1.8, rightarrow: 1.8, Rightarrow: 2.2, leftarrow: 1.8, mapsto: 1.8, implies: 2, iff: 2, infty: 1.6,
      pm: 1.2, mp: 1.2, in: 1.4, notin: 1.4, subset: 1.6, subseteq: 1.6, propto: 1.6, perp: 1.4, mid: 0.8,
      quad: 2, qquad: 4, hspace: 0, mathrm: 0, mathit: 0, mathbf: 0, text: 0, textrm: 0, textbf: 0,
      operatorname: 0, begin: 0, end: 0, left: 0.5, right: 0.5, big: 0.8, Big: 0.9, bigg: 1, Bigg: 1.1,
      displaystyle: 0, limits: 0, hline: 0, underbrace: 0, overbrace: 0, overset: 0, underset: 0,
      alpha: 0.9, beta: 0.9, gamma: 1.2, delta: 0.9, epsilon: 0.9, varepsilon: 0.9, theta: 0.9, lambda: 0.9,
      mu: 0.9, nu: 0.9, pi: 1, rho: 0.9, sigma: 1, tau: 0.9, phi: 1.1, varphi: 1.2, chi: 1, psi: 1.1, omega: 1.1,
      Gamma: 1.3, Delta: 1.4, Theta: 1.4, Lambda: 1.3, Pi: 1.3, Sigma: 1.3, Phi: 1.4, Psi: 1.4, Omega: 1.4,
    };
    const texUnits = s => {
      let u = 0;
      for (let i = 0; i < s.length;) {
        const c = s[i];
        if (c === "\\") {
          const m = /^[a-zA-Z]+|^./.exec(s.slice(i + 1));
          u += m[0].length > 1 ? (CMDW[m[0]] ?? 1) : 1; // \%·\&·\, 등 한 글자 명령은 1자 폭
          i += 1 + m[0].length;
        } else if ("{}^_ ".includes(c)) i++;  // 조작 문자·공백 — 첨자 내용 문자는 그대로 셈
        else { u += c.codePointAt(0) > 0x7e ? 2 : 1; i++; } // 전각(한글 등)은 2자 폭
      }
      return u;
    };
    // 최상위에서만 끊는다 — {} 그룹·\left…\right·()[]·환경 안의 연산자는 끊지 않는다.
    const REL = new Set(["leq", "le", "geq", "ge", "neq", "ne", "approx", "sim", "cong", "equiv",
      "to", "rightarrow", "Rightarrow", "leftarrow", "mapsto", "implies", "iff", "in", "notin", "ni",
      "subset", "subseteq", "supset", "supseteq", "propto", "perp", "parallel", "mid", "models",
      "vdash", "ll", "gg", "prec", "succ", "preceq", "succeq"]);
    const BIN = new Set(["cdot", "times", "div", "pm", "mp", "oplus", "otimes", "ominus", "odot",
      "cap", "cup", "wedge", "vee", "land", "lor", "setminus", "circ", "bullet", "ast", "star",
      "uplus", "sqcap", "sqcup", "amalg", "dagger", "ddagger"]);
    const breakPts = s => {
      const pts = [];
      let depth = 0, par = 0, pd = 0, env = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === "\\") {
          const m = /^[a-zA-Z]+|^./.exec(s.slice(i + 1));
          const name = m[0];
          if (name === "left") par++;
          else if (name === "right") par = Math.max(0, par - 1);
          else if (name === "begin") env++;
          else if (name === "end") env = Math.max(0, env - 1);
          else if (depth === 0 && par === 0 && pd === 0 && env === 0) {
            if (REL.has(name)) pts.push(i + 1 + name.length);          // 관계는 뒤에서 끊는다
            else if (BIN.has(name)) pts.push(i);                        // 이항 명령은 앞에서
          }
          i += name.length;
        } else if (c === "{") depth++;
        else if (c === "}") depth = Math.max(0, depth - 1);
        else if (depth === 0 && par === 0 && pd === 0 && env === 0) {
          if ("=<>,;:/".includes(c)) pts.push(i + 1);                   // 관계·쉼표는 뒤에서 끊는다
          else if (c === "(" || c === "[") { pd++; }
          else if (c === ")" || c === "]") { pd = Math.max(0, pd - 1); }
          else if (c === "+") pts.push(i);                              // 이항 + 는 앞에서
          else if (c === "-") {
            const prev = s.slice(0, i).trimEnd();
            if (prev && /[\w)\]|}]$/.test(prev)) pts.push(i);           // 단항 - 는 끊지 않는다
          }
        } else if (c === "(" || c === "[") pd++;
        else if (c === ")" || c === "]") pd = Math.max(0, pd - 1);
      }
      return pts;
    };
    const gatherTex = s => {
      if (/\\begin\s*\{|\\\\/.test(s)) return null;  // 이미 환경·줄바꿈이 있는 식은 건드리지 않는다
      const pts = breakPts(s);
      if (!pts.length) return null;
      const bounds = [0, ...pts, s.length];
      const segs = bounds.slice(1).map((e, i) => s.slice(bounds[i], e));
      const lines = [];
      let cur = "";
      for (const seg of segs) {
        if (cur && (texUnits(cur) + texUnits(seg)) * EQ_UNIT > EQ_BUDGET) { lines.push(cur); cur = seg; }
        else cur += seg;
      }
      if (cur) lines.push(cur);
      if (lines.length < 2 || lines.some(l => texUnits(l) * EQ_UNIT > EQ_BUDGET)) return null;
      return `\\begin{gathered}${lines.join("\\\\")}\\end{gathered}`;
    };
    const render = (latex, display) => {
      const t = tex(latex);
      let src = t, shrink = 0;
      const est = texUnits(t) * EQ_UNIT;
      if (est > EQ_BUDGET) {
        const g = display ? gatherTex(t) : null;
        if (g) src = g;
        else shrink = est * 0.9 <= EQ_BUDGET ? 90 : est * 0.8 <= EQ_BUDGET ? 80 : 70;
      }
      let html = null;
      try { html = katex.renderToString(src, { throwOnError: true, displayMode: display }); } catch { /* gathered 변형 실패 시 원본으로 */ }
      if (html === null) {
        if (src === t) return null;
        try { html = katex.renderToString(t, { throwOnError: true, displayMode: display }); } catch { return null; }
      }
      return shrink ? `<span class="eq-shrink eq-shrink-${shrink}">${html}</span>` : html;
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
    const equation = (id, bare) => {
      const m = eqNum.get(id);
      if (!m) { warn("RENDER_REF_UNKNOWN", id); return `<div class="equation"><span class="note-f note-f-missing">수식 확인 필요</span></div>`; }
      if (eqSeen.has(id))
        return `<div class="equation"><a class="eq-ref" href="#eq-${esc(id)}">식 ${m}</a><small class="eq-note"> — 앞에서 소개한 식</small></div>`;
      eqSeen.add(id);
      // 수식 해설(도표의 note-fig-explanation 과 같은 자리): 그 식이 무엇을 뜻하는지 한 줄 — 작성자 주장이 있을 때만.
      const e = byId.get(id);
      const exp = !bare && e && e.explanation && typeof e.explanation === "object" && typeof e.explanation.text === "string" && e.explanation.text.trim()
        ? `<figcaption class="eq-caption">${claim(e.explanation, { tag: "span" })}</figcaption>` : "";
      return `<div class="equation" id="eq-${esc(id)}"><span class="eq-tag">식 ${m}</span>${formulaBody(e, id, true)}${exp}</div>`;
    };
    // 한 묶음의 식 행 — 같은 해설 문장이 이어지면 묶음 마지막 식에 한 번만 단다(mis-sol-hai-28: 같은 ※ 가 식마다 반복).
    const equations = ids => {
      const list = arr(ids);
      const cap = id => {
        const t = byId.get(id)?.explanation?.text;
        return typeof t === "string" ? t.trim() : "";
      };
      const lastOf = new Map(list.map((id, i) => [cap(id), i]).filter((_, i) => !eqSeen.has(list[i])));
      return list.map((id, i) => equation(id, !!cap(id) && lastOf.get(cap(id)) !== i)).join("");
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
      // 2단: 불충분하지만 크롭 있음 -> 크롭
      if (!body) body = crop(id, typeof f.title === "string" ? f.title : "도표 원본 이미지") || "";
      // 3단: 둘 다 없으면 '도표 누락'
      if (!body) body = missing;
      // 도표 해설(근거 있는 설명 주장)은 표시 방식과 무관하게 그림 아래 주석으로 단다 — 그 도표가 무엇을 뜻하는지.
      const exp = body !== missing && f.explanation && typeof f.explanation === "object" && typeof f.explanation.text === "string" && f.explanation.text.trim()
        ? `<figcaption class="note-fig-explanation">${claim(f.explanation, { tag: "span" })}</figcaption>` : "";
      return `<figure class="note-fig" data-fig="${esc(id)}">${title}${body}${src}${exp}</figure>`;
    };
    // 요소 본문 전용: 결과에 따옴표가 들어 있어 속성 안에 쓰면 깨진다. 속성에는 esc 만 쓴다.
    const rich = text => esc(String(text ?? "").replace(SIK_REF, (m, pre, id) => (eqNum.has(id) ? pre : m)))
      .split(/\r?\n/).map(line => line.replace(REF, (_, id) => formula(id))).join("<br>");
    const math = (latex, mo) => render(latex, !!(mo && mo.display))
      ?? (warn("RENDER_FORMULA_FAILED"), `<code class="note-f-src">${esc(latex)}</code>`);
    // §6 주장: 본문은 rich 로, 근거 id 는 텍스트로 쓰지 않고 data-ev 속성에 둔다. synthetic·external 은 라벨을 단다.
    const claim = (c, co = {}) => {
      if (!c || typeof c.text !== "string") return "";
      // 실은 문장을 현재 맥락의 seen 에 기록한다 — 뒤 슬롯의 중복 억제(keep/fresh)가 이 값으로 판단한다(mis-sol-hai-29).
      if (h && h.seen) h.seen.add(c.text);
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
      // 내용이 전부 억제(중복 슬롯 생략)된 템플릿은 껍데기도 두지 않는다 — layout 이 빈 블록을 건너뛴다.
      const inner = guard(() => templates[type](b, h), () => fallback(b));
      return inner ? wrap(b, inner) : "";
    };
    // 고지 문구는 일반 텍스트이고 여기서 이스케이프한다.
    const notice = x => esc(guard(() => spec.notice(x, h), () => ""));

    const h = { esc, rich, claim, math, formula, equation, equations, figure, crop, block, notice, time, opts, note: n, qno };
    if (n.noteSpecVersion !== spec.NOTE_SPEC_VERSION) warn("RENDER_SPEC_MISMATCH");
    const css = spec && typeof spec.css === "string" && spec.css ? `<style>${spec.css}</style>` : "";
    return { html: css + guard(() => spec.layout(n, h), () => ""), warnings };
  }

  const api = { renderNote };
  globalThis.NoteRender = api;
  if (typeof module !== "undefined") module.exports = api;
})();
