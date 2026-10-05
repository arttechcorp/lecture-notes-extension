// Note → Markdown 어댑터 (docs/note-contract.md §15 문서 순서, Phase 7-4). v1 sidepanel 의 noteText 를 대체한다.
// 순수 함수다: DOM·시각·난수 없음, note 를 바꾸지 않는다. evidenceIds·targetIds 같은 id 는 절대 출력하지 않는다.
// 수식은 registry.display 로만: latex → $…$(본문)·$$…$$(formulaIds), crop → [수식: 원본 이미지], check → [수식 확인 필요].
// 고지는 내용이 없다 — 코드·건수·시각 구간만으로 만든다(§12.3). NOTE_ADVISORY_ 는 조판 힌트라 숨긴다(§15).
(() => {
  const TOPIC = { exam: "시험", assignment: "과제", deadline: "기한", materials: "자료", request: "요청", other: "기타" };
  const REF = /\{\{\s*(F\d+)\s*\}\}/g;
  const arr = v => (Array.isArray(v) ? v : []);
  const str = v => (typeof v === "string" ? v : "");
  // 모델 텍스트는 < > 만 치환한다 — & 까지 치환하면 방금 만든 &lt; 가 &amp;lt; 로 깨진다.
  const esc = s => String(s ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // 표 셀 전용: | 는 셀 경계를, 줄바꿈은 표 자체를 깨므로 무력화한다. < > 는 호출부에서 이미 치환했다.
  const td = s => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

  const fmt = t => {
    t = Math.max(0, Math.floor(Number(t) || 0));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  };

  const ROLES = { premise: "전제", value_premise: "가치 전제", evidence: "근거", reason: "이유", claim: "주장", counter: "반론", condition: "조건", step: "단계", event: "사건", result: "결과" };
  const LEVELS = { basic: "기본", applied: "응용", advanced: "심화" };
  const BASIS = { synthetic: " _(가상 사례)_", external: " _(강의 밖 보강 — 확인 필요)_" };
  // §12.3 고지 코드 → 사용자 문구. count 기본값 1. 여기 없는 코드는 "기타 고지" 로 둔다.
  const NOTICES = {
    NOTE_CAPTURE_GAP: c => `인식하지 못한 구간 ${c}곳`,
    NOTE_SECTIONS_FAILED: c => `요약하지 못한 단원 ${c}개`,
    NOTE_BLOCKS_DROPPED: c => `검증을 통과하지 못해 뺀 내용 ${c}건`,
    NOTE_UNITS_UNCITED: c => `노트에 반영되지 않은 강의 구간 ${c}곳`,
    NOTE_GLOBAL_FAILED: () => "강의 전체 요약을 만들지 못했습니다",
    NOTE_JUDGE_SKIPPED: () => "중요도 판정 없이 만들었습니다",
    NOTE_CLAIMS_UNSUPPORTED: c => `강의 근거가 부족해 보류한 내용 ${c}건`,
    NOTE_ITEMS_PRUNED: c => `연결된 내용이 빠져 함께 뺀 항목 ${c}건`,
    NOTE_FORMULAS_IMAGE: c => `원본 이미지로 표시한 수식 ${c}개`,
    NOTE_FORMULAS_CHECK: c => `확인이 필요한 수식 ${c}개`,
    NOTE_FORMULAS_UNVERIFIED: c => `확인이 필요한 수식 ${c}개`,
    NOTE_FIGURES_CHECK: c => `확인이 필요한 도표 ${c}개`,
    NOTE_FIGURES_NOT_DETECTED: () => "도표는 찾지 않았습니다(Free)",
    NOTE_AUGMENTED: () => "가상 사례·강의 밖 보강이 포함된 노트입니다",
  };
  // 알 수 없는 블록 폴백이 건너뛰는 키: 문자열이지만 본문이 아니다(note-render.js 와 같은 규칙 + id 필드들).
  const SKIP_KEYS = new Set(["type", "id", "ids", "evidenceIds", "sectionId", "status", "importance", "emphasis", "targetIds", "reviewIds",
    "formulaIds", "figureIds", "conceptIds", "appliedConceptIds", "unitIds", "crossUnitIds", "ranges", "pointRefs", "key", "from", "to"]);

  function toMarkdown(note, { answers = "end" } = {}) {
    if (!note || typeof note !== "object") return "";
    const registry = new Map(arr(note.registry).filter(e => e && typeof e.id === "string").map(e => [e.id, e]));
    const figures = new Map(arr(note.figures).filter(f => f && typeof f.id === "string").map(f => [f.id, f]));

    // {{F12}} 자리표시자 → display 별 표기. 모르는 id 는 중립 표식으로만 둔다.
    const formulaRef = id => {
      const e = registry.get(id);
      if (!e) return "[수식]";
      if (e.display === "latex") return str(e.latex).trim() ? `$${e.latex}$` : "[수식 확인 필요]";
      return e.display === "crop" ? "[수식: 원본 이미지]" : e.display === "check" ? "[수식 확인 필요]" : "[수식]";
    };
    // B10 formulaIds 목록 전용 — 같은 규칙이지만 latex 는 디스플레이 수식($$)이다.
    const formulaLine = id => {
      const e = registry.get(id);
      if (!e) return "[수식]";
      if (e.display === "latex") return str(e.latex).trim() ? `$$${e.latex}$$` : "[수식 확인 필요]";
      return e.display === "crop" ? "[수식: 원본 이미지]" : e.display === "check" ? "[수식 확인 필요]" : "[수식]";
    };
    // 본문 텍스트: 참조를 치환하고 나머지를 이스케이프한다. 줄 머리 구조 문자(#, >, -)는 \ 로 무력화한다.
    const rich = text =>
      String(text ?? "").split(REF).map((part, i) => (i % 2 ? formulaRef(part) : esc(part))).join("")
        .split("\n").map(line => (/^[#>-]/.test(line) ? "\\" + line : line)).join("\n");
    // 주장: 텍스트만 낸다. basis 가 정책 외 종류면 사용자에게 보이는 꼬리표를 붙인다.
    const claim = c => (c && typeof c === "object" && typeof c.text === "string") ? rich(c.text) + (BASIS[c.basis] || "") : "";
    const bullets = list => arr(list).map(x => `- ${claim(x)}`).join("\n");
    const grouped = (label, list) => (arr(list).length ? [`${label}:\n${bullets(list)}`] : []);
    // B08·B09 의 단서-해석 쌍. 번호는 규격상 "Point n" 다(§15).
    const points = list => arr(list).map((p, i) => `- **Point ${i + 1}.** ${claim(p?.clue)} → ${claim(p?.reading)}`).join("\n");
    const quote = text => `> ${rich(text).split("\n").join("\n> ")}`;
    // 첫 행이 머리인 Markdown 표. 셀은 호출부에서 esc/claim 처리한 문자열이다.
    const mdTable = (head, rows) => {
      const w = head.length;
      const line = r => `| ${Array.from({ length: w }, (_, i) => td(str(r[i]) || "—")).join(" | ")} |`;
      return [line(head), line(Array(w).fill("---")), ...rows.map(line)].join("\n");
    };
    const figureMd = id => {
      const f = figures.get(id);
      const rows = arr(f?.cells).filter(r => Array.isArray(r));
      if (rows.length && rows[0].length) {
        const w = rows[0].length;
        const line = r => `| ${Array.from({ length: w }, (_, i) => td(esc(str(r[i])))).join(" | ")} |`;
        return [line(rows[0]), line(Array(w).fill("---")), ...rows.slice(1).map(line)].join("\n");
      }
      return `[도표: ${esc(str(f?.title)) || esc(id)} — 원본 화면 참고]`;
    };
    const values = (label, list) => (arr(list).length
      ? `${label}:\n` + arr(list).map(x => `- ${rich(x?.label)}: ${typeof x?.value === "number" ? x.value : ""}${str(x?.unit) ? " " + esc(x.unit) : ""}`).join("\n")
      : "");
    const decision = d => {
      if (!d || typeof d !== "object") return "";
      const grp = (label, list) => (arr(list).length ? `${label}:\n${bullets(list)}` : "");
      return [d.actor ? `행위자: ${claim(d.actor)}` : "", d.goal ? `목표: ${claim(d.goal)}` : "",
        grp("대안", d.alternatives), grp("기준", d.criteria), grp("장단점", d.tradeoffs), grp("빠진 정보", d.missingData)]
        .filter(Boolean).join("\n\n");
    };
    const leaves = (v, out = []) => {
      if (typeof v === "string") out.push(v);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!SKIP_KEYS.has(k)) leaves(x, out);
      return out;
    };
    const fallback = b => leaves(b).map(rich).join("\n");

    // 타입별 렌더러 — 반환은 "단락" 문자열 배열. 빈 문자열은 조립 때 걸러진다.
    const BLOCKS = {
      B02: c => [claim(c.question), arr(c.items).map((it, i) => `${i + 1}. ${claim(it?.claim)}${it?.reason ? " — " + claim(it.reason) : ""}`).join("\n")],
      B03: c => {
        const name = key => esc(str(arr(c.nodes).find(n => n?.key === key)?.label || key));
        return [`### ${rich(c.title)}`, arr(c.nodes).map(n => `- ${esc(str(n?.label))}`).join("\n"),
          arr(c.edges).map(e => `- ${name(e?.from)} → ${name(e?.to)}${str(e?.relation) ? ` (${str(e.relation)})` : ""}`).join("\n")];
      },
      B05: c => [`### ${rich(c.term)}${str(c.original) ? ` (${rich(c.original)})` : ""}`,
        claim(c.definition), claim(c.explanation), claim(c.mechanism), ...grouped("범위", c.scope), ...grouped("예시", c.examples)],
      B06: c => [`### ${rich(c.title)}`,
        mdTable(["기준", ...arr(c.entities).map(e => esc(str(e?.label)))],
          arr(c.criteria).map(r => [esc(str(r?.label)), ...arr(r?.cells).map(x => (x ? claim(x) : ""))])),
        ...grouped("공통", c.common), c.discriminator ? `구별 기준: ${claim(c.discriminator)}` : ""],
      B07: c => [`### ${rich(c.title)}`, claim(c.question),
        arr(c.steps).map((s, i) => `${i + 1}. ${ROLES[s?.role] || str(s?.role) || "단계"}: ${claim(s?.claim)}`).join("\n"),
        arr(c.missingLinks).length ? `연결 설명 확인 필요:\n${bullets(c.missingLinks)}` : ""],
      B08: c => [`### ${rich(c.caseTitle)}`, claim(c.situation), points(c.points),
        c.judgment ? `**판단.** ${claim(c.judgment.claim)}` : "", ...grouped("한계", c.limits), decision(c.decision)],
      B09: c => [`### ${rich(c.sourceTitle)}`, claim(c.gist), c.quote?.text ? quote(c.quote.text) : "", points(c.points),
        c.authorClaim ? `**저자 주장.** ${claim(c.authorClaim)}` : "",
        c.lecturerReading ? `**강의의 해석.** ${claim(c.lecturerReading)}` : "", ...grouped("한계", c.limits)],
      B10: c => [`### ${rich(c.title)}`, claim(c.goal), arr(c.formulaIds).map(formulaLine).join("\n"),
        ...arr(c.figureIds).map(figureMd), ...grouped("가정", c.assumptions),
        arr(c.variables).length ? mdTable(["기호", "의미", "단위"], arr(c.variables).map(v => [esc(str(v?.symbol)), claim(v?.meaning), esc(str(v?.unit))])) : "",
        values("입력", c.inputs), values("계산", c.steps),
        arr(c.derived).map(d => (str(d) ? `$$${str(d)}$$` : "")).filter(Boolean).join("\n"),
        ...grouped("읽는 법", c.reading), c.result ? `결과: ${claim(c.result)}` : "",
        ...grouped("한계", c.limits), c.withheld ? `보류: ${claim(c.withheld)}` : ""],
      B11: c => [c.origin === "structural_check" ? "*구분 점검*" : "", `**오해** ${claim(c.misconception)}`,
        `**바로잡기** ${claim(c.correction)}`, ...grouped("조건", c.conditions)],
      B12: c => (claim(c.note) ? [`> 곁설명: ${claim(c.note)}`.split("\n").join("\n> ")] : []),
      B13: c => [`### ${rich(c.title)}`, arr(c.propositions).map((p, i) => `${i + 1}. ${claim(p?.claim)}`).join("\n")],
      B18: c => [arr(c.items).map(it => `- ${TOPIC[it?.topic] || str(it?.topic)}: ${claim(it?.claim)}${str(it?.due) ? ` (기한: ${rich(it.due)})` : ""}`).join("\n")],
    };
    const blockLines = b => {
      const fn = BLOCKS[str(b?.type)];
      return (fn ? fn(b?.content && typeof b.content === "object" ? b.content : {}) : [fallback(b)])
        .filter(x => typeof x === "string" && x.trim());
    };

    const questionMd = (it, n, inline) => {
      const lines = [`**Q${n}.** ${claim(it?.prompt)}${str(it?.level) ? ` *(${LEVELS[it.level] || it.level})*` : ""}`];
      if (it?.premise) lines.push(`- 전제: ${claim(it.premise)}`);
      if (inline) lines.push(answerMd(it?.answer, n));
      return lines.filter(Boolean).join("\n");
    };
    const answerMd = (a, n) => {
      if (!a || typeof a !== "object") return `**A${n}.**`;
      const lines = [`**A${n}.** ${a.verdict === "O" || a.verdict === "X" ? `${a.verdict} — ` : ""}${claim(a.explanation)}`];
      if (a.correction) lines.push(`- 바로잡기: ${claim(a.correction)}`);
      if (arr(a.rubric).length) lines.push("- 좋은 답의 조건:", ...arr(a.rubric).map(x => `  - ${claim(x)}`));
      if (arr(a.alternatives).length) lines.push("- 다른 답:", ...arr(a.alternatives).map(x => `  - ${rich(x)}`));
      return lines.join("\n");
    };
    const noticeMd = n => {
      const code = str(n?.code);
      if (!code || code.startsWith("NOTE_ADVISORY_")) return "";
      const c = Number.isInteger(n?.count) ? n.count : 1;
      const fn = NOTICES[code];
      let text = fn ? fn(c) : `기타 고지: ${code}×${c}`;
      const ranges = arr(n?.ranges).filter(r => r && typeof r === "object");
      if (ranges.length) {
        const shown = ranges.slice(0, 3).map(r => `${fmt(r.t0)}–${fmt(r.t1)}`);
        text += ` (${shown.join(", ")}${ranges.length > 3 ? `, … 외 ${ranges.length - 3}곳` : ""})`;
      }
      return `- ${text}`;
    };

    // §15 문서 순서: B01 머리 → 전역 B02·B03 → 단원(헤더·블록·확인) → 전역 B13 → 자기 점검 → 정답 → 처리 고지.
    const meta = note.meta && typeof note.meta === "object" ? note.meta : {};
    const out = [`# ${rich(meta.title) || "강의 노트"}`];
    const metaLine = [meta.session, meta.course, meta.lectureDate].map(s => esc(str(s)).trim()).filter(Boolean);
    if (meta.processed && typeof meta.processed === "object"
      && typeof meta.processed.t0 === "number" && typeof meta.processed.t1 === "number") {
      metaLine.push(`처리 구간 ${fmt(meta.processed.t0)}–${fmt(meta.processed.t1)}`);
    }
    if (metaLine.length) out.push(metaLine.join(" · "));
    if (note.status === "partial") out.push("> 일부 내용이 빠진 노트입니다. 끝의 처리 고지를 보세요.");

    const globals = arr(note.global).filter(b => b && typeof b === "object");
    const pushGlobal = t => { for (const b of globals.filter(b => b.type === t)) out.push(...blockLines(b)); };
    pushGlobal("B02");
    pushGlobal("B03");
    for (const b of globals.filter(b => !["B02", "B03", "B13"].includes(b.type))) out.push(...blockLines(b));

    const quiz = [];
    for (const [i, s] of arr(note.sections).entries()) {
      if (!s || typeof s !== "object") continue;
      out.push(`## ${String(s.number ?? i + 1).padStart(2, "0")} ${rich(s.title)}`);
      if (str(s.question)) out.push(`*${rich(s.question)}*`);
      if (s.gist) out.push(claim(s.gist));
      for (const b of arr(s.blocks)) {
        if (b?.type === "B14") { quiz.push(...arr(b?.content?.items).filter(x => x && typeof x === "object")); continue; }
        out.push(...blockLines(b));
      }
      for (const chk of arr(s.checks)) {
        const main = claim(chk?.claim);
        if (!main && !(chk?.before && chk?.after)) continue;
        let line = `> [확인 필요] ${main}`.trimEnd();
        if (chk?.before && chk?.after) line += `\n> 정정: ${claim(chk.before)} → ${claim(chk.after)}`;
        out.push(line);
      }
    }
    pushGlobal("B13");

    if (quiz.length) {
      const inline = answers === "inline";
      out.push("## 자기 점검\n\n" + quiz.map((it, i) => questionMd(it, i + 1, inline)).filter(Boolean).join("\n\n"));
      if (!inline) out.push("## 정답과 해설\n\n" + quiz.map((it, i) => answerMd(it?.answer, i + 1)).join("\n\n"));
    }

    const noticeLines = arr(note.notices).map(noticeMd).filter(Boolean);
    if (noticeLines.length) out.push("## 처리 고지\n\n" + noticeLines.join("\n"));

    return out.filter(x => typeof x === "string" && x.trim()).join("\n\n");
  }

  const api = { toMarkdown };
  globalThis.NoteExport = api;
  if (typeof module !== "undefined") module.exports = api;
})();
