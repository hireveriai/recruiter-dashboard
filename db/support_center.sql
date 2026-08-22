create table if not exists public.support_request_categories (
  category_code text primary key,
  label text not null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.support_request_categories (category_code, label, sort_order)
values
  ('TECHNICAL_ISSUE', 'Technical Issue', 10),
  ('INTERVIEW_RECORDING_ISSUE', 'Interview Recording Issue', 20),
  ('AI_ANALYSIS_ISSUE', 'AI Analysis Issue', 30),
  ('BILLING_SUBSCRIPTION', 'Billing & Subscription', 40),
  ('ACCESS_PERMISSIONS', 'Access & Permissions', 50),
  ('SECURITY_CONCERN', 'Security Concern', 60),
  ('ENTERPRISE_SALES', 'Enterprise Sales', 70),
  ('COMPLIANCE_REQUEST', 'Compliance Request', 80)
on conflict (category_code) do update
set
  label = excluded.label,
  sort_order = excluded.sort_order,
  is_active = true;

create table if not exists public.support_center_seed_data (
  config_key text not null,
  item_key text not null,
  label text not null,
  value text not null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (config_key, item_key)
);

insert into public.support_center_seed_data (config_key, item_key, label, value, sort_order)
values
  ('sidebar', 'support_email', 'Support Desk', 'support@verisnova.com', 10),
  ('system_status', 'platform', 'Platform Operational', 'Live', 10),
  ('system_status', 'ai_systems', 'AI Systems Active', 'Active', 20),
  ('system_status', 'recording', 'Recording Infrastructure Healthy', 'Healthy', 30),
  ('sla', 'critical', 'Critical', '<2 Hours', 10),
  ('sla', 'standard', 'Standard', '<24 Hours', 20),
  ('sla', 'enterprise', 'Enterprise Priority Routing', 'Included', 30)
on conflict (config_key, item_key) do update
set
  label = excluded.label,
  value = excluded.value,
  sort_order = excluded.sort_order,
  is_active = true;

create table if not exists public.support_requests (
  support_request_id uuid primary key default gen_random_uuid(),
  reference_id text not null unique,
  full_name text not null,
  work_email text not null,
  organization text not null,
  priority text not null,
  category_code text not null references public.support_request_categories(category_code),
  message text not null,
  attachment_metadata jsonb,
  attachment_filename text,
  attachment_content_type text,
  attachment_size_bytes integer,
  attachment_content bytea,
  status text not null default 'OPEN',
  support_email_status text not null default 'PENDING',
  requester_email_status text not null default 'PENDING',
  support_email_error text,
  requester_email_error text,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_requests_priority_valid check (priority in ('Critical', 'High', 'Standard', 'Low')),
  constraint support_requests_work_email_valid check (work_email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$')
);

alter table public.support_requests
  add column if not exists attachment_filename text,
  add column if not exists attachment_content_type text,
  add column if not exists attachment_size_bytes integer,
  add column if not exists attachment_content bytea;

create index if not exists idx_support_requests_reference_id
  on public.support_requests (reference_id);

create index if not exists idx_support_requests_created_at
  on public.support_requests (created_at desc);

create index if not exists idx_support_requests_category_priority
  on public.support_requests (category_code, priority, created_at desc);
