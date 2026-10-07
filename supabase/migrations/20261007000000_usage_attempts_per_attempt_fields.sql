-- 2026-10-07 시도별 모델·공급자·추론 토큰 마이그레이션 (호스트가 적용한다).
--
-- 배경: settle_usage 가 usage_attempts 의 stage/provider/model 을 항상 요청 부모 값(p_stage/p_provider/p_model)으로
-- 채워, 계획 Sol + 작성 Luna 같은 혼합 모델 실행의 시도별 원가 분석이 오염됐다.
--
-- 변경: usage_attempts.reasoning_tokens nullable 컬럼 추가 + settle_usage 가 attempts 요소의
-- stage/provider/model/reasoning_tokens 를 우선 읽고, 없으면 요청 값으로 채운다(coalesce — 이전 클라이언트의
-- 빈 필드는 이전과 같은 결과). 함수 서명·권한·RLS·CHECK 는 그대로다. 멱등 — 여러 번 적용해도 안전하다.

alter table usage_attempts add column if not exists reasoning_tokens int check (reasoning_tokens >= 0);

create or replace function settle_usage(
  p_user uuid,
  p_request_id text,
  p_actual_cost_micros bigint,     -- null = 미보고
  p_status text,
  p_stage text,
  p_provider text default null,
  p_model text default null,
  p_input_tokens int default null,
  p_output_tokens int default null,
  p_audio_seconds numeric default null,
  p_images int default null,
  p_prompt_version text default null,
  p_schema_version int default null,
  p_error_code text default null,
  p_latency_ms int default null,
  p_client_version text default null,
  p_host text default null,        -- 호스트명만(경로 금지). 형식은 usage_events CHECK가 강제한다
  p_job_id text default null,
  p_lecture_seconds numeric default null,
  p_slides int default null,
  p_subject text default null,
  p_subject_conf numeric default null,
  p_logical_task_id text default null,     -- 클라이언트 재시도(-rN)를 묶는 기준 id
  p_attempt_id text default null,          -- 이 요청의 마지막 제공자 호출 번호
  p_cache_kind text default null,
  p_cache_status text default null,
  p_cached_input_tokens int default null,  -- null = 제공자 미보고(보고된 0 과 구분)
  p_cache_write_tokens int default null,
  p_provider_reported_cost_micros bigint default null,
  p_cost_status text default null,
  p_policy_version text default null,
  p_attempts jsonb default '[]'::jsonb     -- 시도별 상세(HTTP 내부 재시도 포함) → usage_attempts
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r usage_reservations%rowtype;
  v_refund boolean := (p_status = 'refunded');
  v_charged bigint;
  v_delta bigint;
  v_scope text;
  v_period date;
begin
  if p_user is null or p_request_id is null or p_stage is null
     or p_status is null or p_status not in ('ok', 'error', 'refunded')
     or p_actual_cost_micros < 0 then
    raise exception 'invalid_settlement' using errcode = '22023';
  end if;
  if v_refund and coalesce(p_actual_cost_micros, 0) <> 0 then
    raise exception 'refund_with_cost' using errcode = '22023';
  end if;

  if v_refund then
    delete from usage_reservations
     where user_id = p_user and request_id = p_request_id and status = 'reserved'
    returning * into r;
  else
    update usage_reservations
       set status = 'settled',
           charged_cost_micros = coalesce(p_actual_cost_micros, reserved_cost_micros),
           settled_at = now()
     where user_id = p_user and request_id = p_request_id and status = 'reserved'
    returning * into r;
  end if;
  if not found then
    return case
      when exists (select 1 from usage_reservations where user_id = p_user and request_id = p_request_id)
      then 'already_settled' else 'not_found' end;
  end if;

  v_charged := case when v_refund then 0 else r.charged_cost_micros end;
  v_delta := v_charged - r.reserved_cost_micros;

  -- greatest(0, …): 서버의 Math.max(0, …)와 같다.
  update monthly_usage m
     set cost_micros = greatest(0, m.cost_micros + v_delta),
         requests = case when v_refund then greatest(0, m.requests - 1) else m.requests end,
         minutes = case when v_refund then greatest(0, m.minutes - r.reserved_minutes) else m.minutes end
   where m.user_id = p_user and m.month = r.month;

  if v_delta <> 0 then   -- 핫 로우라 변화가 없으면 건드리지 않는다
    for v_scope, v_period in
      select * from (values ('day', r.day), ('month', r.month)) as t(scope, period) order by 1
    loop
      update global_usage g set cost_micros = greatest(0, g.cost_micros + v_delta)
       where g.scope = v_scope and g.period = v_period;
    end loop;
  end if;

  insert into usage_events (
    user_id, job_id, request_id, stage, provider, model, input_tokens, output_tokens, audio_seconds, images,
    cost_micros, cost_reported, prompt_version, schema_version, status, error_code, latency_ms, client_version, host,
    lecture_seconds, slides, subject, subject_conf,
    logical_task_id, attempt_id, cache_kind, cache_status, cached_input_tokens, cache_write_tokens,
    provider_reported_cost_micros, cost_status, policy_version
  ) values (
    p_user, p_job_id, p_request_id, p_stage, p_provider, p_model, p_input_tokens, p_output_tokens, p_audio_seconds, p_images,
    v_charged, v_refund or p_actual_cost_micros is not null, p_prompt_version, p_schema_version, p_status, p_error_code,
    p_latency_ms, p_client_version, p_host,
    p_lecture_seconds, p_slides, p_subject, p_subject_conf,
    p_logical_task_id, p_attempt_id, p_cache_kind, p_cache_status, p_cached_input_tokens, p_cache_write_tokens,
    p_provider_reported_cost_micros, p_cost_status, p_policy_version
  );

  -- 시도별 상세(HTTP 내부 재시도·판정 청크). 요청 합계는 위 usage_events 행에만 두고 여기는 상세라 중복 집계하지 않는다.
  -- 같은 정산을 다시 부르면 위에서 already_settled 로 나가므로 여기까지 오지 않는다 — unique + do nothing 은 그래도 둔다.
  if jsonb_typeof(p_attempts) = 'array' then
    insert into usage_attempts (
      user_id, request_id, attempt_id, stage, provider, model,
      input_tokens, output_tokens, cached_input_tokens, cache_write_tokens,
      provider_reported_cost_micros, cost_status, cache_kind, cache_status, status, error_code, latency_ms,
      reasoning_tokens
    )
    -- stage/provider/model 은 시도 요소가 우선이고 비어 있으면 요청 값으로 채운다 — 혼합 모델 실행의
    -- 시도별 원가가 부모로 덮어씌워지지 않는다(이전 클라이언트의 빈 필드는 이전과 같은 결과).
    select p_user, p_request_id, a ->> 'attempt_id',
           coalesce(a ->> 'stage', p_stage), coalesce(a ->> 'provider', p_provider), coalesce(a ->> 'model', p_model),
           (a ->> 'input_tokens')::int, (a ->> 'output_tokens')::int,
           (a ->> 'cached_input_tokens')::int, (a ->> 'cache_write_tokens')::int,
           (a ->> 'provider_reported_cost_micros')::bigint,
           a ->> 'cost_status', p_cache_kind,
           coalesce(a ->> 'cache_status', 'unknown'), coalesce(a ->> 'status', 'ok'),
           a ->> 'error_code', (a ->> 'latency_ms')::int, (a ->> 'reasoning_tokens')::int
    from jsonb_array_elements(p_attempts) a
    where a ->> 'attempt_id' ~ '^a[0-9]{1,4}$'
    on conflict (user_id, request_id, attempt_id) do nothing;
  end if;

  return case when v_refund then 'refunded' else 'settled' end;
end;
$$;
