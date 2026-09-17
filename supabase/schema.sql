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

revoke execute on function is_admin() from public, anon;
revoke execute on function admin_stats() from public, anon;
revoke execute on function admin_mint_codes(int) from public, anon;
grant execute on function is_admin() to authenticated;
grant execute on function admin_stats() to authenticated;
grant execute on function admin_mint_codes(int) to authenticated;

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

  perform set_config('request.jwt.claims', json_build_object('email', 'jihwanbu26@gmail.com')::text, true);
  stats := admin_stats();
  if stats is null then
    raise exception 'FAIL: 관리자가 통계를 읽지 못했다';
  end if;

  -- 관리자 성공 경로 자체는 실제 코드를 남기므로 호출 후 바로 지운다.
  select array_agg(code) into minted from admin_mint_codes(1) as code;
  delete from codes where code = any(minted);

  raise notice 'OK: admin_stats/admin_mint_codes 권한 점검 통과';
end $$;
