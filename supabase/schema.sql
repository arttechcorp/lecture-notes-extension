-- Summrizei 사전예약/코드 어드민 스키마. Supabase SQL Editor에 통째로 붙여넣어 실행한다. 여러 번 실행해도 안전(멱등).
-- 경계는 여기다: RLS는 켜되 정책은 0개 — anon/authenticated의 테이블 직접 접근을 전면 차단하고,
-- security definer 함수만 통로로 둔다. 모든 함수에 set search_path = public 필수(하이재킹 방지).

create table if not exists admins (
  email text primary key
);
insert into admins (email) values ('jihwanbu26@gmail.com') on conflict do nothing;

create table if not exists reservations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists codes (
  code text primary key,
  owner_id uuid references auth.users(id) on delete set null,
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists codes_used_by_idx on codes (used_by) where used_by is not null;

alter table admins enable row level security;
alter table reservations enable row level security;
alter table codes enable row level security;
-- 정책 없음 = 전면 차단. 이후에도 여기에 정책을 추가하지 않는다.

create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from admins where email = auth.jwt()->>'email');
$$;

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
    'subscribers', null,
    'reservations', (select count(*) from reservations),
    'codes_issued', (select count(*) from codes),
    'codes_used', (select count(*) from codes where used_by is not null)
  );
end;
$$;

create or replace function admin_mint_codes(n int)
returns setof text
language plpgsql
security definer
set search_path = public
as $$
declare
  minted int := 0;
  batch text[];
  c text;
begin
  if not is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if n < 1 or n > 100 then
    raise exception 'n_out_of_range';
  end if;

  -- gen_random_uuid()는 코어(pg_catalog) 함수라 search_path를 public으로 잠가도 잡힌다.
  -- pgcrypto의 gen_random_bytes는 Supabase에서 extensions 스키마에 있어 여기서 안 보인다.
  -- v4 UUID 앞 10자리는 모두 난수(40비트)라 100개 규모에서 충돌은 무시 가능하고,
  -- on conflict do nothing 뒤 부족분을 재시도해 실제로 n개가 나오는 것을 보장한다.
  while minted < n loop
    c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    insert into codes (code) values (c) on conflict (code) do nothing;
    if found then
      minted := minted + 1;
      batch := array_append(batch, c);
    end if;
  end loop;

  return query select unnest(batch);
end;
$$;

-- 반환 타입이 바뀌면 create or replace가 거부되므로 먼저 떨어뜨린다.
drop function if exists admin_list_codes();
create or replace function admin_list_codes()
returns table(code text, kind text, owner_email text, used_by_email text, used boolean, created_at timestamptz)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  -- 초대 경로를 읽으려면 누가 뿌렸고 누가 썼는지가 같이 보여야 한다. uuid 대신 이메일로 낸다.
  -- 이 목록은 관리자만 통과하므로 개인정보 노출면은 admins 테이블 크기와 같다.
  return query
    select c.code,
           case when c.owner_id is null then 'seed' else 'derived' end,
           o.email,
           u.email,
           c.used_by is not null,
           c.created_at
    from codes c
    left join reservations o on o.user_id = c.owner_id
    left join reservations u on u.user_id = c.used_by
    order by c.created_at desc
    limit 500;
end;
$$;

revoke execute on function is_admin() from public, anon;
revoke execute on function admin_stats() from public, anon;
revoke execute on function admin_mint_codes(int) from public, anon;
revoke execute on function admin_list_codes() from public, anon;
grant execute on function is_admin() to authenticated;
grant execute on function admin_stats() to authenticated;
grant execute on function admin_mint_codes(int) to authenticated;
grant execute on function admin_list_codes() to authenticated;

-- 자체 점검: 비관리자는 차단되고 관리자는 통과하는지 확인한다.
do $$
declare
  stats json;
  minted text[];
begin
  perform set_config('request.jwt.claims', json_build_object('email', 'nobody@example.com')::text, true);
  begin
    perform admin_stats();
    raise exception 'FAIL: 비관리자가 통계를 읽었다';
  exception
    when sqlstate '42501' then null;
  end;

  begin
    perform admin_mint_codes(1);
    raise exception 'FAIL: 비관리자가 코드를 발급했다';
  exception
    when sqlstate '42501' then null;
  end;

  begin
    perform admin_list_codes();
    raise exception 'FAIL: 비관리자가 코드 목록을 읽었다';
  exception
    when sqlstate '42501' then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('email', 'jihwanbu26@gmail.com')::text, true);
  stats := admin_stats();
  if stats is null then
    raise exception 'FAIL: 관리자가 통계를 읽지 못했다';
  end if;

  -- 관리자 성공 경로 자체는 실제 코드를 남기므로 호출 후 바로 지운다.
  select array_agg(code) into minted from admin_mint_codes(1) as code;
  delete from codes where code = any(minted);

  perform admin_list_codes();

  raise notice 'OK: admin_stats/admin_mint_codes/admin_list_codes 권한 점검 통과';
end $$;

-- ───────────────── 계정 메뉴: 구독·사용량 ─────────────────
-- subscriptions 쓰기는 앞으로 서버의 grogle 웹훅(service_role)만 한다. 클라이언트는 절대 쓰지 않는다 — 정책 0개 유지.
create table if not exists subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'essential', 'professional')),
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled')),
  edu boolean not null default false,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  provider text not null default 'grogle',
  provider_customer_id text,
  updated_at timestamptz not null default now()
);

create table if not exists usage_monthly (
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null,
  minutes int not null default 0,
  primary key (user_id, month)
);

alter table subscriptions enable row level security;
alter table usage_monthly enable row level security;

create or replace function my_account()
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  s subscriptions%rowtype;
  used int;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into s from subscriptions where user_id = uid;
  select minutes into used from usage_monthly where user_id = uid and month = date_trunc('month', now())::date;
  return json_build_object(
    'plan', coalesce(s.plan, 'free'),
    'status', coalesce(s.status, 'active'),
    'edu', coalesce(s.edu, false),
    'current_period_end', s.current_period_end,
    'cancel_at_period_end', coalesce(s.cancel_at_period_end, false),
    'minutes_used', used,
    'minutes_limit', case when coalesce(s.plan, 'free') = 'free' then 100 else null end
  );
end;
$$;

-- 탈퇴: auth.users 행을 지우면 reservations/subscriptions/usage_monthly가 cascade, codes는 set null로 정리된다.
create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  -- 계정만 지우면 grogle 정기결제는 계속 청구된다. 유료 구독이 해지 예약되지 않았으면 먼저 해지하게 막는다.
  if exists (select 1 from subscriptions where user_id = auth.uid() and plan <> 'free'
             and status in ('active', 'trialing', 'past_due') and not cancel_at_period_end) then
    raise exception 'active_subscription' using errcode = 'P0001';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- 구독자 수를 실제 값으로 채운다 (앞쪽 정의를 덮어쓴다).
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
    'subscribers', (select count(*) from subscriptions where plan <> 'free' and status in ('active', 'trialing')),
    'reservations', (select count(*) from reservations),
    'codes_issued', (select count(*) from codes),
    'codes_used', (select count(*) from codes where used_by is not null)
  );
end;
$$;

revoke execute on function my_account() from public, anon;
revoke execute on function delete_my_account() from public, anon;
revoke execute on function admin_stats() from public, anon;
grant execute on function my_account() to authenticated;
grant execute on function delete_my_account() to authenticated;
grant execute on function admin_stats() to authenticated;

-- 자체 점검: 로그인 없이는 차단되고, 구독 행이 없는 사용자는 free로 나오는지 확인한다.
do $$
declare
  acct json;
begin
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform my_account();
    raise exception 'FAIL: 비로그인이 my_account를 읽었다';
  exception
    when sqlstate '42501' then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text)::text, true);
  acct := my_account();
  if acct->>'plan' <> 'free' or (acct->>'minutes_limit')::int <> 100 then
    raise exception 'FAIL: 구독 행 없는 사용자가 free(100분)로 나오지 않았다';
  end if;

  raise notice 'OK: my_account 권한·기본값 점검 통과';
end $$;
