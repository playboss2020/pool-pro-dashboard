create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_organization_id is not null
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id = p_organization_id
        and m.user_id = auth.uid()
    );
$$;

create or replace function public.is_org_operator(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_organization_id is not null
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id = p_organization_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'manager', 'technician')
    );
$$;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_operator(uuid) to authenticated;

drop policy if exists "Members can read their organizations" on public.organizations;
drop policy if exists "Members can read organization members" on public.organization_members;
drop policy if exists "Organization members can read fleet devices" on public.devices;
drop policy if exists "Organization operators can update fleet device display fields" on public.devices;
drop policy if exists "Organization members can read fleet commands" on public.device_commands;
drop policy if exists "Organization operators can create fleet commands" on public.device_commands;
drop policy if exists "Organization members can read fleet schedules" on public.device_schedules;
drop policy if exists "Organization operators can manage fleet schedules" on public.device_schedules;
drop policy if exists "Organization members can read fleet history" on public.device_history;
drop policy if exists "Organization members can read fleet alerts" on public.device_alerts;
drop policy if exists "Organization operators can acknowledge fleet alerts" on public.device_alerts;

create policy "Members can read their organizations"
on public.organizations for select
to authenticated
using (public.is_org_member(id));

create policy "Members can read organization members"
on public.organization_members for select
to authenticated
using (user_id = auth.uid() or public.is_org_member(organization_id));

create policy "Organization members can read fleet devices"
on public.devices for select
to authenticated
using (public.is_org_member(organization_id));

create policy "Organization operators can update fleet device display fields"
on public.devices for update
to authenticated
using (public.is_org_operator(organization_id))
with check (public.is_org_operator(organization_id));

create policy "Organization members can read fleet commands"
on public.device_commands for select
to authenticated
using (
  exists (
    select 1
    from public.devices d
    where d.device_id = device_commands.device_id
      and (d.user_id = auth.uid() or public.is_org_member(d.organization_id))
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
    where d.device_id = device_commands.device_id
      and public.is_org_operator(d.organization_id)
  )
);

create policy "Organization members can read fleet schedules"
on public.device_schedules for select
to authenticated
using (
  exists (
    select 1
    from public.devices d
    where d.device_id = device_schedules.device_id
      and (d.user_id = auth.uid() or public.is_org_member(d.organization_id))
  )
);

create policy "Organization operators can manage fleet schedules"
on public.device_schedules for all
to authenticated
using (
  exists (
    select 1
    from public.devices d
    where d.device_id = device_schedules.device_id
      and public.is_org_operator(d.organization_id)
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.devices d
    where d.device_id = device_schedules.device_id
      and public.is_org_operator(d.organization_id)
  )
);

create policy "Organization members can read fleet history"
on public.device_history for select
to authenticated
using (
  exists (
    select 1
    from public.devices d
    where d.device_id = device_history.device_id
      and (d.user_id = auth.uid() or public.is_org_member(d.organization_id))
  )
);

create policy "Organization members can read fleet alerts"
on public.device_alerts for select
to authenticated
using (
  exists (
    select 1
    from public.devices d
    where d.device_id = device_alerts.device_id
      and (d.user_id = auth.uid() or public.is_org_member(d.organization_id))
  )
);

create policy "Organization operators can acknowledge fleet alerts"
on public.device_alerts for update
to authenticated
using (
  exists (
    select 1
    from public.devices d
    where d.device_id = device_alerts.device_id
      and public.is_org_operator(d.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.devices d
    where d.device_id = device_alerts.device_id
      and public.is_org_operator(d.organization_id)
  )
);
