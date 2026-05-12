import { useCallback, useEffect, useState } from "react";
import { fetchWorkflowAdminOverview, type WorkflowAdminOverview } from "../lib/deviceApi";

export function useWorkflowAdmin(userId: string | undefined) {
  const [overview, setOverview] = useState<WorkflowAdminOverview | null>(null);
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!userId) {
      setOverview(null);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    try {
      setError("");
      setOverview(await fetchWorkflowAdminOverview());
    } catch (err) {
      // The admin dashboard is an internal-only feature. If the function is not
      // deployed or this user is not allowed, keep the normal app experience.
      console.warn("Workflow admin check failed", err);
      setOverview(null);
      setError("");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { overview, loading, error, isAdmin: Boolean(overview), refresh };
}
