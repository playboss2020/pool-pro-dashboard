import { useCallback, useEffect, useState } from "react";
import { fetchDevices, type PoolDevice } from "../lib/deviceApi";

const DEVICES_REFRESH_MS = 120000;

export function useDevices(enabled = true) {
  const [devices, setDevices] = useState<PoolDevice[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");

  const refresh = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (!enabled) {
      setDevices([]);
      setLoading(false);
      setError("");
      return;
    }

    if (!options.quiet) setLoading(true);

    try {
      setError("");
      setDevices(await fetchDevices());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load hubs");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
    if (!enabled) return undefined;

    const interval = window.setInterval(() => {
      void refresh({ quiet: true });
    }, DEVICES_REFRESH_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [enabled, refresh]);

  return { devices, loading, error, refresh };
}
