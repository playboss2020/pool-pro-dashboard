alter table public.devices
add column if not exists temp_calibration_offset numeric not null default 0,
add column if not exists wattage_calibration_scale numeric not null default 1;

alter table public.device_commands
drop constraint if exists device_commands_command_type_check;

alter table public.device_commands
add constraint device_commands_command_type_check
check (
  command_type in (
    'pump_on',
    'pump_off',
    'heater_enable',
    'heater_disable',
    'set_setpoint',
    'set_calibration',
    'sync_schedules',
    'reboot_device',
    'clear_alerts'
  )
);
