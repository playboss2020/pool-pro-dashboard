create table if not exists public.device_schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null references public.devices(device_id) on delete cascade,
  name text,
  override_type text not null default 'reservation_heat' check (override_type in ('reservation_heat')),
  start_date date not null,
  end_date date not null,
  start_time time not null default '08:00',
  end_time time not null default '22:00',
  pump_on boolean not null default true,
  heater_enabled boolean not null default true,
  setpoint numeric,
  suspend_regular_schedules boolean not null default true,
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (setpoint is null or (setpoint >= 50 and setpoint <= 104))
);

create index if not exists idx_device_schedule_overrides_device_dates
  on public.device_schedule_overrides (device_id, start_date, end_date)
  where status <> 'cancelled';

drop trigger if exists touch_device_schedule_overrides_updated_at on public.device_schedule_overrides;
create trigger touch_device_schedule_overrides_updated_at
before update on public.device_schedule_overrides
for each row execute function public.touch_updated_at();

alter table public.device_schedule_overrides enable row level security;

drop policy if exists "Users can read own schedule overrides" on public.device_schedule_overrides;
drop policy if exists "Users can create own schedule overrides" on public.device_schedule_overrides;
drop policy if exists "Users can update own schedule overrides" on public.device_schedule_overrides;
drop policy if exists "Users can delete own schedule overrides" on public.device_schedule_overrides;
drop policy if exists "Organization members can read fleet schedule overrides" on public.device_schedule_overrides;
drop policy if exists "Organization operators can create fleet schedule overrides" on public.device_schedule_overrides;
drop policy if exists "Organization operators can update fleet schedule overrides" on public.device_schedule_overrides;
drop policy if exists "Organization owners can delete fleet schedule overrides" on public.device_schedule_overrides;

create policy "Users can read own schedule overrides"
on public.device_schedule_overrides for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can create own schedule overrides"
on public.device_schedule_overrides for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.devices d
    where d.device_id = device_schedule_overrides.device_id
      and d.user_id = auth.uid()
      and (d.organization_id is null or public.is_org_operator(d.organization_id))
  )
);

create policy "Users can update own schedule overrides"
on public.device_schedule_overrides for update
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.devices d
    where d.device_id = device_schedule_overrides.device_id
      and d.user_id = auth.uid()
      and (d.organization_id is null or public.is_org_operator(d.organization_id))
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.devices d
    where d.device_id = device_schedule_overrides.device_id
      and d.user_id = auth.uid()
      and (d.organization_id is null or public.is_org_operator(d.organization_id))
  )
);

create policy "Users can delete own schedule overrides"
on public.device_schedule_overrides for delete
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.devices d
    where d.device_id = device_schedule_overrides.device_id
      and d.user_id = auth.uid()
      and (d.organization_id is null or public.is_org_owner(d.organization_id))
  )
);

create policy "Organization members can read fleet schedule overrides"
on public.device_schedule_overrides for select
to authenticated
using (
  exists (
    select 1
    from public.devices d
    where d.device_id = device_schedule_overrides.device_id
      and public.is_org_member(d.organization_id)
  )
);

create policy "Organization operators can create fleet schedule overrides"
on public.device_schedule_overrides for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.devices d
    where d.device_id = device_schedule_overrides.device_id
      and public.is_org_operator(d.organization_id)
  )
);

create policy "Organization operators can update fleet schedule overrides"
on public.device_schedule_overrides for update
to authenticated
using (
  exists (
    select 1
    from public.devices d
    where d.device_id = device_schedule_overrides.device_id
      and public.is_org_operator(d.organization_id)
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.devices d
    where d.device_id = device_schedule_overrides.device_id
      and public.is_org_operator(d.organization_id)
  )
);

create policy "Organization owners can delete fleet schedule overrides"
on public.device_schedule_overrides for delete
to authenticated
using (
  exists (
    select 1
    from public.devices d
    where d.device_id = device_schedule_overrides.device_id
      and public.is_org_owner(d.organization_id)
  )
);
