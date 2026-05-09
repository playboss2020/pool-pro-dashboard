import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { isResponse, requireDevice, serviceClient } from "../_shared/deviceAuth.ts";

const NODE_OFFLINE_AFTER_SECONDS = 20;
const EXPECTED_POWER_GRACE_MS = 30000;
const MIN_RUNNING_WATTS = 50;
const WEAK_WIFI_RSSI = -82;
const HUB_RECONNECT_ALERT_GAP_MS = 5 * 60 * 1000;

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toNullableNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function minutesFromMs(ms: number) {
  return Math.max(1, Math.round(ms / 60000));
}

async function raiseAlert(
  supabase: ReturnType<typeof serviceClient>,
  input: {
    userId: string;
    deviceId: string;
    alertKey: string;
    alertType: string;
    severity: "info" | "warning" | "critical";
    message: string;
  },
) {
  const { data: existing, error: lookupError } = await supabase
    .from("device_alerts")
    .select("id, acknowledged")
    .eq("device_id", input.deviceId)
    .eq("alert_key", input.alertKey)
    .is("resolved_at", null)
    .maybeSingle();

  if (lookupError) throw lookupError;

  if (existing) {
    const { error } = await supabase
      .from("device_alerts")
      .update({
        alert_type: input.alertType,
        severity: input.severity,
        message: input.message,
      })
      .eq("id", existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("device_alerts").insert({
    user_id: input.userId,
    device_id: input.deviceId,
    alert_key: input.alertKey,
    alert_type: input.alertType,
    severity: input.severity,
    message: input.message,
  });

  if (error) throw error;
}

async function resolveAlert(
  supabase: ReturnType<typeof serviceClient>,
  deviceId: string,
  alertKey: string,
) {
  const { error } = await supabase
    .from("device_alerts")
    .update({ resolved_at: new Date().toISOString() })
    .eq("device_id", deviceId)
    .eq("alert_key", alertKey)
    .is("resolved_at", null);

  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const device = await requireDevice(req);
    const body = await req.json();
    const supabase = serviceClient();

    const { data: previousDevice, error: previousError } = await supabase
      .from("devices")
      .select("last_seen, node_last_seen, pump_on, heater_enabled")
      .eq("device_id", device.deviceId)
      .maybeSingle();

    if (previousError) return jsonResponse({ error: previousError.message }, 500);

    const nowIso = new Date().toISOString();
    const currentTemp = toNullableNumber(body.current_temp);
    const setpoint = toNullableNumber(body.setpoint);
    const pumpOn = Boolean(body.pump_on);
    const heaterEnabled = Boolean(body.heater_enabled);
    const heaterRelayOn = Boolean(body.heater_relay_on);
    const pumpWatts = toNumber(body.pump_watts, 0);
    const heaterWatts = toNumber(body.heater_watts, 0);
    const wifiRssi = Math.round(toNumber(body.wifi_rssi, 0));
    const wifiSsid = typeof body.wifi_ssid === "string" ? body.wifi_ssid.slice(0, 64) : null;
    const loraAgeSeconds = toNumber(body.lora_age_seconds, 999999);
    const nodeOnline = Boolean(body.node_online) && loraAgeSeconds < NODE_OFFLINE_AFTER_SECONDS;
    const previousSeenMs = previousDevice?.last_seen ? new Date(previousDevice.last_seen).getTime() : 0;
    const msSincePreviousState = previousSeenMs > 0 ? Date.now() - previousSeenMs : 0;
    const oldEnoughForPowerAlert = msSincePreviousState >= EXPECTED_POWER_GRACE_MS;

    const { error } = await supabase
      .from("devices")
      .update({
        current_temp: currentTemp,
        pump_on: pumpOn,
        heater_enabled: heaterEnabled,
        heater_relay_on: heaterRelayOn,
        setpoint,
        pump_watts: pumpWatts,
        heater_watts: heaterWatts,
        total_kwh: body.total_kwh ?? 0,
        temp_calibration_offset: body.temp_calibration_offset ?? 0,
        wattage_calibration_scale: body.wattage_calibration_scale ?? 1,
        last_seen: nowIso,
        online_status: "online",
        firmware_version: body.firmware_version,
        wifi_ssid: wifiSsid,
        wifi_rssi: wifiRssi,
        lora_rssi: body.lora_rssi ?? null,
        lora_snr: body.lora_snr ?? null,
        node_online: nodeOnline,
        node_last_seen: nodeOnline ? nowIso : previousDevice?.node_last_seen ?? null,
      })
      .eq("device_id", device.deviceId);

    if (error) return jsonResponse({ error: error.message }, 500);

    if (previousSeenMs > 0 && msSincePreviousState > HUB_RECONNECT_ALERT_GAP_MS) {
      await raiseAlert(supabase, {
        userId: device.userId,
        deviceId: device.deviceId,
        alertKey: "wifi_disconnected",
        alertType: "wifi_disconnected",
        severity: "warning",
        message: `Hub reconnected after about ${minutesFromMs(msSincePreviousState)} minutes offline.`,
      });
    }

    if (!nodeOnline) {
      await raiseAlert(supabase, {
        userId: device.userId,
        deviceId: device.deviceId,
        alertKey: "node_offline",
        alertType: "node_offline",
        severity: "critical",
        message: "Pool node is not responding over LoRa.",
      });
    } else {
      await resolveAlert(supabase, device.deviceId, "node_offline");
    }

    const pumpNoWatts = pumpOn &&
      previousDevice?.pump_on === true &&
      oldEnoughForPowerAlert &&
      pumpWatts < MIN_RUNNING_WATTS;
    if (pumpNoWatts) {
      await raiseAlert(supabase, {
        userId: device.userId,
        deviceId: device.deviceId,
        alertKey: "pump_no_watts",
        alertType: "pump_no_watts",
        severity: "critical",
        message: "Pump is expected to be on, but wattage is near zero.",
      });
    } else if (!pumpOn || pumpWatts >= MIN_RUNNING_WATTS) {
      await resolveAlert(supabase, device.deviceId, "pump_no_watts");
    }

    const heaterShouldBeHeating = heaterEnabled &&
      currentTemp !== null &&
      setpoint !== null &&
      currentTemp < setpoint - 0.5;
    const heaterNoWatts = heaterShouldBeHeating &&
      previousDevice?.heater_enabled === true &&
      oldEnoughForPowerAlert &&
      heaterWatts < MIN_RUNNING_WATTS;
    if (heaterNoWatts) {
      await raiseAlert(supabase, {
        userId: device.userId,
        deviceId: device.deviceId,
        alertKey: "heater_no_watts",
        alertType: "heater_no_watts",
        severity: "warning",
        message: "Heater is enabled and below setpoint, but heater wattage is near zero.",
      });
    } else if (!heaterShouldBeHeating || heaterWatts >= MIN_RUNNING_WATTS) {
      await resolveAlert(supabase, device.deviceId, "heater_no_watts");
    }

    if (wifiRssi !== 0 && wifiRssi <= WEAK_WIFI_RSSI) {
      await raiseAlert(supabase, {
        userId: device.userId,
        deviceId: device.deviceId,
        alertKey: "weak_wifi",
        alertType: "weak_wifi",
        severity: "warning",
        message: `Hub WiFi signal is weak (${wifiRssi} dBm).`,
      });
    } else {
      await resolveAlert(supabase, device.deviceId, "weak_wifi");
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    if (isResponse(error)) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
