-- ============================================================================
-- VerisNova rebrand: rename the nine legacy `hireveri_*` tables.
--
-- STATUS: NOT APPLIED. Prepared 2026-08-22 for review.
--
-- READ THIS FIRST
-- ---------------
-- These table names are internal identifiers. No candidate, recruiter, or
-- email ever sees them, so renaming them delivers zero brand benefit while
-- touching live billing data (hireveri_payments, hireveri_user_subscriptions).
-- The recommendation is to NOT run this. It exists so the option is costed.
--
-- If it is run, Step 1 alone is NOT safe: every app queries these names in
-- raw SQL and via Prisma @@map. Step 1 + Step 2 together are safe, because
-- the compatibility views keep the old names resolving while the apps are
-- redeployed one at a time. Only run Step 3 once every app is on new code.
--
-- Single-table views like these are auto-updatable in Postgres, so INSERT /
-- UPDATE / DELETE against the old names continue to work during rollout.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Step 1: rename the tables.
-- ---------------------------------------------------------------------------
alter table public.hireveri_company_sizes      rename to verisnova_company_sizes;
alter table public.hireveri_countries          rename to verisnova_countries;
alter table public.hireveri_demo_leads         rename to verisnova_demo_leads;
alter table public.hireveri_industries         rename to verisnova_industries;
alter table public.hireveri_payments           rename to verisnova_payments;
alter table public.hireveri_plans              rename to verisnova_plans;
alter table public.hireveri_recruiter_roles    rename to verisnova_recruiter_roles;
alter table public.hireveri_usage              rename to verisnova_usage;
alter table public.hireveri_user_subscriptions rename to verisnova_user_subscriptions;

-- ---------------------------------------------------------------------------
-- Step 2: compatibility views under the OLD names, so not-yet-redeployed
-- apps keep working. Run in the same transaction as Step 1.
-- ---------------------------------------------------------------------------
create view public.hireveri_company_sizes      as select * from public.verisnova_company_sizes;
create view public.hireveri_countries          as select * from public.verisnova_countries;
create view public.hireveri_demo_leads         as select * from public.verisnova_demo_leads;
create view public.hireveri_industries         as select * from public.verisnova_industries;
create view public.hireveri_payments           as select * from public.verisnova_payments;
create view public.hireveri_plans              as select * from public.verisnova_plans;
create view public.hireveri_recruiter_roles    as select * from public.verisnova_recruiter_roles;
create view public.hireveri_usage              as select * from public.verisnova_usage;
create view public.hireveri_user_subscriptions as select * from public.verisnova_user_subscriptions;

commit;

-- ---------------------------------------------------------------------------
-- Step 3: ONLY after every app (auth, calm-room, candidate-dashboard,
-- hireveri-recruiter, landing-page, war-room) is redeployed against the new
-- names. Verify with the "orphan check" query at the bottom first.
-- ---------------------------------------------------------------------------
-- begin;
-- drop view public.hireveri_company_sizes;
-- drop view public.hireveri_countries;
-- drop view public.hireveri_demo_leads;
-- drop view public.hireveri_industries;
-- drop view public.hireveri_payments;
-- drop view public.hireveri_plans;
-- drop view public.hireveri_recruiter_roles;
-- drop view public.hireveri_usage;
-- drop view public.hireveri_user_subscriptions;
-- commit;


-- ============================================================================
-- ROLLBACK (undoes Steps 1 and 2; run before Step 3)
-- ============================================================================
-- begin;
-- drop view if exists public.hireveri_company_sizes;
-- drop view if exists public.hireveri_countries;
-- drop view if exists public.hireveri_demo_leads;
-- drop view if exists public.hireveri_industries;
-- drop view if exists public.hireveri_payments;
-- drop view if exists public.hireveri_plans;
-- drop view if exists public.hireveri_recruiter_roles;
-- drop view if exists public.hireveri_usage;
-- drop view if exists public.hireveri_user_subscriptions;
--
-- alter table public.verisnova_company_sizes      rename to hireveri_company_sizes;
-- alter table public.verisnova_countries          rename to hireveri_countries;
-- alter table public.verisnova_demo_leads         rename to hireveri_demo_leads;
-- alter table public.verisnova_industries         rename to hireveri_industries;
-- alter table public.verisnova_payments           rename to hireveri_payments;
-- alter table public.verisnova_plans              rename to hireveri_plans;
-- alter table public.verisnova_recruiter_roles    rename to hireveri_recruiter_roles;
-- alter table public.verisnova_usage              rename to hireveri_usage;
-- alter table public.verisnova_user_subscriptions rename to hireveri_user_subscriptions;
-- commit;


-- ============================================================================
-- Pre-flight row counts (2026-08-22) — compare after Step 1 to confirm no loss:
--   hireveri_company_sizes        5
--   hireveri_countries          195
--   hireveri_demo_leads           7
--   hireveri_industries          10
--   hireveri_payments             6
--   hireveri_plans               12
--   hireveri_recruiter_roles      6
--   hireveri_usage                0
--   hireveri_user_subscriptions   3
--
-- Orphan check before Step 3 — anything still depending on the old names:
--   select dependent_ns.nspname, dependent.relname
--   from pg_depend d
--   join pg_rewrite r on r.oid = d.objid
--   join pg_class dependent on dependent.oid = r.ev_class
--   join pg_namespace dependent_ns on dependent_ns.oid = dependent.relnamespace
--   join pg_class referenced on referenced.oid = d.refobjid
--   where referenced.relname like 'hireveri\_%';
-- ============================================================================
