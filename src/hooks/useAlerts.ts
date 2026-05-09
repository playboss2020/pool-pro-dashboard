import { useCallback, useEffect, useRef, useState } from "react";
import { acknowledgeAlert, fetchAlerts, type DeviceAlert } from "../lib/deviceApi";

const ALERT_REFRESH_MS = 60000;

export function useAlerts(enabled = true) {
  const [alerts, setAlerts] = useState<DeviceAlert[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const firstLoadRef = useRef(true);

  const refresh = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (!enabled) {
      firstLoadRef.current = true;
      setAlerts([]);
      setError("");
      setLoading(false);
      return;
    }

    if (firstLoadRef.current && !options.quiet) setLoading(true);

    try {
      setError("");
      setAlerts(await fetchAlerts());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load alerts");
    } finally {
      firstLoadRef.current = false;
      setLoading(false);
    }
  }, [enabled]);

  const acknowledge = useCallback(async (alertId: string) => {
    const previousAlerts = alerts;
    setAlerts((current) =>
      current.map((alert) => (alert.id === alertId ? { ...alert, acknowledged: true } : alert)),
    );

    try {
      await acknowledgeAlert(alertId);
      await refresh({ quiet: true });
    } catch (err) {
      setAlerts(previousAlerts);
      setError(err instanceof Error ? err.message : "Unable to acknowledge alert");
    }
  }, [alerts, refresh]);

  useEffect(() => {
    void refresh();
    if (!enabled) return undefined;

    const interval = window.setInterval(() => {
      void refresh({ quiet: true });
    }, ALERT_REFRESH_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [enabled, refresh]);

  const activeAlertCount = alerts.filter((alert) => !alert.acknowledged && !alert.resolved_at).length;

  return { alerts, activeAlertCount, loading, error, refresh, acknowledge };
}

export type UseAlertsResult = ReturnType<typeof useAlerts>;
