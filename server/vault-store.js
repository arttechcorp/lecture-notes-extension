// JWT 계정의 보관함 어댑터. 암호문 본체는 Storage 의 비공개 버킷, 목록·용량은 vault_objects 행(supabase/schema-v2.sql)이 정한다.
// 객체 경로는 vault_objects.storage_path 와 같은 "<user_id>/<object_id>" 다. 그 칸의 CHECK 가 '.' 을 막아 ".json" 을 붙이면 행이 거절된다.
// 쓰기 순서는 언제나 Storage 먼저, 행은 그다음이다(PUT 도 DELETE 도). Storage 호출이 실패하면 표는 그대로라
// "행이 있으면 객체가 있다"가 유지되고, 행이 남은 항목은 목록에 보여 다시 지울 수 있다.
// ponytail: 행 쓰기만 실패하면 객체만 남는다 — 목록·용량에는 안 잡히고 같은 id 의 PUT 재시도가 덮고 DELETE 가 지운다.
//   표와 버킷을 대조해 치우는 청소는 만들지 않았다. 용량 검사도 읽고-쓰기라 동시 PUT 몇 개가 한도를 넘길 수 있다(정확하려면 DB 쪽 검사).
// http(url,init,parse=true,max) 는 index.js 의 sbHttp 다: 리다이렉트 금지·시간 제한·응답 크기 제한이 그대로 걸린다.
const BIG=24*1024*1024;
function supabaseVault({url,key,bucket,http}){
  const auth={apikey:key,authorization:"Bearer "+key},json={...auth,"content-type":"application/json"},slow=()=>({signal:AbortSignal.timeout(60000)});
  const path=(user,id)=>user+"/"+id,storage=url+"/storage/v1/object/"+bucket;
  const rows=async user=>{
    const r=await http(url+"/rest/v1/vault_objects?select=object_id,size&user_id=eq."+encodeURIComponent(user),{headers:auth});
    if(!Array.isArray(r))throw new Error("vault_store_failed");
    return r;
  };
  return {
    list:rows,
    // 없음은 행이 정한다. Storage 의 404 가 아니라 표를 믿으므로 Storage 버전에 따른 상태 코드 차이를 읽지 않는다.
    async get(user,id){
      if(!(await rows(user)).some(r=>r.object_id===id))return null;
      return http(storage+"/"+path(user,id),{headers:auth,...slow()},true,BIG);
    },
    // → true | false(용량 초과). 디스크 경로와 같은 규칙: 새 파일만 개수에 걸리고, 덮어쓸 때는 자기 크기를 뺀다.
    async put(user,id,text,{maxFiles,maxArchiveBytes}){
      const all=await rows(user),rest=all.filter(r=>r.object_id!==id),size=Buffer.byteLength(text);
      if((rest.length===all.length&&all.length>=maxFiles)||rest.reduce((sum,r)=>sum+r.size,0)+size>maxArchiveBytes)return false;
      await http(storage+"/"+path(user,id),{method:"POST",headers:{...json,"x-upsert":"true"},body:text,...slow()},false);
      await http(url+"/rest/v1/vault_objects?on_conflict=user_id,object_id",{method:"POST",headers:{...json,prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({user_id:user,object_id:id,size,storage_path:path(user,id),updated_at:new Date().toISOString()})},false);
      return true;
    },
    // 객체 일괄 삭제 API 는 없는 객체에도 200 이라 디스크 경로처럼 멱등이다(단건 DELETE 는 없는 객체에 404).
    async remove(user,id){
      await http(storage,{method:"DELETE",headers:json,body:JSON.stringify({prefixes:[path(user,id)]})},false);
      await http(url+"/rest/v1/vault_objects?user_id=eq."+encodeURIComponent(user)+"&object_id=eq."+encodeURIComponent(id),{method:"DELETE",headers:auth},false);
    },
  };
}
module.exports={supabaseVault};
