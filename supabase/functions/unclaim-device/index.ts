import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/deviceAuth.ts";

function getBearerToken(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function normalizeDeviceId(value: unknown) {
  return String(value ?? "").trim();
}

async function deleteDeviceRows(
  supabase: ReturnType<typeof serviceClient>,
  table: "device_commands" | "device_schedules" | "device_alerts" | "device_history",
  deviceId: string,
) {
  const { error } = await supabase.from(table).delete().eq("device_id", deviceId);
  if (error) throw new Error(error.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const token = getBearerToken(req);
    if (!token) return jsonResponse({ error: "Missing authorization" }, 401);

    const body = await req.json();
    const deviceId = normalizeDeviceId(body.device_id);

    if (!deviceId) {
      return jsonResponse({ error: "Missing device ID" }, 400);
    }

    const supabase = serviceClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;

    if (userError || !user) return jsonResponse({ error: "Invalid user" }, 401);

    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("id, user_id, device_id")
      .eq("device_id", deviceId)
      .maybeSingle();

    if (deviceError) return jsonResponse({ error: deviceError.message }, 500);
    if (!device) return jsonResponse({ error: "Device was not found" }, 404);
    if (device.user_id !== user.id) {
      return jsonResponse({ error: "You do not own this device" }, 403);
    }

    await deleteDeviceRows(supabase, "device_commands", deviceId);
    await deleteDeviceRows(supabase, "device_schedules", deviceId);
    await deleteDeviceRows(supabase, "device_alerts", deviceId);
    await deleteDeviceRows(supabase, "device_history", deviceId);

    const { error: deviceUpdateError } = await supabase
      .from("devices")
      .update({
        user_id: null,
        name: "Pool Hub",
        online_status: "offline",
      })
      .eq("device_id", deviceId);

    if (deviceUpdateError) return jsonResponse({ error: deviceUpdateError.message }, 500);

    const { error: claimUpdateError } = await supabase
      .from("device_claims")
      .update({
        claimed_by: null,
        claimed_at: null,
      })
      .eq("device_id", deviceId);

    if (claimUpdateError) return jsonResponse({ error: claimUpdateError.message }, 500);

    return jsonResponse({
      removed_device_id: deviceId,
      message: "Pool hub removed from this account",
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
