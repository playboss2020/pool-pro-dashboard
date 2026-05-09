import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/deviceAuth.ts";

function getBearerToken(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function normalizeSerial(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const token = getBearerToken(req);
    if (!token) return jsonResponse({ error: "Missing authorization" }, 401);

    const body = await req.json();
    const serialNumber = normalizeSerial(body.serial_number);
    const claimCode = String(body.claim_code ?? "").trim();
    const displayName = String(body.name ?? "Pool Hub").trim() || "Pool Hub";

    if (!serialNumber || serialNumber.length < 4) {
      return jsonResponse({ error: "Enter a valid serial number" }, 400);
    }

    const supabase = serviceClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;

    if (userError || !user) return jsonResponse({ error: "Invalid user" }, 401);

    const { data: claim, error: claimError } = await supabase
      .from("device_claims")
      .select("id, serial_number, device_id, device_secret_hash, claim_code_hash, claimed_by, claimed_at, expires_at")
      .eq("serial_number", serialNumber)
      .maybeSingle();

    if (claimError) return jsonResponse({ error: claimError.message }, 500);
    if (!claim) return jsonResponse({ error: "Serial number was not found" }, 404);

    if (claim.expires_at && new Date(claim.expires_at).getTime() < Date.now()) {
      return jsonResponse({ error: "This device claim expired" }, 410);
    }

    if (claim.claimed_by && claim.claimed_by !== user.id) {
      return jsonResponse({ error: "This device is already claimed" }, 409);
    }

    if (claim.claim_code_hash) {
      const { data: codeValid, error: codeError } = await supabase.rpc("verify_device_claim_code", {
        p_serial_number: serialNumber,
        p_claim_code: claimCode,
      });

      if (codeError) return jsonResponse({ error: codeError.message }, 500);
      if (codeValid !== true) return jsonResponse({ error: "Invalid setup code" }, 401);
    }

    const { data: existingDevice, error: existingError } = await supabase
      .from("devices")
      .select("id, user_id, device_id")
      .eq("device_id", claim.device_id)
      .maybeSingle();

    if (existingError) return jsonResponse({ error: existingError.message }, 500);
    if (existingDevice?.user_id && existingDevice.user_id !== user.id && claim.claimed_by) {
      return jsonResponse({ error: "This device is already assigned to another account" }, 409);
    }

    if (existingDevice) {
      const { error: updateDeviceError } = await supabase
        .from("devices")
        .update({
          user_id: user.id,
          serial_number: serialNumber,
          name: displayName,
        })
        .eq("device_id", claim.device_id);

      if (updateDeviceError) return jsonResponse({ error: updateDeviceError.message }, 500);
    } else {
      const { error: insertDeviceError } = await supabase.from("devices").insert({
        user_id: user.id,
        device_id: claim.device_id,
        serial_number: serialNumber,
        name: displayName,
      });

      if (insertDeviceError) return jsonResponse({ error: insertDeviceError.message }, 500);
    }

    const { error: upsertSecretError } = await supabase.from("device_secrets").upsert({
      device_id: claim.device_id,
      secret_hash: claim.device_secret_hash,
    });

    if (upsertSecretError) return jsonResponse({ error: upsertSecretError.message }, 500);

    const { error: updateClaimError } = await supabase
      .from("device_claims")
      .update({
        claimed_by: user.id,
        claimed_at: claim.claimed_at ?? new Date().toISOString(),
      })
      .eq("id", claim.id);

    if (updateClaimError) return jsonResponse({ error: updateClaimError.message }, 500);

    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("*")
      .eq("device_id", claim.device_id)
      .single();

    if (deviceError) return jsonResponse({ error: deviceError.message }, 500);

    return jsonResponse({ device });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
