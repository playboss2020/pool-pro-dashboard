import { deviceId, requireSupabase, supabase } from "./supabase";
import { isDirectMqttConfigured, publishDirectMqttCommand } from "./mqttClient";

export type PoolDevice = {
  id: string;
  user_id: string;
  device_id: string;
  serial_number: string | null;
  name: string;
  current_temp: number | null;
  pump_on: boolean;
  heater_enabled: boolean;
  heater_relay_on: boolean;
  setpoint: number | null;
  pump_watts: number | null;
  heater_watts: number | null;
  total_kwh: number | null;
  electricity_rate_per_kwh: number | null;
  temp_calibration_offset: number | null;
  wattage_calibration_scale: number | null;
  last_seen: string | null;
  online_status: "online" | "offline" | "unknown";
  firmware_version: string | null;
  wifi_ssid: string | null;
  wifi_rssi: number | null;
  lora_rssi?: number | null;
  lora_snr?: number | null;
  node_online?: boolean | null;
  node_last_seen?: string | null;
  updated_at: string;
};

export type DeviceCommandType =
  | "pump_on"
  | "pump_off"
  | "heater_enable"
  | "heater_disable"
  | "set_setpoint"
  | "set_calibration"
  | "sync_schedules"
  | "reboot_device"
  | "clear_alerts";

export type DeviceCommand = {
  id: string;
  command_type: DeviceCommandType;
  payload: Record<string, unknown>;
  status: "pending" | "acknowledged" | "completed" | "failed";
  created_at: string;
  acknowledged_at: string | null;
  completed_at: string | null;
  error: string | null;
};

export type DeviceSchedule = {
  id: string;
  user_id: string;
  device_id: string;
  name: string | null;
  target: "pump" | "heater";
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
  days_of_week: number[];
  enabled: boolean;
  updated_at: string;
};

export type DeviceAlert = {
  id: string;
  alert_type: string;
  alert_key: string | null;
  severity: "info" | "warning" | "critical";
  message: string;
  acknowledged: boolean;
  created_at: string;
  resolved_at: string | null;
};

export type DeviceHistory = {
  id: string;
  device_id: string;
  current_temp: number | null;
  pump_watts: number | null;
  heater_watts: number | null;
  total_kwh: number | null;
  created_at: string;
  sample_count: number;
};

export type HistoryPeriod = "day" | "month" | "year";

export type ClaimedDeviceResponse = {
  device: PoolDevice;
};

export type UnclaimedDeviceResponse = {
  removed_device_id: string;
  message: string;
};

const DEVICE_SELECT_COLUMNS = [
  "id",
  "user_id",
  "device_id",
  "serial_number",
  "name",
  "current_temp",
  "pump_on",
  "heater_enabled",
  "heater_relay_on",
  "setpoint",
  "pump_watts",
  "heater_watts",
  "total_kwh",
  "electricity_rate_per_kwh",
  "temp_calibration_offset",
  "wattage_calibration_scale",
  "last_seen",
  "online_status",
  "firmware_version",
  "wifi_ssid",
  "wifi_rssi",
  "lora_rssi",
  "lora_snr",
  "node_online",
  "node_last_seen",
  "updated_at",
].join(",");

export async function fetchDevice() {
  const client = requireSupabase();
  const { data, error } = await client
    .from("devices")
    .select(DEVICE_SELECT_COLUMNS)
    .eq("device_id", deviceId)
    .maybeSingle<PoolDevice>();

  if (error) throw error;
  return data as PoolDevice | null;
}

export async function fetchDevices() {
  const client = requireSupabase();
  const { data, error } = await client
    .from("devices")
    .select(DEVICE_SELECT_COLUMNS)
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as PoolDevice[];
}

export async function sendCommand(
  userId: string,
  commandType: DeviceCommandType,
  payload: Record<string, unknown> = {},
) {
  if (isDirectMqttConfigured()) {
    const command: DeviceCommand = {
      id: crypto.randomUUID(),
      command_type: commandType,
      payload,
      status: "pending",
      created_at: new Date().toISOString(),
      acknowledged_at: null,
      completed_at: null,
      error: null,
    };

    try {
      await publishDirectMqttCommand({
        id: command.id,
        command_type: commandType,
        payload,
        created_at: command.created_at,
      });

      if (supabase) {
        // MQTT is the real-time control path. Supabase only records a log here,
        // so do not block the button feel if the database is slow or restricted.
        void supabase.from("device_commands").insert({
          id: command.id,
          user_id: userId,
          device_id: deviceId,
          command_type: commandType,
          payload,
          status: "pending",
          created_at: command.created_at,
        }).then(({ error }) => {
          if (error) {
            console.warn("Direct MQTT command published, but Supabase command log failed", error);
          }
        });
      }

      return command;
    } catch (error) {
      console.warn("Direct MQTT command failed, falling back to Supabase function", error);
    }
  }

  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<{
    command: DeviceCommand;
    mqtt: "published" | "not_configured" | "failed";
  }>("send-device-command", {
    body: {
      device_id: deviceId,
      command_type: commandType,
      payload,
      user_id: userId,
    },
  });

  if (error) throw error;
  if (!data?.command) throw new Error("Command was not created");
  return data.command;
}

export async function fetchLatestCommand(commandId: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("device_commands")
    .select("id,command_type,payload,status,created_at,acknowledged_at,completed_at,error")
    .eq("id", commandId)
    .single<DeviceCommand>();

  if (error) throw error;
  return data;
}

export async function fetchSchedules() {
  const client = requireSupabase();
  const { data, error } = await client
    .from("device_schedules")
    .select("id,user_id,device_id,name,target,start_time,end_time,duration_minutes,days_of_week,enabled,updated_at")
    .eq("device_id", deviceId)
    .order("target", { ascending: true });

  if (error) throw error;
  return (data ?? []) as DeviceSchedule[];
}

export async function upsertSchedule(input: Omit<DeviceSchedule, "id" | "updated_at"> & { id?: string }) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("device_schedules")
    .upsert(input)
    .select("*")
    .single<DeviceSchedule>();

  if (error) throw error;
  return data;
}

export async function fetchAlerts() {
  const client = requireSupabase();
  const { data, error } = await client
    .from("device_alerts")
    .select("id,alert_type,alert_key,severity,message,acknowledged,created_at,resolved_at")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) throw error;
  return (data ?? []) as DeviceAlert[];
}

export async function acknowledgeAlert(alertId: string) {
  const client = requireSupabase();
  const { error } = await client.from("device_alerts").update({ acknowledged: true }).eq("id", alertId);
  if (error) throw error;
}

export async function updateElectricityRate(ratePerKwh: number) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("devices")
    .update({ electricity_rate_per_kwh: ratePerKwh })
    .eq("device_id", deviceId)
    .select("*")
    .single<PoolDevice>();

  if (error) throw error;
  return data;
}

export async function updateDeviceName(name: string) {
  const client = requireSupabase();
  const cleanName = name.trim() || "Pool Hub";
  const { data, error } = await client
    .from("devices")
    .update({ name: cleanName })
    .eq("device_id", deviceId)
    .select("*")
    .single<PoolDevice>();

  if (error) throw error;
  return data;
}

export async function claimDevice(serialNumber: string, claimCode = "", name = "Pool Hub") {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<ClaimedDeviceResponse>("claim-device", {
    body: {
      serial_number: serialNumber,
      claim_code: claimCode,
      name,
    },
  });

  if (error) throw error;
  if (!data?.device) throw new Error("Device was not claimed");
  return data.device;
}

export async function unclaimDevice(targetDeviceId = deviceId) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<UnclaimedDeviceResponse>("unclaim-device", {
    body: {
      device_id: targetDeviceId,
    },
  });

  if (error) throw error;
  if (!data?.removed_device_id) throw new Error("Device was not removed");
  return data;
}

function numberOrNull(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export async function fetchHistory(
  period: HistoryPeriod,
  startIso: string,
  endIso: string,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("get_device_history_stats", {
    p_device_id: deviceId,
    p_period: period,
    p_start: startIso,
    p_end: endIso,
    p_timezone: timezone,
  });

  if (error) throw error;
  return (data ?? []).map((row: {
    bucket_start: string;
    current_temp: unknown;
    pump_watts: unknown;
    heater_watts: unknown;
    total_kwh: unknown;
    sample_count: number | null;
  }, index: number): DeviceHistory => ({
    id: `${row.bucket_start}-${index}`,
    device_id: deviceId,
    current_temp: numberOrNull(row.current_temp),
    pump_watts: numberOrNull(row.pump_watts),
    heater_watts: numberOrNull(row.heater_watts),
    total_kwh: numberOrNull(row.total_kwh),
    created_at: row.bucket_start,
    sample_count: row.sample_count ?? 0,
  }));
}
