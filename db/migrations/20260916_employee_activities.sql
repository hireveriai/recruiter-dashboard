-- Employee Assessments / Challenges / Tasks
--
-- APPLIED to the shared production database (Supabase project
-- qvhbtxionaquyyuktdsr, "Verisnova-Production") on 2026-09-16 via the
-- Supabase migration tool (migration name:
-- employee_assessments_challenges_tasks), after explicit confirmation. Kept
-- here for the audit trail, matching the convention that schema.prisma files
-- only *describe* tables in this repo (no Prisma migrate/db push workflow
-- exists here — see assessment/prisma/schema.prisma's header comment).
--
-- Every change below is additive or loosens a NOT NULL constraint — nothing
-- here removes, renames, or re-types an existing column, and every new
-- column has a default (or is nullable) so existing rows and existing
-- application code keep working unmodified.

begin;

-- 1. assessments: activity type + participant type + free-form skill tags
alter table public.assessments
  add column if not exists activity_type    text not null default 'ASSESSMENT',
  add column if not exists participant_type text not null default 'CANDIDATE',
  add column if not exists skills           text[] not null default '{}';

alter table public.assessments
  add constraint assessments_activity_type_check
    check (activity_type in ('ASSESSMENT', 'CHALLENGE', 'TASK')) not valid;
alter table public.assessments
  add constraint assessments_participant_type_check
    check (participant_type in ('CANDIDATE', 'EMPLOYEE')) not valid;

create index if not exists assessments_org_activity_participant_idx
  on public.assessments (organization_id, activity_type, participant_type);

-- 2. employees — new, standalone entity. NOT a candidate, NOT a
--    organization_memberships row. See recruiter-dashboard/prisma/schema.prisma
--    for the reasoning.
create table if not exists public.employees (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  full_name         text not null,
  email             text not null,
  manager_user_id   uuid,
  department        text,
  title             text,
  status            text not null default 'ACTIVE',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint uq_employees_org_email unique (organization_id, email)
);

create index if not exists employees_organization_id_idx on public.employees (organization_id);
create index if not exists employees_manager_user_id_idx on public.employees (manager_user_id);

-- 3. assessment_invites / assessment_attempts / assessment_results:
--    loosen candidate_id to nullable, add nullable employee_id. Exactly one
--    of the two is populated per row, enforced by the CHECK constraints
--    below (not by apps that predate this change, which always set
--    candidate_id and never employee_id, so they remain valid).
alter table public.assessment_invites
  alter column candidate_id drop not null,
  add column if not exists employee_id uuid;
alter table public.assessment_invites
  add constraint assessment_invites_participant_check
    check (
      (candidate_id is not null and employee_id is null)
      or (candidate_id is null and employee_id is not null)
    ) not valid;
create index if not exists assessment_invites_employee_id_idx on public.assessment_invites (employee_id);

alter table public.assessment_attempts
  alter column candidate_id drop not null,
  add column if not exists employee_id uuid;
alter table public.assessment_attempts
  add constraint assessment_attempts_participant_check
    check (
      (candidate_id is not null and employee_id is null)
      or (candidate_id is null and employee_id is not null)
    ) not valid;
create index if not exists assessment_attempts_employee_id_idx on public.assessment_attempts (employee_id);

alter table public.assessment_results
  alter column candidate_id drop not null,
  add column if not exists employee_id uuid;
alter table public.assessment_results
  add constraint assessment_results_participant_check
    check (
      (candidate_id is not null and employee_id is null)
      or (candidate_id is null and employee_id is not null)
    ) not valid;
create index if not exists assessment_results_employee_id_idx on public.assessment_results (employee_id);

-- 4. assessment_answer_evaluations: manager-review fields, additive only.
--    The AI-written columns (score/feedback/provider/model/status) are
--    never touched by this migration or by the manager-review code path —
--    manager input is stored in these new columns so the original AI
--    evaluation is always preserved.
alter table public.assessment_answer_evaluations
  add column if not exists evaluator_type       text not null default 'AI',
  add column if not exists evaluator_user_id    uuid,
  add column if not exists manager_score        numeric(6,2),
  add column if not exists manager_feedback     text,
  add column if not exists manager_evaluated_at timestamptz;

alter table public.assessment_answer_evaluations
  add constraint assessment_answer_evaluations_evaluator_type_check
    check (evaluator_type in ('AI', 'MANAGER')) not valid;

-- 5. Permission codes for the new Employee Activities feature, granted to
--    the same recruiter roles that already hold the equivalent
--    assessments.* permissions (verified against production on 2026-09-16:
--    role 1 "Recruiter", role 2 "Hiring Manager", role 3 "Global
--    Administrator" all hold assessments.create/edit/publish/send/view/
--    view_results; only roles 2 and 3 additionally hold assessments.manage).
--    employeeActivities.review and employeeActivities.manage are
--    deliberately withheld from plain "Recruiter" (role 1), consistent with
--    that same existing pattern, so ordinary recruiters cannot perform
--    manager reviews or see org-wide employee results by default.
insert into public.permissions (permission_code, description) values
  ('employees.view', 'View employee records'),
  ('employees.create', 'Create employee records'),
  ('employees.edit', 'Edit employee records'),
  ('employeeActivities.view', 'View employee assessments/challenges/tasks'),
  ('employeeActivities.create', 'Create employee assessments/challenges/tasks'),
  ('employeeActivities.edit', 'Edit employee assessments/challenges/tasks'),
  ('employeeActivities.assign', 'Assign an employee activity to an employee'),
  ('employeeActivities.view_results', 'View employee activity results'),
  ('employeeActivities.review', 'Submit a manager review/score override on an employee activity result'),
  ('employeeActivities.manage', 'Manage all employee activities and results org-wide (not scoped to direct reports)')
on conflict (permission_code) do nothing;

insert into public.role_permissions (recruiter_role_id, permission)
select r.recruiter_role_id, p.permission
from (values (1), (2), (3)) as r(recruiter_role_id)
cross join (values
  ('employees.view'), ('employees.create'), ('employees.edit'),
  ('employeeActivities.view'), ('employeeActivities.create'), ('employeeActivities.edit'),
  ('employeeActivities.assign'), ('employeeActivities.view_results')
) as p(permission)
on conflict (recruiter_role_id, permission) do nothing;

insert into public.role_permissions (recruiter_role_id, permission)
select r.recruiter_role_id, p.permission
from (values (2), (3)) as r(recruiter_role_id)
cross join (values ('employeeActivities.review'), ('employeeActivities.manage')) as p(permission)
on conflict (recruiter_role_id, permission) do nothing;

commit;

-- Deliberately not included in this migration (out of MVP scope, see the
-- implementation report):
--   * employee_identity_links / any employee login table — MVP employee
--     participation is invite-token only, exactly like candidates today, so
--     no identity/session table is needed yet.
--   * assessment_submission_files — file/screenshot submissions were not
--     implemented in this pass; add this table only when that work starts.
--   * Validating the NOT VALID check constraints added above (`VALIDATE
--     CONSTRAINT ...`) — left NOT VALID deliberately so this migration does
--     not need to scan/lock existing large tables; a follow-up
--     maintenance migration can VALIDATE CONSTRAINT once confirmed safe.
