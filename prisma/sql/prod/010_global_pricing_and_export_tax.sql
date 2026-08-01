-- Global fixed pricing on the existing plan table plus cross-border tax evidence.
-- `price` remains the legacy INR compatibility column.
begin;

alter table public.hireveri_plans
  add column if not exists price_inr integer,
  add column if not exists price_usd integer;

update public.hireveri_plans
set price_inr = coalesce(price_inr, price),
    price_usd = coalesce(price_usd, case slug
      when 'starter' then 199
      when 'growth' then 349
      when 'scale' then 699
      when 'expansion' then 1299
      when 'screening-starter' then 15
      when 'screening-growth' then 29
      when 'screening-scale' then 99
      when 'practice-starter' then 5
      when 'practice-professional' then 12
      when 'practice-advanced' then 18
      when 'practice-career-accelerator' then 29
      else price
    end);

alter table public.hireveri_plans
  alter column price_inr set not null,
  alter column price_usd set not null;

alter table public.organizations
  add column if not exists billing_country_code char(2) not null default 'IN';

alter table public.coupons
  add column if not exists minimum_amount_currency char(3) not null default 'INR';

alter table public.hireveri_payments
  add column if not exists customer_country_code char(2) not null default 'IN',
  add column if not exists tax_treatment text not null default 'DOMESTIC_GST';

alter table public.invoices
  add column if not exists customer_country_code char(2) not null default 'IN',
  add column if not exists tax_treatment text not null default 'DOMESTIC_GST';

commit;
