-- 022_lifecycle_email_deliveries.sql
--
-- VerisNova - idempotency/delivery log for the recruiter lifecycle emails
-- (trial requested/approved, subscription/bundle/addon activated). One row
-- per (email_type, dedupe_key): the insert is the lock, so a retried
-- request, a double-clicked admin approval, or a replayed /verify-payment
-- call can claim a send at most once.
--
-- This table is also created lazily and idempotently at runtime by
-- lib/server/lifecycle-email-log.ts (ensureLifecycleEmailSchema), matching
-- the self-healing convention already used for
-- organization_entitlement_overrides (020_organization_entitlements.sql).
-- This migration exists for parity/documentation - applying it is not
-- required for the feature to work.
--
-- SAFETY
--   * Purely additive. No DROP, no DELETE, no UPDATE of existing rows.
--   * Idempotent - safe to re-run (create table if not exists).
--   * Rollback: 022_lifecycle_email_deliveries_rollback.sql
--
-- Apply against: Verisnova-Production (qvhbtxionaquyyuktdsr)

begin;

create table if not exists public.lifecycle_email_deliveries (
  delivery_id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(organization_id) on delete set null,
  email_type text not null,
  dedupe_key text not null,
  status text not null default 'PENDING',
  sent_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  unique (email_type, dedupe_key)
);

commit;
