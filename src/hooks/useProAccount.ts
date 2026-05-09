import { useCallback, useEffect, useState } from "react";
import { fetchProAccount, type ProAccount } from "../lib/deviceApi";

export function useProAccount(userId: string | undefined) {
  const [account, setAccount] = useState<ProAccount | null>(null);
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!userId) {
      setAccount(null);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    try {
      setError("");
      setAccount(await fetchProAccount(userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Pro account");
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { account, loading, error, refresh };
}
