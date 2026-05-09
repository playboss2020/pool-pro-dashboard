create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'pro' check (plan in ('pro', 'enterprise')),
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'manager' check (role in ('owner', 'manager', 'technician', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table public.devices
  add column if not exists organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists property_name text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists zip text,
  add column if not exists property_notes text;

create index if not exists idx_devices_organization
  on public.devices (organization_id, property_name);

create index if not exists idx_organization_members_user
  on public.organization_members (user_id, organization_id);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

create policy "Members can read their organizations"
on public.organizations for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = organizations.id
      and m.user_id = auth.uid()
  )
);

create policy "Members can read organization members"
on public.organization_members for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.organization_members m
    where m.organization_id = organization_members.organization_id
      and m.user_id = auth.uid()
  )
);

create policy "Organization members can read fleet devices"
on public.devices for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = devices.organization_id
      and m.user_id = auth.uid()
  )
);

create policy "Organization operators can update fleet device display fields"
on public.devices for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = devices.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'manager', 'technician')
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.organization_id = devices.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'manager', 'technician')
  )
);

create policy "Organization members can read fleet commands"
on public.device_commands for select
to authenticated
using (
  exists (
    select 1
    from public.devices d
    join public.organization_members m on m.organization_id = d.organization_id
    where d.device_id = device_commands.device_id
      and m.user_id = auth.uid()
  )
);

create policy "Organization operators can create fleet commands"
on public.device_commands for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.devices d
    join public.organization_members m on m.organization_id = d.organization_id
    where d.device_id = device_commands.device_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'manager', 'technician')
  )
);

create policy "Organization members can read fleet schedules"
on public.device_schedules for select
to authenticated
using (
  exists (
    select 1
    from public.devices d
    join public.organization_members m on m.organization_id = d.organization_id
    where d.device_id = device_schedules.device_id
      and m.user_id = auth.uid()
  )
);

create policy "Organization operators can manage fleet schedules"
on public.device_schedules for all
to authenticated
using (
  exists (
    select 1
    from public.devices d
    join public.organization_members m on m.organization_id = d.organization_id
    where d.device_id = device_schedules.device_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'manager', 'technician')
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.devices d
    join public.organization_members m on m.organization_id = d.organization_id
    where d.device_id = device_schedules.device_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'manager', 'technician')
  )
);

create policy "Organization members can read fleet history"
on public.device_history for select
to authenticated
using (
  exists (
    select 1
    from public.devices d
    join public.organization_members m on m.organization_id = d.organization_id
    where d.device_id = device_history.device_id
      and m.user_id = auth.uid()
  )
);

create policy "Organization members can read fleet alerts"
on public.device_alerts for select
to authenticated
using (
  exists (
    select 1
    from public.devices d
    join public.organization_members m on m.organization_id = d.organization_id
    where d.device_id = device_alerts.device_id
      and m.user_id = auth.uid()
  )
);

create policy "Organization operators can acknowledge fleet alerts"
on public.device_alerts for update
to authenticated
using (
  exists (
    select 1
    from public.devices d
    join public.organization_members m on m.organization_id = d.organization_id
    where d.device_id = device_alerts.device_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'manager', 'technician')
  )
)
with check (
  exists (
    select 1
    from public.devices d
    join public.organization_members m on m.organization_id = d.organization_id
    where d.device_id = device_alerts.device_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'manager', 'technician')
  )
);

-- Test setup:
-- 1. Create the Pro login normally in the app/Auth UI.
--    Suggested test login:
--      Email: pro@workflowpool.test
--      Password: WorkflowPro123!
-- 2. Find that auth user's UUID in Supabase Auth.
-- 3. Run this, replacing YOUR_PRO_USER_UUID:
--
-- with org as (
--   insert into public.organizations (name, plan)
--   values ('Workflow Vacation Rentals', 'pro')
--   returning id
-- )
-- insert into public.organization_members (organization_id, user_id, role)
-- select id, 'YOUR_PRO_USER_UUID', 'owner'
-- from org;
--
-- update public.devices
-- set
--   organization_id = (select organization_id from public.organization_members where user_id = 'YOUR_PRO_USER_UUID' limit 1),
--   property_name = coalesce(property_name, 'Ocean Villa 12'),
--   address = coalesce(address, '123 Beach Ave'),
--   city = coalesce(city, 'Miami'),
--   state = coalesce(state, 'FL'),
--   zip = coalesce(zip, '33139')
-- where device_id = 'pool-hub-001';
