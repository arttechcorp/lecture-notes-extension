// 섹션 하나의 노트 블록을 검증하는 순수 함수들 — 파이프라인 v2 G단계(docs/architecture-v2.md §6.5).
// 블록 스키마는 아직 확정 전이라 블록을 "문자열 잎과 evidenceIds를 가진 임의의 객체"로만 본다.
// 실패는 {code, detail}이다. code는 내용을 담지 않는다(이벤트·로그에는 code만 남긴다). detail은
// 재생성 프롬프트로만 돌아가는 id·숫자·LaTeX 목록이다. KaTeX은 formulas.js처럼 불러오지 않고 주입받는다.
(() => {
  const Formulas = globalThis.Formulas || (typeof require !== "undefined" ? require("./formulas.js") : null);
  // summary.js 의 MIN_COVERAGE 와 원문 재현 창(180자, 60자 간격)과 같은 값이다. 어긋나면 두 검증기가 다른 기준을 쓴다.
  const MIN_COVERAGE = .5;
  const WINDOW = 180, STEP = 60;
  // formulas.js substituteRefs 와 같은 참조 형태다. 렌더러가 치환하는 것만 참조로 센다.
  const REF = /\{\{\s*(F\d+)\s*\}\}/g;
  // 숫자 다음에 바로 붙은 한글 배수(10의 지수). "3만큼"의 만은 배수가 아니다.
  const EXP = { 천: 3, 만: 4, 억: 8, 조: 12 };
  const NUM = /((?:\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.\d+)?|\.\d+)(?:([천만억조])(?!큼))?/g;
  // id 류 필드는 본문이 아니다.
  const SKIP_KEYS = new Set(["evidenceIds", "id"]);
  // 유도식의 숫자는 계산 결과라 근거에 없는 게 정상이다. 유도식은 KaTeX·재타이핑 검사가 맡는다.
  const NUMBER_SKIP = new Set([...SKIP_KEYS, "derived"]);
  const err = (code, detail = []) => ({ code, detail });
  const flat = s => String(s ?? "").normalize("NFC").replace(/\s+/gu, " ");

  // 문자열 잎을 줄바꿈으로 이은 블록 본문. 숫자·불리언 잎은 본문이 아니다.
  function textOf(node, skip = SKIP_KEYS) {
    if (typeof node === "string") return node;
    const kids = Array.isArray(node) ? node
      : node && typeof node === "object" ? Object.entries(node).filter(([k]) => !skip.has(k)).map(([, v]) => v) : [];
    return kids.map(kid => textOf(kid, skip)).filter(Boolean).join("\n");
  }

  // 새로 유도한 LaTeX. derived 는 문자열이거나 문자열 배열이고, 어느 깊이에 있어도 찾는다.
  // 빈 문자열은 "유도한 식 없음"으로 읽는다 — 빈 값을 깨진 수식으로 세면 멀쩡한 블록이 재생성에 걸린다.
  function derivedOf(node, out = []) {
    if (Array.isArray(node)) node.forEach(v => derivedOf(v, out));
    else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === "derived") out.push(...[v].flat().filter(s => typeof s === "string" && s.trim()));
        else derivedOf(v, out);
      }
    }
    return out;
  }

  // 본문의 "의미 있는 숫자". 전각·위첨자는 NFKC로, 천 단위 쉼표와 소수 표기("3.50"="3.5", ".5"="0.5")는
  // 수치로 맞춘다. 배수가 붙으면 원값과 곱한 값을 둘 다 센다 — "100만"과 "1,000,000"이 양쪽에서 맞아야 한다.
  // 한 자리 정수(0~9)는 "2가지", "3단계" 같은 열거라 건너뛴다. 근거 쪽은 keepSmall로 전부 모은다
  // ("3.0"이 근거의 "3"과 맞아야 한다). 참조 {{F12}}의 숫자는 수식 id이므로 먼저 지운다.
  // ponytail: 오탐 한 번이 LLM 재생성 한 번이라 일부러 좁게 잡았다. 부호(−3 vs 3), 범위(10~20),
  // 복합 한글 수사(3억 5천만), 수사어("두 배"), 단위 환산(25% vs 0.25), 위첨자 접힘(10² → 102)은
  // 비교하지 않는다. 필요해지면 토큰 종류를 여기에 더한다.
  function numbersOf(text, keepSmall = false) {
    const out = [];
    for (const [raw, num, mult] of String(text ?? "").normalize("NFKC").replace(REF, " ").matchAll(NUM)) {
      const n = num.replace(/,/g, "");
      if (!mult && !keepSmall && /^\d$/.test(n)) continue;
      // 지수 표기로 파싱하면 1.5e4 가 정확히 15000 이다(부동소수 곱셈의 오차가 없다).
      out.push({ raw, values: mult ? [Number(n), Number(n + "e" + EXP[mult])] : [Number(n)] });
    }
    return out;
  }

  // 비대체성: 근거 문장을 길게 그대로 옮긴 출력을 막는다. summary.js validateSummary 의 보수적 검사를 옮겼다.
  // 근거마다 180자 창을 60자 간격으로 만들어 두고, 블록 본문에 통째로 들어 있으면 걸린다.
  // ponytail: 공백만 정규화한다. 마크다운·구두점을 끼워 넣은 복사는 놓친다(240자 이상 복사는 어디서 잘라도 창 하나를 품는다).
  function windowsOf(evidence) {
    const out = [];
    for (const e of evidence) {
      const src = flat(e.text);
      for (let i = 0; i + WINDOW <= src.length; i += STEP) out.push([e.id, src.slice(i, i + WINDOW)]);
    }
    return out;
  }

  // 본문에 근거 창이 통째로 들어 있는 근거 id — 근거 배열 순, 중복 없이.
  const verbatimIn = (out, windows) => [...new Set(windows.filter(([, w]) => out.includes(w)).map(([id]) => id))];
  function verbatimIds(text, evidence) {
    return verbatimIn(flat(text), windowsOf(evidence));
  }

  // blocks: [{index, errors}] 는 실패한 블록만 담는다. section.uncitedIds 는 호출자가 uncitedNotice 로 바꿀 재료다.
  // 커버리지는 오류 없는 블록(=남게 될 블록)이 인용한 근거로 센다 — 실패 블록을 재생성한 뒤 다시 호출하면 최종 값이 된다.
  function verifySection({ blocks = [], evidence = [], registry = [], katex = null } = {}) {
    if (!Formulas) throw new Error("Formulas 모듈이 필요합니다.");
    const numbersById = new Map(evidence.map(e => [e.id, new Set(numbersOf(e.text, true).flatMap(n => n.values))]));
    const windows = windowsOf(evidence), registryIds = new Set(registry.map(e => e.id));
    const skipped = new Set(), failing = [], cited = new Set();
    blocks.forEach((block, index) => {
      const errors = [], text = textOf(block);
      const ids = Array.isArray(block?.evidenceIds) ? block.evidenceIds : [];
      const unknown = ids.filter(id => !numbersById.has(id));
      if (!ids.length) errors.push(err("VAL_EVIDENCE_MISSING"));
      if (unknown.length) errors.push(err("VAL_EVIDENCE_UNKNOWN", unknown.map(String)));

      // 숫자는 이 블록이 인용한 근거에서만 찾는다 — 다른 근거에 있는 수치를 끌어다 쓴 블록도 잡아야 한다.
      const have = new Set(ids.flatMap(id => [...(numbersById.get(id) || [])]));
      const missing = new Set(numbersOf(textOf(block, NUMBER_SKIP)).filter(n => !n.values.some(v => have.has(v))).map(n => n.raw));
      if (missing.size) errors.push(err("VAL_NUMBER_MISSING", [...missing]));

      const badRefs = new Set([...text.matchAll(REF)].map(m => m[1]).filter(id => !registryIds.has(id)));
      if (badRefs.size) errors.push(err("VAL_FORMULA_REF_UNKNOWN", [...badRefs]));
      const retyped = Formulas.findRetypedLatex(text, registry);
      if (retyped.length) errors.push(err("VAL_FORMULA_RETYPED", retyped));

      // KaTeX 없이는 유도식을 검증할 수 없다. 통과로 두지 않고 건너뛰었음을 결과에 남긴다.
      const derived = derivedOf(block);
      if (derived.length && !katex) skipped.add("VAL_DERIVED_INVALID");
      else {
        const bad = derived.map(latex => Formulas.validateDerived(latex, katex)).filter(r => !r.ok);
        if (bad.length) errors.push(err("VAL_DERIVED_INVALID", bad.map(r => r.error)));
      }

      // 인용하지 않은 근거를 옮긴 것도 재현이므로 섹션 근거 전체와 비교한다.
      const copied = verbatimIn(flat(text), windows);
      if (copied.length) errors.push(err("VAL_VERBATIM", copied));

      if (errors.length) failing.push({ index, errors });
      else ids.forEach(id => cited.add(id));
    });
    const uncitedIds = [...numbersById.keys()].filter(id => !cited.has(id)), total = numbersById.size;
    const errors = total && (total - uncitedIds.length) / total < MIN_COVERAGE ? [err("VAL_COVERAGE_LOW", [`${total - uncitedIds.length}/${total}`])] : [];
    return {
      ok: !failing.length && !errors.length,
      blocks: failing,
      section: { errors, uncitedIds, uncitedRatio: total ? uncitedIds.length / total : 0 },
      skipped: [...skipped],
    };
  }

  // T5 근거 지지(유료). judge(items)는 /v1/judge task:"support" 항목 {itemId, text, context}를 받아
  // [{itemId, score}](또는 ServiceClient.judge 응답 {results})를 돌려주는 주입 함수다. score = p(supported).
  // 점수가 없는 항목(null, 판정 없음)은 실패가 아니다. 보내지 못한 항목과 함께 unjudged 에 인덱스로 남긴다.
  // 동기 검사와 독립이라 verifySection 결과를 받지 않고 같은 blocks·evidence 를 다시 받는다.
  // ponytail: 서버 상한(항목당 8000자, 요청당 200건·64KB)은 judge 구현이 나눠 보낸다. 8000자를 넘는 항목은 잘라서 오판하느니 보내지 않는다.
  async function checkSupport(blocks, evidence, { judge, threshold = .5 } = {}) {
    const textById = new Map(evidence.map(e => [e.id, String(e.text ?? "")]));
    const items = [];
    blocks.forEach((block, index) => {
      const ids = Array.isArray(block?.evidenceIds) ? block.evidenceIds : [];
      const text = textOf(block).replace(REF, " ").trim();
      const context = ids.filter(id => textById.has(id)).map(id => textById.get(id)).join("\n").trim();
      if (text && context && text.length <= 8000 && context.length <= 8000) items.push({ itemId: String(index), text, context });
    });
    const raw = items.length ? await judge(items) : [];
    const scores = new Map((Array.isArray(raw) ? raw : raw?.results ?? []).map(r => [r?.itemId, r?.score]));
    const failing = [], judged = new Set();
    for (const { itemId } of items) {
      const score = scores.get(itemId);
      if (typeof score !== "number" || Number.isNaN(score)) continue;
      judged.add(+itemId);
      if (score < threshold) failing.push({ index: +itemId, errors: [err("VAL_SUPPORT_LOW", [score])] });
    }
    return { ok: !failing.length, blocks: failing, unjudged: blocks.map((_, i) => i).filter(i => !judged.has(i)) };
  }

  const api = { verifySection, checkSupport, verbatimIds, textOf, numbersOf };
  globalThis.Verify = api;
  if (typeof module !== "undefined") module.exports = api;
})();
