create or replace function public.is_org_owner(p_organization_id uuid)
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
        and m.role = 'owner'
    );
$$;

grant execute on function public.is_org_owner(uuid) to authenticated;

drop policy if exists "Users can manage own schedules" on public.device_schedules;
drop policy if exists "Users can create own schedules" on public.device_schedules;
drop policy if exists "Users can update own schedules" on public.device_schedules;
drop policy if exists "Users can delete own schedules" on public.device_schedules;

create policy "Users can create own schedules"
on public.device_schedules for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.devices
    where devices.device_id = device_schedules.device_id
      and devices.user_id = auth.uid()
      and (devices.organization_id is null or public.is_org_owner(devices.organization_id))
  )
);

create policy "Users can update own schedules"
on public.device_schedules for update
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1 from public.devices
    where devices.device_id = device_schedules.device_id
      and devices.user_id = auth.uid()
  )
)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.devices
    where devices.device_id = device_schedules.device_id
      and devices.user_id = auth.uid()
      and (devices.organization_id is null or public.is_org_owner(devices.organization_id))
  )
);

create policy "Users can delete own schedules"
on public.device_schedules for delete
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1 from public.devices
    where devices.device_id = device_schedules.device_id
      and devices.user_id = auth.uid()
      and (devices.organization_id is null or public.is_org_owner(devices.organization_id))
  )
);

drop policy if exists "Organization operators can manage fleet schedules" on public.device_schedules;
drop policy if exists "Organization operators can create fleet schedules" on public.device_schedules;
drop policy if exists "Organization operators can update fleet schedules" on public.device_schedules;
drop policy if exists "Organization owners can delete fleet schedules" on public.device_schedules;

create policy "Organization operators can create fleet schedules"
on public.device_schedules for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.devices d
    where d.device_id = device_schedules.device_id
      and public.is_org_operator(d.organization_id)
  )
);

create policy "Organization operators can update fleet schedules"
on public.device_schedules for update
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

create policy "Organization owners can delete fleet schedules"
on public.device_schedules for delete
to authenticated
using (
  exists (
    select 1
    from public.devices d
    where d.device_id = device_schedules.device_id
      and public.is_org_owner(d.organization_id)
  )
);

drop policy if exists "Organization operators can create invites" on public.organization_invites;
drop policy if exists "Organization operators can update invites" on public.organization_invites;
drop policy if exists "Organization owners can create invites" on public.organization_invites;
drop policy if exists "Organization owners can update invites" on public.organization_invites;

create policy "Organization owners can create invites"
on public.organization_invites for insert
to authenticated
with check (
  public.is_org_owner(organization_id)
  and invited_by = auth.uid()
);

create policy "Organization owners can update invites"
on public.organization_invites for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));
