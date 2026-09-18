// Supabase Project Settings → API 에서 복사한다.
// url은 프로젝트 기본 주소만 넣는다 — /rest/v1 같은 경로는 supabase-js가 알아서 붙인다.
// 공개되는 파일이므로 anon 키만 넣는다. service_role 키는 절대 넣지 말 것 — 실제 접근 차단은 RLS와 SQL 함수(supabase/schema.sql)가 한다.
window.SUMMRIZEI_SUPABASE = Object.freeze({
  url: "https://rppknkhbiivyurhvljoi.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwcGtua2hiaWl2eXVyaHZsam9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NDY1MTQsImV4cCI6MjEwNTIyMjUxNH0.1on99mSxHuwj7VmWJqy6LwBgkUN7gbgSgWwEyJnvZJw",
});
