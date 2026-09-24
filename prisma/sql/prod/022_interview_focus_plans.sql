-- 022_interview_focus_plans.sql
--
-- VerisNova - Phase 2: versioned Interview Focus plans.
--
-- A focus plan says which competencies a job's interview should COVER and in
-- what proportion. It drives question generation only; it is not a scoring
-- weight (scoring_weight is reserved and unused).
--
-- ROLE-AGNOSTIC BY DESIGN. Competencies are generic (communication, judgement,
-- role knowledge, ...). Nothing here assumes an industry or profession.
--
-- VERSIONING
--   DRAFT      editable; at most one per job + stage.
--   ACTIVE     used for new generation; at most one per job + stage; immutable.
--   SUPERSEDED a previous ACTIVE plan; immutable, kept so questionnaire
--              versions that reference it stay reproducible.
--   stage_key is 'primary' for now; it exists so later interview stages
--   (screen, panel, VERIS Live) can each carry their own plan.
--
-- SAFETY
--   * Purely additive: two new tables, two nullable columns. No DROP, no
--     DELETE, no UPDATE of existing rows, no backfill.
--   * Idempotent - safe to re-run.
--   * RLS enabled with no policies, matching every other tenant table: only
--     the server's privileged connection can read or write, and every
--     application query is scoped by organization_id.
--   * Rollback: 022_interview_focus_plans_rollback.sql

begin;

-- ---------------------------------------------------------------------------
-- 1. Focus plans (versioned per job + stage)
-- ---------------------------------------------------------------------------
create table if not exists public.interview_focus_plans (
  plan_id             uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  job_id              uuid not null references public.job_positions(job_id) on delete cascade,
  stage_key           text not null default 'primary',
  version_number      integer not null,
  status              text not null default 'DRAFT',
  origin              text not null default 'VERIS_RECOMMENDED',
  resume_emphasis     text not null default 'STANDARD',
  recommendation_meta jsonb not null default '{}'::jsonb,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists ux_interview_focus_plans_version
  on public.interview_focus_plans (job_id, stage_key, version_number);

-- At most one ACTIVE and one DRAFT plan per job + stage.
create unique index if not exists ux_interview_focus_plans_one_active
  on public.interview_focus_plans (job_id, stage_key) where status = 'ACTIVE';

create unique index if not exists ux_interview_focus_plans_one_draft
  on public.interview_focus_plans (job_id, stage_key) where status = 'DRAFT';

create index if not exists idx_interview_focus_plans_org
  on public.interview_focus_plans (organization_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_ifp_status') then
    alter table public.interview_focus_plans
      add constraint chk_ifp_status check (status in ('DRAFT', 'ACTIVE', 'SUPERSEDED'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_ifp_origin') then
    alter table public.interview_focus_plans
      add constraint chk_ifp_origin check (origin in ('VERIS_RECOMMENDED', 'CUSTOM'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_ifp_resume_emphasis') then
    alter table public.interview_focus_plans
      add constraint chk_ifp_resume_emphasis check (resume_emphasis in ('OFF', 'LIGHT', 'STANDARD', 'HEAVY'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_ifp_stage_key') then
    alter table public.interview_focus_plans
      add constraint chk_ifp_stage_key check (stage_key ~ '^[a-z][a-z0-9_]{0,39}$');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Focus areas (the competencies inside one plan version)
-- ---------------------------------------------------------------------------
create table if not exists public.interview_focus_areas (
  area_id         uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references public.interview_focus_plans(plan_id) on delete cascade,
  organization_id uuid not null,
  area_key        text not null,
  label           text not null,
  description     text,
  is_custom       boolean not null default false,
  sort_order      integer not null,
  coverage_weight integer not null,
  -- Reserved for a later phase. Coverage is NOT scoring; nothing reads this.
  scoring_weight  integer,
  created_at      timestamptz not null default now()
);

create unique index if not exists ux_interview_focus_areas_key
  on public.interview_focus_areas (plan_id, area_key);

create index if not exists idx_interview_focus_areas_plan_order
  on public.interview_focus_areas (plan_id, sort_order);

create index if not exists idx_interview_focus_areas_org
  on public.interview_focus_areas (organization_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_ifa_coverage_weight') then
    alter table public.interview_focus_areas
      add constraint chk_ifa_coverage_weight
      check (coverage_weight between 10 and 100 and coverage_weight % 5 = 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_ifa_scoring_weight') then
    alter table public.interview_focus_areas
      add constraint chk_ifa_scoring_weight
      check (scoring_weight is null or scoring_weight between 0 and 100);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_ifa_area_key') then
    alter table public.interview_focus_areas
      add constraint chk_ifa_area_key check (area_key ~ '^[a-z][a-z0-9_]{1,63}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_ifa_label') then
    alter table public.interview_focus_areas
      add constraint chk_ifa_label check (char_length(btrim(label)) between 2 and 60);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Database-level guarantees
--
--    a) A plan's organization_id must be the organization that owns the job,
--       and an area's organization_id must match its plan. Application
--       queries are already org-scoped; this makes a cross-tenant row
--       impossible even if a caller gets that wrong.
--    b) Only DRAFT plans are editable. ACTIVE/SUPERSEDED versions are
--       referenced by questionnaire versions and must stay reproducible, so
--       their areas cannot change and the only allowed status moves are
--       DRAFT -> ACTIVE and ACTIVE -> SUPERSEDED. Direct deletes are
--       covered in (c) below; cascades still work.
-- ---------------------------------------------------------------------------
create or replace function public.fn_interview_focus_plans_guard()
returns trigger
language plpgsql
as $$
declare
  v_job_org uuid;
begin
  select jp.organization_id into v_job_org
  from public.job_positions jp
  where jp.job_id = new.job_id;

  if v_job_org is null or v_job_org <> new.organization_id then
    raise exception 'FOCUS_PLAN_ORG_MISMATCH: plan organization does not own this job';
  end if;

  if tg_op = 'UPDATE' then
    if old.status <> 'DRAFT' then
      if not (old.status = 'ACTIVE' and new.status = 'SUPERSEDED') then
        raise exception 'FOCUS_PLAN_IMMUTABLE: % plan % cannot be modified', old.status, old.plan_id;
      end if;

      if new.organization_id <> old.organization_id
        or new.job_id <> old.job_id
        or new.stage_key <> old.stage_key
        or new.version_number <> old.version_number
        or new.origin <> old.origin
        or new.resume_emphasis <> old.resume_emphasis
        or new.recommendation_meta <> old.recommendation_meta then
        raise exception 'FOCUS_PLAN_IMMUTABLE: only the status of a % plan can change', old.status;
      end if;
    elsif new.status not in ('DRAFT', 'ACTIVE') then
      raise exception 'FOCUS_PLAN_INVALID_TRANSITION: a DRAFT plan can only become ACTIVE';
    end if;

    new.updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_interview_focus_plans_guard on public.interview_focus_plans;
create trigger trg_interview_focus_plans_guard
  before insert or update on public.interview_focus_plans
  for each row execute function public.fn_interview_focus_plans_guard();

create or replace function public.fn_interview_focus_areas_guard()
returns trigger
language plpgsql
as $$
declare
  v_plan_org uuid;
  v_plan_status text;
begin
  select p.organization_id, p.status into v_plan_org, v_plan_status
  from public.interview_focus_plans p
  where p.plan_id = new.plan_id;

  if v_plan_org is null or v_plan_org <> new.organization_id then
    raise exception 'FOCUS_AREA_ORG_MISMATCH: area organization does not match its plan';
  end if;

  if v_plan_status <> 'DRAFT' then
    raise exception 'FOCUS_PLAN_IMMUTABLE: areas of a % plan cannot be modified', v_plan_status;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_interview_focus_areas_guard on public.interview_focus_areas;
create trigger trg_interview_focus_areas_guard
  before insert or update on public.interview_focus_areas
  for each row execute function public.fn_interview_focus_areas_guard();

-- c) Deletes. A non-DRAFT plan and its areas may only disappear through a
--    cascade (the job, or the plan itself, being deleted); a direct delete of
--    an ACTIVE/SUPERSEDED plan or of one of its areas would silently change a
--    version that questionnaire versions reference. During a cascade the
--    parent row is already gone, so the lookups below find nothing and the
--    delete proceeds.
create or replace function public.fn_interview_focus_plans_delete_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'DRAFT'
    and exists (select 1 from public.job_positions jp where jp.job_id = old.job_id) then
    raise exception 'FOCUS_PLAN_IMMUTABLE: % plan % cannot be deleted while its job exists', old.status, old.plan_id;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_interview_focus_plans_delete_guard on public.interview_focus_plans;
create trigger trg_interview_focus_plans_delete_guard
  before delete on public.interview_focus_plans
  for each row execute function public.fn_interview_focus_plans_delete_guard();

create or replace function public.fn_interview_focus_areas_delete_guard()
returns trigger
language plpgsql
as $$
declare
  v_plan_status text;
begin
  select p.status into v_plan_status
  from public.interview_focus_plans p
  where p.plan_id = old.plan_id;

  if v_plan_status is not null and v_plan_status <> 'DRAFT' then
    raise exception 'FOCUS_PLAN_IMMUTABLE: areas of a % plan cannot be deleted', v_plan_status;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_interview_focus_areas_delete_guard on public.interview_focus_areas;
create trigger trg_interview_focus_areas_delete_guard
  before delete on public.interview_focus_areas
  for each row execute function public.fn_interview_focus_areas_delete_guard();

-- ---------------------------------------------------------------------------
-- 4. Questionnaire provenance
--
--    A questionnaire version records the exact focus plan version that
--    generated it; each question records its primary focus area. Both are
--    NULL for every existing row and for jobs without a plan.
-- ---------------------------------------------------------------------------
alter table public.job_questionnaire_versions
  add column if not exists focus_plan_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_jqv_focus_plan'
  ) then
    alter table public.job_questionnaire_versions
      add constraint fk_jqv_focus_plan
      foreign key (focus_plan_id)
      references public.interview_focus_plans(plan_id)
      on delete set null;
  end if;
end;
$$;

create index if not exists idx_jqv_focus_plan
  on public.job_questionnaire_versions (focus_plan_id);

alter table public.job_questionnaire_questions
  add column if not exists focus_area_key text;

-- ---------------------------------------------------------------------------
-- 5. Row level security: enabled, no policies (server-only access), matching
--    job_questionnaires / job_questionnaire_versions / job_positions.
-- ---------------------------------------------------------------------------
alter table public.interview_focus_plans enable row level security;
alter table public.interview_focus_areas enable row level security;

commit;
