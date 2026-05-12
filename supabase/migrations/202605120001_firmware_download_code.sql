alter table public.workflow_firmware_downloads
  add column if not exists code text,
  add column if not exists file_name text;
