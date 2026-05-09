import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { isResponse, requireDevice, serviceClient } from "../_shared/deviceAuth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const device = await requireDevice(req);
    const supabase = serviceClient();

    const { data: command, error: selectError } = await supabase
      .from("device_commands")
      .select("id, command_type, payload")
      .eq("device_id", device.deviceId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) return jsonResponse({ error: selectError.message }, 500);
    if (!command) return jsonResponse({ command: null });

    const { error: updateError } = await supabase
      .from("device_commands")
      .update({
        status: "acknowledged",
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", command.id)
      .eq("status", "pending");

    if (updateError) return jsonResponse({ error: updateError.message }, 500);
    return jsonResponse(command);
  } catch (error) {
    if (isResponse(error)) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
