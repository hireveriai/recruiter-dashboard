begin;

alter table public.job_positions
  add column if not exists device_requirement text not null default 'ANY_DEVICE';

alter table public.job_positions
  drop constraint if exists chk_job_positions_device_requirement;

alter table public.job_positions
  add constraint chk_job_positions_device_requirement
  check (device_requirement in ('DESKTOP_ONLY', 'MOBILE_ONLY', 'ANY_DEVICE'));

commit;
