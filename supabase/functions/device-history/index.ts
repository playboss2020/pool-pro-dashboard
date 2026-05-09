import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { isResponse, requireDevice, serviceClient } from "../_shared/deviceAuth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const device = await requireDevice(req);
    const body = await req.json();
    const supabase = serviceClient();

    const { error } = await supabase.from("device_history").insert({
      device_id: device.deviceId,
      current_temp: body.current_temp,
      pump_watts: body.pump_watts ?? 0,
      heater_watts: body.heater_watts ?? 0,
      total_kwh: body.total_kwh ?? 0,
    });

    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ ok: true });
  } catch (error) {
    if (isResponse(error)) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
