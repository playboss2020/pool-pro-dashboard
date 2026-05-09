import { useCallback, useEffect, useState } from "react";
import { fetchSchedules, upsertSchedule, type DeviceSchedule } from "../lib/deviceApi";

export function useSchedules() {
  const [schedules, setSchedules] = useState<DeviceSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setError("");
      setSchedules(await fetchSchedules());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load schedules");
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async (schedule: Parameters<typeof upsertSchedule>[0]) => {
    const saved = await upsertSchedule(schedule);
    setSchedules((current) => {
      const exists = current.some((item) => item.id === saved.id);
      return exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved];
    });
    return saved;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { schedules, loading, error, refresh, save };
}
