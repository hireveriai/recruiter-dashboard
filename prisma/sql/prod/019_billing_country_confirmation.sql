-- ============================================================================
-- 019_billing_country_confirmation.sql
--
-- Separates "we know this organization's billing country" from "the column has
-- a value in it".
--
-- THE PROBLEM
--   organizations.billing_country_code was added by migration 010 as
--   `not null default 'IN'`, and is only ever written by the Billing Settings
--   form. Nothing sets it at signup. So every organization that has not opened
--   that form reads back as an Indian billing customer.
--
--   calculateQuote() keys tax treatment off exactly that column, so a US, UK
--   or EU buyer went through checkout as DOMESTIC_GST and was charged 18%
--   Indian GST on a USD/GBP/EUR amount — $349 became $411.82 — with the
--   invoice stamped customer_country_code = 'IN' for a customer who is not in
--   India.
--
-- THE FIX
--   A nullable confirmation timestamp. Tax is only calculated from the stored
--   billing country once someone has actually asserted it; until then the
--   application treats the country as unconfirmed and refuses to create a
--   Razorpay order. Nothing infers a legal/tax country from a geo IP.
--
-- What is deliberately NOT done here:
--   * billing_country_code is NOT made nullable. It keeps its default so every
--     existing read path and insert keeps working unchanged; the new column is
--     what carries "is this trustworthy", which is the question that was
--     actually missing.
--   * No tax rules are added or changed. GST percentage, the LUT export
--     switch and the three tax treatments are all exactly as they were.
--
-- Rollback: 019_billing_country_confirmation_rollback.sql
-- ============================================================================

begin;

alter table public.organizations
  add column if not exists billing_country_confirmed_at timestamptz;

comment on column public.organizations.billing_country_confirmed_at is
  'When a human last asserted billing_country_code for this organization. Null means the column still holds its default and must not be used to calculate tax.';

-- ---------------------------------------------------------------------------
-- Backfill.
--
-- An organization that has saved a billing profile went through the Billing
-- Settings form, and that form requires billing country — so those values were
-- explicitly chosen rather than defaulted. gst_number / billing_address are
-- only ever written by that same form, so either being present is evidence the
-- form was submitted.
--
-- Deliberately narrow: an organization with a non-'IN' country could only have
-- got there through the form, so it is included too. Everything else stays
-- null and will be asked to confirm at checkout.
-- ---------------------------------------------------------------------------

update public.organizations
   set billing_country_confirmed_at = coalesce(updated_at, now())
 where billing_country_confirmed_at is null
   and (
     nullif(btrim(coalesce(gst_number, '')), '') is not null
     or nullif(btrim(coalesce(billing_address, '')), '') is not null
     or upper(btrim(billing_country_code)) <> 'IN'
   );

commit;

-- ---------------------------------------------------------------------------
-- Verification (run after applying)
-- ---------------------------------------------------------------------------
-- select
--   count(*) filter (where billing_country_confirmed_at is not null) as confirmed,
--   count(*) filter (where billing_country_confirmed_at is null)     as needs_confirmation
-- from public.organizations
-- where is_active = true;
--
-- Organizations in the second bucket are the ones that were silently being
-- taxed as Indian. They are now asked once, at checkout.
