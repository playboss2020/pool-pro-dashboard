import { useCallback, useEffect, useRef, useState } from "react";
import { deviceId, supabase } from "../lib/supabase";
import { fetchDevice, type PoolDevice } from "../lib/deviceApi";
import { isDirectMqttConfigured, subscribeDirectMqttState } from "../lib/mqttClient";

const DEVICE_REFRESH_MS = isDirectMqttConfigured() ? 60000 : 15000;
const DEVICE_HIDDEN_REFRESH_MS = 120000;
const DEVICE_REFRESH_BURST_MS = isDirectMqttConfigured()
  ? [2500, 10000]
  : [0, 1000, 3000, 7000, 15000];

function numberOrNull(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function useDevice(enabled = true) {
  const [device, setDevice] = useState<PoolDevice | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const lastDeviceJsonRef = useRef("");
  const lastDeviceUpdatedAtRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const refreshBurstTimeoutsRef = useRef<number[]>([]);
  const deviceRef = useRef<PoolDevice | null>(null);

  const setDeviceIfChanged = useCallback((nextDevice: PoolDevice | null) => {
    const nextUpdatedAt = nextDevice?.updated_at ? new Date(nextDevice.updated_at).getTime() : 0;
    const lastUpdatedAt = lastDeviceUpdatedAtRef.current;

    if (nextUpdatedAt > 0 && lastUpdatedAt > 0 && nextUpdatedAt < lastUpdatedAt) return;

    const nextJson = JSON.stringify(nextDevice);
    if (lastDeviceJsonRef.current === nextJson) return;

    if (nextUpdatedAt >= lastUpdatedAt) {
      lastDeviceUpdatedAtRef.current = nextUpdatedAt;
    }

    lastDeviceJsonRef.current = nextJson;
    deviceRef.current = nextDevice;
    setDevice(nextDevice);
  }, []);

  const applyMqttState = useCallback(
    (payload: string) => {
      try {
        const state = JSON.parse(payload) as Partial<PoolDevice>;
        if (state.device_id && state.device_id !== deviceId) return;

        const current = deviceRef.current;
        const now = new Date().toISOString();
        const nextDevice: PoolDevice = {
          id: current?.id ?? state.id ?? deviceId,
          user_id: current?.user_id ?? state.user_id ?? "",
          device_id: state.device_id ?? current?.device_id ?? deviceId,
          serial_number: current?.serial_number ?? state.serial_number ?? null,
          name: current?.name ?? state.name ?? "Pool Hub",
          current_temp: numberOrNull(state.current_temp),
          pump_on: Boolean(state.pump_on),
          heater_enabled: Boolean(state.heater_enabled),
          heater_relay_on: Boolean(state.heater_relay_on ?? state.heater_enabled),
          setpoint: numberOrNull(state.setpoint),
          pump_watts: numberOrNull(state.pump_watts),
          heater_watts: numberOrNull(state.heater_watts),
          total_kwh: numberOrNull(state.total_kwh),
          electricity_rate_per_kwh: current?.electricity_rate_per_kwh ?? numberOrNull(state.electricity_rate_per_kwh) ?? 0.18,
          temp_calibration_offset: numberOrNull(state.temp_calibration_offset),
          wattage_calibration_scale: numberOrNull(state.wattage_calibration_scale),
          last_seen: now,
          online_status: "online",
          firmware_version: state.firmware_version ?? current?.firmware_version ?? null,
          wifi_ssid: state.wifi_ssid ?? current?.wifi_ssid ?? null,
          wifi_rssi: typeof state.wifi_rssi === "number" ? state.wifi_rssi : current?.wifi_rssi ?? null,
          updated_at: now,
        };

        setDeviceIfChanged(nextDevice);
      } catch {
        // Ignore non-JSON MQTT messages on the state topic.
      }
    },
    [setDeviceIfChanged],
  );

  const refresh = useCallback(async () => {
    if (!enabled) {
      setDeviceIfChanged(null);
      setLoading(false);
      setError("");
      return;
    }

    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;

    try {
      setError("");
      const nextDevice = await fetchDevice();
      setDeviceIfChanged(nextDevice);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load device");
    } finally {
      refreshInFlightRef.current = false;
      setLoading(false);
    }
  }, [enabled, setDeviceIfChanged]);

  const refreshBurst = useCallback(() => {
    refreshBurstTimeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
    refreshBurstTimeoutsRef.current = [];

    refreshBurstTimeoutsRef.current = DEVICE_REFRESH_BURST_MS.map((delay) =>
      window.setTimeout(() => {
        void refresh();
      }, delay),
    );

    return () => {
      refreshBurstTimeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
      refreshBurstTimeoutsRef.current = [];
    };
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return undefined;

    const interval = window.setInterval(() => {
      void refresh();
    }, document.visibilityState === "hidden" ? DEVICE_HIDDEN_REFRESH_MS : DEVICE_REFRESH_MS);

    const handleFocus = () => {
      if (document.visibilityState !== "hidden") {
        void refresh();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    return () => {
      window.clearInterval(interval);
      refreshBurstTimeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    const client = supabase;
    if (!enabled || !client) return undefined;

    const channel = client
      .channel(`device:${deviceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "devices",
          filter: `device_id=eq.${deviceId}`,
        },
        (payload) => {
          setDeviceIfChanged(payload.new as PoolDevice);
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [enabled, setDeviceIfChanged]);

  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeDirectMqttState(applyMqttState);
  }, [applyMqttState, enabled]);

  return { device, loading, error, refresh, refreshBurst };
}
