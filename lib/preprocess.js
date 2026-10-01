// 인식 결과를 요약 입력(IR)으로 접는 순수 함수들. 숫자·단위·기호·부정(안/못/않)은
// 데이터라 어느 단계에서도 건드리지 않는다 — 필러가 남는 쪽이 틀린 수치보다 낫다.
(() => {
  const collapseRepeats = globalThis.collapseRepeats || (typeof require !== "undefined" ? require("./repeats.js").collapseRepeats : null);
  const norm = s => String(s || "").normalize("NFC").replace(/\s+/g, " ").trim();
  const segEnd = s => Number.isFinite(s.t1) ? s.t1 : s.t0;
  const keptSeg = s => s && (s.status == null || s.status === "kept");
  const segsOf = g => (g.segments || []).filter(keptSeg);

  // 단독으로 선 간투사만 지운다 — "어제"·"음식"처럼 단어 속 음절은 손대지 않는다.
  const FILLER = /^(?:어어|음음|어|음|아|에|으)(?:,|…|\.\.\.)?$/;
  // 바로 겹친 짧은 낱말은 버벅임("그 그"→"그"). 한글 2자까지로 한정해 영어·숫자·기호를 뺀다.
  const SHORT = /^[가-힣]{1,2}$/;

  function cleanSpeech(text) {
    const s = norm(text);
    if (!s) return "";
    const out = [];
    for (const tok of s.split(" ")) {
      if (FILLER.test(tok)) continue;
      if (out.length && out[out.length - 1] === tok && SHORT.test(tok)) continue;
      out.push(tok);
    }
    return (collapseRepeats ? collapseRepeats(out.join(" ")).text : out.join(" ")).trim();
  }

  const usable = b => b && b.selection !== "filtered" && norm(b.text);
  // 읽기 순서는 "시각적 행" 단위다 — 표 셀처럼 y 가 미세하게 흔들리는 블록은 같은 행으로
  // 묶어 x 로 정렬한다. bbox 가 없는 블록은 순서를 알 수 없으므로 뒤에 입력 순서로 붙인다.
  const validBox = b => b.bbox && Number.isFinite(b.bbox.x) && Number.isFinite(b.bbox.y);
  const cy = b => b.bbox.y + (b.bbox.h > 0 ? b.bbox.h / 2 : 0);
  const hh = b => (b.bbox.h > 0 ? b.bbox.h : 0.02);
  function byReading(list) {
    const pos = list.filter(validBox).sort((a, z) => cy(a) - cy(z) || a.bbox.x - z.bbox.x);
    const rows = [];
    for (const b of pos) {
      const r = rows[rows.length - 1];
      if (r && Math.abs(cy(b) - cy(r[0])) <= Math.min(hh(b), hh(r[0])) / 2) r.push(b);
      else rows.push([b]);
    }
    return rows.flatMap(r => r.sort((a, z) => a.bbox.x - z.bbox.x)).concat(list.filter(b => !validBox(b)));
  }

  function slideText(slide) {
    const ok = (slide && slide.blocks || []).filter(usable);
    return byReading(ok.filter(b => b.role === "title"))
      .concat(byReading(ok.filter(b => b.role !== "title")))
      .map(b => norm(b.text)).join("\n");
  }

  const linesOf = slide => slideText(slide).split("\n").map(norm).filter(Boolean);

  // 점진 판서는 매 캡처가 "앞 내용 + 새 줄"이라 슬라이드가 제곱으로 쌓인다.
  // 앞 슬라이드 줄이 다음 것에 share ≥ containment 만큼 품해 있으면 앞은 덧칠이다 —
  // 내용은 뒤 것을 쓰고 시작 시각(t0)과 경로(mergedFrom)만 앞 것에서 물려받는다.
  // 수식·도표는 텍스트에 안 남아 덧칠로 잡히지 않으므로 id 기준 합집합으로 보존한다.
  const unionById = (a = [], b = []) => {
    const ids = new Set(b.map(f => f && f.id));
    return [...a.filter(f => !f || f.id == null || !ids.has(f.id)), ...b];
  };
  function mergeProgressive(slides, { containment = 0.9 } = {}) {
    const out = [];
    for (const slide of slides || []) {
      const last = out[out.length - 1], a = last ? linesOf(last) : [];
      const b = new Set(linesOf(slide));
      if (last && a.length && a.filter(line => b.has(line)).length / a.length >= containment) {
        out[out.length - 1] = {
          ...slide, t0: last.t0,
          mergedFrom: [...(last.mergedFrom || []), last.slideId],
          formulas: unionById(last.formulas, slide.formulas),
          figures: unionById(last.figures, slide.figures),
        };
      } else out.push(slide);
    }
    return out;
  }

  // 발화는 말한 중간 시각에 떠 있던 슬라이드로 보낸다. 첫 슬라이드보다 앞 발화는
  // slide null 선행 그룹, 슬라이드가 아예 없으면 120초 창으로만 자른다.
  function alignSpeech(slides, segments) {
    const list = (segments || []).filter(keptSeg), ordered = slides || [];
    if (!ordered.length) {
      const windows = new Map();
      for (const s of list) {
        const k = Math.floor((s.t0 || 0) / 120);
        let g = windows.get(k);
        if (!g) windows.set(k, g = { slide: null, segments: [], t0: s.t0, t1: segEnd(s) });
        g.segments.push(s);
        g.t0 = Math.min(g.t0, s.t0); g.t1 = Math.max(g.t1, segEnd(s));
      }
      return [...windows.values()].sort((a, z) => a.t0 - z.t0);
    }
    const groups = ordered.map(slide => ({ slide, segments: [], t0: slide.t0, t1: slide.t0 }));
    const leading = { slide: null, segments: [], t0: Infinity, t1: -Infinity };
    for (const s of list) {
      const mid = (s.t0 + segEnd(s)) / 2;
      let idx = -1;
      while (idx + 1 < ordered.length && ordered[idx + 1].t0 <= mid) idx++;
      const g = idx < 0 ? leading : groups[idx];
      g.segments.push(s);
      g.t0 = Math.min(g.t0, s.t0); g.t1 = Math.max(g.t1, segEnd(s));
    }
    for (let i = 0; i + 1 < groups.length; i++) groups[i].t1 = Math.max(groups[i].t1, ordered[i + 1].t0);
    return leading.segments.length ? [leading, ...groups] : groups;
  }

  const EMPHASIS = ["중요", "시험", "꼭", "반드시", "핵심", "기억"];
  // 지시어는 하나의 정규식으로 센다 — "이 그래프를 보면"이 "이 그래프"+"그래프를 보면"으로
  // 두 번 세지는 걸 막고, "이 표현"처럼 뒤가 조사 아닌 한글인 오탐은 조사 목록으로 걸러낸다.
  const DEIXIS = /이 (?:그래프|표|그림)(?:(?![가-힣])|(?=[를을은는이가에서의도로와과만]))|여기 보면|보시면|(?:그래프|표)를 보면/g;
  const count = (text, words) => words.reduce((n, w) => n + text.split(w).length - 1, 0);
  // Whisper 루프는 세그먼트 안에서 생긴다 — 붙여서 접으면 같은 그룹의 숫자 하나가
  // repeats.js 의 보호 스위치를 눌러 전체 접기를 꺼버린다. 세그먼트별로 접는다.
  const speechOf = g => segsOf(g).map(s => cleanSpeech(s.text)).filter(Boolean).join(" ");
  const titleOf = slide => slide ? norm(byReading((slide.blocks || []).filter(b => usable(b) && b.role === "title")).map(b => b.text).join(" ")) : "";

  // context 는 alignSpeech 가 만든 전체 그룹 배열 — repeat 은 다른 그룹과 제목이 겹치는 수다.
  function features(group, context = []) {
    const groups = Array.isArray(context) ? context : [];
    const segs = segsOf(group), slide = group.slide || null, speech = speechOf(group);
    const start = Number.isFinite(group.t0) ? group.t0 : (slide?.t0 ?? segs[0]?.t0 ?? 0);
    let end = group.t1;
    if (!Number.isFinite(end)) {
      const i = groups.indexOf(group), next = i >= 0 ? groups[i + 1] : null;
      end = Number.isFinite(next?.slide?.t0) ? next.slide.t0 : (segs.length ? Math.max(...segs.map(segEnd)) : start);
    }
    const title = titleOf(slide);
    return {
      dwell: Math.max(0, end - start),
      speechChars: speech.length,
      emphasis: count(speech, EMPHASIS),
      deixis: (speech.match(DEIXIS) || []).length,
      repeat: title ? groups.filter(g => g !== group && titleOf(g.slide) === title).length : 0,
      hasFormula: !!slide?.formulas?.length,
      hasFigure: !!slide?.figures?.length,
    };
  }

  function buildIR(slides, segments, { containment = 0.9 } = {}) {
    const groups = alignSpeech(mergeProgressive(slides, { containment }), segments);
    let rawChars = 0;
    for (const s of slides || []) for (const b of s.blocks || []) if (b && b.selection !== "filtered") rawChars += String(b.text || "").length;
    for (const s of segments || []) if (keptSeg(s)) rawChars += String(s.text || "").length;
    const units = groups.map((g, i) => ({
      schemaVersion: 1,
      unitId: "U" + (i + 1),
      slideId: g.slide && g.slide.slideId != null ? String(g.slide.slideId) : null,
      t0: g.t0,
      t1: g.t1,
      slideText: g.slide ? slideText(g.slide) : "",
      speech: speechOf(g),
      features: features(g, groups),
      judge: { importance: null, lectureProb: null },
    }));
    const irChars = units.reduce((n, u) => n + u.slideText.length + u.speech.length, 0);
    return { schemaVersion: 1, units, stats: { rawChars, irChars, ratio: rawChars ? irChars / rawChars : 0 } };
  }

  const api = { cleanSpeech, slideText, mergeProgressive, alignSpeech, features, buildIR };
  globalThis.Preprocess = api;
  if (typeof module !== "undefined") module.exports = api;
})();
