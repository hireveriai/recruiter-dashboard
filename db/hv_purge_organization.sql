-- =====================================================================
-- hv_purge_organization
-- ---------------------------------------------------------------------
-- Deletes ONE organization and every row that belongs to it or to its
-- users / candidates / jobs / interviews / attempts / questions, across
-- the whole public schema.
--
-- Why not the older hv_delete_organization_cascade():
--   That one walks live foreign keys plus tables carrying an
--   organization_id / org_id / organizationId column. Many tenant tables
--   in this database carry attempt_id / interview_id / candidate_id /
--   question_id WITHOUT a declared foreign key, so they were never
--   reached and were left behind as orphans, e.g.:
--     ai_signed_decisions, interview_scores, interview_signals,
--     interview_summaries, interview_recordings, fraud_signals,
--     fraud_risk_scores, forensic_transcripts, forensic_neural_ledger,
--     forensic_evidence_packs, neural_verdicts, neural_mri_timeline,
--     neural_signal_ledger, compliance_vault, hire_outcomes,
--     candidate_hire_prediction, candidate_skill_profile,
--     interview_quality_metrics, question_performance_stats,
--     question_replacement_queue, interview_answer_duplicate_quarantine,
--     war_room_actions, audit_logs, ai_audit_logs, improvement_actions.
--   This function uses an explicit, FK-safe ordered plan instead, so
--   those are included.
--
-- USAGE
--   -- 1. Preview (default; deletes nothing):
--   select * from public.hv_purge_organization('<org-uuid>'::uuid);
--
--   -- 2. Real deletion - the exact organization_name must be repeated
--   --    back as a confirmation, and run it inside a transaction so you
--   --    can still roll back after eyeballing the report:
--   begin;
--   select * from public.hv_purge_organization(
--     '<org-uuid>'::uuid,
--     false,
--     'Exact Organization Name'
--   );
--   -- rollback;   -- if the numbers look wrong
--   commit;
--
-- NOT COVERED (deliberately - see notes at the bottom of this file):
--   * Storage objects (recordings, resumes, attachments) in storage.objects
--   * public.support_requests (linked only by free-text organization name)
--   * auth.users (this database authenticates via public.auth_users /
--     public.identity_users, which ARE covered)
-- =====================================================================

create or replace function public.hv_purge_organization(
  p_organization_id          uuid,
  p_dry_run                  boolean default true,
  p_confirm_organization_name text    default null,
  p_purge_orphan_identities  boolean default true
)
returns table (
  step_no       integer,
  object_name   text,
  action        text,
  affected_rows bigint
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $fn$
declare
  v_org_name text;
  v_step     record;
  v_sql      text;
  v_rows     bigint;
  v_total    bigint := 0;
  v_action   text;
begin
  ---------------------------------------------------------------------
  -- 0. Guards
  ---------------------------------------------------------------------
  if p_organization_id is null then
    raise exception 'hv_purge_organization: p_organization_id is required';
  end if;

  -- Serialise concurrent purges of the same organization.
  perform pg_advisory_xact_lock(hashtext('hv_purge_organization'),
                                hashtext(p_organization_id::text));

  select o.organization_name
    into v_org_name
    from public.organizations o
   where o.organization_id = p_organization_id;

  if not found then
    raise exception 'hv_purge_organization: organization % does not exist',
      p_organization_id;
  end if;

  if not p_dry_run
     and (p_confirm_organization_name is null
          or p_confirm_organization_name is distinct from v_org_name) then
    raise exception
      'hv_purge_organization: destructive run requires p_confirm_organization_name to equal %',
      coalesce(v_org_name, '<null>');
  end if;

  ---------------------------------------------------------------------
  -- 1. Collect the id sets this organization owns
  ---------------------------------------------------------------------
  drop table if exists pg_temp.hv_purge_ids;
  create temp table pg_temp.hv_purge_ids (
    kind text not null,
    id   uuid not null,
    primary key (kind, id)
  ) on commit drop;

  -- Billing ids (Razorpay) are text, not uuid, so they get their own set.
  drop table if exists pg_temp.hv_purge_txt_ids;
  create temp table pg_temp.hv_purge_txt_ids (
    kind text not null,
    id   text not null,
    primary key (kind, id)
  ) on commit drop;

  -- users
  insert into pg_temp.hv_purge_ids (kind, id)
  select 'user', u.user_id from public.users u
   where u.organization_id = p_organization_id
  on conflict do nothing;

  -- candidates
  insert into pg_temp.hv_purge_ids (kind, id)
  select 'candidate', c.candidate_id from public.candidates c
   where c.organization_id = p_organization_id
  on conflict do nothing;

  -- job_positions (legacy job table) and jobs (screening job table)
  insert into pg_temp.hv_purge_ids (kind, id)
  select 'job_position', jp.job_id from public.job_positions jp
   where jp.organization_id = p_organization_id
  on conflict do nothing;

  insert into pg_temp.hv_purge_ids (kind, id)
  select 'job', j.id from public.jobs j
   where j.organization_id = p_organization_id
  on conflict do nothing;

  -- interviews -> attempts -> answers / session questions
  insert into pg_temp.hv_purge_ids (kind, id)
  select 'interview', i.interview_id from public.interviews i
   where i.organization_id = p_organization_id
  on conflict do nothing;

  insert into pg_temp.hv_purge_ids (kind, id)
  select 'attempt', a.attempt_id
    from public.interview_attempts a
   where a.interview_id in (select id from pg_temp.hv_purge_ids where kind = 'interview')
  on conflict do nothing;

  insert into pg_temp.hv_purge_ids (kind, id)
  select 'answer', ia.answer_id
    from public.interview_answers ia
   where ia.attempt_id in (select id from pg_temp.hv_purge_ids where kind = 'attempt')
  on conflict do nothing;

  insert into pg_temp.hv_purge_ids (kind, id)
  select 'session_question', sq.session_question_id
    from public.session_questions sq
   where sq.attempt_id in (select id from pg_temp.hv_purge_ids where kind = 'attempt')
  on conflict do nothing;

  insert into pg_temp.hv_purge_ids (kind, id)
  select 'evidence_pack', p.pack_id
    from public.forensic_evidence_packs p
   where p.attempt_id in (select id from pg_temp.hv_purge_ids where kind = 'attempt')
  on conflict do nothing;

  -- tenant question bank
  insert into pg_temp.hv_purge_ids (kind, id)
  select 'question', q.question_id from public.questions q
   where q.organization_id = p_organization_id
  on conflict do nothing;

  -- AI screening runs
  insert into pg_temp.hv_purge_ids (kind, id)
  select 'screening_run', r.id from public.screening_runs r
   where r.organization_id = p_organization_id
  on conflict do nothing;

  -- billing (text ids)
  insert into pg_temp.hv_purge_txt_ids (kind, id)
  select 'subscription', s.id from public.hireveri_user_subscriptions s
   where s."organizationId" = p_organization_id
  on conflict do nothing;

  insert into pg_temp.hv_purge_txt_ids (kind, id)
  select 'payment', pay.id from public.hireveri_payments pay
   where pay."organizationId" = p_organization_id
      or pay."subscriptionId" in (select id from pg_temp.hv_purge_txt_ids where kind = 'subscription')
  on conflict do nothing;

  -- team invites
  insert into pg_temp.hv_purge_ids (kind, id)
  select 'team_invite', ti.invite_id from public.recruiter_team_invites ti
   where ti.org_id = p_organization_id
  on conflict do nothing;

  -- devices belonging to this org's users
  insert into pg_temp.hv_purge_ids (kind, id)
  select 'device', d.device_id from public.user_devices d
   where d.user_id in (select id from pg_temp.hv_purge_ids where kind = 'user')
  on conflict do nothing;

  -- login identities behind this org's users
  insert into pg_temp.hv_purge_ids (kind, id)
  select 'identity', u.identity_id from public.users u
   where u.organization_id = p_organization_id
     and u.identity_id is not null
  on conflict do nothing;

  insert into pg_temp.hv_purge_ids (kind, id)
  select 'auth_user', x.auth_user_id
    from (
      select u.auth_user_id from public.users u
       where u.organization_id = p_organization_id and u.auth_user_id is not null
      union
      select om.auth_user_id from public.organization_memberships om
       where om.org_id = p_organization_id and om.auth_user_id is not null
    ) x
  on conflict do nothing;

  -- every id above, for the polymorphic audit tables
  insert into pg_temp.hv_purge_ids (kind, id)
  select distinct 'any', t.id from pg_temp.hv_purge_ids t
  on conflict do nothing;

  insert into pg_temp.hv_purge_ids (kind, id)
  values ('any', p_organization_id)
  on conflict do nothing;

  analyze pg_temp.hv_purge_ids;
  analyze pg_temp.hv_purge_txt_ids;

  ---------------------------------------------------------------------
  -- 2. Execute the ordered plan (children before parents)
  ---------------------------------------------------------------------
  for v_step in
    select *
      from (values
        -- ---- attempt-scoped leaves --------------------------------
        (  1, 'ai_signed_decisions',                  'delete', null::text, $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        (  2, 'answer_evaluations',                   'delete', null,       $p$answer_id in (select id from pg_temp.hv_purge_ids where kind='answer')$p$),
        (  3, 'interview_answer_evaluations',         'delete', null,       $p$answer_id in (select id from pg_temp.hv_purge_ids where kind='answer')$p$),
        (  4, 'interview_answer_duplicate_quarantine','delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        (  5, 'interview_code_submissions',           'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        (  6, 'interview_answers',                    'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        (  7, 'attempt_question_map',                 'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        (  8, 'attempt_skill_scores',                 'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        (  9, 'candidate_resume_ai',                  'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt') or interview_id in (select id from pg_temp.hv_purge_ids where kind='interview')$p$),
        ( 10, 'compliance_vault',                     'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt') or evidence_pack_id in (select id from pg_temp.hv_purge_ids where kind='evidence_pack')$p$),
        ( 11, 'forensic_neural_ledger',               'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        ( 12, 'forensic_transcripts',                 'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        ( 13, 'forensic_evidence_packs',              'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        ( 14, 'fraud_risk_scores',                    'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        ( 15, 'fraud_signals',                        'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        ( 16, 'interview_attempt_scores',             'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        ( 17, 'interview_browser_logs',               'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt') or interview_id in (select id from pg_temp.hv_purge_ids where kind='interview')$p$),
        ( 18, 'interview_evaluations',                'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        ( 19, 'interview_recordings',                 'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        ( 20, 'interview_recovery_events',            'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt') or inherited_from_attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt') or interview_id in (select id from pg_temp.hv_purge_ids where kind='interview')$p$),
        ( 21, 'interview_scores',                     'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        ( 22, 'interview_signals',                    'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        ( 23, 'interview_summaries',                  'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        ( 24, 'neural_mri_timeline',                  'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        ( 25, 'neural_signal_ledger',                 'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        ( 26, 'neural_verdicts',                      'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        ( 27, 'resume_reality_gap',                   'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        ( 28, 'war_room_actions',                     'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt') or interview_id in (select id from pg_temp.hv_purge_ids where kind='interview') or created_by in (select id from pg_temp.hv_purge_ids where kind='user') or consumed_session_question_id in (select id from pg_temp.hv_purge_ids where kind='session_question')$p$),
        ( 29, 'war_room_sessions',                    'delete', null,       $p$organization_id = %2$L::uuid or attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt') or interview_id in (select id from pg_temp.hv_purge_ids where kind='interview') or created_by in (select id from pg_temp.hv_purge_ids where kind='user')$p$),
        ( 30, 'session_questions',                    'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt')$p$),
        ( 31, 'verification_audit_logs',              'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt') or interview_id in (select id from pg_temp.hv_purge_ids where kind='interview') or candidate_id in (select id from pg_temp.hv_purge_ids where kind='candidate')$p$),
        ( 32, 'candidate_identity_verifications',     'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt') or interview_id in (select id from pg_temp.hv_purge_ids where kind='interview') or candidate_id in (select id from pg_temp.hv_purge_ids where kind='candidate')$p$),
        ( 33, 'interview_timeline_events',            'delete', null,       $p$organization_id = %2$L::uuid or attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt') or interview_id in (select id from pg_temp.hv_purge_ids where kind='interview')$p$),
        ( 34, 'candidate_hire_prediction',            'delete', null,       $p$candidate_id in (select id from pg_temp.hv_purge_ids where kind='candidate') or interview_id in (select id from pg_temp.hv_purge_ids where kind='interview')$p$),
        ( 35, 'hire_outcomes',                        'delete', null,       $p$candidate_id in (select id from pg_temp.hv_purge_ids where kind='candidate') or interview_id in (select id from pg_temp.hv_purge_ids where kind='interview')$p$),
        -- ---- interview level --------------------------------------
        ( 36, 'interview_results',                    'delete', null,       $p$interview_id in (select id from pg_temp.hv_purge_ids where kind='interview')$p$),
        ( 37, 'interview_attempts',                   'delete', null,       $p$attempt_id in (select id from pg_temp.hv_purge_ids where kind='attempt') or interview_id in (select id from pg_temp.hv_purge_ids where kind='interview')$p$),
        ( 38, 'interview_mission_snapshots',          'delete', null,       $p$interview_id in (select id from pg_temp.hv_purge_ids where kind='interview')$p$),
        ( 39, 'interview_question_map',               'delete', null,       $p$interview_id in (select id from pg_temp.hv_purge_ids where kind='interview')$p$),
        ( 40, 'interview_questions',                  'delete', null,       $p$interview_id in (select id from pg_temp.hv_purge_ids where kind='interview')$p$),
        ( 41, 'interview_skill_map',                  'delete', null,       $p$interview_id in (select id from pg_temp.hv_purge_ids where kind='interview')$p$),
        ( 42, 'interview_quality_metrics',            'delete', null,       $p$interview_id in (select id from pg_temp.hv_purge_ids where kind='interview')$p$),
        ( 43, 'identity_verification_assets',         'delete', null,       $p$user_id in (select id from pg_temp.hv_purge_ids where kind='user') or interview_id in (select id from pg_temp.hv_purge_ids where kind='interview')$p$),
        ( 44, 'interview_invites',                    'delete', null,       $p$interview_id in (select id from pg_temp.hv_purge_ids where kind='interview') or candidate_id in (select id from pg_temp.hv_purge_ids where kind='candidate') or job_id in (select id from pg_temp.hv_purge_ids where kind='job')$p$),
        -- any invite left over that was merely issued by one of our users
        ( 45, 'interview_invites',                    'update', 'issued_by = null', $p$issued_by in (select id from pg_temp.hv_purge_ids where kind='user')$p$),
        ( 46, 'interviews',                           'delete', null,       $p$organization_id = %2$L::uuid$p$),
        ( 47, 'interview_configs',                    'delete', null,       $p$job_id in (select id from pg_temp.hv_purge_ids where kind='job_position') or interview_id in (select id from pg_temp.hv_purge_ids where kind='interview')$p$),
        -- ---- AI screening -----------------------------------------
        ( 48, 'candidate_job_matches',                'delete', null,       $p$organization_id = %2$L::uuid or candidate_id in (select id from pg_temp.hv_purge_ids where kind='candidate') or job_id in (select id from pg_temp.hv_purge_ids where kind='job')$p$),
        ( 49, 'screening_run_matches',                'delete', null,       $p$organization_id = %2$L::uuid or run_id in (select id from pg_temp.hv_purge_ids where kind='screening_run') or candidate_id in (select id from pg_temp.hv_purge_ids where kind='candidate')$p$),
        ( 50, 'screening_runs',                       'delete', null,       $p$organization_id = %2$L::uuid$p$),
        ( 51, 'ai_screening_upload_batches',          'delete', null,       $p$organization_id = %2$L::uuid$p$),
        ( 52, 'candidate_recruiter_decisions',        'delete', null,       $p$organization_id = %2$L::uuid or candidate_id in (select id from pg_temp.hv_purge_ids where kind='candidate')$p$),
        -- ---- candidates -------------------------------------------
        ( 53, 'candidate_identity_links',             'delete', null,       $p$candidate_id in (select id from pg_temp.hv_purge_ids where kind='candidate')$p$),
        ( 54, 'candidate_primary_skills',             'delete', null,       $p$candidate_id in (select id from pg_temp.hv_purge_ids where kind='candidate')$p$),
        ( 55, 'candidate_skill_profile',              'delete', null,       $p$candidate_id in (select id from pg_temp.hv_purge_ids where kind in ('candidate','user'))$p$),
        ( 56, 'candidates',                           'delete', null,       $p$organization_id = %2$L::uuid$p$),
        -- ---- jobs and workforce analytics -------------------------
        ( 57, 'company_skill_baseline',               'delete', null,       $p$organization_id = %2$L::uuid$p$),
        ( 58, 'company_skill_gap_reports',            'delete', null,       $p$organization_id = %2$L::uuid$p$),
        ( 59, 'jobs',                                 'delete', null,       $p$organization_id = %2$L::uuid$p$),
        ( 60, 'job_positions',                        'delete', null,       $p$organization_id = %2$L::uuid$p$),
        -- ---- question bank ----------------------------------------
        ( 61, 'question_performance_stats',           'delete', null,       $p$question_id in (select id from pg_temp.hv_purge_ids where kind='question')$p$),
        ( 62, 'question_replacement_queue',           'delete', null,       $p$question_id in (select id from pg_temp.hv_purge_ids where kind='question')$p$),
        ( 63, 'question_skill_map',                   'delete', null,       $p$question_id in (select id from pg_temp.hv_purge_ids where kind='question')$p$),
        ( 64, 'questions',                            'delete', null,       $p$organization_id = %2$L::uuid$p$),
        ( 65, 'tenant_question_pool',                 'delete', null,       $p$organization_id = %2$L::uuid$p$),
        ( 66, 'evaluation_template_pool',             'delete', null,       $p$organization_id = %2$L::uuid$p$),
        -- ---- dashboard / trial credits ----------------------------
        ( 67, 'dashboard_alert_reads',                'delete', null,       $p$organization_id = %2$L::uuid or user_id in (select id from pg_temp.hv_purge_ids where kind='user')$p$),
        ( 68, 'dashboard_realtime_events',            'delete', null,       $p$organization_id = %2$L::uuid$p$),
        ( 69, 'workspace_trial_credit_events',        'delete', null,       $p$organization_id = %2$L::uuid$p$),
        ( 70, 'workspace_trial_credits',              'delete', null,       $p$organization_id = %2$L::uuid$p$),
        -- ---- billing (children first: RESTRICT foreign keys) ------
        ( 71, 'coupon_usages',                        'delete', null,       $p$organization_id = %2$L::uuid or payment_id in (select id from pg_temp.hv_purge_txt_ids where kind='payment')$p$),
        ( 72, 'invoices',                             'delete', null,       $p$organization_id = %2$L::uuid or payment_id in (select id from pg_temp.hv_purge_txt_ids where kind='payment') or subscription_id in (select id from pg_temp.hv_purge_txt_ids where kind='subscription')$p$),
        ( 73, 'hireveri_usage',                       'delete', null,       $p$"subscriptionId" in (select id from pg_temp.hv_purge_txt_ids where kind='subscription')$p$),
        ( 74, 'hireveri_payments',                    'delete', null,       $p$"organizationId" = %2$L::uuid or "subscriptionId" in (select id from pg_temp.hv_purge_txt_ids where kind='subscription')$p$),
        ( 75, 'hireveri_user_subscriptions',          'delete', null,       $p$"organizationId" = %2$L::uuid$p$),
        -- ---- team / permissions -----------------------------------
        ( 76, 'recruiter_team_invite_audit_logs',     'delete', null,       $p$org_id = %2$L::uuid or invite_id in (select id from pg_temp.hv_purge_ids where kind='team_invite')$p$),
        ( 77, 'recruiter_team_invites',               'delete', null,       $p$org_id = %2$L::uuid or invited_user_id in (select id from pg_temp.hv_purge_ids where kind='user')$p$),
        ( 78, 'recruiter_user_permission_overrides',  'delete', null,       $p$organization_id = %2$L::uuid or user_id in (select id from pg_temp.hv_purge_ids where kind='user')$p$),
        ( 79, 'recruiter_user_permission_overrides',  'update', 'updated_by = null', $p$updated_by in (select id from pg_temp.hv_purge_ids where kind='user')$p$),
        ( 80, 'recruiter_profiles',                   'delete', null,       $p$organization_id = %2$L::uuid or recruiter_id in (select id from pg_temp.hv_purge_ids where kind='user')$p$),
        -- ---- users ------------------------------------------------
        ( 81, 'candidate_profiles',                   'delete', null,       $p$candidate_id in (select id from pg_temp.hv_purge_ids where kind='user')$p$),
        ( 82, 'user_sessions',                        'delete', null,       $p$user_id in (select id from pg_temp.hv_purge_ids where kind='user') or device_id in (select id from pg_temp.hv_purge_ids where kind='device')$p$),
        ( 83, 'user_devices',                         'delete', null,       $p$user_id in (select id from pg_temp.hv_purge_ids where kind='user')$p$),
        ( 84, 'user_primary_skills',                  'delete', null,       $p$user_id in (select id from pg_temp.hv_purge_ids where kind='user')$p$),
        ( 85, 'user_roles',                           'delete', null,       $p$user_id in (select id from pg_temp.hv_purge_ids where kind='user')$p$),
        ( 86, 'audit_logs',                           'delete', null,       $p$user_id in (select id from pg_temp.hv_purge_ids where kind='user')$p$),
        ( 87, 'organization_memberships',             'delete', null,       $p$org_id = %2$L::uuid or legacy_user_id in (select id from pg_temp.hv_purge_ids where kind='user')$p$),
        -- ---- polymorphic audit trails -----------------------------
        ( 88, 'ai_audit_logs',                        'delete', null,       $p$entity_id in (select id from pg_temp.hv_purge_ids where kind='any')$p$),
        ( 89, 'improvement_actions',                  'delete', null,       $p$target_id in (select id from pg_temp.hv_purge_ids where kind='any')$p$),
        ( 90, 'users',                                'delete', null,       $p$organization_id = %2$L::uuid$p$)
      ) as s(step_no, tbl, op, set_clause, pred)
     order by s.step_no
  loop
    if v_step.op = 'delete' then
      if p_dry_run then
        v_sql := format('select count(*)::bigint from public.%1$I where ' || v_step.pred,
                        v_step.tbl, p_organization_id);
        execute v_sql into v_rows;
        v_action := 'would_delete';
      else
        v_sql := format('delete from public.%1$I where ' || v_step.pred,
                        v_step.tbl, p_organization_id);
        execute v_sql;
        get diagnostics v_rows = row_count;
        v_action := 'deleted';
      end if;
    else -- update
      if p_dry_run then
        v_sql := format('select count(*)::bigint from public.%1$I where ' || v_step.pred,
                        v_step.tbl, p_organization_id);
        execute v_sql into v_rows;
        v_action := 'would_null_out';
      else
        v_sql := format('update public.%1$I set ' || v_step.set_clause || ' where ' || v_step.pred,
                        v_step.tbl, p_organization_id);
        execute v_sql;
        get diagnostics v_rows = row_count;
        v_action := 'nulled_out';
      end if;
    end if;

    if coalesce(v_rows, 0) > 0 then
      step_no       := v_step.step_no;
      object_name   := 'public.' || v_step.tbl;
      action        := v_action;
      affected_rows := v_rows;
      v_total       := v_total + v_rows;
      return next;
    end if;
  end loop;

  ---------------------------------------------------------------------
  -- 3. Orphaned login identities (only if nothing else still uses them)
  ---------------------------------------------------------------------
  if p_purge_orphan_identities then
    -- auth_sessions / legal acceptances / OTPs of now-orphaned identities
    for v_step in
      select *
        from (values
          ( 91, 'auth_sessions',          $p$identity_id in (select id from pg_temp.hv_purge_ids where kind='identity')$p$),
          ( 92, 'auth_legal_acceptances', $p$identity_id in (select id from pg_temp.hv_purge_ids where kind='identity')$p$),
          ( 93, 'user_otps',              $p$identity_id in (select id from pg_temp.hv_purge_ids where kind='identity')$p$),
          ( 94, 'identity_users',         $p$identity_id in (select id from pg_temp.hv_purge_ids where kind='identity')
                                            and not exists (select 1 from public.users u where u.identity_id = identity_users.identity_id)
                                            and not exists (select 1 from public.candidate_identity_links l where l.identity_id = identity_users.identity_id)$p$),
          ( 95, 'auth_users',             $p$id in (select id from pg_temp.hv_purge_ids where kind='auth_user')
                                            and not exists (select 1 from public.users u where u.auth_user_id = auth_users.id)
                                            and not exists (select 1 from public.organization_memberships m where m.auth_user_id = auth_users.id)$p$)
        ) as s(step_no, tbl, pred)
       order by s.step_no
    loop
      -- identity rows are only removed when no surviving user references them
      if v_step.tbl in ('auth_sessions', 'auth_legal_acceptances', 'user_otps') then
        v_sql := v_step.pred || $p$ and identity_id not in (select u.identity_id from public.users u where u.identity_id is not null)$p$;
      else
        v_sql := v_step.pred;
      end if;

      if p_dry_run then
        execute format('select count(*)::bigint from public.%I where %s', v_step.tbl, v_sql)
          into v_rows;
        v_action := 'would_delete_orphan';
      else
        execute format('delete from public.%I where %s', v_step.tbl, v_sql);
        get diagnostics v_rows = row_count;
        v_action := 'deleted_orphan';
      end if;

      if coalesce(v_rows, 0) > 0 then
        step_no       := v_step.step_no;
        object_name   := 'public.' || v_step.tbl;
        action        := v_action;
        affected_rows := v_rows;
        v_total       := v_total + v_rows;
        return next;
      end if;
    end loop;
  end if;

  ---------------------------------------------------------------------
  -- 4. The organization row itself
  ---------------------------------------------------------------------
  if p_dry_run then
    select count(*)::bigint into v_rows
      from public.organizations o
     where o.organization_id = p_organization_id;
    v_action := 'would_delete';
  else
    delete from public.organizations o
     where o.organization_id = p_organization_id;
    get diagnostics v_rows = row_count;
    v_action := 'deleted';
  end if;

  step_no       := 96;
  object_name   := 'public.organizations';
  action        := v_action;
  affected_rows := v_rows;
  v_total       := v_total + v_rows;
  return next;

  ---------------------------------------------------------------------
  -- 5. Summary line
  ---------------------------------------------------------------------
  step_no       := 999;
  object_name   := format('TOTAL for %s (%s)', coalesce(v_org_name, '?'), p_organization_id);
  action        := case when p_dry_run then 'dry_run' else 'purged' end;
  affected_rows := v_total;
  return next;

  return;
end;
$fn$;

comment on function public.hv_purge_organization(uuid, boolean, text, boolean) is
  'Purges one organization and all of its dependent rows across the public schema using an explicit FK-safe order. Dry run by default; a destructive run must repeat the exact organization_name as confirmation.';

-- Lock it down: this is a service-role / DBA tool, never an app-facing RPC.
revoke all on function public.hv_purge_organization(uuid, boolean, text, boolean) from public;
revoke all on function public.hv_purge_organization(uuid, boolean, text, boolean) from anon, authenticated;
grant execute on function public.hv_purge_organization(uuid, boolean, text, boolean) to service_role;

-- =====================================================================
-- NOT HANDLED BY THIS FUNCTION - handle separately if you need a full
-- "right to erasure" style wipe:
--
-- 1. Storage. Interview recordings, resumes and support attachments live
--    in Supabase Storage. Capture the paths BEFORE purging, e.g.
--       select storage_path from public.interview_recordings
--        where attempt_id in (...);
--    then delete the objects through the Storage API.
--
-- 2. public.support_requests. It stores the organization as free text
--    (column "organization"), not as an id, so matching is unreliable.
--    Clean it manually:
--       delete from public.support_requests
--        where organization = '<Exact Organization Name>';
--
-- 3. auth.users (Supabase GoTrue). This schema authenticates through
--    public.auth_users / public.identity_users. If you also mirror users
--    into Supabase Auth, delete them via the Admin API after this runs.
--
-- 4. Global pools (global_question_pool, skill_master, roles,
--    permissions, hireveri_plans, coupons, ...) are shared reference
--    data and are intentionally left untouched.
-- =====================================================================
