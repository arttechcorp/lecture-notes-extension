-- 2026-10-10 엔진 e2e 실행 모니터 (landing/engine-debug). 호스트가 적용한다.
--
-- 로컬 e2e run 폴더(~/.lecture-e2e/runs/<run>)의 스냅샷을 운영자가 tools/e2e-sync-runs.mjs 로
-- 올리고, 배포된 /engine-debug 페이지가 어드민 게이트 RPC 로 읽는다. 내용 없는 메타데이터만:
-- 단계 상태·시각, 디버그 기록, 로그 꼬리, UI 상태 이벤트. 노트 본문·강의 원문·스크린샷은 올리지 않는다.
-- 멱등 — 여러 번 적용해도 안전하다.

create table if not exists engine_runs (
  name text primary key check (name ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  started_at timestamptz,
  ended_at timestamptz,            -- null = 진행 중(result 없음). 원장 시간 창의 끝은 coalesce(ended_at, now())
  version text,
  result text check (result is null or result ~ '^[a-z][a-z0-9_-]{0,31}$'),
  report jsonb,                    -- report.json 에서 스크린샷 경로만 제거한 것
  debug_md text,                   -- debug.md (가설·원인·조치·결과)
  log_tail text,                   -- <run>.log 마지막 20줄
  events_tail jsonb,               -- events.ndjson 마지막 몇 개 (파싱된 객체 배열)
  has_note_pdf boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table engine_runs enable row level security;
revoke all on engine_runs from public, anon, authenticated;

-- 목록(p_name null → 최신순 요약 배열) 또는 단일 run 상세 + 그 시간대의 모델 호출 원장(usage_attempts).
create or replace function engine_debug(p_name text default null)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_name is null then
    return coalesce((select json_agg(t order by t.started_at desc nulls last) from (
      select name, started_at, ended_at, version, result, has_note_pdf, updated_at
      from engine_runs) t), '[]'::json);
  end if;
  return (select json_build_object(
      'name', r.name, 'started_at', r.started_at, 'ended_at', r.ended_at,
      'version', r.version, 'result', r.result, 'report', r.report,
      'debug_md', r.debug_md, 'log_tail', r.log_tail, 'events_tail', r.events_tail,
      'has_note_pdf', r.has_note_pdf, 'updated_at', r.updated_at,
      'ledger', coalesce((select json_agg(a order by a.created_at) from (
        select stage, model, status, coalesce(error_code, '-') error_code,
               input_tokens, output_tokens, reasoning_tokens, latency_ms, created_at
          from usage_attempts
         where r.started_at is not null
           and created_at between r.started_at and coalesce(r.ended_at, now())) a), '[]'::json))
    from engine_runs r where r.name = p_name);
end;
$$;
revoke all on function engine_debug(text) from public, anon;
grant execute on function engine_debug(text) to authenticated;
