import mqtt from "npm:mqtt@5.10.4";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/deviceAuth.ts";

const COMMAND_TYPES = new Set([
  "pump_on",
  "pump_off",
  "heater_enable",
  "heater_disable",
  "set_setpoint",
  "set_calibration",
  "sync_schedules",
  "reboot_device",
  "clear_alerts",
]);

let cachedMqttClient: any = null;
let cachedMqttKey = "";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function getBearerToken(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

async function getMqttClient(mqttUrl: string, username: string, password: string) {
  const key = `${mqttUrl}|${username}`;
  if (cachedMqttClient?.connected && cachedMqttKey === key) {
    return cachedMqttClient;
  }

  if (cachedMqttClient) {
    try {
      await cachedMqttClient.endAsync(true);
    } catch {
      // ignore stale connection cleanup
    }
  }

  const client = await withTimeout(
    mqtt.connectAsync(mqttUrl, {
      username,
      password,
      clean: true,
      keepalive: 30,
      reconnectPeriod: 0,
      connectTimeout: 1600,
    }),
    2200,
    "MQTT connect",
  );

  cachedMqttClient = client;
  cachedMqttKey = key;

  client.on("close", () => {
    if (cachedMqttClient === client) cachedMqttClient = null;
  });

  client.on("error", () => {
    if (cachedMqttClient === client) cachedMqttClient = null;
  });

  return client;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const token = getBearerToken(req);
    if (!token) return jsonResponse({ error: "Missing authorization" }, 401);

    const body = await req.json();
    const deviceId = String(body.device_id ?? "").trim();
    const commandType = String(body.command_type ?? "").trim();
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

    if (!deviceId || !COMMAND_TYPES.has(commandType)) {
      return jsonResponse({ error: "Invalid device_id or command_type" }, 400);
    }

    const supabase = serviceClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;

    if (userError || !user) return jsonResponse({ error: "Invalid user" }, 401);

    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("user_id, organization_id")
      .eq("device_id", deviceId)
      .single();

    if (deviceError || !device) {
      return jsonResponse({ error: "Device not found" }, 404);
    }

    let canSendCommand = device.user_id === user.id;
    if (!canSendCommand && device.organization_id) {
      const { data: membership, error: membershipError } = await supabase
        .from("organization_members")
        .select("role")
        .eq("organization_id", device.organization_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (membershipError) return jsonResponse({ error: membershipError.message }, 500);
      canSendCommand = ["owner", "manager", "technician"].includes(String(membership?.role ?? ""));
    }

    if (!canSendCommand) {
      return jsonResponse({ error: "You do not have permission to control this device" }, 403);
    }

    const command = {
      id: crypto.randomUUID(),
      user_id: user.id,
      device_id: deviceId,
      command_type: commandType,
      payload,
      status: "pending",
      created_at: new Date().toISOString(),
      acknowledged_at: null,
      completed_at: null,
      error: null,
    };

    // Start the database write, but do not block MQTT on it. The hub can receive
    // the command while Supabase records it for history/status tracking.
    const insertPromise = supabase.from("device_commands").insert(command);

    const mqttUrl = Deno.env.get("MQTT_URL");
    const mqttUsername = Deno.env.get("MQTT_USERNAME");
    const mqttPassword = Deno.env.get("MQTT_PASSWORD");

    if (!mqttUrl || !mqttUsername || !mqttPassword) {
      const { error: insertError } = await insertPromise;
      if (insertError) return jsonResponse({ error: insertError.message }, 500);
      return jsonResponse({ command, mqtt: "not_configured" }, 202);
    }

    try {
      const client = await getMqttClient(mqttUrl, mqttUsername, mqttPassword);

      const topic = `pool/devices/${deviceId}/commands`;
      await withTimeout(
        client.publishAsync(
          topic,
          JSON.stringify({
            id: command.id,
            command_type: commandType,
            payload,
            created_at: command.created_at,
          }),
          // Fast path: the command is already stored in Supabase, so MQTT can be
          // low-latency QoS 0 while the database row remains the backup path.
          { qos: 0, retain: false },
        ),
        600,
        "MQTT publish",
      );

      const { error: insertError } = await insertPromise;
      if (insertError) {
        console.error("Command insert failed after MQTT publish", insertError);
        return jsonResponse({
          command,
          mqtt: "published",
          warning: insertError.message,
        }, 202);
      }

      return jsonResponse({ command, mqtt: "published" }, 201);
    } catch (mqttError) {
      console.error("MQTT publish failed", mqttError);
      const { error: insertError } = await insertPromise;
      if (insertError) return jsonResponse({ error: insertError.message }, 500);
      return jsonResponse({
        command,
        mqtt: "failed",
        mqtt_error: mqttError instanceof Error ? mqttError.message : "Unknown MQTT error",
      }, 202);
    }
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
