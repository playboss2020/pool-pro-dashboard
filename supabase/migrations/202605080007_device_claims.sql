alter table public.devices
add column if not exists serial_number text unique;

create table if not exists public.device_claims (
  id uuid primary key default gen_random_uuid(),
  serial_number text not null unique,
  device_id text not null unique,
  device_secret_hash text not null,
  claim_code_hash text,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_device_claims_unclaimed
on public.device_claims (serial_number)
where claimed_by is null;

alter table public.device_claims enable row level security;

create or replace function public.verify_device_claim_code(
  p_serial_number text,
  p_claim_code text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.device_claims
    where serial_number = upper(trim(p_serial_number))
      and (
        claim_code_hash is null
        or claim_code_hash = extensions.crypt(coalesce(p_claim_code, ''), claim_code_hash)
      )
  );
$$;

grant execute on function public.verify_device_claim_code(text, text) to authenticated;

-- Manufacturing example:
-- insert into public.device_claims (serial_number, device_id, device_secret_hash, claim_code_hash)
-- values (
--   'WF-POOL-000001',
--   'pool-hub-000001',
--   extensions.crypt('DEVICE_SECRET_PROGRAMMED_IN_HUB', extensions.gen_salt('bf')),
--   null
-- );
