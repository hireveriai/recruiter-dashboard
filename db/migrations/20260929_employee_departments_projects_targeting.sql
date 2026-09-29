-- Internal Employees -> Departments -> Projects -> Assessment Targeting
--
-- NOT YET APPLIED to any shared database. Written for the shared production
-- database (Supabase "Verisnova-Production", qvhbtxionaquyyuktdsr), to be
-- applied only after explicit confirmation, exactly like
-- 20260916_employee_activities.sql. Rollback:
-- 20260929_employee_departments_projects_targeting_rollback.sql.
--
-- Builds on 20260916_employee_activities.sql rather than duplicating it:
--   * public.employees is extended, not replaced. full_name and the free-text
--     department column stay and are kept in sync by the recruiter app, so
--     every existing reader (the assessment app, invitation emails, results
--     pages) keeps working unmodified.
--   * public.assessment_invites already IS the per-employee assignment row
--     (assessment_id, employee_id, status, expires_at = due date,
--     completed_at) and assessment_results already holds score/pass, so no
--     second "assignment" table is created. assessment_targets only records
--     HOW a batch of invites was targeted (department / project / both /
--     individual), for audit and for the dashboard's "Target" column.
--
-- Tenant isolation is enforced in the database, not just the app: every new
-- link carries organization_id and uses a composite (organization_id, id)
-- foreign key, so an employee can never be attached to another
-- organization's department or project even by a buggy query.
--
-- Everything is additive. No column is dropped, renamed or re-typed; every
-- new column is nullable or defaulted. The only statement that can fail on
-- existing data is the duplicate-invite unique index in step 6, which is
-- guarded by an explicit pre-check with a readable error (the whole
-- transaction then rolls back and nothing is changed).

begin;

-- 1. departments ------------------------------------------------------------
create table if not exists public.departments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  name             text not null,
  description      text,
  status           text not null default 'ACTIVE',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint departments_status_check check (status in ('ACTIVE', 'INACTIVE')),
  constraint departments_name_not_blank check (length(btrim(name)) > 0),
  -- Target of the composite tenant FKs below. Leads with organization_id, so
  -- it also serves "all departments in this org" lookups.
  constraint uq_departments_org_id unique (organization_id, id)
);

-- Case-insensitive: "Engineering" and "engineering" are the same department.
create unique index if not exists uq_departments_org_name
  on public.departments (organization_id, lower(name));

-- 2. projects ---------------------------------------------------------------
create table if not exists public.projects (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  name             text not null,
  code             text,
  description      text,
  status           text not null default 'ACTIVE',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint projects_status_check check (status in ('ACTIVE', 'INACTIVE')),
  constraint projects_name_not_blank check (length(btrim(name)) > 0),
  constraint uq_projects_org_id unique (organization_id, id)
);

create unique index if not exists uq_projects_org_name
  on public.projects (organization_id, lower(name));
create unique index if not exists uq_projects_org_code
  on public.projects (organization_id, lower(code))
  where code is not null;

-- 3. employees: new profile fields + primary department ---------------------
alter table public.employees
  add column if not exists employee_code  text,
  add column if not exists first_name     text,
  add column if not exists last_name      text,
  add column if not exists phone          text,
  add column if not exists department_id  uuid,
  add column if not exists joining_date   date;

alter table public.employees
  add constraint uq_employees_org_id unique (organization_id, id);

-- Composite FK: the department must belong to the employee's organization.
-- MATCH SIMPLE (the default) skips the check while department_id is null.
alter table public.employees
  add constraint employees_department_fk
    foreign key (organization_id, department_id)
    references public.departments (organization_id, id)
    on delete restrict;

create unique index if not exists uq_employees_org_code
  on public.employees (organization_id, employee_code)
  where employee_code is not null;

-- Department filter / count / targeting.
create index if not exists employees_org_department_idx
  on public.employees (organization_id, department_id);

-- 4. employee_projects: many-to-many ----------------------------------------
create table if not exists public.employee_projects (
  organization_id  uuid not null,
  employee_id      uuid not null,
  project_id       uuid not null,
  created_at       timestamptz not null default now(),
  -- Leads with (organization_id, project_id): serves project member lists,
  -- project counts and project targeting.
  constraint employee_projects_pkey primary key (organization_id, project_id, employee_id),
  -- Link rows are derived data: removing an employee or project removes its
  -- links. Assessment history lives on assessment_invites/results and is
  -- never touched by these cascades.
  constraint employee_projects_employee_fk
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id)
    on delete cascade,
  constraint employee_projects_project_fk
    foreign key (organization_id, project_id)
    references public.projects (organization_id, id)
    on delete cascade
);

-- Employee -> projects lookups, and the employee FK's cascade.
create index if not exists employee_projects_org_employee_idx
  on public.employee_projects (organization_id, employee_id);

-- 5. assessment_targets: how a batch of invites was targeted ----------------
create table if not exists public.assessment_targets (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null,
  assessment_id           uuid not null references public.assessments (id) on delete cascade,
  target_type             text not null,
  department_id           uuid,
  project_id              uuid,
  -- Snapshot at send time, so history stays meaningful after people move.
  matched_count           integer not null default 0,
  already_assigned_count  integer not null default 0,
  assigned_count          integer not null default 0,
  created_by              uuid,
  created_at              timestamptz not null default now(),
  constraint assessment_targets_type_check
    check (target_type in ('INDIVIDUAL', 'DEPARTMENT', 'PROJECT', 'DEPARTMENT_PROJECT')),
  constraint assessment_targets_shape_check check (
    (target_type = 'INDIVIDUAL'         and department_id is null     and project_id is null)
    or (target_type = 'DEPARTMENT'         and department_id is not null and project_id is null)
    or (target_type = 'PROJECT'            and department_id is null     and project_id is not null)
    or (target_type = 'DEPARTMENT_PROJECT' and department_id is not null and project_id is not null)
  ),
  constraint assessment_targets_department_fk
    foreign key (organization_id, department_id)
    references public.departments (organization_id, id)
    on delete restrict,
  constraint assessment_targets_project_fk
    foreign key (organization_id, project_id)
    references public.projects (organization_id, id)
    on delete restrict
);

create index if not exists assessment_targets_assessment_id_idx
  on public.assessment_targets (assessment_id);

-- 6. assessment_invites: link to the target + duplicate protection ----------
alter table public.assessment_invites
  add column if not exists target_id uuid
    references public.assessment_targets (id) on delete set null;

-- The existing single-employee invite route had no duplicate check, so
-- refuse (and roll back) rather than silently cancel real invites.
do $$
declare
  duplicate_pairs integer;
begin
  select count(*) into duplicate_pairs
  from (
    select assessment_id, employee_id
    from public.assessment_invites
    where employee_id is not null and status <> 'CANCELLED'
    group by assessment_id, employee_id
    having count(*) > 1
  ) d;

  if duplicate_pairs > 0 then
    raise exception
      'assessment_invites has % (assessment_id, employee_id) pair(s) with more than one non-cancelled invite. '
      'Review them with: select assessment_id, employee_id, array_agg(id order by created_at), array_agg(status order by created_at) '
      'from public.assessment_invites where employee_id is not null and status <> ''CANCELLED'' '
      'group by 1, 2 having count(*) > 1; then set status = ''CANCELLED'' on the extra, never-started ones and re-run.',
      duplicate_pairs;
  end if;
end $$;

-- One live invite per employee per assessment. Cancelled invites don't
-- count, so an invite can be cancelled and re-issued. Also serves the
-- (assessment_id, employee_id) "already assigned?" lookups.
create unique index if not exists uq_assessment_invites_assessment_employee
  on public.assessment_invites (assessment_id, employee_id)
  where employee_id is not null and status <> 'CANCELLED';

-- 7. Backfill ----------------------------------------------------------------
-- 7a. One department per distinct (case-insensitive) free-text department,
--     named with the earliest employee's spelling.
insert into public.departments (organization_id, name)
select organization_id,
       (array_agg(btrim(department) order by created_at, btrim(department) collate "C"))[1]
from public.employees
where department is not null and btrim(department) <> ''
group by organization_id, lower(btrim(department))
on conflict do nothing;

update public.employees e
set department_id = d.id
from public.departments d
where e.department_id is null
  and e.department is not null
  and d.organization_id = e.organization_id
  and lower(d.name) = lower(btrim(e.department));

-- 7b. Split full_name into first/last (first word / remainder).
update public.employees
set first_name = split_part(btrim(full_name), ' ', 1),
    last_name  = nullif(btrim(substr(btrim(full_name), length(split_part(btrim(full_name), ' ', 1)) + 1)), '')
where first_name is null;

-- 8. Permissions: projects/departments are managed under the existing
--    employees.* codes (no new permission codes needed).

commit;
