begin;

update public.hireveri_user_subscriptions
set
  "expiresAt" = null,
  "updatedAt" = now()
where "expiresAt" is not null;

commit;
