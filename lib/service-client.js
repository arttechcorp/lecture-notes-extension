(() => {
  function baseUrl(value){
    const u=new URL(value);
    if(u.username||u.password||u.search||u.hash||(u.pathname!=="/"&&u.pathname!=="")||(u.protocol!=="https:"&&!(u.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(u.hostname))))throw new Error("서비스 주소는 HTTPS 원점이어야 합니다. 개발 환경만 localhost를 허용합니다.");
    return u.origin;
  }
  async function request(o,route,method="GET",body){
    if(typeof o.token!=="string"||o.token.length<32)throw new Error("서비스 연결을 먼저 설정하세요.");
    if(o.signal?.aborted)throw new DOMException("취소됨","AbortError");
    const controller=new AbortController(),onAbort=()=>controller.abort();
    o.signal?.addEventListener("abort",onAbort,{once:true});
    const timer=setTimeout(onAbort,Math.min(Number(o.timeoutMs)||120000,120000));
    try{
      const response=await fetch(baseUrl(o.baseUrl)+route,{method,redirect:"error",signal:controller.signal,headers:{authorization:"Bearer "+o.token,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
      const reader=response.body.getReader(),decoder=new TextDecoder();let text="",bytes=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>24*1024*1024)throw new Error("응답이 너무 큽니다.");text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
      finally{await reader.cancel().catch(()=>{});}
      if(controller.signal.aborted)throw new DOMException("취소됨","AbortError");
      let data;try{data=JSON.parse(text);}catch{throw new Error("서비스 응답을 읽을 수 없습니다.");}
      if(!response.ok){const messages={unauthorized:"서비스 인증이 만료됐습니다. 설정에서 다시 연결하세요.",quota_exceeded:"이번 달 요약 한도에 도달했습니다.",request_already_reserved_or_processed:"이미 처리했거나 비용이 예약된 요청입니다. 중복 요청은 실행하지 않았습니다.",provider_failed_or_invalid_output:"요약 제공자가 결과를 완료하지 못했습니다. 현재까지의 노트는 유지됩니다."};throw new Error(messages[data.error]||"서비스 요청을 완료하지 못했습니다 ("+response.status+").");}
      return data;
    }finally{clearTimeout(timer);o.signal?.removeEventListener("abort",onAbort);}
  }
  const id=x=>{if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(x))throw new Error("보관 문서 번호가 올바르지 않습니다.");return x;};
  const api={
    vision:o=>request(o,"/v1/vision","POST",{model:o.model,image:o.image,requestId:o.requestId}),
    summary:o=>request(o,"/v1/summary","POST",{model:o.model,stage:o.stage||"chunk",evidence:o.evidence,gaps:o.gaps,requestId:o.requestId}),
    me:o=>request(o,"/v1/me"),
    saveEncrypted:o=>request(o,"/v1/vault/"+id(o.objectId),"PUT",{envelope:o.envelope}),
    loadEncrypted:o=>request(o,"/v1/vault/"+id(o.objectId)),
    deleteEncrypted:o=>request(o,"/v1/vault/"+id(o.objectId),"DELETE"),
    listEncrypted:o=>request(o,"/v1/vault"),baseUrl
  };
  globalThis.ServiceClient=api;if(typeof module!=="undefined")module.exports=api;
})();
