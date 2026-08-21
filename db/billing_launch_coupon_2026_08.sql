-- Launch acquisition coupon — August 2026
--
-- The market-entry discount lives here rather than in the list price, so that
-- ending the promotion is a coupon expiry rather than a public price increase,
-- and so the sticker price keeps anchoring the product's value.
--
-- Deliberately created with is_active = false. Flip it to true when you are
-- ready to publish the code:
--     update public.coupons set is_active = true, updated_at = now()
--      where code = 'LAUNCH40';
--
-- Caps: 200 redemptions, six-month window, all plans. Adjust before running if
-- those are not the terms you want — the discount depth in particular decides
-- how much revenue the launch gives away.

begin;

insert into public.coupons (
  code,
  description,
  discount_percentage,
  max_global_uses,
  is_active,
  starts_at,
  expires_at,
  applicable_plan_ids
)
values (
  'LAUNCH40',
  'India market-entry launch offer — first 200 organizations',
  40.00,
  200,
  false,                                  -- staged; flip to true to publish
  now(),
  now() + interval '6 months',
  '{}'::text[]                            -- empty = valid on every active plan
)
on conflict (code) do nothing;

commit;

--------------------------------------------------------------------------------
-- Effective prices while LAUNCH40 is live (before GST):
--   Starter    Rs 14,999 -> Rs  8,999   (Rs 180 per interview)
--   Growth     Rs 24,999 -> Rs 14,999   (Rs 150 per interview)
--   Scale      Rs 44,999 -> Rs 26,999   (Rs 135 per interview)
--   Expansion  Rs 89,999 -> Rs 53,999   (Rs 108 per interview)
--
-- ROLLBACK
--------------------------------------------------------------------------------
-- delete from public.coupons where code = 'LAUNCH40' and current_global_uses = 0;
