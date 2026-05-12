alter table public.organizations
  add column if not exists account_status text not null default 'active',
  add column if not exists suspended_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organizations_account_status_check'
  ) then
    alter table public.organizations
      add constraint organizations_account_status_check
      check (account_status in ('active', 'suspended'));
  end if;
end $$;

update public.organizations
set account_status = 'active'
where account_status is null;
