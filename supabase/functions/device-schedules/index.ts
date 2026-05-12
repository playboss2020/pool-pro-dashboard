import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { isResponse, requireDevice, serviceClient } from "../_shared/deviceAuth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const device = await requireDevice(req);
    const supabase = serviceClient();
    const includeOverrides = new URL(req.url).searchParams.get("include_overrides") === "1";

    const { data, error } = await supabase
      .from("device_schedules")
      .select("id, target, start_time, end_time, duration_minutes, days_of_week, enabled, updated_at")
      .eq("device_id", device.deviceId)
      .order("target", { ascending: true });

    if (error) return jsonResponse({ error: error.message }, 500);

    if (includeOverrides) {
      const { data: overrides, error: overridesError } = await supabase
        .from("device_schedule_overrides")
        .select("id, name, override_type, start_date, end_date, start_time, end_time, pump_on, heater_enabled, setpoint, suspend_regular_schedules, status, updated_at")
        .eq("device_id", device.deviceId)
        .neq("status", "cancelled")
        .order("start_date", { ascending: true });

      if (overridesError) return jsonResponse({ error: overridesError.message }, 500);
      return jsonResponse({
        schedules: data ?? [],
        overrides: overrides ?? [],
      });
    }

    return jsonResponse(data ?? []);
  } catch (error) {
    if (isResponse(error)) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
