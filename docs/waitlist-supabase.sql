-- 사전 예약 웨이트리스트 테이블.
-- Supabase SQL Editor에서 실행한다. 이후 Project Settings > API의
-- Project URL과 anon public key를 landing/waitlist-config.js에 넣는다.
-- anon key는 공개돼도 되는 값이며 아래 RLS로 INSERT만 허용한다.
-- service_role 키는 절대 클라이언트에 넣지 않는다.

create table if not exists public.waitlist (
  id bigint generated always as identity primary key,
  email text not null unique,
  phone text not null,
  plan text,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- anon(비로그인) 역할은 새 행 삽입만 가능. 읽기·수정·삭제는 허용하지 않는다.
create policy "anon insert only" on public.waitlist
  for insert to anon
  with check (true);
