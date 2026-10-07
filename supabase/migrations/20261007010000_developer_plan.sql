-- 2026-10-07 개발용 등급. 공개 가격표에 나오지 않고 profiles 로만 부여한다(예: update profiles set plan = 'developer' where user_id = …).
-- 설계상 비용 상한은 항상 있어야 하므로(무제한 없음) 사실상 무제한인 큰 값($1,000,000)을 둔다. 요청·분 한도는 null(무제한).
-- 전역 월 상한(global_caps)은 그대로 적용된다. 멱등 — 여러 번 적용해도 안전하다.
insert into plans (plan, label, price_krw, edu_price_krw, sort, monthly_cost_cap_micros, monthly_request_cap, monthly_minutes_cap, placeholder)
values ('developer', 'Dev', 0, null, 99, 1000000000000, null, null, true)
on conflict (plan) do update set monthly_cost_cap_micros = excluded.monthly_cost_cap_micros,
  monthly_request_cap = excluded.monthly_request_cap, monthly_minutes_cap = excluded.monthly_minutes_cap;

create or replace function plan_catalog()
returns table(plan text, label text, price_krw int, edu_price_krw int, monthly_minutes_cap int)
language sql
security definer
stable
set search_path = public
as $$
  select p.plan, p.label, p.price_krw, p.edu_price_krw, p.monthly_minutes_cap from plans p where p.plan <> 'developer' order by p.sort, p.plan;
$$;
