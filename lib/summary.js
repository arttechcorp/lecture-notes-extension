// Whole-session summaries. Evidence stays in the session; only structured notes reach the UI.
(() => {
  const encoder = new TextEncoder();
  const MAX_CHUNK_BYTES = 12000;
  const MODEL = "google/gemini-2.5-flash-lite";
  const byteLength = (value) => encoder.encode(value).byteLength;
  const aborted = (signal) => { if (signal?.aborted) throw new DOMException("요약을 취소했습니다.", "AbortError"); };

  function chunkEvidence(entries, maxBytes = MAX_CHUNK_BYTES) {
    if (!Number.isInteger(maxBytes) || maxBytes < 256) throw new Error("Invalid chunk budget");
    const chunks = [];
    let chunk = [], size = 0;
    for (const [index, entry] of entries.entries()) {
      if (entry.status === "superseded" || !String(entry.text || "").trim()) continue;
      const id = String(entry.id || `e-${index}`);
      const item = { id, text: "", source: entry.source === "asr" ? "asr" : "ocr", t0: Number(entry.t0 ?? entry.time) || 0, t1: Number(entry.t1 ?? entry.t0 ?? entry.time) || 0 };
      // Split only between Unicode code points. Every non-superseded character is assigned.
      const overhead = byteLength(JSON.stringify(item)) + 4;
      if (overhead >= maxBytes) throw new Error("근거 식별자가 너무 깁니다.");
      let piece = "", pieceBytes = overhead;
      const add = () => {
        if (!piece) return;
        if (size + pieceBytes > maxBytes && chunk.length) { chunks.push(chunk); chunk = []; size = 0; }
        chunk.push({ ...item, text: piece }); size += pieceBytes; piece = ""; pieceBytes = overhead;
      };
      for (const char of String(entry.text)) {
        const next = byteLength(JSON.stringify(char)) - 2;
        if (pieceBytes + next > maxBytes) add();
        piece += char; pieceBytes += next;
      }
      add();
    }
    if (chunk.length) chunks.push(chunk);
    return chunks;
  }

  function validateSummary(value, entries) {
    if (!value || typeof value.title !== "string" || !Array.isArray(value.sections) || !Array.isArray(value.questions)) throw new Error("요약 형식이 올바르지 않습니다.");
    if (value.title.length > 200 || value.sections.length > 80 || value.questions.length > 30) throw new Error("요약 결과가 허용된 크기를 초과했습니다.");
    const ids = new Set(entries.map(e => e.id));
    const sections = value.sections.map(section => {
      if (typeof section.heading !== "string" || typeof section.content !== "string" || !Array.isArray(section.evidenceIds)) throw new Error("요약 항목 형식이 올바르지 않습니다.");
      if (section.heading.length > 200 || section.content.length > 6000 || !section.content.trim()) throw new Error("요약 항목의 길이가 올바르지 않습니다.");
      if (!section.evidenceIds.length || section.evidenceIds.some(id => typeof id !== "string" || !ids.has(id))) throw new Error("요약의 근거를 확인할 수 없습니다.");
      return { heading: section.heading, content: section.content, evidenceIds: [...new Set(section.evidenceIds)] };
    });
    if (!sections.length) throw new Error("AI가 빈 요약을 반환했습니다.");
    if (value.questions.some(q => typeof q !== "string" || q.length > 1000)) throw new Error("복습 질문 형식이 올바르지 않습니다.");
    // A conservative leak check, not a proof of copyright compliance. Short concepts remain usable.
    const output = [value.title, ...sections.flatMap(s => [s.heading, s.content]), ...value.questions].join(" ").replace(/\s+/gu, " ");
    for (const entry of entries) {
      const source = String(entry.text).replace(/\s+/gu, " ");
      for (let i = 0; i + 180 <= source.length; i += 60) {
        if (output.includes(source.slice(i, i + 180))) throw new Error("원문이 길게 재현된 결과를 차단했습니다. 요약을 다시 시도하세요.");
      }
    }
    return { title: value.title, sections, questions: value.questions };
  }

  async function requestId(sessionId, stage, entries) {
    const c = globalThis.crypto || (typeof require === "function" && require("node:crypto").webcrypto);
    const digest = await c.subtle.digest("SHA-256", encoder.encode(JSON.stringify(entries)));
    const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("").slice(0, 32);
    return `${String(sessionId || "session").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}-${stage}-${hash}`;
  }

  function recognitionResult(entries) {
    return {
      title: "인식 완료 · AI 요약 연결 필요", status: "recognition-only", sections: [], questions: [],
      message: "읽은 자료는 현재 세션에 보관돼 있습니다. 서비스 연결 후 요약할 수 있습니다. 원문은 표시하거나 내보내지 않습니다.",
      coverage: { total: 0, completed: 0, failed: 0 },
      evidenceCount: entries.length,
    };
  }

  async function generate(entries, { sessionId, signal, onProgress = () => {}, settings = {}, service = globalThis.ServiceClient, cache = new Map(), attempt = 0 } = {}) {
    aborted(signal);
    if (!Array.isArray(entries) || !entries.some(e => String(e.text || "").trim())) throw new Error("요약할 인식 자료가 없습니다.");
    const token = settings.appSessionToken;
    if (!settings.serviceUrl || !token) return recognitionResult(entries);
    if (!settings.remoteSummaryConsent) throw new Error("외부 AI 요약의 텍스트 처리 안내를 확인해 주세요.");
    if (!service?.summary) throw new Error("요약 서비스 모듈을 불러오지 못했습니다.");
    const chunks = chunkEvidence(entries);
    const completed = [], usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };
    const refs = entries.map((e, i) => ({ id: String(e.id || `e-${i}`), t0: e.t0 ?? e.time ?? 0, t1: e.t1 ?? e.t0 ?? e.time ?? 0, source: e.source }));
    const result = () => ({
      title: completed[0]?.title || "일부 구간 요약", status: completed.length === chunks.length ? "complete" : "partial",
      sections: completed.flatMap((part, i) => part.sections.map(s => ({ ...s, heading: chunks.length > 1 ? `${i + 1}구간 · ${s.heading}` : s.heading }))),
      questions: [...new Set(completed.flatMap(p => p.questions))],
      coverage: { total: chunks.length, completed: completed.length, failed: chunks.length - completed.length },
      evidenceRefs: refs, usage: { ...usage },
    });
    const call = async (chunk, stage) => {
      aborted(signal);
      const model = settings.summaryModel || MODEL;
      const cacheId = await requestId(sessionId, stage, { model, chunk });
      if (cache.has(cacheId)) return cache.get(cacheId);
      const response = await service.summary({
        baseUrl: settings.serviceUrl, token, model,
        evidence: chunk, requestId: await requestId(sessionId, stage, { model, chunk, attempt }), stage, signal, timeoutMs: 120000,
      });
      aborted(signal);
      const u = response.usage || {};
      usage.promptTokens += Number(u.promptTokens ?? u.prompt_tokens) || 0;
      usage.completionTokens += Number(u.completionTokens ?? u.completion_tokens) || 0;
      usage.costUsd += Number(u.costUsd ?? u.cost) || 0;
      const checked = validateSummary(response.summary, chunk);
      cache.set(cacheId, checked);
      return checked;
    };
    try {
      for (let i = 0; i < chunks.length; i++) {
        onProgress(`전체 ${chunks.length}구간 중 ${i + 1}구간 요약 중`);
        completed.push(await call(chunks[i], "chunk"));
      }
      const output = result();
      if (chunks.length > 1) {
        // Keep every chapter in the final note even if the optional overview is shorter.
        const overviewEvidence = completed.map((part, i) => ({ id: `chapter-${i + 1}`, text: JSON.stringify(part), source: "ocr", t0: chunks[i][0].t0, t1: chunks[i].at(-1).t1 }));
        if (byteLength(JSON.stringify(overviewEvidence)) <= MAX_CHUNK_BYTES) {
          onProgress("구간별 노트를 유지하며 전체 개요를 정리하는 중");
          try {
            const overview = await call(overviewEvidence, "synthesis");
            const originalIds = Object.fromEntries(completed.map((part, i) => [`chapter-${i + 1}`, [...new Set(part.sections.flatMap(s => s.evidenceIds))]]));
            output.overview = { ...overview, sections: overview.sections.map(s => ({ ...s, evidenceIds: [...new Set(s.evidenceIds.flatMap(id => originalIds[id]))] })) };
            output.title = overview.title;
          } catch (error) {
            aborted(signal);
            output.notice = "전체 개요 생성은 완료하지 못했습니다. 모든 구간의 노트는 아래에 보존했습니다.";
          }
        } else {
          output.notice = "긴 강의의 모든 구간을 개별 노트로 보존했습니다. 전체 개요는 크기 제한으로 생략했습니다.";
        }
      }
      output.usage = { ...usage };
      onProgress("모든 구간 요약 완료");
      return output;
    } catch (error) {
      error.partial = result();
      throw error;
    }
  }
  const api = { chunkEvidence, validateSummary, generate, recognitionResult, requestId };
  if (typeof module !== "undefined") module.exports = api;
  globalThis.SummaryPipeline = api;
})();
