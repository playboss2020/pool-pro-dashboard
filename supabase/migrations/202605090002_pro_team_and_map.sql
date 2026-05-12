alter table public.organization_members
  add column if not exists display_name text,
  add column if not exists email text;

update public.organization_members m
set email = u.email
from auth.users u
where m.user_id = u.id
  and m.email is null;

create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'manager' check (role in ('owner', 'manager', 'technician', 'viewer')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled', 'expired')),
  invited_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  expires_at timestamptz
);

create unique index if not exists idx_organization_invites_pending_email
  on public.organization_invites (organization_id, lower(email))
  where status = 'pending';

create index if not exists idx_organization_invites_org_status
  on public.organization_invites (organization_id, status, created_at desc);

alter table public.organization_invites enable row level security;

drop policy if exists "Organization members can read invites" on public.organization_invites;
drop policy if exists "Organization operators can create invites" on public.organization_invites;
drop policy if exists "Organization operators can update invites" on public.organization_invites;

create policy "Organization members can read invites"
on public.organization_invites for select
to authenticated
using (public.is_org_member(organization_id));

create policy "Organization operators can create invites"
on public.organization_invites for insert
to authenticated
with check (
  public.is_org_operator(organization_id)
  and invited_by = auth.uid()
);

create policy "Organization operators can update invites"
on public.organization_invites for update
to authenticated
using (public.is_org_operator(organization_id))
with check (public.is_org_operator(organization_id));
