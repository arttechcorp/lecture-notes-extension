-- Summrizei 파이프라인 v2 데이터 계층 (docs/architecture-v2.md §9, §11, §12).
-- supabase/schema.sql을 먼저 실행한 뒤(is_admin()·admins가 거기 있다) 이 파일을 SQL Editor에 통째로 붙여넣는다.
-- 여러 번 실행해도 안전(멱등): 테이블·인덱스는 if not exists, 함수는 create or replace,
-- 시드는 on conflict do nothing이라 운영자가 고친 한도 값을 다시 실행해도 덮어쓰지 않는다.
--
-- 경계는 schema.sql과 같다: RLS는 켜되 정책은 0개(= anon/authenticated의 직접 접근 전면 차단).
-- 통로는 서버의 service_role과 security definer 함수뿐이고, 모든 함수에 set search_path = public을 건다.
--
-- 강의 내용은 0바이트다(§12, 테스트 D2). 강의 제목·URL 경로·본문은 어떤 컬럼에도 없고,
-- 플레이어 호환성 통계용으로 호스트명(host)만 남긴다. 자유 텍스트 컬럼은 길이·문자 집합을 CHECK로 묶어
-- (공백·슬래시 불가) 실수로라도 내용이 흘러들지 못하게 한다.
-- 비용 단위는 micro-USD다(1 USD = 1,000,000). 서버의 cents는 x10,000, Math.ceil(USD*1e6)이 그대로 들어간다.

do $$
begin
  if to_regprocedure('is_admin()') is null then
    raise exception 'supabase/schema.sql(is_admin, admins)을 먼저 실행하세요';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. 한도(데이터). 함수에는 숫자를 박지 않는다 — 요금 정책은 아직 미정(§22 남은 결정 1)이라 UPDATE 한 줄로 바꾼다.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists plans (
  plan text primary key check (plan ~ '^[a-z][a-z0-9_]{0,31}$'),
  monthly_cost_cap_micros bigint not null check (monthly_cost_cap_micros >= 0),  -- 비용 상한은 항상 있어야 한다(무제한 없음)
  monthly_request_cap int check (monthly_request_cap >= 0),                      -- null = 무제한
  monthly_minutes_cap int check (monthly_minutes_cap >= 0),                      -- null = 무제한
  placeholder boolean not null default true                                      -- 요금 정책 확정 전 임시값. 확정하면 false로
);

-- 전역 비용 상한. scope='day'(UTC 하루) / 'month'(UTC 달). cap_micros null = 그 범위는 상한 없음.
-- 서버의 GLOBAL_COST_CENTS는 월 합계로 동작해 왔고 문서(§13)는 "일일 상한"이라 해서 둘 다 모델링한다.
create table if not exists global_caps (
  scope text primary key check (scope in ('day', 'month')),
  cap_micros bigint check (cap_micros >= 0)
);

-- 전역 잔액. 모든 사용자가 한 줄을 갱신하는 핫 로우지만 각 호출이 짧은 단일 트랜잭션이라 감당 가능하다.
-- 다중 인스턴스·고트래픽으로 가면 샤딩(period, shard)으로 쪼갠다.
create table if not exists global_usage (
  scope text not null check (scope in ('day', 'month')),
  period date not null check (scope <> 'month' or extract(day from period) = 1),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  primary key (scope, period)
);

-- 임시 시드. 숫자는 확정이 아니다(placeholder = true).
--   paid: 서버의 현재 기본값(MAX_COST_CENTS 1500 = $15, MAX_REQUESTS 10000)을 그대로 옮겼다.
--   free: §18의 Free 원가(강의 1시간 약 20원 = $0.014)로 약 20시간분.
--   전역: GLOBAL_COST_CENTS 기본값 15000 = $150/월. 일일 상한은 정하지 않았다(null).
insert into plans (plan, monthly_cost_cap_micros, monthly_request_cap, monthly_minutes_cap) values
  ('free', 300000, 300, 600),
  ('paid', 15000000, 10000, 6000)
on conflict (plan) do nothing;

insert into global_caps (scope, cap_micros) values
  ('day', null),
  ('month', 150000000)
on conflict (scope) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. 계정·권리·잔액
-- ─────────────────────────────────────────────────────────────────────────────

-- 기본 등급(가입 시 free). 유료·시험 부여는 entitlements가 얹는다. 앱 계층이 첫 로그인에 upsert한다.
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' references plans(plan),
  consent_version text check (consent_version ~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$'),  -- lib/settings.js TERMS_VERSION과 맞춘다
  created_at timestamptz not null default now()
);

-- 기간이 있는 등급 부여. 결제가 붙으면 (source, external_id)로 웹훅 재전송을 멱등 처리한다.
-- 결제 기록의 법정 보존이 필요해지면 on delete cascade를 set null로 바꾸고 별도 원장을 둔다.
create table if not exists entitlements (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null references plans(plan),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,                                     -- null = 기한 없음
  source text not null default 'manual' check (source in ('manual', 'payment')),
  external_id text check (external_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists entitlements_user_idx on entitlements (user_id);
create unique index if not exists entitlements_external_idx on entitlements (source, external_id) where external_id is not null;

-- 원자적 잔액. reserve_usage의 조건부 UPDATE가 이 줄을 갱신한다.
create table if not exists monthly_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  requests int not null default 0 check (requests >= 0),
  minutes int not null default 0 check (minutes >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  primary key (user_id, month)
);

-- requestId 멱등 장부(server/index.js의 rec.jobs). 이름을 usage_reservations로 둔 건 랜딩 대기자
-- 테이블 reservations(schema.sql)와 겹치지 않기 위해서다. 키가 (user_id, request_id)인 것은
-- 클라이언트가 고르는 requestId로 다른 사용자의 요청 존재 여부를 알아내지 못하게 하려는 것이다.
-- digest는 요청 본문의 sha256 hex다(해시만 저장). 환불되면 행을 지워 같은 requestId로 재시도할 수 있다(서버와 같은 의미).
create table if not exists usage_reservations (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  month date not null,
  day date not null,                                       -- 전역 일일 잔액을 정산 때 같은 날에 되돌리기 위해
  reserved_cost_micros bigint not null check (reserved_cost_micros >= 0),
  reserved_minutes int not null default 0 check (reserved_minutes >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'settled')),
  charged_cost_micros bigint check (charged_cost_micros >= 0),  -- 정산 뒤 확정 청구액(미보고면 예약액 그대로)
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  primary key (user_id, request_id)
);
-- 정산되지 못하고 남은 예약(서버 중단 등)을 찾는 용도.
create index if not exists usage_reservations_open_idx on usage_reservations (created_at) where status = 'reserved';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. 사용량 원장(추가 전용)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists usage_events (
  id bigint generated always as identity primary key,
  -- 계정 삭제 시 비식별화: 행은 남기고 user_id만 null로(집계 보존, §9 / D8).
  user_id uuid references auth.users(id) on delete set null,
  job_id text check (job_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  request_id text check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  stage text not null check (stage ~ '^[a-z][a-z0-9_.-]{0,31}$'),
  provider text check (provider ~ '^[a-z][a-z0-9_.-]{0,31}$'),
  model text check (model ~ '^[A-Za-z0-9][A-Za-z0-9_./:@-]{0,95}$'),
  input_tokens int check (input_tokens >= 0),
  output_tokens int check (output_tokens >= 0),
  audio_seconds numeric(10, 2) check (audio_seconds >= 0),
  images int check (images >= 0),
  cost_micros bigint not null check (cost_micros >= 0),    -- 청구액. 미보고면 예약액(추정)
  cost_reported boolean not null,                          -- false = 공급자가 비용을 알려주지 않아 예약액을 그대로 청구
  prompt_version text check (prompt_version ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$'),
  schema_version int check (schema_version >= 0),
  status text not null check (status in ('ok', 'error', 'refunded')),
  error_code text check (error_code ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  latency_ms int check (latency_ms >= 0),
  client_version text check (client_version ~ '^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$'),
  host text check (host ~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'),  -- 호스트명만. 경로·쿼리·포트·제목은 문자 집합에서 막힌다
  created_at timestamptz not null default now()
);
create index if not exists usage_events_created_idx on usage_events (created_at);
create index if not exists usage_events_user_idx on usage_events (user_id) where user_id is not null;

-- 추가 전용 강제. service_role은 RLS를 우회하므로 권한만으로는 UPDATE/DELETE를 막지 못해 트리거로 막는다.
-- 허용하는 변경은 하나뿐이다: user_id → null(계정 삭제 비식별화, FK의 on delete set null 포함).
-- 13개월 보존 정리(§9)를 만들 때는 이 가드를 함께 고친다.
create or replace function usage_events_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.user_id is null
     and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
    return new;
  end if;
  raise exception 'usage_events_append_only' using errcode = '42501';
end;
$$;
drop trigger if exists usage_events_guard on usage_events;
create trigger usage_events_guard before update or delete on usage_events
  for each row execute function usage_events_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. 보관함·피드백 (암호문 본체는 Storage 버킷. 여기엔 메타데이터만)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists vault_objects (
  user_id uuid not null references auth.users(id) on delete cascade,
  object_id text not null check (object_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),  -- lib/vault.js의 objectId 규칙
  size bigint not null check (size >= 0),                  -- 바이트
  updated_at timestamptz not null default now(),
  storage_path text not null unique check (storage_path ~ '^[A-Za-z0-9][A-Za-z0-9/_-]{0,255}$'),  -- 앱이 "<user_id>/<object_id>"로 만든다. 제목을 넣지 않는다
  primary key (user_id, object_id)
);

create table if not exists feedback (
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id text not null check (job_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  rating smallint not null check (rating between 1 and 5),
  -- 고정 어휘 태그만(소문자·숫자·_-, 각 32자, 최대 10개). 자유 서술 칸은 두지 않는다.
  tags text[] not null default '{}' check (
    cardinality(tags) <= 10
    and array_to_string(tags, ',') ~ '^([a-z0-9_-]{1,32}(,[a-z0-9_-]{1,32})*)?$'
  ),
  created_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

alter table plans enable row level security;
alter table global_caps enable row level security;
alter table global_usage enable row level security;
alter table profiles enable row level security;
alter table entitlements enable row level security;
alter table monthly_usage enable row level security;
alter table usage_reservations enable row level security;
alter table usage_events enable row level security;
alter table vault_objects enable row level security;
alter table feedback enable row level security;
-- 정책 없음 = 전면 차단. 이후에도 여기에 정책을 추가하지 않는다.

-- 서버(service_role)는 RLS를 우회하지만 테이블 권한은 따로 필요하다. 플랫폼의 기본 권한에 기대지 않고 명시한다
-- (보관함 목록·프로필 upsert·피드백 기록·/v1/me의 한도 조회가 직접 접근이다). anon/authenticated에는 주지 않는다.
grant select, insert, update, delete on plans, global_caps, global_usage, profiles, entitlements, monthly_usage,
  usage_reservations, usage_events, vault_objects, feedback to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. 함수
-- ─────────────────────────────────────────────────────────────────────────────

-- 실효 등급: 프로필 등급, 기간 안의 entitlements, 바닥값 free 중 한도가 가장 큰 것.
-- (유료 부여가 있는데 낮은 등급 줄이 겹쳐도 강등되지 않는다.) plans에 없으면 null → reserve는 닫힌 채로 거절한다.
create or replace function effective_plan(p_user uuid, p_at timestamptz default now())
returns text
language sql
security definer
stable
set search_path = public
as $$
  select pl.plan
  from (
    select plan from profiles where user_id = p_user
    union all
    select plan from entitlements
      where user_id = p_user and starts_at <= p_at and (ends_at is null or ends_at > p_at)
    union all
    select 'free'
  ) c
  join plans pl on pl.plan = c.plan
  order by pl.monthly_cost_cap_micros desc
  limit 1;
$$;

-- 사전 예약. 결과: reserved | duplicate | digest_mismatch | quota_exceeded.
-- 한도 확인과 증가는 `update … where used + $1 <= cap`의 한 문장이다. 같은 줄을 동시에 고치는 트랜잭션은
-- 행 잠금에서 직렬화되고 조건이 갱신된 값으로 다시 평가되므로, 동시 호출이 한도를 넘길 수 없다(READ COMMITTED).
-- 중간 어디서든 한도에 걸리면 begin…exception 블록(서브트랜잭션)이 이 호출의 모든 변경을 되돌린다.
-- 락 순서는 reserve와 settle 모두 예약 행 → 사용자 잔액 → 전역(day, month)으로 같게 둔다(교착 방지).
create or replace function reserve_usage(
  p_user uuid,
  p_request_id text,
  p_digest text,
  p_cost_micros bigint,
  p_month date default null,       -- 그 달 아무 날짜. null이면 UTC 기준 이번 달(서버의 month()와 같다)
  p_minutes int default 0          -- 인식 분량(분). 쓰지 않는 라우트는 0
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date;
  v_day date := (now() at time zone 'utc')::date;
  v_cost_cap bigint;
  v_req_cap int;
  v_min_cap int;
  v_prior_digest text;
  v_scope text;
  v_period date;
  v_global_cap bigint;
begin
  if p_user is null or p_request_id is null or p_digest is null
     or p_cost_micros is null or p_cost_micros < 0 or coalesce(p_minutes, -1) < 0 then
    raise exception 'invalid_reservation' using errcode = '22023';
  end if;
  v_month := date_trunc('month', coalesce(p_month, v_day))::date;

  -- 한도 값은 plans에서 읽는다. 행이 없으면 null이라 아래 조건이 거짓 → quota_exceeded(닫힌 채 실패).
  select pl.monthly_cost_cap_micros, pl.monthly_request_cap, pl.monthly_minutes_cap
    into v_cost_cap, v_req_cap, v_min_cap
    from plans pl where pl.plan = effective_plan(p_user);

  begin
    -- 멱등: 같은 (user, requestId)가 이미 있으면 본문 digest로 중복/불일치를 가른다.
    insert into usage_reservations (user_id, request_id, digest, month, day, reserved_cost_micros, reserved_minutes)
    values (p_user, p_request_id, p_digest, v_month, v_day, p_cost_micros, p_minutes)
    on conflict (user_id, request_id) do nothing;
    if not found then
      select digest into v_prior_digest from usage_reservations
        where user_id = p_user and request_id = p_request_id;
      return case when v_prior_digest = p_digest then 'duplicate' else 'digest_mismatch' end;
    end if;

    insert into monthly_usage (user_id, month) values (p_user, v_month) on conflict do nothing;
    update monthly_usage m
       set requests = m.requests + 1,
           minutes = m.minutes + p_minutes,
           cost_micros = m.cost_micros + p_cost_micros
     where m.user_id = p_user and m.month = v_month
       and m.cost_micros + p_cost_micros <= v_cost_cap
       and (v_req_cap is null or m.requests + 1 <= v_req_cap)
       and (v_min_cap is null or m.minutes + p_minutes <= v_min_cap);
    if not found then
      raise exception 'quota_exceeded' using errcode = 'QE429';
    end if;

    for v_scope, v_period in
      select * from (values ('day', v_day), ('month', v_month)) as t(scope, period) order by 1
    loop
      select cap_micros into v_global_cap from global_caps where scope = v_scope;
      insert into global_usage (scope, period) values (v_scope, v_period) on conflict do nothing;
      update global_usage g
         set cost_micros = g.cost_micros + p_cost_micros
       where g.scope = v_scope and g.period = v_period
         and (v_global_cap is null or g.cost_micros + p_cost_micros <= v_global_cap);
      if not found then
        raise exception 'quota_exceeded' using errcode = 'QE429';
      end if;
    end loop;

    return 'reserved';
  exception
    when sqlstate 'QE429' then
      return 'quota_exceeded';
  end;
end;
$$;

-- 정산. 결과: settled | refunded | already_settled | not_found. 호출마다 usage_events 한 줄이 남는다.
--   p_status = 'ok' | 'error' : 공급자까지 갔다. p_actual_cost_micros가 있으면 예약액을 실제 비용으로 바꾸고,
--                               null(미보고)이면 예약액을 그대로 청구한다 — 공짜였다고 가정하지 않는다.
--                               실제 비용이 예약보다 크면 한도를 살짝 넘길 수 있다(이미 쓴 돈이라 되돌릴 수 없다).
--   p_status = 'refunded'     : 공급자에 아무것도 보내지 않았다. 예약을 풀고(요청 수·분 포함) 예약 행을 지운다.
-- 같은 요청의 두 번째 정산은 원장에 아무것도 쓰지 않고 already_settled를 돌려준다.
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
  p_job_id text default null
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
    cost_micros, cost_reported, prompt_version, schema_version, status, error_code, latency_ms, client_version, host
  ) values (
    p_user, p_job_id, p_request_id, p_stage, p_provider, p_model, p_input_tokens, p_output_tokens, p_audio_seconds, p_images,
    v_charged, v_refund or p_actual_cost_micros is not null, p_prompt_version, p_schema_version, p_status, p_error_code,
    p_latency_ms, p_client_version, p_host
  );

  return case when v_refund then 'refunded' else 'settled' end;
end;
$$;

-- 서버 집계(§13): 단계·모델별 원가·오류율·p50/p95 지연, 일별 요청 수, 전역 잔액. 강의 내용은 없다.
-- error_rate = error / (ok + error): 환불(공급자에 가지 않은 요청)은 공급자 오류율에서 뺀다. 지연도 환불은 제외.
create or replace function admin_usage(p_days int default 30)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_since timestamptz;
begin
  if not is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 400 then
    raise exception 'days_out_of_range' using errcode = '22023';
  end if;
  v_since := now() - make_interval(days => p_days);

  return json_build_object(
    'since', v_since,
    'by_stage_model', (
      select coalesce(json_agg(row_to_json(t) order by t.cost_micros desc, t.stage, t.model), '[]'::json)
      from (
        select stage, provider, model,
               count(*) as requests,
               coalesce(sum(cost_micros), 0)::bigint as cost_micros,
               coalesce(sum(input_tokens), 0)::bigint as input_tokens,
               coalesce(sum(output_tokens), 0)::bigint as output_tokens,
               count(*) filter (where status = 'error') as errors,
               count(*) filter (where status = 'refunded') as refunds,
               round(count(*) filter (where status = 'error')::numeric
                     / nullif(count(*) filter (where status <> 'refunded'), 0), 4) as error_rate,
               round((percentile_cont(0.5) within group (order by latency_ms)
                      filter (where status <> 'refunded'))::numeric) as p50_latency_ms,
               round((percentile_cont(0.95) within group (order by latency_ms)
                      filter (where status <> 'refunded'))::numeric) as p95_latency_ms
        from usage_events
        where created_at >= v_since
        group by stage, provider, model
      ) t
    ),
    'daily', (
      select coalesce(json_agg(row_to_json(d) order by d.day), '[]'::json)
      from (
        select (created_at at time zone 'utc')::date as day,
               count(*) as requests,
               coalesce(sum(cost_micros), 0)::bigint as cost_micros,
               count(*) filter (where status = 'error') as errors
        from usage_events
        where created_at >= v_since
        group by 1
      ) d
    ),
    'global', (
      select coalesce(json_agg(row_to_json(g) order by g.period desc, g.scope), '[]'::json)
      from (
        select u.scope, u.period, u.cost_micros, c.cap_micros
        from global_usage u left join global_caps c on c.scope = u.scope
        where u.period >= v_since::date
      ) g
    )
  );
end;
$$;

-- 테스트용 등급 부여(§12). 새 줄을 쌓는 방식이라 되돌리려면 entitlements 줄을 지운다. 반환값은 entitlements.id.
create or replace function admin_grant_plan(
  p_user uuid,
  p_plan text,
  p_starts timestamptz default now(),
  p_ends timestamptz default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if not is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if not exists (select 1 from plans where plan = p_plan) then
    raise exception 'unknown_plan' using errcode = '22023';
  end if;
  insert into entitlements (user_id, plan, starts_at, ends_at, source)
  values (p_user, p_plan, coalesce(p_starts, now()), p_ends, 'manual')
  returning id into v_id;
  return v_id;
end;
$$;

-- 계정 삭제(§9, D8): 프로필·권리·잔액·예약·보관함 행·피드백을 지우고, usage_events는 user_id만 null로 만들어
-- 집계를 남긴다. 반환값은 처리한 행 수(내용 없음).
-- 이 함수는 Postgres 행만 다룬다. 보관함 암호문(Storage 객체)과 auth.users 삭제는 앱 계층 몫이다.
-- 권장 순서: ① vault_objects.storage_path를 읽어 Storage 객체 삭제 → ② 이 함수 → ③ auth 사용자 삭제.
-- (① 이후 중단돼도 행이 남아 있어 재시도할 수 있다. 어차피 암호문은 키 없이는 복호화할 수 없다.)
-- 삭제 뒤 같은 사용자의 늦은 settle_usage는 not_found가 된다.
create or replace function delete_account_data(p_user uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  n_reservations int;
  n_usage int;
  n_feedback int;
  n_vault int;
  n_entitlements int;
  n_profiles int;
  n_events int;
begin
  if p_user is null then
    raise exception 'invalid_user' using errcode = '22023';
  end if;

  delete from usage_reservations where user_id = p_user;
  get diagnostics n_reservations = row_count;
  delete from monthly_usage where user_id = p_user;
  get diagnostics n_usage = row_count;
  delete from feedback where user_id = p_user;
  get diagnostics n_feedback = row_count;
  delete from vault_objects where user_id = p_user;
  get diagnostics n_vault = row_count;
  delete from entitlements where user_id = p_user;
  get diagnostics n_entitlements = row_count;
  delete from profiles where user_id = p_user;
  get diagnostics n_profiles = row_count;
  -- 가드 트리거가 허용하는 유일한 변경이다.
  update usage_events set user_id = null where user_id = p_user;
  get diagnostics n_events = row_count;

  return json_build_object(
    'usage_reservations', n_reservations,
    'monthly_usage', n_usage,
    'feedback', n_feedback,
    'vault_objects', n_vault,
    'entitlements', n_entitlements,
    'profiles', n_profiles,
    'usage_events_deidentified', n_events
  );
end;
$$;

-- Supabase는 public 스키마의 새 함수에 anon/authenticated/service_role 실행 권한을 기본으로 준다.
-- 서버 전용 함수는 셋 중 service_role만 남기고, 어드민 함수는 schema.sql과 같이 authenticated(+is_admin 게이트)만 연다.
revoke all on function effective_plan(uuid, timestamptz) from public, anon, authenticated;
revoke all on function reserve_usage(uuid, text, text, bigint, date, int) from public, anon, authenticated;
revoke all on function settle_usage(uuid, text, bigint, text, text, text, text, int, int, numeric, int, text, int, text, int, text, text, text) from public, anon, authenticated;
revoke all on function delete_account_data(uuid) from public, anon, authenticated;
revoke all on function admin_usage(int) from public, anon;
revoke all on function admin_grant_plan(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function effective_plan(uuid, timestamptz) to service_role;
grant execute on function reserve_usage(uuid, text, text, bigint, date, int) to service_role;
grant execute on function settle_usage(uuid, text, bigint, text, text, text, text, int, int, numeric, int, text, int, text, int, text, text, text) to service_role;
grant execute on function delete_account_data(uuid) to service_role;
grant execute on function admin_usage(int) to authenticated;
grant execute on function admin_grant_plan(uuid, text, timestamptz, timestamptz) to authenticated;

-- 자체 점검: 경계(RLS·정책 0개·실행 권한)와 어드민 게이트가 의도대로인지 확인한다. 데이터는 남기지 않는다.
do $$
declare
  t text;
  f regprocedure;
begin
  foreach t in array array['plans', 'global_caps', 'global_usage', 'profiles', 'entitlements', 'monthly_usage',
                           'usage_reservations', 'usage_events', 'vault_objects', 'feedback'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'FAIL: % 의 RLS가 꺼져 있다', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception 'FAIL: % 에 정책이 있다 — 정책은 0개여야 한다', t;
    end if;
  end loop;

  foreach f in array array[
    'effective_plan(uuid, timestamptz)'::regprocedure,
    'reserve_usage(uuid, text, text, bigint, date, int)'::regprocedure,
    'settle_usage(uuid, text, bigint, text, text, text, text, int, int, numeric, int, text, int, text, int, text, text, text)'::regprocedure,
    'delete_account_data(uuid)'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
       or not has_function_privilege('service_role', f, 'execute') then
      raise exception 'FAIL: % 는 service_role 전용이어야 한다', f;
    end if;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('email', 'nobody@example.com')::text, true);
  begin
    perform admin_usage();
    raise exception 'FAIL: 비관리자가 사용량 집계를 읽었다';
  exception
    when sqlstate '42501' then null;
  end;
  begin
    perform admin_grant_plan(gen_random_uuid(), 'paid');
    raise exception 'FAIL: 비관리자가 등급을 부여했다';
  exception
    when sqlstate '42501' then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('email', 'jihwanbu26@gmail.com')::text, true);
  perform admin_usage();

  raise notice 'OK: v2 테이블 RLS·실행 권한·admin_usage/admin_grant_plan 게이트 점검 통과';
end $$;
