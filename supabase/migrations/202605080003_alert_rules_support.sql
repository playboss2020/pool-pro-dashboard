alter table public.devices
add column if not exists lora_rssi numeric,
add column if not exists lora_snr numeric,
add column if not exists node_online boolean not null default false,
add column if not exists node_last_seen timestamptz;

alter table public.device_alerts
add column if not exists alert_key text,
add column if not exists resolved_at timestamptz;

create unique index if not exists idx_device_alerts_active_key
on public.device_alerts (device_id, alert_key)
where alert_key is not null and resolved_at is null;

create index if not exists idx_device_alerts_device_created
on public.device_alerts (device_id, created_at desc);
