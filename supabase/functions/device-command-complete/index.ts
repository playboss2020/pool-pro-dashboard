import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { isResponse, requireDevice, serviceClient } from "../_shared/deviceAuth.ts";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveScheduleSyncAlert(
  supabase: ReturnType<typeof serviceClient>,
  deviceId: string,
) {
  const { error } = await supabase
    .from("device_alerts")
    .update({ resolved_at: new Date().toISOString() })
    .eq("device_id", deviceId)
    .eq("alert_key", "schedule_sync_failed")
    .is("resolved_at", null);

  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const device = await requireDevice(req);
    const body = await req.json();
    const supabase = serviceClient();

    if (!body.command_id) return jsonResponse({ error: "Missing command_id" }, 400);

    const completedAt = new Date().toISOString();
    const { data: updatedCommand, error } = await supabase
      .from("device_commands")
      .update({
        status: "completed",
        completed_at: completedAt,
        error: null,
      })
      .eq("id", body.command_id)
      .eq("device_id", device.deviceId)
      .select("id, command_type")
      .maybeSingle();

    if (error) return jsonResponse({ error: error.message }, 500);
    if (!updatedCommand) {
      await sleep(250);
      const { data: retryCommand, error: retryError } = await supabase
        .from("device_commands")
        .update({
          status: "completed",
          completed_at: completedAt,
          error: null,
        })
        .eq("id", body.command_id)
        .eq("device_id", device.deviceId)
        .select("id, command_type")
        .maybeSingle();

      if (retryError) return jsonResponse({ error: retryError.message }, 500);
      if (!retryCommand) return jsonResponse({ ok: true, warning: "Command row not found yet" });
      if (retryCommand.command_type === "sync_schedules") {
        await resolveScheduleSyncAlert(supabase, device.deviceId);
      }
    } else if (updatedCommand.command_type === "sync_schedules") {
      await resolveScheduleSyncAlert(supabase, device.deviceId);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    if (isResponse(error)) return error;
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
