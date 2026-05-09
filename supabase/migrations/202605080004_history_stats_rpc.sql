create or replace function public.get_device_history_stats(
  p_device_id text,
  p_period text,
  p_start timestamptz,
  p_end timestamptz,
  p_timezone text default 'America/New_York'
)
returns table (
  bucket_start timestamptz,
  current_temp numeric,
  pump_watts numeric,
  heater_watts numeric,
  total_kwh numeric,
  sample_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_period not in ('day', 'month', 'year') then
    raise exception 'Unsupported history period: %', p_period;
  end if;

  if not exists (
    select 1
    from public.devices d
    where d.device_id = p_device_id
      and d.user_id = auth.uid()
  ) then
    raise exception 'Device not found';
  end if;

  if p_period = 'day' then
    return query
      select
        h.created_at as bucket_start,
        h.current_temp,
        h.pump_watts,
        h.heater_watts,
        h.total_kwh,
        1::integer as sample_count
      from public.device_history h
      where h.device_id = p_device_id
        and h.created_at >= p_start
        and h.created_at < p_end
      order by h.created_at
      limit 2000;
  elsif p_period = 'month' then
    return query
      select
        (date_trunc('day', h.created_at at time zone p_timezone) at time zone p_timezone) as bucket_start,
        avg(h.current_temp) as current_temp,
        avg(h.pump_watts) as pump_watts,
        avg(h.heater_watts) as heater_watts,
        max(h.total_kwh) as total_kwh,
        count(*)::integer as sample_count
      from public.device_history h
      where h.device_id = p_device_id
        and h.created_at >= p_start
        and h.created_at < p_end
      group by 1
      order by 1;
  else
    return query
      select
        (date_trunc('month', h.created_at at time zone p_timezone) at time zone p_timezone) as bucket_start,
        avg(h.current_temp) as current_temp,
        avg(h.pump_watts) as pump_watts,
        avg(h.heater_watts) as heater_watts,
        max(h.total_kwh) as total_kwh,
        count(*)::integer as sample_count
      from public.device_history h
      where h.device_id = p_device_id
        and h.created_at >= p_start
        and h.created_at < p_end
      group by 1
      order by 1;
  end if;
end;
$$;

grant execute on function public.get_device_history_stats(text, text, timestamptz, timestamptz, text) to authenticated;
