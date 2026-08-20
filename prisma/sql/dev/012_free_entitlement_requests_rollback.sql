-- ============================================================================
-- Rollback for 012 / 013 / 014.
--
-- Restores the pre-migration behaviour: automatic 10 + 25 on organization
-- creation, and no request/grant tables.
--
-- Existing balances in workspace_trial_credits are left exactly as they are.
-- ============================================================================

begin;

-- 1. Drop the entitlement functions.
drop function if exists public.fn_get_candidate_practice_state(uuid);
drop function if exists public.fn_get_recruiter_trial_state(uuid);
drop function if exists public.fn_reject_trial_request(uuid, text, text);
drop function if exists public.fn_approve_trial_request(uuid, text, text);
drop function if exists public.fn_request_candidate_practice(uuid, text, boolean, text, text, text);
drop function if exists public.fn_request_recruiter_trial(uuid, uuid, text, boolean, text, text, text, text, text);
drop function if exists public.fn_apply_trial_grant(uuid);
drop function if exists public.fn_log_trial_request_event(uuid, text, text, text, text, text, jsonb);
drop function if exists public.fn_company_matches_domain(text, text);
drop function if exists public.fn_email_domain_kind(text);
drop function if exists public.fn_website_domain(text);
drop function if exists public.fn_normalize_email(text);
drop function if exists public.fn_email_domain(text);
drop function if exists public.fn_free_entitlement_config();

-- 2. Drop the request/grant/audit tables.
drop table if exists public.trial_request_events;
drop table if exists public.trial_grants;
drop table if exists public.trial_requests;
drop table if exists public.platform_admins;
drop table if exists public.email_domain_reputation;

-- 3. Remove the status columns added to the balance table.
alter table public.workspace_trial_credits
  drop constraint if exists workspace_trial_credits_status_check;

alter table public.workspace_trial_credits
  drop column if exists trial_status,
  drop column if exists trial_request_id,
  drop column if exists trial_granted_at,
  drop column if exists trial_expires_at;

-- 4. Restore the automatic grant defaults and trigger.
alter table public.workspace_trial_credits
  alter column interview_credits_remaining set default 10,
  alter column screening_credits_remaining set default 25;

create or replace function public.ensure_workspace_trial_credits()
returns trigger
language plpgsql
as $ensure_wtc_rollback$
begin
  insert into public.workspace_trial_credits (
    organization_id,
    interview_credits_remaining,
    screening_credits_remaining
  )
  values (new.organization_id, 10, 25)
  on conflict (organization_id) do nothing;

  return new;
end;
$ensure_wtc_rollback$;

drop trigger if exists organizations_seed_workspace_trial_credits on public.organizations;
create trigger organizations_seed_workspace_trial_credits
  after insert on public.organizations
  for each row
  execute function public.ensure_workspace_trial_credits();

-- 5. Retire the free practice plan (kept, deactivated, so historical
--    subscriptions referencing it keep their foreign key).
update public.hireveri_plans set "isActive" = false where id = 'practice-free-trial';

commit;
