// 사전 예약 접수 엔드포인트. Supabase PostgREST URL과 publishable(구 anon) 키.
// 이 키는 공개되는 값이며, 테이블은 RLS로 anon 역할의 INSERT만 허용해야 한다(docs/waitlist-supabase.sql).
// 공개되는 파일이므로 service_role/secret 키는 절대 넣지 않는다.
window.SUMMRIZEI_WAITLIST = Object.freeze({
  url: "https://rppknkhbiivyurhvljoi.supabase.co/rest/v1/waitlist",
  anonKey: "sb_publishable_u5FpbpL4Su_aGhjwJ9IhpA_71pmLmWW",
});
