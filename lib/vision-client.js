// Cloud slide reader. Shape-identical to the local OCR engine in session.js so the session only picks between them.
// The operator key lives on the service; this client never holds one.
(() => {
  const Service=()=>globalThis.ServiceClient||(typeof require!=="undefined"?require("./service-client.js"):null);
  const Contracts=()=>globalThis.Contracts||(typeof require!=="undefined"?require("./contracts.js"):null);
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
  // footer·watermark·page_number 는 슬라이드마다 똑같이 반복돼서 근거를 오염시킨다 — 읽기 흐름에 실제로
  // 속하는 역할만 텍스트로 남긴다.
  const TEXT_ROLES=new Set(["title","body","header","figure_label"]);
  const mdCell=c=>String(c??"").replace(/\|/g,"\\|").replace(/[\r\n]+/g," ").trim();
  function mdTable(rows){
    const width=Math.max(...rows.map(r=>r.length));
    const line=r=>"| "+Array.from({length:width},(_,i)=>mdCell(r[i])).join(" | ")+" |";
    return [line(rows[0]),"|"+" --- |".repeat(width),...rows.slice(1).map(line)].join("\n");
  }
  // 서버가 읽기 순서로 정렬해 내려주므로 배열 순서 그대로 펼치기만 한다.
  function slideDocText(doc){
    doc=doc||{};
    const lines=[];
    for(const b of doc.blocks||[]){
      if(!TEXT_ROLES.has(b.role))continue;
      const t=String(b.text||"").trim();
      if(t)lines.push(t);
    }
    for(const f of doc.formulas||[]){
      const latex=typeof f.latex==="string"?f.latex.trim():"",text=typeof f.text==="string"?f.text.trim():"";
      if(latex)lines.push("$$"+latex+"$$");else if(text)lines.push(text);
    }
    for(const f of doc.figures||[]){
      if(f.kind==="decorative")continue;
      const title=typeof f.title==="string"?f.title.trim():"";
      if(title)lines.push(title);
      if(f.kind==="table"&&Array.isArray(f.cells)&&f.cells.some(r=>r.length))lines.push(mdTable(f.cells));
      else{
        const summary=typeof f.chartSummary==="string"?f.chartSummary.trim():"";
        if(summary)lines.push(summary);
      }
    }
    return lines.join("\n").trim();
  }
  // token 은 문자열이거나, 호출 직전에 새 토큰을 돌려주는 함수(로그인 토큰은 1시간이면 만료되므로 긴 세션은 함수로 받는다).
  function createVisionEngine({baseUrl,token,model,maxCalls=200,signal,log=()=>{}}){
    let calls=0;
    return {
      async recognize(blob,meta={}){
        if(calls>=maxCalls)throw new Error(`이번 세션의 화면 인식 한도(${maxCalls}장)에 도달했습니다.`);
        calls++;
        const {slideId="s"+calls,t0=0,t1=0,mode="full",jobId}=meta||{};
        const started=Date.now();
        const image=await toDataUrl(blob),fresh=typeof token==="function"?await token():token;
        const {slideDoc}=(await Service().vision({baseUrl,token:fresh,model,image,requestId:requestId(),signal,slideId,t0,t1,mode,jobId}))||{};
        if(!slideDoc||typeof slideDoc!=="object")throw new Error("서비스 응답에 슬라이드 인식 결과가 없습니다. 서비스를 최신 버전으로 업데이트하세요.");
        // 클라이언트는 서버 출력을 믿지 않는다 — contracts.js 가 실린 환경에서는 계약으로 한 번 더 걸러낸다.
        const C=Contracts();
        if(C)C.assertValid(C.SCHEMAS.slideDoc,slideDoc,"슬라이드 인식 결과");
        log(`[화면] 슬라이드 ${calls}장 인식 · ${((Date.now()-started)/1000).toFixed(1)}초`);
        // 비전은 줄 단위 신뢰도를 주지 않는다. null 이어야 summary.js 의 uncertain 판정이 안 걸린다.
        return {data:{text:slideDocText(slideDoc),confidence:null,slideDoc}};
      },
      terminate(){},
    };
  }
  globalThis.VisionClient={createVisionEngine,slideDocText};
  if(typeof module!=="undefined")module.exports={createVisionEngine,slideDocText};
})();
