// 파이프라인 v2 단계 오케스트레이션(docs/architecture-v2.md §5.2, §6.3~6.7, §7, §8; docs/note-contract.md §8·§10·§12·§17 6-3~6-6):
// 정제 → 판정 → 계획 → 작성 → 검증·조립 → 렌더를 Pipeline.runStages 로 돌린다. 단계 결과는 단계 캐시에 남아 같은 입력의 재실행은 서비스를 다시 부르지 않는다.
// 노트 계약(슬롯·검증·조립)은 lib/note-contract.js 한 곳에 있다. 여기서는 그 함수만 부른다.
// 서비스(plan·write·judge)·KaTeX·이벤트·렌더러·시계는 전부 deps 로 주입한다. 이벤트와 알림에는 코드·수치·id·시각 구간만 싣고 강의 내용은 싣지 않는다.
//
// runNote(job, input, deps) → {status, note, notices, rendered?, cropMap?}
//   input: {slides:[SlideDoc], transcript:Transcript, gaps:[{reason,t0,t1}], tier:"free"|"paid", models:{plan,write,judge}, consent:{summary},
//           recognition?:"local"|"cloud", options?:{syntheticExamples, externalAugmentation}, meta?:{title, course, lectureDate, session, lang},
//           figureData?:{hashes:{"<slideId>/<figId>":hex}, ocr:{key:text}, crops:[key]}, formulaCrops?:[ "<slideId>/<formulaId>" ], rerun?, host?}
//   deps:  {service:{plan,write,judge}, katex, events?, render?(note,{signal}), signal?, breaker?, sleep?, concurrency?, now?,
//           promptVersions?:{plan,section,repair,global,link,questions,draft,judge}(/v1/me, 단계·호출 캐시 키에 섞는다 — 없으면 서버 호출은 캐시를 안 쓴다),
//           linkEditor?:bool — draft 경로(deps.writer==="draft", W2-A)에서만 켠다: T5 뒤 연결 편집(link) + 본문 확정 뒤 문항(questions),
//           cacheStats?:{hits,misses}(로컬 캐시 적중 수를 누적한다 — 호출자가 run 끝에 /v1/runs 로 보고),
//           writer?:"blocks"(기본)|"draft"(의미 초안 → 코드 조판 경로, /v1/me config.noteWriter),
//           noteMode?:"independent"|"sol-session"|"sol-luna-tool"|"sol-fork"|"sol-luna-2"|"sol-luna-3"|"sol-fork-2"(숨은 실험, devNoteMode — 없으면 운영 경로 그대로.
//             켜지면 로컬 단계·호출 캐시를 읽지도 쓰지도 않고(웜 캐시 오염 방지·재개 시 history 결손 방지) 대체 모델 폴백을 끈다.
//             session 모드는 plan→write 호출을 한 줄로 세우고 서버 noteSession 대화를 실행 메모리에만 든다.
//             sol-fork 는 계획 응답의 history 를 고정 접두 P 로 삼아 모든 쓰기 호출이 P 만 싣고 병렬로 나간다.
//             sol-luna-2 / sol-fork-2(v2): 계획 응답 {plan, editorialPlan, noteSession} — editorialPlan 은 실행 메모리 전용이고
//             noteSession history 가 고정 접두 P 다. sol-fork-2 는 모든 쓰기 호출이 P 를 싣고, sol-luna-2 는 Sol 단계
//             (review·global·repair)만 P 를 싣고 draft·questions 는 Luna High 독립 호출이다. 통합 검수(review)가 link 를 대신한다)}
//   status "complete" | "partial" | "recognition-only"(요약 동의 없음, 서비스 호출 없이 일시정지) | job 상태("failed"·"paused"·"cancelled")
//   note: NoteContract Note(schemas.note). cropMap: { "F3"|"G1": "<slideId>/<localId>" } — 호출자가 크롭 바이트를 F#·G# 키로 옮긴다.
//   recognition-only 일 때는 note 대신 recognition:{slides:[{slideId,t0,t1,text}], segments:[{t0,t1,text}]} 를 돌려준다(인식 결과 보기).
//   rerun: 같은 입력을 다시 돌릴 때(실패 섹션 재시도·재생성) 올리는 번호. requestId 와 쓰기 이후 단계 캐시 키에 들어간다.
(() => {
  const need = (name, path) => globalThis[name] || (typeof require !== "undefined" ? require(path) : null);
  const Pipeline = need("Pipeline", "./pipeline.js"), Verify = need("Verify", "./verify.js"), Boilerplate = need("Boilerplate", "./boilerplate.js");
  const Formulas = need("Formulas", "./formulas.js"), Preprocess = need("Preprocess", "./preprocess.js"), Contracts = need("Contracts", "./contracts.js");
  const NoteContract = need("NoteContract", "./note-contract.js"), Figures = need("Figures", "./figures.js");
  const SectionDraft = need("SectionDraft", "./section-draft.js"), NoteV3 = need("NoteV3", "./note-v3.js"), NoteResume = need("NoteResume", "./note-resume.js");
  const NoteProfiles = need("NoteProfiles", "./note-profiles.js");
  const ReviewHtml = need("ReviewHtml", "./review-html.js"), NoteRender = need("NoteRender", "./note-render.js");
  // 실패 루프 제어기(lib/repair-plan.js, v2-loop 담당). 병합 전 스냅샷에는 없을 수 있어 최소 어댑터로 부른다 —
  // 어댑터 기본값은 스펙 §4.3~4.4 의 상한 그 자체다(원인별 1회, 근거·정책·중복 사유는 보류). 로직은 여기서 재구현하지 않는다.
  let RepairPlan = globalThis.RepairPlan ?? null;
  if (!RepairPlan && typeof require !== "undefined") try { RepairPlan = require("./repair-plan.js"); } catch {}
  // 제어기 최소 어댑터 — 모듈이 없으면 §4.4 표의 기본값(근거 없음·정책·중복은 보류, 나머지 원인은 형식→의미 순 1회)으로 간다.
  // 계약: classifyFailure({kind,blockId,reason,errors})→원인, nextRepairStep({kind,cause,targetId,budget})→다음 조치,
  // signatureOf(errors)→오류 서명, metricsOf(budget)→내용 없는 지표.
  const NULL_CAUSE = { insufficient_evidence: "no_evidence", duplicate: "duplicate", policy: "policy", unsupported_format: "format", unknown: "unknown" };
  // 실제 lib/repair-plan.js 인터페이스: classifyFailure(item)→{cause,unit,target,root}, nextRepairStep({failures,budget})→{action,targets,reason}.
  // 어댑터는 호출 지점이 쓰는 문자열 계약("hold"|"regenerate"|"repair"|원인)으로 접는다. 모델이 붙인 사유는 신뢰하지 않고
  // 제어기 분류가 정한다 — 근거 없음·정책은 제어기가, 중복은 여기서 보류한다(검수가 다룬다).
  const loopClassify = t => RepairPlan?.classifyFailure
    ? RepairPlan.classifyFailure({ ...t, target: t?.blockId ?? t?.targetId, nullReason: t?.reason, ...(t?.reason === "insufficient_evidence" ? { hasEvidence: false } : {}) }).cause
    : (t?.kind === "writer_null" ? NULL_CAUSE[t?.reason] ?? "unknown" : "format");
  const loopStep = c => {
    if (!RepairPlan?.nextRepairStep)
      return c?.kind === "writer_null" ? (["no_evidence", "policy", "duplicate"].includes(c?.cause) ? "hold" : "regenerate") : "repair";
    if (c?.kind === "writer_null" && c?.reason === "duplicate") return "hold";
    const budget = RepairPlan.RepairBudget && c?.budget instanceof RepairPlan.RepairBudget ? c.budget : undefined;
    const failure = c?.kind === "writer_null"
      ? { kind: "writer_null", cause: c.cause === "unknown" ? "writer_null" : c.cause, blockId: c.targetId, target: c.targetId, nullReason: c.reason }
      : { kind: "semantic", cause: "t5_low", target: c?.targetId, t5: true };
    const r = RepairPlan.nextRepairStep({ failures: [failure], budget, ...(budget ? { signatures: budget.signatures } : {}) });
    if (c) c.loopReason = r?.reason; // 보류 사유(내용 없는 코드) — 호출 지점이 건너뛴 대상을 메트릭에 남긴다
    // 작성자 null 블록은 정규화할 봉투가 없다 — 제어기가 code_normalize/sol_repair 를 골라도 의미 있는 조치는 재생성 한 번뿐이다.
    if (c?.kind === "writer_null") return ["regenerate_missing", "code_normalize", "sol_repair"].includes(r?.action) ? "regenerate" : "hold";
    return r?.action && r.action !== "none" ? "repair" : "hold";
  };
  const loopMetrics = b => RepairPlan?.metricsOf ? RepairPlan.metricsOf(b) : null;

  // 단계 로직이나 알림 모양을 바꾸면 올린다. 단계 캐시 키(promptVersion 자리)에 들어간다.
  const VERSION = "stages-5";
  // 계획 호출 상한(ms): 무료 Supabase Edge 의 150초 안. 1차(추론형) 100초 + 대체(작성 모델) 140초.
  const PLAN_PRIMARY_MS = 100000, PLAN_FALLBACK_MS = 140000;
  const SPEC = NoteContract.NOTE_SPEC_VERSION;
  // /v1/judge 상한: 요청당 항목 200, items JSON 64KiB(server/index.js). 한글은 글자당 3바이트라 개수만으로는 부족해 바이트도 센다.
  const JUDGE_ITEMS = 200, JUDGE_BYTES = 60000, JUDGE_CHARS = 8000;
  // T5 복구의 전역 작업 예산: 근거 재연결 판정 항목 수 + 문장 수정 호출 수의 합계 상한(측정 전 제안값).
  // 넘으면 그 주장은 삭제가 아니라 확인 필요(pending)로 둔다.
  const SUPPORT_BUDGET = 40;
  // 실패 루프 금액 상한(실측 전 제안값 — run 상한 $1.50 와 같은 수준). 실행 요청이 deps.loopMaxUsd 로 넘기면 그 값을 쓴다.
  const LOOP_MAX_USD = 1.5;
  // 전역 Writer 입력 상한(server/prompts.js globalInput 24k 토큰 × 4바이트)보다 넉넉히 작게 잡는다(6-4).
  const GLOBAL_BYTES = 80000;
  // 섹션을 나눠 다시 보내면 풀리는 서버 오류(§12.4): 출력 잘림, 입력 상한 초과.
  const SPLIT = new Set(["llm_output_truncated", "request_too_large"]);
  const ALIAS = { llm_output_truncated: "LLM_TRUNCATED" };
  const enc = new TextEncoder();
  const uniq = list => [...new Set(list)];
  const kept = s => s.status == null || s.status === "kept";
  const bytes = v => enc.encode(JSON.stringify(v)).length;

  // summary.js gapRanges 이식: 시각 순으로 세워 같은 이유가 연달아 이어진 것은 한 구간으로 합친다. 없는 구간을 지어내지 않도록 기록된 시각만 쓴다.
  // ponytail: 이유가 같으면 사이가 멀어도 한 구간이다(v1 과 같다). 멀리 떨어진 같은 이유 구간을 따로 보여 주려면 여기서 t0 <= last.t1 을 요구한다.
  function gapRanges(gaps) {
    const out = [];
    for (const g of (gaps || []).filter(g => Number.isFinite(g?.t0)).sort((a, b) => a.t0 - b.t0)) {
      const reason = String(g.reason || "unknown").slice(0, 40), t1 = Math.max(g.t0, Number.isFinite(g.t1) ? g.t1 : g.t0), last = out.at(-1);
      if (last?.reason === reason) last.t1 = Math.max(last.t1, t1);
      else out.push({ reason, t0: g.t0, t1 });
    }
    return out;
  }

  // 판정 항목을 개수와 바이트 상한 안의 묶음으로 나눈다. 항목 하나가 상한을 넘는 일은 없다(항목당 8000자 ≤ 24KB).
  function batches(items) {
    const out = [];
    let cur = [], size = 2;
    for (const it of items) {
      const n = bytes(it) + 1;
      if (cur.length && (cur.length >= JUDGE_ITEMS || size + n > JUDGE_BYTES)) { out.push(cur); cur = []; size = 2; }
      cur.push(it); size += n;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  // 봉투 안의 주장({text, evidenceIds, basis})을 경로와 함께 모은다. 근거 지지(T5)와 전역 입력 요약이 쓴다.
  function claimsIn(node, path = "", out = []) {
    if (node && typeof node === "object" && !Array.isArray(node) && typeof node.text === "string" && Array.isArray(node.evidenceIds) && typeof node.basis === "string") {
      out.push({ path, claim: node }); return out;
    }
    if (Array.isArray(node)) node.forEach((v, i) => claimsIn(v, `${path}/${i}`, out));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) claimsIn(v, `${path}/${k}`, out);
    return out;
  }
  // 전역 Writer 입력(6-4): 근거 원문 대신 살아남은 블록의 주장 텍스트와 참조. 크면 블록당 주장 수와 길이를 줄여 상한 안에 둔다.
  // withPath 는 연결 편집(link) 입력용 — 주장마다 봉투 안 경로를 얹어 제안이 주장을 가리킬 수 있게 한다.
  function globalSections(survivors, limit = GLOBAL_BYTES, withPath = false) {
    const steps = [[12, 600], [6, 300], [3, 200], [1, 160]];
    for (let i = 0; i < steps.length; i++) {
      const [perBlock, chars] = steps[i];
      const sections = survivors.map(s => ({
        sectionId: s.sectionId, title: s.title, gist: s.gist ? { text: s.gist.text.slice(0, chars), evidenceIds: s.gist.evidenceIds, basis: s.gist.basis } : null,
        blocks: s.blocks.map(b => ({
          blockId: b.id, type: b.type,
          claims: claimsIn(b.envelope.content).slice(0, perBlock).map(({ path, claim }) => ({ ...(withPath ? { path } : {}), text: claim.text.slice(0, chars), evidenceIds: claim.evidenceIds, basis: claim.basis })),
        })),
      }));
      const sz = bytes(sections);
      if (sz <= limit) {
        Object.defineProperty(sections, "shrink", {
          value: { step: i + 1, perBlock, chars, bytes: sz, limit },
          writable: true, configurable: true, enumerable: false,
        });
        return sections;
      }
    }
    return null;
  }

  // 서비스 오류 코드(소문자)를 파이프라인 코드(영역_원인)로 접는다. 이미 코드가 있는 오류는 그대로, 코드가 없는 오류(버그)는 null.
  function codeFor(e, area) {
    const c = Pipeline.codeOf(e, area);
    if (c || typeof e?.code !== "string") return c;
    const up = e.code.toUpperCase().replace(/\W/g, "_");
    return ALIAS[e.code] ?? (up.startsWith(area + "_") ? up : `${area}_${up}`).slice(0, 64);
  }
  const asCoded = (e, area) => Pipeline.codeOf(e, area) || typeof e?.code !== "string" ? e : Pipeline.pipelineError(codeFor(e, area), { cause: e });
  // 이 오류는 섹션 하나가 아니라 작업 전체를 멈춘다: 일시정지 사유가 있는 코드(한도·네트워크·차단기 등)와 버그. 완료된 호출은 캐시에 남아 재개가 싸다.
  // 제공자의 형식 실패(provider_failed_or_invalid_output)는 그 요청만의 문제다 — 재시도를 다 써도 LLM_UNAVAILABLE(일시정지)로 작업 전체를 멈추지 않고 그 섹션만 뺀다.
  // 정말로 제공자가 죽었다면 모든 섹션이 실패하고 "한 섹션도 못 썼다"에서 멈춘다.
  const halting = (e, area) => { if (e?.code === "provider_failed_or_invalid_output") return false; const c = codeFor(e, area); return !c || Boolean(Pipeline.CODES[c]?.pause); };
  const scoped = (events, jobId) => ({ emit: e => events.emit({ jobId, ...e }), span: f => events.span({ jobId, ...f }) });
  const must = ok => { if (!ok) throw Pipeline.pipelineError("VAL_OUTPUT_INVALID"); };
  const policyOf = o => NoteContract.policyOf(o);

  async function runNote(job, input, deps = {}) {
    const { slides = [], transcript, gaps = [], tier, models = {}, consent } = input ?? {};
    const options = policyOf(input?.options), recognition = input?.recognition === "cloud" ? "cloud" : "local";
    // 판정은 유료이면서 판정 모델이 있을 때만 한다. 서버가 judge 기능을 끄면(/v1/me features) 호출자가 모델을 비워 판정 없이 진행한다(설계 §17 기능 스위치).
    const runTag = deps.runTag ?? Math.random().toString(36).slice(2, 10);
    // mis-sol-hai (L3): 강조 신호가 켜지면 JEV judging(중요도·근거 지지)을 끈다(D10).
    const emphasisSignals = deps.emphasisSignals === true || input?.options?.emphasisSignals === true;
    const judged = tier === "paid" && Boolean(models.judge) && !emphasisSignals, signal = deps.signal, ev = scoped(deps.events ?? job.events, job.jobId);
    // T5 평가 경로(§4.4): judgeShadow 면 판정·계측만 하고 본문을 바꾸지 않는다. supportBudget 은 복구 작업 전역 상한 재정의다.
    const judgeShadow = deps.judgeShadow === true || input?.options?.judgeShadow === true;
    const supportBudget = Number.isInteger(deps.supportBudget) && deps.supportBudget >= 0 ? deps.supportBudget : SUPPORT_BUDGET;
    // §3 연결 편집과 본문 확정 뒤 문항은 draft 경로(deps.writer==="draft", W2-A)에서 linkEditor 원격 스위치가 켜졌을 때만 — blocks 경로는 기존 그대로다.
    const linkEdit = deps.linkEditor === true && deps.writer === "draft";
    const rerun = Number.isInteger(input?.rerun) && input.rerun > 0 ? input.rerun : 0;
    const segments = transcript?.segments ?? [];
    if (job.state === "created") await job.transition("acquiring_source");
    if (job.state === "acquiring_source") await job.transition("ingesting");
    // 고지의 ranges 는 {t0,t1} 만 받는다(note 계약) — 이유는 구간 머지에만 쓰고 여기서 벗긴다.
    const ranges = gapRanges(gaps), gapNotices = ranges.length ? [{ code: "NOTE_CAPTURE_GAP", count: ranges.length, ranges: ranges.map(({ t0, t1 }) => ({ t0, t1 })) }] : [];

    // 요약 동의가 없으면 서비스를 부르지 않고 인식 결과만 돌려준다(§5.2, recognitionResult 이식). 다른 엔진·경로로 조용히 넘어가지 않는다 —
    // 작업은 사용자 사유로 일시정지하고, 동의한 뒤 job.resume() 과 같은 입력의 runNote 로 이어 간다.
    if (consent?.summary !== true) {
      if (!["paused", "done", "failed", "cancelled"].includes(job.state)) await job.transition("paused", { reason: "user", code: "CONSENT_SUMMARY_REQUIRED" });
      const usable = Boilerplate.detect(slides).slides;
      const recognition = {
        slides: usable.map(s => ({ slideId: String(s.slideId), t0: s.t0, t1: s.t1 ?? null, text: Preprocess.slideText(s) })).filter(s => s.text),
        segments: segments.filter(kept).map(({ t0, t1, text }) => ({ t0, t1: t1 ?? t0, text: String(text ?? "").trim() })).filter(s => s.text),
      };
      return { status: "recognition-only", note: null, recognition, notices: [...gapNotices, { code: "CONSENT_SUMMARY_REQUIRED" }], counts: { slides: slides.length, segments: recognition.segments.length } };
    }
    if (!deps.service || typeof deps.katex?.renderToString !== "function") throw new TypeError("service 와 katex 가 필요합니다.");
    if (!models.plan || !models.write) throw new TypeError("계획·작성 모델이 필요합니다.");
    const breaker = deps.breaker ?? Pipeline.createBreaker();
    const wait = ms => deps.sleep ? deps.sleep(ms, signal) : new Promise((res, rej) => {
      const t = setTimeout(res, ms);
      signal?.addEventListener("abort", () => { clearTimeout(t); rej(signal.reason); }, { once: true });
    });
    const ctx = { signal, out: {}, cacheStats: deps.cacheStats ?? null };
    // devNoteMode 실험(deps.noteMode): 네 모드 모두 단계·호출 캐시를 우회한다 — 웜 캐시가 비교를 오염시키고,
    // session 계열 모드에서는 계획 캐시 적중이 서버가 모르는 history 결손을 만든다(재개도 전 단계 재계산이라 안전하다).
    // session 계열 모드의 대화 봉투는 실행 메모리에만 두고 run 이 끝나면 버린다 — 저장·로그 어디에도 남지 않는다.
    // deps.noteMode(devNoteMode)가 켜져 있는데 네 모드가 아니면 읽기에 실패한 것이다 — 기본 경로로 조용히 넘어가지 않고 멈춘다.
    if (deps.noteMode != null && deps.noteMode !== "" && !NoteProfiles.get(deps.noteMode)) throw Pipeline.pipelineError("NOTE_MODE_INVALID");
    const noteMode = deps.noteMode || null;
    // sol-luna-3 개선 실험 옵션(devNoteV3 → deps.noteV3): 정규화된 기본값으로 두고 각 실험이 ctx.v3 로 읽는다.
    ctx.v3 = NoteV3.v3Options(deps.noteV3);
    // 재개 실험(resume): sol-luna-3 + resume 일 때만 호출 산출물을 암호화 typed 체크포인트로 재사용한다.
    // 단계 캐시는 계속 우회한다 — planning 을 재사용하면 세션 접두 P 없는 실행이 이어져 멈춘다(P·encrypted reasoning 은 저장하지 않는다).
    const resumeOn = NoteV3.isV3(noteMode) && ctx.v3.resume === true;
    // v2 모드의 단계→모델 표(공유 계약 — 서버도 같은 표를 강제한다)는 lib/note-profiles.js 의 프로파일이 단일 출처다.
    // models.write 하나로 검수까지 바꾸지 않는다. sol-luna-2·sol-luna-3: plan·review·global·repair = Sol(P 이어감),
    // draft·questions = Luna High(독립 호출). sol-fork-2 : 전 단계 Sol, 각 호출 = 고정 접두 P + 자기 작업. 대체 모델·조용한 폴백 없음.
    const V2 = NoteProfiles.isV2(noteMode);
    // 렌더 HTML 검수(mis-sol-hai, 기획 §4.7 D8): 프로파일이 reviewInput "html" 을 선언하면 Sol review 입력은
    // 주장 축약이 아니라 CSS·스크립트·크롭 바이트를 뺀 렌더 HTML이다 — Sol이 사용자가 보는 노트 그대로를 본다.
    const htmlReview = V2 && NoteProfiles.get(noteMode)?.reviewInput === "html";
    const modelFor = stage => V2 ? NoteProfiles.stageModel(noteMode, stage) : models.write;
    // sol-fork·v2 도 봉투를 싣는다 — 계획 호출은 sol-session 과 같고, 그 응답의 history 가 고정 접두(prefix)가 된다.
    // 이후 쓰기 호출은 전부 그 접두만 싣는다 — 이어 붙이지 않아 입력 크기가 일정하고 제공자 접두 캐시가 매 호출 읽힌다.
    // sol-luna-2 의 Luna 호출(draft·questions)은 봉투를 아예 싣지 않는다 — Sol 의 history·encrypted reasoning 을 넘기지 않는다.
    const session = NoteProfiles.get(noteMode)?.session
      ? { id: globalThis.crypto.randomUUID(), mode: noteMode, history: [], prefix: null, warm: null, tail: Promise.resolve() } : null;
    const fork = NoteProfiles.get(noteMode)?.session === "fork";
    if (noteMode) { ctx.bypassCache = true; ev.emit({ stage: "job", level: "info", code: "NOTE_MODE", msg: noteMode }); }
    const R = () => ctx.out.refining;

    let scored;
    const units = () => scored ??= R().ir.units.map(u => {
      const s = ctx.out.judging.importance[u.unitId];
      return typeof s === "number" ? { ...u, judge: { ...u.judge, importance: s } } : u;
    });
    // 강의 원어: 발화(없으면 슬라이드 글)에서 라틴 글자가 한글 음절의 4배를 넘으면 영어 강의다. 영어 강의는 작성 요청에 sourceLang "en" 을 싣는다.
    // ponytail: 글자 수 비율만 본다 — 한국어 발화에 영어 슬라이드인 강의는 한국어로 친다. 다른 언어가 필요해지면 STT 감지 언어를 쓴다.
    let lang;
    const sourceLang = () => lang ??= (() => {
      const speech = R().ir.units.map(u => u.speech).join(" "), text = speech.trim().length >= 200 ? speech : R().ir.units.map(u => `${u.slideText} ${u.speech}`).join(" ");
      const ko = (text.match(/[가-힣]/g) || []).length, latin = (text.match(/[A-Za-z]/g) || []).length;
      return latin > 4 * ko ? "en" : "ko";
    })();
    const langBody = () => sourceLang() === "en" ? { sourceLang: "en" } : {};
    // 영어 강의 출력의 주장 src 를 떼어 {경로: src} 로 돌려준다(노트 검증·조립은 src 없는 주장만 안다). 경로는 /blocks/<id><봉투 안 경로>.
    const splitSrc = out => {
      const src = {};
      for (const { path, claim } of claimsIn(out)) if (Object.hasOwn(claim, "src")) { if (typeof claim.src === "string" && claim.src.trim()) src[path] = claim.src; delete claim.src; }
      return src;
    };
    // 섹션 Writer 입력: 섹션 유닛과 허용된 교차 유닛의 근거, 그 유닛에 나온 수식(서버 상한 200건)·도표.
    const ownUnits = sec => new Set([...sec.unitIds, ...sec.crossUnitIds]);
    const evidenceFor = sec => { const us = ownUnits(sec); return R().evidence.filter(e => us.has(e.unitId)); };
    const regFor = sec => { const us = ownUnits(sec); return R().registry.filter(e => (R().formulaUnits[e.id] || []).some(u => us.has(u))).slice(0, 200).map(e => ({ id: e.id, latex: e.latex ?? null, status: e.status })); };
    const figsFor = sec => { const us = ownUnits(sec); return R().figures.filter(f => us.has(f.unitId)).slice(0, 50).map(f => ({ id: f.id, kind: f.kind, title: f.title ?? null, cells: f.cells ? f.cells.slice(0, 30).map(r => r.slice(0, 6).map(c => String(c).slice(0, 200))) : null })); };
    // 미판독 필기 크롭(mis-sol-hai §4.6): 슬라이드의 inkImages(메모리만, blob)를 data URL 로 실어
    // 그 영역의 handwriting 근거 id 와 짝지어 draft 요청에 넣는다 — 요청 뒤 참조는 끊긴다(저장·캐시 없음).
    const dataUrl = async blob => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return `data:${blob.type || "image/jpeg"};base64,${btoa(bin)}`;
    };
    // 필기 영역 이미지(§4.2): 근거 항목과 이미지는 반드시 짝을 이룬다 — 상한(장당 1.5M자·총 20장) 밖의
    // 영역은 근거("이미지로 전달")도 함께 뺀다. 모델이 없는 이미지를 봤다고 착각하지 않게.
    const inkImagesFor = async sec => {
      const us = ownUnits(sec), images = [], dropped = new Set();
      const unitBySlide = new Map(R().ir.units.filter(u => u.slideId != null).map(u => [String(u.slideId), u.unitId]));
      for (const sl of R().mergedSlides ?? []) {
        if (!Array.isArray(sl?.inkImages) || !sl.inkImages.length) continue;
        const uid = unitBySlide.get(String(sl.slideId));
        if (!uid || !us.has(uid)) continue;
        for (const [i, r] of sl.inkImages.entries()) {
          const e = R().evidence.find(e => e.unitId === uid && e.sourceId === `ink${i + 1}`);
          if (!e) continue;
          const image = r?.blob ? await dataUrl(r.blob) : null;
          if (!image || image.length > 1500000 || images.length >= 20) { dropped.add(e.id); continue; }
          images.push({ id: e.id, image });
        }
      }
      return { images, dropped };
    };
    // 근거 메타 사이드카(mis-sol-hai §4.6): 강조 신호 모드에서만 단다 — 유닛 출처·필기 여부·강조 점수(강조어+재방문, 상한 1).
    // 노트에 없으면 렌더의 강조 표시가 전부 꺼진다(L4 — 사이드카 없는 노트는 기존 렌더와 같다).
    const evidenceMetaOf = () => {
      if (!emphasisSignals) return null;
      const byUnit = computePlanEmphasis()?.byUnit ?? new Map();
      const meta = {};
      for (const u of R().ir.units) {
        const e = byUnit.get(u.unitId);
        meta[u.unitId] = {
          source: u.slideId ? "slide" : "speech",
          ink: R().evidence.some(v => v.unitId === u.unitId && v.kind === "handwriting"),
          emphasis: e ? Math.min(1, (e.stressHits || 0) + (e.revisits || 0)) : null,
        };
      }
      return meta;
    };
    // stress 강조 표시(mis-sol-hai §4.6): 발화 원문 한 줄(40자)·인용 발화 근거 수 repeat 를 코드가 단다.
    // 모델이 쓴 repeat 는 믿지 않는다 — assembleNote 가 인용 발화 수와 대조해 다르면 버린다.
    const injectMarks = secs => {
      if (!emphasisSignals) return;
      const Em = need("Emphasis", "./emphasis.js");
      const stress = t => typeof t === "string" && (Em?.EMPHASIS_WORDS?.stress?.test(t) || Em?.EMPHASIS_WORDS?.exam?.test(t));
      const evById = new Map(R().evidence.map(e => [e.id, e]));
      const fix = b => {
        for (const em of b?.emphasis ?? []) {
          if (em?.kind !== "stress" || !Array.isArray(em.evidenceIds)) continue;
          const cited = em.evidenceIds.map(id => evById.get(id)).filter(e => e?.kind === "speech");
          if (cited.length >= 2) em.repeat = cited.length; else delete em.repeat;
          if (em.quote == null) {
            const hit = cited.find(e => stress(e.text));
            if (hit) em.quote = [...String(hit.text)].slice(0, 40).join("");
          }
        }
      };
      for (const s of secs) for (const b of Object.values(s?.output?.blocks ?? {})) fix(b);
    };
    // deps.promptVersions(=/v1/me 응답의 작업별 서버 프롬프트 버전)를 단계·호출 캐시 키에 섞는다 — 서버 프롬프트만 바뀌어도
    // 같은 입력의 낡은 결과를 재사용하지 않는다(§7). 버전을 모르면(구 서버·오프라인) 캐시를 쓰지 않는 쪽이 안전하다.
    const pv = deps.promptVersions && typeof deps.promptVersions === "object" ? deps.promptVersions : null;
    const srvV = task => { const v = pv?.[task]; return typeof v === "string" && v ? v.slice(0, 32) : null; };
    // tasks: 이 단계가 기대는 서버 작업. 하나라도 버전을 모르면 이번 실행만의 태그를 붙여 재사용을 막는다(실패 안전).
    const K = async (value, model = null, schemaVersion = SPEC, tasks = []) => {
      const missing = tasks.some(t => srvV(t) === null);
      const tag = tasks.length ? "|" + tasks.map(t => srvV(t) ?? "?").join("|") : "";
      return { inputDigest: await Pipeline.digest(value), model, promptVersion: VERSION + tag + (missing ? "?" + runTag : ""), schemaVersion };
    };
    const stage = (state, area, key, run) => ({ state, area, key, run: async c => { try { return await run(c); } catch (e) { throw asCoded(e, area); } } });

    // v2 사전검사(§3): 두 모드는 writer=draft 경로와 통합 검수(review) 단계가 켜진 서버에서만 돈다 —
    // 미지원 서버·기능 누락이면 다른 경로로 조용히 넘어가지 않고 명시적 코드로 멈춘다.
    if (V2 && (deps.writer !== "draft" || srvV("review") === null)) {
      ev.emit({ stage: "job", level: "error", code: "NOTE_V2_UNSUPPORTED", msg: `writer=${deps.writer ?? "-"} review=${srvV("review") ?? "-"}` });
      throw Pipeline.pipelineError("NOTE_V2_UNSUPPORTED");
    }
    // v2 편집 계획 — 계획 응답 {plan, editorialPlan, noteSession} 의 가운데 칸. 실행 메모리에만 두고
    // 저장되는 Note·단계 캐시·로그·telemetry 에 싣지 않는다. 계획 응답에서만 채택한다(쓰기 응답이 덮지 않는다).
    let editorial = null;
    // editorialPlan(v:1) 최소 검사 — 진짜 스키마·교차 검증은 계약 담당(lib/note-contract.js)이 정한다.
    // 여기는 섹션 범위(계획 섹션과 정확히 같은 집합)와 모양만 확인한다 — 모르는 섹션 id·누락·중복은 거절이다.
    const epOk = (ep, plan) => {
      const v = NoteContract.validateEditorialPlan;
      if (typeof v === "function") {
        // 근거 id(항목·유닛)와 자산 id(입력 도표 + 계획 블록의 figureIds) 집합을 실제 입력에서 만들어 넘긴다 — 모르는 id 는 계약 검증기가 거절한다.
        const evidenceIds = [...R().evidence.map(e => e.id), ...R().ir.units.map(u => u.unitId)];
        const assetIds = [...R().figures.map(f => f.id), ...(plan.sections ?? []).flatMap(sec => (sec.blocks ?? []).flatMap(b => Array.isArray(b.figureIds) ? b.figureIds : []))];
        const r = v(ep, plan, evidenceIds, assetIds); return r === true || r?.ok === true;
      }
      if (!ep || typeof ep !== "object" || ep.v !== 1 || !Array.isArray(ep.sections)) return false;
      const ids = new Set(plan.sections.map(s => s.sectionId));
      return ep.sections.length === ids.size && new Set(ep.sections.map(e => e?.sectionId)).size === ep.sections.length
        && ep.sections.every(e => e && typeof e === "object" && ids.has(e.sectionId))
        && (ep.glossary === undefined || Array.isArray(ep.glossary));
    };

    // 서비스 호출 한 건. 본문 해시가 같으면 패키지 캐시의 결과를 다시 쓴다 — 서버는 같은 requestId 를 409 로 막고 결과를 저장하지 않으므로,
    // 일시정지 뒤 재개나 취소 뒤 재실행에서 이미 돈을 낸 호출을 다시 보내면 안 된다. requestId = 본문 해시 + rerun, 재시도마다 retryId.
    // session 실험: sol-session·sol-luna-tool 은 plan·write 호출을 session.tail 한 줄로 세운다 — 대화 history 가 항상
    // 서버가 돌려준 최신 순서다. sol-fork 는 다르다: 쓰기 호출이 같은 고정 접두만 공유해 서로 독립이라 tail 에 세우지 않는다.
    // 응답 봉투는 id·mode·history 모양이 맞을 때만 받는다 — 어긋나면 이어지는 호출이 전부 오염되므로 실험을 멈춘다.
    // adopt: "history"=다음 호출이 이어 붙일 대화로 채택(연쇄 모드 전부·fork 계획 재시도),
    //        "prefix"=fork 고정 접두로 채택(fork 계획 성공 응답 한 번), "check"=모양만 검사하고 버림(fork 쓰기 응답).
    const adoptSession = (ns, adopt = "history") => {
      if (!ns || ns.v !== 1 || ns.id !== session.id || ns.mode !== session.mode || !Array.isArray(ns.history) || ns.history.length > 512)
        throw Pipeline.pipelineError("LLM_SESSION_INVALID");
      if (adopt === "prefix") session.prefix = ns.history;
      else if (adopt === "history") session.history = ns.history;
    };
    async function call(method, label, model, body, area, shape, extra = {}) {
      const inputDigest = await Pipeline.digest({ label, model, body });
      // 호출 캐시의 프롬프트 버전은 단계 버전 + 그 작업의 서버 프롬프트 버전이다(write 는 stage 별 버전). 서버 버전을 모르면
      // 캐시를 읽지도 쓰지도 않는다 — 낡은 프롬프트의 결과를 재사용할 수 없으므로 안전한 쪽(§7). 실험 모드에서도 읽지도 쓰지도 않는다.
      const promptVersion = srvV(method === "write" && typeof body?.stage === "string" ? body.stage : method);
      // sol-luna-2: draft·questions 는 Luna High 독립 호출 — Sol 의 noteSession 봉투를 싣지 않는다(§6).
      const lunaCall = NoteV3.isLunaV2(noteMode) && method === "write" && (body?.stage === "draft" || body?.stage === "questions");
      // sol-luna-3 수리 패킷(repair=packet): 작은 자급 packet 만 싣는 독립 Sol 요청 — P 이력·세션 봉투를 싣지 않는다(§5).
      const packetCall = NoteV3.isV3(noteMode) && body?.packet != null;
      // 프로파일이 그 단계를 독립 호출로 선언하면 세션 봉투를 싣지 않는다(mis-sol-hai 는 draft·questions 가 Haiku 독립).
      // dual(repair): 세션이면 Sol 세션 호출, 세션을 타지 않는 호출(재작성이 alt 모델로 올 때)은 봉투 없는 독립 호출이다 — 봉투+독립 패킷을 함께 싣지 않는다.
      const spec = NoteProfiles.get(noteMode)?.stages?.[body?.stage];
      const independent = spec?.transport === "independent" || (spec?.transport === "dual" && model === spec?.alt);
      const stats = ctx.cacheStats, onSession = session !== null && !lunaCall && !packetCall && !independent && (method === "plan" || method === "write");
      // resume: 대화를 세우는 호출(계획·편집 계획)은 매번 새로 보낸다 — 캐시 적중으로 접두 없는 세션이 되는 걸 막는다.
      // 그 밖의 호출 결과는 typed 체크포인트로 재사용한다 — 키는 본문 내용 해시라 실행 식별자(세션·requestId·시각)가 없다.
      const buildsSession = onSession && (method === "plan" || label === "editorial");
      const key = promptVersion === null || (noteMode !== null && !(resumeOn && !buildsSession)) ? null
        : await Pipeline.stageKey({ stage: "call." + label, inputDigest, model, promptVersion: `${VERSION}+${promptVersion}`, schemaVersion: SPEC });
      // 실행마다 다른 runTag 를 섞는다: 이어 하기·다시 시도가 앞선 실행이 쓴 requestId(서버에 예약이 남은)와 겹치지 않게. 끝난 호출은 위 캐시가 막아 다시 결제하지 않는다.
      const base = `${label}-${(await Pipeline.digest({ inputDigest, rerun, runTag })).slice(0, 32)}`;
      const send = n => {
        const o = { ...body, model, requestId: Pipeline.retryId(base, n), signal, jobId: job.jobId, ...(V2 && method === "write" ? { noteMode } : {}), ...extra };
        if (!onSession) return deps.service[method](o);
        // sol-fork: 계획 호출은 sol-session 과 같이 자기 history(재시도는 이어진 대화)를 싣고, 쓰기 호출은
        // 계획이 남긴 고정 접두만 싣는다 — 응답 history 는 어떤 경우에도 접두를 대체하지 않는다.
        const history = fork && method === "write" && label !== "editorial" ? session.prefix : session.history;
        // 접두가 없는데 쓰기를 보내면 그 호출은 사실상 독립 호출이다 — 조용한 폴백 대신 코드 이벤트로 멈춘다
        // (서버도 같은 요청을 request_rejected 로 거절한다). 계획 실패는 어차피 계획 단계가 작업을 멈추므로 여긴 이중 안전장치다.
        if (fork && method === "write" && label !== "editorial" && !history?.length) {
          if (!session.prefixWarned) { session.prefixWarned = true; ev.emit({ stage: "write", level: "error", code: "NOTE_FORK_NO_PREFIX" }); }
          throw Pipeline.pipelineError("NOTE_FORK_NO_PREFIX");
        }
        // v2 의 계획 응답은 접두가 아니라 이어 쓸 대화다 — 접두 P 는 편집 계획(editorial) 응답이 완성한다.
        const adopt = fork ? (label === "editorial" || (method === "plan" && !V2) ? "prefix" : method === "plan" ? "history" : "check") : "history";
        return deps.service[method]({ ...o, noteSession: { v: 1, id: session.id, mode: session.mode, history } })
          .then(r => (adoptSession(r?.noteSession, adopt), r),
            e => { try { if (e?.noteSession) adoptSession(e.noteSession, fork && method === "write" && label !== "editorial" ? "check" : "history"); } catch {} throw e; });
      };
      const attempt = () => Pipeline.withRetry(
        n => breaker.run(model, () => send(n), { area }),
        { signal, sleep: deps.sleep },
      );
      // 제공자가 바쁘면(재시도를 다 쓴 429·5xx, 열린 차단기) 조금 기다렸다 다시 한다. 열린 차단기는 닫힐 때까지, 반열림 시험 호출은 한 건뿐이라 동시 호출은 몇 번 더 본다.
      // 필드: 429 는 1분 안에 풀렸는데 열린 차단기 오류가 곧바로 작업 전체를 일시정지시켰다. 끝내 바쁘면 호출자가 대체 모델·일시정지를 고른다.
      const patient = async () => {
        for (let k = 0; ; k++) {
          try { return await attempt(); } catch (e) {
            // 제공자의 형식 실패는 그 요청만의 문제라 기다려도 같다(halting 참고).
            if (!((e?.retryable === true && e.code !== "provider_failed_or_invalid_output") || e?.code === `${area}_CIRCUIT_OPEN`) || k >= 4) throw e;
            await wait(Math.max(e.retryAfterMs ?? 0, 5000));
          }
        }
      };
      // session 호출은 재시도·대기까지 통째로 한 칸씩만 나간다 — 진행 중인 호출이 끝나기 전엔 다음 요청의 history 를 정할 수 없다.
      // sol-fork 쓰기는 예외: 고정 접두만 공유하는 독립 호출이라 tail 에 세우지 않고 일반 write 레인으로 병렬 실행한다.
      // 다만 첫 쓰기 호출은 단독으로 끝낸다 — 접두는 한 호출이 써야 제공자 프롬프트 캐시에 잡히므로(웜업 게이트).
      // 첫 호출이 실패해도 게이트는 열리고, 나머지 호출의 재시도·분할 사다리는 각자 돈다.
      const whole = () => {
        if (!onSession) return patient();
        if (fork) {
          if (method === "plan" || label === "editorial") return patient(); // 계획·편집 계획은 한 건씩 차례로 — 한 줄로 세울 다음 호출이 없다(웜업 게이트는 첫 작성 호출의 것)
          if (!session.warm) { const p = patient(); session.warm = p.then(() => {}, () => {}); return p; }
          return session.warm.then(patient);
        }
        const p = session.tail.then(patient);
        session.tail = p.then(() => {}, () => {});
        return p;
      };
      // 서버가 요청 계약 위반(request_rejected)으로 거절하면 어긋난 칸의 경로(내용 없음)를 코드 이벤트로 남긴다 — 어느 칸인지 알아야 고친다.
      const compute = async () => {
        try {
          const r = await whole(), out = shape(r);
          // 루프 예산이 기록할 실제 비용 — 응답 usage.costUsd 를 열거 불가 칸으로 붙인다(캐시·직렬화에 섞이지 않게).
          if (out && typeof out === "object") try { Object.defineProperty(out, "usd", { value: typeof r?.usage?.costUsd === "number" ? r.usage.costUsd : null, enumerable: false }); } catch {}
          return out;
        } catch (e) {
          if ((e?.code === "request_rejected" || e?.code === "unexpected_field") && typeof e.detail === "string")
            ev.emit({ stage: "write", level: "warn", code: "REQUEST_REJECTED_DETAIL", msg: `${label} ${e.detail}`.slice(0, 200) });
          throw e;
        }
      };
      if (key === null) { if (stats) stats.misses++; return compute(); }
      return resumeOn
        ? NoteResume.cached(job.store, { packageId: job.packageId, scope: "call." + label, key, signal, stats }, compute)
        : Pipeline.cached(job.store, key, compute, { packageId: job.packageId, signal, stats });
    }
    const settle = (results, area) => {
      signal?.throwIfAborted();
      const bad = results.find(r => r.status === "failed");
      if (bad) throw asCoded(bad.error, area);
      return results.map(r => r.value);
    };
    const lanes = name => Pipeline.laneCount(name, deps.concurrency);
    // 응답 시간 초과(클라이언트 120초·서버 150초). 사용자 취소(작업 signal)는 아니다. 섹션은 나눠 다시 쓰고, repair·전역 글은 그 부분만 빼고 노트를 마친다.
    const timedOut = e => !signal?.aborted && (e?.name === "AbortError" || e?.code === "request_cancelled_or_timed_out");
    // 이벤트에 싣는 안전한 오류 표시: 코드(없으면 이름)와 HTTP 상태뿐 — 메시지·응답 본문은 싣지 않는다.
    const errTag = e => `${e?.code ?? e?.name ?? "?"}${Number.isInteger(e?.status) ? ` http=${e.status}` : ""}`;
    // 대체 작성 모델(models.writeAlt, 다른 제공자): 주 모델이 시간 초과·잘림·형식/제공자 오류로 못 한 일을 한 번 더 맡는다.
    // 한도·인증·연결 끊김·취소처럼 작업을 멈춰야 하는 오류는 넘기지 않는다.
    // 실험 모드에서는 켜지 않는다 — 고정 모델 조건이 무너지면 측정이 아니라 다른 모델을 섞은 결과가 된다.
    const ALT = noteMode === null && models.writeAlt && models.writeAlt !== models.write ? models.writeAlt : null;
    const recoverable = e => timedOut(e) || SPLIT.has(e?.code) || !halting(e, "LLM");
    // 주 모델이 바쁨(재시도를 다 쓴 429·5xx, 열린 차단기)이면 작업을 멈추지 않고 대체 모델에 넘긴다 — 차단기는 모델별이라 대체 모델은 따로 센다.
    // 필드: 작성 모델 429 여섯 번에 차단기가 열려 작업 전체가 network 일시정지했다. 대체 모델도 바쁘면 그때 멈춘다.
    const busy = e => ["LLM_UNAVAILABLE", "LLM_CIRCUIT_OPEN"].includes(codeFor(e, "LLM"));
    const toAlt = (e, model) => !!ALT && model !== ALT && (recoverable(e) || busy(e));
    const altNote = (stage, unit, e, what) => ev.emit({ stage, ...(unit ? { unit } : {}), level: "warn", code: "ALT_MODEL", msg: `${what} ${timedOut(e) ? "timeout" : errTag(e)}`.slice(0, 80) });
    // 서버 응답은 쓰기 전에 다시 검증하고(§5.4) 캐시에는 검증을 통과한 부분만 넣는다.
    const asOutput = schema => r => (must(Contracts.validate(schema, r?.output).ok), r.output);
    const asResults = r => (must(Array.isArray(r.results) && r.results.every(x => Contracts.validate(Contracts.SCHEMAS.judgeResult, x).ok)), r.results);

    // ── C. 정제: 로컬, 순수 함수 ──
    const fd = input?.figureData ?? {};
    const refining = stage("refining", "LLM",
      () => K({ slides, segments: segments.map(({ t0, t1, text, status }) => ({ t0, t1, text, status })), katex: deps.katex.version ?? null, fd, fc: input?.formulaCrops ?? [], tier }, null, Contracts.CONTRACT_VERSION),
      async () => {
        const bp = Boilerplate.detect(slides); // 비파괴: 걸러낸 블록은 selection:"filtered" 로 남는다
        // ponytail: 재판독(reread)은 연결하지 않았다 — 검증에 실패한 수식은 바로 image(원본 크롭)로 내린다.
        const registry = Formulas.buildRegistry(bp.slides).map(e => Formulas.verify(e, { katex: deps.katex, reread: true }));
        const ir = Preprocess.buildIR(bp.slides, segments);
        // 병합된 슬라이드는 mergedFrom 으로 거슬러 올라간다(레지스트리·도표는 병합 전 슬라이드 id 를 쓴다).
        // mergedSlides 는 buildIR 안의 mergeProgressive 와 같은 산출이다 — 근거(inkImages→이미지 근거 id)가 이 목록에서 만들어진다.
        const mergedSlides = Preprocess.mergeProgressive(bp.slides);
        const owner = new Map();
        for (const m of mergedSlides) for (const id of [...(m.mergedFrom ?? []), m.slideId]) owner.set(String(id), String(m.slideId));
        const unitBySlide = new Map(ir.units.filter(u => u.slideId != null).map(u => [String(u.slideId), u.unitId]));
        const unitOf = s => unitBySlide.get(owner.get(String(s))) ?? null;
        const formulaUnits = Object.fromEntries(registry.map(e => [e.id, uniq([e.slideId, ...e.seenOn].map(unitOf).filter(Boolean))]));
        // Free 는 도표를 찾지 않는다(§14). 유료는 도표 레지스트리가 G# 와 표시 방식을 정한다(6-6).
        const figs = tier === "paid" ? Figures.buildFigureRegistry(bp.slides, { unitOf, evidence: ir.evidence, hashes: fd.hashes ?? {}, ocr: fd.ocr ?? {}, crops: fd.crops ?? [] }) : [];
        const cropMap = {};
        const fc = new Set(input?.formulaCrops ?? []);
        for (const e of registry) if (e.sourceId != null && fc.has(`${e.slideId}/${e.sourceId}`)) cropMap[e.id] = `${e.slideId}/${e.sourceId}`;
        for (const f of figs) if (f.cropKey && (fd.crops ?? []).includes(f.cropKey)) cropMap[f.id] = f.cropKey;
        const figures = figs.map(({ cropKey, ...f }) => f);
        if (ir.stats) {
          const s = ir.stats, rep = s.repeats ?? {};
          const msg = `raw=${s.rawChars} ir=${s.irChars} ratio=${s.ratio} filter=${s.filteredBlocks} dropSeg=${s.droppedSegments} mergeSlide=${s.mergedSlides} repFill=${rep.fillers ?? "-"} repStut=${rep.stutters ?? "-"} repWhisp=${rep.whisperRepeats ?? "-"}`;
          ev.emit({ stage: "refining", level: "info", code: "PREPROCESS_STATS", msg: msg.slice(0, 200) });
        }
        const fStats = { parseOk: 0, parseFail: 0, symMatch: 0, symMismatch: 0, unitOk: 0, unitMismatch: 0 };
        for (const e of registry) {
          if (e.checks?.parse === "ok") fStats.parseOk++;
          else if (e.checks?.parse === "failed") fStats.parseFail++;
          if (e.checks?.symbols === "match") fStats.symMatch++;
          else if (e.checks?.symbols === "mismatch") fStats.symMismatch++;
          if (e.checks?.units === "ok") fStats.unitOk++;
          else if (e.checks?.units === "mismatch") fStats.unitMismatch++;
        }
        ev.emit({ stage: "refining", level: "info", code: "FORMULA_CHECKS", msg: `parseOk=${fStats.parseOk} parseFail=${fStats.parseFail} symMatch=${fStats.symMatch} symMismatch=${fStats.symMismatch} unitOk=${fStats.unitOk} unitMismatch=${fStats.unitMismatch}` });
        return { ir: { units: ir.units, stats: ir.stats }, evidence: ir.evidence, registry, formulaUnits, figures, cropMap, mergedSlides };
      });

    // ── D. 판정: 유료만. Free 는 호출 없이 지나가는 빈 단계다 ──
    // ponytail: T2 유닛 중요도만 호출한다. T1·T3·T4 는 범위 밖이다. T5(근거 지지)는 검증 단계가 주장 단위로 부른다.
    // mis-sol-hai (L3): 프로파일/옵션에서 강조 신호가 켜지면 JEV judging(중요도·근거 지지)을 끈다(judged === false).
    const judging = stage("judging", "JDG", () => K({ paid: judged, units: R().ir.units }, judged ? models.judge : null, SPEC, judged ? ["judge"] : []), async () => {
      if (!judged) return { importance: {} };
      const items = R().ir.units.map(u => ({ itemId: u.unitId, text: `${u.slideText}\n${u.speech}`.trim().slice(0, JUDGE_CHARS) })).filter(i => i.text);
      const rs = settle(await Pipeline.pool(batches(items),
        b => call("judge", "importance", models.judge, { task: "importance", items: b }, "JDG", asResults),
        { lanes: lanes("judge"), signal, events: ev, stage: "judge" }), "JDG");
      const importance = {};
      for (const r of rs.flat()) if (Number.isFinite(r.score)) importance[r.itemId] = Math.min(5, Math.max(1, r.score));
      return { importance };
    });

    // ── E. 계획: 1회. 코드가 blockId·버전·정책을 붙여 Plan 으로 정규화한다(§8.2) ──
    const computePlanEmphasis = () => {
      if (!emphasisSignals) return null;
      const Emphasis = need("Emphasis", "./emphasis.js");
      return Emphasis?.computeEmphasis ? Emphasis.computeEmphasis(R().ir.units, { evidence: R().evidence, slides }) : null;
    };
    const planning = stage("planning", "LLM",
      () => K({ units: units(), registry: R().registry.map(({ id, status }) => ({ id, status })), figures: R().figures.map(({ id, unitId, kind, title }) => ({ id, unitId, kind, title })), options, recognition, ...(emphasisSignals ? { emphasis: computePlanEmphasis() } : {}) }, models.plan, SPEC, ["plan"]),
      async () => {
        if (!units().length) throw Pipeline.pipelineError("VAL_NO_CONTENT");
        const formulas = R().registry.map(({ id, status }) => ({ id, status, unitIds: (R().formulaUnits[id] || []).slice(0, 20) }));
        const figures = R().figures.map(({ id, unitId, kind, title }) => ({ id, unitId, kind, title: title ?? null }));
        const emphasis = computePlanEmphasis();
        const planBody = { noteSpecVersion: SPEC, ir: { units: units() }, formulas, figures, recognition, options, ...(emphasis ? { emphasis } : {}), ...(input?.host ? { host: input.host } : {}) };
        // 스키마를 통과한 계획도 의미 규칙을 깰 수 있다 — 코드가 고치고(PLAN_REPAIRED), 못 고치면 detail 을
        // 로그에 남기고 VAL_PLAN_INVALID 로 멈춘다. 보정·정규화까지 shape 안에서 끝내므로 호출 캐시에는
        // 정규화를 통과한 계획만 남는다 — shape 이 던지면 Pipeline.cached 는 아무것도 쓰지 않아 "다시 시도" 가 같은 계획을 재생하지 않는다.
        const scope = { units: units(), formulaUnits: R().formulaUnits, figures: R().figures };
        const planShape = r => {
          const filled = NoteContract.withPlannerDefaults(r?.plan); // 구 출력·구 캐시의 빈 W2 칸은 null 로 채운다
          must(Contracts.validate(NoteContract.schemas.plannerOutput, filled).ok);
          const { output, fixes } = NoteContract.repairPlan(filled, scope);
          if (fixes.length) ev.emit({ stage: "planning", level: "warn", code: "PLAN_REPAIRED", msg: fixes.join(",").slice(0, 200) });
          const n = NoteContract.normalizePlan(output, { ...scope, policy: options });
          if (!n.ok) {
            const detail = n.errors[0].detail.slice(0, 20);
            ev.emit({ stage: "planning", level: "error", code: "VAL_PLAN_INVALID", msg: detail.join(",").slice(0, 200) });
            throw Pipeline.pipelineError("VAL_PLAN_INVALID", { detail });
          }
          // 어느 섹션에도 배정 못 한 core 학습 항목 — id·개수만 싣는다(내용 없음).
          if (n.deferredCore?.length) ev.emit({ stage: "planning", level: "warn", code: "PLAN_DEFERRED_CORE", msg: `items=${n.deferredCore.length} ids=${n.deferredCore.join(",")}`.slice(0, 200) });
          return { plan: n.plan, promptVersion: typeof r.promptVersion === "string" ? r.promptVersion.slice(0, 32) : null };
        };
        // 서버(Supabase Edge 무료)는 요청 하나를 150초 안에 끝내야 한다. 추론형 계획 모델이 그 안에 못 끝내면 작성 모델로 한 번 다시 계획한다 — 사용자 취소는 그대로 멈춘다.
        // ponytail: 시간 초과 판정은 클라이언트 타임아웃·서버 타임아웃·네트워크 끊김을 한데 본다. 유료 Supabase(400초)로 옮기면 PLAN_PRIMARY_MS 만 올린다.
        const slow = e => !signal?.aborted && (e?.name === "AbortError" || e?.code === "request_cancelled_or_timed_out" || Pipeline.codeOf(e) === "NET_UNREACHABLE");
        let out;
        const planModel = V2 ? NoteProfiles.stageModel(noteMode, "plan") : models.plan;
        // 실험 모드는 계획 모델도 고정이다 — 시간 초과 시 작성 모델로 넘기는 폴백을 끄고 한 번만 부른다.
        if (models.plan === models.write || noteMode !== null) out = await call("plan", "plan", planModel, planBody, "LLM", planShape, { timeoutMs: V2 ? 148000 : PLAN_FALLBACK_MS }); // v2 는 서버가 145초까지 기다린다 — 클라이언트가 먼저 끊지 않게 148초(Edge 150초 안)
        else {
          try { out = await call("plan", "plan", models.plan, planBody, "LLM", planShape, { timeoutMs: PLAN_PRIMARY_MS }); }
          catch (e) {
            if (!slow(e)) throw e;
            ev.emit({ stage: "planning", level: "warn", code: "PLAN_FALLBACK_MODEL", msg: `${models.plan} 시간 초과 → ${models.write}`.slice(0, 200) });
            out = await call("plan", "plan", models.write, planBody, "LLM", planShape, { timeoutMs: PLAN_FALLBACK_MS });
          }
        }
        // v2 편집 계획: 같은 세션의 두 번째 Sol 턴(plan 응답 이력을 이어 쓴다) — 한 호출에 합치면 Sol 출력이 150초 안에 안 끝난다.
        // 응답의 이력이 고정 접두 P(앵커까지)다. editorialPlan 이 계획 범위·id 와 어긋나면 폴백 없이 코드 이벤트로 멈춘다.
        // 실행 메모리 변수에만 두고 반환값(단계 캐시)에는 싣지 않는다.
        if (V2) {
          const edShape = r => {
            if (!epOk(r?.editorialPlan, out.plan)) {
              ev.emit({ stage: "planning", level: "error", code: "EDITORIAL_PLAN_INVALID" });
              throw Pipeline.pipelineError("EDITORIAL_PLAN_INVALID");
            }
            return r.editorialPlan;
          };
          editorial = await call("write", "editorial", planModel, { stage: "editorial", noteSpecVersion: SPEC, options }, "LLM", edShape, { timeoutMs: 148000 });
        }
        return out; // {plan: 정규화된 Plan, promptVersion} — 같은 shape 라 캐시 적중 때도 같은 모양이다
      });

    // ── F. 작성: 섹션 병렬. 섹션 하나의 실패는 노트를 죽이지 않는다 ──
    // 섹션 출력 검증 — 작성의 선행 섹션 핵심 주장 확인(v2 의존 게이트)과 검증·조립이 같은 판정을 쓴다. 계획이 나온 뒤에만 부른다.
    let _secById;
    const secById = () => _secById ??= new Map(ctx.out.planning.plan.sections.map(s => [s.sectionId, s]));
    const check = (sectionId, output) => NoteContract.validateSection({ plan: ctx.out.planning.plan, evidence: R().evidence, registry: R().registry, formulaUnits: R().formulaUnits, figures: R().figures, katex: deps.katex, sectionId, output });
    // 유효 참조 목록(allowedRefs): 정규화된 전체 계획에서 한 번 만든다 — 나눠 쓰는 조각이나 살아남은 섹션이 아니다.
    // 대상은 섹션 id·모든 블록 id(섹션·전역)·defined 개념·B08/B09 의 단서 위치(P1..P6), 복습 위치는 섹션 블록 id(S#_B#)뿐이다
    // — 전역 블록과 지도 노드 키는 어느 칸의 참조도 아니다. 서버는 실린 목록으로 출력 스키마의 대상·복습 칸을 enum 으로 좁힌다.
    let arefs;
    const allowedRefs = () => arefs ??= (() => {
      const p = ctx.out.planning.plan, targetIds = [], reviewIds = [];
      for (const s of p.sections) {
        targetIds.push(s.sectionId);
        for (const b of s.blocks) {
          targetIds.push(b.blockId); reviewIds.push(b.blockId);
          if (b.type === "B08" || b.type === "B09") for (let i = 1; i <= 6; i++) targetIds.push(`${b.blockId}/P${i}`);
        }
      }
      for (const g of p.global) targetIds.push(g.blockId);
      for (const c of p.concepts) if (c.depth === "defined") targetIds.push(c.conceptId);
      return { targetIds: uniq(targetIds).slice(0, 3500), reviewIds: uniq(reviewIds).slice(0, 500) };
    })();
    // 섹션에 배정된 학습 항목(id·kind·importance·근거 유닛)을 작성 입력에 싣는다 — 계획에 없으면 키 자체를 뺀다(선택 필드).
    const learningItemsFor = sec => {
      const all = ctx.out.planning.plan.learningItems;
      if (!Array.isArray(all) || !Array.isArray(sec.learningItemIds) || !sec.learningItemIds.length) return {};
      const items = all.filter(l => sec.learningItemIds.includes(l.itemId)).map(({ itemId, kind, importance, unitIds }) => ({ itemId, kind, importance, unitIds }));
      return items.length ? { learningItems: items } : {};
    };
    const writeBody = sec => ({ noteSpecVersion: SPEC, section: sec, concepts: ctx.out.planning.plan.concepts, evidence: evidenceFor(sec), registry: regFor(sec), figures: figsFor(sec), options, allowedRefs: allowedRefs(), ...learningItemsFor(sec), ...langBody() });
    const outSchema = sch => sourceLang() === "en" ? NoteContract.withSource(sch) : sch;
    // 작성 경로(deps.writer): "blocks"(기본)는 모델이 블록 봉투를 직접 쓰고, "draft"(§2 대안 B)는 의미 초안을 받아
    // SectionDraft.compileDraft 가 블록으로 조판한다. 같은 입력으로 A/B 비교가 가능하다 — 캐시 키에 writer 가 섞인다.
    const writer = deps.writer === "draft" && SectionDraft ? "draft" : "blocks";
    // Luna 작업 패킷(§4.2, sol-luna-2 의 draft 만): 공통 용어(glossary) + 이 섹션의 편집 명세(entry) +
    // 검증된 선행 핵심 주장(prereq). Sol 호출(P 를 싣는 호출)에는 싣지 않는다 — 접두에 이미 계획이 있다.
    const epFor = (s, prereq) => !NoteV3.isLunaV2(noteMode) ? {}
      : { editorialPlan: { v: 1, glossary: editorial?.glossary ?? [], section: (editorial?.sections ?? []).find(e => e.sectionId === s.sectionId) ?? null, ...(prereq?.length ? { prerequisites: prereq } : {}) } };
    async function writeSection(sec, prereq = []) {
      // 서버가 형식 오류로 비운 블록의 원래 봉투(salvaged)는 출력 옆에 실어 둔다 — 검증 단계가 repair 로 고친다. 계획에 없는 id·객체 아닌 값은 버린다.
      // nullReasons(실험): 초안 응답이 블록을 비워 둔 사유 표 {<blockId>: 사유 코드} — 출력 옆에 실어 fix() 의 후보 분류가 쓴다.
      const send = writer === "draft"
        ? async (s, withGist, model) => { const { images, dropped } = await inkImagesFor(s); const body = writeBody(s);
            if (dropped.size) body.evidence = body.evidence.filter(e => !dropped.has(e.id));
            return call("write", "draft", model, { stage: "draft", ...body, section: s, withGist, ...(images.length ? { images } : {}), ...epFor(s, prereq) }, "LLM", r => {
            const draft = asOutput(SectionDraft.outputSchemaFor(s, { gist: withGist, policy: options, allowedRefs: allowedRefs(), sourceLang: sourceLang(), nullReasons: V2 }))(r);
            const out = SectionDraft.compileDraft(draft, s, { concepts: ctx.out.planning.plan.concepts });
            const src = splitSrc(out), nr = r?.nullReasons;
            return { ...out, ...(Object.keys(src).length ? { src } : {}), ...(nr && typeof nr === "object" && !Array.isArray(nr) ? { nullReasons: nr } : {}) };
          }); }
        : (s, withGist, model) => call("write", "section", model, { stage: "section", ...writeBody(s), section: s, withGist }, "LLM", r => {
        const out = asOutput(outSchema(NoteContract.sectionOutputSchemaFor(s, { gist: withGist, policy: options, allowedRefs: allowedRefs() })))(r), ids = new Set(s.blocks.map(b => b.blockId));
        const src = splitSrc(out);
        const sv = Object.fromEntries(Object.entries(r?.salvaged ?? {}).filter(([k, v]) => ids.has(k) && out.blocks[k] === null && v && typeof v === "object" && !Array.isArray(v)));
        if (sourceLang() === "en") for (const v of Object.values(sv)) splitSrc(v);
        // 서버가 찾은 스키마 오류(블록 안 경로 + 사유, 내용 없음) — repair 지시에 싣는다.
        const why = Object.fromEntries(Object.keys(sv).map(k => [k, (Array.isArray(r?.salvagedErrors?.[k]) ? r.salvagedErrors[k] : []).filter(x => typeof x === "string").map(x => x.slice(0, 64)).slice(0, 20)]));
        return { ...out, ...(Object.keys(sv).length ? { salvaged: sv, why } : {}), ...(Object.keys(src).length ? { src } : {}) };
      });
      // §12.4: 잘리면 계획 블록을 반으로 나눠 다시 요청하고, 반쪽도 잘리면 또 나눈다. 근거 입력은 같다. gist 는 맨 앞 조각에만, checks 는 합친다.
      // 블록 하나만으로도 잘리면 그 블록만 null(보류)로 두고 섹션은 살린다 — 필드: 14k 상한에서도 두 반쪽이 다 잘려 단원 하나가 통째로 빠졌다.
      // 실패 사다리: (잘림·시간 초과) 같은 모델로 반씩 나눠 다시 → 더 못 나누면(블록 하나) 대체 모델 → 그래도 안 되면 그 블록만 null.
      // 형식·제공자 오류처럼 나눠도 소용없는 실패는 바로 대체 모델로 같은 조각을 다시 쓴다.
      const parts = async (s, withGist, model = modelFor(writer === "draft" ? "draft" : "section")) => {
        try { return await send(s, withGist, model); } catch (e) {
          // 응답 시간 초과(클라이언트 120초·서버 150초)도 잘림처럼 나눈다 — 제공자가 느린 날 큰 섹션 하나가 작업 전체를 network 일시정지로 멈췄다.
          // 사용자 취소(작업 signal)는 그대로 던진다. 연결 자체가 끊긴 오류(NET_UNREACHABLE)는 나눠도 소용없어 그대로 멈춘다.
          const timeout = timedOut(e), splittable = SPLIT.has(e?.code) || timeout;
          if (!recoverable(e) && !toAlt(e, model)) throw e;
          if (!splittable || s.blocks.length < 2) {
            if (toAlt(e, model)) { altNote("write", sec.sectionId, e, `blocks=${s.blocks.length}`); return parts(s, withGist, ALT); }
            if (!splittable) throw e;
            ev.emit({ stage: "write", unit: sec.sectionId, level: "warn", code: timeout ? "WRITE_TIMEOUT" : codeFor(e, "LLM"), msg: "held 1" });
            return { gist: null, blocks: { [s.blocks[0].blockId]: null }, checks: [] };
          }
          ev.emit({ stage: "write", unit: sec.sectionId, level: "warn", code: timeout ? "WRITE_TIMEOUT" : codeFor(e, "LLM"), msg: `split ${s.blocks.length}` });
          const h = Math.ceil(s.blocks.length / 2);
          const a = await parts({ ...s, blocks: s.blocks.slice(0, h) }, withGist, model), b = await parts({ ...s, blocks: s.blocks.slice(h) }, false, model);
          const sv = { ...a.salvaged, ...b.salvaged }, why = { ...a.why, ...b.why }, src = { ...a.src, ...b.src }, lg = SectionDraft.mergeLedgers(a.ledger, b.ledger), nr = { ...a.nullReasons, ...b.nullReasons };
          return { gist: withGist ? a.gist : null, blocks: { ...a.blocks, ...b.blocks }, checks: [...a.checks, ...b.checks].slice(0, 6), ...(Object.keys(sv).length ? { salvaged: sv, why } : {}), ...(Object.keys(src).length ? { src } : {}), ...(lg.length ? { ledger: lg } : {}), ...(Object.keys(nr).length ? { nullReasons: nr } : {}) };
        }
      };
      return parts(sec, true);
    }
    const writing = stage("writing", "LLM",
      () => K({ plan: ctx.out.planning.plan, units: units(), evidence: R().evidence.length, registry: R().registry.map(({ id, latex, status }) => ({ id, latex, status })), figures: R().figures.map(f => f.id), options, rerun, writer }, models.write, SPEC, [writer === "draft" ? "draft" : "section"]),
      async () => {
        const secs = ctx.out.planning.plan.sections;
        ev.emit({ stage: "write", level: "info", code: "SOURCE_LANG", msg: sourceLang() });
        // v2 의존 게이트(§4.2): editorialPlan 의 prerequisiteSectionIds 가 있으면 그 선행 섹션의 출력이 나오고
        // 검증된 핵심(core) 주장을 받은 뒤에 쓴다 — 독립 섹션만 병렬이다. 계획 순서상 앞선 섹션만 기다려 순환은 생기지 않는다.
        // v2 초기 동시성은 4 — 전역 공급자 상한(레인·재시도)은 그대로 둔다. sol-fork-2 는 여기에 웜업 게이트가 겹친다.
        const order = new Map(secs.map((s, i) => [s.sectionId, i]));
        const depOf = new Map();
        if (V2) for (const e of editorial?.sections ?? []) {
          const pre = (Array.isArray(e.prerequisiteSectionIds) ? e.prerequisiteSectionIds : [])
            .filter(id => order.has(id) && order.get(id) < order.get(e.sectionId));
          if (pre.length) depOf.set(e.sectionId, pre);
        }
        const deferred = () => { let resolve; return { promise: new Promise(r => resolve = r), resolve }; };
        const gates = new Map(secs.map(s => [s.sectionId, deferred()]));
        // 게이트 대기가 취소로도 풀리게 한다 — 의존이 없는 실행에서는 이 약속이 어느 race 에도 쓰이지 않으므로 조용히 먹는다.
        const abortWait = depOf.size ? new Promise((_, rej) => { const h = () => rej(new DOMException("취소됨", "AbortError")); signal?.aborted ? h() : signal?.addEventListener("abort", h, { once: true }); }) : null;
        abortWait?.catch(() => {});
        // 선행 섹션의 검증 통과 core 주장 — 의존 섹션의 Luna 패킷(prerequisites)에 들어간다(내용은 같은 모델 입력이다).
        const coreClaims = (sectionId, out) => {
          if (!out) return [];
          const claims = [];
          for (const b of check(sectionId, out).blocks) if (!b.errors.length && b.envelope?.importance === "core")
            for (const { claim } of claimsIn(b.envelope)) claims.push({ sectionId, text: claim.text, evidenceIds: claim.evidenceIds, basis: claim.basis });
          return claims.slice(0, 12);
        };
        const worker = async s => {
          const lists = [];
          for (const pid of depOf.get(s.sectionId) ?? [])
            lists.push(coreClaims(pid, await Promise.race([gates.get(pid).promise, abortWait])));
          // 선행 주장의 합계 상한은 서버 계약과 같은 12 — 섹션을 돌아가며 한 개씩 뽑아 각 선행이 최소 하나는 실리게 한다.
          const prereq = [];
          for (let i = 0; prereq.length < 12 && lists.some(l => i < l.length); i++)
            for (const l of lists) if (i < l.length && prereq.length < 12) prereq.push(l[i]);
          let out = null;
          try { return out = await writeSection(s, prereq); }
          finally { gates.get(s.sectionId).resolve(out); } // 실패해도 대기자를 풀어 준다 — 없는 선행으로 진행한다
        };
        const rs = await Pipeline.pool(secs, V2 ? worker : writeSection, { lanes: V2 ? Math.min(lanes("write"), 4) : lanes("write"), signal, events: ev, stage: "write" });
        signal?.throwIfAborted();
        // 한도·네트워크·차단기처럼 모든 섹션을 막을 오류는 부분 노트로 덮지 않고 작업을 멈춘다. 쓴 섹션은 호출 캐시에 남아 재개가 싸다.
        const stop = rs.find(r => r.status === "failed" && halting(r.error, "LLM"));
        if (stop) throw stop.error;
        const sections = rs.map((r, i) => ({ sectionId: secs[i].sectionId, output: r.status === "ok" ? r.value : null }));
        if (!sections.some(s => s.output)) throw rs.find(r => r.status === "failed").error; // 한 섹션도 못 썼다면 부분 노트가 아니라 실패다
        const failed = sections.filter(s => !s.output).map(s => s.sectionId);
        ev.emit({ stage: "write", msg: `sections=${sections.length - failed.length} failed=${failed.length}` });
        return { sections, failed };
      });

    // ── G. 검증·조립: 섹션 검증 → 실패 블록만 blockId repair 1회 → (유료) 주장 단위 근거 지지 → 전역 Writer → assembleNote ──
    const validating = stage("validating", "LLM",
      () => K({ writing: ctx.out.writing, plan: ctx.out.planning.plan, judge: judged ? models.judge : null, gaps, rerun, meta: input?.meta ?? null, crops: Object.keys(R().cropMap), judgeShadow, supportBudget: deps.supportBudget ?? null, linkEdit }, models.write, SPEC, ["repair", "global", ...(judged ? ["judge"] : []), ...(linkEdit ? ["link", "questions"] : []), ...(V2 ? ["review", "questions"] : [])]),
      async () => {
        const plan = ctx.out.planning.plan, planOf = secById();
        const base = { plan, evidence: R().evidence, registry: R().registry, formulaUnits: R().formulaUnits, figures: R().figures, katex: deps.katex };

        // 1차 검증 → 실패 블록만 다시 쓴다(§12.1). Writer 가 null 로 보류한 블록과 섹션 단위 오류(커버리지)는 다시 쓰지 않는다.
        // 재생성 호출이 실패하면 실패 블록은 그대로 빠진다(한도·네트워크 오류는 작업을 멈춘다).
        // 서버가 형식 오류로 비운 블록(salvaged)도 원래 봉투를 previous 로 repair 한다. 모델이 스스로 null 로 둔 블록은 그대로 보류다.
        let repaired = 0, serverHeld = 0, writerHeld = 0, declinedRecovered = 0;
        const heldWhy = {};
        // 실패 루프 예산(§4.4, v2 만): 대상별 의미 재작성 1회·원인별 1회·묶음 상한 — RepairPlan(v2-loop)이 쥔다.
        // 금액 상한은 실행 요청의 예산 값(deps.loopMaxUsd)을 쓰고, 없으면 기본 상수다.
        const loopMaxUsd = Number.isFinite(deps.loopMaxUsd) ? deps.loopMaxUsd : LOOP_MAX_USD;
        const loopBudget = V2 && RepairPlan?.RepairBudget ? new RepairPlan.RepairBudget({ perTargetSemantic: 1, perCause: 1, maxUsd: loopMaxUsd }) : null;
        // 루프 제어기 지표의 원천 이벤트(내용 없는 코드·수치): 제어기가 보류한 대상의 사유를 여기 쌓고,
        // 시도·결과는 budget.events 에 자동으로 쌓인다 — metricsOf 는 둘을 합쳐 먹인다.
        const loopSkips = [];
        const loopSkip = (target, reason) => {
          const type = reason === "no_evidence" ? "skipped_no_evidence" : reason === "budget_exhausted" ? "skipped_budget" : reason === "no_progress" ? "stopped_no_progress" : null;
          if (type) loopSkips.push({ type, target: String(target) });
        };
        // sol-luna-3 수리 패킷(repair=packet): 수리 호출을 고정 접두 P 없는 자급 패킷으로 줄인다(§5).
        // 대상 블록·오류·그 블록이 실제 인용한 근거·같은 섹션의 완전한 인접 주장만 싣는다 — 생략한 블록 id 목록을 남기고 문자 절삭은 없다.
        const packetMode = NoteV3.isV3(noteMode) && ctx.v3.repair === "packet";
        const packetFor = (sec, list, out) => {
          const body = writeBody(sec);
          const ids = new Set();
          for (const e of list) {
            for (const { claim } of claimsIn(e.previous ?? {})) for (const id of claim.evidenceIds) ids.add(id);
            for (const er of e.errors ?? []) for (const d of er.detail ?? []) for (const m of String(d).matchAll(/U[0-9]+\.[a-z][0-9]+/g)) ids.add(m[0]);
            for (const id of e.evidenceIds ?? []) ids.add(id);
          }
          const sel = evidenceFor(sec).filter(e => ids.has(e.id));
          if (sel.length) body.evidence = sel; // 인용이 하나도 잡히지 않으면 섹션 근거를 그대로 둔다 — 근거 0개 요청은 계약이 거절한다
          const neighborClaims = [], omittedIds = [], targetIds = new Set(list.map(e => e.blockId));
          for (const [bid, env] of Object.entries(out?.blocks ?? {})) {
            if (targetIds.has(bid)) continue;
            const cs = env ? claimsIn(env) : [];
            if (!env || neighborClaims.length + cs.length > 24) { omittedIds.push(bid); continue; }
            for (const { path, claim } of cs) neighborClaims.push({ id: `${bid}${path}`, text: claim.text, evidenceIds: claim.evidenceIds, basis: claim.basis });
          }
          const snap = loopBudget?.snapshot?.();
          body.repair = list;
          body.packet = {
            v: 1, policyVersion: SPEC, baseRevision: loopBudget?.history?.length ?? 0,
            targets: [...targetIds],
            errorCodes: uniq(list.flatMap(e => (e.errors ?? []).map(x => x.code))).sort(),
            neighborClaims, omittedIds,
            allowedOps: uniq([...list.map(e => e.mode === "regenerate_missing" ? "write" : "revise"), "null"]),
            remainingBudget: snap && snap.maxUsd !== Infinity ? Math.round(snap.remainingUsd * 1e6) / 1e6 : null,
          };
          return body;
        };
        // repair 출력 shape — fix() 와 T5 회복이 같은 strict 출력 스키마를 쓴다. 영어 강의면 주장의 src 를 뗀다.
        const repairShape = (sec, list, refs = allowedRefs()) => x => { const o = asOutput(outSchema(NoteContract.repairOutputSchemaFor(sec, list.map(y => y.blockId), options, refs)))(x), s2 = splitSrc(o); return Object.keys(s2).length ? { ...o, src: s2 } : o; };
        const fix = async ({ sectionId, output: raw }) => {
          if (!raw) return { sectionId, output: raw };
          const { salvaged = {}, why = {}, src = {}, nullReasons = {}, ...output } = raw;
          const v = check(sectionId, output), sec = planOf.get(sectionId);
          const bad = v.blocks.filter(b => b.errors.length && !b.errors.every(e => e.code === "VAL_BLOCK_DECLINED") && b.envelope);
          const held = v.blocks.filter(b => b.envelope == null && Object.hasOwn(salvaged, b.id));
          serverHeld += held.length;
          // 서버가 비운 사유의 종류(마지막 칸 이름 + 메시지, 내용 없음)를 모아 진단에 남긴다.
          for (const b of held) for (const d of why[b.id] ?? []) { const [p, ...m] = d.split(" "); const k = `${p.split("/").filter(x => !/^\d+$/.test(x)).pop() ?? "-"} ${m.join(" ")}`; heldWhy[k] = (heldWhy[k] ?? 0) + 1; }
          writerHeld += v.blocks.filter(b => b.errors.some(e => e.code === "VAL_BLOCK_DECLINED") && !Object.hasOwn(salvaged, b.id)).length;
          // v2: 작성자가 null 로 둔 블록도 명시적 후보다. 모델이 붙인 사유(nullReasons)는 신뢰하지 않고
          // 루프 제어기가 분류한다 — 근거 없음·정책·중복은 우회 호출 없이 보류 유지, 나머지는 regenerate_missing 1회를
          // 같은 repair 묶음에 얹는다(묶음 상한 12). 구 계약과 같이 서버는 모르는 mode 를 무시할 수 있다.
          const regen = [], declared = new Set();
          if (V2) for (const b of v.blocks) {
            if (b.envelope != null || Object.hasOwn(salvaged, b.id) || !b.errors.some(e => e.code === "VAL_BLOCK_DECLINED")) continue;
            const hasReason = typeof nullReasons[b.id] === "string";
            const reason = hasReason ? nullReasons[b.id].slice(0, 64) : "unknown";
            const cause = loopClassify({ kind: "writer_null", blockId: b.id, reason, errors: b.errors });
            const c = { kind: "writer_null", cause, reason, targetId: b.id, budget: loopBudget };
            if (loopStep(c) === "regenerate") {
              if (hasReason) declared.add(b.id);
              regen.push({ blockId: b.id, previous: null, mode: "regenerate_missing", errors: [{ code: "VAL_BLOCK_DECLINED", detail: [reason] }] });
            } else loopSkip(b.id, c.loopReason);
          }
          if ((!bad.length && !held.length && !regen.length) || v.errors.length) return { sectionId, output, src };
          ev.emit({ stage: "validate", unit: sectionId, msg: `repair=${bad.length + held.length + regen.length}` });
          const repair = [
            ...bad.map(b => ({ blockId: b.id, previous: b.envelope, errors: b.errors.slice(0, 20).map(e => ({ code: e.code, detail: e.detail.map(String).map(d => d.slice(0, 64)).slice(0, 20) })) })),
            ...held.map(b => ({ blockId: b.id, previous: salvaged[b.id], errors: [{ code: "VAL_SCHEMA", detail: why[b.id]?.length ? why[b.id] : ["format"] }] })),
            ...regen,
          ].slice(0, 12);
          // 수정 원인 묶음(내용 없는 키 — REPAIR_CAUSES 지표·예산 기록의 cause): 재생성 대상은 작성자 사유가 선언됐으면
          // writer_null, 선언 없이 컴파일러가 블록을 못 채운(조판 산출에 ledger 가 있는) 경우면 compiler_unmapped 로 본다.
          const causes = new Map(repair.map(e => [e.blockId, e.mode !== "regenerate_missing" ? "schema"
            : (declared.has(e.blockId) || !output.ledger ? "writer_null" : "compiler_unmapped")]));
          // 한 실행 계약(개선안 §7): 예약 → 실행 → 기록. 예산이 거절한 대상(금액 소진·시도 상한)은 호출에 싣지 않는다.
          const jobs = repair.map(e => {
            const r = loopBudget?.reserveAttempt(e.blockId, causes.get(e.blockId), 0.05);
            if (loopBudget && !r) loopSkip(e.blockId, "budget_exhausted");
            return r === null ? null : [e, r];
          }).filter(Boolean);
          const attempt = jobs.map(([e]) => e);
          // 실패 사다리: 주 모델 → 대체 모델 → (잘림·시간 초과면) 반씩 나눠 다시. 나눈 조각 하나의 실패는 그 조각만 버린다.
          const repairWith = async (list, model) => {
            try { return await call("write", "repair", model, { stage: "repair", ...(packetMode ? packetFor(sec, list, output) : { ...writeBody(sec), repair: list }) }, "LLM", repairShape(sec, list)); } catch (e) {
              if (toAlt(e, model)) { altNote("validate", sectionId, e, `repair=${list.length}`); return repairWith(list, ALT); }
              if (!recoverable(e)) throw e;
              if (!(SPLIT.has(e?.code) || timedOut(e)) || list.length < 2) throw e;
              const h = Math.ceil(list.length / 2), one = l => repairWith(l, model).catch(err => { if (!recoverable(err)) throw err; return { blocks: {} }; });
              const [a, b] = [await one(list.slice(0, h)), await one(list.slice(h))];
              return { blocks: { ...a.blocks, ...b.blocks }, src: { ...a.src, ...b.src } };
            }
          };
          // 결과를 섹션에 합친다: 고친 블록의 src 는 새 출력의 것으로 바꾼다. onlyFilled 면 null 로 돌아온 블록은 앞 결과를 그대로 둔다.
          const mergeIn = (base, baseSrc, r, onlyFilled) => {
            const got = Object.fromEntries(Object.entries(r.blocks ?? {}).filter(([, v]) => !onlyFilled || v != null)), ids = Object.keys(got);
            const keep = Object.fromEntries(Object.entries(baseSrc).filter(([k]) => !ids.some(id => k.startsWith(`/blocks/${id}/`))));
            const rsrc = Object.fromEntries(Object.entries(r.src ?? {}).filter(([k]) => ids.some(id => k.startsWith(`/blocks/${id}/`))));
            return [{ ...base, blocks: { ...base.blocks, ...got } }, { ...keep, ...rsrc }];
          };
          let merged = output, msrc = src, second = 0, result = null;
          if (attempt.length) try {
            [merged, msrc] = mergeIn(output, src, result = await repairWith(attempt, modelFor("repair")), false);
            repaired += attempt.length;
          } catch (e) {
            for (const [, r] of jobs) loopBudget?.rollback(r); // 호출이 성립하지 않은 예약은 시도를 쓰지 않고 푼다(전송 실패)
            if (halting(e, "LLM") && !timedOut(e) && !busy(e)) throw e;
            ev.emit({ stage: "validate", unit: sectionId, level: "warn", code: "REPAIR_RESULT", msg: `call_failed=${attempt.length} ${timedOut(e) ? "timeout" : e?.code ?? "-"}`.slice(0, 80) });
          }
          // 계약 확정: 실행이 끝난 대상을 실제 비용·오류 서명·입력 revision·개선 여부로 기록한다 — 이 기록이 다음 동일 서명을 멈춘다.
          if (loopBudget && result) {
            const post = new Map(check(sectionId, merged).blocks.map(b => [b.id, b]));
            const per = (typeof result.usd === "number" ? result.usd : attempt.length * 0.05) / Math.max(1, attempt.length);
            for (const [e, r] of jobs) {
              const b = post.get(e.blockId), before = e.errors?.length ?? 0;
              const ok = !!b && b.envelope != null && !b.errors.length;
              loopBudget.commit(r, {
                ok, improved: ok || (!!b && b.envelope != null && b.errors.length < before),
                usd: per, signature: RepairPlan.signatureOf(e.errors), revision: loopBudget.history.length,
                declined: causes.get(e.blockId) === "writer_null" || causes.get(e.blockId) === "compiler_unmapped",
              });
            }
          }
          // 2차: 아직 null(포기)이거나 검증에 걸리는 블록은 대체 모델이 한 번 더 고친다 — 같은 모델이 못 고친 것을 다른 모델이 고치는 일이 많다.
          const sent = new Set(attempt.map(x => x.blockId)), first = new Map(attempt.map(x => [x.blockId, x]));
          const left = check(sectionId, merged).blocks.filter(b => sent.has(b.id) && (b.envelope == null || b.errors.length));
          if (ALT && left.length) {
            const list2 = left.map(b => b.envelope == null ? first.get(b.id)
              : { blockId: b.id, previous: b.envelope, errors: b.errors.slice(0, 20).map(e => ({ code: e.code, detail: e.detail.map(String).map(d => d.slice(0, 64)).slice(0, 20) })) });
            try {
              [merged, msrc] = mergeIn(merged, msrc, await repairWith(list2, ALT), true);
              second = list2.length;
            } catch (e) {
              if (halting(e, "LLM") && !timedOut(e) && !busy(e)) throw e;
              altNote("validate", sectionId, e, `repair2_failed=${list2.length}`);
            }
          }
          // 재작성 결과(내용 없음): 고쳐짐·null(포기)·여전히 검증 실패. 서버가 비웠던 블록은 held 로 따로 센다. alt = 2차로 다시 맡긴 블록 수.
          const heldIds = new Set(held.map(b => b.id)), regenIds = new Set(regen.map(x => x.blockId)), n = { ok: 0, null: 0, bad: 0, heldNull: 0 };
          for (const b of check(sectionId, merged).blocks) if (sent.has(b.id)) {
            if (b.envelope == null) { n.null++; if (heldIds.has(b.id)) n.heldNull++; }
            else if (b.errors.length) n.bad++;
            else { n.ok++; if (regenIds.has(b.id)) declinedRecovered++; }
          }
          ev.emit({ stage: "validate", unit: sectionId, level: "info", code: "REPAIR_RESULT", msg: `fixed=${n.ok} null=${n.null} held_null=${n.heldNull} still_bad=${n.bad} alt=${second}` });
          return { sectionId, output: merged, src: msrc };
        };
        let sections = settle(await Pipeline.pool(ctx.out.writing.sections, fix, { lanes: lanes("write"), signal, events: ev, stage: "validate" }), "LLM");

        // 6-5 T5(제안서 §4): 통과한 블록의 강의 근거 주장을 /v1/judge support 로 확인한다. 가상·보강·교육용 주장은 대상이 아니다.
        // 판정과 조치를 분리한다 — 첫 점수는 검토 우선순위이지 삭제 근거가 아니다. 낮은 주장은 순서대로 한 번씩만 복구한다:
        //   안전한 코드 정규화 → 근거 재연결 1회 → 문장 수정 repair 1회(T5 전용 예산, 형식 repair 와 별개).
        // 끝내 불명확하면 삭제가 아니라 확인 필요(pending)로 보존한다: 뺄 수 있는 칸(null 허용·목록 항목)이면 그 주장만
        // 빼서 pending 에 싣고 블록은 살리고, 필수 칸이거나 뺀 뒤 계약이 깨지면 블록째 보류하되 봉투 전체를 pending 에 남겨
        // 정상 조건·사례가 저장 구조에서 파괴되지 않게 한다. pending 은 확정 본문이 아니라서 렌더에 나오지 않고 데이터에만 남는다.
        // 전역 작업 예산(supportBudget)을 넘으면 더 호출하지 않고 보류한다. deps.judgeShadow 면 판정·계측만 하고 본문은 그대로다.
        // 지지 점수 분포(내용 없음): 주장 수·판정 수·점수 구간별 건수, 낮은 주장 수와 그 때문에 빠진 블록 수.
        let unsupported = 0, nulled = 0, trimmed = 0, supportOps = 0;
        const sup = { claims: 0, judged: 0, low: 0, bins: [0, 0, 0, 0, 0] };
        // 주장 단위 결과(내용 없음): kept 유지 / relinked 재연결 / fixed 수정 / direct 직접 보류 / collateral 동반 손실 / unjudged 미판정.
        const outcomes = new Map(), claimsByBlock = new Map(), heldIds = new Set(), fixedBlocks = new Set(), pendings = [];
        // 주장별 첫 점수·최종 결과 맵(키 "블록id#경로" — 구조 id 뿐 내용 없음). 단계 캐시에 실어 평가 하네스·비교 화면이 쓴다.
        const claimScores = new Map();
        let support = null;
        // 복구 호출 결과(내용 없음): 재연결·재작성 시도 대비 수락, 예산 초과로 건너뛴 수, 재판정 누락, 호출 실패.
        const recovery = { relink: [0, 0], repair: [0, 0], budgetSkip: 0, rejudgeMiss: 0, callFailed: 0 };
        const schemaAt = (sch, segs) => segs.reduce((x, k) => x && (x.properties ? x.properties[k] : x.items), sch);
        const nodeAt = (o, segs) => segs.reduce((x, k) => x?.[k], o);
        // 주장을 뺄 수 있는 가장 깊은 경로 — null 허용 칸이면 그 칸, 목록 항목 안의 주장이면 그 항목. 없으면 null.
        const cutPath = (type, path) => {
          const sch = NoteContract.envelopeSchema(type, options), segs = path.split("/").slice(1);
          for (let d = segs.length; d >= 1; d--) {
            const pre = segs.slice(0, d), up = pre.slice(0, -1);
            if (schemaAt(sch, up)?.type === "array" || [].concat(schemaAt(sch, pre)?.type).includes("null")) return { path: "/" + pre.join("/"), segs: pre };
          }
          return null;
        };
        // 블록에서 주어진 봉투 안 경로들을 뺀 봉투, 뺄 수 없으면 null.
        const withoutClaims = (type, env, paths) => {
          const out = JSON.parse(JSON.stringify(env)), sch = NoteContract.envelopeSchema(type, options), cuts = [];
          for (const p of paths) {
            const segs = p.split("/").slice(1), up = segs.slice(0, -1);
            if ([].concat(schemaAt(sch, segs)?.type).includes("null")) nodeAt(out, up)[segs.at(-1)] = null;
            else if (schemaAt(sch, up)?.type === "array") cuts.push([up, +segs.at(-1)]);
            else return null;
          }
          for (const [up, i] of cuts.sort((a, b) => b[1] - a[1])) nodeAt(out, up).splice(i, 1);
          return out;
        };
        // judge 호출부를 T5 밖으로 뺐다 — 연결 편집(linkEdit)의 재판정이 같은 경로를 재사용한다.
        const judge = async items => { const out = []; for (const b of batches(items)) out.push(...await call("judge", "support", models.judge, { task: "support", items: b }, "JDG", asResults)); return out; };
        // 인용 근거로 인정하는 id — 등록된 근거나 계산 참조(S#_B#.c#, T5 정규화와 같은 기준). review 의 근거 교체도 같은 집합을 쓴다.
        const evIds = new Set(R().evidence.map(e => e.id)), CALC_ID = /^(S[0-9]{1,3}_B[0-9]{1,2}|GB[0-9])\.[ic][0-9]{1,2}$/;
        const okEv = id => evIds.has(id) || CALC_ID.test(id);
        const sameIds = (a, b) => a.length === b.length && a.every(v => b.includes(v));
        if (judged) {
          const evById = new Map(R().evidence.map(e => [e.id, e]));
          sections = settle(await Pipeline.pool(sections, async s => {
            if (!s.output) return s;
            const v = check(s.sectionId, s.output), claims = [];
            // 영어 강의는 주장의 영어 src 로 판정한다(영어 근거와 같은 언어). src 가 없으면 한국어 text 그대로.
            for (const b of v.blocks) if (!b.errors.length)
              for (const { path, claim } of claimsIn(b.envelope)) if (claim.basis === "lecture") {
                claims.push({ bid: b.id, type: b.type, path, claim, jt: { text: s.src?.[`/blocks/${b.id}${path}`] ?? claim.text, evidenceIds: claim.evidenceIds } });
                (claimsByBlock.get(b.id) ?? claimsByBlock.set(b.id, []).get(b.id)).push(claims.at(-1));
              }
            if (!claims.length) return s;
            const r = await Verify.checkSupport(claims.map(c => c.jt), R().evidence, { judge });
            sup.claims += claims.length; sup.low += r.blocks.length;
            for (const x of r.scores ?? []) if (typeof x === "number") { sup.judged++; sup.bins[x < .1 ? 0 : x < .3 ? 1 : x < .5 ? 2 : x < .7 ? 3 : 4]++; }
            const lowIdx = new Set(r.blocks.map(x => x.index)), unj = new Set(r.unjudged);
            claims.forEach((c, i) => {
              outcomes.set(c.claim, lowIdx.has(i) ? "low" : unj.has(i) ? "unjudged" : "kept");
              const sc = r.scores?.[i];
              if (typeof sc === "number" && Number.isFinite(sc)) claimScores.set(`${c.bid}#${c.path}`, sc);
            });
            if (!lowIdx.size) return s;
            const sec = planOf.get(s.sectionId);
            // 쓰기는 복사본에 한다 — 받아들인 변경만 마지막에 출력에 반영한다(judgeShadow 면 아무것도 반영하지 않는다).
            const work = {}, merged = () => ({ ...s.output.blocks, ...work });
            const envOf = id => Object.hasOwn(work, id) ? work[id] : (work[id] = JSON.parse(JSON.stringify(s.output.blocks[id])));
            const claimAt = (id, path) => nodeAt(envOf(id), path.split("/").slice(1));
            // 후보 봉투 env 를 넣은 상태로 대상 블록이 코드 검증을 지나는가 — 섹션 ok 가 아니라 블록 오류만 본다.
            const blockOk = (id, env) => !check(s.sectionId, { ...s.output, blocks: { ...merged(), [id]: env } }).blocks.find(b => b.id === id).errors.length;
            const lows = () => claims.filter(c => outcomes.get(c.claim) === "low");

            // (a) 안전한 코드 정규화 — 모델 없이 인용 id 의 중복·모름·상한만 다듬는다. 계산 참조(S#_B#.c#)는 근거 맵에 없어도 유효하니 남긴다.
            for (const c of lows()) {
              const live = claimAt(c.bid, c.path);
              const ids = uniq((live?.evidenceIds ?? []).filter(okEv)).slice(0, 8);
              if (live && ids.length && ids.join() !== live.evidenceIds.join()) live.evidenceIds = ids;
            }
            // (b) 근거 재연결 1회 — 인용 근거만으로 낮으면 인용된 유닛(인접 발화·같은 슬라이드)과 계획이 허용한
            //     교차 유닛(crossUnitIds)의 나머지 근거만 묶어 다시 판정한다. 전체 강의를 붙이지 않는다.
            //     지지되면 이긴 묶음의 근거를 인용에 붙이고 블록을 다시 검증한다 — 검증이 깨지면 인용을 되돌린다.
            for (const c of lows()) {
              const cited = new Set(c.claim.evidenceIds);
              const units = new Set(c.claim.evidenceIds.map(id => evById.get(id)?.unitId).filter(Boolean));
              for (const u of sec.crossUnitIds ?? []) units.add(u);
              const pool = R().evidence.filter(e => units.has(e.unitId) && !cited.has(e.id)).sort((a, b) => (a.t0 ?? 0) - (b.t0 ?? 0));
              const bundles = Verify.evidenceBundles(pool, JUDGE_CHARS);
              if (!bundles.length) continue;
              if (supportOps + bundles.length > supportBudget) { recovery.budgetSkip++; continue; }
              supportOps += bundles.length; recovery.relink[0]++;
              let rs;
              try {
                rs = await judge(bundles.map((b, i) => ({ itemId: String(i), text: c.jt.text, context: b.map(e => String(e.text ?? "")).join("\n").trim() })));
              } catch (e) { if (halting(e, "JDG")) throw e; recovery.callFailed++; continue; }
              const got = new Map((Array.isArray(rs) ? rs : rs?.results ?? []).map(x => [x?.itemId, x?.score]));
              const scores = bundles.map((_, i) => got.get(String(i)));
              // 묶음 하나라도 점수가 없으면 미판정으로 둔다 — 일부 묶음의 최고점만으로 통과시키지 않는다(모순 확인).
              if (scores.some(x => typeof x !== "number" || Number.isNaN(x))) { recovery.rejudgeMiss++; continue; }
              const win = scores.indexOf(Math.max(...scores));
              if (scores[win] < .5 || Math.min(...scores) < Verify.CONTRA_FLOOR) continue;
              const live = claimAt(c.bid, c.path);
              if (!live) continue;
              const before = [...(live.evidenceIds ?? [])];
              live.evidenceIds = uniq([...bundles[win].map(e => e.id), ...before]).slice(0, 8);
              if (blockOk(c.bid, envOf(c.bid))) { outcomes.set(c.claim, "relinked"); recovery.relink[1]++; }
              else live.evidenceIds = before;
            }
            // (c) 문장 수정 repair — 블록당 한 번, 형식 repair 와 예산을 공유하지 않는다.
            //     대체 모델·분할 사다리·재시도는 없다(call 안의 전송 재시도·멱등은 그대로).
            const lowByBlock = new Map();
            for (const c of lows()) { const g = lowByBlock.get(c.bid) ?? { type: c.type, paths: [] }; g.paths.push(c.path); lowByBlock.set(c.bid, g); }
            let src = s.src, t5 = 0, t5ok = 0;
            for (const [id, g] of lowByBlock) {
              if (supportOps >= supportBudget) { recovery.budgetSkip += g.paths.length; continue; }
              // v2: 대상별 의미 재작성은 루프 제어기가 허가할 때만(최대 1회) — 이미 검수·수정이 손댄 대상을 다시 부르지 않는다.
              const tc = { kind: "semantic", cause: "support_low", targetId: id, budget: loopBudget };
              if (V2 && loopStep(tc) !== "repair") { recovery.budgetSkip += g.paths.length; loopSkip(id, tc.loopReason); continue; }
              const tresv = loopBudget?.reserveAttempt(id, "support", 0.06); // 동일 서명·상한을 쓰는 한 실행 계약 — 예약이 거절하면 호출하지 않는다
              if (V2 && loopBudget && !tresv) { recovery.budgetSkip += g.paths.length; loopSkip(id, "budget_exhausted"); continue; }
              supportOps++; recovery.repair[0]++; t5++;
              const entry = { blockId: id, previous: merged()[id], errors: [{ code: "VAL_SUPPORT_LOW", detail: g.paths.map(p => p.slice(0, 64)).slice(0, 20) }] };
              const sig = RepairPlan?.signatureOf?.(entry.errors);
              let rr = null;
              try {
                rr = await call("write", "repair", modelFor("repair"), { stage: "repair", ...(packetMode ? packetFor(sec, [entry], { blocks: merged() }) : { ...writeBody(sec), repair: [entry] }) }, "LLM", repairShape(sec, [entry]));
                const got = rr?.blocks?.[id];
                // 받는 조건: 섹션 단위 오류 없음 + 대상 블록이 살아 있고 블록 오류 없음 + 강의 근거 주장(새 주장 포함) 전부가
                // 새 src 로 다시 판정돼 .5 이상 — 판정 누락도 실패다. 섹션 ok 는 요구하지 않는다 — 무관한 보류 블록
                // (VAL_BLOCK_DECLINED)은 블록 오류라 회복을 막지 않고, 커버리지 같은 경고는 오류로 세지 않는다.
                const rv = got == null ? null : check(s.sectionId, { ...s.output, blocks: { ...merged(), [id]: got } });
                const rb = rv?.blocks.find(b => b.id === id);
                let accepted = false;
                if (rv && !rv.errors.length && rb?.envelope != null && !rb.errors.length) {
                  const m = { ...(src ?? {}) };
                  for (const k of Object.keys(m)) if (k.startsWith(`/blocks/${id}/`)) delete m[k];
                  for (const [k, t] of Object.entries(rr.src ?? {})) if (k.startsWith(`/blocks/${id}/`)) m[k] = t;
                  const qc = claimsIn(got).filter(({ claim }) => claim.basis === "lecture").map(({ path, claim }) => ({ text: m[`/blocks/${id}${path}`] ?? claim.text, evidenceIds: claim.evidenceIds }));
                  const jr = await Verify.checkSupport(qc, R().evidence, { judge });
                  if (!jr.ok || jr.unjudged.length) recovery.rejudgeMiss++;
                  else {
                    work[id] = got; src = m; recovery.repair[1]++; t5ok++; fixedBlocks.add(id); accepted = true;
                    for (const c of lows().filter(x => x.bid === id)) outcomes.set(c.claim, "fixed");
                  }
                }
                loopBudget?.commit(tresv, { ok: accepted, improved: accepted, usd: typeof rr?.usd === "number" ? rr.usd : 0.06, signature: sig, revision: loopBudget.history.length });
              } catch (e) {
                // 수리 호출이 이미 나간 뒤의 오류(재판정 포함)는 비용을 기록하고, 호출 자체가 실패한 예약만 푼다.
                if (rr) loopBudget?.commit(tresv, { ok: false, usd: typeof rr.usd === "number" ? rr.usd : 0.06, signature: sig, revision: loopBudget.history.length });
                else loopBudget?.rollback(tresv);
                if (halting(e, "LLM") && !timedOut(e) && !busy(e)) throw e; recovery.callFailed++;
              }
            }
            if (t5) ev.emit({ stage: "support", unit: s.sectionId, level: "info", code: "T5_REPAIR", msg: `repaired=${t5ok} of=${t5}` });
            // (d) 끝내 불명확한 주장은 확정 본문에서 빼되 데이터로 보존한다. 뺄 수 있는 가장 깊은 조상 — null 허용 칸이나
            //     목록 항목 — 을 빼고, 그 노드 안의 주장은 모두 pending 에 보존한다(동반 손실분의 글자도 남는다).
            //     뺄 곳이 없거나 뺀 뒤 계약이 깨지면 블록째 보류하되 봉투 전체를 pending 에 남긴다 — 정상 조건·사례를
            //     저장 구조에서 파괴하지 않기 위해서다. 그 정의·칸에 기대는 내용은 조립의 의존 정리(§12.2)가 걸러 낸다.
            const held = [];
            for (const [id, g] of lowByBlock) {
              const left = lows().filter(c => c.bid === id);
              if (!left.length) continue;
              unsupported += left.length;
              for (const c of left) outcomes.set(c.claim, "direct");
              const env = envOf(id), byCut = new Map();
              for (const c of left) {
                const cut = cutPath(g.type, c.path);
                if (!cut) { byCut.clear(); break; }
                (byCut.get(cut.path) ?? byCut.set(cut.path, { cut, cs: [] }).get(cut.path)).cs.push(c);
              }
              const env2 = byCut.size ? withoutClaims(g.type, env, [...byCut.keys()]) : null;
              if (env2 && blockOk(id, env2)) {
                work[id] = env2; trimmed += left.length;
                for (const { cut, cs } of byCut.values())
                  held.push({ sectionId: s.sectionId, blockId: id, type: g.type, paths: cs.map(c => c.path),
                    claims: claimsIn(nodeAt(env, cut.segs)).map(x => JSON.parse(JSON.stringify(x.claim))), envelope: null });
              } else {
                // 블록째 보류 — 정규화·재연결까지 반영된 작업 봉투를 통째로 보존한다.
                held.push({ sectionId: s.sectionId, blockId: id, type: g.type, paths: left.map(c => c.path), claims: left.map(c => JSON.parse(JSON.stringify(c.claim))), envelope: env });
                work[id] = null; heldIds.add(id); nulled++;
              }
            }
            for (const p of held) pendings.push(p);
            if (judgeShadow) return s;
            return { ...s, output: { ...s.output, blocks: merged() }, ...(src ? { src } : {}), ...(held.length ? { pending: held } : {}) };
          }, { lanes: lanes("judge"), signal, events: ev, stage: "support" }), "JDG");
        }

        // §3 연결 편집(draft 경로 + linkEditor): 검증 통과 블록의 주장을 전역 Writer 입력처럼 축약해(근거 원문 없이,
        // 주장마다 봉투 안 경로를 얹어) 보내고 변경 제안 목록만 받는다. 본문 전체 재작성이 아니다 — 코드가 제안을
        // 적용하되, rewrite·rename 은 그 주장만 다시 블록 검증+T5 재판정(실패하면 원래 문장 유지), drop_duplicate 는
        // 뺀 뒤 블록이 계약을 지키는 것만 반영하고, flag·contradiction 은 본문을 바꾸지 않고 checks(input_conflict)로 남긴다.
        // v2 모드는 link 대신 통합 편집 검수(review) 1회가 같은 자리에 선다 — 둘을 연속 실행하지 않는다.
        // 본문 확정 뒤에는 draft 경로에서 null 로 온 B14 를 questions 단계가 살아남은 주장만으로 채운다 — 실패·검증
        // 실패는 그대로 null(기존 보류)이다.
        let reviewResult = null; // v2 검수 집계(내용 없는 수치만) — 단계 결과에 실어 평가 하네스가 쓴다
        if (linkEdit || V2) {
          const lt = {}, cnt = k => lt[k] ??= { proposed: 0, applied: 0, rejected: 0 };
          const LINK_TARGET = /^(S[0-9]{1,3}_B[0-9]{1,2})(\/[A-Za-z0-9_]{1,24}(?:\/[A-Za-z0-9_]{1,24}){0,7})?$/;
          const isClaim = v => v && typeof v === "object" && !Array.isArray(v) && typeof v.text === "string" && Array.isArray(v.evidenceIds) && typeof v.basis === "string";
          const survivors = () => {
            const out = [], byBlock = new Map();
            for (const s of sections) if (s.output) {
              const v = check(s.sectionId, s.output), ok = v.blocks.filter(b => !b.errors.length);
              if (!v.errors.length && ok.length) { out.push({ sectionId: s.sectionId, title: planOf.get(s.sectionId).title, gist: null, blocks: ok }); for (const b of ok) byBlock.set(b.id, s); }
            }
            return [out, byBlock];
          };
          const [surv, secByBlock] = survivors();
          // 제안 적용의 공통 원시 함수 — link·review 가 같은 복사본 쓰기·재검증·원복 규칙을 쓴다.
          // 쓰기는 섹션 출력 복사본에 하고, 제안별로 검증이 지나는 것만 끝에 반영한다.
          const wk = new Map(); // sectionId → {s, blocks, src, checks}
          const work = s => { let w = wk.get(s.sectionId); if (!w) wk.set(s.sectionId, w = { s, blocks: { ...s.output.blocks }, src: { ...(s.src ?? {}) }, checks: [...(s.output.checks ?? [])] }); return w; };
          // 첫 접근 때 봉투를 깊게 복사한다 — blocks 맵의 얕은 복사만으로는 봉투가 원본 객체를 공유한다.
          const envOf = bid => { const s = secByBlock.get(bid); if (!s) return null; const w = work(s);
            if (!Object.hasOwn(w.blocks, bid) || w.blocks[bid] === s.output.blocks[bid]) w.blocks[bid] = s.output.blocks[bid] == null ? null : JSON.parse(JSON.stringify(s.output.blocks[bid]));
            return w.blocks[bid]; };
          const blockOk = (bid, env) => { const s = secByBlock.get(bid), w = wk.get(s.sectionId); return !check(s.sectionId, { ...s.output, blocks: { ...(w?.blocks ?? s.output.blocks), [bid]: env } }).blocks.find(b => b.id === bid).errors.length; };
          // 주장 경로는 요청 입력이 보여 주는 봉투-상대(/content/x)와 내용-상대(/x) 둘을 받는다 — xpath 는 봉투-상대로 통일한다.
          const claimAt = t => { const m = LINK_TARGET.exec(t); if (!m || !secByBlock.has(m[1])) return null;
            if (!m[2]) { const n = envOf(m[1]); return n ? { bid: m[1], s: secByBlock.get(m[1]), path: "", xpath: "", node: n } : null; }
            const segs = m[2].split("/").slice(1), env = envOf(m[1]);
            let n = nodeAt(env, segs), xp = m[2];
            if (n == null) { n = nodeAt(env?.content, segs); xp = "/content" + m[2]; }
            return n ? { bid: m[1], s: secByBlock.get(m[1]), path: m[2], xpath: xp, node: n } : null; };
          // 바뀐 주장들의 text·evidenceIds 쌍으로 지지 재판정 — 낮은 지지는 support_failed, 판정 누락·호출 실패는 unjudged.
          const rejudge = async nodes => {
            const items = nodes.filter(n => n && n.basis === "lecture").map(n => ({ text: n.text, evidenceIds: n.evidenceIds }));
            if (!judged || !items.length) return "ok";
            try {
              const jr = await Verify.checkSupport(items, R().evidence, { judge });
              return jr.unjudged.length ? "unjudged" : jr.ok ? "ok" : "support_failed";
            } catch (e) { if (halting(e, "JDG")) throw e; return "unjudged"; }
          };
          // 주장 문장(+인용 근거)을 하나의 변경으로 바꾸고 블록 검증·T5 재판정을 다시 거친다 — 하나라도 실패하면 둘 다 원복.
          // 돌려주는 값은 "ok" 또는 반려 사유(shape_failed·support_failed·unjudged) — 집계는 호출부가 한다.
          const rewriteClaim = async (x, text, evidenceIds = null) => {
            const before = x.node.text, beforeEv = x.node.evidenceIds;
            x.node.text = text;
            if (evidenceIds) x.node.evidenceIds = uniq(evidenceIds).slice(0, 8);
            const why = blockOk(x.bid, envOf(x.bid)) ? await rejudge([x.node]) : "shape_failed";
            if (why !== "ok") { x.node.text = before; x.node.evidenceIds = beforeEv; return why; }
            delete work(x.s).src[`/blocks/${x.bid}${x.xpath}`]; // 바뀐 문장의 낡은 원문 대조는 지운다
            for (const c of claimsByBlock.get(x.bid) ?? []) if (c.path === x.xpath) outcomes.set(c.claim, "fixed");
            return "ok";
          };
          const mergeWork = () => { if (wk.size) sections = sections.map(s => { const w = wk.get(s.sectionId); return w ? { ...s, output: { ...s.output, blocks: w.blocks, checks: w.checks }, ...(Object.keys(w.src).length ? { src: w.src } : {}) } : s; }); };

          if (V2) {
            // v2 통합 편집 검수(review, §4.3): 입력 = 고정 계획 + 살아남은 주장/관계/그림 연결. 출력은 호스트 id 대상의
            // 제한된 수정 목록(≤12)과 미해결 목록. 본문 재작성이 아니다 — 같은 재검증·원복 규칙으로 적용하고,
            // request_section_redo 는 Sol 재작성 최대 2개만 받는다 — mis-sol-hai(htmlReview)는 영상 10분당 1개 상한으로 바뀐다(§4.7).
            let reviewIn = null, reviewHtml = null, reviewOmitted = [];
            if (htmlReview && surv.length) {
              // 렌더 HTML 축약본(D8): 지금 섹션 상태로 노트를 조립해 렌더하고, CSS·스크립트·크롭 바이트를 뺀다.
              // 렌더러가 없거나 실패하면 기존 주장 축약 입력으로 돌아간다(검수를 건너뛰지 않는다) — 폴백은 코드로 남긴다.
              try {
                injectMarks(sections); // 강조 인용·반복 횟수는 렌더가 보는 노트에도 들어가야 검수가 실제 화면을 본다
                const m = input?.meta ?? {}, au = R().ir.units, now2 = (deps.now ?? (() => new Date()))();
                const draft = NoteContract.assembleNote({ ...base, sections, global: null, units: units(), crops: Object.keys(R().cropMap), tier, systemNotices: gapNotices, promptVersion: ctx.out.planning.promptVersion ?? null, events: ev,
                  evidenceMeta: evidenceMetaOf(),
                  meta: { title: m.title ?? null, course: m.course ?? null, lectureDate: m.lectureDate ?? null, session: m.session ?? null, lang: m.lang ?? "ko", generatedAt: now2.toISOString(), processed: au.length ? { t0: Math.min(...au.map(u => u.t0)), t1: Math.max(...au.map(u => u.t1)) } : { t0: 0, t1: 0 } } });
                const out = NoteRender?.renderNote ? NoteRender.renderNote(draft, { katex: deps.katex, crops: R().cropMap }) : null;
                const h = typeof out === "string" ? out : out?.html;
                if (typeof h === "string" && h && ReviewHtml) { const t = ReviewHtml.trim(h); reviewHtml = t.html; reviewOmitted = t.omittedIds; }
              } catch {}
              if (!reviewHtml) ev.emit({ stage: "validate", level: "warn", code: "REVIEW_HTML_FALLBACK", msg: "claims-input" });
            }
            if (!reviewHtml && surv.length) reviewIn = globalSections(surv, GLOBAL_BYTES, true);
            // 블록이 실제로 연 asset 목록을 보여 줘야 relink_asset 제안이 현재 연결을 고른다 — link 입력 계약에는 이 칸이 없어 review 에만 얹는다.
            if (reviewIn) {
              const figOf = new Map(surv.flatMap(s => s.blocks.map(b => [b.id, b.envelope?.content?.figureIds])));
              for (const s of reviewIn) for (const b of s.blocks) { const f = figOf.get(b.blockId); if (Array.isArray(f)) b.figureIds = f.slice(0, 4); }
            }
            // operation 허용 칸은 계약의 REVIEW_OPS 표 하나가 원천 — 스키마와 여기가 같은 정의를 본다.
            const REVIEW_OPS = NoteContract.REVIEW_OPS && typeof NoteContract.REVIEW_OPS === "object" ? NoteContract.REVIEW_OPS : {};
            const reviewShape = x => {
              const sch = NoteContract.reviewOutputSchema; // 계약 담당이 넣으면 그 strict 스키마로 salvage 한다
              if (sch) { const o = Contracts.salvage(sch, x?.output ?? null); must(Contracts.validate(sch, o.value).ok); return o.value; }
              const o = x?.output;
              must(o && typeof o === "object" && !Array.isArray(o));
              return {
                edits: (Array.isArray(o.edits) ? o.edits : []).filter(e => e && typeof e === "object" && Object.hasOwn(REVIEW_OPS, e.op) && typeof e.targetId === "string" && typeof e.reasonCode === "string").slice(0, 12),
                unresolved: (Array.isArray(o.unresolved) ? o.unresolved : []).filter(u => u && typeof u.targetId === "string" && typeof u.reasonCode === "string").slice(0, 40),
              };
            };
            let redone = 0, unresolved = [];
            // 제안→적용 집계(내용 없는 수치만): proposed 제안됨 → queued 재작성 큐 → executed 임시 적용됨 → accepted 재검증 통과로 확정.
            const reviewCounts = { proposed: 0, queued: 0, executed: 0, accepted: 0 };
            const reviewRejects = { target_missing: 0, unsupported_operation: 0, no_change: 0, shape_failed: 0, support_failed: 0, unjudged: 0, budget_skip: 0, stale_revision: 0 };
            const rej = (t, why) => { t.rejected++; reviewRejects[why]++; };
            if (reviewIn || reviewHtml) try {
              const baseRevision = (await Pipeline.digest(reviewHtml ?? reviewIn)).slice(0, 16);
              const r = await call("write", "review", modelFor("review"), { stage: "review", noteSpecVersion: SPEC, baseRevision, concepts: plan.concepts, ...(reviewHtml ? { html: reviewHtml, ...(reviewOmitted.length ? { omittedSectionIds: reviewOmitted } : {}) } : { sections: reviewIn }), editorialPlan: editorial, options, allowedRefs: allowedRefs(), ...langBody() }, "LLM", reviewShape);
              unresolved = r.unresolved;
              // 재작성 상한 — 기본 2개, mis-sol-hai 는 영상 10분당 1개(§4.7). Sol의 출력 순서가 우선순위다. 유닛 시각은 초 단위다.
              const au2 = R().ir.units, durMin = au2.length ? (Math.max(...au2.map(u => u.t1)) - Math.min(...au2.map(u => u.t0))) / 60 : 0;
              const cap = htmlReview && ReviewHtml ? ReviewHtml.redoCap(durMin) : 2;
              const isRedoTarget = id => /^S[0-9]{1,3}$/.test(id) && sections.some(s => s.sectionId === id && s.output);
              // 출력이 다른 입력 판본을 보고 쓴 것이면 제안 전부가 낡다 — 큐·적용 없이 전부 거절한다.
              const stale = r.baseRevision !== baseRevision;
              const pr = stale || !ReviewHtml ? { queue: [], over: [], rejected: [] }
                : ReviewHtml.pickRedos(r.edits, cap, isRedoTarget);
              for (const ed of r.edits) {
                const t = cnt(ed.op); t.proposed++; reviewCounts.proposed++;
                if (stale) { rej(t, "stale_revision"); continue; }
                const spec = REVIEW_OPS[ed.op];
                if (!spec) { rej(t, "unsupported_operation"); continue; }
                if (ed.op === "request_section_redo") continue; // 채택·반려는 pickRedos 가 우선순위 순으로 나눈다
                const x = claimAt(ed.targetId); // 대상은 호스트 id(S#_B# + 봉투 안 경로)만 — 범용 patch 경로는 없다
                if (!x) { rej(t, "target_missing"); continue; }
                const ch = ed.change && typeof ed.change === "object" ? ed.change : {};
                // 계약이 선언한 필수 칸이 비어 있으면 이 op 의 정상 출력이 아니다 — 선언되지 않은 칸은 읽지 않는다.
                if (!spec.required.every(f => ch[f] != null && (!Array.isArray(ch[f]) || ch[f].length))) { rej(t, "shape_failed"); continue; }
                if (ed.op === "dedupe") { // 지울 중복 주장 하나 — 경로 없는 지정은 받지 않고, 뺀 뒤 계약이 지켜지는 것만 반영한다
                  if (!x.path) { rej(t, "target_missing"); continue; }
                  const type = planOf.get(x.s.sectionId).blocks.find(b => b.blockId === x.bid)?.type;
                  const env = withoutClaims(type, envOf(x.bid), [x.xpath]);
                  reviewCounts.executed++;
                  if (!env || !blockOk(x.bid, env)) { rej(t, "shape_failed"); continue; }
                  work(x.s).blocks[x.bid] = env; t.applied++; reviewCounts.accepted++; continue;
                }
                if (ed.op === "relink_asset") { // 기존 asset 재연결 — 그 섹션 유닛(계획 교차 유닛 포함)의 도표 id 만, 블록의 figureIds 칸만 바꾼다
                  const env = envOf(x.bid);
                  if (x.path || !env?.content || !Array.isArray(env.content.figureIds)) { rej(t, "target_missing"); continue; }
                  const sec = planOf.get(x.s.sectionId), us = ownUnits(sec);
                  const allowed = new Set([...(sec.blocks.find(b => b.blockId === x.bid)?.figureIds ?? []), ...R().figures.filter(f => us.has(f.unitId)).map(f => f.id)]);
                  if (!ch.assetIds.every(f => allowed.has(f))) { rej(t, "shape_failed"); continue; }
                  if (sameIds(uniq(ch.assetIds).slice(0, 6), env.content.figureIds)) { rej(t, "no_change"); continue; }
                  reviewCounts.executed++;
                  const before = env.content.figureIds; env.content.figureIds = uniq(ch.assetIds).slice(0, 6);
                  if (!blockOk(x.bid, env)) { env.content.figureIds = before; rej(t, "shape_failed"); continue; }
                  t.applied++; reviewCounts.accepted++; continue;
                }
                // term_fix — {from,to} 용어 치환. 주장 경로면 그 주장만, 블록이면 그 안의 모든 주장에서 바꾼다.
                // 바뀐 주장은 블록 검증 + 지지 재판정을 함께 통과해야 확정이다(하나라도 실패면 전부 원복).
                if (ed.op === "term_fix") {
                  const list = x.path ? (isClaim(x.node) ? [{ path: x.xpath, claim: x.node }] : null) : claimsIn(envOf(x.bid));
                  if (!list) { rej(t, "target_missing"); continue; }
                  const todo = list.filter(({ claim: c }) => c.text.includes(ch.from));
                  if (!todo.length) { rej(t, "no_change"); continue; }
                  reviewCounts.executed++;
                  const before = todo.map(({ claim: c }) => c.text);
                  for (const { claim: c } of todo) c.text = c.text.split(ch.from).join(ch.to);
                  const why = blockOk(x.bid, envOf(x.bid)) ? await rejudge(todo.map(e => e.claim)) : "shape_failed";
                  if (why !== "ok") { todo.forEach(({ claim: c }, i) => c.text = before[i]); rej(t, why); continue; }
                  const w = work(x.s);
                  for (const { path } of todo) {
                    delete w.src[`/blocks/${x.bid}${path}`]; // 바뀐 문장의 낡은 원문 대조는 지운다
                    for (const c of claimsByBlock.get(x.bid) ?? []) if (c.path === path) outcomes.set(c.claim, "fixed");
                  }
                  t.applied++; reviewCounts.accepted++; continue;
                }
                // relation_fix — 비주장 노드는 change.value 치환만 받는다. 블록 재검증 실패 시 원복.
                if (ed.op === "relation_fix") {
                  if (!x.path || isClaim(x.node)) { rej(t, "target_missing"); continue; }
                  const segs = x.xpath.split("/").slice(1), parent = nodeAt(envOf(x.bid), segs.slice(0, -1));
                  if (!parent || typeof parent !== "object") { rej(t, "target_missing"); continue; }
                  const before = parent[segs.at(-1)];
                  if (before === ch.value) { rej(t, "no_change"); continue; }
                  reviewCounts.executed++;
                  parent[segs.at(-1)] = ch.value;
                  if (!blockOk(x.bid, envOf(x.bid))) { parent[segs.at(-1)] = before; rej(t, "shape_failed"); continue; }
                  t.applied++; reviewCounts.accepted++; continue;
                }
                // claim_edit — 문장과 인용 근거를 하나의 변경으로 받는다: change.claim 이 있으면 그 text·evidenceIds 를,
                // 아니면 change.text 와 제안의 evidenceIds(있을 때만)를 쓴다. 블록 검증·T5 를 함께 통과해야 확정, 실패 시 원복.
                if (ed.op === "claim_edit") {
                  if (!x.path || !isClaim(x.node)) { rej(t, "target_missing"); continue; }
                  const ntext = typeof ch.claim?.text === "string" && ch.claim.text.trim() ? ch.claim.text.trim()
                    : typeof ch.text === "string" && ch.text.trim() ? ch.text.trim() : null;
                  const nev = ch.claim?.evidenceIds ?? ((ed.evidenceIds ?? []).length ? ed.evidenceIds : null);
                  if (nev && !nev.every(okEv)) { rej(t, "shape_failed"); continue; }
                  const sameT = ntext == null || ntext === x.node.text, sameE = !nev || sameIds(nev, x.node.evidenceIds);
                  if (sameT && sameE) { rej(t, "no_change"); continue; }
                  if (ntext != null && ntext.length > 600) { rej(t, "shape_failed"); continue; }
                  reviewCounts.executed++;
                  const why = await rewriteClaim(x, ntext ?? x.node.text, nev);
                  if (why !== "ok") { rej(t, why); continue; }
                  t.applied++; reviewCounts.accepted++; continue;
                }
                rej(t, "unsupported_operation"); // REVIEW_OPS 에 없는 op — 스키마가 거르지만 방어적으로 둔다
              }
              mergeWork();
              // 섹션 재작성 선택(우선순위 = Sol 출력 순서): pickRedos 가 채택·상한 초과·반려를 나눈다. 큐 등록(queued)은 채택(accepted)이 아니다.
              { const rt = cnt("request_section_redo");
                for (const why of pr.rejected) rej(rt, why);
                reviewCounts.queued += pr.queue.length + pr.over.length;
                for (const id of pr.over) rej(rt, "budget_skip"); }
              // Sol이 재작성 이유·지시를 change.note 에 남기면 작성자에게 errors.detail 로 전한다(≤64자 — 스키마 상한).
              const redoNote = new Map();
              for (const ed of r.edits) if (ed.op === "request_section_redo" && typeof ed.change?.note === "string" && ed.change.note.trim() && !redoNote.has(ed.targetId)) redoNote.set(ed.targetId, ed.change.note.trim());
              // 재작성 실행은 프로파일의 재작성 단계 모델 — mis-sol-hai 는 작성 모델(draft, Haiku)이 Sol 지시로 수행한다(§4.7).
              const redoModel = modelFor(htmlReview ? "draft" : "repair");
              // 부분 수정과 같은 정책으로 채택한다: 임시 적용 → 섹션 계약 + 재작성 주장의 지지 재판정 통과 시에만 확정, 아니면 원복(§4.4-6).
              for (const sid of pr.queue) {
                const s = sections.find(v => v.sectionId === sid && v.output), sec = planOf.get(sid), t = cnt("request_section_redo");
                const entries = (sec?.blocks ?? []).map(b => ({ blockId: b.blockId, previous: null, mode: "regenerate_missing", errors: [{ code: "VAL_SECTION_REDO", detail: ["review", ...(redoNote.has(sid) ? [redoNote.get(sid).slice(0, 60)] : [])] }] }));
                if (!s || !sec || !entries.length || entries.length > 12) { rej(t, "target_missing"); continue; }
                // 섹션 전체 재작성도 같은 실행 계약이다 — 대상별로 예약하고 채택·원복 결과를 기록한다(원인 묶음: review_redo).
                const rjobs = entries.map(e => {
                  const r = loopBudget?.reserveAttempt(e.blockId, "review_redo", 0.05);
                  if (loopBudget && !r) loopSkip(e.blockId, "budget_exhausted");
                  return [e, r];
                }).filter(([, r]) => r !== null);
                if (loopBudget && !rjobs.length) { loopSkip(sid, "budget_exhausted"); rej(t, "budget_skip"); continue; }
                reviewCounts.executed++;
                let rr = null;
                try {
                  rr = await call("write", "repair", redoModel, { stage: "repair", ...(packetMode ? packetFor(sec, rjobs.map(([e]) => e), s.output) : { ...writeBody(sec), repair: rjobs.map(([e]) => e) }) }, "LLM", repairShape(sec, rjobs.map(([e]) => e)));
                  const rw = rr, cand = { ...s.output, blocks: { ...s.output.blocks, ...rw.blocks } };
                  const rv = check(sid, cand);
                  const per = (typeof rr?.usd === "number" ? rr.usd : rjobs.length * 0.05) / Math.max(1, rjobs.length);
                  for (const [e, r] of rjobs) loopBudget?.commit(r, { ok: !rv.errors.length && !rv.blocks.some(b => b.envelope == null || b.errors.length), improved: false, usd: per, signature: RepairPlan?.signatureOf?.(e.errors), revision: loopBudget.history.length });
                  if (rv.errors.length || rv.blocks.some(b => b.envelope == null || b.errors.length)) { rej(t, "shape_failed"); continue; } // 원복
                  const m = Object.fromEntries(Object.entries(s.src ?? {}).filter(([k]) => !entries.some(e => k.startsWith(`/blocks/${e.blockId}/`))));
                  for (const [k, t2] of Object.entries(rw.src ?? {})) m[k] = t2;
                  // 재작성 블록의 강의 근거 주장은 새 src 로 지지 재판정을 통과해야 채택한다 — claim_edit 과 같은 필수 검증.
                  const qc = [];
                  for (const bid of Object.keys(rw.blocks)) for (const { path, claim: c } of claimsIn(rw.blocks[bid] ?? {})) if (c.basis === "lecture") qc.push({ text: m[`/blocks/${bid}${path}`] ?? c.text, evidenceIds: c.evidenceIds });
                  const jr = judged && qc.length ? await Verify.checkSupport(qc, R().evidence, { judge }) : null;
                  if (jr && (!jr.ok || jr.unjudged.length)) { rej(t, jr.unjudged.length ? "unjudged" : "support_failed"); continue; }
                  s.output = cand; s.src = m; redone++;
                  for (const bid of Object.keys(rw.blocks)) fixedBlocks.add(bid);
                  t.applied++; reviewCounts.accepted++;
                } catch (e) {
                  // 호출이 성립하지 않은 예약은 시도를 쓰지 않고 푼다 — 응답이 와서 뒤 검증이 깨진 경우는 비용을 기록해 닫는다.
                  const per = (typeof rr?.usd === "number" ? rr.usd : rjobs.length * 0.05) / Math.max(1, rjobs.length);
                  for (const [e, r] of rjobs) if (r?.open) rr ? loopBudget?.commit(r, { ok: false, usd: per, signature: RepairPlan?.signatureOf?.(e.errors), revision: loopBudget.history.length }) : loopBudget?.rollback(r);
                  if (halting(e, "LLM") && !timedOut(e) && !busy(e)) throw e;
                  ev.emit({ stage: "validate", unit: sid, level: "warn", code: "REVIEW_REDO_FAILED", msg: errTag(e).slice(0, 60) });
                }
              }
              // 상한을 넘긴 재작성 요청과 미해결 목록은 조용히 승인하지 않고 코드·id로 남긴다(내용 없음).
              const over = pr.over;
              if (over.length || unresolved.length)
                ev.emit({ stage: "validate", level: "warn", code: "REVIEW_UNRESOLVED", msg: [...unresolved.map(u => `${u.targetId}:${u.reasonCode}`.slice(0, 40)), ...over.map(id => `${id}:cap`)].join(",").slice(0, 200) });
            } catch (e) {
              if (halting(e, "LLM") && !timedOut(e) && !busy(e)) throw e;
              ev.emit({ stage: "validate", level: "warn", code: "REVIEW_FAILED", msg: (timedOut(e) ? "timeout" : errTag(e)).slice(0, 60) });
            }
            reviewResult = { reviewCounts, reviewRejects };
            ev.emit({ stage: "validate", level: "info", code: "REVIEW_EDITS", msg: `counts=${reviewCounts.proposed}/${reviewCounts.queued}/${reviewCounts.executed}/${reviewCounts.accepted} rejects=${Object.entries(reviewRejects).filter(([, n]) => n).map(([k, n]) => `${k}:${n}`).join(",") || "-"} ${(Object.entries(lt).map(([k, v]) => `${k}=${v.proposed}/${v.applied}/${v.rejected}`).join(" ") || "-")} redo=${redone} unresolved=${unresolved.length}`.slice(0, 200) });
          } else {
          const linkIn = surv.length ? globalSections(surv, GLOBAL_BYTES, true) : null;
          if (linkIn) try {
            // 제안 하나의 형식 오류가 목록 전체를 죽이지 않게 salvage 로 어긋난 항목만 빼고 살린다.
            const linkShape = x => { const o = Contracts.salvage(NoteContract.linkOutputSchema, x?.output ?? null); must(Contracts.validate(NoteContract.linkOutputSchema, o.value).ok); return o.value; };
            const r = await call("write", "link", models.write, { stage: "link", noteSpecVersion: SPEC, concepts: plan.concepts, sections: linkIn, options, allowedRefs: allowedRefs(), ...langBody() }, "LLM", linkShape);
            for (const ed of r.edits ?? []) {
              const t = cnt(ed.kind); t.proposed++;
              const targets = (ed.targets ?? []).map(claimAt);
              if (!targets.length || targets.some(x => !x)) { t.rejected++; continue; }
              if (ed.kind === "contradiction" || ed.action === "flag") {
                // 모순·표시는 자동 수정하지 않는다 — 관련 섹션마다 그 섹션 블록만 가리키는 확인 항목으로 남긴다.
                const perSec = new Map();
                for (const x of targets) {
                  const g = perSec.get(x.s.sectionId) ?? perSec.set(x.s.sectionId, { s: x.s, bids: [], claim: null }).get(x.s.sectionId);
                  if (!g.bids.includes(x.bid)) g.bids.push(x.bid);
                  if (!g.claim) {
                    const c = isClaim(x.node) ? x.node : claimsIn(x.node)[0]?.claim;
                    if (c && ["lecture", "derived"].includes(c.basis) && c.evidenceIds.length) g.claim = c;
                  }
                }
                let flagged = false;
                for (const g of perSec.values()) if (g.claim && work(g.s).checks.length < 6) {
                  work(g.s).checks.push({ kind: "input_conflict", claim: { text: g.claim.text, evidenceIds: [...g.claim.evidenceIds], basis: g.claim.basis }, targetIds: g.bids.slice(0, 4), before: null, after: null, hold: null });
                  flagged = true;
                }
                flagged ? t.applied++ : t.rejected++;
                continue;
              }
              if (ed.action === "drop_duplicate") {
                // 첫 target 은 남기는 판본이고 나머지가 지울 중복 주장이다 — 주장 경로가 없으면 받지 않는다.
                const drops = targets.slice(1), byBid = new Map();
                for (const x of drops) if (x.xpath) (byBid.get(x.bid) ?? byBid.set(x.bid, []).get(x.bid)).push(x.xpath);
                let fail = !drops.length || drops.some(x => !x.path); const next = new Map();
                for (const [bid, paths] of fail ? [] : byBid) {
                  const s = secByBlock.get(bid), type = planOf.get(s.sectionId).blocks.find(b => b.blockId === bid)?.type;
                  const env = withoutClaims(type, envOf(bid), paths);
                  if (!env || !blockOk(bid, env)) { fail = true; break; }
                  next.set(bid, env);
                }
                if (fail) { t.rejected++; continue; }
                for (const [bid, env] of next) work(secByBlock.get(bid)).blocks[bid] = env;
                t.applied++; continue;
              }
              // rename_term·rewrite — 주장 하나의 문장만 text 로 바꾼다. 블록 검증과 T5 재판정을 다시 거쳐 실패하면 원복이다.
              const x = targets[0];
              if (targets.length !== 1 || !x.path || typeof ed.text !== "string" || !ed.text.trim() || ed.text.length > 600 || !isClaim(x.node)) { t.rejected++; continue; }
              if (await rewriteClaim(x, ed.text.trim()) === "ok") t.applied++;
              else t.rejected++;
            }
            // 받은 변경만 섹션 출력에 반영한다 — 본문 전체를 갈아끼우지 않는다.
            mergeWork();
          } catch (e) {
            if (halting(e, "LLM") && !timedOut(e) && !busy(e)) throw e;
            ev.emit({ stage: "validate", level: "warn", code: "LINK_FAILED", msg: (timedOut(e) ? "timeout" : errTag(e)).slice(0, 60) });
          }
          ev.emit({ stage: "validate", level: "info", code: "LINK_EDITS", msg: (Object.entries(lt).map(([k, v]) => `${k}=${v.proposed}/${v.applied}/${v.rejected}`).join(" ") || "-").slice(0, 200) });
          }

          // 본문 확정 뒤 문항 — draft 경로의 B14 계획 블록은 작성 때 null 로 온다(W2-A 계약). 살아남은 주장만
          // 입력으로 채우고, allowedRefs 를 살아남은 블록으로 좁혀 답·해설이 죽은 블록을 가리키지 않게 한다.
          const [surv2] = survivors();
          const liveIds = new Set(surv2.flatMap(x => x.blocks.map(b => b.id))), liveSec = new Set(surv2.map(x => x.sectionId));
          const qIn = surv2.length ? globalSections(surv2) : null;
          let qFilled = 0; const qTotal = sections.reduce((n, s) => n + (s.output ? planOf.get(s.sectionId).blocks.filter(b => b.type === "B14" && s.output.blocks[b.blockId] == null).length : 0), 0);
          if (qIn && qTotal) {
            const ar = allowedRefs();
            const qRefs = {
              targetIds: ar.targetIds.filter(id => { const m = /^S[0-9]{1,3}(_B[0-9]{1,2})?/.exec(id); return m ? (m[1] ? liveIds.has(id.split("/")[0]) : liveSec.has(id)) : true; }),
              reviewIds: ar.reviewIds.filter(id => liveIds.has(id)),
            };
            let qRun = 0;
            await settle(await Pipeline.pool(sections.filter(s => s.output && !check(s.sectionId, s.output).errors.length), async s => {
              const sec = planOf.get(s.sectionId);
              for (const pb of sec.blocks.filter(b => b.type === "B14" && s.output.blocks[b.blockId] == null)) {
                qRun++;
                let rr;
                try { rr = await call("write", "questions", modelFor("questions"), { stage: "questions", noteSpecVersion: SPEC, section: sec, blockId: pb.blockId, concepts: plan.concepts, sections: qIn, options, allowedRefs: qRefs, ...(NoteV3.isLunaV2(noteMode) ? { editorialPlan: { v: 1, glossary: editorial?.glossary ?? [] } } : {}), ...langBody() }, "LLM", repairShape(sec, [{ blockId: pb.blockId }], qRefs)); }
                catch (e) { if (halting(e, "LLM") && !timedOut(e) && !busy(e)) throw e; ev.emit({ stage: "validate", unit: s.sectionId, level: "warn", code: "QUESTIONS_SKIP", msg: `${pb.blockId} ${errTag(e)}${e?.detail ? ` @${e.detail}` : ""}`.slice(0, 200) }); continue; }
                const env = rr?.blocks?.[pb.blockId];
                if (env == null) continue;
                const candidate = { ...s.output, blocks: { ...s.output.blocks, [pb.blockId]: env } };
                const v = check(s.sectionId, candidate), rec = v.blocks.find(b => b.id === pb.blockId);
                if (v.errors.length || rec?.envelope == null || rec.errors.length) continue; // 실패는 기존 보류(null) 그대로
                const src = { ...(s.src ?? {}) };
                for (const k of Object.keys(src)) if (k.startsWith(`/blocks/${pb.blockId}/`)) delete src[k];
                for (const [k, t2] of Object.entries(rr.src ?? {})) if (k.startsWith(`/blocks/${pb.blockId}/`)) src[k] = t2;
                s.output = candidate; s.src = src; qFilled++;
              }
            }, { lanes: lanes("write"), signal, events: ev, stage: "validate" }), "LLM");
            ev.emit({ stage: "validate", level: "info", code: "QUESTIONS_FILL", msg: `filled=${qFilled} of=${qRun}` });
          }
        }

        // 전역 Writer(6-4): 살아남은 섹션 블록만, 주장 텍스트와 참조로 줄여 보낸다. 실패하면 노트는 전역 블록 없이 간다(알림).
        let global = null, globalFailed = false, gs = null;
        if (plan.global.length) {
          const survivors = [];
          for (const s of sections) if (s.output) {
            const v = check(s.sectionId, s.output), blocks = v.blocks.filter(b => !b.errors.length);
            if (!v.errors.length && blocks.length) survivors.push({ sectionId: s.sectionId, title: planOf.get(s.sectionId).title, gist: v.gist, blocks });
          }
          gs = survivors.length ? globalSections(survivors) : null;
          if (gs) {
            const globalWith = model => call("write", "global", model, { stage: "global", noteSpecVersion: SPEC, plan: { concepts: plan.concepts, global: plan.global }, sections: gs, options, allowedRefs: allowedRefs(), ...langBody() }, "LLM",
              asOutput(NoteContract.globalOutputSchemaFor(plan.global, allowedRefs())));
            try {
              try { global = await globalWith(modelFor("global")); } catch (e) {
                if (!toAlt(e, models.write)) throw e;
                altNote("validate", null, e, "global");
                global = await globalWith(ALT);
              }
            } catch (e) {
              if (halting(e, "LLM") && !timedOut(e) && !busy(e)) throw e;
              globalFailed = true;
              ev.emit({ stage: "validate", level: "warn", code: "GLOBAL_FAILED", msg: timedOut(e) ? "timeout" : errTag(e).slice(0, 60) });
            }
          } else globalFailed = true;
        }

        if (judged) ev.emit({ stage: "validate", level: "info", code: "SUPPORT_SCORES", msg: `claims=${sup.claims} judged=${sup.judged} low=${sup.low} blocks=${nulled} trimmed=${trimmed} bins<.1,<.3,<.5,<.7,>=.7=${sup.bins.join("/")}` });
        const systemNotices = [...gapNotices];
        if (unsupported && !judgeShadow) systemNotices.push({ code: "NOTE_CLAIMS_UNSUPPORTED", count: unsupported });
        // 빈 블록의 출처(내용 없음): 모델이 보류(writer), 서버가 형식 오류로 비움(server, repair 전 건수), 근거 판정 보류(judge).
        // v2 만: 작성자 null 구제 성공(declinedRecovered)과 루프 제어기 지표(loopMetrics)를 함께 남긴다.
        // loopMetrics 는 실행 계약이 쌓은 이벤트(budget.events + 보류 사유 loopSkips)를 먹는다 — budget 객체를 넘기면 항상 0이다.
        const loopM = V2 ? loopMetrics(loopBudget ? [...loopBudget.events, ...loopSkips] : null) : null;
        // 수정 원인 분리 지표(내용 없는 건수) — 예산 원장의 cause 묶음과 같은 키다.
        if (loopBudget?.history?.length) {
          const rc = {};
          for (const h of loopBudget.history) rc[h.cause] = (rc[h.cause] ?? 0) + 1;
          ev.emit({ stage: "validate", level: "info", code: "REPAIR_CAUSES", msg: ["writer_null", "compiler_unmapped", "schema", "support", "review_redo"].map(k => `${k}=${rc[k] ?? 0}`).join(" ") });
        }
        ev.emit({ stage: "validate", level: "info", code: "BLOCKS_HELD", msg: `writer=${writerHeld} server=${serverHeld} judge=${nulled}${V2 ? ` declined_recovered=${declinedRecovered}` : ""}${loopM && typeof loopM === "object" ? ` ${JSON.stringify(loopM).replace(/[{}" ]/g, "").slice(0, 120)}` : ""}`.slice(0, 200) });
        if (serverHeld) ev.emit({ stage: "validate", level: "info", code: "HELD_WHY", msg: Object.entries(heldWhy).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(", ").slice(0, 200) || "-" });
        if (globalFailed) systemNotices.push({ code: "NOTE_GLOBAL_FAILED" });
        if (!judged) systemNotices.push({ code: "NOTE_JUDGE_SKIPPED" });
        const now = deps.now ?? (() => new Date());
        // 조립이 통째로 뺄 섹션의 사유를 남긴다(코드·개수뿐, 내용 없음): 섹션 오류(커버리지 등), 살아남은 블록 수, 블록 오류 코드.
        for (const s of sections) {
          if (!s.output) { ev.emit({ stage: "validate", unit: s.sectionId, level: "warn", code: "SECTION_DROPPED", msg: "no-output" }); continue; }
          const v = check(s.sectionId, s.output), ok = v.blocks.filter(b => !b.errors.length).length;
          if (v.warnings?.length) ev.emit({ stage: "validate", unit: s.sectionId, level: "info", code: "SECTION_COVERAGE_LOW", msg: v.warnings.map(e => e.detail.join("|")).join(",").slice(0, 60) });
          if (!v.errors.length && ok) continue;
          const codes = [...new Set(v.blocks.flatMap(b => b.errors.map(e => e.code)))].slice(0, 6);
          ev.emit({ stage: "validate", unit: s.sectionId, level: "warn", code: "SECTION_DROPPED",
            msg: `sec=${v.errors.map(e => e.code + (e.detail?.length ? ":" + e.detail.join("|") : "")).join(",") || "-"} blocks=${ok}/${v.blocks.length} codes=${codes.join(",")}`.slice(0, 200) });
        }
        const allUnits = R().ir.units, m = input?.meta ?? {};
        injectMarks(sections); // 재작성으로 바뀐 봉투의 stress 강조에도 인용·반복 횟수를 코드가 단다
        const note = NoteContract.assembleNote({
          // units(): 판정 중요도가 실린 유닛 — 잡담 유닛은 미인용 고지에서 빠진다
          ...base, sections, global, units: units(), crops: Object.keys(R().cropMap), tier, systemNotices, promptVersion: ctx.out.planning.promptVersion ?? null, events: ev, evidenceMeta: evidenceMetaOf(),
          meta: {
            title: m.title ?? null, course: m.course ?? null, lectureDate: m.lectureDate ?? null, session: m.session ?? null, lang: m.lang ?? "ko",
            generatedAt: now().toISOString(), processed: allUnits.length ? { t0: Math.min(...allUnits.map(u => u.t0)), t1: Math.max(...allUnits.map(u => u.t1)) } : { t0: 0, t1: 0 },
          },
        });
        ev.emit({ stage: "validate", msg: `sections=${note.sections.length} dropped=${note.dropped.length} repaired=${repaired}` });
        if (note.stats) ev.emit({ stage: "validate", level: "info", code: "LOSS_CASCADE", msg: `direct=${note.stats.directBlocks} cascade=${note.stats.cascadeBlocks} prunedItems=${note.stats.prunedItems} prunedQuestions=${note.stats.prunedQuestions}` });
        if (plan?.caps) ev.emit({ stage: "validate", level: "info", code: "PLAN_CAPS", msg: `secCut=${plan.caps.sectionsCut} concCut=${plan.caps.conceptsCut} globCut=${plan.caps.globalCut} total=${plan.caps.totalCut}` });
        if (gs?.shrink) ev.emit({ stage: "validate", level: "info", code: "GLOBAL_SECTIONS_SHRINK", msg: `step=${gs.shrink.step} perBlock=${gs.shrink.perBlock} chars=${gs.shrink.chars} bytes=${gs.shrink.bytes}` });
        else if (plan?.global?.length) ev.emit({ stage: "validate", level: "info", code: "GLOBAL_SECTIONS_SHRINK", msg: "step=- perBlock=- chars=- bytes=-" });
        const funnel = Figures.figureFunnelStats({ slides, figures: R().figures, crops: fd.crops ?? [], plan, note, cropMap: R().cropMap });
        if (tier === "paid" || funnel.cropExist > 0 || funnel.selected > 0) {
          ev.emit({ stage: "validate", level: "info", code: "FIGURE_FUNNEL", msg: `cropExist=${funnel.cropExist} selected=${funnel.selected} rejQuality=${funnel.rejectedQuality} planAssigned=${funnel.planAssigned} textRef=${funnel.textReferenced} renderOk=${funnel.renderSuccess}` });
        }
        // 주장 단위 결과 집계(내용 없음). 동반 손실: 직접 저점수가 아닌데 블록 보류·의존 연쇄·목록 가지치기로 본문을 잃은
        // 주장 — judge_low_rate(=low/judged)와 collateral_loss_rate(=collateral/claims)가 여기서 나온다. 본문 잔존은
        // 경로가 아니라 주장 글자로 확인한다(가지치기로 목록 경로는 밀린다). T5 repair 로 통째로 바뀐 블록은 블록 단위로만 본다.
        // judgeShadow 에서는 본문이 안 바뀌어 의존 연쇄는 계산되지 않는다 — collateral 은 보류 블록 동반분만 담는다.
        if (judged) {
          const liveText = new Map();
          for (const sec of note.sections) for (const b of sec.blocks) liveText.set(b.id, new Set(claimsIn(b.content).map(x => x.claim.text)));
          for (const b of note.global) liveText.set(b.id, new Set(claimsIn(b.content).map(x => x.claim.text)));
          for (const [bid, list] of claimsByBlock) {
            const texts = liveText.get(bid), held = heldIds.has(bid), rewritten = fixedBlocks.has(bid);
            for (const c of list) {
              if (outcomes.get(c.claim) === "direct") continue;
              if (held || (rewritten ? texts === undefined : !texts?.has(c.claim.text))) outcomes.set(c.claim, "collateral");
            }
          }
          const tally = {};
          for (const s2 of outcomes.values()) tally[s2] = (tally[s2] ?? 0) + 1;
          const keptPending = pendings.reduce((n, p) => n + (p.envelope ? claimsIn(p.envelope).length : p.claims.length), 0);
          ev.emit({ stage: "validate", level: "info", code: "SUPPORT_OUTCOMES",
            msg: `claims=${sup.claims} kept=${tally.kept ?? 0} relinked=${tally.relinked ?? 0} fixed=${tally.fixed ?? 0} direct=${tally.direct ?? 0} collateral=${tally.collateral ?? 0} unjudged=${tally.unjudged ?? 0} pending=${keptPending}`.slice(0, 200) });
          ev.emit({ stage: "validate", level: "info", code: "SUPPORT_RECOVERY",
            msg: `relink=${recovery.relink[1]}/${recovery.relink[0]} repair=${recovery.repair[1]}/${recovery.repair[0]} budget_skip=${recovery.budgetSkip} rejudge_miss=${recovery.rejudgeMiss} call_failed=${recovery.callFailed}` });
          // 주장별 첫 점수·최종 결과를 단계 결과에 싣는다 — 비교 화면/평가 하네스가 같은 판정을 재조합해 쓴다.
          const byClaim = {};
          for (const [bid, list] of claimsByBlock) for (const c of list)
            byClaim[`${bid}#${c.path}`] = outcomes.get(c.claim) ?? "unjudged";
          support = { scores: Object.fromEntries(claimScores), outcomes: byClaim };
        }
        // 뺀 블록의 사유 코드별 건수(내용 없음) — 어느 검증이 노트를 얇게 만드는지 진단에서 바로 보이게. 판정 보류(null)는 VAL_BLOCK_DECLINED 로 센다.
        if (note.dropped.length) {
          const by = {};
          for (const d of note.dropped) for (const c of d.codes.length ? d.codes : ["-"]) by[c] = (by[c] ?? 0) + 1;
          ev.emit({ stage: "validate", level: "info", code: "BLOCKS_DROPPED", msg: Object.entries(by).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}=${n}`).join(",").slice(0, 200) });
        }
        return { note, ...(support ? { support } : {}), ...(reviewResult ? { review: reviewResult } : {}) };
      });

    // ── H. 렌더: 렌더러는 따로 만든다. 없으면 건너뛴다 ──
    // ponytail: 렌더 결과는 JSON 으로 단계 캐시에 들어간다(HTML 문자열 등). 템플릿이 바뀌면 render.version 을 올려야 캐시가 비켜 간다.
    const rendering = stage("rendering", "LLM",
      () => K({ note: ctx.out.validating.note, render: deps.render ? (deps.render.version ?? "") : null }),
      async () => ({ rendered: deps.render ? await deps.render(ctx.out.validating.note, { signal }) : null }));

    try {
      await Pipeline.runStages(job, [refining, judging, planning, writing, validating, rendering], ctx);
      if (job.state !== "done" || !ctx.out.validating) {
        const { state, code = null, reason = null } = job.record;
        return { status: state, code, reason, note: null, notices: [] };
      }
      const { note } = ctx.out.validating;
      return { status: note.status, note, notices: note.notices, rendered: ctx.out.rendering.rendered, cropMap: R().cropMap };
    } finally {
      // 실험 대화(모델 응답 history·fork 접두)와 v2 편집 계획은 실행 메모리에만 둔다 — 완료·취소·실패 어디로 끝나도 참조를 끊는다.
      if (session) { session.history = []; session.prefix = null; session.warm = null; session.tail = Promise.resolve(); }
      editorial = null;
    }
  }

  const api = { runNote, gapRanges, batches, claimsIn, globalSections, VERSION };
  globalThis.NoteStages = api;
  if (typeof module !== "undefined") module.exports = api;
})();
