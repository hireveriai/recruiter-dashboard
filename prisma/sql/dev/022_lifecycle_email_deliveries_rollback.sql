-- Rollback for 022_lifecycle_email_deliveries.sql
-- Apply against: Verisnova-Production (qvhbtxionaquyyuktdsr)

begin;

drop table if exists public.lifecycle_email_deliveries;

commit;
