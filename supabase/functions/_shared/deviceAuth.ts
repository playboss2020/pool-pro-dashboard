import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type DeviceContext = {
  deviceId: string;
  userId: string;
};

export function serviceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function requireDevice(req: Request): Promise<DeviceContext> {
  const deviceId = req.headers.get("x-device-id")?.trim() ?? "";
  const deviceSecret = req.headers.get("x-device-secret")?.trim() ?? "";

  if (!deviceId || !deviceSecret) {
    throw new Response(JSON.stringify({ error: "Missing device credentials" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = serviceClient();
  const { data: verified, error: verifyError } = await supabase.rpc("verify_device_secret", {
    p_device_id: deviceId,
    p_device_secret: deviceSecret,
  });

  if (verifyError || verified !== true) {
    throw new Response(JSON.stringify({ error: "Invalid device credentials" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .select("user_id")
    .eq("device_id", deviceId)
    .single();

  if (deviceError || !device?.user_id) {
    throw new Response(JSON.stringify({ error: "Device not registered" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return {
    deviceId,
    userId: device.user_id,
  };
}

export function isResponse(error: unknown): error is Response {
  return error instanceof Response;
}
