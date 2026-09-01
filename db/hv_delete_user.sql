-- =====================================================================
-- hv_delete_user
-- ---------------------------------------------------------------------
-- Deletes ONE user account from an organization, WITHOUT destroying the
-- workspace around it. This is the counterpart to hv_purge_organization:
-- an org's Global Administrator creates users under their workspace, and
-- this removes one of those accounts.
--
-- WHAT GOES
--   the account row, its sessions, devices, primary skills, roles,
--   permission overrides, recruiter/candidate profile, team invites it
--   sent or received, notifications addressed to it, its audit trail, its
--   org membership, its platform_admins row, and - only when nothing else
--   references them - its identity_users / auth_users login rows.
--
-- WHAT STAYS
--   Interviews, candidates, jobs, questionnaires and screening runs the
--   user created belong to the ORGANIZATION, not to the person. Their
--   authorship is handed to p_reassign_to, or detached to NULL, so the org
--   keeps its history. Use hv_purge_organization to remove that data.
--
-- GUARDS (both overridable with p_force)
--   * refuses to delete the only active Global Administrator of an org,
--     which would leave the workspace unadministered;
--   * refuses to delete a platform admin.
--
-- USAGE
--   -- 1. Preview (default; deletes nothing):
--   select * from public.hv_delete_user('<user-uuid>'::uuid);
--
--   -- 2. Real deletion, handing authored records to a colleague. Run it
--   --    inside a transaction so you can still roll back after reading
--   --    the report:
--   begin;
--   select * from public.hv_delete_user(
--     '<user-uuid>'::uuid,
--     false,                      -- p_dry_run
--     '<successor-user-uuid>'     -- p_reassign_to (null = detach to NULL)
--   );
--   -- rollback;   -- if the numbers look wrong
--   commit;
--
-- NOT COVERED
--   Storage objects. Capture them first with
--     select * from public.hv_user_storage_objects('<user-uuid>');
--   then delete them through the Storage API after this commits.
-- =====================================================================

create or replace function public.hv_delete_user(
  p_user_id     uuid,
  p_dry_run     boolean default true,
  p_reassign_to uuid    default null,
  p_force       boolean default false
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
  v_org_id        uuid;
  v_email         text;
  v_org_name      text;
  v_identity_id   uuid;
  v_auth_user_id  uuid;
  v_role_code     text;
  v_peer_admins   integer;
  v_is_platform   boolean;
  v_target_org    uuid;
  v_step          record;
  v_sql           text;
  v_set           text;
  v_rows          bigint;
  v_total         bigint := 0;
  v_action        text;
begin
  ---------------------------------------------------------------------
  -- 0. Resolve the account and run the guards
  ---------------------------------------------------------------------
  if p_user_id is null then
    raise exception 'hv_delete_user: p_user_id is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('hv_delete_user'), hashtext(p_user_id::text));

  select u.organization_id, u.email, u.identity_id, u.auth_user_id, o.organization_name
    into v_org_id, v_email, v_identity_id, v_auth_user_id, v_org_name
    from public.users u
    join public.organizations o using (organization_id)
   where u.user_id = p_user_id;

  if not found then
    raise exception 'hv_delete_user: user % does not exist', p_user_id;
  end if;

  select rrp.code
    into v_role_code
    from public.recruiter_profiles rp
    join public.recruiter_role_pool rrp
      on rrp.recruiter_role_id = rp.recruiter_role_id
   where rp.recruiter_id = p_user_id;

  -- Guard 1: never strand a workspace without an administrator.
  if v_role_code = 'Global Administrator' then
    select count(*)::integer
      into v_peer_admins
      from public.users u
      join public.recruiter_profiles rp on rp.recruiter_id = u.user_id
      join public.recruiter_role_pool rrp
        on rrp.recruiter_role_id = rp.recruiter_role_id
     where u.organization_id = v_org_id
       and u.is_active
       and rrp.code = 'Global Administrator'
       and u.user_id <> p_user_id;

    if v_peer_admins = 0 and not p_force then
      raise exception
        'hv_delete_user: % is the only active Global Administrator of % - promote someone else first, pass p_force => true, or use hv_purge_organization to remove the whole workspace',
        v_email, v_org_name;
    end if;
  end if;

  -- Guard 2: platform admins are not ordinary tenant users.
  select exists (select 1 from public.platform_admins pa where pa.user_id = p_user_id)
    into v_is_platform;

  if v_is_platform and not p_force then
    raise exception
      'hv_delete_user: % is a platform admin - pass p_force => true to delete anyway', v_email;
  end if;

  -- The successor must be a real user in the same organization.
  if p_reassign_to is not null then
    if p_reassign_to = p_user_id then
      raise exception 'hv_delete_user: p_reassign_to cannot be the user being deleted';
    end if;

    select u.organization_id into v_target_org
      from public.users u where u.user_id = p_reassign_to;

    if not found then
      raise exception 'hv_delete_user: p_reassign_to user % does not exist', p_reassign_to;
    end if;

    if v_target_org is distinct from v_org_id then
      raise exception
        'hv_delete_user: p_reassign_to user % belongs to a different organization', p_reassign_to;
    end if;
  end if;

  ---------------------------------------------------------------------
  -- 1. Hand over (or detach) authored organization records
  --
  -- Every column below is nullable. recruiter_team_invites.invited_by is
  -- the one NOT NULL authorship column in this schema, so those invites
  -- are deleted in the plan instead of being detached.
  ---------------------------------------------------------------------
  v_set := case when p_reassign_to is null
                then 'null'
                else quote_literal(p_reassign_to) || '::uuid'
           end;

  for v_step in
    select *
      from (values
        (  1, 'interviews',                          'created_by'),
        (  2, 'interview_invites',                   'issued_by'),
        (  3, 'candidates',                          'created_by'),
        (  4, 'jobs',                                'created_by'),
        (  5, 'job_positions',                       'created_by'),
        (  6, 'job_questionnaire_versions',          'created_by'),
        (  7, 'screening_runs',                      'created_by'),
        (  8, 'ai_screening_upload_batches',         'created_by'),
        (  9, 'war_room_sessions',                   'created_by'),
        ( 10, 'war_room_actions',                    'created_by'),
        ( 11, 'candidate_recruiter_decisions',       'decided_by'),
        ( 12, 'recruiter_user_permission_overrides', 'updated_by')
      ) as s(step_no, tbl, col)
     order by s.step_no
  loop
    -- Skip anything this database does not actually have; the schema has
    -- drifted from the checked-in Prisma model more than once.
    if to_regclass('public.' || v_step.tbl) is null
       or not exists (
         select 1 from information_schema.columns c
          where c.table_schema = 'public'
            and c.table_name = v_step.tbl
            and c.column_name = v_step.col
       ) then
      continue;
    end if;

    if p_dry_run then
      execute format('select count(*)::bigint from public.%I where %I = %L::uuid',
                     v_step.tbl, v_step.col, p_user_id)
        into v_rows;
      v_action := case when p_reassign_to is null then 'would_detach' else 'would_reassign' end;
    else
      execute format('update public.%I set %I = %s where %I = %L::uuid',
                     v_step.tbl, v_step.col, v_set, v_step.col, p_user_id);
      get diagnostics v_rows = row_count;
      v_action := case when p_reassign_to is null then 'detached' else 'reassigned' end;
    end if;

    if coalesce(v_rows, 0) > 0 then
      step_no       := v_step.step_no;
      object_name   := format('public.%s.%s', v_step.tbl, v_step.col);
      action        := v_action;
      affected_rows := v_rows;
      v_total       := v_total + v_rows;
      return next;
    end if;
  end loop;

  ---------------------------------------------------------------------
  -- 2. Delete the account's own rows, children before parents
  ---------------------------------------------------------------------
  for v_step in
    select *
      from (values
        -- invites the user sent (invited_by is NOT NULL, cannot be detached)
        ( 20, 'recruiter_team_invite_audit_logs',    $p$invited_by = %2$L::uuid or invite_id in (select invite_id from public.recruiter_team_invites where invited_by = %2$L::uuid or invited_user_id = %2$L::uuid)$p$),
        ( 21, 'recruiter_team_invites',              $p$invited_by = %2$L::uuid or invited_user_id = %2$L::uuid$p$),
        -- notifications addressed to this person
        ( 22, 'interview_notification_deliveries',   $p$recipient_user_id = %2$L::uuid$p$),
        -- session / device / preference state
        ( 23, 'user_sessions',                       $p$user_id = %2$L::uuid or device_id in (select device_id from public.user_devices where user_id = %2$L::uuid)$p$),
        ( 24, 'user_devices',                        $p$user_id = %2$L::uuid$p$),
        ( 25, 'user_primary_skills',                 $p$user_id = %2$L::uuid$p$),
        ( 26, 'user_roles',                          $p$user_id = %2$L::uuid$p$),
        ( 27, 'dashboard_alert_reads',               $p$user_id = %2$L::uuid$p$),
        ( 28, 'audit_logs',                          $p$user_id = %2$L::uuid$p$),
        ( 29, 'identity_verification_assets',        $p$user_id = %2$L::uuid$p$),
        ( 30, 'recruiter_user_permission_overrides', $p$user_id = %2$L::uuid$p$),
        -- profiles: candidate_profiles.candidate_id is a FK onto users.user_id
        ( 31, 'candidate_profiles',                  $p$candidate_id = %2$L::uuid$p$),
        ( 32, 'candidate_skill_profile',             $p$candidate_id = %2$L::uuid$p$),
        ( 33, 'recruiter_profiles',                  $p$recruiter_id = %2$L::uuid$p$),
        ( 34, 'platform_admins',                     $p$user_id = %2$L::uuid$p$),
        ( 35, 'organization_memberships',            $p$legacy_user_id = %2$L::uuid or auth_user_id = (select u.auth_user_id from public.users u where u.user_id = %2$L::uuid)$p$),
        ( 36, 'users',                               $p$user_id = %2$L::uuid$p$)
      ) as s(step_no, tbl, pred)
     order by s.step_no
  loop
    if to_regclass('public.' || v_step.tbl) is null then
      continue;
    end if;

    if p_dry_run then
      v_sql := format('select count(*)::bigint from public.%1$I where ' || v_step.pred,
                      v_step.tbl, p_user_id);
      execute v_sql into v_rows;
      v_action := 'would_delete';
    else
      v_sql := format('delete from public.%1$I where ' || v_step.pred,
                      v_step.tbl, p_user_id);
      execute v_sql;
      get diagnostics v_rows = row_count;
      v_action := 'deleted';
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
  -- 3. Orphaned login rows
  --
  -- identity_users / auth_users can be shared (the same person may hold
  -- accounts in several orgs), so they only go when no OTHER user still
  -- references them. Phrasing it as "no other user" rather than "no user
  -- at all" keeps the dry run honest, since in preview mode this account
  -- has not been deleted yet.
  ---------------------------------------------------------------------
  for v_step in
    select *
      from (values
        ( 40, 'auth_sessions',          $p$identity_id = %3$L::uuid and not exists (select 1 from public.users u where u.identity_id = %3$L::uuid and u.user_id <> %2$L::uuid)$p$),
        ( 41, 'auth_legal_acceptances', $p$identity_id = %3$L::uuid and not exists (select 1 from public.users u where u.identity_id = %3$L::uuid and u.user_id <> %2$L::uuid)$p$),
        ( 42, 'user_otps',              $p$identity_id = %3$L::uuid and not exists (select 1 from public.users u where u.identity_id = %3$L::uuid and u.user_id <> %2$L::uuid)$p$),
        ( 43, 'identity_users',         $p$identity_id = %3$L::uuid
                                          and not exists (select 1 from public.users u where u.identity_id = %3$L::uuid and u.user_id <> %2$L::uuid)
                                          and not exists (select 1 from public.candidate_identity_links l where l.identity_id = %3$L::uuid)$p$),
        ( 44, 'auth_users',             $p$id = %4$L::uuid
                                          and not exists (select 1 from public.users u where u.auth_user_id = %4$L::uuid and u.user_id <> %2$L::uuid)
                                          and not exists (select 1 from public.organization_memberships m where m.auth_user_id = %4$L::uuid)$p$)
      ) as s(step_no, tbl, pred)
     order by s.step_no
  loop
    if to_regclass('public.' || v_step.tbl) is null then
      continue;
    end if;

    -- nothing to orphan if the account had no identity / auth row
    if (v_step.tbl = 'auth_users' and v_auth_user_id is null)
       or (v_step.tbl <> 'auth_users' and v_identity_id is null) then
      continue;
    end if;

    if p_dry_run then
      v_sql := format('select count(*)::bigint from public.%1$I where ' || v_step.pred,
                      v_step.tbl, p_user_id, v_identity_id, v_auth_user_id);
      execute v_sql into v_rows;
      v_action := 'would_delete_orphan';
    else
      v_sql := format('delete from public.%1$I where ' || v_step.pred,
                      v_step.tbl, p_user_id, v_identity_id, v_auth_user_id);
      execute v_sql;
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

  ---------------------------------------------------------------------
  -- 4. Safety net
  --
  -- No uuid column that can hold a users.user_id may still contain this
  -- one. This catches the authorship columns the schema does not back
  -- with a foreign key. Raising aborts the caller's transaction, so the
  -- account is never half-deleted.
  --
  -- Only meaningful on a real run: in a dry run nothing has been deleted
  -- yet, so every reference would trivially still be there.
  ---------------------------------------------------------------------
  if not p_dry_run then
    for v_step in
      select c.table_name as tbl, c.column_name as col
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema
         and t.table_name = c.table_name
         and t.table_type = 'BASE TABLE'
       where c.table_schema = 'public'
         and c.data_type = 'uuid'
         and c.column_name in ('user_id', 'created_by', 'updated_by', 'invited_by',
                               'invited_user_id', 'issued_by', 'decided_by',
                               'recipient_user_id', 'recruiter_id', 'requested_by_user_id')
       order by c.table_name, c.column_name
    loop
      execute format('select count(*)::bigint from public.%I where %I = %L::uuid',
                     v_step.tbl, v_step.col, p_user_id)
        into v_rows;

      if coalesce(v_rows, 0) > 0 then
        raise exception
          'hv_delete_user: % reference(s) to user % survived in public.%.% - add it to the plan or to the authorship list',
          v_rows, p_user_id, v_step.tbl, v_step.col;
      end if;
    end loop;
  end if;

  ---------------------------------------------------------------------
  -- 5. Summary line
  ---------------------------------------------------------------------
  step_no       := 999;
  object_name   := format('TOTAL for %s (%s) in %s', coalesce(v_email, '?'), p_user_id,
                          coalesce(v_org_name, '?'));
  action        := case when p_dry_run then 'dry_run' else 'deleted' end;
  affected_rows := v_total;
  return next;

  return;
end;
$fn$;

comment on function public.hv_delete_user(uuid, boolean, uuid, boolean) is
  'Deletes one user account and its personal data, leaving the organization and the records the user authored intact (reassigned to p_reassign_to, or detached to NULL). Dry run by default. Refuses to remove an org''s last Global Administrator or a platform admin unless p_force.';

-- Lock it down: this is a service-role / DBA tool, never an app-facing RPC.
revoke all on function public.hv_delete_user(uuid, boolean, uuid, boolean) from public;
revoke all on function public.hv_delete_user(uuid, boolean, uuid, boolean) from anon, authenticated;
grant execute on function public.hv_delete_user(uuid, boolean, uuid, boolean) to service_role;
