# 클라우드 비전 근거 경로 (Phase 1) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 유료 계정이 설정에서 켰을 때만, 화면 프레임을 자체 서비스를 거쳐 멀티모달 비전 모델로 보내 슬라이드를 읽는 두 번째 시각 근거 생산자를 추가한다. 기존 PP-OCR 경로는 기본값으로 그대로 남는다.

**Architecture:** `lib/session.js:5`의 `createOcrEngine()`이 돌려주는 `{recognize(blob), terminate()}`가 유일한 이음매다. 비전 엔진은 이 인터페이스를 그대로 구현하고, `EvidenceStore` 아래(중복 접기 → 청킹 → 합성 → 노트 → PDF → Vault)는 한 줄도 바뀌지 않는다. 유료 판정은 서버가 계정 `features`로 하고, 클라이언트 설정은 의사 표시일 뿐이다.

**Tech Stack:** Manifest V3 확장 (빌드 없는 Vanilla ES2022+), Node.js `node:http` 서비스, `node:test`, OpenRouter.

**Spec:** `docs/superpowers/specs/2026-09-20-vision-fast-track-design.md`

## Global Constraints

- 빌드 단계·번들러 없음. 모든 `lib/*.js`는 IIFE + `globalThis` 노출 + `module.exports` 이중 경로 (`lib/service-client.js` 참고).
- 코드 스타일 기준은 `lib/ai.js`와 `lib/mergeLines.js`. 주석은 "왜"만 남긴다.
- 테스트는 `node --test lib/*.test.js` (AGENTS.md §5). 서버는 `node --test server/index.test.js`.
- 근거 항목의 `source`는 `"ocr" | "asr"` 두 값뿐이다. 비전 결과도 `"ocr"`로 저장한다.
- `chrome.storage`에는 설정만 저장한다. 프레임·텍스트·노트는 저장하지 않는다 (`lib/settings.js`의 `KEYS` 화이트리스트가 강제).
- 오퍼레이터 API 키는 서버에만 둔다. 클라이언트는 `appSessionToken`으로만 서비스를 부른다.
- 비전 기본값은 **꺼짐**이다. `ocrEngine` 기본 `'ppocr-v5-wasm'`, `visionConsent` 기본 `false`.
- 커밋은 Conventional Commits. 브랜치는 `b/dev` (AGENTS.md §3).
- **Task 9는 사용자의 별도 승인 없이는 착수하지 않는다** (AGENTS.md 수정 포함).

---

### Task 1: 서버 계정 기능(feature) 권한

**Files:**
- Modify: `server/index.js:20-26` (계정 한도 검증), `server/index.js:57` (`limitFor`), `server/index.js:141` (`/v1/me`)
- Test: `server/index.test.js`

**Interfaces:**
- Consumes: 없음 (첫 작업)
- Produces: `limitFor(account)`가 `features: string[]`를 포함해 돌려준다. `/v1/me` 응답이 `{accountId, models, features, quota}`가 된다. Task 3과 Task 7이 이에 의존한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/index.test.js` 맨 끝에 추가:

```js
test("account features gate paid capabilities and default to empty", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  const env = {
    ...config(root),
    ACCOUNT_LIMITS_JSON: JSON.stringify({ A: { models: [model], maxRequests: 10, maxCostCents: 100, features: ["vision"] } }),
  };
  const server = createServer(env, { fetch: async () => provider() });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const paid = await (await req(url, "/v1/me")).json();
    assert.deepEqual(paid.features, ["vision"], "설정된 계정은 기능을 그대로 돌려준다");
    const free = await (await req(url, "/v1/me", "GET", undefined, tokenB)).json();
    assert.deepEqual(free.features, [], "한도 설정이 없는 계정은 유료 기능이 없다");
  } finally { await close(server); removeTemp(root); }
});

test("unknown feature names are rejected at boot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  try {
    assert.throws(() => createServer({
      ...config(root),
      ACCOUNT_LIMITS_JSON: JSON.stringify({ A: { models: [model], maxRequests: 1, maxCostCents: 1, features: ["admin"] } }),
    }));
  } finally { removeTemp(root); }
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test server/index.test.js`
Expected: FAIL — `paid.features`가 `undefined`라 `deepEqual`이 깨진다.

- [ ] **Step 3: 최소 구현을 넣는다**

`server/index.js`의 계정 한도 검증 루프를 고친다:

```js
  for(const [id,limit]of Object.entries(accountLimits)){
    if(!Object.hasOwn(tokens,id)||!limit||Object.keys(limit).some(k=>!["models","maxRequests","maxCostCents","features"].includes(k)))throw new Error("invalid_account_limits");
    if(!Array.isArray(limit.models)||!limit.models.length||limit.models.some(m=>!allow.includes(m)))throw new Error("invalid_account_models");
    // 기능 이름은 열린 문자열이 아니다. 오타 난 플랜 설정이 조용히 "기능 없음"으로 읽히면
    // 결제한 계정이 못 쓰고, 넓은 이름을 허용하면 권한이 새로 생겨도 아무도 모른다.
    if(limit.features!==undefined&&(!Array.isArray(limit.features)||limit.features.some(f=>f!=="vision")))throw new Error("invalid_account_features");
    positive(limit.maxRequests);positive(limit.maxCostCents);
  }
```

`limitFor`의 폴백에 빈 배열을 넣는다 — 한도 설정을 빠뜨린 계정이 유료 기능을 갖는 실패 모드를 막는다:

```js
  const limitFor=account=>Object.hasOwn(c.accountLimits,account)?{features:[],...c.accountLimits[account]}:{models:c.allow,maxRequests:c.maxRequests,maxCostCents:c.maxCents,features:[]};
```

`/v1/me` 응답에 실어 보낸다:

```js
      if(req.url==="/v1/me"&&req.method==="GET"){const r=record(account),limits=limitFor(account);return send(res,200,{accountId:account,models:limits.models,features:limits.features,quota:{month:r.month,requests:r.requests,maxRequests:limits.maxRequests,spentCents:r.spentCents,maxCents:limits.maxCostCents}});}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --test server/index.test.js`
Expected: PASS — 신규 2개 포함 전부. 기존 한도 테스트가 깨지면 `limitFor`의 전개 순서를 확인한다(`{features:[], ...limit}`이어야 설정값이 이긴다).

- [ ] **Step 5: 커밋**

```bash
git add server/index.js server/index.test.js
git commit -m "feat(service): 계정별 유료 기능 권한을 서버가 판정한다"
```

---

### Task 2: 예약·계상 공통화

**Files:**
- Modify: `server/index.js` (`summary()` 안의 예약 블록을 헬퍼로 추출)
- Test: `server/index.test.js` (기존 테스트가 회귀 감시자 — 새 테스트 없음)

**Interfaces:**
- Consumes: Task 1의 `limitFor(account).features`
- Produces: `withReservation({account, requestId, digest, reserve, res}, run)` — 한도 검사·락·멱등·예약·정산·해제를 담당한다. `run(signal)`이 `{amount, reported, payload}`를 돌려주면 `payload`를 200으로 보낸다. 던지면 job을 `uncertain`으로 남기고 502/504를 보낸다. Task 3의 `/v1/vision`이 이걸 쓴다.

행동은 바뀌지 않는다. 돈이 걸린 경로라서 먼저 추출해 기존 테스트로 지킨 뒤 새 라우트를 얹는다.

- [ ] **Step 1: 기존 테스트가 지금 통과하는지 확인한다 (기준선)**

Run: `node --test server/index.test.js`
Expected: PASS — 이 줄이 이후 리팩터링의 유일한 판정 기준이다.

- [ ] **Step 2: 헬퍼를 추출한다**

`createServer` 안, `summary()` 정의 바로 위에 넣는다:

```js
  // /v1/summary 와 /v1/vision 이 같은 돈을 쓴다. 예약·멱등·락·정산을 한 군데 두지 않으면
  // 두 라우트의 한도 계산이 조용히 어긋난다 — 어긋난 쪽이 무료로 돌아가는 실패 모드다.
  async function withReservation({account,requestId,digest,reserve,res},run){
    const limits=limitFor(account),rec=record(account);
    const prior=Object.hasOwn(rec.jobs,requestId)?rec.jobs[requestId]:null;
    if(prior)return fail(res,prior.digest===digest?409:400,prior.digest===digest?"request_already_reserved_or_processed":"idempotency_content_mismatch");
    if(locks.has(account))return fail(res,429,"account_request_in_progress");
    const globalSpent=Object.values(state.accounts).filter(r=>r.month===month()).reduce((sum,r)=>sum+r.spentCents,0);
    if(rec.requests>=limits.maxRequests||rec.spentCents+reserve>limits.maxCostCents||globalSpent+reserve>c.globalCents)return fail(res,429,"quota_exceeded");
    locks.add(account);rec.requests++;rec.spentCents+=reserve;rec.jobs[requestId]={digest,status:"reserved",reservedCents:reserve};
    try{save();}catch{locks.delete(account);throw new Error("usage_store_failed");}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),c.timeout);
    const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on("close",disconnect);active.set(account,controller);
    try{
      const {amount,reported,payload}=await run(controller.signal);
      // Unknown or failed requests keep the full reservation; never assume an unreported request was free.
      if(reported)rec.spentCents=Math.max(0,rec.spentCents-reserve+Math.ceil(amount*1e6)/1e4);
      rec.jobs[requestId].status="completed";save();
      send(res,200,payload);
    }catch{
      rec.jobs[requestId].status="uncertain";save();
      fail(res,controller.signal.aborted?504:502,controller.signal.aborted?"request_cancelled_or_timed_out":"provider_failed_or_invalid_output");
    }finally{clearTimeout(timer);res.removeListener("close",disconnect);locks.delete(account);active.delete(account);}
  }
```

- [ ] **Step 3: `summary()`가 헬퍼를 쓰게 고친다**

`summary()`에서 `const digest=...` 줄부터 함수 끝의 `finally{...}` 블록까지를 지우고 이렇게 바꾼다:

```js
    const digest=crypto.createHash("sha256").update(JSON.stringify({model:input.model,stage:input.stage,evidence:items,gaps})).digest("hex");
    const [pi,po]=RATES[input.model],maxOutput=maxTokensFor(input.model),attempts=2;
    // Reserve both attempts: a malformed structured response is retried once on the same fixed provider.
    const reserve=Math.ceil(((Buffer.byteLength(text)+Buffer.byteLength(systemFor(input.stage))+8192)*pi+maxOutput*po)/1e6*100*1.2*attempts);
    return await withReservation({account,requestId:input.requestId,digest,reserve,res},async signal=>{
      let parsed,usage={},amount=0,reported=true;
      for(let retry=0;retry<attempts;retry++){
        const response=await fetcher("https://openrouter.ai/api/v1/chat/completions",{method:"POST",redirect:"error",signal,headers:{authorization:"Bearer "+c.key,"content-type":"application/json"},body:JSON.stringify({
          model:input.model,max_tokens:maxOutput,reasoning:reasoningFor(input.model),
          messages:[systemMessage(input.model,input.stage),{role:"user",content:JSON.stringify({stage:input.stage,evidence:items,...(gaps.length?{gaps}:{})})}],
          response_format:{type:"json_schema",json_schema:{name:"lecture_summary",strict:true,schema}},
          provider:{only:c.providers[input.model],order:c.providers[input.model],require_parameters:true,allow_fallbacks:false,zdr:true,data_collection:"deny"}
        })});
        if(!response.ok)throw new Error("provider_failed");
        const raw=await boundedResponse(response,1024*1024),u=raw.usage||{};
        usage={promptTokens:(usage.promptTokens||0)+(Number(u.prompt_tokens)||0),completionTokens:(usage.completionTokens||0)+(Number(u.completion_tokens)||0)};
        if(typeof u.cost==="number"&&Number.isFinite(u.cost)&&u.cost>=0)amount+=u.cost;else reported=false;
        try{
          if(raw.choices?.[0]?.finish_reason!=="stop")throw new Error("provider_output_incomplete");
          parsed=validateSummary(parseNote(raw.choices[0].message.content),items);
          break;
        }catch(error){if(retry===attempts-1)throw error;}
      }
      return {amount,reported,payload:{summary:parsed,usage:{...usage,costUsd:reported?amount:reserve/100}}};
    });
```

`summary()` 앞쪽에 있던 `rec`·`prior` 조각은 헬퍼가 대체하므로 남기지 않는다.

- [ ] **Step 4: 기존 테스트가 전부 그대로 통과하는지 확인한다**

Run: `node --test server/index.test.js`
Expected: PASS — 특히 "concurrent duplicates never dispatch twice", "durable idempotency", "unreported costs keep reservations" 세 개. 하나라도 깨지면 추출이 잘못된 것이므로 되돌리고 다시 한다.

- [ ] **Step 5: 커밋**

```bash
git add server/index.js
git commit -m "refactor(service): 요청 예약·정산을 라우트에서 분리한다"
```

---

### Task 3: 서버 `/v1/vision` 라우트

**Files:**
- Modify: `server/index.js` (`VISION_RATES`·`VISION_PROMPT` 상수, `config()`의 비전 모델 검증, `vision()` 함수, 라우트 분기)
- Test: `server/index.test.js`

**Interfaces:**
- Consumes: Task 1의 `limitFor(account).features`, Task 2의 `withReservation`
- Produces: `POST /v1/vision` — 요청 `{model, requestId, image}`, 응답 `{text, usage:{promptTokens, completionTokens, costUsd}}`. Task 4의 `ServiceClient.vision`이 이 계약을 부른다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/index.test.js` 끝에 추가:

```js
const visionEnv = root => ({
  ...config(root),
  ALLOWED_VISION_MODELS: JSON.stringify(["google/gemini-2.5-flash-lite"]),
  ACCOUNT_LIMITS_JSON: JSON.stringify({ A: { models: [model], maxRequests: 10, maxCostCents: 500, features: ["vision"] } }),
});
const jpeg = size => "data:image/jpeg;base64," + Buffer.alloc(size, 7).toString("base64");
const visionProvider = text => ({ ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: text } }], usage: { prompt_tokens: 900, completion_tokens: 120, cost: .002 } }) });

test("vision route reads a slide, gates on the paid feature and caps image size", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summrizei-service-test-"));
  let sent = null;
  const server = createServer(visionEnv(root), { fetch: async (_url, options) => { sent = JSON.parse(options.body); return visionProvider("## 키르히호프 법칙\n\n$\\sum i_k = 0$"); } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const ok = await req(url, "/v1/vision", "POST", { model, requestId: "vision-one", image: jpeg(2048) });
    assert.equal(ok.status, 200);
    assert.match((await ok.json()).text, /키르히호프/);
    assert.equal(sent.provider.zdr, true, "프레임은 zdr provider 로만 나간다");
    assert.equal(sent.provider.data_collection, "deny");

    assert.equal((await req(url, "/v1/vision", "POST", { model, requestId: "vision-two", image: jpeg(2 * 1024 * 1024) })).status, 413);
    assert.equal((await req(url, "/v1/vision", "POST", { model, requestId: "vision-three", image: "not-an-image" })).status, 400);
    assert.equal((await req(url, "/v1/vision", "POST", { model, requestId: "vision-four", image: jpeg(2048), extra: 1 })).status, 400);
    assert.equal((await req(url, "/v1/vision", "POST", { model, requestId: "vision-one", image: jpeg(2048) })).status, 409, "같은 요청 id 는 두 번 청구하지 않는다");

    const free = await req(url, "/v1/vision", "POST", { model, requestId: "vision-five", image: jpeg(2048) }, tokenB);
    assert.equal(free.status, 403, "유료 기능이 없는 계정은 UI 를 우회해도 막힌다");
    assert.equal((await free.json()).error, "feature_not_in_account_plan");

    assert.ok(!fs.readFileSync(path.join(root, "usage.json"), "utf8").includes("BwcH"), "프레임은 사용량 파일에 남지 않는다");
  } finally { await close(server); removeTemp(root); }
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test server/index.test.js`
Expected: FAIL — `/v1/vision`이 없어 404가 온다.

- [ ] **Step 3: 라우트를 구현한다**

`server/index.js` 상단, `RATES` 다음 줄에 상수를 둔다:

```js
// 이미지 입력은 텍스트와 단가가 다르고 출력도 훨씬 짧다. /v1/summary 와 예약 계산을 섞지 않는다.
const VISION_RATES={"google/gemini-2.5-flash-lite":[.1,.4],"google/gemini-3.8-flash":[1.5,7.5]};
const VISION_MAX_TOKENS=4096;
// 한 프레임을 읽는 지시. 요약이 아니라 "화면에 있는 것을 구조대로 옮겨 적기"다 —
// 여기서 모델이 요약을 시작하면 뒤쪽 합성 단계가 두 번 요약한 글을 받는다.
const VISION_PROMPT=[
  "이미지는 강의 슬라이드 한 장이다. 화면에 실제로 보이는 내용만 옮겨 적는다.",
  "수식은 LaTeX($...$ 또는 $$...$$), 표는 마크다운 표, 목록은 마크다운 목록으로 적는다.",
  "그래프·도식은 축·계열·추세를 한두 문장으로 설명한다.",
  "요약하거나 배경지식을 덧붙이지 않는다. 보이지 않는 것은 적지 않는다.",
  "판서·강조 표시가 있으면 해당 줄 끝에 (판서)로 표시한다.",
  "슬라이드가 비었거나 읽을 내용이 없으면 빈 문자열만 출력한다.",
].join("\n");
```

`config()` 안, provider 검증 다음에 비전 모델 허용 목록을 읽는다:

```js
  const visionModels=JSON.parse(env.ALLOWED_VISION_MODELS||"[]");
  if(!Array.isArray(visionModels)||visionModels.some(m=>!VISION_RATES[m]))throw new Error("invalid_vision_model_allowlist");
  for(const m of visionModels)if(!Array.isArray(providers[m])||!providers[m].length)throw new Error("explicit_provider_allowlist_required");
```

`config()`의 반환 객체에 `visionModels`를 추가한다.

`createServer` 안, `summary()` 다음에 라우트 본체를 넣는다:

```js
  async function vision(input,account,res){
    if(!(limitFor(account).features||[]).includes("vision"))return fail(res,403,"feature_not_in_account_plan");
    if(!c.visionModels.includes(input.model))return fail(res,400,"invalid_model");
    safePart(input.requestId);
    if(Object.keys(input).some(k=>!["model","requestId","image"].includes(k)))return fail(res,400,"unexpected_field");
    const match=/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(input.image||""));
    if(!match)return fail(res,400,"invalid_image");
    const bytes=Buffer.from(match[1],"base64").byteLength;
    if(!bytes||bytes>1536*1024)return fail(res,413,"image_too_large");
    // digest 는 프레임 내용이 아니라 그 해시로 잡는다. 사용량 파일에 이미지가 남으면 안 된다.
    const digest=crypto.createHash("sha256").update(JSON.stringify({model:input.model,image:crypto.createHash("sha256").update(match[1]).digest("hex")})).digest("hex");
    const [pi,po]=VISION_RATES[input.model];
    // 이미지 토큰 수는 사전에 알 수 없다. 해상도 상한에서 나오는 최악값을 잡고 정산에서 되돌린다.
    const reserve=Math.ceil((8000*pi+VISION_MAX_TOKENS*po)/1e6*100*1.2);
    return await withReservation({account,requestId:input.requestId,digest,reserve,res},async signal=>{
      const response=await fetcher("https://openrouter.ai/api/v1/chat/completions",{method:"POST",redirect:"error",signal,headers:{authorization:"Bearer "+c.key,"content-type":"application/json"},body:JSON.stringify({
        model:input.model,max_tokens:VISION_MAX_TOKENS,
        messages:[{role:"user",content:[{type:"text",text:VISION_PROMPT},{type:"image_url",image_url:{url:input.image}}]}],
        provider:{only:c.providers[input.model],order:c.providers[input.model],require_parameters:true,allow_fallbacks:false,zdr:true,data_collection:"deny"}
      })});
      if(!response.ok)throw new Error("provider_failed");
      const raw=await boundedResponse(response,1024*1024),u=raw.usage||{};
      if(raw.choices?.[0]?.finish_reason!=="stop")throw new Error("provider_output_incomplete");
      const reported=typeof u.cost==="number"&&Number.isFinite(u.cost)&&u.cost>=0;
      return {amount:reported?u.cost:0,reported,payload:{
        text:String(raw.choices[0].message.content||"").slice(0,20000),
        usage:{promptTokens:Number(u.prompt_tokens)||0,completionTokens:Number(u.completion_tokens)||0,costUsd:reported?u.cost:reserve/100},
      }};
    });
  }
```

라우트 분기에 한 줄 추가한다 (`/v1/summary` 줄 옆):

```js
      if(req.url==="/v1/vision"&&req.method==="POST")return await vision(await body(req,2200000),account,res);
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --test server/index.test.js`
Expected: PASS — 신규 테스트와 기존 테스트 전부.

- [ ] **Step 5: 커밋**

```bash
git add server/index.js server/index.test.js
git commit -m "feat(service): 프레임 한 장을 읽는 /v1/vision 라우트를 더한다"
```

---

### Task 4: 클라이언트 비전 엔진

**Files:**
- Create: `lib/vision-client.js`
- Create: `lib/vision-client.test.js`
- Modify: `lib/service-client.js` (`api` 객체에 `vision` 추가)
- Modify: `offscreen.html` (스크립트 태그 추가)

**Interfaces:**
- Consumes: Task 3의 `POST /v1/vision` 계약
- Produces: `globalThis.VisionClient.createVisionEngine({baseUrl, token, model, maxCalls, signal, log})` → `{recognize(blob) → {data:{text, confidence}}, terminate()}`. `lib/session.js:5`의 `createOcrEngine()`과 동형이다. Task 8이 이 함수를 부른다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`lib/vision-client.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

global.ServiceClient = { vision: async () => ({ text: '' }) };
const { createVisionEngine } = require('./vision-client.js');

const blob = bytes => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer, type: 'image/jpeg' });
const engineFor = extra => createVisionEngine({ baseUrl: 'https://service.example', token: 'x'.repeat(40), model: 'google/gemini-2.5-flash-lite', ...extra });

test('engine sends a jpeg data url and returns the slide text', async () => {
  const calls = [];
  global.ServiceClient = { vision: async options => { calls.push(options); return { text: '## 전압 분배\n\n$V_1 = V\\frac{R_1}{R_1+R_2}$' }; } };
  const result = await engineFor().recognize(blob([255, 216, 255, 224]));
  assert.match(result.data.text, /전압 분배/);
  assert.equal(result.data.confidence, null, '비전은 줄 단위 신뢰도를 주지 않는다 — 낮은 값을 지어내면 근거가 uncertain 으로 밀린다');
  assert.match(calls[0].image, /^data:image\/jpeg;base64,/);
  assert.match(calls[0].requestId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, '서버의 safePart 를 통과해야 한다');
});

test('each call uses a fresh request id so the server never 409s on the next slide', async () => {
  const ids = [];
  global.ServiceClient = { vision: async options => { ids.push(options.requestId); return { text: 'a' }; } };
  const engine = engineFor();
  await engine.recognize(blob([1]));
  await engine.recognize(blob([2]));
  assert.notEqual(ids[0], ids[1]);
});

test('an empty slide is not an error', async () => {
  global.ServiceClient = { vision: async () => ({ text: '   ' }) };
  assert.equal((await engineFor().recognize(blob([1]))).data.text, '');
});

test('the session call ceiling stops spending instead of running forever', async () => {
  let calls = 0;
  global.ServiceClient = { vision: async () => { calls++; return { text: 'a' }; } };
  const engine = engineFor({ maxCalls: 2 });
  await engine.recognize(blob([1]));
  await engine.recognize(blob([2]));
  await assert.rejects(() => engine.recognize(blob([3])), /한도/);
  assert.equal(calls, 2);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test lib/vision-client.test.js`
Expected: FAIL — `Cannot find module './vision-client.js'`

- [ ] **Step 3: 구현한다**

`lib/vision-client.js`:

```js
// Cloud slide reader. Shape-identical to the local OCR engine in session.js so the session only picks between them.
// The operator key lives on the service; this client never holds one.
(() => {
  const Service=()=>globalThis.ServiceClient||(typeof require!=="undefined"?require("./service-client.js"):null);
  // btoa 는 문자열만 받고 Blob 은 스트림이라 한 번은 바이트로 펼쳐야 한다. 프레임은 여기서만 존재하고
  // 호출이 끝나면 참조가 사라진다 — 어디에도 저장하지 않는다.
  async function toDataUrl(blob){
    const bytes=new Uint8Array(await blob.arrayBuffer());
    let binary="";
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return "data:image/jpeg;base64,"+btoa(binary);
  }
  // 서버의 safePart 가 통과시키는 문자만 쓴다. 프레임마다 새 id 라야 멱등 검사에 걸리지 않는다.
  const requestId=()=>"vision-"+crypto.randomUUID().replace(/-/g,"");
  function createVisionEngine({baseUrl,token,model,maxCalls=200,signal,log=()=>{}}){
    let calls=0;
    return {
      async recognize(blob){
        if(calls>=maxCalls)throw new Error(`이번 세션의 화면 인식 한도(${maxCalls}장)에 도달했습니다.`);
        calls++;
        const started=Date.now();
        const {text}=await Service().vision({baseUrl,token,model,image:await toDataUrl(blob),requestId:requestId(),signal});
        log(`[화면] 슬라이드 ${calls}장 인식 · ${((Date.now()-started)/1000).toFixed(1)}초`);
        // 비전은 줄 단위 신뢰도를 주지 않는다. null 이어야 summary.js 의 uncertain 판정이 안 걸린다.
        return {data:{text:String(text||"").trim(),confidence:null}};
      },
      terminate(){},
    };
  }
  globalThis.VisionClient={createVisionEngine};
  if(typeof module!=="undefined")module.exports={createVisionEngine};
})();
```

`lib/service-client.js`의 `api` 객체에 한 줄 더한다:

```js
    vision:o=>request(o,"/v1/vision","POST",{model:o.model,image:o.image,requestId:o.requestId}),
```

`offscreen.html`의 `lib/service-client.js` **다음** 줄에 넣는다 (`ServiceClient`가 먼저 있어야 한다):

```html
<script src="lib/vision-client.js"></script>
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --test lib/vision-client.test.js`
Expected: PASS (4개). Node 20+ 에는 `crypto`와 `btoa`가 전역으로 있다. 없다는 오류가 나면 Node 버전을 올린다.

- [ ] **Step 5: 커밋**

```bash
git add lib/vision-client.js lib/vision-client.test.js lib/service-client.js offscreen.html
git commit -m "feat(vision): 로컬 OCR 엔진과 동형인 클라우드 슬라이드 리더를 더한다"
```

---

### Task 5: VisualGate 비전 모드

**Files:**
- Modify: `lib/visual-gate.js:23-38` (생성자와 `inspect`)
- Test: `lib/visual-gate.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: `new VisualGate({mode:"vision", settleMs})`. 인자 없이 만들면 지금과 동일하게 동작한다. Task 8이 모드를 넘긴다.

호출 한 장이 곧 돈이다. 기본 모드는 타일 변화만 넘으면 제출해서 커서 이동·판서 한 줄에도 걸린다. 비전 모드는 **슬라이드 전환**에서만, 그것도 화면이 멎은 뒤에 제출한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`lib/visual-gate.test.js` 끝에 추가 (이 파일의 `frame` 전역이 가짜 픽셀 밝기를 정한다):

```js
test('vision mode submits once per slide, not once per stroke', () => {
  const gate = new VisualGate({ mode: 'vision', settleMs: 1200 });
  frame = 24;
  const first = gate.inspect({}, 1000, true);
  assert.equal(first.accept, true, '첫 장은 언제나 제출한다');
  gate.complete(first.sample);

  // 판서 한 줄: 타일은 변했지만 같은 슬라이드다.
  frame = 30;
  assert.equal(gate.inspect({}, 3000).accept, false, '같은 슬라이드의 변화는 호출을 만들지 않는다');

  // 슬라이드 전환: 화면 전체가 바뀐다.
  frame = 200;
  assert.equal(gate.inspect({}, 4000).accept, false, '전환 직후 움직이는 중에는 제출하지 않는다');
  const settled = gate.inspect({}, 4000 + 1300);
  assert.equal(settled.accept, true, '멎고 settleMs 가 지나면 제출한다');
  assert.equal(settled.slideId, first.slideId + 1);
});

test('default mode behaviour is unchanged', () => {
  const gate = new VisualGate();
  assert.equal(gate.mode, 'ocr');
  frame = 24;
  const first = gate.inspect({}, 1000, true);
  gate.complete(first.sample);
  frame = 90;
  gate.inspect({}, 2000);
  assert.equal(gate.inspect({}, 2700).accept, true, '기본 모드는 지금처럼 누적 변화만으로 제출한다');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test lib/visual-gate.test.js`
Expected: FAIL — `gate.mode`가 `undefined`이고 비전 모드가 판서에서도 제출한다.

- [ ] **Step 3: 구현한다**

`lib/visual-gate.js`의 생성자와 `inspect`를 고친다:

```js
  class VisualGate {
    // 비전 모드에서는 제출 한 장이 곧 API 호출 한 번이다. 기본 모드의 "타일이 변하면 제출"을
    // 그대로 쓰면 강사 커서와 판서 한 줄마다 돈이 나간다. 전환에서만, 화면이 멎은 뒤에 제출한다.
    constructor({mode="ocr",settleMs=1200}={}){this.mode=mode==="vision"?"vision":"ocr";this.settleMs=settleMs;this.previous=null;this.recognized=null;this.submitted=null;this.pending=false;this.changedAt=0;this.lastMotion=0;this.slideId=0;}
    inspect(canvas,now=performance.now(),force=false){
      const current={low:sample(canvas,64,36),high:sample(canvas,256,144)};
      const movement=delta(this.previous?.low,current.low), accumulated=tileChange(this.recognized?.high,current.high);
      if(movement>.015)this.lastMotion=now;
      if(accumulated>.035&&!this.changedAt)this.changedAt=now;
      const transition=delta(this.recognized?.low,current.low)>.32;
      const changed=!this.recognized||accumulated>.035;
      const duplicate=this.submitted&&delta(this.submitted.high,current.high)<.004;
      // A stable slide is submitted once.  The old 12 s heartbeat re-submitted
      // an unchanged video frame even when OCR had already completed, which
      // polluted the evidence stream with repeated screen text.  Keep the
      // stability/transition checks as the only non-forced admission path.
      const ready=this.mode==="vision"
        ? !this.recognized||(transition&&now-this.lastMotion>=this.settleMs)
        : !this.recognized||(changed&&(now-this.lastMotion>=600||now-this.changedAt>=2500));
      const accept=force||(!this.pending&&!duplicate&&ready);
      this.previous=current;
      if(accept){ if(transition)this.slideId++;this.submitted=current;this.pending=true; }
      return {accept,sample:current,slideId:this.slideId,movement,accumulated};
    }
```

`complete`와 `reset`은 그대로 둔다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --test lib/visual-gate.test.js`
Expected: PASS — 신규 2개와 기존 전부. 기존 테스트가 깨지면 `ready`의 `ocr` 분기가 원래 식과 글자 단위로 같은지 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add lib/visual-gate.js lib/visual-gate.test.js
git commit -m "feat(vision): 슬라이드 전환에서만 프레임을 제출하는 게이트 모드를 더한다"
```

---

### Task 6: 설정 스키마

**Files:**
- Modify: `lib/settings.js:2` (`DEFAULTS`), `lib/settings.js:9` (검증)
- Create: `lib/settings.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: `ocrEngine: 'ppocr-v5-wasm' | 'vision-cloud'` (기본 `'ppocr-v5-wasm'`), `visionConsent: boolean` (기본 `false`). Task 7과 Task 8이 읽는다.

`ocrEngine`은 이미 있고 한 값으로 못 박혀 있다. 새 불리언을 더하는 대신 이 필드의 허용값을 넓힌다 — 엔진 선택은 한 곳에서만 읽혀야 두 값이 어긋나지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`lib/settings.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, validateSettings } = require('./settings.js');

test('vision is off by default and its consent is separate from text consent', () => {
  assert.equal(DEFAULTS.ocrEngine, 'ppocr-v5-wasm');
  assert.equal(DEFAULTS.visionConsent, false);
  assert.equal(DEFAULTS.remoteSummaryConsent, false, '요약 텍스트 동의는 그대로 남는다');
});

test('the engine field accepts only known engines', () => {
  assert.equal(validateSettings({ ocrEngine: 'vision-cloud' }).ocrEngine, 'vision-cloud');
  assert.equal(validateSettings({ ocrEngine: 'gpt-please' }).ocrEngine, 'ppocr-v5-wasm', '모르는 값은 로컬로 떨어진다');
  assert.equal(validateSettings({}).ocrEngine, 'ppocr-v5-wasm');
});

test('unknown settings keys are dropped rather than stored', () => {
  assert.equal(validateSettings({ visionApiKey: 'sk-nope' }).visionApiKey, undefined);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test lib/settings.test.js`
Expected: FAIL — `DEFAULTS.visionConsent`가 `undefined`이고 `'vision-cloud'`가 `'ppocr-v5-wasm'`으로 덮인다.

- [ ] **Step 3: 구현한다**

`lib/settings.js:2`의 `DEFAULTS`에서 `ocrEngine` 뒤에 `visionConsent:false,`를 넣는다:

```js
const DEFAULTS={openRouterApiKey:'',serviceUrl:'',appSessionToken:'',summaryModel:'google/gemini-2.5-flash-lite',remoteSummaryConsent:false,ocrEnabled:true,ocrEngine:'ppocr-v5-wasm',visionConsent:false,whisperEnabled:false,whisperModel:'small-webgpu',whisperLang:'ko',speedCorrection:false,theme:'system',consentAccepted:false};
```

`lib/settings.js:9`의 `out.ocrEngine='ppocr-v5-wasm';`를 허용 목록 검사로 바꾼다:

```js
if(!['ppocr-v5-wasm','vision-cloud'].includes(out.ocrEngine))out.ocrEngine='ppocr-v5-wasm';
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --test lib/settings.test.js`
Expected: PASS (3개)

- [ ] **Step 5: 커밋**

```bash
git add lib/settings.js lib/settings.test.js
git commit -m "feat(settings): 시각 인식 엔진 선택과 화면 전송 동의를 설정에 더한다"
```

---

### Task 7: 옵션 화면 — 유료 게이트와 동의

**Files:**
- Modify: `options.html:732` (`speedCorrectionCb` 필드 다음), `options.html:743` (`speedWarn` 다이얼로그 다음)
- Modify: `options.js` (`wireVision` 함수와 초기화 호출)

**Interfaces:**
- Consumes: Task 1의 `/v1/me` `features`, Task 6의 `ocrEngine`·`visionConsent`
- Produces: 사용자가 `ocrEngine: 'vision-cloud'`와 `visionConsent: true`를 저장할 수 있는 UI. Task 8이 이 값을 읽는다.

토글은 `/v1/me`가 `vision`을 줄 때만 열린다. 권한 판정은 서버가 하고 UI는 그 결과를 보여줄 뿐이다 — `chrome.storage`는 사용자가 고칠 수 있으므로 클라이언트 플래그는 게이트가 아니다.

- [ ] **Step 1: 마크업을 넣는다**

`options.html`의 `speedCorrectionCb` 필드를 닫는 `</div>` 다음, 그 `</section>` 앞에:

```html
    <div class="form-field">
      <label class="check-label">
        <input type="checkbox" id="visionCb" class="check-input" disabled>
        <span>고화질 화면 인식 <span class="badge">유료 플랜</span></span>
      </label>
      <p class="note" id="visionState" role="status" aria-live="polite">연결을 확인하면 사용 가능 여부를 알려드립니다.</p>
      <p class="note">수식·표·그래프가 많은 강의에서 켜세요. 기기에서 인식 모델을 돌리지 않아 저사양 노트북에서도 느려지지 않습니다. <strong>켜는 동안 강의 화면이 자체 서비스를 거쳐 인식 모델로 전달됩니다.</strong></p>
    </div>
```

`speedWarn` 다이얼로그 다음에 동의 모달을 넣는다:

```html
  <dialog id="visionWarn" class="warn-modal" aria-labelledby="visionWarnTitle">
    <h2 id="visionWarnTitle">강의 화면을 인식 모델로 보낼까요?</h2>
    <p>켜는 동안 <strong>강의 슬라이드 화면이 기기 밖으로 나갑니다.</strong> 자체 서비스를 거쳐 인식 모델에 전달되며, 전송 구간은 HTTPS로 보호되지만 모델은 인식하는 순간 화면을 봅니다.</p>
    <p>화면은 어디에도 저장하지 않습니다. 인식이 끝나면 사라지고, 사용량 기록에는 계정과 비용만 남습니다.</p>
    <p><strong>비공개 사내 교육 자료나 기밀 강의에는 켜지 마세요.</strong> 끄면 지금처럼 기기 안에서만 인식합니다.</p>
    <p class="note">음성은 이 설정과 무관하게 항상 기기 안에서만 처리됩니다.</p>
    <div class="warn-actions">
      <button type="button" id="visionWarnCancel">취소</button>
      <button type="button" id="visionWarnOk" class="primary">이해했고 켜기</button>
    </div>
  </dialog>
```

- [ ] **Step 2: 배선한다**

`options.js`의 `wireSpeedCorrection` 다음에 넣는다:

```js
// 유료 여부는 서버만 안다. chrome.storage 는 사용자가 고칠 수 있으므로 여기서 켜진 토글은
// 의사 표시일 뿐이고, 실제 호출은 /v1/vision 이 계정 features 로 다시 막는다.
async function wireVision(settings){
  const box=$('visionCb'),state=$('visionState'),modal=$('visionWarn');
  if(!box)return;
  box.checked=settings.ocrEngine==='vision-cloud'&&settings.visionConsent===true;
  const persist=async on=>{
    try{await saveSettings({ocrEngine:on?'vision-cloud':'ppocr-v5-wasm',visionConsent:on});notice(on?'고화질 화면 인식을 켰습니다. 다음 캡처부터 적용됩니다.':'고화질 화면 인식을 껐습니다. 기기 안에서만 인식합니다.');}
    catch(error){box.checked=!on;notice(error.message);}
  };
  box.addEventListener('change',()=>{
    if(!box.checked)return persist(false);
    if(modal?.showModal)modal.showModal();else persist(true);
  });
  $('visionWarnOk')?.addEventListener('click',()=>{modal.close();persist(true);});
  $('visionWarnCancel')?.addEventListener('click',()=>{modal.close();box.checked=false;});
  modal?.addEventListener('cancel',()=>{box.checked=false;});
  if(!settings.serviceUrl||!settings.appSessionToken){state.textContent='서비스 연결을 먼저 설정하세요.';return;}
  try{
    const me=await ServiceClient.me({baseUrl:settings.serviceUrl,token:settings.appSessionToken,timeoutMs:15000});
    const allowed=Array.isArray(me.features)&&me.features.includes('vision');
    box.disabled=!allowed;
    state.textContent=allowed?'사용 가능한 플랜입니다.':'유료 플랜에서 사용할 수 있습니다.';
    // 플랜이 끝났는데 설정만 남아 있으면 세션 시작이 403 으로 죽는다. 조용히 로컬로 되돌린다.
    if(!allowed&&box.checked){box.checked=false;await saveSettings({ocrEngine:'ppocr-v5-wasm',visionConsent:false});}
  }catch(error){state.textContent='사용 가능 여부를 확인하지 못했습니다 · '+error.message;}
}
```

초기화 IIFE의 `wireSpeedCorrection(s.speedCorrection===true);` 다음 줄에 추가한다:

```js
  await wireVision(s);
```

- [ ] **Step 3: 수동으로 확인한다**

`chrome://extensions`에서 압축 해제된 확장을 새로 고치고 옵션 페이지를 연다.

1. 서비스 연결이 비어 있으면 토글이 비활성이고 "서비스 연결을 먼저 설정하세요."가 보인다.
2. `features` 없는 계정 토큰을 넣으면 "유료 플랜에서 사용할 수 있습니다."가 보이고 토글이 비활성이다.
3. `features: ["vision"]` 계정 토큰이면 토글이 활성이고, 켜면 경고 모달이 뜬다. 취소하면 토글이 되돌아간다.
4. "이해했고 켜기"를 누른 뒤 페이지를 새로 고치면 토글이 켜진 채로 남는다.

- [ ] **Step 4: 기존 테스트가 깨지지 않았는지 확인한다**

Run: `node --test lib/*.test.js`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add options.html options.js
git commit -m "feat(options): 유료 플랜에서만 열리는 고화질 화면 인식 토글을 더한다"
```

---

### Task 8: 세션 배선 — 엔진 선택

**Files:**
- Modify: `lib/session.js:50` (게이트 모드), `lib/session.js:76-78` (엔진 선택)
- Modify: `sidepanel.js:69` (`start()`의 options), `sidepanel.js:55` (`updateReadyCard`의 엔진 배너)
- Modify: `offscreen.js` (`START_SESSION` 분기에서 서비스 자격 증명 주입)
- Test: `lib/session.test.js`

**Interfaces:**
- Consumes: Task 4의 `VisionClient.createVisionEngine`, Task 5의 `new VisualGate({mode})`, Task 6의 `ocrEngine`·`visionConsent`
- Produces: `START_SESSION` options가 `{..., ocrEngine, visionConsent, serviceUrl, appSessionToken}`를 싣는다. `CaptureSession`이 `options.ocrEngine === 'vision-cloud'`일 때 비전 엔진을 만든다. 기능 구현의 마지막 작업이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`lib/session.test.js` 끝에 추가. 스트림·document 모킹은 이 파일의 `lib/session.test.js:14` 테스트가 쓰는 방식 그대로다 — 새 헬퍼를 만들지 않는다:

```js
const visionSession = (id, options) => {
  global.document = { createElement: () => ({ currentTime: 0, muted: true, srcObject: null, videoWidth: 1280, videoHeight: 720, play: async () => {} }) };
  return new CaptureSession({
    id, generation: 1,
    stream: { getTracks: () => [], getAudioTracks: () => [] },
    options: { ocrEnabled: true, ocrEngine: 'vision-cloud', ...options },
    emit: () => {},
  });
};

test("vision sessions refuse to start without consent instead of falling back to local", async () => {
  const s = visionSession("s1", { visionConsent: false, serviceUrl: "https://service.example", appSessionToken: "x".repeat(40) });
  await assert.rejects(s.start(), /동의/, "조용히 로컬 인식으로 바꾸지 않는다 — 사용자가 켠 것과 다른 일을 하는 셈이다");
  assert.equal(s.status, "failed");
});

test("vision sessions refuse to start without a service connection", async () => {
  const s = visionSession("s2", { visionConsent: true, serviceUrl: "", appSessionToken: "" });
  await assert.rejects(s.start(), /서비스 연결/);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --test lib/session.test.js`
Expected: FAIL — 동의 없이도 시작하려 들고 PP-OCR 준비 쪽에서 다른 오류가 난다.

- [ ] **Step 3: 세션을 고친다**

`lib/session.js`의 `createOcrEngine()` 다음에 엔진 선택 함수를 넣는다:

```js
  // 비전은 조용히 로컬로 되돌아가지 않는다. AGENTS.md §2 의 "자동 클라우드 전환 금지"는 양방향이다 —
  // 사용자가 켠 것과 다른 일을 말없이 하는 게 문제이지, 방향이 문제가 아니다.
  function createVisualEngine(options,log){
    if(options.ocrEngine!=="vision-cloud")return createOcrEngine();
    if(options.visionConsent!==true)throw new Error("고화질 화면 인식을 쓰려면 설정에서 화면 전송에 동의하세요.");
    if(!options.serviceUrl||!options.appSessionToken)throw new Error("고화질 화면 인식은 서비스 연결이 필요합니다. 설정에서 연결하세요.");
    return globalThis.VisionClient.createVisionEngine({baseUrl:options.serviceUrl,token:options.appSessionToken,model:options.visionModel||"google/gemini-2.5-flash-lite",log});
  }
```

`lib/session.js:50`의 `gate:new VisualGate()`를 모드가 붙은 것으로 바꾼다:

```js
gate:new VisualGate(options.ocrEngine==="vision-cloud"?{mode:"vision"}:{}),
```

`lib/session.js:76-78`의 준비 블록을 고친다:

```js
        if(this.options.ocrEnabled!==false){
          const vision=this.options.ocrEngine==="vision-cloud";
          this.progress=vision?"고화질 화면 인식 준비 중":"PP-OCRv5 한국어 모델 준비 중";this.publish();
          // createVisualEngine 은 동기적으로 던진다(동의·연결 누락). timeout 의 계약을 지키려면 감싼다.
          const loading=Promise.resolve().then(()=>createVisualEngine(this.options,message=>this.log(message))).then(engine=>{if(this.closed){engine.terminate();throw new Error("준비가 취소됐습니다.");}return engine;});
          this.ocr=await timeout(loading,90000,"화면 인식 모델 준비 시간 초과",this.startController.signal);
          this.log(vision?"[화면] 고화질 인식 · 슬라이드가 바뀔 때만 인식합니다":"[화면] PP-OCRv5 한국어 (WASM) · 기기 안에서만 처리합니다");
        }
```

- [ ] **Step 4: 패널과 오프스크린을 배선한다**

`sidepanel.js:69`의 `start()`에서 `action('START_SESSION', {...})` 호출을 고친다. options에 두 필드를 더하고, 설정을 함께 싣는다 (자격 증명은 오프스크린이 정제해 붙인다):

```js
await action('START_SESSION',{settings,options:{tabId:Number(els.tabSelect.value),rect:rect(),ocrEnabled:els.ocrEnabledToggle.checked,ocrEngine:settings.ocrEngine||'ppocr-v5-wasm',visionConsent:settings.visionConsent===true,whisperEnabled:settings.whisperEnabled,whisperModel:settings.whisperModel,whisperLang:settings.whisperLang,speedCorrection:settings.speedCorrection===true}});
```

`offscreen.js`의 `START_SESSION` 분기에서 `new CaptureSession(...)` 앞에 자격 증명을 합치고, `options:message.options`를 `options`로 바꾼다:

```js
        const config=settingsOf(message.settings);
        const options={...message.options,serviceUrl:config.serviceUrl,appSessionToken:config.appSessionToken};
```

`sidepanel.js:55`의 `updateReadyCard`에서 엔진 배너를 고친다 — 켜져 있는데 "PP-OCRv5"라고 쓰면 거짓말이다:

```js
setRow(els.markEngine,els.engineBanner,els.ocrEnabledToggle?.checked===false?'off':'ok',els.ocrEnabledToggle?.checked===false?'꺼짐':settings.ocrEngine==='vision-cloud'?'고화질 화면 인식 (서비스 경유)':'PP-OCRv5 한국어 (WASM)');
```

- [ ] **Step 5: 테스트를 돌리고 수동으로 확인한다**

Run: `node --test lib/*.test.js`
Expected: PASS

수동 확인 — 로컬 서비스를 `ALLOWED_VISION_MODELS`와 `features:["vision"]`로 띄우고:

1. 토글을 켠 채 슬라이드가 있는 강의 영상에서 캡처를 시작한다.
2. 패널의 "화면" 카운터가 **슬라이드 수만큼만** 올라간다 (판서 한 줄마다 오르면 Task 5의 게이트 모드가 안 붙은 것이다).
3. 진단 로그에 "슬라이드 N장 인식 · X초"가 쌓인다.
4. 요약을 돌리면 수식이 LaTeX으로 노트에 들어온다.
5. 토글을 끄고 같은 강의를 캡처하면 로그가 "PP-OCRv5 한국어 (WASM)"로 돌아온다.

- [ ] **Step 6: 커밋**

```bash
git add lib/session.js lib/session.test.js sidepanel.js offscreen.js
git commit -m "feat(vision): 설정에 따라 세션이 시각 인식 엔진을 고르게 한다"
```

---

### Task 9: 불변식과 제품 문구 — 착수 전 승인 필요

**Files:**
- Modify: `AGENTS.md` §2, `manifest.json` (`description`), `CHROMEWEBSTORE.md`, `landing/index.html`
- Test: 없음 (문구 변경)

**Interfaces:**
- Consumes: Task 8까지의 동작
- Produces: 없음

**이 작업은 사용자가 명시적으로 승인하기 전에는 시작하지 않는다.** AGENTS.md 머리말이 "지침파일은 명시적인 지시가 있을 때만 수정할것"이고, 스토어 등록 문구는 심사 대상이다. 앞선 여덟 작업은 기본값이 꺼짐이라 이 승인 없이도 병합 가능하다 — 다만 **승인 전에 스토어에 올리면 안 된다.**

- [ ] **Step 1: 지금 문구가 어디서 거짓이 되는지 목록을 만든다**

```bash
grep -rn "기기 안에서만\|기기 밖\|외부로 전송\|온디바이스\|로컬에서만" AGENTS.md manifest.json CHROMEWEBSTORE.md landing/index.html
```

각 줄이 비전 모드가 켜진 상태에서 참인지 거짓인지 표시한 목록을 사용자에게 보여주고 승인을 받는다.

- [ ] **Step 2: AGENTS.md §2를 고친다**

"Memory only" 항목을 이렇게 바꾼다:

```markdown
- Memory only: Process screen captures and audio strictly in memory. Audio never leaves the device. Screen frames leave the device only when the user has explicitly enabled the paid vision engine and accepted the separate frame-transfer consent; they travel through the operator service to the model and are never persisted anywhere. Default is on-device.
- No silent engine switching: Never fall back from the vision engine to local recognition, or the reverse, without telling the user. Halt and ask.
```

- [ ] **Step 3: `manifest.json`의 description을 고친다**

```json
  "description": "재생 중인 영상 화면에서 학습 노트를 만듭니다. 기본 설정에서는 화면과 음성을 기기 안에서만 처리하며 어디에도 저장하지 않습니다.",
```

- [ ] **Step 4: 랜딩과 스토어 문구를 같은 기준으로 맞춘다**

Step 1의 목록에서 거짓으로 표시된 줄을 모두 "기본 설정에서는 …" 또는 "음성은 항상 기기 안에서만 …"으로 고친다. 셋이 어긋난 채 스토어에 올라가면 심사 리스크다.

- [ ] **Step 5: 커밋**

```bash
git add AGENTS.md manifest.json CHROMEWEBSTORE.md landing/index.html
git commit -m "docs: 비전 인식 모드에 맞춰 프라이버시 불변식과 제품 문구를 맞춘다"
```

---

### Task 10: 측정 — Phase 2 착수 판단 근거

**Files:**
- Create: `tools/vision-bench.mjs`
- Test: 없음 (측정 스크립트)

**Interfaces:**
- Consumes: Task 3의 `/v1/vision`
- Produces: 슬라이드당 지연·비용·수식 복원 수치. Phase 2(HLS 직독) 착수 여부를 이 수치로 정한다.

비교 문서의 "강의당 100~300원"은 그쪽 주장이지 이 파이프라인의 실측치가 아니다. 숫자부터 본다.

- [ ] **Step 1: 스크립트를 쓴다**

`tools/vision-bench.mjs`:

```js
// 슬라이드 이미지 폴더를 /v1/vision 으로 돌려 지연·비용·LaTeX 복원을 잰다.
// 사용: node tools/vision-bench.mjs <슬라이드폴더> <서비스URL> <토큰> [모델]
import { readdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";

const [dir, baseUrl, token, model = "google/gemini-2.5-flash-lite"] = process.argv.slice(2);
if (!dir || !baseUrl || !token) { console.error("사용: node tools/vision-bench.mjs <슬라이드폴더> <서비스URL> <토큰> [모델]"); process.exit(1); }

const files = readdirSync(dir).filter(f => [".jpg", ".jpeg"].includes(extname(f).toLowerCase())).sort();
if (!files.length) { console.error("jpeg 파일이 없습니다."); process.exit(1); }

const hasMath = text => /\$[^$]+\$/.test(text);
let totalCost = 0, totalMs = 0, withMath = 0, empty = 0, failed = 0;

for (const [index, file] of files.entries()) {
  const image = "data:image/jpeg;base64," + readFileSync(join(dir, file)).toString("base64");
  const started = Date.now();
  const response = await fetch(baseUrl + "/v1/vision", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ model, requestId: "bench-" + Date.now() + "-" + index, image }),
  });
  const elapsed = Date.now() - started;
  if (!response.ok) { failed++; console.log(`${file}\tHTTP ${response.status}\t${(await response.json()).error}`); continue; }
  const { text, usage } = await response.json();
  totalMs += elapsed; totalCost += usage.costUsd || 0;
  if (hasMath(text)) withMath++;
  if (!text.trim()) empty++;
  console.log(`${file}\t${(elapsed / 1000).toFixed(1)}s\t${text.length}자\t${hasMath(text) ? "수식" : "-"}`);
}

const done = files.length - failed;
console.log(`\n슬라이드 ${files.length}장 · 실패 ${failed}장 · 빈 결과 ${empty}장 · 수식 포함 ${withMath}장`);
console.log(`합계 ${(totalMs / 1000).toFixed(1)}초 (장당 ${done ? (totalMs / done / 1000).toFixed(1) : "-"}초) · $${totalCost.toFixed(4)} (약 ${(totalCost * 1400).toFixed(0)}원)`);
```

- [ ] **Step 2: 실제 강의 슬라이드로 돌린다**

공학 강의 한 편에서 슬라이드 전환 시점의 프레임을 jpeg으로 뽑아 한 폴더에 둔다. 그런 다음:

```bash
node tools/vision-bench.mjs ./bench-slides http://127.0.0.1:8787 <토큰>
```

- [ ] **Step 3: 같은 슬라이드를 PP-OCR로도 돌려 비교한다**

`tools/ppocr-probe.mjs`로 같은 폴더를 돌리고 두 결과의 수식 복원을 눈으로 비교한다. 비교표를 `docs/`에 날짜를 붙여 남긴다.

- [ ] **Step 4: 판단 기준에 대보고 결론을 적는다**

Phase 2(HLS 직독) 착수 기준:

- 장당 지연이 5초 이하일 것 (슬라이드 40장 = 3분 이내)
- 강의당 비용이 500원 이하일 것
- 수식이 있는 슬라이드의 LaTeX 복원이 PP-OCR보다 눈에 띄게 나을 것

하나라도 못 넘으면 Phase 2 대신 모델·프롬프트·해상도부터 조정한다.

- [ ] **Step 5: 커밋**

```bash
git add tools/vision-bench.mjs
git commit -m "chore(tools): 비전 인식 지연·비용·수식 복원 측정 스크립트를 더한다"
```

---

## 범위 밖 — 다음 계획

- **Phase 2 (HLS 직독 + 가상 seek)** — 재생 대기를 없애는, 사용자가 말한 "빠름"의 실체. Task 4의 비전 엔진에 프레임을 다른 방식으로 먹이는 일이므로 요약 경로는 새로 짜지 않는다. `content.js`의 m3u8 탐지, 백그라운드 `<video>` seek, DRM 감지 시 중단(기존 `mediaKeys`/`encrypted` 로직 재사용)이 골자다. Task 10의 수치를 보고 별도 스펙으로 쓴다.
- **이미지 배치 호출** — 게이트를 조이면 슬라이드 수만큼만 호출한다. 지연이 실측으로 문제가 될 때 묶는다.
- **자체 OpenRouter 키 사용자의 비전 사용** — 오퍼레이터 키 서버 전용 원칙상 서비스 경유만 지원한다.
