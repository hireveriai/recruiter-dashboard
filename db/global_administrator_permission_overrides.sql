-- Azure-style recruiter access control.
-- Roles provide defaults; Global Administrators can grant or revoke permissions per user.

insert into public.permissions (permission_code, description)
values
  ('ai.use', 'Use AI features'),
  ('alerts.view', 'View risk alerts'),
  ('billing.view', 'View billing and usage'),
  ('candidates.invite', 'Invite candidates'),
  ('candidates.view', 'View candidate list'),
  ('interviews.create', 'Create new interviews'),
  ('interviews.delete', 'Delete interviews'),
  ('interviews.edit', 'Edit interviews'),
  ('organization.settings', 'Manage organization settings'),
  ('reports.view', 'View reports and results'),
  ('users.manage', 'Manage team members'),
  ('warroom.analyze', 'Analyze interview deeply'),
  ('warroom.view', 'View interview forensic data')
on conflict (permission_code) do update
set description = excluded.description;

insert into public.recruiter_role_pool (recruiter_role_id, code, description)
values
  (1, 'Recruiter', 'Standard recruiter access'),
  (2, 'Hiring Manager', 'Hiring decision maker access'),
  (3, 'Global Administrator', 'Full workspace administration access')
on conflict (recruiter_role_id) do update
set
  code = excluded.code,
  description = excluded.description;

update public.hireveri_recruiter_roles
set name = 'Global Administrator'
where legacy_role_id = 3;

insert into public.role_permissions (recruiter_role_id, permission)
values
  (1, 'ai.use'),
  (1, 'alerts.view'),
  (1, 'candidates.invite'),
  (1, 'candidates.view'),
  (1, 'interviews.create'),
  (1, 'interviews.edit'),
  (1, 'reports.view'),
  (2, 'ai.use'),
  (2, 'alerts.view'),
  (2, 'candidates.invite'),
  (2, 'candidates.view'),
  (2, 'interviews.create'),
  (2, 'interviews.delete'),
  (2, 'interviews.edit'),
  (2, 'reports.view'),
  (2, 'warroom.view'),
  (3, 'ai.use'),
  (3, 'alerts.view'),
  (3, 'billing.view'),
  (3, 'candidates.invite'),
  (3, 'candidates.view'),
  (3, 'interviews.create'),
  (3, 'interviews.delete'),
  (3, 'interviews.edit'),
  (3, 'organization.settings'),
  (3, 'reports.view'),
  (3, 'users.manage'),
  (3, 'warroom.analyze'),
  (3, 'warroom.view')
on conflict (recruiter_role_id, permission) do nothing;

create table if not exists public.recruiter_user_permission_overrides (
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  user_id uuid not null references public.users(user_id) on delete cascade,
  permission_code text not null references public.permissions(permission_code) on delete cascade,
  is_granted boolean not null,
  updated_by uuid null references public.users(user_id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, permission_code)
);

create index if not exists idx_recruiter_user_permission_overrides_user
  on public.recruiter_user_permission_overrides (user_id, organization_id);

create or replace function public.fn_get_default_super_admin_role_id()
returns smallint
language plpgsql
as $$
declare
  v_role_id smallint;
begin
  select rrp.recruiter_role_id
  into v_role_id
  from public.recruiter_role_pool rrp
  where lower(coalesce(rrp.code, '')) in (
      'global administrator',
      'global_admin',
      'global-admin',
      'super_admin',
      'super-admin',
      'founder',
      'founder/ceo',
      'org_owner',
      'org-owner'
    )
     or lower(coalesce(rrp.code, '')) like '%global%admin%'
     or lower(coalesce(rrp.code, '')) like '%founder%'
     or lower(coalesce(rrp.code, '')) like '%owner%'
  order by
    case when lower(coalesce(rrp.code, '')) like '%global%admin%' then 0 else 1 end,
    rrp.recruiter_role_id
  limit 1;

  if v_role_id is null then
    select rp.recruiter_role_id
    into v_role_id
    from public.role_permissions rp
    group by rp.recruiter_role_id
    having bool_or(rp.permission = 'users.manage')
       and bool_or(rp.permission = 'organization.settings')
    order by rp.recruiter_role_id
    limit 1;
  end if;

  if v_role_id is null then
    raise exception 'DEFAULT_SUPER_ADMIN_ROLE_NOT_FOUND: no global administrator role seed found';
  end if;

  return v_role_id;
end;
$$;

create or replace function public.fn_recruiter_has_admin_permissions(
  p_user_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.recruiter_profiles rp
    cross join public.permissions permission_catalog
    left join public.role_permissions role_permission
      on role_permission.recruiter_role_id = rp.recruiter_role_id
      and role_permission.permission = permission_catalog.permission_code
    left join public.recruiter_user_permission_overrides user_permission
      on user_permission.user_id = rp.recruiter_id
      and user_permission.organization_id = rp.organization_id
      and user_permission.permission_code = permission_catalog.permission_code
    where rp.recruiter_id = p_user_id
      and rp.organization_id = p_organization_id
      and permission_catalog.permission_code in ('users.manage', 'organization.settings')
    group by rp.recruiter_id
    having bool_or(
      permission_catalog.permission_code = 'users.manage'
      and (
        (role_permission.permission is not null and coalesce(user_permission.is_granted, true) = true)
        or user_permission.is_granted = true
      )
    )
    and bool_or(
      permission_catalog.permission_code = 'organization.settings'
      and (
        (role_permission.permission is not null and coalesce(user_permission.is_granted, true) = true)
        or user_permission.is_granted = true
      )
    )
    limit 1
  );
$$;

create or replace function public.fn_organization_has_admin(
  p_organization_id uuid
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users u
    where u.organization_id = p_organization_id
      and u.role in ('RECRUITER', 'ADMIN', 'ORG_OWNER')
      and u.is_active = true
      and public.fn_recruiter_has_admin_permissions(u.user_id, u.organization_id)
    limit 1
  );
$$;

create or replace function public.fn_ensure_default_recruiter_profile(
  p_user_id uuid,
  p_organization_id uuid
)
returns smallint
language plpgsql
as $$
declare
  v_existing_profile boolean := false;
  v_existing_role_id smallint;
  v_company_name text;
  v_default_role_id smallint;
  v_should_admin boolean := false;
begin
  select true, rp.recruiter_role_id
  into v_existing_profile, v_existing_role_id
  from public.recruiter_profiles rp
  where rp.recruiter_id = p_user_id
    and rp.organization_id = p_organization_id
  limit 1;

  v_should_admin := not public.fn_organization_has_admin(p_organization_id)
    or public.fn_recruiter_has_admin_permissions(p_user_id, p_organization_id);

  if coalesce(v_existing_role_id, 0) > 0 and not v_should_admin then
    return v_existing_role_id;
  end if;

  v_default_role_id := public.fn_get_default_super_admin_role_id();

  select o.organization_name
  into v_company_name
  from public.organizations o
  where o.organization_id = p_organization_id
  limit 1;

  if v_existing_profile then
    update public.recruiter_profiles
    set
      recruiter_role_id = case
        when v_should_admin then v_default_role_id
        else coalesce(recruiter_role_id, v_default_role_id)
      end,
      company_name = coalesce(company_name, v_company_name, 'Organization'),
      organization_id = p_organization_id
    where recruiter_id = p_user_id
      and organization_id = p_organization_id;
  else
    insert into public.recruiter_profiles (
      recruiter_id,
      company_name,
      recruiter_role_id,
      organization_id
    )
    values (
      p_user_id,
      coalesce(v_company_name, 'Organization'),
      v_default_role_id,
      p_organization_id
    )
    on conflict (recruiter_id) do update
    set
      recruiter_role_id = case
        when not public.fn_organization_has_admin(excluded.organization_id) then excluded.recruiter_role_id
        else coalesce(public.recruiter_profiles.recruiter_role_id, excluded.recruiter_role_id)
      end,
      company_name = coalesce(public.recruiter_profiles.company_name, excluded.company_name),
      organization_id = excluded.organization_id;
  end if;

  select rp.recruiter_role_id
  into v_existing_role_id
  from public.recruiter_profiles rp
  where rp.recruiter_id = p_user_id
    and rp.organization_id = p_organization_id
  limit 1;

  return coalesce(v_existing_role_id, v_default_role_id);
end;
$$;

with admin_role as (
  select public.fn_get_default_super_admin_role_id() as role_id
),
adminless_orgs as (
  select o.organization_id
  from public.organizations o
  where not public.fn_organization_has_admin(o.organization_id)
),
first_users as (
  select distinct on (u.organization_id)
    u.user_id,
    u.organization_id,
    coalesce(o.organization_name, 'Organization') as company_name
  from public.users u
  inner join adminless_orgs ao
    on ao.organization_id = u.organization_id
  left join public.organizations o
    on o.organization_id = u.organization_id
  where u.role in ('RECRUITER', 'ADMIN', 'ORG_OWNER')
    and u.is_active = true
  order by u.organization_id, u.created_at asc nulls last, u.user_id
)
insert into public.recruiter_profiles (
  recruiter_id,
  company_name,
  recruiter_role_id,
  organization_id
)
select
  fu.user_id,
  fu.company_name,
  ar.role_id,
  fu.organization_id
from first_users fu
cross join admin_role ar
on conflict (recruiter_id) do update
set
  recruiter_role_id = excluded.recruiter_role_id,
  company_name = coalesce(public.recruiter_profiles.company_name, excluded.company_name),
  organization_id = excluded.organization_id;
