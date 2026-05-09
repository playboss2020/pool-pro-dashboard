import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/deviceAuth.ts";

function getBearerToken(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    if (Deno.env.get("PRO_BOOTSTRAP_ENABLED") !== "true") {
      return jsonResponse({ error: "Pro bootstrap is disabled" }, 403);
    }

    const token = getBearerToken(req);
    if (!token) return jsonResponse({ error: "Missing authorization" }, 401);

    const supabase = serviceClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;

    if (userError || !user) return jsonResponse({ error: "Invalid user" }, 401);

    const allowedEmails = (Deno.env.get("PRO_BOOTSTRAP_ALLOWED_EMAILS") ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    if (allowedEmails.length > 0 && !allowedEmails.includes((user.email ?? "").toLowerCase())) {
      return jsonResponse({ error: "This account is not allowed to enable Pro" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const orgName = String(body.org_name ?? "Workflow Pro Account").trim() || "Workflow Pro Account";
    const propertyName = String(body.property_name ?? "Main Pool").trim() || "Main Pool";

    const { data: existingMembership, error: existingError } = await supabase
      .from("organization_members")
      .select("organization_id,role,organization:organizations(id,name,plan,created_at)")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (existingError) return jsonResponse({ error: existingError.message }, 500);

    let organizationId = String(existingMembership?.organization_id ?? "");

    if (!organizationId) {
      const { data: organization, error: orgError } = await supabase
        .from("organizations")
        .insert({ name: orgName, plan: "pro" })
        .select("id")
        .single();

      if (orgError) return jsonResponse({ error: orgError.message }, 500);
      organizationId = organization.id;

      const { error: memberError } = await supabase.from("organization_members").insert({
        organization_id: organizationId,
        user_id: user.id,
        role: "owner",
      });

      if (memberError) return jsonResponse({ error: memberError.message }, 500);
    }

    const { data: ownedDevices, error: ownedDevicesError } = await supabase
      .from("devices")
      .select("device_id,name,property_name,address,city,state,zip")
      .eq("user_id", user.id);

    if (ownedDevicesError) return jsonResponse({ error: ownedDevicesError.message }, 500);

    for (const device of ownedDevices ?? []) {
      const { error: updateError } = await supabase
        .from("devices")
        .update({
          organization_id: organizationId,
          property_name: device.property_name ?? propertyName,
          address: device.address ?? "Address not set",
          city: device.city ?? "",
          state: device.state ?? "",
          zip: device.zip ?? "",
        })
        .eq("device_id", device.device_id);

      if (updateError) return jsonResponse({ error: updateError.message }, 500);
    }

    return jsonResponse({
      organization_id: organizationId,
      linked_devices: ownedDevices?.length ?? 0,
      message: "Pro dashboard enabled for this account",
    }, existingMembership ? 200 : 201);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
