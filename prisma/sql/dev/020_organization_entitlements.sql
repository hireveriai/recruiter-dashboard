-- Centralized module entitlements. These flags represent "does this
-- organization's subscription include this product module at all" and are
-- deliberately separate from the *_credits columns (which only track
-- remaining usage). A module stays enabled even after its credits are spent;
-- it only becomes disabled if the org never purchased it, or an admin
-- explicitly overrides it via organization_entitlement_overrides.
alter table public.hireveri_user_subscriptions
  add column if not exists screening_enabled boolean not null default false,
  add column if not exists assessment_enabled boolean not null default false,
  add column if not exists interview_enabled boolean not null default false;

-- Backfill from the plan attached to each existing subscription so current
-- paying orgs are not locked out of what they already bought. Addon-only
-- grants (e.g. a screening addon bought on top of an INTERVIEW base plan)
-- are additive from here on via the application code that activates
-- payments; this backfill only knows about the base plan on file today.
update public.hireveri_user_subscriptions s
set
  screening_enabled = s.screening_enabled or p."planType" in ('SCREENING', 'BUNDLE'),
  assessment_enabled = s.assessment_enabled or p."planType" in ('ASSESSMENT', 'BUNDLE'),
  interview_enabled = s.interview_enabled or p."planType" in ('INTERVIEW', 'BUNDLE')
from public.hireveri_plans p
where p.id = s."planId";

-- A subscription that has ever accumulated screening/assessment credits
-- (e.g. via an addon purchase) has clearly purchased that module even if the
-- flag above missed it because the addon isn't the subscription's planId.
update public.hireveri_user_subscriptions
set screening_enabled = true
where screening_enabled = false
  and coalesce("screeningCredits", 0) > 0;

update public.hireveri_user_subscriptions
set assessment_enabled = true
where assessment_enabled = false
  and coalesce("assessmentCredits", 0) > 0;

-- Manual per-organization entitlement overrides. Lets a platform admin grant
-- (promo/goodwill) or revoke a module for a specific org independent of its
-- billing state, without inventing a second subscription system: this only
-- ever overrides the plan-derived defaults, it never replaces them.
create table if not exists public.organization_entitlement_overrides (
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  entitlement_code text not null,
  is_enabled boolean not null,
  updated_by uuid null references public.users(user_id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, entitlement_code)
);

create index if not exists idx_organization_entitlement_overrides_org
  on public.organization_entitlement_overrides (organization_id);
