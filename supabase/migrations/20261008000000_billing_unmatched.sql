-- 2026-10-08 미매칭 결제 이벤트 원장 + 해지·환불 매칭 보강 (호스트가 적용한다).
--
-- 배경: 플랜 맵·계정 매칭에 실패한 서명 검증 이벤트(unknown_plan/unknown_user)를 웹훅이 RPC 전에 200으로만
-- 삼켜 "돈을 냈는데 아무 기록도 없는" 결제가 생겼다. 해지·환불은 external_id 불일치 때 0행을 치고도
-- 'applied' 를 돌려줬고, 해지가 먼저 기록된 뒤 온 결제 완료는 'stale' 로 버려져 돈 낸 기간이 0일이 됐다.
--
-- 변경:
-- 1) billing_events 에 reason/buyer_email_hash/content_id/option_id 추가 — 웹훅이 매칭 실패 이벤트를
--    직접 적재한다(평문 이메일은 저장하지 않고 trim+소문자한 값의 SHA-256 hex 만). 이벤트 id 멱등.
-- 2) apply_billing_event: 해지·환불이 external_id 로 못 찾으면 merchant_uid 의 완료 이벤트 계정으로
--    한 번 더 찾고, 그래도 없으면 'no_target' 반환(0행 'applied' 방지).
-- 3) 순서 역전: 해지가 먼저 기록된 늦은 completed 는 부여 행이 없으면 기간을 만들고 해지 예약 상태로
--    둔다('applied_cancelled'). 환불이 먼저면 돈이 돌아갔으니 기존대로 'stale'.
-- 멱등 — 여러 번 적용해도 안전하다.

alter table billing_events add column if not exists reason text check (reason in ('unknown_plan','unknown_user'));
alter table billing_events add column if not exists buyer_email_hash text check (buyer_email_hash ~ '^[0-9a-f]{64}$');
alter table billing_events add column if not exists product_id text check (char_length(product_id) between 1 and 128);
alter table billing_events add column if not exists option_id text check (char_length(option_id) between 1 and 128);
create index if not exists billing_events_buyer_email_idx on billing_events (buyer_email_hash) where buyer_email_hash is not null;

drop function if exists apply_billing_event(text, text, uuid, text, boolean, text, timestamptz, timestamptz);
drop function if exists apply_billing_event(text, text, uuid, text, boolean, text, timestamptz, timestamptz, text);
drop function if exists apply_billing_event(text, text, uuid, text, boolean, text, timestamptz, timestamptz, text, integer, text, integer);
create or replace function apply_billing_event(
  p_event_id text, p_type text, p_user uuid, p_plan text, p_edu boolean,
  p_external_id text, p_starts timestamptz, p_ends timestamptz, p_merchant text default null,
  p_amount integer default null, p_coupon text default null, p_coupon_discount integer default null, p_occurred timestamptz default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_cancelled boolean := false;
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
  -- 순서 역전: 이 결제 완료보다 나중에 일어난 해지·환불이 이미 반영됐으면 기록만 하고 적용하지 않는다('stale').
  -- 단 부여 행이 한 번도 없었으면 돈 낸 기간이 0일이 되지 않게 기간을 만들고 해지 예약 상태로 둔다('applied_cancelled').
  -- 환불이 먼저 왔으면 돈은 돌아간 것이니 행이 없어도 기간을 만들지 않는다.
  if p_type = 'subscription_payment.completed' and p_occurred is not null then
    if exists (select 1 from billing_events b where b.external_id = p_external_id and b.id <> p_event_id and b.occurred_at > p_occurred
                  and b.type = 'subscription_payment.refunded') then
      return 'stale';
    end if;
    v_cancelled := exists (select 1 from billing_events b where b.external_id = p_external_id and b.id <> p_event_id and b.occurred_at > p_occurred
                              and b.type in ('subscription.cancel_requested', 'subscription.terminated'));
    if v_cancelled and exists (select 1 from entitlements e where e.source = 'payment' and e.external_id = p_external_id) then
      return 'stale';
    end if;
  end if;
  if p_type = 'subscription_payment.completed' then
    if p_user is null or p_plan is null or p_ends is null then raise exception 'invalid_billing_event' using errcode = '22023'; end if;
    insert into entitlements (user_id, plan, starts_at, ends_at, source, external_id, edu, cancel_at_period_end)
    values (p_user, p_plan, coalesce(p_starts, now()), p_ends, 'payment', p_external_id, coalesce(p_edu, false), v_cancelled)
    on conflict (source, external_id) where external_id is not null
    do update set plan = excluded.plan, ends_at = greatest(entitlements.ends_at, excluded.ends_at), edu = excluded.edu, cancel_at_period_end = false;
    return case when v_cancelled then 'applied_cancelled' else 'applied' end;
  end if;
  -- 해지·환불: external_id 로 못 찾으면 같은 결제번호(merchant_uid)를 남긴 앞선 이벤트의 external_id(=완료 때 부여 키)로 찾는다.
  -- 두 갈래 모두 이벤트의 계정(p_user, 웹훅이 항상 채워 보낸다)에 한정한다 — 주문번호가 겹쳐도 다른 계정 구독은 건드리지 않는다.
  update entitlements e
     set cancel_at_period_end = true,
         ends_at = case when p_type = 'subscription.cancel_requested' then coalesce(p_ends, e.ends_at)
                        else greatest(e.starts_at + interval '1 second', least(coalesce(e.ends_at, 'infinity'), coalesce(p_ends, now()))) end
   where e.source = 'payment' and e.user_id = p_user and (e.external_id = p_external_id
        or (p_merchant is not null and e.external_id in (select b.external_id from billing_events b
              where b.merchant_uid = p_merchant and b.user_id = p_user and b.external_id is not null)));
  if not found then return 'no_target'; end if;
  return 'applied';
end $$;

revoke all on function apply_billing_event(text, text, uuid, text, boolean, text, timestamptz, timestamptz, text, integer, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function apply_billing_event(text, text, uuid, text, boolean, text, timestamptz, timestamptz, text, integer, text, integer, timestamptz) to service_role;
