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
-- 1. 등급 목록(데이터): 이름·가격·한도의 유일한 원본. 서버 한도, 계정 메뉴(my_account), 가격 표(plan_catalog)가 모두 이 표를 읽는다.
--    한도 숫자는 아직 임시값이라 UPDATE 한 줄로 바꾼다. 가격은 2026-10-03 확정값이고 이 파일이 원본이다(다시 실행하면 덮어쓴다).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists plans (
  plan text primary key check (plan ~ '^[a-z][a-z0-9_]{0,31}$'),
  monthly_cost_cap_micros bigint not null check (monthly_cost_cap_micros >= 0),  -- 비용 상한은 항상 있어야 한다(무제한 없음)
  monthly_request_cap int check (monthly_request_cap >= 0),                      -- null = 무제한
  monthly_minutes_cap int check (monthly_minutes_cap >= 0),                      -- null = 무제한
  placeholder boolean not null default true                                      -- 한도 숫자가 임시값. 확정하면 false로
);
-- 2026-10-03 일원화로 더한 칸. 이미 만든 DB를 위해 alter로 둔다.
alter table plans add column if not exists label text not null default '' check (label ~ '^[A-Za-z0-9 ]{0,32}$');  -- 화면 표시 이름
alter table plans add column if not exists price_krw int not null default 0 check (price_krw >= 0);      -- 월 가격(원)
alter table plans add column if not exists edu_price_krw int check (edu_price_krw >= 0);                -- 학생 인증 월 가격. null = 학생가 없음
alter table plans add column if not exists sort smallint not null default 0;                             -- 가격 표 순서

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

-- 시드. 가격(원)과 월 분 한도는 확정값이라 다시 실행하면 덮어쓰고, 비용·요청 한도는 임시값이라 운영자가 고친 값을 덮어쓰지 않는다.
--   월 분 한도(2026-10-03 확정): free 180분, essential 600분, professional 1,200분.
--   비용(임시): free는 §18의 Free 원가(강의 1시간 약 20원)로 $0.3.
--   essential·professional은 강의 1시간 원가 약 300원(§18) 기준으로 가격의 절반 안쪽이 되게 잡았다($8, $14 — 옛 30·60시간 기준이라 지금 분 한도 10·20시간에는 넉넉하다).
--   분은 클라우드 음성 인식(/v1/stt)만 센다. Free의 실시간 경로가 v2로 옮겨 가기 전까지 Free의 분 한도는 쓰이지 않는다.
--   전역: GLOBAL_COST_CENTS 기본값 15000 = $150/월. 일일 상한은 정하지 않았다(null).
insert into plans (plan, label, price_krw, edu_price_krw, sort, monthly_cost_cap_micros, monthly_request_cap, monthly_minutes_cap) values
  ('free', 'Free', 0, null, 0, 300000, 300, 180),
  ('essential', 'Essential', 24000, 14000, 1, 8000000, 5000, 600),
  ('professional', 'Pro', 28900, null, 2, 14000000, 10000, 1200)
on conflict (plan) do update set label = excluded.label, price_krw = excluded.price_krw,
  edu_price_krw = excluded.edu_price_krw, sort = excluded.sort, monthly_minutes_cap = excluded.monthly_minutes_cap;

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
-- 결제 부여의 구독 상태(2026-10-03, schema.sql의 옛 subscriptions 표를 합쳤다). 결제 웹훅이 쓴다.
alter table entitlements add column if not exists edu boolean not null default false;                   -- 학생가로 결제
alter table entitlements add column if not exists cancel_at_period_end boolean not null default false;  -- 해지 예약: ends_at까지 이용
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
-- 작업 단위 묶기·강의 분야 통계(2026-10-04). 이미 만든 DB를 위해 alter로 둔다.
-- subject 는 자동 분류 코드다 — 강의 제목·내용 같은 자유 텍스트는 문자 집합 CHECK가 막는다.
alter table usage_events add column if not exists lecture_seconds numeric(10, 2) check (lecture_seconds >= 0);
alter table usage_events add column if not exists slides int check (slides >= 0);
alter table usage_events add column if not exists subject text check (subject ~ '^[a-z][a-z0-9_]{0,31}$');
alter table usage_events add column if not exists subject_conf numeric(5, 4) check (subject_conf between 0 and 1);

-- 논리 작업·시도·캐시·비용 보고(§7). 이미 만든 DB를 위해 alter로 둔다. 요청 행은 요청 합계만 싣고
-- 시도별 상세는 usage_attempts 에 간다 — 요청 합계를 두 번 세지 않는다. 미보고는 null 이다(보고된 0 과 구분).
alter table usage_events add column if not exists logical_task_id text check (logical_task_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$');  -- 클라이언트 재시도(-rN)를 묶는 기준 id
alter table usage_events add column if not exists attempt_id text check (attempt_id ~ '^[a-z][a-z0-9_-]{0,31}$');                  -- 이 요청의 마지막 제공자 호출 번호(a0 첫 호출)
alter table usage_events add column if not exists cache_kind text check (cache_kind in ('local_result', 'provider_prompt'));
alter table usage_events add column if not exists cache_status text check (cache_status in ('hit', 'miss', 'unknown', 'not_applicable'));
alter table usage_events add column if not exists cached_input_tokens int check (cached_input_tokens >= 0);
alter table usage_events add column if not exists cache_write_tokens int check (cache_write_tokens >= 0);
alter table usage_events add column if not exists provider_reported_cost_micros bigint check (provider_reported_cost_micros >= 0); -- 제공자가 보고한 비용만(추정 아님). null = 미보고
alter table usage_events add column if not exists cost_status text check (cost_status in ('provider_reported', 'estimated', 'unreported', 'not_applicable'));
alter table usage_events add column if not exists policy_version text check (policy_version ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$');

-- 한 클라이언트 요청 안의 제공자 HTTP 호출을 시도마다 한 줄로 남긴다(HTTP 내부 재시도·판정 청크 포함).
-- 청구 합계·오류율은 요청 단위 usage_events 만 본다 — 이 표는 시도별 캐시·비용 보고 상세다.
create table if not exists usage_attempts (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  request_id text not null check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  attempt_id text not null check (attempt_id ~ '^[a-z][a-z0-9_-]{0,31}$'),
  stage text not null check (stage ~ '^[a-z][a-z0-9_.-]{0,31}$'),
  provider text check (provider ~ '^[a-z][a-z0-9_.-]{0,31}$'),
  model text check (model ~ '^[A-Za-z0-9][A-Za-z0-9_./:@-]{0,95}$'),
  input_tokens int check (input_tokens >= 0),
  output_tokens int check (output_tokens >= 0),
  cached_input_tokens int check (cached_input_tokens >= 0),    -- 제공자 미보고는 null, 보고된 0(miss)과 구분
  cache_write_tokens int check (cache_write_tokens >= 0),
  provider_reported_cost_micros bigint check (provider_reported_cost_micros >= 0),
  cost_status text check (cost_status in ('provider_reported', 'estimated', 'unreported', 'not_applicable')),
  cache_kind text check (cache_kind in ('local_result', 'provider_prompt')),
  cache_status text not null check (cache_status in ('hit', 'miss', 'unknown', 'not_applicable')),
  status text not null check (status in ('ok', 'error')),
  error_code text check (error_code ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  latency_ms int check (latency_ms >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, request_id, attempt_id)
);
create index if not exists usage_attempts_request_idx on usage_attempts (request_id);

-- 시도별 추론 토큰과 시도별 stage/provider/model. 혼합 모델 실행(계획·작성 모델이 다른 실험)에서
-- 시도 행이 요청 부모 값으로 덮어씌워져 원가 분석이 오염되지 않게 시도별 값을 받는다.
-- settle_usage 는 attempts 요소의 값을 우선 쓰고 없으면 요청 값으로 채운다(coalesce, 이전 호환). 미보고는 null.
alter table usage_attempts add column if not exists reasoning_tokens int check (reasoning_tokens >= 0);

-- 로컬 결과 캐시 집계(POST /v1/runs): 클라이언트가 run 끝에 한 번 보내는 콘텐츠 없는 수치.
-- 공급자 호출이 없어 usage_events 에는 안 보이는 로컬 캐시 적중을 관측한다. 청구 정산 근거로는 쓰지 않는다.
create table if not exists run_reports (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  job_id text not null check (job_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  cache_kind text not null check (cache_kind in ('local_result', 'provider_prompt')),
  cache_hits int not null check (cache_hits >= 0),
  cache_misses int not null check (cache_misses >= 0),
  rerun int not null default 0 check (rerun >= 0),
  client_version text check (client_version ~ '^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$'),
  created_at timestamptz not null default now()
);
create unique index if not exists run_reports_job_idx on run_reports (user_id, job_id);

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
-- 시도·run 집계 표도 같은 추가 전용 규칙이다(user_id → null 비식별화만 허용).
drop trigger if exists usage_attempts_guard on usage_attempts;
create trigger usage_attempts_guard before update or delete on usage_attempts
  for each row execute function usage_events_guard();
drop trigger if exists run_reports_guard on run_reports;
create trigger run_reports_guard before update or delete on run_reports
  for each row execute function usage_events_guard();

-- 시험 기간 달력(한국 학기 기준). KST 날짜를 넣으면 midterm/final/vacation/semester 를 돌려준다.
create or replace function exam_period(d date)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when (extract(month from d) = 4 and extract(day from d) between 20 and 26)
      or (extract(month from d) = 10 and extract(day from d) between 19 and 25) then 'midterm'
    when (extract(month from d) = 6 and extract(day from d) between 8 and 21)
      or (extract(month from d) = 12 and extract(day from d) between 7 and 20) then 'final'
    when (extract(month from d) = 6 and extract(day from d) >= 22)
      or extract(month from d) in (7, 8)
      or (extract(month from d) = 12 and extract(day from d) >= 21)
      or extract(month from d) <= 2 then 'vacation'
    else 'semester'
  end;
$$;
comment on function exam_period(date) is 'ponytail fixed national calendar; replace with per-school calendars when school is known.';

-- 어드민 분석 뷰. 작업 하나를 한 줄로 묶는다 — 라이브 요약 작업(live-<세션>-<n>)은 캡처 세션 id 로 접어
-- 인식 이벤트와 같은 작업으로 본다. security_invoker 라 호출자 권한·RLS 를 그대로 탄다.
create or replace view job_facts
with (security_invoker = true) as
select
  regexp_replace(e.job_id, '^live-(.+)-[0-9]+$', '\1') as job_key,
  e.user_id,
  p.plan,
  min(e.created_at) as started_at,
  max(e.created_at) as ended_at,
  (min(e.created_at) at time zone 'Asia/Seoul') as started_kst,
  extract(isodow from (min(e.created_at) at time zone 'Asia/Seoul'))::int as weekday,
  extract(hour from (min(e.created_at) at time zone 'Asia/Seoul'))::int as hour,
  exam_period((min(e.created_at) at time zone 'Asia/Seoul')::date) as exam_period,
  round(max(e.lecture_seconds) / 60, 1) as lecture_min,
  round(sum(e.audio_seconds) filter (where e.stage = 'stt') / 60, 1) as stt_min,
  max(e.slides) as slides,
  sum(e.images) filter (where e.stage like 'vision.%') as cloud_vision_slides,
  coalesce(max(e.subject) filter (where e.subject_conf >= 0.6), 'unknown') as subject,
  bool_or(e.job_id like 'regen-%') as is_regen,
  count(*) as requests,
  count(*) filter (where e.status = 'error') as errors,
  round(sum(e.cost_micros) / 1e6 * 1400) as cost_krw,
  max(e.host) as host,
  max(e.client_version) as client_version
from usage_events e
  left join profiles p on p.user_id = e.user_id
where e.job_id is not null
group by 1, e.user_id, p.plan;

-- 사용자별 월 잔액 + 활동 월 평균 분(분은 활동이 있는 달만의 평균이다 — monthly_usage 에는 쓴 달만 행이 있다).
create or replace view user_monthly
with (security_invoker = true) as
select m.user_id, m.month, m.minutes, m.requests,
       avg(m.minutes) over (partition by m.user_id) as avg_minutes_per_active_month
from monthly_usage m;

revoke all on job_facts, user_monthly from anon, authenticated;
grant select on job_facts, user_monthly to service_role;

-- 제공자 동시 호출의 전역 상한. 서버 메모리의 세마포어는 워커마다 따로라 Postgres에 하나를 둔다(server/index.js acquire).
-- 사용자 데이터는 없고 슬롯은 expires_at이 지나면 만료다 — 계정 삭제·정기 정리 경로에는 넣지 않는다.
create table if not exists provider_slots (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}$'),
  expires_at timestamptz not null
);
create index if not exists provider_slots_provider_idx on provider_slots (provider, expires_at);

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

-- 노트 파일(.summrizei) 암호화 키: 계정마다 하나. 로그인한 사용자만 library_key()로 받는다 — 별도 비밀번호 없이 "로그인하면 열린다".
-- 노트 파일은 서버에 올라오지 않는다(이 기기 폴더에만 있다). 서버는 키만 갖고, 키는 강의 내용과 무관한 난수다. 계정 삭제 때 cascade 로 함께 지워진다.
create table if not exists library_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  key text not null check (key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
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
alter table usage_attempts enable row level security;
alter table run_reports enable row level security;
alter table vault_objects enable row level security;
alter table library_keys enable row level security;
alter table feedback enable row level security;
alter table provider_slots enable row level security;
-- 정책 없음 = 전면 차단. 이후에도 여기에 정책을 추가하지 않는다.

-- 서버(service_role)는 RLS를 우회하지만 테이블 권한은 따로 필요하다. 플랫폼의 기본 권한에 기대지 않고 명시한다
-- (보관함 목록·프로필 upsert·피드백 기록·/v1/me의 한도 조회가 직접 접근이다). anon/authenticated에는 주지 않는다.
grant select, insert, update, delete on plans, global_caps, global_usage, profiles, entitlements, monthly_usage,
  usage_reservations, usage_events, usage_attempts, run_reports, vault_objects, library_keys, feedback, provider_slots to service_role;

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
drop function if exists settle_usage(uuid, text, bigint, text, text, text, text, int, int, numeric, int, text, int, text, int, text, text, text);
drop function if exists settle_usage(uuid, text, bigint, text, text, text, text, int, int, numeric, int, text, int, text, int, text, text, text, numeric, int, text, numeric);
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
               coalesce(sum(cached_input_tokens), 0)::bigint as cached_input_tokens,
               coalesce(sum(cache_write_tokens), 0)::bigint as cache_write_tokens,
               count(*) filter (where cached_input_tokens is null) as cache_unreported,
               -- 토큰 캐시 hit ratio: 보고 가능한 호출(캐시 수치가 있는 행)만 분모에 둔다 — 미보고는 분모에서 빼고 따로 센다.
               round(sum(cached_input_tokens)::numeric
                     / nullif(sum(input_tokens) filter (where cached_input_tokens is not null), 0), 4) as token_cache_hit_ratio,
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
-- 이 함수는 Postgres 행만 다룬다. 보관함 암호문(Storage 객체)과 auth.users 삭제는 앱 계층 몫이다
-- (storage.objects는 protect_objects_delete 트리거가 SQL 삭제를 막아 Storage API로만 지울 수 있다).
-- 순서: ① 이 함수 → ② Storage의 "<user_id>/" 접두사 아래 객체 → ③ auth 사용자. 호출자는 server/index.js(DELETE /v1/account)와
-- supabase/functions/delete-account(랜딩) 둘이다. 이 함수가 맨 앞인 것은 아래 구독 검사가 무엇이든 지우기 전에 거절해야 해서다.
-- ②는 행이 아니라 접두사 목록으로 지울 것을 찾으므로 ① 뒤에도 빠짐없이 지운다. 단계마다 멱등이라 어디서 끊겨도 처음부터 다시 부르면 된다.
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
  n_attempts int;
  n_runs int;
begin
  if p_user is null then
    raise exception 'invalid_user' using errcode = '22023';
  end if;
  -- 계정만 지우면 정기결제는 계속 청구된다. 해지 예약 없는 결제 구독이 남아 있으면 아무것도 지우지 않고 거절한다.
  if exists (select 1 from entitlements where user_id = p_user and source = 'payment' and not cancel_at_period_end
             and starts_at <= now() and (ends_at is null or ends_at > now())) then
    raise exception 'active_subscription' using errcode = 'P0001';
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
  update usage_attempts set user_id = null where user_id = p_user;
  get diagnostics n_attempts = row_count;
  update run_reports set user_id = null where user_id = p_user;
  get diagnostics n_runs = row_count;

  return json_build_object(
    'usage_reservations', n_reservations,
    'monthly_usage', n_usage,
    'feedback', n_feedback,
    'vault_objects', n_vault,
    'entitlements', n_entitlements,
    'profiles', n_profiles,
    'usage_events_deidentified', n_events,
    'usage_attempts_deidentified', n_attempts,
    'run_reports_deidentified', n_runs
  );
end;
$$;

-- 제공자 슬롯 하나를 잡는다. 조언 락으로 provider 별 직렬화를 하고 만료 행을 치운 뒤 세므로 워커가 몇이든 p_max를 넘지 않는다.
-- 꽉 차면 null — 호출자는 잠깐 기다렸다 다시 부른다. 잡은 슬롯은 p_ttl_ms 뒤에 만료된다(워커가 죽어도 다음 획득이 회수한다).
create or replace function acquire_provider_slot(p_provider text, p_max int, p_ttl_ms int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_max is null or p_max < 1 or p_ttl_ms is null or p_ttl_ms < 1000 or p_ttl_ms > 600000 then
    raise exception 'invalid_slot_args' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('provider_slot:' || p_provider));
  delete from provider_slots where provider = p_provider and expires_at <= now();
  if (select count(*) from provider_slots where provider = p_provider) >= p_max then
    return null;
  end if;
  insert into provider_slots (provider, expires_at)
    values (p_provider, now() + make_interval(secs => p_ttl_ms / 1000.0))
    returning id into v_id;
  return v_id;
end;
$$;

-- 잡은 슬롯을 돌려놓는다. 없는 id는 못 찾은 것으로 본다(멱등).
create or replace function release_provider_slot(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from provider_slots where id = p_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. 계정 메뉴·가격 표 (랜딩 /account, 확장 패널, 랜딩 어드민)
-- ─────────────────────────────────────────────────────────────────────────────

-- 2026-10-03 일원화. schema.sql에 있던 두 번째 등급·사용량 표(subscriptions·usage_monthly)와 'paid' 등급을 없앤다.
-- 구독 상태는 entitlements(source='payment'), 사용량은 monthly_usage가 맡는다. 행이 남아 있으면 지우지 않고 멈춘다(옮긴 뒤 다시 실행).
-- 랜딩의 탈퇴 RPC(delete_my_account)도 없앤다: auth 사용자만 지워 Storage의 보관함 암호문이 남았다 → supabase/functions/delete-account.
do $$
begin
  if to_regclass('public.subscriptions') is not null then
    if exists (select 1 from subscriptions where plan <> 'free') then
      raise exception 'subscriptions에 유료 행이 있다 — entitlements(source=payment)로 옮긴 뒤 다시 실행하세요';
    end if;
    drop table subscriptions;
  end if;
  if to_regclass('public.usage_monthly') is not null then
    if exists (select 1 from usage_monthly) then
      raise exception 'usage_monthly에 행이 있다 — monthly_usage로 옮긴 뒤 다시 실행하세요';
    end if;
    drop table usage_monthly;
  end if;
  update profiles set plan = 'essential' where plan = 'paid';
  update entitlements set plan = 'essential' where plan = 'paid';
  delete from plans where plan = 'paid';
end $$;
drop function if exists delete_my_account();

-- 내 노트 암호화 키(64자리 hex). 없으면 만든다. 호출자 본인 것만 돌려준다(auth.uid()).
-- gen_random_bytes 는 extensions 스키마라 search_path 에서 안 보여 코어의 gen_random_uuid() 두 개(CSPRNG)를 이어 256비트를 만든다.
create or replace function library_key()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  k text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  insert into library_keys (user_id, key)
    values (uid, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
    on conflict (user_id) do nothing;
  select key into k from library_keys where user_id = uid;
  return k;
end;
$$;

-- 내 등급·이번 달 사용량. 서버의 한도와 같은 표(effective_plan, plans, monthly_usage)를 읽는다.
-- 반환 모양은 옛 schema.sql 판과 같다(lib/account.js, landing/account.js). status는 결제 상태를 따로 두지 않아 언제나 'active'다.
create or replace function my_account()
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_plan text;
  v_cap int;
  e entitlements%rowtype;
  used int;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  v_plan := coalesce(effective_plan(uid), 'free');
  select monthly_minutes_cap into v_cap from plans where plan = v_plan;
  -- 지금 유효한 그 등급의 결제 부여(결제일·해지 예약·학생가 표시용). 수동 부여만 있으면 결제일이 없다.
  select * into e from entitlements
    where user_id = uid and plan = v_plan and source = 'payment' and starts_at <= now() and (ends_at is null or ends_at > now())
    order by ends_at desc nulls first
    limit 1;
  -- 서버가 쓰는 달 키와 같다(UTC 달의 1일, server/index.js month()).
  select minutes into used from monthly_usage
    where user_id = uid and month = date_trunc('month', now() at time zone 'utc')::date;
  return json_build_object(
    'plan', v_plan,
    'status', 'active',
    'edu', coalesce(e.edu, false),
    'current_period_end', e.ends_at,
    'cancel_at_period_end', coalesce(e.cancel_at_period_end, false),
    'minutes_used', coalesce(used, 0),
    'minutes_limit', v_cap
  );
end;
$$;

-- 공개 가격 표. 로그인 없이도 읽는다(가격은 공개 정보). 내부 비용 상한은 내보내지 않는다.
create or replace function plan_catalog()
returns table(plan text, label text, price_krw int, edu_price_krw int, monthly_minutes_cap int)
language sql
security definer
stable
set search_path = public
as $$
  select p.plan, p.label, p.price_krw, p.edu_price_krw, p.monthly_minutes_cap from plans p where p.plan <> 'developer' order by p.sort, p.plan;
$$;

-- 랜딩 어드민의 구독자 수를 결제 부여에서 센다(schema.sql의 정의를 덮어쓴다).
create or replace function admin_stats()
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return json_build_object(
    'subscribers', (select count(distinct user_id) from entitlements
                    where source = 'payment' and starts_at <= now() and (ends_at is null or ends_at > now())),
    'reservations', (select count(*) from reservations),
    'codes_issued', (select count(*) from codes),
    'codes_used', (select count(*) from codes where used_by is not null)
  );
end;
$$;

-- Supabase는 public 스키마의 새 함수에 anon/authenticated/service_role 실행 권한을 기본으로 준다.
-- 서버 전용 함수는 셋 중 service_role만 남기고, 어드민 함수는 schema.sql과 같이 authenticated(+is_admin 게이트)만 연다.
revoke all on function effective_plan(uuid, timestamptz) from public, anon, authenticated;
revoke all on function reserve_usage(uuid, text, text, bigint, date, int) from public, anon, authenticated;
revoke all on function settle_usage(uuid, text, bigint, text, text, text, text, int, int, numeric, int, text, int, text, int, text, text, text, numeric, int, text, numeric, text, text, text, text, int, int, bigint, text, text, jsonb) from public, anon, authenticated;
revoke all on function delete_account_data(uuid) from public, anon, authenticated;
revoke all on function acquire_provider_slot(text, int, int) from public, anon, authenticated;
revoke all on function release_provider_slot(uuid) from public, anon, authenticated;
revoke all on function admin_usage(int) from public, anon;
revoke all on function admin_grant_plan(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function effective_plan(uuid, timestamptz) to service_role;
grant execute on function reserve_usage(uuid, text, text, bigint, date, int) to service_role;
grant execute on function settle_usage(uuid, text, bigint, text, text, text, text, int, int, numeric, int, text, int, text, int, text, text, text, numeric, int, text, numeric, text, text, text, text, int, int, bigint, text, text, jsonb) to service_role;
grant execute on function delete_account_data(uuid) to service_role;
grant execute on function acquire_provider_slot(text, int, int) to service_role;
grant execute on function release_provider_slot(uuid) to service_role;
grant execute on function admin_usage(int) to authenticated;
grant execute on function admin_grant_plan(uuid, text, timestamptz, timestamptz) to authenticated;
revoke all on function library_key() from public, anon;
grant execute on function library_key() to authenticated;
revoke all on function my_account() from public, anon;
revoke all on function plan_catalog() from public;
revoke all on function admin_stats() from public, anon;
grant execute on function my_account() to authenticated;
grant execute on function plan_catalog() to anon, authenticated;
grant execute on function admin_stats() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. 결제 웹훅(Groble)·학생가 자격
-- ─────────────────────────────────────────────────────────────────────────────
-- 받은 웹훅 이벤트의 멱등 원장. 내용은 없다(이벤트 id·종류·계정만). Edge Function billing-webhook 이 서명을 확인한 뒤 apply_billing_event 로만 쓴다.
create table if not exists billing_events (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  type text not null check (type ~ '^[a-z_.]{1,64}$'),
  user_id uuid references auth.users(id) on delete set null,
  received_at timestamptz not null default now()
);
alter table billing_events enable row level security;
grant select, insert on billing_events to service_role;
-- 결제번호(merchantUid). 환불 이벤트에는 sellerReference 가 없어서, 완료 때 남긴 번호로 계정을 되찾는다.
alter table billing_events add column if not exists merchant_uid text check (char_length(merchant_uid) between 1 and 128);
-- 결제 금액(원, pricing.finalAmount)과 쿠폰(code·할인액). 결제 이벤트에만 있고 해지·환불 이벤트는 비어 있다.
alter table billing_events add column if not exists amount_krw integer check (amount_krw >= 0);
alter table billing_events add column if not exists coupon_code text check (char_length(coupon_code) between 1 and 64);
alter table billing_events add column if not exists coupon_discount_krw integer check (coupon_discount_krw >= 0);
-- 이벤트가 일어난 시각(occurredAt)과 대상 구독 키. 재시도로 늦게 온 결제 완료가 이미 반영된 해지·환불을 되돌리지 않게 비교한다.
alter table billing_events add column if not exists external_id text check (external_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$');
alter table billing_events add column if not exists occurred_at timestamptz;
create index if not exists billing_events_external_idx on billing_events (external_id, occurred_at) where external_id is not null;
create index if not exists billing_events_merchant_idx on billing_events (merchant_uid) where merchant_uid is not null;

-- 구독 이벤트 하나를 entitlements 에 반영한다. 같은 이벤트 id 는 한 번만 적용한다('duplicate').
-- 결제 완료: (payment, external_id) 줄을 만들거나 기간을 늘린다. 해지 요청: ends_at 까지 쓰고 끝나도록 표시. 해지 완료·환불: 기간을 닫는다.
drop function if exists apply_billing_event(text, text, uuid, text, boolean, text, timestamptz, timestamptz);
drop function if exists apply_billing_event(text, text, uuid, text, boolean, text, timestamptz, timestamptz, text);
drop function if exists apply_billing_event(text, text, uuid, text, boolean, text, timestamptz, timestamptz, text, integer, text, integer);
create or replace function apply_billing_event(
  p_event_id text, p_type text, p_user uuid, p_plan text, p_edu boolean,
  p_external_id text, p_starts timestamptz, p_ends timestamptz, p_merchant text default null,
  p_amount integer default null, p_coupon text default null, p_coupon_discount integer default null, p_occurred timestamptz default null
) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_type not in ('subscription_payment.completed', 'subscription.cancel_requested', 'subscription.terminated', 'subscription_payment.refunded') then
    return 'ignored';
  end if;
  -- 이미 지워진 계정의 이벤트: FK 위반(=웹훅 503·무한 재시도) 대신 아무것도 쓰지 않고 구별 값을 돌려준다.
  if p_user is not null and not exists (select 1 from auth.users u where u.id = p_user) then
    return 'unknown_user';
  end if;
  insert into billing_events (id, type, user_id, merchant_uid, amount_krw, coupon_code, coupon_discount_krw, external_id, occurred_at)
    values (p_event_id, p_type, p_user, p_merchant, p_amount, p_coupon, p_coupon_discount, p_external_id, p_occurred) on conflict (id) do nothing;
  if not found then return 'duplicate'; end if;
  -- 순서 역전: 이 결제 완료보다 나중에 일어난 해지·환불이 이미 반영됐으면 기록만 하고 적용하지 않는다.
  if p_type = 'subscription_payment.completed' and p_occurred is not null and exists (
       select 1 from billing_events b where b.external_id = p_external_id and b.id <> p_event_id and b.occurred_at > p_occurred
          and b.type in ('subscription.cancel_requested', 'subscription.terminated', 'subscription_payment.refunded')) then
    return 'stale';
  end if;
  if p_type = 'subscription_payment.completed' then
    if p_user is null or p_plan is null or p_ends is null then raise exception 'invalid_billing_event' using errcode = '22023'; end if;
    insert into entitlements (user_id, plan, starts_at, ends_at, source, external_id, edu, cancel_at_period_end)
    values (p_user, p_plan, coalesce(p_starts, now()), p_ends, 'payment', p_external_id, coalesce(p_edu, false), false)
    on conflict (source, external_id) where external_id is not null
    do update set plan = excluded.plan, ends_at = greatest(entitlements.ends_at, excluded.ends_at), edu = excluded.edu, cancel_at_period_end = false;
  elsif p_type = 'subscription.cancel_requested' then
    update entitlements set cancel_at_period_end = true, ends_at = coalesce(p_ends, ends_at)
     where source = 'payment' and external_id = p_external_id;
  else
    update entitlements set cancel_at_period_end = true,
           ends_at = greatest(starts_at + interval '1 second', least(coalesce(ends_at, 'infinity'), coalesce(p_ends, now())))
     where source = 'payment' and external_id = p_external_id;
  end if;
  return 'applied';
end $$;

-- 학생가 자격: 로그인 이메일이 확인된 학교 도메인(.ac.kr·.edu)인가. Google 로그인은 메일 소유를 확인한 계정만 들어온다.
-- 계정 페이지는 이 값이 참일 때만 학생가 결제창을 보여 준다(화면의 정규식만으로 판단하지 않는다).
create or replace function edu_eligible() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce((select u.email_confirmed_at is not null and lower(split_part(u.email, '@', 2)) ~ '(\.ac\.kr|\.edu)$'
                     from auth.users u where u.id = auth.uid()), false)
$$;
revoke all on function apply_billing_event(text, text, uuid, text, boolean, text, timestamptz, timestamptz, text, integer, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function apply_billing_event(text, text, uuid, text, boolean, text, timestamptz, timestamptz, text, integer, text, integer, timestamptz) to service_role;
revoke all on function edu_eligible() from public, anon;
grant execute on function edu_eligible() to authenticated;

-- 자체 점검: 경계(RLS·정책 0개·실행 권한)와 어드민 게이트가 의도대로인지 확인한다. 데이터는 남기지 않는다.
do $$
declare
  t text;
  f regprocedure;
begin
  foreach t in array array['plans', 'global_caps', 'global_usage', 'profiles', 'entitlements', 'monthly_usage',
                           'usage_reservations', 'usage_events', 'usage_attempts', 'run_reports', 'vault_objects', 'feedback', 'billing_events', 'provider_slots'] loop
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
    'settle_usage(uuid, text, bigint, text, text, text, text, int, int, numeric, int, text, int, text, int, text, text, text, numeric, int, text, numeric, text, text, text, text, int, int, bigint, text, text, jsonb)'::regprocedure,
    'delete_account_data(uuid)'::regprocedure,
    'apply_billing_event(text, text, uuid, text, boolean, text, timestamptz, timestamptz, text, integer, text, integer, timestamptz)'::regprocedure,
    'acquire_provider_slot(text, int, int)'::regprocedure,
    'release_provider_slot(uuid)'::regprocedure
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
    perform admin_grant_plan(gen_random_uuid(), 'essential');
    raise exception 'FAIL: 비관리자가 등급을 부여했다';
  exception
    when sqlstate '42501' then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('email', 'jihwanbu26@gmail.com')::text, true);
  perform admin_usage();

  raise notice 'OK: v2 테이블 RLS·실행 권한·admin_usage/admin_grant_plan 게이트 점검 통과';
end $$;
