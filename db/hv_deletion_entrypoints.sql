-- =====================================================================
-- Deletion entrypoints - everything runs in SQL, no application code.
-- ---------------------------------------------------------------------
-- EVERYTHING IS ADDRESSED BY PRIMARY KEY, never by name.
--   public.organizations.organization_name has no unique constraint, so
--   two workspaces may legitimately share a name. Selecting a purge target
--   by name would be ambiguous - it could match the wrong workspace, or
--   refuse to run at all. The name survives only as a typed confirmation,
--   checked against the row the id resolved to.
--
-- Step 1 - find the id (duplicate_name flags a shared name):
--   select * from public.hv_find_organizations('acme');
--   select * from public.hv_find_users('leaver@example.com');
--
-- Step 2 - preview (deletes nothing):
--   select * from public.hv_purge_organization_complete('<org-uuid>');
--
-- Step 3 - for real:
--   begin;
--   select * from public.hv_purge_organization_complete(
--     '<org-uuid>',
--     false,
--     'https://qvhbtxionaquyyuktdsr.supabase.co',
--     '<service-role-key>',
--     'Exact Name Of That Organization');
--   commit;   -- or rollback if the numbers look wrong
--
-- One user, handing their work to a colleague:
--   select * from public.hv_delete_user_complete(
--     '<user-uuid>', false, '<successor-user-uuid>',
--     'https://qvhbtxionaquyyuktdsr.supabase.co', '<service-role-key>');
--
-- CAVEAT on rollback: the row deletions are transactional, but the Storage
-- API calls are not. Once the storage phase has run, rolling back restores
-- the rows and NOT the files. Preview first.
--
-- Requires: hv_storage_refs.sql, hv_purge_organization.sql, hv_delete_user.sql
-- =====================================================================


-- =====================================================================
-- 1. Finders - identify the right row when several share a name
-- =====================================================================
create or replace function public.hv_find_organizations(
  p_search text default null
)
returns table (
  organization_id   uuid,
  organization_name text,
  is_active         boolean,
  created_at        timestamptz,
  users             bigint,
  candidates        bigint,
  interviews        bigint,
  duplicate_name    boolean
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select o.organization_id,
         o.organization_name,
         o.is_active,
         o.created_at,
         (select count(*) from public.users u where u.organization_id = o.organization_id),
         (select count(*) from public.candidates c where c.organization_id = o.organization_id),
         (select count(*) from public.interviews i where i.organization_id = o.organization_id),
         (select count(*) > 1 from public.organizations d
           where lower(btrim(d.organization_name)) = lower(btrim(o.organization_name)))
    from public.organizations o
   where p_search is null
      or o.organization_name ilike '%' || btrim(p_search) || '%'
      or o.organization_id::text = btrim(p_search)
   order by o.organization_name, o.created_at;
$fn$;

comment on function public.hv_find_organizations(text) is
  'Lists organizations with their row counts so the right organization_id can be picked before a purge. duplicate_name flags names shared by more than one workspace.';


create or replace function public.hv_find_users(
  p_search text default null
)
returns table (
  user_id           uuid,
  email             text,
  full_name         text,
  is_active         boolean,
  recruiter_role    text,
  organization_id   uuid,
  organization_name text,
  duplicate_email   boolean
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  select u.user_id,
         u.email,
         u.full_name,
         u.is_active,
         rrp.code,
         u.organization_id,
         o.organization_name,
         (select count(*) > 1 from public.users d
           where lower(btrim(d.email)) = lower(btrim(u.email)))
    from public.users u
    join public.organizations o using (organization_id)
    left join public.recruiter_profiles rp on rp.recruiter_id = u.user_id
    left join public.recruiter_role_pool rrp on rrp.recruiter_role_id = rp.recruiter_role_id
   where p_search is null
      or u.email ilike '%' || btrim(p_search) || '%'
      or u.full_name ilike '%' || btrim(p_search) || '%'
      or u.user_id::text = btrim(p_search)
      or o.organization_name ilike '%' || btrim(p_search) || '%'
   order by u.email, o.organization_name;
$fn$;

comment on function public.hv_find_users(text) is
  'Lists user accounts with their organization so the right user_id can be picked before a deletion.';


-- =====================================================================
-- 2. Storage cleanup
--
-- Postgres cannot delete Storage files with a DELETE statement. Supabase
-- installs a protect_delete() trigger on storage.objects that rejects it:
--   "Direct deletion from storage tables is not allowed. Use the Storage
--    API instead. This prevents accidental data loss from orphaned
--    objects."
-- Removing a file genuinely requires an HTTPS call, so these functions
-- make one with pg_net:
--
--   create extension if not exists pg_net with schema extensions;
--
-- Requests go to the bulk endpoint - DELETE /storage/v1/object/{bucket}
-- with {"prefixes":[...]} - in chunks of 100, so a few thousand files cost
-- a few dozen requests rather than one each.
--
-- Without pg_net a dry run still reports exactly what would be removed and
-- a destructive run RAISES, rather than silently leaving files behind.
-- =====================================================================

-- True when pg_net is enabled and exposes the body-carrying http_delete.
create or replace function public.hv_pg_net_available()
returns boolean
language sql
stable
as $fn$
  select exists (select 1 from pg_extension where extname = 'pg_net')
     and to_regprocedure('net.http_delete(text, jsonb, jsonb, integer, jsonb)') is not null;
$fn$;

comment on function public.hv_pg_net_available() is
  'True when the pg_net extension is enabled, which is what lets the storage purge functions call the Storage API.';


-- One bulk Storage API DELETE: many object paths within a single bucket.
create or replace function public.hv_storage_api_delete_batch(
  p_bucket_id    text,
  p_paths        text[],
  p_supabase_url text,
  p_service_key  text
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_url text;
  v_id  bigint;
begin
  if p_paths is null or array_length(p_paths, 1) is null then
    return null;
  end if;

  v_url := rtrim(p_supabase_url, '/')
           || '/storage/v1/object/'
           || replace(replace(replace(p_bucket_id, ' ', '%20'), '(', '%28'), ')', '%29');

  -- Called dynamically so this function still compiles when pg_net is absent.
  execute format(
    'select net.http_delete(url => %L, headers => %L::jsonb, body => %L::jsonb, timeout_milliseconds => 30000)',
    v_url,
    jsonb_build_object('apikey', p_service_key,
                       'Authorization', 'Bearer ' || p_service_key,
                       'Content-Type', 'application/json')::text,
    jsonb_build_object('prefixes', to_jsonb(p_paths))::text
  ) into v_id;

  return v_id;
end;
$fn$;

comment on function public.hv_storage_api_delete_batch(text, text[], text, text) is
  'Queues one bulk Storage API DELETE (many object paths in one bucket) via pg_net. Returns the pg_net request id; the response lands in net._http_response.';


create or replace function public.hv_purge_organization_storage(
  p_organization_id uuid,
  p_dry_run         boolean default true,
  p_supabase_url    text    default null,
  p_service_key     text    default null
)
returns table (
  step_no       integer,
  object_name   text,
  action        text,
  affected_rows bigint
)
language plpgsql
security definer
set search_path = public, storage, extensions, pg_catalog
as $fn$
declare
  v_listed   bigint;
  v_present  bigint;
  v_objects  bigint := 0;
  v_requests bigint := 0;
  r          record;
begin
  if p_organization_id is null then
    raise exception 'hv_purge_organization_storage: p_organization_id is required';
  end if;

  if not exists (select 1 from public.organizations o
                  where o.organization_id = p_organization_id) then
    raise exception 'hv_purge_organization_storage: organization % does not exist', p_organization_id;
  end if;

  select count(*)::bigint into v_listed
    from public.hv_organization_storage_objects(p_organization_id);

  -- Only objects that really exist in a bucket are worth a request; plenty of
  -- recording rows point at paths that were never uploaded.
  create temp table if not exists hv_storage_hits (
    bucket_id text, object_path text
  ) on commit drop;
  delete from hv_storage_hits;

  insert into hv_storage_hits (bucket_id, object_path)
  select distinct o.bucket_id, o.name
    from public.hv_organization_storage_objects(p_organization_id) x
    join storage.objects o
      on o.bucket_id = x.bucket_id and o.name = x.object_path;

  select count(*)::bigint into v_present from hv_storage_hits;

  step_no := 1; object_name := 'referenced by this organization';
  action := 'listed'; affected_rows := v_listed; return next;

  step_no := 2; object_name := 'present in storage.objects';
  action := 'found'; affected_rows := v_present; return next;

  if p_dry_run then
    step_no := 3; object_name := 'storage API';
    action := case when v_present = 0 then 'nothing_to_delete'
                   when public.hv_pg_net_available() then 'would_delete_via_pg_net'
                   else 'BLOCKED: run "create extension if not exists pg_net with schema extensions"'
              end;
    affected_rows := v_present; return next;
    return;
  end if;

  -- Nothing to do means no need to demand Storage credentials.
  if v_present = 0 then
    step_no := 3; object_name := 'storage API';
    action := 'nothing_to_delete'; affected_rows := 0; return next;
    return;
  end if;

  if not public.hv_pg_net_available() then
    raise exception
      'hv_purge_organization_storage: pg_net is not enabled, so % file(s) cannot be deleted from SQL', v_present
      using hint = 'Run: create extension if not exists pg_net with schema extensions;';
  end if;

  if p_supabase_url is null or p_service_key is null then
    raise exception
      'hv_purge_organization_storage: p_supabase_url and p_service_key are required to delete % file(s)', v_present;
  end if;

  for r in
    select s.bucket_id, array_agg(s.object_path) as paths
      from (
        select h.bucket_id, h.object_path,
               ((row_number() over (partition by h.bucket_id order by h.object_path)) - 1) / 100 as chunk
          from hv_storage_hits h
      ) s
     group by s.bucket_id, s.chunk
  loop
    perform public.hv_storage_api_delete_batch(r.bucket_id, r.paths, p_supabase_url, p_service_key);
    v_requests := v_requests + 1;
    v_objects  := v_objects + array_length(r.paths, 1);
  end loop;

  step_no := 3; object_name := 'storage API objects';
  action := 'queued_delete_via_pg_net'; affected_rows := v_objects; return next;

  step_no := 4; object_name := 'storage API requests';
  action := 'queued_via_pg_net'; affected_rows := v_requests; return next;

  step_no := 5;
  object_name := 'NOTE: pg_net is asynchronous - check net._http_response for failures';
  action := 'info'; affected_rows := 0; return next;
  return;
end;
$fn$;

comment on function public.hv_purge_organization_storage(uuid, boolean, text, text) is
  'Deletes every Supabase Storage object an organization references, via bulk Storage API DELETE using pg_net. Run BEFORE hv_purge_organization. Raises if pg_net is not enabled rather than leaving files behind.';


create or replace function public.hv_delete_user_storage(
  p_user_id      uuid,
  p_dry_run      boolean default true,
  p_supabase_url text    default null,
  p_service_key  text    default null
)
returns table (
  step_no       integer,
  object_name   text,
  action        text,
  affected_rows bigint
)
language plpgsql
security definer
set search_path = public, storage, extensions, pg_catalog
as $fn$
declare
  v_listed   bigint;
  v_present  bigint;
  v_objects  bigint := 0;
  v_requests bigint := 0;
  r          record;
begin
  if p_user_id is null then
    raise exception 'hv_delete_user_storage: p_user_id is required';
  end if;

  if not exists (select 1 from public.users u where u.user_id = p_user_id) then
    raise exception 'hv_delete_user_storage: user % does not exist', p_user_id;
  end if;

  select count(*)::bigint into v_listed
    from public.hv_user_storage_objects(p_user_id);

  create temp table if not exists hv_storage_hits_user (
    bucket_id text, object_path text
  ) on commit drop;
  delete from hv_storage_hits_user;

  insert into hv_storage_hits_user (bucket_id, object_path)
  select distinct o.bucket_id, o.name
    from public.hv_user_storage_objects(p_user_id) x
    join storage.objects o
      on o.bucket_id = x.bucket_id and o.name = x.object_path;

  select count(*)::bigint into v_present from hv_storage_hits_user;

  step_no := 1; object_name := 'referenced by this user';
  action := 'listed'; affected_rows := v_listed; return next;

  step_no := 2; object_name := 'present in storage.objects';
  action := 'found'; affected_rows := v_present; return next;

  if p_dry_run then
    step_no := 3; object_name := 'storage API';
    action := case when v_present = 0 then 'nothing_to_delete'
                   when public.hv_pg_net_available() then 'would_delete_via_pg_net'
                   else 'BLOCKED: run "create extension if not exists pg_net with schema extensions"'
              end;
    affected_rows := v_present; return next;
    return;
  end if;

  if v_present = 0 then
    step_no := 3; object_name := 'storage API';
    action := 'nothing_to_delete'; affected_rows := 0; return next;
    return;
  end if;

  if not public.hv_pg_net_available() then
    raise exception
      'hv_delete_user_storage: pg_net is not enabled, so % file(s) cannot be deleted from SQL', v_present
      using hint = 'Run: create extension if not exists pg_net with schema extensions;';
  end if;

  if p_supabase_url is null or p_service_key is null then
    raise exception
      'hv_delete_user_storage: p_supabase_url and p_service_key are required to delete % file(s)', v_present;
  end if;

  for r in
    select s.bucket_id, array_agg(s.object_path) as paths
      from (
        select h.bucket_id, h.object_path,
               ((row_number() over (partition by h.bucket_id order by h.object_path)) - 1) / 100 as chunk
          from hv_storage_hits_user h
      ) s
     group by s.bucket_id, s.chunk
  loop
    perform public.hv_storage_api_delete_batch(r.bucket_id, r.paths, p_supabase_url, p_service_key);
    v_requests := v_requests + 1;
    v_objects  := v_objects + array_length(r.paths, 1);
  end loop;

  step_no := 3; object_name := 'storage API objects';
  action := 'queued_delete_via_pg_net'; affected_rows := v_objects; return next;

  step_no := 4; object_name := 'storage API requests';
  action := 'queued_via_pg_net'; affected_rows := v_requests; return next;

  step_no := 5;
  object_name := 'NOTE: pg_net is asynchronous - check net._http_response for failures';
  action := 'info'; affected_rows := 0; return next;
  return;
end;
$fn$;

comment on function public.hv_delete_user_storage(uuid, boolean, text, text) is
  'Deletes every Supabase Storage object a user references, via bulk Storage API DELETE using pg_net. Run BEFORE hv_delete_user.';


-- =====================================================================
-- 3. The complete deletions - files and rows in one call, keyed by id
-- =====================================================================
create or replace function public.hv_purge_organization_complete(
  p_organization_id           uuid,
  p_dry_run                   boolean default true,
  p_supabase_url              text    default null,
  p_service_key               text    default null,
  p_confirm_organization_name text    default null,
  p_purge_orphan_identities   boolean default true
)
returns table (
  phase         text,
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
  v_exact text;
  r       record;
begin
  if p_organization_id is null then
    raise exception 'hv_purge_organization_complete: p_organization_id is required'
      using hint = 'select * from public.hv_find_organizations();';
  end if;

  select o.organization_name into v_exact
    from public.organizations o
   where o.organization_id = p_organization_id;

  if not found then
    raise exception 'hv_purge_organization_complete: organization % does not exist', p_organization_id
      using hint = 'select * from public.hv_find_organizations();';
  end if;

  -- The name is a CHECK, not a lookup key: several workspaces may share a
  -- name, but only one has this id.
  if not p_dry_run
     and (p_confirm_organization_name is null
          or btrim(p_confirm_organization_name) is distinct from v_exact) then
    raise exception
      'hv_purge_organization_complete: destructive run requires p_confirm_organization_name to equal % (the name of organization %)',
      coalesce(v_exact, '<null>'), p_organization_id;
  end if;

  -- 1. Files. Must run first: the rows naming them are about to be deleted.
  for r in
    select * from public.hv_purge_organization_storage(
      p_organization_id, p_dry_run, p_supabase_url, p_service_key)
  loop
    phase := 'storage'; step_no := r.step_no; object_name := r.object_name;
    action := r.action; affected_rows := r.affected_rows; return next;
  end loop;

  -- 2. Rows.
  for r in
    select * from public.hv_purge_organization(
      p_organization_id, p_dry_run,
      case when p_dry_run then null else v_exact end,
      p_purge_orphan_identities)
  loop
    phase := 'database'; step_no := r.step_no; object_name := r.object_name;
    action := r.action; affected_rows := r.affected_rows; return next;
  end loop;

  return;
end;
$fn$;

comment on function public.hv_purge_organization_complete(uuid, boolean, text, text, text, boolean) is
  'Full organization deletion in one call, addressed by organization_id: Supabase Storage files first, then every database row. Dry run by default; a destructive run must echo back the exact organization_name of that id.';


create or replace function public.hv_delete_user_complete(
  p_user_id      uuid,
  p_dry_run      boolean default true,
  p_reassign_to  uuid    default null,
  p_supabase_url text    default null,
  p_service_key  text    default null,
  p_force        boolean default false
)
returns table (
  phase         text,
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
  r record;
begin
  if p_user_id is null then
    raise exception 'hv_delete_user_complete: p_user_id is required'
      using hint = 'select * from public.hv_find_users();';
  end if;

  if not exists (select 1 from public.users u where u.user_id = p_user_id) then
    raise exception 'hv_delete_user_complete: user % does not exist', p_user_id
      using hint = 'select * from public.hv_find_users();';
  end if;

  for r in
    select * from public.hv_delete_user_storage(
      p_user_id, p_dry_run, p_supabase_url, p_service_key)
  loop
    phase := 'storage'; step_no := r.step_no; object_name := r.object_name;
    action := r.action; affected_rows := r.affected_rows; return next;
  end loop;

  for r in
    select * from public.hv_delete_user(p_user_id, p_dry_run, p_reassign_to, p_force)
  loop
    phase := 'database'; step_no := r.step_no; object_name := r.object_name;
    action := r.action; affected_rows := r.affected_rows; return next;
  end loop;

  return;
end;
$fn$;

comment on function public.hv_delete_user_complete(uuid, boolean, uuid, text, text, boolean) is
  'Full user deletion in one call, addressed by user_id: Supabase Storage files first, then the account rows. Dry run by default.';


-- Service-role / DBA tooling only; never app-facing RPCs.
revoke all on function public.hv_find_organizations(text) from public, anon, authenticated;
revoke all on function public.hv_find_users(text) from public, anon, authenticated;
revoke all on function public.hv_purge_organization_storage(uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function public.hv_delete_user_storage(uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function public.hv_storage_api_delete_batch(text, text[], text, text) from public, anon, authenticated;
revoke all on function public.hv_purge_organization_complete(uuid, boolean, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.hv_delete_user_complete(uuid, boolean, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.hv_find_organizations(text) to service_role;
grant execute on function public.hv_find_users(text) to service_role;
grant execute on function public.hv_purge_organization_storage(uuid, boolean, text, text) to service_role;
grant execute on function public.hv_delete_user_storage(uuid, boolean, text, text) to service_role;
grant execute on function public.hv_storage_api_delete_batch(text, text[], text, text) to service_role;
grant execute on function public.hv_purge_organization_complete(uuid, boolean, text, text, text, boolean) to service_role;
grant execute on function public.hv_delete_user_complete(uuid, boolean, uuid, text, text, boolean) to service_role;

-- Name/email-addressed variants from earlier revisions: removed because
-- organization_name is not unique and selecting a purge target by a
-- non-unique key is a footgun. Use hv_find_organizations() to get the id.
drop function if exists public.hv_purge_organization_by_name(text, boolean, boolean);
drop function if exists public.hv_delete_user_by_email(text, boolean, text, text, boolean);
drop function if exists public.hv_purge_organization_complete(text, boolean, text, text, boolean);
drop function if exists public.hv_delete_user_complete(text, boolean, text, text, text, text, boolean);
drop function if exists public.hv_purge_organization_storage(uuid, boolean);
drop function if exists public.hv_delete_user_storage(uuid, boolean);
drop function if exists public.hv_storage_api_delete(text, text, text, text);

-- =====================================================================
-- INSTALLING (order matters - hv_storage_refs.sql defines helpers the
-- others use):
--
--   create extension if not exists pg_net with schema extensions;
--
--   psql "$DATABASE_URL" \
--     -f db/hv_storage_refs.sql \
--     -f db/hv_purge_organization.sql \
--     -f db/hv_delete_user.sql \
--     -f db/hv_deletion_entrypoints.sql
--
-- No psql? Paste the four files in that order into the Supabase SQL
-- editor, or apply them as migrations with the Supabase CLI.
-- =====================================================================
