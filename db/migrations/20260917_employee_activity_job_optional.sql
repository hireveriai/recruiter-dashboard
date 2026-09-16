-- Employee Assessments/Challenges/Tasks must not require a Job
--
-- Product correction: a candidate activity asks "is this candidate suitable
-- for this open job?" (Job required). An employee activity asks "does this
-- existing employee have the required knowledge/skill/ability?" — there is
-- no inherent job to attach to, so Job must be optional, not required.
--
-- Loosens job_id to nullable on the four Assessment* tables that carry it.
-- Purely a constraint relaxation — no column removed/renamed/retyped, every
-- existing row already has job_id populated (from the pre-existing
-- candidate-only flow) and keeps working exactly as before.
--
-- Apply against: Verisnova-Production (qvhbtxionaquyyuktdsr)

begin;

alter table public.assessments alter column job_id drop not null;
alter table public.assessment_invites alter column job_id drop not null;
alter table public.assessment_attempts alter column job_id drop not null;
alter table public.assessment_results alter column job_id drop not null;

commit;
