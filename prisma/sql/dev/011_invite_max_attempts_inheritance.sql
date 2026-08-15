-- Make interview invites inherit the interview's retry budget.
--
-- Bug: public.interview_invites.max_attempts defaulted to 1 and every creation
-- path hardcoded 1, while public.interviews.max_attempts defaults to 2. Every
-- reader resolves the budget as
--   coalesce(invite.max_attempts, interview.max_attempts, 1)
-- (see public.start_interview_session, hireveri-calm/app/page.tsx and
-- hireveri-calm/app/api/session/start/route.ts), so the invite's 1 always won
-- and the interview-level 2 was dead config.
--
-- Effect on candidates: a first attempt that died on a hardware/permission
-- fault burned the only attempt and permanently killed the link, even though
-- the interview was configured to allow a retry.

-- 1. Stop stamping a hardcoded budget onto new invites. A null here means
--    "defer to the interview", which is exactly what the readers already do.
alter table public.interview_invites
  alter column max_attempts drop default;

-- 2. Safety net for every creation path that does not set max_attempts
--    explicitly -- including prisma.interview_invites.create() in
--    hireveri-recruiter/lib/services/interview.service.ts, which never has.
--    Paths that DO set it explicitly (e.g. the single-use RECOVERY invite in
--    lib/server/services/interview-recovery.ts) are left untouched.
create or replace function public.fn_interview_invite_inherit_max_attempts()
returns trigger
language plpgsql
as $$
begin
  if new.max_attempts is null then
    select greatest(coalesce(i.max_attempts, 1), 1)
    into new.max_attempts
    from public.interviews i
    where i.interview_id = new.interview_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_interview_invite_inherit_max_attempts on public.interview_invites;
create trigger trg_interview_invite_inherit_max_attempts
before insert on public.interview_invites
for each row execute function public.fn_interview_invite_inherit_max_attempts();

-- 3. Harden the one reader that compared without a coalesce. Unused by the
--    candidate app today, but with a nullable column the bare comparison would
--    evaluate to null and reject every invite.
create or replace function public.sp_validate_invite_token(p_token text)
returns uuid
language plpgsql
as $$
DECLARE
  v_invite_id UUID;
  v_interview_id UUID;
BEGIN
  SELECT ii.invite_id, ii.interview_id INTO v_invite_id, v_interview_id
  FROM interview_invites ii
  JOIN interviews i ON i.interview_id = ii.interview_id
  WHERE ii.token = p_token
    AND ii.status = 'ACTIVE'
    AND (ii.expires_at IS NULL OR ii.expires_at > now())
    AND coalesce(ii.attempts_used, 0) < coalesce(ii.max_attempts, i.max_attempts, 1)
  FOR UPDATE OF ii;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite invalid / expired / used';
  END IF;

  UPDATE interview_invites SET attempts_used = coalesce(attempts_used, 0) + 1 WHERE invite_id = v_invite_id;

  RETURN v_interview_id;
END;
$$;

-- 4. Backfill live invites that are still usable, so candidates already holding
--    a link get the retry budget their interview was configured for.
--    Deliberately scoped:
--      - ACTIVE and not expired only (no rewriting of historical records)
--      - RECOVERY invites excluded (single-use by design)
--      - only widens, never narrows
update public.interview_invites ii
set max_attempts = i.max_attempts
from public.interviews i
where i.interview_id = ii.interview_id
  and ii.status = 'ACTIVE'
  and (ii.expires_at is null or ii.expires_at > now())
  and upper(coalesce(ii.access_type, '')) <> 'RECOVERY'
  and coalesce(ii.max_attempts, 1) < coalesce(i.max_attempts, 1);
