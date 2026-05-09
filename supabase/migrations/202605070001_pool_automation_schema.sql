create extension if not exists pgcrypto with schema extensions;

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null unique,
  name text not null default 'Pool Hub',
  current_temp numeric,
  pump_on boolean not null default false,
  heater_enabled boolean not null default false,
  heater_relay_on boolean not null default false,
  setpoint numeric,
  pump_watts numeric not null default 0,
  heater_watts numeric not null default 0,
  total_kwh numeric not null default 0,
  last_seen timestamptz,
  online_status text not null default 'offline' check (online_status in ('online', 'offline', 'unknown')),
  firmware_version text,
  wifi_rssi integer,
  updated_at timestamptz not null default now()
);

create table if not exists public.device_secrets (
  device_id text primary key references public.devices(device_id) on delete cascade,
  secret_hash text not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create table if not exists public.device_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null references public.devices(device_id) on delete cascade,
  command_type text not null check (
    command_type in (
      'pump_on',
      'pump_off',
      'heater_enable',
      'heater_disable',
      'set_setpoint',
      'sync_schedules',
      'reboot_device',
      'clear_alerts'
    )
  ),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'acknowledged', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  completed_at timestamptz,
  error text
);

create table if not exists public.device_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null references public.devices(device_id) on delete cascade,
  target text not null check (target in ('pump', 'heater')),
  start_time time,
  end_time time,
  duration_minutes integer,
  days_of_week integer[] not null default '{0,1,2,3,4,5,6}',
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.device_history (
  id uuid primary key default gen_random_uuid(),
  device_id text not null references public.devices(device_id) on delete cascade,
  current_temp numeric,
  pump_watts numeric,
  heater_watts numeric,
  total_kwh numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.device_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null references public.devices(device_id) on delete cascade,
  alert_type text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  message text not null,
  acknowledged boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_device_commands_poll
  on public.device_commands (device_id, status, created_at);

create index if not exists idx_device_history_device_created
  on public.device_history (device_id, created_at desc);

create index if not exists idx_device_schedules_device
  on public.device_schedules (device_id, target);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_devices_updated_at on public.devices;
create trigger touch_devices_updated_at
before update on public.devices
for each row execute function public.touch_updated_at();

drop trigger if exists touch_device_schedules_updated_at on public.device_schedules;
create trigger touch_device_schedules_updated_at
before update on public.device_schedules
for each row execute function public.touch_updated_at();

create or replace function public.verify_device_secret(p_device_id text, p_device_secret text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.device_secrets
    where device_id = p_device_id
      and secret_hash = extensions.crypt(p_device_secret, secret_hash)
  );
$$;

alter table public.devices enable row level security;
alter table public.device_commands enable row level security;
alter table public.device_schedules enable row level security;
alter table public.device_history enable row level security;
alter table public.device_alerts enable row level security;
alter table public.device_secrets enable row level security;

create policy "Users can read own devices"
on public.devices for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can update display fields on own devices"
on public.devices for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can read own commands"
on public.device_commands for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create own commands"
on public.device_commands for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.devices
    where devices.device_id = device_commands.device_id
      and devices.user_id = auth.uid()
  )
);

create policy "Users can read own schedules"
on public.device_schedules for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can manage own schedules"
on public.device_schedules for all
to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.devices
    where devices.device_id = device_schedules.device_id
      and devices.user_id = auth.uid()
  )
);

create policy "Users can read own history"
on public.device_history for select
to authenticated
using (
  exists (
    select 1 from public.devices
    where devices.device_id = device_history.device_id
      and devices.user_id = auth.uid()
  )
);

create policy "Users can read own alerts"
on public.device_alerts for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can acknowledge own alerts"
on public.device_alerts for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Run after creating your auth user and choosing a strong device secret:
-- insert into public.devices (user_id, device_id, name)
-- values ('YOUR_AUTH_USER_UUID', 'pool-hub-001', 'Pool Hub');
--
-- insert into public.device_secrets (device_id, secret_hash)
-- values ('pool-hub-001', extensions.crypt('CHANGE_THIS_DEVICE_SECRET', extensions.gen_salt('bf')));
