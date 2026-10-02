// 랜딩의 계정 삭제가 이 함수를 부른다 — Postgres 는 Storage 객체를 지울 수 없다(storage.objects 의 protect_objects_delete 트리거)라서 SQL 만 지우면 vault 암호문이 남는다.
const HEADERS={
  "content-type":"application/json",
  "cache-control":"no-store",
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods":"POST, OPTIONS",
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(status,error)=>new Response(JSON.stringify({error}),{status,headers:HEADERS});

export async function handle(req,env,fetchImpl=fetch){
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:HEADERS});
  if(req.method!=="POST")return fail(405,"method_not_allowed");
  const bearer=req.headers.get("authorization")||"";
  if(!bearer.startsWith("Bearer "))return fail(401,"not_authenticated");
  const {url,key}=env,svc={apikey:key,authorization:"Bearer "+key},json={...svc,"content-type":"application/json"};
  try{
    const me=await fetchImpl(url+"/auth/v1/user",{headers:{apikey:key,authorization:bearer}});
    const id=me.ok?((await me.json().catch(()=>null))||{}).id:null;
    if(!UUID.test(id||""))return fail(401,"not_authenticated");
    // 각 단계는 멱등이라 클라이언트가 같은 요청을 재시도하면 남은 작업을 이어서 마친다.
    // ① 행 삭제 RPC: 활성 구독이면 SQL 이 아무것도 지우지 않고 active_subscription 을 던진다.
    const rpc=await fetchImpl(url+"/rest/v1/rpc/delete_account_data",{method:"POST",headers:json,body:JSON.stringify({p_user:id})});
    if(!rpc.ok){
      if((await rpc.text()).includes("active_subscription"))return fail(409,"active_subscription");
      return fail(503,"account_delete_failed");
    }
    // ② vault 버킷 "<id>/" 아래 객체를 offset 으로 다 모은 뒤 100 개씩 지운다. 빈 prefixes 는 거절되므로 없으면 부르지 않는다.
    const paths=[];
    for(let offset=0;;offset+=100){
      if(offset>=10000)throw new Error("too_many_objects");
      const r=await fetchImpl(url+"/storage/v1/object/list/vault",{method:"POST",headers:json,body:JSON.stringify({prefix:id+"/",limit:100,offset,sortBy:{column:"name",order:"asc"}})});
      if(!r.ok)throw new Error("list_failed");
      const page=await r.json();
      if(!Array.isArray(page))throw new Error("list_failed");
      for(const o of page)paths.push(id+"/"+o.name);
      if(page.length<100)break;
    }
    for(let i=0;i<paths.length;i+=100){
      const r=await fetchImpl(url+"/storage/v1/object/vault",{method:"DELETE",headers:json,body:JSON.stringify({prefixes:paths.slice(i,i+100)})});
      if(!r.ok)throw new Error("storage_delete_failed");
    }
    // ③ auth 사용자 삭제. 404 는 이전 재시도에서 이미 지워졌다는 뜻이라 성공으로 센다.
    const del=await fetchImpl(url+"/auth/v1/admin/users/"+id,{method:"DELETE",headers:svc});
    if(!del.ok&&del.status!==404)throw new Error("auth_delete_failed");
    return new Response(JSON.stringify({deleted:true}),{status:200,headers:HEADERS});
  }catch{
    return fail(503,"account_delete_failed");
  }
}

if(typeof Deno!=="undefined")Deno.serve(req=>handle(req,{url:Deno.env.get("SUPABASE_URL"),key:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}));
