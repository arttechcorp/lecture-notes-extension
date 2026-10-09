// mis-sol-hai Sol 피드백(기획 §4.7, D8) — 렌더된 노트 HTML을 검수 입력으로 축약하고, 섹션 재작성 선택을 돕는 순수 함수.
// CSS·스크립트·크롭 바이트(data: URI)를 빼고 블록·주장을 가리키는 id·data-* 앵커는 그대로 둔다.
// UMD: 전역 ReviewHtml / module.exports.
(() => {
  const enc = new TextEncoder();
  const bytesOf = s => enc.encode(s).length;
  const MAX_BYTES = 60000; // 검수 입력 상한 — 넘으면 블록 경계에서 자른다
  const CUT_MARK = "\n<!-- … -->";

  // 렌더 HTML 축약: <style>·<script> 블록, 인라인 style, data: URI 속성(크롭 바이트) 제거.
  // 너무 길면 마지막 </section> 경계에서 자르고 CUT_MARK 를 붙인다.
  function reduce(html, maxBytes = MAX_BYTES) {
    let s = String(html ?? "");
    s = s.replace(/<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, "")
      .replace(/<style\b[\s\S]*?(?:<\/style\s*>|$)/gi, "")
      .replace(/\sstyle\s*=\s*"[^"]*"/gi, "")
      .replace(/\sstyle\s*=\s*'[^']*'/gi, "")
      .replace(/(\ssrc|\ssrcset|\sposter)\s*=\s*"data:[^"]*"/gi, '$1="data:"')
      .replace(/(\ssrc|\ssrcset|\sposter)\s*=\s*'data:[^']*'/gi, "$1='data:'");
    if (bytesOf(s) <= maxBytes) return s;
    // 상한 안에 들어가는 가장 긴 접두를 이분 탐색하고, 그 안의 마지막 </section> 끝에서 자른다.
    const budget = Math.max(0, maxBytes - bytesOf(CUT_MARK));
    let lo = 0, hi = s.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bytesOf(s.slice(0, mid)) <= budget) lo = mid; else hi = mid - 1; }
    const end = s.lastIndexOf("</section>", lo);
    return s.slice(0, end > 0 ? end + "</section>".length : lo) + CUT_MARK;
  }

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

  const api = { reduce, redoCap, pickRedos, MAX_BYTES, CUT_MARK };
  globalThis.ReviewHtml = api;
  if (typeof module !== "undefined") module.exports = api;
})();
