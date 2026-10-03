// 노트 표현 슬롯 v2 — Note(JSON) → HTML 의 모든 표현(템플릿·문서 순서·고지 문구·CSS)이 여기 있다.
// 엔진(lib/note-render.js)은 이스케이프·{{F12}} 치환·display 규칙·경고만 담당하고 양식을 모른다.
// 계약 스키마는 lib/note-contract.js 에 있다 — 이 파일은 표현만 내보낸다(docs/note-contract.md §14·§15, .ref/ 의 v3 토큰).
(() => {
  const NoteContract = globalThis.NoteContract || (typeof require !== "undefined" ? require("./note-contract.js") : null);
  const NOTE_SPEC_VERSION = NoteContract.NOTE_SPEC_VERSION;
  // 마크업·CSS 가 바뀌면 올린다 — 디자인만 바뀐 재렌더는 H 단계만 다시 한다(§13).
  const RENDER_VERSION = "render-2";

  const arr = v => (Array.isArray(v) ? v : []);
  // note-contract 의 isClaim 과 같은 모양: {text, evidenceIds, basis}.
  const isClaim = v => !!v && typeof v === "object" && !Array.isArray(v)
    && Object.keys(v).length === 3 && ["text", "evidenceIds", "basis"].every(k => Object.hasOwn(v, k));
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

  // part 1 임시(B02·B03·B05~B14·B18): 내용 속 주장을 순서대로 나열한다. 타입별 양식은 part 2 가 교체한다.
  // 단서·해석 쌍(B08·B09 points)은 지금도 Point n 앵커를 단다(§15) — 다른 블록·문항이 #<blockId>-Pn 으로 가리킨다.
  const generic = (b, h) => {
    const c = b && b.content, out = [];
    for (const [i, p] of arr(c && c.points).entries())
      out.push(`<div class="point-pair" id="${h.esc(b.id)}-P${i + 1}"><span class="point">Point ${i + 1}</span>`
        + h.claim(p && p.clue, { tag: "span" }) + h.claim(p && p.reading, { tag: "span" }) + "</div>");
    const walk = v => {
      if (isClaim(v)) { out.push(h.claim(v)); return; }
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "points") walk(x);
    };
    walk(c);
    return out.join("");
  };
  // 복습 위치 링크 글자 — 블록 양식 이름이 있으면 쓰고 없으면 id 그대로.
  const labelOf = (note, id) => {
    const all = [...arr(note && note.global), ...arr(note && note.sections).flatMap(s => arr(s && s.blocks))];
    const b = all.find(x => x && x.id === id), t = b && NoteContract && NoteContract.TYPES[b.type];
    return (t && t.name) || id;
  };

  // B01 강의 머리 — meta·status 에서 투영(코드 블록).
  const B01 = (b, h) => {
    const m = (h.note && h.note.meta) || {};
    const bits = [m.course, m.session, m.lectureDate].filter(x => typeof x === "string" && x).map(x => `<span>${h.esc(x)}</span>`);
    if (m.processed) bits.push(`<span>처리 구간 ${h.esc(h.time(m.processed.t0, m.processed.t1))}</span>`);
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
    const rev = arr(a.reviewIds).filter(x => typeof x === "string");
    if (rev.length) s += `<p class="answer-rev"><strong>복습 위치</strong> ${rev.map(id => `<a href="#${h.esc(id)}">${h.esc(labelOf(h.note, id))}</a>`).join(" ")}</p>`;
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
        .map(x => (x && x.code && !String(x.code).startsWith("NOTE_ADVISORY_")) ? h.notice(x) : "").filter(Boolean);
      return lines.length ? `<aside class="note-check note-sys"><h4>처리 고지</h4><ul>${lines.map(t => `<li>${t}</li>`).join("")}</ul></aside>` : "";
    }
    const c = b.check || {}, corr = c.kind === "correction";
    const line = (label, cl) => (cl ? `<p><strong>${label}</strong> ${h.claim(cl, { tag: "span" })}</p>` : "");
    return `<aside class="note-check" data-kind="${h.esc(c.kind || "")}"><h4>[${CHECK[c.kind] || "확인 필요"}]</h4>`
      + h.claim(c.claim) + line(corr ? "정정 전" : "이전 값", c.before) + line(corr ? "정정 후" : "새 값", c.after)
      + line("보류", c.hold) + `</aside>`;
  };

  const templates = {
    B01, B02: generic, B03: generic, B04,
    B05: generic, B06: generic, B07: generic, B08: generic, B09: generic, B10: generic,
    B11: generic, B12: generic, B13: generic, B14: generic,
    B15, B16, B17, B18: generic,
  };

  // B14 문항을 블록(단원)별로 묶되 번호는 문서 전체에서 이어진다(§15). h.qno(blockId, index) 가 1 기반 번호를 준다.
  const qgroups = (note, h) => {
    const out = []; let total = 0;
    for (const s of arr(note.sections)) for (const b of arr(s && s.blocks))
      if (b && b.type === "B14")
        out.push({ s, b, qs: arr(b.content && b.content.items).map((item, i) => ({ item, n: pad2(h.qno(b.id, i) ?? ++total) })) });
    return out;
  };

  // 문항 한 칸: 번호 + 유형 + 본문 + (매체에 따라) 접힌 해설/끝 파트 링크 + 답 쓰는 공간(인쇄 전용 고정 높이).
  const question = ({ item, n }, h) => {
    const answer = h.opts.medium === "web"
      ? `<details class="answer"><summary>${n}번 해설 보기</summary><div class="answer-body">${templates.B15({ n, item }, h)}</div></details>`
      : h.opts.answers === "inline"
        ? `<div class="answer">${templates.B15({ n, item }, h)}</div>`
        : `<p class="answer-link"><a href="#a-${n}">정답과 해설</a></p>`;
    return `<div class="question" id="q-${n}"><span class="qno">${n}</span><div class="qbody">`
      + `<strong>${h.esc(QKIND[item.kind] || item.kind || "문항")}</strong>${item.level ? ` <small class="qlevel">${h.esc(QLEVEL[item.level] || item.level)}</small>` : ""}<p>${h.claim(item.prompt, { tag: "span" })}</p>`
      + (item.premise ? `<p class="premise">${h.claim(item.premise, { tag: "span" })}</p>` : "")
      + answer + `<div class="answer-space" aria-hidden="true"></div></div></div>`;
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
      for (const b of arr(s && s.blocks)) {
        if (!b || b.type === "B14" || b.type === "B18") continue;
        const html = h.block(b) + arr(b.content && b.content.figureIds).map(g => h.figure(g)).join("");
        if (b.type === "B12" && body.length) body.push(`<div class="with-aside">${body.pop()}${html}</div>`);
        else body.push(html);
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
          + qs.map(({ item, n }) => `<div class="answer" id="a-${n}"><a class="backlink" href="#q-${n}">문항 ${n}으로</a>${templates.B15({ n, item }, h)}</div>`).join("") + "</section>");
    }
    const sys = templates.B17({ sys: true }, h);
    if (sys) pieces.push(sys);
    if (h.opts.writing) pieces.push(B16(null, h));
    return `<article class="note">${pieces.join("")}</article>`;
  };

  // §12.3 고지 문구 — 일반 텍스트를 돌려준다(이스케이프는 h.notice 가 한다). ids 는 절대 문구에 쓰지 않는다.
  const TEXT = {
    NOTE_CAPTURE_GAP: c => `인식하지 못한 구간 ${c}곳`,
    NOTE_SECTIONS_FAILED: c => `요약하지 못한 단원 ${c}개`,
    NOTE_BLOCKS_DROPPED: c => `검증을 통과하지 못해 뺀 내용 ${c}건`,
    NOTE_UNITS_UNCITED: c => `노트에 반영되지 않은 강의 구간 ${c}곳`,
    NOTE_GLOBAL_FAILED: () => "강의 전체 요약을 만들지 못했습니다",
    NOTE_JUDGE_SKIPPED: () => "중요도 판정 없이 만들었습니다",
    NOTE_ITEMS_PRUNED: c => `연결된 내용이 빠져 함께 뺀 항목 ${c}건`,
    NOTE_FORMULAS_IMAGE: c => `원본 이미지로 표시한 수식 ${c}개`,
    NOTE_FORMULAS_CHECK: c => `확인이 필요한 수식 ${c}개`,
    NOTE_FORMULAS_UNVERIFIED: c => `확인이 필요한 수식 ${c}개`,
    NOTE_FIGURES_CHECK: c => `확인이 필요한 도표 ${c}개`,
    NOTE_FIGURES_NOT_DETECTED: () => "도표는 찾지 않았습니다(Free)",
    NOTE_AUGMENTED: () => "가상 사례·강의 밖 보강이 포함된 노트입니다",
  };
  const notice = n => {
    const code = String(n && n.code || ""), c = n && n.count != null ? n.count : 1;
    let t = TEXT[code] ? TEXT[code](c) : `기타 고지: ${code}×${c}`;
    const rs = arr(n && n.ranges);
    if (rs.length) t += ` (${rs.slice(0, 3).map(r => `${fmt(r.t0)}–${fmt(r.t1)}`).join(", ")}${rs.length > 3 ? ` 외 ${rs.length - 3}곳` : ""})`;
    return t;
  };

  // v3 토큰만 쓴다(.ref/brand-tokens.json). 1px 선, 그림자·블러 없음. 고정 높이는 answer-space·memo-grid 뿐(§15).
  const css = [
    `.note{--canvas:#F7F7F4;--surface:#FFFFFF;--ink:#18181B;--body:#27272A;--muted:#64646D;--line:#DCDCD8;--surfaceSubtle:#F0F0ED;--accent:#FF5600;--accentSubtle:#FFF1E8;--accentText:#A63700;--dark:#202020;--grid:#E2E2DE;--sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Pretendard,astaSans,"Apple SD Gothic Neo",sans-serif;--serif:"Hedvig Letters Serif",NanumMyeongjo,Georgia,serif;--mono:"Geist Mono",Menlo,Monaco,Consolas,monospace;font:14px/1.7 var(--sans);color:var(--body);background:var(--canvas);max-width:760px;margin:0 auto;padding:32px 28px}`,
    `.note h1,.note h2,.note h3,.note h4{color:var(--ink);font-weight:600;line-height:1.35;margin:0 0 .4em}`,
    `.note h1{font-size:27px}.note h2{font-size:22px}.note h3{font-size:17px}.note h4{font-size:14px}`,
    `.note p{margin:.35em 0}.note small,.note .source{font-size:11px;color:var(--muted)}`,
    `.note a{color:var(--accentText)}`,
    `.note .kicker,.note .role,.note .qno,.note .unit-no,.note .unit-range,.note .note-meta,.note .memo-label,.note .qsec,.note .point,.note .qlevel{font-family:var(--mono)}`,
    `.point{display:inline-block;border:1px solid var(--ink);border-radius:999px;padding:0 7px;font-size:10px;margin-right:.4em}`,
    `.qlevel{color:var(--muted);font-size:10px}`,
    `.note-table caption{caption-side:bottom;text-align:left;font-size:11px;color:var(--muted);padding-top:6px}`,
    `.note-block{margin:16px 0}`,
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
    `.note-fig-check{color:var(--accentText);margin:0}`,
    `.note-table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.55}`,
    `.note-table th,.note-table td{border:1px solid var(--line);padding:7px 8px;text-align:left;vertical-align:top}`,
    `.note-table thead th{background:var(--surfaceSubtle);font-weight:600}`,
    `.note-chart{width:100%;height:auto;display:block}`,
    `.note-chart text{font:10px var(--mono);fill:var(--muted)}`,
    `.note-chart .axis{stroke:var(--line)}`,
    `.note-chart .vlab{fill:var(--ink)}`,
    `.with-aside{display:flex;gap:24px;align-items:flex-start}`,
    `.with-aside>.note-block{flex:1 1 auto;min-width:0}`,
    `.with-aside>.note-block[data-type="B12"]{flex:0 0 150px;border-left:1px solid var(--line);padding-left:14px;font-size:12px;color:var(--muted)}`,
    `.note-block[data-type="B02"],.note-block[data-type="B13"]{background:var(--accentSubtle);padding:14px 16px}`,
    `.note-block[data-type="B11"]{border:1px solid var(--line);border-left:2px solid var(--accent);background:var(--surface);padding:10px 14px}`,
    `.note-block[data-type="B18"]{background:var(--surfaceSubtle);padding:10px 14px}`,
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
    // 좁은 화면(≤520px): 곁설명은 위아래로, 표는 행 카드 + data-label 로 열 이름을 반복한다(thead 를 숨기기만 하지 않는다, §15).
    `@media (max-width:520px){.note{padding:18px 14px}.with-aside{display:block}.with-aside>.note-block[data-type="B12"]{border-left:0;border-top:1px solid var(--line);padding:8px 0 0}`,
    `.note-table thead{display:none}`,
    `.note-table,.note-table tbody,.note-table tr,.note-table th,.note-table td{display:block}`,
    `.note-table tr{border:1px solid var(--line);margin-bottom:8px}`,
    `.note-table td,.note-table th[scope="row"]{border:0;padding:4px 8px}`,
    `.note-table td::before{content:attr(data-label);display:block;font:500 10px var(--mono);color:var(--muted)}}`,
    // 인쇄(§15): A4·14.3mm, 제목은 본문과 묶고, 표는 행에서만 나누며 머리를 반복하고, 문항+답란은 한 덩어리다.
    `@media print{@page{size:A4;margin:14.3mm}.note{background:#fff;max-width:none;padding:0}`,
    `.note h1,.note h2,.note h3,.note h4,.note .unit-head{break-after:avoid}`,
    `.note p,.note li{orphans:2;widows:2}`,
    `.note-block[data-type="B05"],.note .question,.note .answer-space{break-inside:avoid}`,
    `.note tr{break-inside:avoid}.note thead{display:table-header-group}`,
    `.note .page-break{break-before:page}`,
    `.note details{display:block}.note details:not([open])>:not(summary){display:block!important}.note details::details-content{content-visibility:visible!important;display:block!important}}`,
  ].join("\n");

  const freeze = o => { for (const v of Object.values(o)) if (v && typeof v === "object") freeze(v); return Object.freeze(o); };
  const api = freeze({ NOTE_SPEC_VERSION, RENDER_VERSION, templates, layout, notice, css });
  globalThis.NoteSpec = api;
  if (typeof module !== "undefined") module.exports = api;
})();
