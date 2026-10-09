// mis-sol-hai Sol 피드백(기획 §4.7, D8) — 렌더된 노트 HTML을 검수 입력으로 축약하고, 섹션 재작성 선택을 돕는 순수 함수.
// CSS·스크립트·크롭 바이트(data: URI)를 빼고 블록·주장을 가리키는 id·data-* 앵커는 그대로 둔다.
// UMD: 전역 ReviewHtml / module.exports.
(() => {
  const enc = new TextEncoder();
  const bytesOf = s => enc.encode(s).length;
  const MAX_BYTES = 60000; // 검수 입력 상한 — 넘으면 최상위 블록 경계에서 자른다
  const CUT_MARK = "\n<!-- … -->";

  // 렌더 HTML 축약 공통부: <style>·<script> 블록, 인라인 style, data: URI 속성(크롭 바이트) 제거.
  const strip = s => String(s ?? "")
    .replace(/<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, "")
    .replace(/<style\b[\s\S]*?(?:<\/style\s*>|$)/gi, "")
    .replace(/\sstyle\s*=\s*"[^"]*"/gi, "")
    .replace(/\sstyle\s*=\s*'[^']*'/gi, "")
    .replace(/(\ssrc|\ssrcset|\sposter)\s*=\s*"data:[^"]*"/gi, '$1="data:"')
    .replace(/(\ssrc|\ssrcset|\sposter)\s*=\s*'data:[^']*'/gi, "$1='data:'");

  // 최상위 <section>(깊이 0→1 로 여는 것)의 끝 위치와 S# id — 노트의 섹션 봉투는 class="note-sec" id="S#" 다.
  // 중첩된 블록 section 은 최상위 카운트에 넣지 않는다 — 잘림은 최상위 경계에서만 일어난다.
  const topSections = s => {
    const out = [], re = /<\/?section\b[^>]*>/gi;
    let m, depth = 0, open = null;
    while ((m = re.exec(s))) {
      if (m[0][1] === "/") { if (depth > 0 && --depth === 0 && open) { out.push({ end: m.index + m[0].length, id: open.id }); open = null; } }
      else { if (depth++ === 0) { const im = /\sid\s*=\s*"(S[0-9]{1,3})"/.exec(m[0]); open = { id: im ? im[1] : null }; } }
    }
    return out;
  };

  // 상한 초과 시 최상위 </section> 경계에서 자르고, 빠진 섹션 id 를 돌려준다(Sol이 재작성 대상으로 고를 수 있게).
  // 첫 섹션 하나도 상한에 못 들어가면 그 첫 섹션 끝까지 살린다(상한 약간 초과 — 빈 입력보다 낫다).
  function trim(html, maxBytes = MAX_BYTES) {
    const s = strip(html);
    if (bytesOf(s) <= maxBytes) return { html: s, omittedIds: [] };
    const budget = Math.max(0, maxBytes - bytesOf(CUT_MARK));
    let lo = 0, hi = s.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bytesOf(s.slice(0, mid)) <= budget) lo = mid; else hi = mid - 1; }
    const tops = topSections(s);
    const cut = tops.filter(t => t.end <= lo).at(-1)?.end ?? tops[0]?.end ?? lo;
    const omittedIds = tops.filter(t => t.end > cut && t.id).map(t => t.id);
    return { html: s.slice(0, cut) + CUT_MARK, omittedIds };
  }

  const reduce = (html, maxBytes) => trim(html, maxBytes).html;

  // 섹션 재작성 상한(기획 §4.7): 영상 10분당 최대 1개, 최소 1. minutes 는 영상 길이(분).
  const redoCap = minutes => Math.max(1, Math.floor(Math.max(0, Number(minutes) || 0) / 10));

  // Sol이 낸 request_section_redo 를 지시 순서(중요도 순)로 채택 목록과 상한 초과·반려로 나눈다.
  // isTarget(id) 은 호스트의 존재 확인. 반려 사유는 적용기의 코드 그대로(target_missing·no_change).
  function pickRedos(edits, cap, isTarget) {
    const queue = [], over = [], rejected = [];
    for (const e of Array.isArray(edits) ? edits : []) {
      if (!e || e.op !== "request_section_redo") continue;
      if (typeof e.targetId !== "string" || !isTarget(e.targetId)) { rejected.push("target_missing"); continue; }
      if (queue.includes(e.targetId) || over.includes(e.targetId)) { rejected.push("no_change"); continue; }
      (queue.length < cap ? queue : over).push(e.targetId);
    }
    return { queue, over, rejected };
  }

  const api = { reduce, trim, redoCap, pickRedos, MAX_BYTES, CUT_MARK };
  globalThis.ReviewHtml = api;
  if (typeof module !== "undefined") module.exports = api;
})();
