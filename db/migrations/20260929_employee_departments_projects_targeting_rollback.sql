-- Rollback for 20260929_employee_departments_projects_targeting.sql.
--
-- Drops only what that migration added. employees.full_name and
-- employees.department (free text) were kept in sync the whole time, so the
-- pre-existing flow keeps working after this runs. Department/project
-- membership and targeting history recorded in the dropped tables is lost;
-- the invites/attempts/results themselves are untouched.

begin;

drop index if exists public.uq_assessment_invites_assessment_employee;
alter table public.assessment_invites drop column if exists target_id;

drop table if exists public.assessment_targets;
drop table if exists public.employee_projects;

alter table public.employees drop constraint if exists employees_department_fk;
drop index if exists public.employees_org_department_idx;
drop index if exists public.uq_employees_org_code;
alter table public.employees drop constraint if exists uq_employees_org_id;
alter table public.employees
  drop column if exists employee_code,
  drop column if exists first_name,
  drop column if exists last_name,
  drop column if exists phone,
  drop column if exists department_id,
  drop column if exists joining_date;

drop table if exists public.projects;
drop table if exists public.departments;

commit;
