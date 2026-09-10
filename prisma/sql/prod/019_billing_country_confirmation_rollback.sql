-- Rollback for 019_billing_country_confirmation.sql
--
-- Drops the confirmation timestamp. billing_country_code and every existing
-- value in it are untouched, so this restores the previous behaviour exactly:
-- unconfirmed organizations go back to being treated as Indian billing
-- customers by default. Only roll back with that in mind.

begin;

alter table public.organizations
  drop column if exists billing_country_confirmed_at;

commit;
