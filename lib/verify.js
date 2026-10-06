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

  // /v1/judge 항목당 상한(서버 task 항목 8000자). 넘는 주장은 잘라서 오판하느니 보내지 않는다.
  const JUDGE_CHARS = 8000;
  // 분할 판정의 모순 하한: 근거를 묶음으로 나눠 판정할 때 어느 묶음이든 이 미만이면 지지로 받지 않는다 —
  // 여러 묶음의 최댓값만 취해 통과시키면 모순 근거를 못 본다(제안서 §4).
  const CONTRA_FLOOR = .2;

  // 근거 목록을 joined text 가 limit 자 이하인 묶음으로 나눈다 — 묶음 경계는 근거 항목 단위다.
  // 하나가 limit 를 넘는 근거는 어느 묶음에도 못 들어가니 뺀다(잘라서 보내지 않는다).
  function evidenceBundles(items, limit = JUDGE_CHARS) {
    const out = [];
    let cur = [], len = 0;
    for (const e of items || []) {
      const t = String(e?.text ?? "");
      if (!t || t.length > limit) continue;
      if (cur.length && len + t.length + 1 > limit) { out.push(cur); cur = []; len = 0; }
      cur.push(e); len += t.length + 1;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  // T5 근거 지지(유료). judge(items)는 /v1/judge task:"support" 항목 {itemId, text, context}를 받아
  // [{itemId, score}](또는 ServiceClient.judge 응답 {results})를 돌려주는 주입 함수다. score = p(supported).
  // 점수가 없는 항목(null, 판정 없음)은 실패가 아니다. 보내지 못한 항목과 함께 unjudged 에 인덱스로 남긴다.
  // 인용 근거가 8000자를 넘으면 묶음으로 나눠 각각 판정한다 — 한 묶음도 점수를 못 받으면 그 블록은 미판정이다.
  // 합격 규칙: 최고점이 threshold 이상이면서 최저점이 floor(모순 하한) 이상 — 최댓값만으로는 통과시키지 않는다.
  // 일부 묶음만 점수가 나와도 미판정은 미판정이다 — 다만 받은 점수는 scores 에 진단용(최고점)으로 남긴다.
  // scores 의 진단 값은 묶음 최고점이다. 동기 검사와 독립이라 verifySection 결과를 받지 않고 같은 blocks·evidence 를 다시 받는다.
  // ponytail: 서버 상한(요청당 200건·64KB)은 judge 구현이 나눠 보낸다.
  async function checkSupport(blocks, evidence, { judge, threshold = .5, floor = CONTRA_FLOOR } = {}) {
    const evById = new Map(evidence.map(e => [e.id, e]));
    const items = [], slots = [], totals = new Map();
    blocks.forEach((block, index) => {
      const ids = Array.isArray(block?.evidenceIds) ? block.evidenceIds : [];
      const text = textOf(block).replace(REF, " ").trim();
      if (!text || text.length > JUDGE_CHARS) return;
      for (const bundle of evidenceBundles(ids.filter(id => evById.has(id)).map(id => evById.get(id)))) {
        const context = bundle.map(e => String(e.text ?? "")).join("\n").trim();
        if (!context) continue;
        slots.push(index); totals.set(index, (totals.get(index) ?? 0) + 1);
        items.push({ itemId: String(items.length), text, context });
      }
    });
    const raw = items.length ? await judge(items) : [];
    const scores = new Map((Array.isArray(raw) ? raw : raw?.results ?? []).map(r => [r?.itemId, r?.score]));
    const judged = new Set(), byIndex = blocks.map(() => null), perBlock = new Map();
    items.forEach((it, i) => {
      const score = scores.get(it.itemId);
      if (typeof score !== "number" || Number.isNaN(score)) return;
      const index = slots[i];
      (perBlock.get(index) ?? perBlock.set(index, []).get(index)).push(score);
      byIndex[index] = Math.max(byIndex[index] ?? -Infinity, score);
    });
    const failing = [];
    for (const [index, list] of perBlock) {
      if (list.length < totals.get(index)) continue; // 일부 묶음 미판정 — 통과도 거짓도 아니다
      judged.add(index);
      if (Math.max(...list) < threshold || Math.min(...list) < floor)
        failing.push({ index, errors: [err("VAL_SUPPORT_LOW", [Math.max(...list)])] });
    }
    failing.sort((a, b) => a.index - b.index);
    return { ok: !failing.length, blocks: failing, unjudged: blocks.map((_, i) => i).filter(i => !judged.has(i)), scores: byIndex };
  }

  // ── 수식 검증 구분 (§5) ──
  const GREEK_MAP = {
    "\\alpha": "α", "\\beta": "β", "\\gamma": "γ", "\\delta": "δ", "\\epsilon": "ε", "\\varepsilon": "ε",
    "\\zeta": "ζ", "\\eta": "η", "\\theta": "θ", "\\vartheta": "θ", "\\iota": "ι", "\\kappa": "κ",
    "\\lambda": "λ", "\\mu": "μ", "\\nu": "ν", "\\xi": "ξ", "\\pi": "π", "\\varpi": "π",
    "\\rho": "ρ", "\\varrho": "ρ", "\\sigma": "σ", "\\varsigma": "σ", "\\tau": "τ", "\\upsilon": "υ",
    "\\phi": "φ", "\\varphi": "φ", "\\chi": "χ", "\\psi": "ψ", "\\omega": "ω",
    "\\Gamma": "Γ", "\\Delta": "Δ", "\\Theta": "Θ", "\\Lambda": "Λ", "\\Xi": "Ξ", "\\Pi": "Π",
    "\\Sigma": "Σ", "\\Upsilon": "Υ", "\\Phi": "Φ", "\\Psi": "Ψ", "\\Omega": "Ω",
  };

  // 유니코드 첨자 맵
  const SUB_UNI = { "₀":"0","₁":"1","₂":"2","₃":"3","₄":"4","₅":"5","₆":"6","₇":"7","₈":"8","₉":"9","ₐ":"a","ₑ":"e","ₕ":"h","ᵢ":"i","ⱼ":"j","ₖ":"k","ₗ":"l","ₘ":"m","ₙ":"n","ₒ":"o","ₚ":"p","ᵣ":"r","ₛ":"s","ₜ":"t","ᵤ":"u","ᵥ":"v","ₓ":"x" };
  const SUP_UNI = { "⁰":"0","¹":"1","²":"2","³":"3","⁴":"4","⁵":"5","⁶":"6","⁷":"7","⁸":"8","⁹":"9","ᵃ":"a","ᵇ":"b","ᶜ":"c","ᵈ":"d","ᵉ":"e","ᶠ":"f","ᵍ":"g","ʰ":"h","ⁱ":"i","ʲ":"j","ᵏ":"k","ˡ":"l","ᵐ":"m","ⁿ":"n","ᵒ":"o","ᵖ":"p","ʳ":"r","ˢ":"s","ᵗ":"t","ᵘ":"u","ᵛ":"v","ʷ":"w","ˣ":"x","ʸ":"y","ᶻ":"z","⁺":"+","⁻":"-" };

  // 가벼운 정규화 토크나이저: 변수 기호, 분수 분모/분자, 첨자 토큰 추출
  function tokenizeMathSymbols(str) {
    if (typeof str !== "string" || !str.trim()) return [];
    // 유니코드 아래첨자/위첨자를 먼저 _ / ^ 표기로 변환한 뒤 정규화 (NFKC 가 첨자를 일반 숫자로 뭉개는 것 방지).
    // 문자 범위 정규식은 U+1D62 대역의 아래첨자(ᵢᵣᵤᵥ)를 위첨자로 오분류한다 — 맵의 키만 정확히 치환한다.
    // 주의: ¹, ², ³ 은 Latin-1(U+00B9, U+00B2, U+00B3)에 있어 U+2070 대역(⁰-⁹)에 포함되지 않는다.
    let s = str.replace(new RegExp(`[${Object.keys(SUB_UNI).join("")}]`, "gu"), c => `_${SUB_UNI[c] || c}`)
               .replace(new RegExp(`[${Object.keys(SUP_UNI).join("")}]`, "gu"), c => `^${SUP_UNI[c] || c}`)
               .normalize("NFKC");

    // 바깥쪽 $ 제거 및 LaTeX 서식/간격 명령 제거
    s = s.replace(/^\$\$?/, "").replace(/\$\$?$/, "")
         .replace(/\\(?:left|right)(?![a-zA-Z])|\\displaystyle\b|\\q?quad\b|\\[,;:!]/g, " ")
         .replace(/\\text\s*\{([^}]*)\}/g, " $1 ");

    // 연산자 및 유니코드 기호 표준화
    s = s.replace(/\\[tc]?times\b|\\cdot\b|\\ast\b|[×·*]/g, "*")
         .replace(/\\div\b|÷/g, "/")
         .replace(/[−–]/g, "-");

    // 그리스 문자 치환
    for (const [cmd, sym] of Object.entries(GREEK_MAP)) {
      s = s.replaceAll(cmd, sym);
    }

    const tokens = [];

    // 헬퍼: 하위 문자열에서 변수와 숫자 토큰을 prefix 와 함께 수집
    const extractSubTokens = (subStr, prefix) => {
      let sub = subStr.normalize("NFKC");
      // 천단위 쉼표 제거
      sub = sub.replace(/(?<=\d)(?:\\,|\{,\}|,)(?=\d{3}(?!\d))/g, "");
      for (const m of sub.match(/\d+(?:\.\d+)?|\.\d+/g) || []) {
        tokens.push(`${prefix}_val:${m}`);
      }
      sub = sub.replace(/\d+(?:\.\d+)?|\.\d+/g, " ");
      sub = sub.replace(/\\[a-zA-Z]+/g, " ");
      for (const m of sub.match(/[a-zA-Zα-ωΑ-Ω]/g) || []) {
        tokens.push(`${prefix}_var:${m}`);
      }
    };

    // 1. 분수 추출 (\frac{a}{b} 및 plain text a/b)
    s = s.replace(/\\[dt]?frac\s*\{([^}]+)\}\s*\{([^}]+)\}/g, (m, num, den) => {
      extractSubTokens(num, "num");
      extractSubTokens(den, "den");
      return " ";
    });
    s = s.replace(/\\[dt]?frac\s*([a-zA-Z0-9α-ωΑ-Ω])\s*([a-zA-Z0-9α-ωΑ-Ω])/g, (m, num, den) => {
      extractSubTokens(num, "num");
      extractSubTokens(den, "den");
      return " ";
    });

    // 2. plain text 슬래시 분수 형태 (예: 0.09/(3*4), r/CK, a/b)
    s = s.replace(/(\([^)()]+\)|[a-zA-Z0-9α-ωΑ-Ω.]+)\s*\/\s*(\([^)()]+\)|[a-zA-Z0-9α-ωΑ-Ω.]+)/g, (m, num, den) => {
      const cleanNum = num.replace(/^[()]+|[()]+$/g, "");
      const cleanDen = den.replace(/^[()]+|[()]+$/g, "");
      extractSubTokens(cleanNum, "num");
      extractSubTokens(cleanDen, "den");
      return " ";
    });

    // 3. 첨자 추출
    s = s.replace(/_\{([^}]+)\}/g, (m, sub) => {
      extractSubTokens(sub, "sub");
      return " ";
    });
    s = s.replace(/_([a-zA-Z0-9α-ωΑ-Ω])/g, (m, sub) => {
      extractSubTokens(sub, "sub");
      return " ";
    });
    s = s.replace(/\^\{([^}]+)\}/g, (m, sup) => {
      extractSubTokens(sup, "sup");
      return " ";
    });
    s = s.replace(/\^([a-zA-Z0-9α-ωΑ-Ω])/g, (m, sup) => {
      extractSubTokens(sup, "sup");
      return " ";
    });

    // 4. 일반 숫자 토큰
    s = s.replace(/(?<=\d)(?:\\,|\{,\}|,)(?=\d{3}(?!\d))/g, "");
    for (const m of s.match(/\d+(?:\.\d+)?|\.\d+/g) || []) {
      tokens.push(`val:${m}`);
    }
    s = s.replace(/\d+(?:\.\d+)?|\.\d+/g, " ");

    // 5. 일반 변수 기호 (영문자 및 그리스 문자)
    s = s.replace(/\\[a-zA-Z]+/g, " ");
    for (const m of s.match(/[a-zA-Zα-ωΑ-Ω]/g) || []) {
      tokens.push(`var:${m}`);
    }

    return tokens.sort();
  }

  // 원본(OCR/텍스트)과 LaTeX 의 변수 기호·분수 분모/분자·첨자 토큰 비교
  function checkFormulaSymbols(latex, sourceText) {
    if (sourceText == null || !String(sourceText).trim()) return "unchecked";
    if (latex == null || !String(latex).trim()) return "unchecked";

    const tokL = tokenizeMathSymbols(latex);
    const tokS = tokenizeMathSymbols(sourceText);

    if (!tokL.length || !tokS.length) return "unchecked";

    const left = new Map();
    for (const t of tokL) left.set(t, (left.get(t) || 0) + 1);

    const missing = [];
    for (const t of tokS) {
      if ((left.get(t) || 0) > 0) left.set(t, left.get(t) - 1);
      else missing.push(t);
    }
    const extra = [];
    for (const [t, c] of left) {
      for (let i = 0; i < c; i++) extra.push(t);
    }

    // 토큰은 전부 변수·수치·분수·첨자 류라 하나라도 다르면 기호 불일치다.
    return missing.length || extra.length ? "mismatch" : "match";
  }

  // B10 계산 입력·결과의 단위 일관성 (같은 차원끼리만 더하기 등 단순 규칙)
  function checkFormulaUnits(entry, opts = {}) {
    const b10 = opts.b10 || opts.calc || entry?.calc || entry?.content || null;
    if (b10 && (Array.isArray(b10.steps) || Array.isArray(b10.inputs))) {
      const units = {};
      (b10.inputs || []).forEach((inp, i) => { units["i" + (i + 1)] = inp.unit ?? null; });
      let checkedAny = false;
      for (let j = 0; j < (b10.steps || []).length; j++) {
        const st = b10.steps[j];
        const r = "c" + (j + 1);
        if (st.op === "add" || st.op === "sub") {
          checkedAny = true;
          const ua = units[st.a], ub = units[st.b];
          const want = st.op === "sub" && ua === "%" && ub === "%" ? "%p" : ua;
          if (ua !== ub || (st.unit ?? null) !== want) return "mismatch";
        }
        units[r] = st.unit ?? null;
      }
      if (checkedAny) return "ok";
    }

    // LaTeX 또는 text 안의 단위 붙은 수치 더하기/빼기 — 단위는 \text{...} 또는 한글·%·°로 시작하는
    // 토큰만 본다. 벌어진 알파벳("5x - 2y")은 변수일 수 있어 단위로 단정하지 않는다(오탐 방지).
    const targetText = String(entry?.latex || entry?.text || "");
    const unitPair = /(\d+(?:\.\d+)?)\s*(?:\\text\{\s*([^{}]*?)\s*\}|([가-힣%°][가-힣A-Za-z%°]*))\s*([+-])\s*(\d+(?:\.\d+)?)\s*(?:\\text\{\s*([^{}]*?)\s*\}|([가-힣%°][가-힣A-Za-z%°]*))/g;
    let matchedUnitOp = false;
    for (const m of targetText.matchAll(unitPair)) {
      matchedUnitOp = true;
      const u1 = (m[2] ?? m[3] ?? "").trim(), u2 = (m[6] ?? m[7] ?? "").trim();
      if (u1 !== u2) return "mismatch";
    }
    if (matchedUnitOp) return "ok";

    return "unchecked";
  }

  // 레지스트리 항목 단위 검사 종합 계산
  function checkFormula(entry, opts = {}) {
    const latex = entry?.latex ?? null;
    const katex = opts?.katex ?? globalThis.katex ?? null;

    let parse = "unchecked";
    if (typeof latex === "string" && latex.trim()) {
      if (katex) {
        let pOk = false;
        try {
          if (Formulas && typeof Formulas.parseOk === "function") {
            pOk = Formulas.parseOk(latex, katex);
          } else {
            katex.renderToString(latex, { throwOnError: true, displayMode: true });
            pOk = true;
          }
        } catch {
          pOk = false;
        }
        parse = pOk ? "ok" : "failed";
      }
    }

    const symbols = checkFormulaSymbols(latex, opts.ocrText ?? entry?.text ?? null);
    const units = checkFormulaUnits(entry, opts);

    return { parse, symbols, units };
  }

  const api = {
    verifySection, checkSupport, verbatimIds, textOf, numbersOf, evidenceBundles,
    JUDGE_CHARS, CONTRA_FLOOR,
    tokenizeMathSymbols, checkFormulaSymbols, checkFormulaUnits, checkFormula,
  };
  globalThis.Verify = api;
  if (typeof module !== "undefined") module.exports = api;
})();
