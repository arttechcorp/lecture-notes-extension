// sol-luna-3 재개 실험(P2a, docs/note-quality-review-2026-10-06/sol-luna-2-improvements-2026-10-08.md §3.1·§8).
// 완료 작업의 산출물만 typed 체크포인트로 남겨 의존성 단위 키로 다시 쓴다.
// 규칙: 저장하는 건 구조화된 JSON 산출물뿐 — 세션 접두 P·공급자 encrypted reasoning·날것 응답은 절대 남기지 않는다.
// 암호화는 lib/package-store.js(AES-GCM, 위치 AAD 묶음)가 한다 — 여기서 새 암호 코드를 쓰지 않는다.
(() => {
  const need = (name, path) => globalThis[name] || (typeof require !== "undefined" ? require(path) : null);
  const Pipeline = need("Pipeline", "./pipeline.js");

  // 한 번의 실행 요청이 무엇인가 — 호출자의 의도 구분일 뿐 이 모듈이 정하지 않는다.
  //   resume    : 완료된 단위의 산출물을 그대로 다시 쓴다(키가 같을 때만).
  //   regenerate: generationRevision(rerun)을 올려 다시 만든다 — 청구 requestId·단계 키는 갈리고 내용 키는 같다.
  //   render    : 모델 호출 없이 확정 Note 만 다시 조판한다(디자인·폰트만 바뀐 경우).
  const KINDS = Object.freeze({ RESUME: "resume", REGENERATE: "regenerate", RENDER: "render" });

  const CHECKPOINT_V = 1;

  // 의존성 단위 키 — scope(어느 단위인가)와 그 단위의 입력 재료 전부를 안정 해시한다.
  // 타임스탬프·jobId·sessionId·requestId·runTag 같은 실행 식별자는 재료에 넣지 않는다:
  // 같은 강의·같은 명세면 같은 키이고, 재료 하나가 바뀌면 그 단위 키만 무효화된다(비용용 requestId와 별개다).
  async function keyOf(scope, deps) {
    if (typeof scope !== "string" || !scope) throw new TypeError("scope 가 필요합니다.");
    return Pipeline.digest([CHECKPOINT_V, scope, deps]);
  }

  // 저장 모양 {v, scope, value} — value 는 typed 산출물(섹션 초안·판정·계획 JSON)뿐이다.
  // id 는 `<packageId>:r:<key>` — 단계 캐시(s:)와 같은 store·id 규칙이고 패키지 삭제 때 함께 지워진다.
  const idOf = (packageId, key) => `${packageId}:r:${key}`;
  async function save(store, { packageId, scope, key, value }) {
    await store.putJson("packages", idOf(packageId, key), { v: CHECKPOINT_V, scope, value });
  }
  // 읽기: 없음·손상(복호화 실패)·버전·scope 불일치는 전부 미스다 — 호출자가 다시 계산해 덮어쓰면 그만이다.
  async function load(store, { packageId, scope, key }) {
    const rec = await store.getJson("packages", idOf(packageId, key)).catch(() => null);
    return rec && rec.v === CHECKPOINT_V && rec.scope === scope && Object.hasOwn(rec, "value")
      ? { hit: true, value: rec.value } : { hit: false, value: null };
  }
  // 계산 또는 재사용 — Pipeline.cached 와 같은 신호·집계 모양이다. 계산이 끝났으면 취소돼도 저장한다(돈을 쓴 결과).
  async function cached(store, { packageId, scope, key, signal, stats }, compute) {
    if (signal?.aborted) throw new DOMException("취소됨", "AbortError");
    const hit = await load(store, { packageId, scope, key });
    if (hit.hit) { if (stats) stats.hits++; return hit.value; }
    if (stats) stats.misses++;
    const value = (await compute(signal)) ?? null;
    await save(store, { packageId, scope, key, value });
    return value;
  }

  const api = { KINDS, CHECKPOINT_V, keyOf, save, load, cached };
  globalThis.NoteResume = api;
  if (typeof module !== "undefined") module.exports = api;
})();
