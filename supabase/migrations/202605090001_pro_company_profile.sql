alter table public.organizations
  add column if not exists company_address text,
  add column if not exists company_city text,
  add column if not exists company_state text,
  add column if not exists company_zip text,
  add column if not exists company_phone text,
  add column if not exists company_email text,
  add column if not exists company_notes text;

drop policy if exists "Organization operators can update organizations" on public.organizations;

create policy "Organization operators can update organizations"
on public.organizations for update
to authenticated
using (public.is_org_operator(id))
with check (public.is_org_operator(id));
