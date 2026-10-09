// 노트 표현 슬롯 v2 — Note(JSON) → HTML 의 모든 표현(템플릿·문서 순서·고지 문구·CSS)이 여기 있다.
// 엔진(lib/note-render.js)은 이스케이프·{{F12}} 치환·display 규칙·경고만 담당하고 양식을 모른다.
// 계약 스키마는 lib/note-contract.js 에 있다 — 이 파일은 표현만 내보낸다(docs/note-contract.md §14·§15, .ref/ 의 v3 토큰).
(() => {
  const NoteContract = globalThis.NoteContract || (typeof require !== "undefined" ? require("./note-contract.js") : null);
  const NOTE_SPEC_VERSION = NoteContract.NOTE_SPEC_VERSION;
  // 마크업·CSS 가 바뀌면 올린다 — 디자인만 바뀐 재렌더는 H 단계만 다시 한다(§13).
  const RENDER_VERSION = "render-8";

  const arr = v => (Array.isArray(v) ? v : []);
  // 한 시간 미만 m:ss, 이상 h:mm:ss — 고지 구간 표기용(엔진의 h.time 과 같은 규칙).
  const fmt = t => {
    t = Math.max(0, Math.round(Number(t) || 0));
    const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
    return hh ? `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${mm}:${String(ss).padStart(2, "0")}`;
  };
  const pad2 = n => String(n).padStart(2, "0");
  const STAGE = { understand: "이해", relate: "관계", apply: "적용", check: "점검" };
  const QKIND = { recall: "기억", distinguish: "구분", apply: "적용", argue: "논증", calc: "계산", interpret: "해석", ox: "OX" };
  const QLEVEL = { basic: "기초", applied: "응용", advanced: "심화" };
  const CHECK = { recognition_uncertain: "인식 확인 필요", input_conflict: "자료 충돌", missing: "확인 필요", correction: "강의 중 정정" };
  // enum → 화면 라벨 (note-contract content 슬롯의 값).
  const REL3 = { includes: "포함", part_of: "부분", example_of: "예시", precedes: "먼저", contrasts: "대비", causes: "원인", supports: "근거", complements: "보완" };
  const ROLE7 = { premise: "전제", value_premise: "가치 전제", evidence: "근거", reason: "이유", claim: "주장", counter: "반례", condition: "조건", step: "단계", event: "사건", result: "결과" };
  const RELTYPE7 = { causal: "인과", argument: "논증", process: "과정", history: "연혁" };
  const KIND9 = { text: "글 자료", historical: "사료", philosophical: "철학 텍스트", literary: "문학 텍스트", data: "수치 자료", other: "자료" };
  const KIND10 = { formula: "수식", table: "표", graph: "그래프", calc: "계산" };
  const KIND12 = { term: "용어", background: "배경", original: "원어", link: "연결", hint: "힌트" };
  const REL13 = { common: "공통", contrast: "차이", inclusion: "포함", condition: "조건", complement: "보완", cause: "인과", sequence: "순서" };
  const OPSYM = { add: "+", sub: "−", mul: "×", div: "÷" };
  // dl.slots 한 줄과 계산 값 표기(천 단위 쉼표·digits 소수).
  const dd = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  const fmtN = (v, digits) => {
    let s = digits == null ? String(v) : Number(v).toFixed(digits);
    const neg = s.startsWith("-"); if (neg) s = s.slice(1);
    const [i, d] = s.split(".");
    return (neg ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (d ? "." + d : "");
  };
  // §4 id 를 노트가 실제로 만드는 앵커와 사람 라벨로 푼다 — 대상은 단원 S#, 블록 S#_B#·GB#, 개념 C#, Point S#_B#/P#.
  // 못 푸는 내부 id 는 절대 원문 그대로 보이지 않는다: 빼거나 앵커 없는 사람 라벨만 둔다(§15).
  const resolveRef = (note, id) => {
    if (typeof id !== "string" || !id) return null;
    const secs = arr(note && note.sections);
    const blocks = [...arr(note && note.global), ...secs.flatMap(s => arr(s && s.blocks))];
    const blockLabel = b => {
      const c = (b && b.content) || {}, t = NoteContract && NoteContract.TYPES[b && b.type];
      return [c.term, c.title, c.caseTitle, c.sourceTitle].find(x => typeof x === "string" && x) || (t && t.name) || null;
    };
    const pm = /^(.+)\/P([1-9]\d*)$/.exec(id); // Point 대상 S1_B1/P3 — 앵커는 해석 칩이 단 S1_B1-P3
    if (pm) {
      const b = blocks.find(x => x && x.id === pm[1]), n = +pm[2];
      return b && n >= 1 && n <= arr(b.content && b.content.points).length ? { href: `${b.id}-P${n}`, label: `Point ${n}` } : null;
    }
    const s = secs.find(x => x && x.sectionId === id);
    if (s) return { href: s.sectionId, label: `${pad2(s.number || 0)} ${s.title || ""}`.trim() };
    const b = blocks.find(x => x && x.id === id);
    if (b) return { href: b.id, label: blockLabel(b) || "관련 내용" };
    // 개념 id → 개념 색인의 이름. 앵커는 홈 블록, 없으면 그 개념을 정의한 B05 블록, 둘 다 없으면 이름만.
    const cn = arr(note && note.concepts).find(x => x && x.conceptId === id);
    const home = cn && cn.homeBlockId && blocks.find(x => x && x.id === cn.homeBlockId);
    const def = !home && blocks.find(x => x && x.content && x.content.conceptId === id);
    if (cn || def) {
      const label = (cn && cn.name) || (def && blockLabel(def)), anchor = home || def;
      return label ? { href: anchor ? anchor.id : null, label } : null;
    }
    return null;
  };
  const target = (h, id) => {
    const r = resolveRef(h.note, id);
    return !r ? "" : r.href ? `<a href="#${h.esc(r.href)}">${h.esc(r.label)}</a>` : `<span class="note-ref">${h.esc(r.label)}</span>`;
  };
  const links = (h, ids) => arr(ids).map(id => target(h, id)).filter(Boolean).join(" ");
  // 라벨은 정해져 있고 링크만 붙이는 자리(노드·항목 이름) — 풀리는 앵커가 없으면 글자만 둔다.
  const refLink = (h, id, text) => {
    const r = resolveRef(h.note, id);
    return r && r.href ? `<a href="#${h.esc(r.href)}">${h.esc(text)}</a>` : h.esc(text);
  };
  // Point 한 쌍 — 자료(채움 칩)와 해설(테두리 칩)이 같은 번호를 쓴다(§5). 앵커는 해설 줄에 단다(§15).
  const pointClue = (h, i, c) => `<p class="point-line"><span class="point point-clue">Point ${i + 1}</span>${h.claim(c, { tag: "span" })}</p>`;
  const pointRead = (h, b, i, c) => `<p class="point-line" id="${h.esc(b.id)}-P${i + 1}"><span class="point">Point ${i + 1}</span>${h.claim(c, { tag: "span" })}</p>`;

  // ── mis-sol-hai 표시 규칙(기획 §4.6·§5): 렌더러가 근거·신호 데이터로 표시를 계산한다 — 모델 텍스트에
  // 마크업을 허용하지 않는다(이스케이프는 그대로). 새 데이터(근거 메타 사이드카·필기 근거·인용/반복 강조)가
  // 전혀 없는 노트는 표시가 하나도 켜지지 않아 기존 렌더와 같다(보관 형식 호환).
  const PEN = '<svg class="mk-pen" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5 3.2 10.4 10.8 2.8 13.2 5.2 5.6 12.8Z M9.4 4.2 11.8 6.6"/></svg>';
  const MIC = '<svg class="mk-mic" viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="8" rx="2.5"/><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2"/></svg>';

  // 렌더 한 번의 표시 상태 — 문서 전체 용어 첫 등장과 단원별 상한을 여기서 센다. h 는 renderNote 마다 새로 생긴다.
  // 표시는 근거 메타 사이드카가 있는 노트에만 켠다(evidenceMeta — NOTE_SCHEMA_VERSION 과 같은 수명의 필드).
  const sess = h => {
    if (h.__mk) return h.__mk;
    const n = h.note || {};
    const meta = n.evidenceMeta && typeof n.evidenceMeta === "object" ? n.evidenceMeta : null;
    const srcById = new Map(arr(n.sources).map(x => [x && x.id, x]));
    return (h.__mk = {
      meta, srcById, seen: new Set(), caps: new Map(), on: !!meta,
      terms: arr(n.concepts).filter(c => c && c.depth === "defined" && typeof c.name === "string").map(c => c.name),
    });
  };

  // note-claim 요소 하나씩 안쪽을 fn 으로 바꾼다 — claim 안의 note-label 같은 같은 태그 중첩은 깊이로 센다.
  const eachClaim = (html, fn) => {
    let out = "", i = 0;
    const OPEN = /<(span|p) class="note-claim"([^>]*)>/g;
    for (;;) {
      OPEN.lastIndex = i;
      const m = OPEN.exec(html);
      if (!m) break;
      const tag = m[1], attrs = m[2], start = m.index + m[0].length;
      const TAG = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
      TAG.lastIndex = start;
      let depth = 1, t = null;
      while ((t = TAG.exec(html))) { depth += t[1] ? -1 : 1; if (depth === 0) break; }
      if (!t) break;
      const inner = html.slice(start, t.index), repl = fn(attrs, inner);
      out += html.slice(i, m.index) + `<${tag} class="note-claim"${attrs}>` + (repl ?? inner) + `</${tag}>`;
      i = t.index + t[0].length;
    }
    return out + html.slice(i);
  };
  const evOf = attrs => { const m = /data-ev="([^"]*)"/.exec(attrs); return m ? m[1].split(" ") : []; };

  // 블록 렌더 결과에 표시를 얹는다 — 템플릿을 감싸는 래퍼다(시안 build.cjs 래퍼를 양식으로 옮긴 것).
  // 상한은 규칙 문장이 아니라 여기서 코드로 강제한다. 굵은 표시는 주장당 하나: 1B 강조 > 핵심 용어.
  const decorate = (type, b, h, html) => {
    const s = sess(h);
    if (!s.on || !html) return html;
    const em = arr(b && b.emphasis);
    const stress = em.filter(e => e && e.kind === "stress");
    const stressIds = new Set(stress.flatMap(e => arr(e && e.evidenceIds)));
    const secKey = typeof (b && b.sectionId) === "string" ? b.sectionId : "";
    if (!s.caps.has(secKey)) s.caps.set(secKey, { exam: 0, rep: 0, cond: 0, quote: 0 });
    const caps = s.caps.get(secKey);
    const metaOf = id => (s.meta && s.meta[String(id).split(".")[0]]) || null;
    const kindOf = id => (s.srcById.get(id) || {}).kind;
    const isInk = id => kindOf(id) === "handwriting" || !!(metaOf(id) || {}).ink;
    const min = h.opts && typeof h.opts.emphasisMin === "number" ? h.opts.emphasisMin : null;
    const isHot = id => stressIds.has(id)
      || (min != null && typeof (metaOf(id) || {}).emphasis === "number" && metaOf(id).emphasis >= min);

    // 주장 단위: 조건·예외 칩(X4), 필기 점선(2B), 강조(1B) — 1B 가 붙으면 용어 굵게(X3)는 끈다.
    html = eachClaim(html, (attrs, inner) => {
      const ids = evOf(attrs), hot = ids.some(isHot), ink = ids.some(isInk);
      let pre = "", body = inner;
      const m = /^(단[,\s]|다만|예외)/.exec(inner);
      if (m && caps.cond < 3) { caps.cond++; pre = `<span class="mk-cond">${m[1].startsWith("예외") ? "예외" : "조건"}</span> `; }
      if (!hot && !inner.includes("<")) {
        for (const n of s.terms) {
          const t = h.esc(n);
          if (!s.seen.has(n) && body.includes(t)) {
            s.seen.add(n);
            body = body.replace(t, () => `<strong class="mk-term">${t}</strong>`);
          }
        }
      }
      if (ink) body = `<span class="mk-2B">${PEN}${body}</span>`;
      if (hot) body = `<strong class="mk-1B">${body}</strong>`;
      return pre + body;
    });

    // 교수 강조 인용(X7): stress 의 발화 원문 한 줄 — 단원당 1개.
    // 치환은 전부 함수형 — 치환 문자열의 $&·$` 같은 패턴이 매치로 확장되지 않게 한다.
    const q = (stress.find(e => e && typeof e.quote === "string" && e.quote) || {}).quote;
    if (q && caps.quote < 1) {
      caps.quote++;
      html = html.includes("</h3>")
        ? html.replace("</h3>", () => `</h3><p class="mk-quote">“${h.esc(q)}”</p>`)
        : `<p class="mk-quote">“${h.esc(q)}”</p>` + html;
    }
    // 시험 배지(X1)·반복 ×N(X2): 블록당 1개씩, 단원당 2개 이하.
    const tags = [];
    if (em.some(e => e && e.kind === "exam") && caps.exam < 2) { caps.exam++; tags.push('<span class="mk-exam">시험</span>'); }
    const rep = Math.max(0, ...stress.map(e => (typeof e.repeat === "number" ? e.repeat
      : arr(e.evidenceIds).filter(id => kindOf(id) === "speech").length)));
    if (rep >= 2 && caps.rep < 2) { caps.rep++; tags.push(`<span class="mk-rep">×${rep}</span>`); }
    if (tags.length) {
      const t = `<span class="mk-tags">${tags.join("")}</span>`;
      html = html.includes("<h3>") ? html.replace("<h3>", () => t + "<h3>") : t + html;
    }
    // 대비 쌍(X6): 비교 대상이 정확히 둘일 때 표 위에 한 줄.
    if (type === "B06" && arr(b && b.content && b.content.entities).length === 2) {
      const [e0, e1] = b.content.entities;
      html = html.replace("<table", () => `<p class="mk-pair"><span class="mk-chip-e">${h.esc(e0.label)}</span><span class="mk-vs">↔</span><span class="mk-chip-e">${h.esc(e1.label)}</span></p><table`);
    }
    return html;
  };

  // B01 강의 머리 — meta·status 에서 투영(코드 블록).
  const B01 = (b, h) => {
    const m = (h.note && h.note.meta) || {};
    const bits = [m.course, m.session, m.lectureDate].filter(x => typeof x === "string" && x).map(x => `<span>${h.esc(x)}</span>`);
    if (m.processed) bits.push(`<span>담은 구간 ${h.esc(h.time(m.processed.t0, m.processed.t1))}</span>`);
    const gen = typeof m.generatedAt === "string" && m.generatedAt.slice(0, 10);
    if (gen) bits.push(`<span>작성 ${h.esc(gen)}</span>`);
    if (h.note && h.note.status === "partial") bits.push(`<span class="note-badge">일부 누락</span>`);
    return `<header class="note-head"><div class="kicker">LECTURE NOTE</div>`
      + `<h1>${h.esc(m.title || "강의 노트")}</h1><div class="note-meta">${bits.join("")}</div></header>`;
  };

  // B04 단원 헤더 — 번호·근거 구간은 코드, 제목·질문·단계는 계획, 요지는 섹션 출력에서 투영.
  const B04 = (b, h) => {
    const s = b.sec || {}, r = s.range;
    return `<header class="unit-head">${STAGE[s.stage] ? `<span class="role">${STAGE[s.stage]}</span>` : ""}`
      + `<h2><span class="unit-no">${pad2(s.number || 0)}</span>${h.esc(s.title || "")}</h2>`
      + (s.question ? `<p class="unit-q">${h.esc(s.question)}</p>` : "")
      + (s.gist ? h.claim(s.gist) : "")
      + (r ? `<small class="unit-range">${h.esc(h.time(r.t0, r.t1))}</small>` : "")
      + `</header>`;
  };

  // B15 정답과 해설 한 건 — B14 항목의 answer 에서 투영. 접기·앵커는 layout 의 매체 규칙이 감싼다(§15).
  const B15 = ({ n, item }, h) => {
    const a = (item && item.answer) || {};
    let s = `<p class="answer-head"><strong>${h.esc(n)}번</strong>`
      + (a.verdict ? ` 정답 <strong class="verdict">${h.esc(a.verdict)}</strong>` : "") + "</p>"
      + h.claim(a.explanation);
    if (a.correction) s += `<p class="answer-fix"><strong>바른 문장</strong> ${h.claim(a.correction, { tag: "span" })}</p>`;
    if (arr(a.rubric).length) s += `<div class="answer-rubric"><strong>좋은 답의 조건</strong><ul>${arr(a.rubric).map(c => `<li>${h.claim(c, { tag: "span" })}</li>`).join("")}</ul></div>`;
    if (arr(a.alternatives).length) s += `<div class="answer-alt"><strong>이렇게도 답할 수 있다</strong><ul>${arr(a.alternatives).map(t => `<li>${h.esc(t)}</li>`).join("")}</ul></div>`;
    const rev = links(h, a.reviewIds);
    if (rev) s += `<p class="answer-rev"><strong>복습 위치</strong> ${rev}</p>`;
    return s;
  };

  // B16 필기 공간 — 렌더 옵션(writing)일 때만. 고정 라벨 세 칸이며 사실은 채우지 않는다(§9).
  const B16 = () => `<div class="memo"><h4>내 말로 정리하기</h4>`
    + ["내 말로 설명", "질문", "추가 사례"].map(l => `<div class="memo-row"><span class="memo-label">${l}</span><div class="memo-grid" aria-hidden="true"></div></div>`).join("")
    + `</div>`;

  // B17 확인 필요·정정 — check 는 단원 끝 상자, sys 는 문서 끝 처리 고지 상자. 조판 힌트(NOTE_ADVISORY_*)는 싣지 않는다(§12.3·§15).
  const B17 = (b, h) => {
    if (b.sys) {
      const lines = arr(h.note && h.note.notices)
        .map(x => (x && x.code && !String(x.code).startsWith("NOTE_ADVISORY_") && !HIDDEN.has(x.code)) ? h.notice(x) : "").filter(Boolean);
      return lines.length ? `<aside class="note-check note-sys"><h4>처리 참고</h4><ul>${lines.map(t => `<li>${t}</li>`).join("")}</ul></aside>` : "";
    }
    const c = b.check || {}, corr = c.kind === "correction";
    if (!corr) return ""; // [인식 확인 필요]·[자료 충돌]·[확인 필요] 상자는 띄우지 않는다(사용자 결정) — 노트 데이터에는 남는다. 강의 중 정정은 강의 내용이라 둔다.
    const line = (label, cl) => (cl ? `<p><strong>${label}</strong> ${h.claim(cl, { tag: "span" })}</p>` : "");
    return `<aside class="note-check" data-kind="${h.esc(c.kind || "")}"><h4>[${CHECK[c.kind] || "확인 필요"}]</h4>`
      + h.claim(c.claim) + line(corr ? "정정 전" : "이전 값", c.before) + line(corr ? "정정 후" : "새 값", c.after)
      + line("보류", c.hold) + `</aside>`;
  };

  // ── 모델이 쓰는 블록 양식(.ref/templates.html 마크업, note-contract content.B02..B18 슬롯).
  // 빈 선택 슬롯은 자리째 생략한다(§5). 모델 문자열은 전부 h.esc/h.rich/h.claim 을 지난다.

  // B02 한눈에 — 질문 아래 결론(conclusions)·열린 질문(issues) 최대 3건, 항목 끝에 대상 링크.
  const B02 = (b, h) => {
    const c = (b && b.content) || {};
    const items = arr(c.items).map(it => `<div class="take"><p class="take-claim"><strong>${h.claim(it && it.claim, { tag: "span" })}</strong></p>`
      + (it && it.reason ? h.claim(it.reason) : "")
      + (links(h, it && it.targetIds) ? `<p class="goto">${links(h, it && it.targetIds)}</p>` : "") + "</div>").join("");
    return `<section class="conclusion"><div class="kicker">${c.mode === "issues" ? "열린 질문" : "이 강의의 질문"}</div>`
      + (c.question ? `<h3>${h.claim(c.question, { tag: "span" })}</h3>` : "") + items + "</section>";
  };

  // B03 강의 지도 — 노드 칩 아래에 방향 관계 행(출발 →관계→ 도착)을 나열한다. 같은 행은 한 번만 싣고,
  // 끝점을 모르는 관계는 라벨을 지어낼 수 없으므로 뺀다(§9). 화살표가 없는 노드를 뿌리로 표시한다.
  const B03 = (b, h) => {
    const c = (b && b.content) || {}, nodes = arr(c.nodes);
    const byKey = new Map(nodes.filter(n => n && typeof n.key === "string").map(n => [n.key, n]));
    const inbound = new Set(arr(c.edges).map(e => e && e.to));
    const name = n => (n && n.targetId ? refLink(h, n.targetId, n.label) : h.esc(n && n.label));
    const seen = new Set(), rows = [];
    for (const e of arr(c.edges)) {
      const a = byKey.get(e && e.from), t = byKey.get(e && e.to);
      if (!a || !t) continue;
      const k = `${e.from}|${e.to}|${e.relation}|${(e.claim && e.claim.text) || ""}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push(`<li class="map-edge"><span class="edge-src">${name(a)}</span><span class="edge-rel">${h.esc(REL3[e.relation] || e.relation || "관계")}</span><span class="edge-dst">${name(t)}</span>${e.claim ? `<small class="edge-claim">${h.claim(e.claim, { tag: "span" })}</small>` : ""}</li>`);
    }
    return `<section><span class="role">구조</span><h3>${h.esc(c.title || "")}</h3><div class="map"><p class="map-nodes">${
      nodes.map(n => `<span class="map-node${n && !inbound.has(n.key) ? " map-root" : ""}">${name(n)}</span>`).join("")
    }</p>${rows.length ? `<ul class="map-flow">${rows.join("")}</ul>` : ""}</div></section>`;
  };

  // B05 개념 설명 — term(+원어) 머리, 완결된 정의, 그다음 슬롯 내용이 순서대로 문단으로 이어진다.
  // 슬롯 라벨(쉬운 풀이·작동 원리·범위·예시)은 생성 때 내부 구조로만 쓰고 화면·PDF 에는 표시하지 않는다(기획 §5-6).
  const B05 = (b, h) => {
    const c = (b && b.content) || {};
    const slots = [c.explanation, c.mechanism, ...arr(c.scope), ...arr(c.examples)]
      .filter(Boolean).map(x => h.claim(x)).join("");
    return `<section class="concept"><div class="heading-bundle"><h3>${h.esc(c.term || "")}${c.original ? ` <small>${h.esc(c.original)}</small>` : ""}</h3>`
      + `<p class="definition">${h.claim(c.definition, { tag: "span" })}</p></div>` + slots + "</section>";
  };

  // B06 공통 축 비교 — 기준×대상 표. 비어 있는 칸은 "확인되지 않음"으로 두고 채우지 않는다(§9). td 의 data-label 은 좁은 화면 카드용.
  const B06 = (b, h) => {
    const c = (b && b.content) || {}, ents = arr(c.entities);
    const rows = arr(c.criteria).map(r => `<tr><th scope="row">${h.esc(r && r.label)}</th>`
      + ents.map((e, j) => { const x = arr(r && r.cells)[j]; return `<td data-label="${h.esc(e && e.label)}">${x ? h.claim(x, { tag: "span" }) : `<span class="empty">확인되지 않음</span>`}</td>`; }).join("")
      + "</tr>").join("");
    return `<section><span class="role">비교</span><h3>${h.esc(c.title || "")}</h3>`
      + `<table class="note-table"><thead><tr><th scope="col">기준</th>${ents.map(e => `<th scope="col">${h.esc(e && e.label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`
      + (arr(c.common).length ? `<div class="common">${arr(c.common).map(x => h.claim(x, { tag: "span" })).join(" · ")}</div>` : "")
      + (c.discriminator ? `<div class="common">${h.claim(c.discriminator, { tag: "span" })}</div>` : "")
      + "</section>";
  };

  // B07 논리 연결 — 전제→결과 사슬. 생략된 추론은 missingLinks 에서 "연결 설명 확인 필요"로 달아 둔다(§9).
  // 인과(causal)는 새 표시 데이터가 있는 노트에서 짧으면 한 줄 흐름으로 낸다(시안 X5) — 4단계 초과면 기존 사슬.
  const B07 = (b, h) => {
    const c = (b && b.content) || {}, steps = arr(c.steps), missing = arr(c.missingLinks);
    const roleOf = s => h.esc(ROLE7[s && s.role] || (s && s.role) || "단계");
    const miss = missing.map(m => `<li class="relation">↓ 연결 설명 없음 · ${h.claim(m, { tag: "span" })}</li>`).join("");
    // 제목 묶음은 첫 문단(단원 질문)까지 품어야 인쇄에서 제목만 페이지 끝에 남지 않는다.
    const head = `<section><div class="heading-bundle"><span class="role">${h.esc(RELTYPE7[c.relationType] || "논증")}</span><h3>${h.esc(c.title || "")}</h3>`
      + (c.question ? `<p class="unit-q">${h.claim(c.question, { tag: "span" })}</p>` : "") + `</div>`;
    if (sess(h).on && c.relationType === "causal" && steps.length <= 4) {
      const flow = steps.map(s => `<span class="mk-step"><small>${roleOf(s)}</small> ${h.claim(s && s.claim, { tag: "span" })}</span>`)
        .join('<span class="mk-arrow">→</span>');
      return head + `<p class="mk-flow">${flow}</p>` + (miss ? `<ul class="chain">${miss}</ul>` : "") + "</section>";
    }
    const li = steps.map((s, i) => `<li><strong>${pad2(i + 1)} ${roleOf(s)}</strong> ${h.claim(s && s.claim, { tag: "span" })}</li>`);
    for (const m of missing) li.push(`<li class="relation">↓ 연결 설명 없음 · ${h.claim(m, { tag: "span" })}</li>`);
    return head + `<ol class="chain">${li.join("")}</ol></section>`;
  };

  // B08 사례와 적용 — 사례(흰 면)와 해석(회색 면)을 Point 번호로 짝짓는다. 판단의 pointRefs 는 그 앵커로 링크.
  // 슬롯 라벨(판단·범위·의사결정 칸)은 내부 구조로만 쓰고 화면·PDF 에는 표시하지 않는다 — 내용은 문단으로 이어진다(§5-6).
  const B08 = (b, h) => {
    const c = (b && b.content) || {}, pts = arr(c.points), j = c.judgment, dec = c.decision;
    const decl = dec ? [dec.actor, dec.goal, ...arr(dec.alternatives), ...arr(dec.criteria), ...arr(dec.tradeoffs), ...arr(dec.missingData)]
      .filter(Boolean).map(x => h.claim(x)).join("") : "";
    return `<section><div class="heading-bundle"><span class="role apply">적용</span><h3>${h.esc(c.caseTitle || "")}</h3></div>`
      + `<div class="case-box"><h4>${c.source === "material_case" ? "자료 속 사례" : "강의 사례"}</h4>${h.claim(c.situation)}`
      + pts.map((p, i) => pointClue(h, i, p && p.clue)).join("") + "</div>"
      + `<div class="analysis-box"><h4>단서로 본 해석</h4>` + pts.map((p, i) => pointRead(h, b, i, p && p.reading)).join("")
      + (j ? `<p>${h.claim(j.claim, { tag: "span" })} ${arr(j.pointRefs).map(r =>
        Number.isInteger(r) && r >= 1 && r <= pts.length
          ? `<a href="#${h.esc(b.id)}-P${r}">Point ${r}</a>`
          : `<span class="point">Point ${h.esc(r)}</span>`).join(" ")}</p>` : "")
      + arr(c.limits).map(x => h.claim(x)).join("")
      + "</div>" + (decl ? `<div class="common">${decl}</div>` : "") + "</section>";
  };

  // B09 자료 읽기 — 자료(흰 면)와 해석(회색 면)을 나누고, 저자 주장과 강의의 해석은 다른 칸에 둔다(§9).
  // 슬롯 라벨(자료 요지·저자의 주장·강의의 해석·확인할 것)은 숨기되, 저자 주장/강의 해석은 왼쪽 선으로
  // 시각적 구분이 남게 한다 — 라벨을 빼면 어느 칸인지 모르기 때문이다(§5-6).
  const B09 = (b, h) => {
    const c = (b && b.content) || {}, pts = arr(c.points), q = c.quote;
    return `<section class="material-block"><span class="role material">자료 읽기</span><div class="material-inner">`
      + `<div class="heading-bundle"><h3>${h.esc(c.sourceTitle || "")}</h3><p class="source">${h.esc(KIND9[c.sourceKind] || "자료")}</p></div>`
      + (q && typeof q.text === "string" && q.text ? `<blockquote class="quote">${h.esc(q.text)}</blockquote>` : "")
      + `<p>${h.claim(c.gist, { tag: "span" })}</p>`
      + pts.map((p, i) => pointClue(h, i, p && p.clue)).join("")
      + `<div class="interpretation"><h4>해석</h4>` + pts.map((p, i) => pointRead(h, b, i, p && p.reading)).join("")
      + (c.authorClaim ? `<p>${h.claim(c.authorClaim, { tag: "span" })}</p>` : "")
      + (c.lecturerReading ? `<p class="read-lecturer">${h.claim(c.lecturerReading, { tag: "span" })}</p>` : "")
      + arr(c.limits).map(x => h.claim(x)).join("")
      + "</div></div></section>";
  };

  // B10 수식·표·그래프 — 식은 독립 행(formulaIds·derived), 계산은 i#/c# 값으로 푼 단계(§7·§9).
  const B10 = (b, h) => {
    const c = (b && b.content) || {}, vals = {};
    arr(c.inputs).forEach((x, i) => { vals["i" + (i + 1)] = x; });
    arr(c.steps).forEach((x, i) => { vals["c" + (i + 1)] = x; });
    const ref = k => { const v = vals[k]; return v ? fmtN(v.value, v && v.digits) + h.esc(v.unit || "") : h.esc(k); };
    const vars = arr(c.variables).map(v => dd(h.esc(v && v.symbol), h.claim(v && v.meaning, { tag: "span" }) + (v && v.unit ? ` <small>(${h.esc(v.unit)})</small>` : ""))).join("");
    const eqPart = arr(c.formulaIds).map(id => h.equation(id)).join("")
      + arr(c.derived).map(t => `<div class="equation">${h.math(t, { display: true })}</div>`).join("");
    const eqBundle = (eqPart || vars) ? `<div class="eq-bundle">${eqPart}${vars ? `<dl class="slots">${vars}</dl>` : ""}</div>` : "";
    // 제목 묶음은 첫 문단(가정·목표)까지 품는다 — 식+변수 설명은 eq-bundle 이 따로 묶는다.
    return `<section><div class="heading-bundle"><span class="role">${h.esc(KIND10[c.kind] || "자료")}</span><h3>${h.esc(c.title || "")}</h3>`
      + (arr(c.assumptions).length ? `<p class="source">${arr(c.assumptions).map(x => h.claim(x, { tag: "span" })).join(" · ")}</p>` : "")
      + h.claim(c.goal) + "</div>"
      + eqBundle
      + (arr(c.inputs).length ? `<table class="note-table"><thead><tr><th scope="col">항목</th><th scope="col">값</th></tr></thead><tbody>`
        + arr(c.inputs).map(x => `<tr><th scope="row">${h.esc(x && x.label)}</th><td data-label="값">${fmtN(x && x.value)}${h.esc((x && x.unit) || "")}</td></tr>`).join("") + "</tbody></table>" : "")
      + arr(c.steps).map(s => `<p>${h.esc(s && s.label)} = ${ref(s && s.a)} ${OPSYM[s && s.op] || h.esc(s && s.op)} ${ref(s && s.b)} = <strong>${fmtN(s && s.value, s && s.digits)}${h.esc((s && s.unit) || "")}</strong></p>`).join("")
      + arr(c.reading).map(x => h.claim(x)).join("")
      + (c.result ? `<div class="common"><strong>결과</strong> · ${h.claim(c.result, { tag: "span" })}</div>` : "")
      + (arr(c.limits).length ? `<p><strong>한계</strong> · ${arr(c.limits).map(x => h.claim(x, { tag: "span" })).join(" · ")}</p>` : "")
      + (c.withheld ? `<p class="source"><strong>보류</strong> · ${h.claim(c.withheld, { tag: "span" })}</p>` : "")
      + "</section>";
  };

  // B11 헷갈리기 쉬운 점 — 오해·구분·조건. structural_check 는 "구분 점검"으로 표시한다(§9).
  const B11 = (b, h) => {
    const c = (b && b.content) || {};
    return `<aside class="warning"><h4>${c.origin === "structural_check" ? "[구분 점검]" : "[주의]"} 헷갈리기 쉬운 점</h4>`
      + `<p><strong>오해:</strong> ${h.claim(c.misconception, { tag: "span" })}</p>`
      + `<p><strong>구분:</strong> ${h.claim(c.correction, { tag: "span" })}</p>`
      + arr(c.conditions).map(x => `<p><strong>조건:</strong> ${h.claim(x, { tag: "span" })}</p>`).join("") + "</aside>";
  };

  // B12 곁설명 — 앞 블록 옆에 붙는 한 단락 보충(종류 라벨 + note). 띄우는 건 layout 의 with-aside.
  const B12 = (b, h) => {
    const c = (b && b.content) || {};
    // "슬라이드에 없는 설명"(slide_absent): 발화 근거뿐인 내용 — 연한 배경+마이크 아이콘(시안 3B, 흑백은 굵은 왼쪽 테두리).
    if (c.kind === "slide_absent")
      return `<aside class="aside-note mk-3B"><strong>${MIC}슬라이드에 없는 설명</strong>${h.claim(c.note)}</aside>`;
    return `<aside class="aside-note"><strong>곁설명 · ${h.esc(KIND12[c.kind] || "보충")}</strong>${h.claim(c.note)}</aside>`;
  };

  // B13 연결 정리 — 관계 라벨 + 명제 + 대상 링크.
  const B13 = (b, h) => {
    const c = (b && b.content) || {};
    const items = arr(c.propositions).map(p => `<li><strong>${h.esc(REL13[p && p.relation] || (p && p.relation) || "")}:</strong> ${h.claim(p && p.claim, { tag: "span" })}`
      + (links(h, p && p.targetIds) ? ` <small class="goto">${links(h, p && p.targetIds)}</small>` : "") + "</li>").join("");
    return `<section class="synthesis"><h3>${h.esc(c.title || "연결 정리")}</h3><ol>${items}</ol></section>`;
  };

  // B18 수업 공지 — 내용·기한(주제 라벨은 내부 구조로만, §5-6). due 는 인용 근거 문구를 그대로 싣는다(절대 날짜 추정 없음).
  const B18 = (b, h) => `<section class="notice"><span class="role">공지</span><h3>수업 공지</h3>`
    + arr(b && b.content && b.content.items).map(x =>
      `<p>${h.claim(x && x.claim, { tag: "span" })}${x && x.due ? ` <small>· ${h.esc(x.due)}</small>` : ""}</p>`).join("")
    + "</section>";

  // 모든 블록 렌더는 decorate 를 지난다 — 새 표시 데이터가 없으면 그대로 통과시켜 기존 렌더와 같다.
  const templates = Object.fromEntries(Object.entries({
    B01, B02, B03, B04,
    B05, B06, B07, B08, B09, B10,
    B11, B12, B13,
    // B14 의 문항 마크업은 layout 의 question 과 하나다 — h.block 으로 직접 불릴 때도 같은 양식을 쓴다.
    B14: (b, h) => arr(b && b.content && b.content.items).map((item, i) => question({ item, n: pad2(h.qno(b.id, i) ?? i + 1) }, h)).join(""),
    B15, B16, B17, B18,
  }).map(([t, fn]) => [t, (b, h) => decorate(t, b, h, fn(b, h))]));

  // B14 문항을 블록(단원)별로 묶되 번호는 문서 전체에서 이어진다(§15). h.qno(blockId, index) 가 1 기반 번호를 준다.
  const qgroups = (note, h) => {
    const out = []; let total = 0;
    for (const s of arr(note.sections)) for (const b of arr(s && s.blocks))
      if (b && b.type === "B14")
        out.push({ s, b, qs: arr(b.content && b.content.items).map((item, i) => ({ item, n: pad2(h.qno(b.id, i) ?? ++total) })) });
    return out;
  };

  // 답 쓰는 칸은 서술 작업이 필요한 유형 + writing 옵션일 때만 둔다 — OX 는 작은 응답 표식으로 충분하다(§15).
  const WRITE_KIND = new Set(["calc", "argue", "interpret", "apply"]);
  // 문항 한 칸: 번호 + 유형 + 본문 + 응답 표식/답란 + (매체에 따라) 접힌 해설/끝 파트 링크.
  const question = ({ item, n }, h) => {
    // OX 해설은 짧다 — 카드째로 묶는 표식(answer-compact)을 달아 인쇄에서 나뉘지 않게 한다. 긴 서술 답은 의미 단위로 나뉜다.
    const ac = item && item.kind === "ox" ? " answer-compact" : "";
    const isInline = h.opts.medium === "web" || h.opts.answers === "inline";
    const answer = h.opts.medium === "web"
      ? `<details class="answer${ac}"><summary>${n}번 해설 보기</summary><div class="answer-body">${templates.B15({ n, item }, h)}</div></details>`
      : h.opts.answers === "inline"
        ? `<div class="answer${ac}">${templates.B15({ n, item }, h)}</div>`
        : `<p class="answer-link"><a href="#a-${n}">정답과 해설</a></p>`;
    const respond = item && item.kind === "ox"
      ? `<p class="ox-mark">O ☐&ensp;X ☐</p>`
      : (h.opts.writing && WRITE_KIND.has(item && item.kind) ? `<div class="answer-space" aria-hidden="true"></div>` : "");
    const clue = respond + (!isInline ? answer : "");
    const trailingAnswer = isInline ? answer : "";
    return `<div class="question" id="q-${n}"><span class="qno">${n}</span><div class="qbody">`
      + `<div class="qa-bundle"><strong>${h.esc(QKIND[item.kind] || item.kind || "문항")}</strong>${item.level ? ` <small class="qlevel">${h.esc(QLEVEL[item.level] || item.level)}</small>` : ""}<p>${h.claim(item.prompt, { tag: "span" })}</p>`
      + (item.premise ? `<p class="premise">${h.claim(item.premise, { tag: "span" })}</p>` : "")
      + clue + `</div>`
      + trailingAnswer + `</div></div>`;
  };

  // §15 문서 순서: B01 → B18 공지 → 전역 블록(B02·B03) → 단원(B04 → 블록[B12는 앞 블록 옆, figureIds는 그 블록 뒤] → B17 확인)
  // → 전역 B13 → 자기 점검(문서 번호) → 정답과 해설(print+end, exam 이면 쪽 넘김) → 시스템 B17 → (writing)B16.
  const layout = (note, h) => {
    const secs = arr(note.sections);
    const b18 = []; // B18 은 작성 위치(단원)와 무관하게 문서 머리 뒤로 모은다(§9).
    for (const s of secs) for (const b of arr(s && s.blocks)) if (b && b.type === "B18") b18.push(b);
    // §14: 어느 블록의 figureIds 도 가리키지 않은 도표는 t0 가 드는 단원의 블록 뒤(그 단원 B17 앞)에, 어디에도 안 들면 마지막 단원 뒤에 놓는다. 한 도표는 한 번만.
    const cited = new Set(secs.flatMap(s => arr(s && s.blocks).flatMap(b => arr(b && b.content && b.content.figureIds))));
    const orphan = new Map(), stray = [];
    for (const f of arr(note.figures)) {
      if (!f || cited.has(f.id)) continue;
      const i = secs.findIndex(s => s && s.range && f.t0 >= s.range.t0 && f.t0 < s.range.t1);
      if (i < 0) stray.push(f.id);
      else { const l = orphan.get(i) || []; l.push(f.id); orphan.set(i, l); }
    }
    const pieces = [B01(null, h)];
    for (const b of b18) pieces.push(h.block(b));
    for (const g of arr(note.global)) if (g && g.type !== "B13") pieces.push(h.block(g));
    secs.forEach((s, si) => {
      const body = [];
      let last = -1; // body 안 마지막 "블록"의 자리 — B12 곁설명은 그 블록만 묶고 뒤따른 도표는 밖에 둔다
      for (const b of arr(s && s.blocks)) {
        if (!b || b.type === "B14" || b.type === "B18") continue;
        const blk = h.block(b);
        if (b.type === "B12" && last >= 0) {
          const prev = body[last];
          body[last] = prev.startsWith('<div class="with-aside">')
            ? prev.slice(0, -"</div></div>".length) + blk + "</div></div>" // 이어지는 곁설명은 중첩하지 않고 같은 aside 단에 쌓는다
            : `<div class="with-aside">${prev}<div class="aside-col">${blk}</div></div>`;
        } else { last = body.length; body.push(blk); }
        body.push(...arr(b.content && b.content.figureIds).map(g => h.figure(g)));
      }
      for (const g of orphan.get(si) || []) body.push(h.figure(g));
      for (const c of arr(s.checks)) body.push(templates.B17({ check: c }, h));
      pieces.push(`<section class="note-sec" id="${h.esc(s.sectionId)}">${B04({ sec: s }, h)}${body.join("")}</section>`);
    });
    for (const g of stray) pieces.push(h.figure(g));
    for (const g of arr(note.global)) if (g && g.type === "B13") pieces.push(h.block(g));
    const groups = qgroups(note, h), qs = groups.flatMap(g => g.qs);
    if (qs.length) {
      pieces.push(`<section class="note-checklist"><h2 class="part-title">자기 점검</h2>`
        + groups.map(g => `<section class="note-block" id="${h.esc(g.b.id)}" data-type="B14">`
          + `<small class="qsec">${h.esc(g.s.title || "")}</small>` + g.qs.map(q => question(q, h)).join("") + "</section>").join("")
        + "</section>");
      if (h.opts.medium === "print" && h.opts.answers === "end")
        pieces.push(`<section class="note-answers${h.opts.exam ? " page-break" : ""}"><h2 class="part-title">정답과 해설</h2>`
          + qs.map(({ item, n }) => `<div class="answer${item && item.kind === "ox" ? " answer-compact" : ""}" id="a-${n}"><a class="backlink" href="#q-${n}">문항 ${n}으로</a>${templates.B15({ n, item }, h)}</div>`).join("") + "</section>");
    }
    const sys = templates.B17({ sys: true }, h);
    if (sys) pieces.push(sys);
    if (h.opts.writing) pieces.push(B16(null, h));
    return `<article class="note">${pieces.join("")}</article>`;
  };

  // 화면·PDF 에 띄우지 않는 고지(사용자 결정): 원본 이미지로 보인 수식 수와 검증에서 뺀 내용 건수는 알리지 않는다. 노트 데이터에는 남는다.
  const HIDDEN = new Set(["NOTE_FORMULAS_IMAGE", "NOTE_BLOCKS_DROPPED"]);

  // §12.3 고지 문구 — 일반 텍스트를 돌려준다(이스케이프는 h.notice 가 한다). ids 는 절대 문구에 쓰지 않는다.
  const TEXT = {
    NOTE_CAPTURE_GAP: c => `인식하지 못한 구간 ${c}곳`,
    NOTE_SECTIONS_FAILED: c => `요약하지 못한 단원 ${c}개`,
    NOTE_BLOCKS_DROPPED: c => `확인하지 못해 뺀 내용 ${c}건`,
    NOTE_UNITS_UNCITED: c => `노트에 들지 않은 강의 구간 ${c}곳`,
    NOTE_GLOBAL_FAILED: () => "강의 전체 요약을 만들지 못했습니다",
    NOTE_JUDGE_SKIPPED: () => "중요도를 가리지 않고 만들었습니다",
    NOTE_CLAIMS_UNSUPPORTED: c => `강의 근거가 부족해 보류한 내용 ${c}건`,
    NOTE_ITEMS_PRUNED: c => `연결된 내용이 빠져 함께 뺀 항목 ${c}건`,
    NOTE_FORMULAS_CHECK: c => `확인이 필요한 수식 ${c}개`,
    NOTE_FORMULAS_UNVERIFIED: c => `확인이 필요한 수식 ${c}개`,
    NOTE_FIGURES_CHECK: c => `확인이 필요한 도표 ${c}개`,
    NOTE_FIGURES_NOT_DETECTED: () => "도표는 찾지 않았습니다(Free)",
    NOTE_AUGMENTED: () => "가상 사례·강의 밖 보강이 포함된 노트입니다",
  };
  const notice = n => {
    const code = String(n && n.code || ""), c = n && n.count != null ? n.count : 1;
    let t = TEXT[code] ? TEXT[code](c) : `기타 참고: ${code}×${c}`;
    const rs = arr(n && n.ranges);
    if (rs.length) t += ` (${rs.slice(0, 3).map(r => `${fmt(r.t0)}–${fmt(r.t1)}`).join(", ")}${rs.length > 3 ? ` 외 ${rs.length - 3}곳` : ""})`;
    return t;
  };

  // v3 토큰만 쓴다(.ref/brand-tokens.json). 1px 선, 그림자·블러 없음. 고정 높이는 answer-space·memo-grid 뿐(§15).
  const css = [
    `.note{--canvas:#F7F7F4;--surface:#FFFFFF;--ink:#18181B;--body:#27272A;--muted:#64646D;--line:#DCDCD8;--surfaceSubtle:#F0F0ED;--accent:#FF5600;--accentSubtle:#FFF1E8;--accentText:#A63700;--dark:#202020;--grid:#E2E2DE;--sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Pretendard,astaSans,"Apple SD Gothic Neo",sans-serif;--serif:"Hedvig Letters Serif",NanumMyeongjo,Georgia,serif;--mono:"Geist Mono",Menlo,Monaco,Consolas,monospace;font:14px/1.7 var(--sans);color:var(--body);background:var(--canvas);max-width:760px;margin:0 auto;padding:32px 28px;counter-reset:concept}`,
    `.note h1,.note h2,.note h3,.note h4{color:var(--ink);font-weight:600;line-height:1.35;margin:0 0 .4em}`,
    `.note h1{font-size:27px}.note h2{font-size:22px}.note h3{font-size:17px}.note h4{font-size:14px}`,
    `.note p{margin:.35em 0}.note small,.note .source{font-size:11px;color:var(--muted)}`,
    `.note a{color:var(--accentText)}`,
    `.note .kicker,.note .role,.note .qno,.note .unit-no,.note .unit-range,.note .note-meta,.note .memo-label,.note .qsec,.note .point,.note .qlevel{font-family:var(--mono)}`,
    `.point{display:inline-block;border:1px solid var(--ink);border-radius:999px;padding:0 7px;font-size:10px;margin-right:.4em}`,
    `.qlevel{color:var(--muted);font-size:10px}`,
    `.note-table caption{caption-side:bottom;text-align:left;font-size:11px;color:var(--muted);padding-top:6px}`,
    `.note-block{margin:16px 0}`,
    `.heading-bundle,.eq-bundle,.qa-bundle{display:block}`,
    `.note-head{border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:20px}`,
    `.kicker{color:var(--muted);font-size:11px;letter-spacing:.08em}`,
    `.note-meta{display:flex;flex-wrap:wrap;gap:4px 14px;color:var(--muted);font-size:11px}`,
    `.note-badge{color:var(--accentText);border:1px solid var(--accent);border-radius:999px;padding:0 8px}`,
    `.unit-head{border-top:1px solid var(--line);padding-top:18px;margin:26px 0 8px}`,
    `.unit-no{font-size:26px;color:var(--ink);margin-right:.5em}`,
    `.unit-q{color:var(--muted);margin:.2em 0}`,
    `.unit-range{color:var(--muted);font-size:10px}`,
    `.role{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:1px 10px;color:var(--muted);font-size:10px;margin-bottom:6px}`,
    `.note-claim{margin:.35em 0}`,
    `.note-label{display:inline-block;border-radius:999px;padding:0 8px;margin-left:.4em;font:500 10px/1.8 var(--mono);vertical-align:.1em}`,
    `.note-label-synthetic{background:var(--accentSubtle);color:var(--accentText)}`,
    `.note-label-external{border:1px solid var(--accent);color:var(--accentText)}`,
    `.note-f-img img,.note-crop{max-width:100%;vertical-align:middle}`,
    `.note-f-label{margin-left:.3em;color:var(--muted);font-size:.75em}`,
    `.note-f-check{color:var(--accentText);background:var(--accentSubtle);padding:0 4px}`,
    `.note-f-ocr{color:var(--muted)}`,
    `.note-f-missing{color:var(--accentText)}`,
    `.note-f-src{font-family:var(--mono);font-size:12px}`,
    `.note-fig{border:1px solid var(--line);background:var(--surface);padding:12px 14px;margin:14px 0;display:block}`,
    `.note-fig-title{display:block;font-weight:600;color:var(--ink);margin-bottom:6px}`,
    `.note-fig-src{display:block;color:var(--muted);font:11px var(--mono);margin-top:6px}`,
    `.note-fig-check,.note-fig-missing{color:var(--accentText);margin:0}`,
    `.note-fig-explanation{margin-top:8px;font-size:13px}`,
    `.note-table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.55}`,
    `.note-table th,.note-table td{border:1px solid var(--line);padding:7px 8px;text-align:left;vertical-align:top}`,
    `.note-table thead th{background:var(--surfaceSubtle);font-weight:600}`,
    `.note-table th[scope="row"]{color:var(--ink)}`,
    `.note-chart{width:100%;height:auto;display:block}`,
    `.note-chart text{font:10px var(--mono);fill:var(--muted)}`,
    `.note-chart .axis{stroke:var(--line)}`,
    `.note-chart .vlab{fill:var(--ink)}`,
    `.with-aside{display:flex;gap:24px;align-items:flex-start}`,
    `.with-aside>.note-block{flex:1 1 auto;min-width:0}`,
    `.with-aside>.aside-col{flex:0 0 150px;display:flex;flex-direction:column;gap:8px;border-left:1px solid var(--line);padding-left:14px;font-size:12px;color:var(--muted)}`,
    `.note-block[data-type="B02"],.note-block[data-type="B13"]{background:var(--accentSubtle);padding:14px 16px}`,
    `.note-block[data-type="B11"]{border:1px solid var(--line);border-left:2px solid var(--accent);background:var(--surface);padding:10px 14px}`,
    `.note-block[data-type="B18"]{background:var(--surfaceSubtle);padding:10px 14px}`,
    // 모델 블록 양식(B02·B03·B05~B14·B18) — 자료는 흰 면, 해설·보충은 회색 면, Point 는 자료 채움/해설 테두리로 짝짓는다(시안 규격).
    `.take-claim{margin:.2em 0}.goto{font-size:11px;color:var(--muted)}`,
    `.note-ref{color:var(--muted)}`,
    `.map-nodes{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}`,
    `.map-node{display:inline-block;border:1px solid var(--line);border-radius:999px;background:var(--surface);padding:1px 10px;font-size:12px}`,
    `.map-root{border-color:var(--ink)}`,
    `.map-flow{list-style:none;margin:8px 0;padding:0}`,
    `.map-edge{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;padding:7px 0;border-top:1px solid var(--line)}`,
    `.edge-src,.edge-dst{font-weight:600;color:var(--ink)}`,
    `.edge-rel{font:500 11px var(--mono);color:var(--accentText);white-space:nowrap}`,
    `.edge-rel::before{content:"— "}.edge-rel::after{content:" →"}`,
    `.edge-claim{color:var(--muted)}`,
    `.concept .definition{font-size:15px;color:var(--ink)}`,
    `.note .concept{counter-increment:concept}.concept h3::before{content:"개념 " counter(concept,decimal-leading-zero);display:block;width:max-content;font:500 10px var(--mono);color:var(--muted);letter-spacing:.08em;margin-bottom:2px}`,
    `.slots{display:grid;grid-template-columns:110px 1fr;gap:0 14px;margin:8px 0}`,
    `.slots>dt,.slots>dd{padding:7px 0;border-top:1px solid var(--line)}.slots dt{font:500 11px var(--mono);color:var(--muted)}.slots dd{margin:0}`,
    `.empty{color:var(--muted)}`,
    `.common{border-top:1px solid var(--line);margin-top:8px;padding-top:8px}`,
    // 사슬 번호는 양식이 쓰는 "01 전제" 한 체계뿐 — ol 표식은 끈다.
    `.chain{list-style:none;padding-left:0}.chain>li{margin:.45em 0}.chain>li:not(.relation){border-left:2px solid var(--line);padding-left:12px}`,
    `.chain li.relation{color:var(--muted);font-size:11px}`,
    `.case-box{border:1px solid var(--line);background:var(--surface);padding:12px 14px}`,
    `.analysis-box{border:1px solid var(--line);background:var(--surfaceSubtle);padding:12px 14px;margin-top:8px}`,
    `.case-box h4,.analysis-box h4,.interpretation h4{font:500 11px var(--mono);color:var(--muted);margin:0 0 6px}`,
    `.point-line{margin:.4em 0;break-inside:avoid}`,
    `.point-clue{background:var(--dark);border-color:var(--dark);color:#fff}`,
    `.material-inner{border:1px solid var(--line);background:var(--surface);padding:12px 14px}`,
    `.interpretation{background:var(--surfaceSubtle);padding:10px 12px;margin-top:10px}`,
    `.interpretation .read-lecturer{border-left:2px solid var(--accent);padding-left:10px}`,
    `.quote{border-left:2px solid var(--line);padding-left:12px;margin:8px 0;font-family:var(--serif)}`,
    `.equation{font-size:15px;margin:10px 0;overflow-x:auto}`,
    `.eq-tag{display:block;font:500 10px var(--mono);color:var(--muted);margin-bottom:2px}`,
    `.eq-ref{font-weight:600}`,
    `.eq-note{color:var(--muted)}`,
    `.aside-note{display:block;border:1px solid var(--line);background:var(--surface);padding:8px 10px;font-size:12px}`,
    `.synthesis ol{padding-left:1.4em;margin:.4em 0}.synthesis li{margin:.3em 0}`,
    `.note-check{border:1px solid var(--line);background:var(--surface);padding:10px 14px;margin:10px 0}`,
    `.note-check h4{color:var(--accentText)}`,
    `.note-sys{background:var(--surfaceSubtle)}`,
    `.note-sys ul{margin:.3em 0;padding-left:1.2em}`,
    `.note-checklist,.note-answers{border-top:1px solid var(--line);margin-top:28px;padding-top:16px}`,
    `.qsec{color:var(--muted);font-size:10px;display:block;margin-bottom:6px}`,
    `.question{display:flex;gap:12px;margin:14px 0}`,
    `.qno{color:var(--accentText);font-weight:600;font-size:13px}`,
    `.qbody{flex:1}.premise{color:var(--muted)}`,
    `.answer-link{font-size:12px}`,
    `.ox-mark{font:12px var(--mono);color:var(--muted);letter-spacing:.1em;margin:.3em 0}`,
    `.answer-space{height:72px;border:1px solid var(--line);background:var(--surface);margin-top:8px}`,
    `.answer{border:1px solid var(--line);background:var(--surface);padding:10px 14px;margin:8px 0}`,
    `details.answer{padding:0}`,
    `details.answer>summary{cursor:pointer;padding:8px 12px;font:500 12px var(--mono);color:var(--accentText)}`,
    `details.answer>.answer-body{padding:0 12px 10px}`,
    `.answer-head{margin:0}.verdict{font-family:var(--mono)}`,
    `.answer-rubric,.answer-alt{border-top:1px solid var(--line);margin-top:8px;padding-top:6px;font-size:13px}`,
    `.answer-rubric ul,.answer-alt ul{margin:.3em 0;padding-left:1.2em}`,
    `.answer-rev,.backlink{font-size:11px;color:var(--muted)}`,
    `.memo-row{display:flex;gap:12px;margin:12px 0;align-items:flex-start}`,
    `.memo-label{flex:0 0 90px;color:var(--muted);font-size:11px;padding-top:4px}`,
    `.memo-grid{flex:1;height:110px;border:1px solid var(--line);background-color:var(--surface);background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:5mm 5mm}`,
    // mis-sol-hai 표시(시안 확정 1B·2B·3B + 추가 7종) — 기존 토큰만 쓴다.
    `.note .mk-tags{display:flex;gap:6px;margin:0 0 4px}`,
    `.mk-1B{font-weight:700;color:var(--ink);background:linear-gradient(transparent 56%,color-mix(in srgb,var(--accent) 30%,transparent) 56%,color-mix(in srgb,var(--accent) 30%,transparent) 94%,transparent 94%)}`,
    `.mk-2B{position:relative;display:inline;padding-left:18px;text-decoration:underline dotted var(--muted);text-decoration-thickness:1.5px;text-underline-offset:4px}`,
    `.mk-pen{position:absolute;left:0;top:.25em;width:13px;height:13px;fill:none;stroke:var(--accentText);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}`,
    `.mk-3B{background:var(--accentSubtle);border-color:var(--accent)}`,
    `.mk-mic{display:inline-block;width:12px;height:12px;margin-right:4px;vertical-align:-2px;fill:none;stroke:var(--accentText);stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}`,
    `.mk-3B strong{color:var(--accentText)}`,
    `.mk-exam,.mk-rep{font:500 10px/1.8 var(--mono);border-radius:999px;padding:0 8px;vertical-align:.1em}`,
    `.mk-exam{background:var(--ink);color:var(--canvas)}`,
    `.mk-rep{border:1px solid var(--ink);color:var(--ink)}`,
    `.mk-term{font-weight:700;color:var(--ink)}`,
    `.mk-cond{font:500 10px/1.8 var(--mono);color:var(--accentText);border:1px solid var(--accentText);border-radius:4px;padding:0 5px;margin-right:2px}`,
    `.mk-flow{margin:6px 0;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px}`,
    `.mk-step{border-left:2px solid var(--line);padding-left:8px}`,
    `.mk-step small{font:500 10px var(--mono);color:var(--muted)}`,
    `.mk-arrow{font:600 14px var(--mono);color:var(--accentText)}`,
    `.mk-quote{margin:.4em 0;font-family:var(--serif);font-style:italic;color:var(--ink);border-left:2px solid var(--accent);padding-left:10px}`,
    `.mk-pair{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0}`,
    `.mk-chip-e{border:1px solid var(--line);border-radius:999px;padding:0 10px;font-size:12px;color:var(--ink);background:var(--surface)}`,
    `.mk-vs{font:600 12px var(--mono);color:var(--accentText)}`,
    // 좁은 화면(≤520px): 본문은 최소 16px, 곁설명은 위아래로, 표는 행 카드 + data-label 로 열 이름을 반복한다(thead 를 숨기기만 하지 않는다, §15).
    `@media (max-width:520px){.note{padding:18px 14px;font-size:16px}.concept .definition{font-size:16px}.with-aside{display:block}.with-aside>.aside-col{border-left:0;border-top:1px solid var(--line);padding:8px 0 0}`,
    `.note-table thead{display:none}`,
    `.note-table,.note-table tbody,.note-table tr,.note-table th,.note-table td{display:block}`,
    `.note-table tr{border:1px solid var(--line);margin-bottom:8px}`,
    `.note-table td,.note-table th[scope="row"]{border:0;padding:4px 8px}`,
    `.note-table td::before{content:attr(data-label);display:block;font:500 10px var(--mono);color:var(--muted)}}`,
    // 인쇄(§15): A4·14.3mm, 제목은 본문과 묶고, 표는 행에서만 나누며 머리를 반복한다. 긴 블록·답안은 통째로 묶지 않고
    // 의미 단위(소제목·루브릭·대안·관계 행·답란)만 페이지를 넘기지 않게 둔다 — 큰 덩어리는 잘려 보일 수 있다.
    `@media print{@page{size:A4;margin:14.3mm}body{background:#fff!important}.note{background:#fff;max-width:none;padding:0}`,
    `.note h1,.note h2,.note h3,.note h4,.note .unit-head,.note .answer-head,.note .kicker,.note .role,.note .qsec,.note .concept .definition{break-after:avoid}`,
    `.note .unit-head,.note .note-check{break-inside:avoid}`,
    // 개념 머리(::before '개념 NN' 줄)는 h3 통째로, 곁설명·짧은 OX 답 카드는 카드째로 묶는다 — 일반 with-aside·단원은 묶지 않는다.
    `.note .concept h3,.note .aside-note,.note .answer-compact{break-inside:avoid}`,
    // 작은 의미 단위 상자(B09 자료·B08 사례 자료)와 독립 수식 행도 한 쪽을 넘기지 않는다 — 긴 답·단원은 여전히 나뉜다.
    `.note .material-inner,.note .case-box,.note .equation{break-inside:avoid}`,
    `.note .with-aside:has(.concept){break-inside:avoid}.note .with-aside>.aside-col{border-left:0}.note .answer .backlink{display:block;break-after:avoid}`,
    // .role 은 inline 칩이라 break-after 가 안 먹힌다 — 인쇄에서는 블록 배지로 내려 다음 제목과 묶이게 한다.
    `.note .role{display:block;width:max-content}`,
    `.note p,.note li{orphans:2;widows:2}`,
    `.note .answer-space,.note .map-edge,.note .answer-rubric,.note .answer-alt,.note .slots,.note .memo-row{break-inside:avoid}`,
    `.note tr{break-inside:avoid}.note thead{display:table-header-group}`,
    `.note .heading-bundle,.note .eq-bundle,.note .qa-bundle{break-inside:avoid}`,
    `.note.print-trim-whitespace .note-block{margin:10px 0}.note.print-trim-whitespace .unit-head{margin:16px 0 6px}.note.print-trim-whitespace .note-checklist,.note.print-trim-whitespace .note-answers{margin-top:16px}`,
    `.note.print-tighten-leading{line-height:1.55}.note.print-tighten-leading p{margin:.25em 0}`,
    `.note.print-rearrange-units .with-aside{display:block}.note.print-rearrange-units .with-aside>.aside-col{border-left:0;border-top:1px solid var(--line);padding:8px 0 0}`,
    `.note.print-allow-splits .note-table{break-inside:auto}.note.print-allow-splits .equation{overflow-x:visible}`,
    `.print-warning-notice{display:block;border:1px dashed var(--accent);color:var(--accentText);padding:6px 10px;font-size:11px;margin:8px 0;background:var(--accentSubtle)}`,
    // 흑백 인쇄 대체(시안): 색·배경 대신 선·글자로 구분한다.
    `.note .mk-1B{background:none;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}`,
    `.note .mk-2B{text-decoration:underline dashed #000;text-decoration-thickness:2px;text-underline-offset:4px}.note .mk-2B .mk-pen{stroke:#000}`,
    `.note .mk-3B{background:none;border-color:#000;border-left:4px solid #000;padding-left:10px}.note .mk-3B .mk-mic{stroke:#000}`,
    `.note .mk-exam{background:#000;color:#fff}`,
    `.note .mk-quote{border-left-color:#000}`,
    `.note .page-break{break-before:page}`,
    `.note details{display:block}.note details:not([open])>:not(summary){display:block!important}.note details::details-content{content-visibility:visible!important;display:block!important}}`,
  ].join("\n");

  const freeze = o => { for (const v of Object.values(o)) if (v && typeof v === "object") freeze(v); return Object.freeze(o); };
  const api = freeze({ NOTE_SPEC_VERSION, RENDER_VERSION, templates, layout, notice, css });
  globalThis.NoteSpec = api;
  if (typeof module !== "undefined") module.exports = api;
})();
