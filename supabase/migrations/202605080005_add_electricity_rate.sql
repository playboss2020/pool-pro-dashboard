alter table public.devices
add column if not exists electricity_rate_per_kwh numeric not null default 0.18;
