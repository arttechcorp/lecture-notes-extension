// Mistral OCR 어댑터 — 공식 문서 모양의 합성 fixture 만 쓴다. 실모델·유료 API 호출 없음.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const OcrMistral=require("./ocr-mistral.js"),{createServer}=require("./index.js"),Contracts=require("../lib/contracts.js");
const token="test-token-A-".padEnd(40,"a"),origin="chrome-extension://"+"a".repeat(32),ocrModel="mistral-ocr-4-1";
const close=s=>new Promise(r=>s.close(r));
const removeTemp=root=>{const target=path.resolve(root);assert.ok(target.startsWith(path.join(path.resolve(os.tmpdir()),"summrizei-service-test-")));fs.rmSync(target,{recursive:true,force:true});};
const jpeg=size=>"data:image/jpeg;base64,"+Buffer.alloc(size,7).toString("base64");
const score=v=>({average_content_confidence_score:v,minimum_content_confidence_score:v,block_type_confidence_score:v});
const blk=(type,content,box,extra={})=>({type,top_left_x:box?.[0]??0,top_left_y:box?.[1]??0,bottom_right_x:box?.[2]??0,bottom_right_y:box?.[3]??0,content,confidence_scores:score(0.9),...extra});
const page=(blocks,extra={})=>({index:0,markdown:"",images:[],tables:[],hyperlinks:[],header:null,footer:null,dimensions:{width:1280,height:720,dpi:96},confidence_scores:score(0.9),blocks,...extra});
const ocrResponse=(pages,extra={})=>({pages,model:ocrModel,usage_info:{pages_processed:pages.length},document_annotation:null,...extra});
const meta={slideId:"lec-01-slide-03",t0:120,t1:135.5,model:ocrModel,mode:"full"};

test("toSlideDoc maps block types, roles and page header/footer",()=>{
  const doc=OcrMistral.toSlideDoc(ocrResponse([page([
    blk("title","회로이론 3주차",[0.05,0.04,0.95,0.12]),
    blk("text","키르히호프 전류 법칙을 본다.",[0.05,0.2,0.9,0.3]),
    blk("list","- 항목 하나\n- 항목 둘",[0.05,0.32,0.9,0.45]),
    blk("caption","그림 1. 노드 전압",[0.05,0.5,0.9,0.55]),
    blk("equation","\\sum_k i_k = 0",[0.3,0.6,0.7,0.68]),
    blk("header","내부 머리글",[0.4,0.01,0.9,0.03]),
  ],{header:"페이지 머리글",footer:"3쪽"})]),meta);
  assert.equal(doc.engine,"vision-mistral");
  assert.equal(doc.blocks.find(b=>b.text==="회로이론 3주차").role,"title");
  assert.equal(doc.blocks.find(b=>b.text.startsWith("- 항목")).role,"body");
  assert.equal(doc.blocks.find(b=>b.text.startsWith("그림 1")).role,"figure_label");
  assert.equal(doc.blocks.find(b=>b.text==="페이지 머리글").role,"header","extract_header 결과는 기존 boilerplate 역할로 간다");
  assert.equal(doc.blocks.find(b=>b.text==="3쪽").role,"footer");
  assert.equal(doc.blocks.find(b=>b.text==="내부 머리글").role,"header");
  const f=doc.formulas[0];
  assert.equal(f.text,"\\sum_k i_k = 0");assert.equal(f.status,"unverified");assert.equal(f.latex,null);
  assert.equal(doc.blocks[0].id,"b1");assert.equal(f.id,"f1");
  Contracts.assertValid(Contracts.SCHEMAS.slideDoc,doc,"slideDoc");
});

test("normBox fixes coordinates: pixels divided by dimensions, ratios kept",()=>{
  const dims={width:1000,height:500};
  assert.deepEqual(OcrMistral.normBox({top_left_x:100,top_left_y:50,bottom_right_x:600,bottom_right_y:250},dims),{x:.1,y:.1,w:.5,h:.4});
  assert.deepEqual(OcrMistral.normBox({top_left_x:.1,top_left_y:.1,bottom_right_x:.6,bottom_right_y:.5},dims),{x:.1,y:.1,w:.5,h:.4});
  assert.equal(OcrMistral.normBox({top_left_x:100,top_left_y:50,bottom_right_x:600,bottom_right_y:250},null),null,"픽셀 값인데 dimensions 가 없으면 정규화 못 한다");
  assert.equal(OcrMistral.normBox(null,dims),null);
});

test("empty blocks fall back to page markdown; null confidence stays null",()=>{
  const doc=OcrMistral.toSlideDoc(ocrResponse([page([],{markdown:"# 마크다운 본문\n내용"})]),meta);
  assert.equal(doc.blocks.length,1);assert.equal(doc.blocks[0].role,"body");assert.equal(doc.blocks[0].text,"# 마크다운 본문\n내용");
  const noScore=OcrMistral.toSlideDoc(ocrResponse([page([blk("text","본문",[0,0,.5,.1],{confidence_scores:{average_content_confidence_score:null}})])]),meta);
  assert.equal(noScore.blocks[0].conf,null,"null 신뢰도는 null 로 남는다");
});

test("tables become figures; missing bbox yields an uncroppable empty box",()=>{
  const html="<table><tr><th>노드</th><th>전류</th></tr><tr><td>a</td><td>1.2A</td></tr></table>";
  const doc=OcrMistral.toSlideDoc(ocrResponse([page([
    blk("table",html,null,{table_id:"t1"}),
    blk("image","",null,{image_id:"i1"}),
  ])]),meta);
  assert.equal(doc.figures.length,1);
  const t=doc.figures[0];
  assert.equal(t.kind,"table");assert.deepEqual(t.cells,[["노드","전류"],["a","1.2A"]]);
  assert.deepEqual(t.bbox,{x:0,y:0,w:0,h:0},"bbox 없는 표는 크롭 불가 상자다");
  Contracts.assertValid(Contracts.SCHEMAS.slideDoc,doc,"slideDoc");
});

test("multiple pages merge into one slideDoc",()=>{
  const doc=OcrMistral.toSlideDoc(ocrResponse([page([blk("text","앞 페이지",[0,0,.5,.1])]),{...page([blk("text","뒤 페이지",[0,0,.5,.1])]),index:1}]),meta);
  assert.deepEqual(doc.blocks.map(b=>b.text),["앞 페이지","뒤 페이지"]);
});

test("markInk flags blocks overlapping the L1 ink mask",()=>{
  const doc=OcrMistral.toSlideDoc(ocrResponse([page([
    blk("text","겹치는 블록",[.1,.1,.5,.3]),
    blk("text","안 겹치는 블록",[.6,.6,.9,.9]),
    // 좌표 키가 아예 없는 블록 — blk() 은 0박스를 만들어 null 경로를 못 탄다.
    { type:"text",content:"상자 없는 블록",confidence_scores:score(.9) },
  ])]),meta);
  assert.equal(doc.blocks[2].bbox,null,"좌표가 없으면 bbox 는 null 이다");
  OcrMistral.markInk(doc,[{x:.2,y:.15,w:.1,h:.1}]);
  assert.equal(doc.blocks[0].ink,true);
  assert.equal(doc.blocks[1].ink,null);
  assert.equal(doc.blocks[2].ink,null,"bbox 없는 블록은 표시하지 않는다");
  OcrMistral.markInk(doc,[]);OcrMistral.markInk(doc,null);OcrMistral.markInk(doc,[{x:0,y:0,w:0,h:0}]);
  assert.equal(doc.blocks[0].ink,true,"빈 마스크 호출은 기존 표시를 건드리지 않는다");
});

test("pageCost bills pages_processed at $4/1000, unreported stays null",()=>{
  assert.equal(OcrMistral.pageCost({pages_processed:60}),0.24);
  assert.equal(OcrMistral.pageCost({pages_processed:0}),0);
  assert.equal(OcrMistral.pageCost({}),null);
  assert.equal(OcrMistral.pageCost(null),null);
  assert.ok(OcrMistral.retryableStatus(429)&&OcrMistral.retryableStatus(503));
  assert.ok(!OcrMistral.retryableStatus(400)&&!OcrMistral.retryableStatus(404));
});

const ocrEnv=root=>({
  APP_TOKENS_JSON:JSON.stringify({A:token}),EXTENSION_ORIGIN:origin,OPENROUTER_API_KEY:"mock-operator-key",
  OPENROUTER_PROVIDERS_JSON:JSON.stringify({"google/gemini-2.5-flash-lite":["test-provider"]}),VAULT_DIR:root,
  ALLOWED_VISION_MODELS:JSON.stringify([ocrModel]),MISTRAL_API_KEY:"mock-mistral-key",
  // 계정 한도의 models 는 작성(plan/write) 모델 목록이다 — 비전 모델은 ALLOWED_VISION_MODELS 가 연다.
  ACCOUNT_LIMITS_JSON:JSON.stringify({A:{models:["google/gemini-2.5-flash-lite"],maxRequests:10,maxCostCents:500,features:["vision"]}}),
});
const mistralProvider=(raw=ocrResponse([page([blk("text","슬라이드 본문",[100,100,900,200])])]))=>({ok:true,status:200,json:async()=>raw,body:{getReader:undefined}});
const req=(url,route,body,auth=token)=>fetch(url+route,{method:"POST",headers:{authorization:"Bearer "+auth,origin,"content-type":"application/json"},body:JSON.stringify(body)});
const visionBody=o=>({model:ocrModel,requestId:"ocr-x",slideId:"lec-01-slide-03",t0:120,t1:135.5,image:jpeg(2048),mode:"full",...o});

test("boot requires MISTRAL_API_KEY when the OCR model is allowed; providers are not needed for it",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));
  try{
    assert.throws(()=>createServer({...ocrEnv(root),MISTRAL_API_KEY:undefined}),/MISTRAL_API_KEY/);
    assert.doesNotThrow(()=>createServer(ocrEnv(root)));
  }finally{removeTemp(root);}
});

test("MISTRAL_BASE_URL: default, quoted, custom https are accepted; non-https or junk is rejected",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));
  try{
    assert.throws(()=>createServer({...ocrEnv(root),MISTRAL_BASE_URL:"http://api.mistral.ai/v1"}),/mistral_base/,"http 는 거절");
    assert.throws(()=>createServer({...ocrEnv(root),MISTRAL_BASE_URL:"not-a-url"}),/mistral_base/,"URL 아닌 값은 거절");
    assert.doesNotThrow(()=>createServer({...ocrEnv(root),MISTRAL_BASE_URL:'"https://ocr-proxy.example.com/api/v1/"'}),"따옴표·끝 슬래시는 벗긴다");
    assert.doesNotThrow(()=>createServer(ocrEnv(root)),"없으면 공식 기본점");
  }finally{removeTemp(root);}
});

test("MISTRAL_BASE_URL custom https origin receives ${base}/ocr",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));let sentUrl=null;
  const server=createServer({...ocrEnv(root),MISTRAL_BASE_URL:"https://ocr-proxy.example.com/api/v1/"}, {fetch:async(url,options)=>{sentUrl=url;return mistralProvider();}});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));const url="http://127.0.0.1:"+server.address().port;
  try{
    const res=await req(url,"/v1/vision",visionBody({requestId:"ocr-base"}));
    assert.equal(res.status,200);
    assert.equal(sentUrl,"https://ocr-proxy.example.com/api/v1/ocr");
  }finally{await close(server);removeTemp(root);}
});

test("mistral vision route sends the OCR request shape and normalizes to slideDoc",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));let sent=null,sentUrl=null;
  const server=createServer(ocrEnv(root),{fetch:async(url,options)=>{sentUrl=url;sent={body:JSON.parse(options.body),headers:options.headers};return mistralProvider();}});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));const url="http://127.0.0.1:"+server.address().port;
  try{
    const res=await req(url,"/v1/vision",visionBody({requestId:"ocr-one",ink:[{x:.05,y:.1,w:.2,h:.15}]}));
    assert.equal(res.status,200);
    const {slideDoc,usage}=await res.json();
    assert.equal(sentUrl,"https://api.mistral.ai/v1/ocr");
    assert.equal(sent.headers.authorization,"Bearer mock-mistral-key");
    assert.equal(sent.body.model,ocrModel);
    assert.deepEqual(sent.body.document,{type:"image_url",image_url:visionBody().image});
    assert.equal(sent.body.include_blocks,true);assert.equal(sent.body.confidence_scores_granularity,"block");
    assert.equal(sent.body.table_format,"html");assert.equal(sent.body.extract_header,true);
    assert.equal(sent.body.extract_footer,true);assert.equal(sent.body.include_image_base64,false);
    assert.equal(slideDoc.engine,"vision-mistral");
    assert.equal(slideDoc.blocks[0].text,"슬라이드 본문");
    assert.equal(slideDoc.blocks[0].ink,true,"ink 마스크와 겹치는 블록은 표시된다");
    assert.equal(usage.pages,1);assert.equal(usage.costUsd,0.004);
    const bad=await req(url,"/v1/vision",visionBody({requestId:"ocr-two",ink:[{x:2,y:0,w:1,h:1}]}));
    assert.equal(bad.status,400,"프레임 밖 마스크는 거절한다");
  }finally{await close(server);removeTemp(root);}
});

test("429 retries once and bills both attempts by pages; 400 is a refunded config error",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));let calls=0;
  const server=createServer(ocrEnv(root),{fetch:async()=>{
    calls++;
    if(calls===1)return {ok:false,status:429,headers:{get:()=>null}};
    return mistralProvider();
  }});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));const url="http://127.0.0.1:"+server.address().port;
  try{
    const res=await req(url,"/v1/vision",visionBody({requestId:"ocr-retry"}));
    assert.equal(res.status,200);assert.equal(calls,2,"429 는 같은 요청 안에서 한 번 더 간다");
    assert.equal((await res.json()).usage.costUsd,0.004,"실패한 시도는 페이지가 없어 성공분만 정산된다");
  }finally{await close(server);removeTemp(root);}

  const root2=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));let calls2=0;
  const server2=createServer(ocrEnv(root2),{fetch:async()=>{calls2++;return {ok:false,status:400,headers:{get:()=>null}};}});
  await new Promise(r=>server2.listen(0,"127.0.0.1",r));const url2="http://127.0.0.1:"+server2.address().port;
  try{
    const res=await req(url2,"/v1/vision",visionBody({requestId:"ocr-badcfg"}));
    assert.equal(res.status,502);
    const err=(await res.json()).error;
    assert.equal(err.retryable,false,"설정 오류는 같은 요청을 다시 보내도 같은 결과다");
    assert.equal(err.detail,"provider_config_error");
    assert.equal(calls2,1,"400 은 설정 오류라 재시도하지 않는다");
    const state=JSON.parse(fs.readFileSync(path.join(root2,"usage.json"),"utf8"));
    assert.equal(state.accounts.A.jobs["ocr-badcfg"],undefined,"환불된 요청은 예약이 남지 않는다");
    assert.equal(state.accounts.A.spentCents,0,"환불이면 장부에 한 푼도 남지 않는다");
    assert.equal(state.accounts.A.requests,0);
    const retry=await req(url2,"/v1/vision",visionBody({requestId:"ocr-badcfg"}));
    assert.equal(retry.status,502,"같은 requestId 도 환불됐으므로 다시 보낼 수 있다");
    assert.equal(calls2,2);
  }finally{await close(server2);removeTemp(root2);}
});

test("a final 429 with no processed page is refunded and stays retryable",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));
  const server=createServer(ocrEnv(root),{fetch:async()=>({ok:false,status:429,headers:{get:()=>null}})});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));const url="http://127.0.0.1:"+server.address().port;
  try{
    const res=await req(url,"/v1/vision",visionBody({requestId:"ocr-429"}));
    assert.equal(res.status,502);
    assert.equal((await res.json()).error.retryable,true,"처리되지 않은 혼잡은 같은 요청으로 다시 보낼 수 있다");
    const state=JSON.parse(fs.readFileSync(path.join(root,"usage.json"),"utf8"));
    assert.equal(state.accounts.A.spentCents,0,"처리된 페이지가 없으니 청구 0");
    assert.equal(state.accounts.A.requests,0);
  }finally{await close(server);removeTemp(root);}
});

test("429: Retry-After 를 지켜 다시 가고, 소진되면 간격·사유를 돌려준다",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));const waits=[];
  const r429={ok:false,status:429,headers:{get:k=>k==="retry-after"?"3":null},text:async()=>JSON.stringify({object:"error",message:"Requests rate limit exceeded",type:"rate_limited",code:"1300"})};
  const server=createServer(ocrEnv(root),{fetch:async()=>r429,sleep:async ms=>{waits.push(ms);}});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));const url="http://127.0.0.1:"+server.address().port;
  try{
    const res=await req(url,"/v1/vision",visionBody({requestId:"ocr-ra"}));
    const err=(await res.json()).error;
    assert.deepEqual(waits,[3000],"같은 요청 안의 재시도 전에 Retry-After 만큼 쉰다");
    assert.equal(err.retryable,true);assert.equal(err.retryAfterMs,3000,"클라이언트 재시도도 그 간격을 따른다");
  }finally{await close(server);removeTemp(root);}
  const e=await OcrMistral.recognize({fetcher:async()=>r429,key:"k",image:"data:image/jpeg;base64,AA==",boundedResponse:null}).catch(x=>x);
  assert.equal(e.reason,"rate_limited_1300","429 사유(type·code)를 원장 error_code 로 넘긴다");
});

test("a page the provider already processed is charged even when the retry then fails",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));let calls=0;
  // 첫 응답은 페이지를 셌지만 계약에 안 맞아(pages 없음) 재시도한다 — 둘째는 429 로 소진된다.
  const server=createServer(ocrEnv(root),{fetch:async()=>{calls++;
    if(calls===1)return mistralProvider({pages:null,usage_info:{pages_processed:1}});
    return {ok:false,status:429,headers:{get:()=>null}};}});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));const url="http://127.0.0.1:"+server.address().port;
  try{
    const res=await req(url,"/v1/vision",visionBody({requestId:"ocr-billed"}));
    assert.equal(res.status,502);assert.equal(calls,2);
    const state=JSON.parse(fs.readFileSync(path.join(root,"usage.json"),"utf8"));
    assert.ok(Math.abs(state.accounts.A.spentCents-0.4)<0.01,"처리된 한 페이지(약 0.4¢)만 남고 예약 1¢ 전액은 남지 않는다");
  }finally{await close(server);removeTemp(root);}
});

test("pixel boxes from Mistral are normalized by the page size end to end",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"summrizei-service-test-"));
  const raw=ocrResponse([page([blk("text","픽셀 좌표 본문",[100,50,600,250])],{dimensions:{width:1000,height:500,dpi:96}})]);
  const server=createServer(ocrEnv(root),{fetch:async()=>mistralProvider(raw)});
  await new Promise(r=>server.listen(0,"127.0.0.1",r));const url="http://127.0.0.1:"+server.address().port;
  try{
    const res=await req(url,"/v1/vision",visionBody({requestId:"ocr-px"}));
    assert.equal(res.status,200);
    const {slideDoc}=await res.json();
    assert.deepEqual(slideDoc.blocks[0].bbox,{x:.1,y:.1,w:.5,h:.4},"픽셀 100·50·600·250 을 1000×500 으로 나눈다");
  }finally{await close(server);removeTemp(root);}
});

test("text blocks drop known HTML tags, keep line breaks, and leave comparison signs and LaTeX alone",()=>{
  const doc=OcrMistral.toSlideDoc(ocrResponse([page([
    blk("text","<b>굵은</b> 글<br>둘째 줄 p < 0.05 이고 q > 0.1",[0,0,.9,.2]),
    blk("equation","x < 3 and y > 2",[0,.3,.5,.4]),
  ])]),meta);
  assert.equal(doc.blocks[0].text,"굵은 글\n둘째 줄 p < 0.05 이고 q > 0.1");
  assert.equal(doc.formulas[0].text,"x < 3 and y > 2");
  Contracts.assertValid(Contracts.SCHEMAS.slideDoc,doc,"slideDoc");
});
