// Whole-session summaries. Evidence stays in the session; only structured notes reach the UI.
(() => {
  const encoder = new TextEncoder();
  // 서버가 근거 JSON 48000 바이트에서 413 을 준다(server/index.js). 그 천장까지 올려 호출 수를 줄인다 —
  // 호출마다 system 3.9KB + 스키마 3.0KB 가 통째로 다시 실리고, 청크가 적을수록 합성 트리도 얕아진다.
  // ponytail: 출력은 여전히 max_tokens 32768 이고 finish_reason=length 는 재시도 없이 죽는다.
  // 더 올리려면 긴 강의로 실측부터.
  const MAX_CHUNK_BYTES = 48000;
  // 인용되지 않은 근거가 이 비율을 넘게 남으면 요약이 무너진 것으로 보고 막는다. 그 아래는 경고로만 알린다.
  // ponytail: 0.5 는 관측 없이 잡은 출발점이다. notice 에 실리는 건수 분포를 보고 조정할 것.
  const MIN_COVERAGE = .5;
  const MODEL = "google/gemini-2.5-flash-lite";
  const LISTS = ["keyConclusions", "concepts", "corrections", "openQuestions"];
  const IMPORTANCE = new Set(["critical", "important", "reference"]);
  const byteLength = value => encoder.encode(value).byteLength;
  const aborted = signal => { if (signal?.aborted) throw new DOMException("요약을 취소했습니다.", "AbortError"); };
  const normalize = value => String(value || "").normalize("NFC").replace(/\s+/gu, " ").trim();
  const unique = values => [...new Set(values)];

  function preprocessEvidence(entries) {
    if (!Array.isArray(entries)) throw new Error("요약 근거 형식이 올바르지 않습니다.");
    const seen = new Set();
    const prepared = entries.map((entry, index) => ({ ...entry, _index: index })).sort((a, b) =>
      (Number(a.epoch) || 0) - (Number(b.epoch) || 0) || (Number(a.t0 ?? a.time) || 0) - (Number(b.t0 ?? b.time) || 0) || a._index - b._index
    ).map(({ _index, ...entry }) => {
      const text = normalize(entry.text);
      let selection = "included", selectionReason = "학습 근거로 보존";
      if (["superseded", "filtered"].includes(entry.status)) {
        selection = "filtered"; selectionReason = "교체되었거나 앞 단계에서 제외된 인식 결과";
      } else if (!text) {
        selection = "filtered"; selectionReason = "NFC·공백 정돈 후 내용이 없는 인식 결과";
      } else if (entry.status === "unresolved" || Number.isFinite(entry.confidence) && entry.confidence < .45) {
        selection = "uncertain"; selectionReason = "인식 신뢰도가 낮아 제외하지 않고 불확실성으로 보존";
      } else if (entry.source === "ocr") {
        const key = JSON.stringify([entry.epoch || 0, entry.slideId || null, entry.bbox || null, text]);
        if (seen.has(key)) { selection = "filtered"; selectionReason = "같은 슬라이드·위치의 완전 일치 OCR 중복"; }
        else seen.add(key);
      }
      return { ...entry, text, selection, selectionReason, relatedEvidenceIds: unique(Array.isArray(entry.relatedEvidenceIds) ? entry.relatedEvidenceIds.filter(id => typeof id === "string") : []) };
    });
    // 슬라이드가 한 줄씩 드러나면 "앞 내용 전부 + 새로 뜬 줄"이 매번 새 OCR 근거가 된다. 완전 일치
    // 중복만 걸러서는 하나도 안 접히고, 같은 슬라이드가 제곱으로 쌓여 요약 입력의 태반을 차지한다.
    // 뒤 인식 결과가 앞 것을 문자열로 통째로 품고 있으면 앞을 접는다 — 뒤가 상위집합이라 잃는 글자가 없다.
    // ponytail: 슬라이드마다 직전 20건만 본다. 점진 노출은 연속 프레임에서 생기고, slideId 가 없는
    // 캡처에서 한 묶음이 수백 건까지 늘어나면 전수 비교는 O(n²)로 번진다.
    const bySlide = new Map();
    for (const entry of prepared) {
      if (entry.source !== "ocr" || entry.selection === "filtered" || !entry.text) continue;
      const key = JSON.stringify([entry.epoch || 0, entry.slideId ?? null]);
      const group = bySlide.get(key) || [];
      for (const earlier of group.slice(-20)) {
        if (earlier.selection === "filtered" || !entry.text.includes(earlier.text)) continue;
        earlier.selection = "filtered"; earlier.selectionReason = "뒤 캡처에 그대로 포함된 부분 인식";
      }
      group.push(entry); bySlide.set(key, group);
    }
    const byText = new Map();
    for (const entry of prepared) {
      if (!entry.text || entry.selection === "filtered") continue;
      const source = entry.source === "audio" || entry.source === "asr" ? "asr" : "ocr";
      const start = Number(entry.t0 ?? entry.time) || 0, end = Number(entry.t1 ?? entry.t0 ?? entry.time) || 0;
      for (const other of byText.get(entry.text) || []) {
        if (source === other.source || Math.max(start, other.start) - Math.min(end, other.end) > 5 || typeof entry.id !== "string" || typeof other.entry.id !== "string") continue;
        entry.relatedEvidenceIds = unique([...entry.relatedEvidenceIds, other.entry.id]);
        other.entry.relatedEvidenceIds = unique([...other.entry.relatedEvidenceIds, entry.id]);
      }
      if (!byText.has(entry.text)) byText.set(entry.text, []);
      byText.get(entry.text).push({ entry, source, start, end });
    }
    return prepared;
  }

  function chunkEvidence(entries, maxBytes = MAX_CHUNK_BYTES) {
    if (!Number.isInteger(maxBytes) || maxBytes < 256) throw new Error("Invalid chunk budget");
    const chunks = [];
    let chunk = [], size = 0;
    for (const [index, entry] of entries.entries()) {
      if (["superseded", "filtered"].includes(entry.status) || entry.selection === "filtered" || !String(entry.text || "").trim()) continue;
      const id = String(entry.id || `e-${index}`);
      const item = {
        id, text: "", source: entry.source === "asr" ? "asr" : "ocr",
        t0: Number(entry.t0 ?? entry.time) || 0, t1: Number(entry.t1 ?? entry.t0 ?? entry.time) || 0,
        selection: entry.selection === "uncertain" ? "uncertain" : "included",
        // included 의 selectionReason 은 preprocessEvidence 가 늘 "학습 근거로 보존" 한 문장으로 덮어쓴다.
        // 근거마다 44바이트씩 실리는데 모델이 읽을 정보는 0이다. selection 만으로는 뜻이 안 통하는
        // uncertain 에서만 남긴다 — 프롬프트가 두 필드를 따로 설명하지 않으므로 이 문장이 유일한 설명이다.
        // 화면·보관용 근거 목록(generate 의 evidenceRefs)은 양쪽 다 그대로 들고 있다.
        ...(entry.selection === "uncertain" ? { selectionReason: String(entry.selectionReason || "인식 신뢰도가 낮아 제외하지 않고 불확실성으로 보존").slice(0, 300) } : {}),
      };
      const overhead = byteLength(JSON.stringify(item)) + 4;
      if (overhead >= maxBytes) throw new Error("근거 식별자가 너무 깁니다.");
      let piece = "", pieceBytes = overhead;
      const add = () => {
        if (!piece) return;
        if (size + pieceBytes > maxBytes && chunk.length) { chunks.push(chunk); chunk = []; size = 0; }
        chunk.push({ ...item, text: piece }); size += pieceBytes; piece = ""; pieceBytes = overhead;
      };
      // 한 항목이 예산을 통째로 넘는 일은 드물다. 그때만 글자 단위로 쪼갠다 — 근거 전량을 글자마다
      // JSON.stringify + TextEncoder 로 재면 근거 246KB 에 45ms, 문자열째로 재면 4ms(실측).
      // 문자열 전체의 JSON 길이는 글자별 길이의 합과 정확히 같으므로(각 글자가 독립적으로 이스케이프된다)
      // 두 경로의 경계 판정은 어긋나지 않는다.
      const text = String(entry.text), textBytes = byteLength(JSON.stringify(text)) - 2;
      if (overhead + textBytes <= maxBytes) { piece = text; pieceBytes = overhead + textBytes; add(); continue; }
      for (const char of text) {
        const next = byteLength(JSON.stringify(char)) - 2;
        if (pieceBytes + next > maxBytes) add();
        piece += char; pieceBytes += next;
      }
      add();
    }
    if (chunk.length) chunks.push(chunk);
    return chunks;
  }

  // 모델이 지어낸 근거 id 는 걸러내고 남은 것만 쓴다. 하나도 안 남으면 null 을 주고, 호출부가 그 항목만 버린다.
  // 예전엔 여기서 throw 해서 corrections 한 줄 때문에 청크 요약 전체가 죽었다. 정정 한 줄을 잃는 편이 노트 전체를 잃는 것보다 낫다.
  // 정상 id 까지 같이 버리면 아래 커버리지 검사가 되살아나므로, 항목을 통째로 버리는 건 정말 남는 게 없을 때뿐이다.
  function citations(value, ids) {
    const kept = Array.isArray(value) ? unique(value.filter(id => typeof id === "string" && ids.has(id))) : [];
    return kept.length ? kept : null;
  }

  function item(value, ids, label) {
    if (!value || typeof value.content !== "string" || !value.content.trim() || value.content.length > 6000 || !IMPORTANCE.has(value.importance)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
    const evidenceIds = citations(value.evidenceIds, ids);
    // detail 은 keyConclusions 만 싣는 보충 설명이다. 없거나 길이가 상한을 넘으면 결론만 남긴다 —
    // 설명 한 문단 때문에 노트 전체를 버릴 이유가 없다.
    const detail = typeof value.detail === "string" && value.detail.trim() && value.detail.length <= 6000 ? { detail: value.detail } : null;
    return evidenceIds && { content: value.content, ...detail, importance: value.importance, evidenceIds };
  }

  function validateSummary(value, entries, { requireCoverage = true, maxItems = 100, maxSections = 80, maxQuestions = 30 } = {}) {
    if (!value || typeof value.title !== "string" || value.title.length > 200 || !Array.isArray(value.sections) || !Array.isArray(value.formulas) || !Array.isArray(value.visuals) || !Array.isArray(value.reviewQuestions)) throw new Error("요약 형식이 올바르지 않습니다.");
    const ids = new Set(entries.map((e, i) => String(e.id || `e-${i}`)));
    const out = { title: value.title };
    // 버린 항목은 조용히 사라지면 안 된다 — 특히 corrections 는 빠지면 틀린 원래 설명만 노트에 남는다.
    // 여기서 센 수를 generate() 가 구간마다 합쳐 notice 로 드러낸다.
    let dropped = 0;
    const keep = list => { const kept = list.filter(Boolean); dropped += list.length - kept.length; return kept; };
    for (const field of LISTS) {
      if (!Array.isArray(value[field]) || value[field].length > maxItems) throw new Error(`${field} 형식이 올바르지 않습니다.`);
      out[field] = keep(value[field].map(v => item(v, ids, field)));
    }
    if (!out.keyConclusions.length) throw new Error("핵심 결론이 없는 요약입니다.");
    if (value.sections.length > maxSections) throw new Error("요약 결과가 허용된 크기를 초과했습니다.");
    out.sections = keep(value.sections.map(section => {
      if (!section || typeof section.heading !== "string" || !section.heading.trim() || section.heading.length > 200 || typeof section.content !== "string" || !section.content.trim() || section.content.length > 6000 || !IMPORTANCE.has(section.importance)) throw new Error("요약 항목 형식이 올바르지 않습니다.");
      const evidenceIds = citations(section.evidenceIds, ids);
      return evidenceIds && { heading: section.heading, content: section.content, importance: section.importance, evidenceIds };
    }));
    if (!out.sections.length) throw new Error("AI가 빈 요약을 반환했습니다.");
    if (value.formulas.length > maxItems) throw new Error("수식 결과가 허용된 크기를 초과했습니다.");
    out.formulas = keep(value.formulas.map(formula => {
      if (!formula || typeof formula.latex !== "string" || formula.latex.length > 2000 || typeof formula.variables !== "string" || formula.variables.length > 4000 || typeof formula.units !== "string" || formula.units.length > 1000 || typeof formula.conditions !== "string" || formula.conditions.length > 3000 || typeof formula.explanation !== "string" || formula.explanation.length > 4000 || !IMPORTANCE.has(formula.importance)) throw new Error("수식 형식이 올바르지 않습니다.");
      const evidenceIds = citations(formula.evidenceIds, ids);
      return evidenceIds && { latex: formula.latex, variables: formula.variables, units: formula.units, conditions: formula.conditions, explanation: formula.explanation, importance: formula.importance, evidenceIds };
    }));
    if (value.visuals.length > maxItems) throw new Error("시각 자료 결과가 허용된 크기를 초과했습니다.");
    out.visuals = keep(value.visuals.map(visual => {
      if (!visual || !["table", "relationship", "chart"].includes(visual.type) || typeof visual.title !== "string" || visual.title.length > 200 || typeof visual.description !== "string" || visual.description.length > 4000 || typeof visual.data !== "string" || visual.data.length > 12000 || !IMPORTANCE.has(visual.importance)) throw new Error("시각 자료 형식이 올바르지 않습니다.");
      const evidenceIds = citations(visual.evidenceIds, ids);
      return evidenceIds && { type: visual.type, title: visual.title, description: visual.description, data: visual.data, importance: visual.importance, evidenceIds };
    }));
    if (value.reviewQuestions.length > maxQuestions) throw new Error("복습 질문 결과가 허용된 크기를 초과했습니다.");
    out.reviewQuestions = keep(value.reviewQuestions.map(question => {
      if (!question || typeof question.question !== "string" || !question.question.trim() || question.question.length > 1000) throw new Error("복습 질문 형식이 올바르지 않습니다.");
      const evidenceIds = citations(question.evidenceIds, ids);
      return evidenceIds && { question: question.question, evidenceIds };
    }));
    // 최상위 evidenceIds 는 항목들의 합집합으로 파생한다. 모델에게 전체 id 목록을 다시 받아쓰게 하면
    // 몇 개를 빼먹고 멀쩡한 요약이 통째로 버려졌다 — 스키마가 강제하지 못하고 프롬프트 한 줄로만 걸던
    // 순수 받아쓰기 요구였다.
    //
    // 남은 요구("모든 id 가 어딘가에 인용된다")도 한 청크에 근거가 16~180개씩 들어가므로 여전히 무리다.
    // 페이지 번호나 반복 머리글처럼 인용할 가치가 없는 줄이 반드시 섞이고, 프롬프트는 정밀 인용(20행)과
    // 전수 인용(31행)을 동시에 요구해 서로 당긴다. 그래서 소수가 빠지면 notice 로 드러내고, 인용률이
    // 무너질 때만 막는다 — 이 저장소가 끊긴 구간을 다루는 방식과 같다.
    const cited = new Set();
    for (const field of [...LISTS, "sections", "formulas", "visuals", "reviewQuestions"]) for (const v of out[field]) for (const id of v.evidenceIds) cited.add(id);
    out.evidenceIds = [...cited];
    out.dropped = dropped;
    out.uncited = entries.filter(entry => !cited.has(String(entry.id))).map(entry => ({ id: String(entry.id), t0: entry.t0 ?? entry.time ?? 0, t1: entry.t1 ?? entry.t0 ?? entry.time ?? 0 }));
    if (requireCoverage && ids.size && cited.size / ids.size < MIN_COVERAGE) throw new Error("요약에서 처리되지 않은 근거가 있습니다.");
    const output = JSON.stringify(out).replace(/\s+/gu, " ");
    for (const entry of entries) {
      if (/^(?:chapter|synthesis)-/.test(String(entry.id))) continue;
      const source = String(entry.text).replace(/\s+/gu, " ");
      for (let i = 0; i + 180 <= source.length; i += 60) if (output.includes(source.slice(i, i + 180))) throw new Error("원문이 길게 재현된 결과를 차단했습니다. 요약을 다시 시도하세요.");
    }
    return out;
  }

  async function requestId(sessionId, stage, entries) {
    const c = globalThis.crypto || (typeof require === "function" && require("node:crypto").webcrypto);
    const digest = await c.subtle.digest("SHA-256", encoder.encode(JSON.stringify(entries)));
    const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("").slice(0, 32);
    return `${String(sessionId || "session").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}-${stage}-${hash}`;
  }

  const preprocessing = entries => ({
    counts: Object.fromEntries(["included", "filtered", "uncertain"].map(key => [key, entries.filter(e => e.selection === key).length])),
    decisions: entries.map(e => ({ id: e.id, selection: e.selection, selectionReason: e.selectionReason, relatedEvidenceIds: e.relatedEvidenceIds || [] })),
  });

  // 캡처가 끊긴 구간. 근거 배열만 보면 "말 없이 슬라이드만 떠 있던 5분"과 "5분이
  // 통째로 날아간 것"이 똑같이 생겼다. 그 둘을 구분해 주는 유일한 정보다.
  const GAP_LABEL = {
    "user-paused": "사용자 일시정지", "audio-capacity": "음성 인식 밀림", "visual-capacity": "화면 인식 밀림",
    "video-offscreen": "영상이 화면 밖", "asr-failed": "음성 인식 실패", "ocr-failed": "화면 인식 실패",
    "audio-unavailable": "오디오 입력 없음",
  };
  const MAX_NOTICE_RANGES = 8;
  const clock = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  // 같은 이유가 연달아 찍힌 것은 한 구간이다. gap 은 시각 하나만 기록하므로 없는
  // 구간을 지어내지 않도록 실제로 찍힌 첫 시각과 마지막 시각만 쓴다.
  function gapRanges(gaps) {
    const out = [];
    for (const gap of gaps || []) {
      if (!gap || !Number.isFinite(gap.time)) continue;
      const last = out.at(-1);
      if (last && last.reason === gap.reason) last.t1 = Math.max(last.t1, gap.time);
      else out.push({ reason: String(gap.reason || "unknown"), t0: gap.time, t1: gap.time });
    }
    return out;
  }

  function gapNotice(ranges) {
    if (!ranges.length) return "";
    const shown = ranges.slice(0, MAX_NOTICE_RANGES).map(range =>
      `${clock(range.t0)}${range.t1 > range.t0 ? `~${clock(range.t1)}` : ""} ${GAP_LABEL[range.reason] || range.reason}`);
    const rest = ranges.length - shown.length;
    return `> ⚠ 기록이 끊긴 구간이 있어 이 노트는 강의 전체를 담지 못합니다 — ${shown.join(", ")}${rest > 0 ? ` 외 ${rest}건` : ""}`;
  }

  // gapNotice 와 같은 모양으로, 근거가 어긋나 노트에서 뺀 항목을 드러낸다.
  function droppedNotice(count) {
    if (!count) return "";
    return `> ⚠ 근거를 확인할 수 없어 노트에서 뺀 항목이 ${count}건 있습니다 — 정정이나 보충 설명이 빠졌을 수 있습니다.`;
  }

  // 노트가 끝내 다루지 못한 근거를 시각 구간으로 알린다. gapNotice 와 같은 모양.
  function uncitedNotice(items) {
    if (!items.length) return "";
    const shown = items.slice(0, MAX_NOTICE_RANGES).map(item => `${clock(item.t0)}${item.t1 > item.t0 ? `~${clock(item.t1)}` : ""}`);
    const rest = items.length - shown.length;
    return `> ⚠ 노트가 다루지 못한 근거가 ${items.length}건 있습니다 — ${shown.join(", ")}${rest > 0 ? ` 외 ${rest}건` : ""}`;
  }

  function recognitionResult(entries) {
    return {
      title: "인식 완료 · AI 요약 연결 필요", status: "recognition-only", sections: [], reviewQuestions: [],
      message: "읽은 자료는 현재 세션에 보관돼 있습니다. OpenRouter API 키 또는 보관 서비스 URL·앱 세션 토큰을 연결한 뒤 요약할 수 있습니다. 원문은 표시하거나 내보내지 않습니다.",
      coverage: { total: 0, completed: 0, failed: 0, synthesis: false }, evidenceCount: entries.length, preprocessing: preprocessing(entries),
    };
  }

  const summaryIds = value => unique(value.evidenceIds || []);
  // 합성 단계에 실어 보내는 건 노트 본문뿐이다. uncited·dropped 는 우리 쪽 계량이고 evidenceIds 는
  // 항목별 id 의 합집합이라 모델에게는 정보가 0인데, 커버리지 하한이 .5 라 uncited 만 노트당 몇 KB 씩
  // 붙는다. 객체에는 남겨 둔다 — summaryIds 와 경고 집계가 그대로 쓴다.
  const noteText = ({ uncited, dropped, evidenceIds, ...note }) => JSON.stringify(note);
  function remapSummary(value, mapping) {
    const remap = ids => unique(ids.flatMap(id => mapping[id] || []));
    const out = { ...value, evidenceIds: remap(value.evidenceIds) };
    for (const field of LISTS) out[field] = value[field].map(v => ({ ...v, evidenceIds: remap(v.evidenceIds) }));
    out.sections = value.sections.map(v => ({ ...v, evidenceIds: remap(v.evidenceIds) }));
    out.formulas = value.formulas.map(v => ({ ...v, evidenceIds: remap(v.evidenceIds) }));
    out.visuals = value.visuals.map(v => ({ ...v, evidenceIds: remap(v.evidenceIds) }));
    out.reviewQuestions = value.reviewQuestions.map(v => ({ ...v, evidenceIds: remap(v.evidenceIds) }));
    return out;
  }

  function partialResult(completed, chunks) {
    const total = chunks.length;
    const out = { title: completed[0]?.title || "일부 구간 요약", status: "partial" };
    for (const field of LISTS) out[field] = completed.flatMap(part => part[field] || []);
    out.sections = completed.flatMap((part, i) => part.sections.map(section => ({ ...section, heading: total > 1 ? `${i + 1}구간 · ${section.heading}` : section.heading })));
    out.formulas = completed.flatMap(part => part.formulas || []); out.visuals = completed.flatMap(part => part.visuals || []); out.reviewQuestions = completed.flatMap(part => part.reviewQuestions || []);
    out.evidenceIds = unique(completed.flatMap(summaryIds));
    out.coverage = {
      total, completed: completed.length, failed: total - completed.length, synthesis: false,
      unprocessed: chunks.slice(completed.length).map((chunk, index) => ({ chunk: completed.length + index + 1, evidenceIds: unique(chunk.map(entry => entry.id)) })),
    };
    return out;
  }

  async function generate(entries, { sessionId, signal, onProgress = () => {}, settings = {}, service = globalThis.ServiceClient, cache = new Map(), attempt = 0, gaps = [] } = {}) {
    aborted(signal);
    if (!Array.isArray(entries) || !entries.some(e => String(e.text || "").trim())) throw new Error("요약할 인식 자료가 없습니다.");
    const prepared = preprocessEvidence(entries), prep = preprocessing(prepared), token = settings.appSessionToken, openRouterApiKey = settings.openRouterApiKey;
    const ranges = gapRanges(gaps), notice = gapNotice(ranges);
    if (!openRouterApiKey && (!settings.serviceUrl || !token)) return { ...recognitionResult(prepared), notice };
    if (!settings.remoteSummaryConsent) throw new Error("외부 AI 요약의 텍스트 처리 안내를 확인해 주세요.");
    if (!service?.summary) throw new Error("요약 서비스 모듈을 불러오지 못했습니다.");
    const chunks = chunkEvidence(prepared);
    if (!chunks.length) throw new Error("요약할 근거가 모두 제외되었습니다.");
    const completed = [], usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
    // 청크·합성 전 단계에서 버린 항목을 합친다. 마지막 합성 호출의 수만 보면 앞 구간의 손실이 통째로 가려진다.
    let droppedItems = 0;
    // 인용되지 않은 근거도 구간마다 모은다. 합성 단계의 chapter-N 은 통째로 빠진 장(章)을 뜻하므로 같이 센다.
    const uncitedAll = [];
    const refs = prepared.map((e, i) => ({ id: String(e.id || `e-${i}`), t0: e.t0 ?? e.time ?? 0, t1: e.t1 ?? e.t0 ?? e.time ?? 0, source: e.source, selection: e.selection, selectionReason: e.selectionReason, relatedEvidenceIds: e.relatedEvidenceIds || [] }));
    // 구간을 동시에 보내면 uncitedAll 이 도착 순으로 쌓인다. 경고는 앞 8건만 보여주므로 시각 순으로 세운다.
    const notices = () => [notice, droppedNotice(droppedItems), uncitedNotice(uncitedAll.sort((a, b) => (a.t0 || 0) - (b.t0 || 0)))].filter(Boolean).join("\n");
    const call = async (chunk, stage) => {
      aborted(signal);
      const model = settings.summaryModel || MODEL;
      const cacheId = await requestId(sessionId, stage, { model, chunk });
      if (cache.has(cacheId)) return cache.get(cacheId);
      const response = await service.summary({ apiKey: openRouterApiKey, baseUrl: settings.serviceUrl, token, model, evidence: chunk, gaps: ranges, requestId: await requestId(sessionId, stage, { model, chunk, attempt }), stage, signal, timeoutMs: 120000 });
      aborted(signal);
      const u = response.usage || {};
      usage.promptTokens += Number(u.promptTokens ?? u.prompt_tokens) || 0; usage.completionTokens += Number(u.completionTokens ?? u.completion_tokens) || 0; usage.costUsd += Number(u.costUsd ?? u.cost) || 0;
      const checked = validateSummary(response.summary, chunk);
      droppedItems += checked.dropped || 0;
      uncitedAll.push(...(checked.uncited || []));
      cache.set(cacheId, checked); return checked;
    };
    try {
      // 청크끼리는 의존이 없는데 예전엔 한 건씩 기다렸다 — 벽시계 시간의 거의 전부가 여기였다.
      // 서비스 경로는 계정당 동시 요청을 잠그므로(server/index.js 의 locks) BYOK 일 때만 동시에 보낸다.
      // partialResult 은 앞에서부터 이어진 구간만 쓸 수 있으므로 결과는 색인 자리에 담고, 끊긴 뒤는 버린다.
      // ponytail: 4 는 관측 없이 잡은 값이다. 429 가 보이면 내릴 것.
      const lanes = Math.min(openRouterApiKey ? 4 : 1, chunks.length);
      const results = new Array(chunks.length);
      let cursor = 0, finished = 0, failure = null;
      const lane = async () => {
        while (!failure) {
          const i = cursor++;
          if (i >= chunks.length) return;
          try { results[i] = await call(chunks[i], "chunk"); }
          catch (error) { failure ??= error; return; }
          onProgress(`전체 ${chunks.length}구간 중 ${++finished}구간 요약 완료`);
        }
      };
      await Promise.all(Array.from({ length: lanes }, lane));
      for (const note of results) { if (!note) break; completed.push(note); }
      if (failure) throw failure;
      let final = completed[0];
      if (completed.length > 1) {
        let nodes = completed.map((note, i) => ({ id: `chapter-${i + 1}`, text: noteText(note), source: "ocr", t0: chunks[i][0].t0, t1: chunks[i].at(-1).t1, originalIds: summaryIds(note) }));
        for (let depth = 1; nodes.length > 1 && depth <= 12; depth++) {
          const batches = chunkEvidence(nodes, MAX_CHUNK_BYTES), next = [];
          onProgress(`전체 학습 노트 합성 ${depth}단계 · ${batches.length}묶음`);
          for (const [i, batch] of batches.entries()) {
            const mapping = Object.fromEntries(nodes.map(node => [node.id, node.originalIds]));
            const note = remapSummary(await call(batch, "synthesis"), mapping);
            next.push({ id: `synthesis-${depth}-${i + 1}`, text: noteText(note), source: "ocr", t0: batch[0].t0, t1: batch.at(-1).t1, originalIds: summaryIds(note), note });
          }
          nodes = next; final = nodes[0].note;
        }
        if (nodes.length > 1) throw new Error("전체 합성 단계가 안전 상한을 초과했습니다.");
      }
      final = { ...final, notice: notices(), dropped: droppedItems, uncited: uncitedAll, status: "complete", coverage: { total: chunks.length, completed: chunks.length, failed: 0, synthesis: true }, evidenceRefs: refs, preprocessing: prep, usage: { ...usage } };
      onProgress("전체 학습 노트 합성 완료"); return final;
    } catch (error) {
      error.partial = { ...partialResult(completed, chunks), notice: notices(), dropped: droppedItems, uncited: uncitedAll, evidenceRefs: refs, preprocessing: prep, usage: { ...usage } };
      throw error;
    }
  }
  const api = { gapRanges, gapNotice, droppedNotice, uncitedNotice, chunkEvidence, preprocessEvidence, validateSummary, generate, recognitionResult, requestId, remapSummary, LISTS };
  if (typeof module !== "undefined") module.exports = api;
  globalThis.SummaryPipeline = api;
})();
