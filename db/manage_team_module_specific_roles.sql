-- Hiring Manager / Recruitment Operations / People Operations exist in
-- hireveri_recruiter_roles but had no permission mapping at all, so the
-- manage-team role dropdown always excluded them regardless of an org's
-- entitlements. Each is scoped to the module its name implies, so it only
-- becomes selectable once the org's subscription includes that module (see
-- lib/server/entitlements.ts / app/api/manage-team/route.ts's
-- getPermissionEntitlement filtering).
--
-- recruiter_role_pool.code has a unique constraint and already holds a
-- legacy "Hiring Manager" row under a different id (id 2, from an older
-- naming scheme). The display label actually shown to recruiters always
-- comes from hireveri_recruiter_roles.name (see roleNameExpression in
-- app/api/manage-team/route.ts), so these pool rows only need to exist to
-- satisfy the availability join -- their `code` value is not user-facing.
insert into public.recruiter_role_pool (recruiter_role_id, code, description)
values
  (4, 'role_4_hiring_manager', 'Owns AI Interview scheduling and review'),
  (5, 'role_5_recruitment_operations', 'Runs VERIS Screening workflows'),
  (6, 'role_6_people_operations', 'Manages Employee Assessments, Challenges, and Tasks')
on conflict (recruiter_role_id) do update
set
  code = excluded.code,
  description = excluded.description;

insert into public.role_permissions (recruiter_role_id, permission)
values
  -- Hiring Manager: core + AI Interview
  (4, 'candidates.invite'),
  (4, 'candidates.view'),
  (4, 'reports.view'),
  (4, 'alerts.view'),
  (4, 'interviews.create'),
  (4, 'interviews.edit'),
  (4, 'interviews.delete'),
  (4, 'warroom.view'),
  -- Recruitment Operations: core + Screening
  (5, 'candidates.invite'),
  (5, 'candidates.view'),
  (5, 'reports.view'),
  (5, 'alerts.view'),
  (5, 'ai.use'),
  -- People Operations: core + Employee Activities
  (6, 'reports.view'),
  (6, 'alerts.view'),
  (6, 'employees.view'),
  (6, 'employees.create'),
  (6, 'employees.edit'),
  (6, 'employeeActivities.view'),
  (6, 'employeeActivities.create'),
  (6, 'employeeActivities.edit'),
  (6, 'employeeActivities.assign'),
  (6, 'employeeActivities.view_results')
on conflict (recruiter_role_id, permission) do nothing;
