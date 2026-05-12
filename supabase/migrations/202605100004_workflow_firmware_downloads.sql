create table if not exists public.workflow_firmware_downloads (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  serial_number text,
  target text not null check (target in ('hub', 'node')),
  template_version text,
  downloaded_by uuid references auth.users(id) on delete set null,
  downloaded_at timestamptz not null default now()
);

create index if not exists workflow_firmware_downloads_device_target_idx
  on public.workflow_firmware_downloads (device_id, target, downloaded_at desc);

alter table public.workflow_firmware_downloads enable row level security;

comment on table public.workflow_firmware_downloads is
  'Workflow admin audit log for generated hub/node firmware downloads.';
