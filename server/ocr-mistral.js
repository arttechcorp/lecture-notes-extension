// Mistral OCR 4.1 어댑터 — OpenRouter 를 거치지 않고 api.mistral.ai 를 직접 부른다(기획 §3.1).
// 페이지 과금이라 토큰 단가표(RATES·VISION_RATES)와 섞지 않고 페이지 단가로 계산한다.
const Contracts=require("../lib/contracts.js");
const BASE="https://api.mistral.ai/v1",ENDPOINT=BASE+"/ocr";
const MODEL="mistral-ocr-4-1";
const USD_PER_PAGE=4/1000;
// 형식 실패·혼잡 대비 같은 요청 안의 최대 호출 수 — 예약도 이 횟수로 잡는다.
const MAX_ATTEMPTS=2;
// 설정 오류(400)는 다시 불러도 같다 — 재시도는 혼잡·서버 오류에만.
const retryableStatus=s=>s===429||s>=500;

const requestBody=image=>({
  model:MODEL,
  document:{type:"image_url",image_url:image},
  include_blocks:true,
  confidence_scores_granularity:"block",
  table_format:"html",
  extract_header:true,
  extract_footer:true,
  include_image_base64:false,
});

// 좌표 단위는 공식 문서가 정하지 않는다 — 전부 0~1이면 비율로 두고, 하나라도 넘으면 픽셀로 보고
// 페이지 dimensions 로 나눈다. 어느 쪽으로도 확정할 수 없으면(dimensions 없이 픽셀 값) null.
const n01=v=>Math.min(1,Math.max(0,v));
function normBox(b,dims){
  if(!b||typeof b!=="object")return null;
  const x0=Number(b.top_left_x),y0=Number(b.top_left_y),x1=Number(b.bottom_right_x),y1=Number(b.bottom_right_y);
  if(![x0,y0,x1,y1].every(Number.isFinite))return null;
  if([x0,y0,x1,y1].some(v=>v>1)){
    const W=Number(dims?.width),H=Number(dims?.height);
    if(!(W>0&&H>0))return null;
    return {x:n01(x0/W),y:n01(y0/H),w:n01((x1-x0)/W),h:n01((y1-y0)/H)};
  }
  return {x:n01(x0),y:n01(y0),w:n01(x1-x0),h:n01(y1-y0)};
}
const confOf=b=>{
  const v=b?.confidence_scores?.average_content_confidence_score;
  return typeof v==="number"&&Number.isFinite(v)?n01(v):null;
};
// table_format:"html" 응답을 계약 cells(행 2차원 배열)로 옮긴다 — 셀이 하나도 안 나오면 null.
const TAG=/<[^>]*>/g;
function htmlTableCells(html){
  if(typeof html!=="string"||!/<tr[\s>]/i.test(html))return null;
  const cells=(html.match(/<tr[\s\S]*?<\/tr>/gi)||[])
    .map(r=>(r.match(/<t[dh][\s\S]*?<\/t[dh]>/gi)||[]).map(c=>c.replace(TAG," ").replace(/\s+/g," ").trim().slice(0,500)).slice(0,30))
    .filter(r=>r.length);
  return cells.length?cells.slice(0,200):null;
}
const stripTags=s=>String(s??"").replace(TAG," ").replace(/\s+/g," ").trim();
// 텍스트 블록은 표와 같이 태그를 지운다 — 줄 구조(목록 항목)는 남기려고 <br> 만 줄바꿈으로 바꾼다.
// 지우는 것은 알려진 HTML 태그뿐이다. "p < 0.05 … q > 0.1" 같은 부등호를 태그로 오인하면 본문이 깨진다.
const HTML_TAG=/<\/?(?:a|b|i|u|em|strong|span|sub|sup|p|div|font|small|ul|ol|li|table|thead|tbody|tr|td|th|h[1-6])(?:\s[^<>]*)?\/?>/gi;
const plainText=s=>String(s??"").replace(/<br\s*\/?>/gi,"\n").replace(HTML_TAG,"").replace(/[ \t]+/g," ").replace(/ *\n */g,"\n").trim();
// OCR 블록 type → slideDoc role. title·header·footer·figure_label 은 boilerplate·근거 규칙이
// 그대로 먹이도록 기존 역할로 매기고, 나머지 텍스트 종류는 읽기 흐름의 본문이다.
const ROLE={title:"title",header:"header",footer:"footer",caption:"figure_label",text:"body",list:"body",aside_text:"body",references:"body",signature:"body",code:"body"};
// 크롭 불가 상자 — 계약상 figures.bbox 는 필수라 좌표가 없는 도표는 빈 상자로 표시한다.
// figures.cropBox 가 빈 상자를 CROP_BAD_BBOX 로 거절해 크롭이 자연스럽게 생략된다.
const NO_BBOX={x:0,y:0,w:0,h:0};
function toSlideDoc(raw,{slideId,t0,t1,model,mode}){
  const pages=raw?.pages;
  if(!Array.isArray(pages))throw new Error("invalid_vision_output");
  const blocks=[],formulas=[],figures=[];
  for(const page of pages){
    if(!page||typeof page!=="object")continue;
    const dims=page.dimensions;
    // extract_header/footer 가 분리한 머리·바닥글은 읽기 순서가 없어서 blocks 말미에 붙인다 —
    // role 이 header/footer 라 boilerplate 규칙과 근거 텍스트 제외가 그대로 적용된다.
    for(const [text,role]of[[page.header,"header"],[page.footer,"footer"]]){
      const t=plainText(text);
      if(t)blocks.push({id:"b0",text:t.slice(0,4000),role,bbox:null,conf:null,ink:null});
    }
    for(const b of Array.isArray(page.blocks)?page.blocks:[]){
      if(!b||typeof b!=="object")continue;
      const raw=typeof b.content==="string"?b.content:"",text=plainText(raw),bbox=normBox(b,dims),conf=confOf(b),type=b.type;
      if(type==="equation"){
        // 수식은 원문 그대로 둔다 — 부등호가 태그처럼 보여도 LaTeX 이다.
        if(raw.trim())formulas.push({id:"f0",latex:null,text:raw.trim().slice(0,4000),bbox,conf,status:"unverified"});
        continue;
      }
      if(type==="table"){
        const cells=htmlTableCells(b.content);
        // 표 본문이 남는 경로는 cells 다 — HTML 이 안 풀리면 평문이라도 title 에 보존한다.
        figures.push({id:"g0",bbox:bbox||NO_BBOX,kind:"table",title:cells?null:(stripTags(text).slice(0,300)||null),cells,chartSummary:null,chartData:null,conf});
        continue;
      }
      if(type==="image"){
        if(bbox&&bbox.w>0&&bbox.h>0)figures.push({id:"g0",bbox,kind:"photo",title:null,cells:null,chartSummary:null,chartData:null,conf});
        else if(text)blocks.push({id:"b0",text:text.slice(0,4000),role:"body",bbox:null,conf,ink:null});
        continue;
      }
      if(!text)continue;
      blocks.push({id:"b0",text:text.slice(0,4000),role:ROLE[type]||"body",bbox,conf,ink:null});
    }
    // 블록이 하나도 안 온 페이지는 markdown 이라도 본문으로 둔다 — 빈 슬라이드로 흘리지 않는다.
    if(!blocks.length&&!formulas.length&&!figures.length&&typeof page.markdown==="string"&&page.markdown.trim())
      blocks.push({id:"b0",text:page.markdown.trim().slice(0,4000),role:"body",bbox:null,conf:null,ink:null});
  }
  blocks.forEach((b,i)=>b.id="b"+(i+1));formulas.forEach((f,i)=>f.id="f"+(i+1));figures.forEach((g,i)=>g.id="g"+(i+1));
  return {schemaVersion:Contracts.CONTRACT_VERSION,slideId,t0,t1,engine:"vision-mistral",model,blocks,formulas,figures};
}
// L1 이 보낸 필기 마스크(bbox 목록)와 겹치는 블록에 ink:true 를 단다 — 계약 밖 표시라
// 호출자는 계약 검증(assertValid)이 끝난 뒤에 붙인다. bbox 없는 블록은 겹칠 수 없다.
const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
function markInk(doc,masks){
  const list=(masks||[]).filter(m=>m&&typeof m==="object"&&[m.x,m.y,m.w,m.h].every(Number.isFinite)&&m.w>0&&m.h>0);
  if(!list.length)return doc;
  for(const b of doc.blocks||[])if(b.bbox&&list.some(m=>overlap(b.bbox,m)))b.ink=true;
  return doc;
}
// 과금은 제공자가 센 페이지 수만 믿는다 — usage_info 가 없으면 미보고(null)로 호출자가 예약을 유지한다.
const pageCost=u=>Number.isFinite(u?.pages_processed)&&u.pages_processed>=0?u.pages_processed*USD_PER_PAGE:null;
// endpoint 는 호출자가 env(MISTRAL_BASE_URL, https 만)로 정한 기본점 + "/ocr" 다 — 여기서는 전체 주소를 하드코딩하지 않는다.
async function recognize({fetcher,key,image,signal,boundedResponse,endpoint=ENDPOINT}){
  const response=await fetcher(endpoint,{method:"POST",redirect:"error",signal,headers:{authorization:"Bearer "+key,"content-type":"application/json"},body:JSON.stringify(requestBody(image))});
  // 실패 사유(type·code)만 짧게 남긴다 — 429 가 초당 한도(rate_limited)인지 등급 용량인지 원장(error_code)에서 가린다. 본문 전체는 싣지 않는다.
  if(!response.ok){let reason=null;try{const j=JSON.parse(String(await response.text()).slice(0,2000));reason=[j?.type,j?.code].filter(v=>v!=null&&v!=="").join("_").replace(/[^A-Za-z0-9_]/g,"").slice(0,40)||null;}catch{}
    throw Object.assign(new Error("mistral_http"),{status:response.status,headers:response.headers,reason});}
  return boundedResponse(response,4*1024*1024);
}
module.exports={ENDPOINT,MODEL,USD_PER_PAGE,MAX_ATTEMPTS,requestBody,toSlideDoc,markInk,pageCost,retryableStatus,recognize,normBox,htmlTableCells};
