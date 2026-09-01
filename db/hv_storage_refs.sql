-- =====================================================================
-- hv_storage_ref / hv_organization_storage_objects / hv_user_storage_objects
-- ---------------------------------------------------------------------
-- The purge functions can only delete ROWS. The files those rows point at
-- live in Supabase Storage and have to be removed through the Storage API,
-- which Postgres cannot call.
--
-- These helpers close that gap by listing exactly which objects belong to
-- an organization or a user, so a caller can capture the list BEFORE the
-- purge and delete the objects afterwards.
--
-- USAGE
--   select * from public.hv_organization_storage_objects('<org-uuid>');
--   select * from public.hv_user_storage_objects('<user-uuid>');
--
-- NOTE: deleting rows from storage.objects does NOT free the underlying
-- S3 object, which is why these return a list instead of deleting.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Normalise the three shapes these columns hold into (bucket, path):
--   'interviews/abc.webm'                        -> default bucket
--   'recordings/interviews/abc.webm'             -> explicit bucket prefix
--   'https://x.supabase.co/storage/v1/object/public/recordings/a.webm'
-- Returns zero rows for null/blank input, or when no bucket can be
-- determined.
-- ---------------------------------------------------------------------
create or replace function public.hv_storage_ref(
  p_value          text,
  p_default_bucket text
)
returns table (bucket_id text, object_path text)
language plpgsql
immutable
as $fn$
declare
  v_raw     text := nullif(btrim(coalesce(p_value, '')), '');
  v_match   text[];
  v_bucket  text;
  v_path    text;
begin
  if v_raw is null then
    return;
  end if;

  if v_raw ~* '^https?://' then
    -- /storage/v1/object/{public|sign|authenticated}/{bucket}/{key...}
    v_match := regexp_match(
      v_raw,
      '/storage/v1/object/(?:public/|sign/|authenticated/)?([^/?#]+)/([^?#]+)'
    );
    if v_match is null then
      return;
    end if;
    -- percent-decode the two segments we care about
    bucket_id   := replace(replace(v_match[1], '%20', ' '), '%28', '(');
    object_path := replace(v_match[2], '%20', ' ');
    return next;
    return;
  end if;

  v_path := ltrim(v_raw, '/');

  -- an explicit "bucket/key" prefix wins over the caller's default
  select b.id
    into v_bucket
    from storage.buckets b
   where v_path like b.id || '/%'
   order by length(b.id) desc
   limit 1;

  if v_bucket is not null then
    bucket_id   := v_bucket;
    object_path := substr(v_path, length(v_bucket) + 2);
    return next;
    return;
  end if;

  if p_default_bucket is null then
    return;
  end if;

  bucket_id   := p_default_bucket;
  object_path := v_path;
  return next;
end;
$fn$;

comment on function public.hv_storage_ref(text, text) is
  'Normalises a stored file reference (bare key, bucket-prefixed key, or Storage URL) into (bucket_id, object_path).';

-- ---------------------------------------------------------------------
-- Every stored object belonging to one organization.
-- ---------------------------------------------------------------------
create or replace function public.hv_organization_storage_objects(
  p_organization_id uuid
)
returns table (bucket_id text, object_path text, source text)
language sql
stable
security definer
set search_path = public, storage, pg_catalog
as $fn$
  with org_candidates as (
    select c.candidate_id from public.candidates c
     where c.organization_id = p_organization_id
  ),
  org_users as (
    select u.user_id from public.users u
     where u.organization_id = p_organization_id
  ),
  org_interviews as (
    select i.interview_id from public.interviews i
     where i.organization_id = p_organization_id
  ),
  org_attempts as (
    select a.attempt_id from public.interview_attempts a
     where a.interview_id in (select interview_id from org_interviews)
  ),
  org_resumes as (
    select r.resume_id, r.file_path from public.candidate_resumes r
     where r.candidate_id in (select candidate_id from org_candidates)
  ),
  org_resume_sessions as (
    select s.session_id from public.resume_enhancement_sessions s
     where s.candidate_id in (select candidate_id from org_candidates)
  ),
  raw as (
    select v.value, v.default_bucket, v.source
      from public.interview_recordings rec
      cross join lateral (values
        (rec.file_path, 'recordings', 'interview_recordings.file_path'),
        (rec.audio_url, 'recordings', 'interview_recordings.audio_url'),
        (rec.video_url, 'recordings', 'interview_recordings.video_url')
      ) as v(value, default_bucket, source)
     where rec.attempt_id in (select attempt_id from org_attempts)

    union all
    select r.file_path, 'resumes', 'candidate_resumes.file_path'
      from org_resumes r

    union all
    select v.value, 'resumes', v.source
      from public.resume_exports e
      cross join lateral (values
        (e.pdf_path, 'resume_exports.pdf_path'),
        (e.docx_path, 'resume_exports.docx_path')
      ) as v(value, source)
     where e.session_id in (select session_id from org_resume_sessions)
        or e.candidate_resume_id in (select resume_id from org_resumes)

    union all
    select a.file_url, 'candidate-verification', 'identity_verification_assets.file_url'
      from public.identity_verification_assets a
     where a.interview_id in (select interview_id from org_interviews)
        or a.user_id in (select user_id from org_users)

    union all
    select v.value, inv.invoice_pdf_bucket, v.source
      from public.invoices inv
      cross join lateral (values
        (inv.invoice_pdf_key, 'invoices.invoice_pdf_key'),
        (inv.invoice_pdf_url, 'invoices.invoice_pdf_url')
      ) as v(value, source)
     where inv.organization_id = p_organization_id
  )
  select distinct ref.bucket_id, ref.object_path, raw.source
    from raw
    cross join lateral public.hv_storage_ref(raw.value, raw.default_bucket) ref
   order by ref.bucket_id, ref.object_path;
$fn$;

comment on function public.hv_organization_storage_objects(uuid) is
  'Lists every Supabase Storage object referenced by one organization. Capture this BEFORE hv_purge_organization, then delete the objects through the Storage API.';

-- ---------------------------------------------------------------------
-- Every stored object belonging to one user account.
-- ---------------------------------------------------------------------
create or replace function public.hv_user_storage_objects(
  p_user_id uuid
)
returns table (bucket_id text, object_path text, source text)
language sql
stable
security definer
set search_path = public, storage, pg_catalog
as $fn$
  select distinct ref.bucket_id, ref.object_path,
         'identity_verification_assets.file_url'::text
    from public.identity_verification_assets a
    cross join lateral public.hv_storage_ref(a.file_url, 'candidate-verification') ref
   where a.user_id = p_user_id
   order by ref.bucket_id, ref.object_path;
$fn$;

comment on function public.hv_user_storage_objects(uuid) is
  'Lists every Supabase Storage object referenced by one user account. Capture this BEFORE hv_delete_user.';

-- Service-role / DBA tooling only.
revoke all on function public.hv_storage_ref(text, text) from public, anon, authenticated;
revoke all on function public.hv_organization_storage_objects(uuid) from public, anon, authenticated;
revoke all on function public.hv_user_storage_objects(uuid) from public, anon, authenticated;
grant execute on function public.hv_storage_ref(text, text) to service_role;
grant execute on function public.hv_organization_storage_objects(uuid) to service_role;
grant execute on function public.hv_user_storage_objects(uuid) to service_role;
