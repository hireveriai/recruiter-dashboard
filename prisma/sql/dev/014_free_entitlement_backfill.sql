-- ============================================================================
-- 014_free_entitlement_backfill.sql
--
-- Grandfathers every pre-existing workspace so that the switch to
-- request/review/approval does not remove anything anybody already has.
--
-- Rules:
--   * balances are NEVER modified here. Whatever an organization has today it
--     still has after this migration.
--   * every organization that already has a workspace_trial_credits row gets a
--     retroactive APPROVED trial_request + trial_grant, marked as sourced from
--     this migration, so the audit trail can explain why they hold credits.
--   * organizations with an active paid subscription are recorded too; their
--     paid credits are read from hireveri_user_subscriptions and are entirely
--     unaffected by the trial system.
--   * practice candidates are intentionally NOT backfilled: they never had a
--     free practice entitlement, so there is nothing to preserve. They go
--     through the normal request flow like everyone else.
--
-- Run 012 and 013 first.
-- Rollback: 014_free_entitlement_backfill_rollback.sql
-- ============================================================================

begin;

-- 1. Retroactive request rows for every existing workspace.
with existing_workspaces as (
  select
    c.organization_id,
    o.organization_name,
    (
      select lower(coalesce(u.email, ''))
      from public.users u
      where u.organization_id = c.organization_id
        and u.role in ('ORG_OWNER', 'ADMIN', 'RECRUITER')
        and u.is_active = true
      order by
        case u.role when 'ORG_OWNER' then 0 when 'ADMIN' then 1 else 2 end,
        u.created_at asc
      limit 1
    ) as owner_email,
    c.created_at
  from public.workspace_trial_credits c
  join public.organizations o on o.organization_id = c.organization_id
  where not exists (
    select 1 from public.trial_requests r
    where r.request_type = 'RECRUITER_TRIAL'
      and r.subject_key = 'org:' || c.organization_id::text
  )
)
insert into public.trial_requests (
  request_type, status, subject_key, organization_id,
  contact_email, email_normalized, email_domain, email_verified,
  company_name,
  risk_score, risk_level, risk_reasons, validation,
  auto_decision, decided_at, decided_by, decision_reason,
  created_at, updated_at
)
select
  'RECRUITER_TRIAL',
  'APPROVED',
  'org:' || w.organization_id::text,
  w.organization_id,
  nullif(w.owner_email, ''),
  public.fn_normalize_email(w.owner_email),
  public.fn_email_domain(w.owner_email),
  true,
  w.organization_name,
  0,
  'LOW',
  array['pre_existing_workspace'],
  jsonb_build_object('backfill', true, 'reason', 'workspace_existed_before_request_flow'),
  false,
  now(),
  'migration:014',
  'grandfathered_existing_workspace',
  w.created_at,
  now()
from existing_workspaces w;

-- 2. Retroactive grants. The credits column values here are what the
--    organization was originally issued, not what it has left; the live
--    balance stays in workspace_trial_credits and is untouched.
insert into public.trial_grants (
  grant_key, request_id, request_type, organization_id,
  ai_interview_credits, veris_screening_credits, granted_at
)
select
  'RECRUITER_TRIAL:' || r.subject_key,
  r.request_id,
  'RECRUITER_TRIAL',
  r.organization_id,
  10,
  25,
  r.created_at
from public.trial_requests r
where r.request_type = 'RECRUITER_TRIAL'
  and r.decided_by = 'migration:014'
on conflict (grant_key) do nothing;

-- 3. Audit event for each grandfathered workspace.
insert into public.trial_request_events (request_id, from_status, to_status, actor, actor_type, reason, metadata)
select
  r.request_id,
  null,
  'APPROVED',
  'migration:014',
  'MIGRATION',
  'grandfathered_existing_workspace',
  jsonb_build_object(
    'interviewCreditsRemainingAtMigration', c.interview_credits_remaining,
    'screeningCreditsRemainingAtMigration', c.screening_credits_remaining
  )
from public.trial_requests r
join public.workspace_trial_credits c on c.organization_id = r.organization_id
where r.decided_by = 'migration:014';

-- 4. Reflect the approved state on the balance row. Balances stay as they are.
update public.workspace_trial_credits c
set trial_status = 'APPROVED',
    trial_request_id = r.request_id,
    trial_granted_at = coalesce(c.trial_granted_at, r.created_at),
    updated_at = now()
from public.trial_requests r
where r.organization_id = c.organization_id
  and r.decided_by = 'migration:014';

-- 5. Any organization row without a credits row (should not exist, but be
--    explicit) starts in the new NOT_REQUESTED state with zero credits.
insert into public.workspace_trial_credits (
  organization_id, interview_credits_remaining, screening_credits_remaining, trial_status
)
select o.organization_id, 0, 0, 'NOT_REQUESTED'
from public.organizations o
where not exists (
  select 1 from public.workspace_trial_credits c where c.organization_id = o.organization_id
)
on conflict (organization_id) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- Verification (run manually after applying; all three must return true)
-- ---------------------------------------------------------------------------
-- select count(*) = 0 as no_balances_changed
--   from public.workspace_trial_credits
--   where trial_status = 'APPROVED' and trial_granted_at is null;
--
-- select count(*) = (select count(*) from public.workspace_trial_credits)
--        as every_workspace_has_a_request
--   from public.trial_requests where request_type = 'RECRUITER_TRIAL';
--
-- select not exists (
--   select 1 from pg_trigger
--   where tgname = 'organizations_seed_workspace_trial_credits'
-- ) as auto_grant_trigger_removed;
