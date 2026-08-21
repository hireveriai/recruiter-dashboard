-- Billing price alignment — August 2026
--
-- Strategy context: these are the INTRODUCTORY prices. The regular prices they
-- move to when the offer ends live in lib/pricing/introductory-offer.ts and are
-- display-only (shown struck through). Nothing here changes tax or Razorpay
-- behaviour; only the amounts charged.
--
-- WHAT THIS FIXES
--
-- 1. `scale` was inconsistent between columns: price = 49,999 but
--    price_inr = 39,999. INR resolves from price_inr (see getPlanAmount in
--    lib/server/services/billing.ts), so Indian buyers were charged Rs 39,999
--    -- Rs 200 per interview, CHEAPER per interview than Growth (Rs 250) and
--    close to Expansion (Rs 180). Both columns are now set to the intended
--    Rs 49,999.
--
-- 2. `screening-scale` cost MORE per review than `screening-growth` in INR,
--    USD and GBP -- the largest pack was the worst value. Repriced so the
--    add-on ladder falls in every currency.
--
-- 3. GBP and EUR were never part of the ladder review. They are included here
--    so all four currencies move together.
--
-- Introductory cost per interview after this migration:
--    INR  Rs 300 / Rs 250 / Rs 250 / Rs 180
--    USD  $3.98 / $3.49 / $3.00 / $2.40
--    GBP  £3.18 / £2.79 / £2.40 / £1.90
--    EUR  €3.58 / €3.19 / €2.75 / €2.20
--
-- NOTE: `growth` and `scale` are both Rs 250 per interview at introductory
-- prices, so `scale` carries no unit advantage during the offer. The regular
-- ladder (Rs 400/350/300/200) has no such plateau, so it resolves when the
-- offer ends.
--
-- ROLLBACK IS AT THE BOTTOM OF THIS FILE.

begin;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.hireveri_plans
  where slug in ('starter', 'growth', 'scale', 'expansion',
                 'screening-starter', 'screening-growth', 'screening-scale');

  if v_count <> 7 then
    raise exception 'PRE_CHECK_FAILED: expected 7 billing plans, found %', v_count;
  end if;
end $$;

-- Interview plans. `price` and `price_inr` are kept identical: different code
-- paths read each one, and letting them drift is what caused defect 1 above.
update public.hireveri_plans
   set price = 14999, price_inr = 14999, price_usd =  199, price_gbp =  159, price_eur =  179
 where slug = 'starter';

update public.hireveri_plans
   set price = 24999, price_inr = 24999, price_usd =  349, price_gbp =  279, price_eur =  319
 where slug = 'growth';

update public.hireveri_plans
   set price = 49999, price_inr = 49999, price_usd =  599, price_gbp =  479, price_eur =  549
 where slug = 'scale';

update public.hireveri_plans
   set price = 89999, price_inr = 89999, price_usd = 1199, price_gbp =  949, price_eur = 1099
 where slug = 'expansion';

-- VERIS Screening add-ons: the largest pack becomes the best value everywhere.
update public.hireveri_plans
   set price =  999, price_inr =  999, price_usd = 15, price_gbp = 12, price_eur = 14
 where slug = 'screening-starter';

update public.hireveri_plans
   set price = 2999, price_inr = 2999, price_usd = 39, price_gbp = 31, price_eur = 36
 where slug = 'screening-growth';

update public.hireveri_plans
   set price = 5999, price_inr = 5999, price_usd = 79, price_gbp = 63, price_eur = 71
 where slug = 'screening-scale';

-- Post-check 1: price and price_inr must agree, in every plan.
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
  from public.hireveri_plans
  where "isActive" and price_inr is not null and price <> price_inr;

  if v_bad > 0 then
    raise exception 'POST_CHECK_FAILED: % plan(s) have price <> price_inr', v_bad;
  end if;
end $$;

-- Post-check 2: in every currency, a larger tier must never cost MORE per
-- interview than a smaller one. (A plateau is allowed; an inversion is not.)
-- The 0.1% tolerance absorbs the sub-unit rounding of prices like Rs 24,999 /
-- 100 = 249.99 against Rs 49,999 / 200 = 249.995, which are the same price to
-- any buyer, while still catching a real inversion such as Rs 15 -> Rs 16.
do $$
declare
  v_bad integer;
  v_currency text;
begin
  foreach v_currency in array array['price_inr', 'price_usd', 'price_gbp', 'price_eur'] loop
    execute format($f$
      select count(*) from (
        select %I::numeric / nullif("interviewLimit", 0) as per_unit,
               lag(%I::numeric / nullif("interviewLimit", 0)) over (order by "order") as prev
        from public.hireveri_plans
        where "planType" = 'INTERVIEW' and "isActive" and %I is not null
      ) t where prev is not null and per_unit > prev * 1.001
    $f$, v_currency, v_currency, v_currency) into v_bad;

    if v_bad > 0 then
      raise exception 'POST_CHECK_FAILED: % interview tier(s) invert on %', v_bad, v_currency;
    end if;
  end loop;
end $$;

-- Post-check 3: same rule for the screening add-on ladder, per currency.
do $$
declare
  v_bad integer;
  v_currency text;
begin
  foreach v_currency in array array['price_inr', 'price_usd', 'price_gbp', 'price_eur'] loop
    execute format($f$
      select count(*) from (
        select %I::numeric / nullif("screeningCredits", 0) as per_unit,
               lag(%I::numeric / nullif("screeningCredits", 0)) over (order by "order") as prev
        from public.hireveri_plans
        where "planType" = 'SCREENING' and "isActive" and %I is not null
      ) t where prev is not null and per_unit > prev * 1.001
    $f$, v_currency, v_currency, v_currency) into v_bad;

    if v_bad > 0 then
      raise exception 'POST_CHECK_FAILED: % screening pack(s) invert on %', v_bad, v_currency;
    end if;
  end loop;
end $$;

commit;

--------------------------------------------------------------------------------
-- ROLLBACK — restores the exact values captured from production on 2026-08-21.
-- Note this restores the price/price_inr mismatch on `scale`, which was the
-- live state before this ran.
--------------------------------------------------------------------------------
-- begin;
-- update public.hireveri_plans set price = 14999, price_inr = 14999, price_usd =  199, price_gbp = 159, price_eur =  179 where slug = 'starter';
-- update public.hireveri_plans set price = 24999, price_inr = 24999, price_usd =  349, price_gbp = 279, price_eur =  319 where slug = 'growth';
-- update public.hireveri_plans set price = 49999, price_inr = 39999, price_usd =  599, price_gbp = 479, price_eur =  549 where slug = 'scale';
-- update public.hireveri_plans set price = 89999, price_inr = 89999, price_usd = 1199, price_gbp = 949, price_eur = 1099 where slug = 'expansion';
-- update public.hireveri_plans set price =   999, price_inr =   999, price_usd =   15, price_gbp =  12, price_eur =   14 where slug = 'screening-starter';
-- update public.hireveri_plans set price =  2999, price_inr =  2999, price_usd =   39, price_gbp =  31, price_eur =   36 where slug = 'screening-growth';
-- update public.hireveri_plans set price =  7999, price_inr =  7999, price_usd =   99, price_gbp =  79, price_eur =   89 where slug = 'screening-scale';
-- commit;
