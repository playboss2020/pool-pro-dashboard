create table if not exists public.workflow_firmware_templates (
  target text primary key check (target in ('hub', 'node')),
  version text not null default '',
  code text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.workflow_firmware_templates enable row level security;

comment on table public.workflow_firmware_templates is
  'Latest hub and node firmware templates managed by Workflow admins through the workflow-admin Edge Function.';
