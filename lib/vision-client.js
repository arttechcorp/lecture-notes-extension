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
