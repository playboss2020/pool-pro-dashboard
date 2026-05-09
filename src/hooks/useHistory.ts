import { useCallback, useEffect, useState } from "react";
import { fetchHistory, type DeviceHistory, type HistoryPeriod } from "../lib/deviceApi";

const HISTORY_REFRESH_MS = 60000;

export function useHistory(period: HistoryPeriod, startIso: string, endIso: string) {
  const [history, setHistory] = useState<DeviceHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (!options.quiet) setLoading(true);

    try {
      setError("");
      setHistory(await fetchHistory(period, startIso, endIso));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load history");
    } finally {
      setLoading(false);
    }
  }, [endIso, period, startIso]);

  useEffect(() => {
    void refresh();

    const interval = window.setInterval(() => {
      void refresh({ quiet: true });
    }, HISTORY_REFRESH_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [refresh]);

  return { history, loading, error, refresh };
}
