import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/deviceAuth.ts";

function getBearerToken(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const token = getBearerToken(req);
    if (!token) return jsonResponse({ error: "Missing authorization" }, 401);

    const body = await req.json();
    const action = cleanString(body.action);
    const organizationId = cleanString(body.organization_id);

    if (!organizationId || !["remove_member", "cancel_invite"].includes(action)) {
      return jsonResponse({ error: "Invalid team action" }, 400);
    }

    const supabase = serviceClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData?.user;

    if (userError || !user) return jsonResponse({ error: "Invalid user" }, 401);

    const { data: requesterMembership, error: requesterError } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (requesterError) return jsonResponse({ error: requesterError.message }, 500);
    if (requesterMembership?.role !== "owner") {
      return jsonResponse({ error: "Only owners can manage team access" }, 403);
    }

    if (action === "remove_member") {
      const targetUserId = cleanString(body.user_id);
      if (!targetUserId) return jsonResponse({ error: "Missing team member" }, 400);

      const { data: targetMembership, error: targetError } = await supabase
        .from("organization_members")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("user_id", targetUserId)
        .maybeSingle();

      if (targetError) return jsonResponse({ error: targetError.message }, 500);
      if (!targetMembership) return jsonResponse({ error: "Team member was not found" }, 404);

      if (targetMembership.role === "owner") {
        const { count, error: ownerCountError } = await supabase
          .from("organization_members")
          .select("user_id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("role", "owner");

        if (ownerCountError) return jsonResponse({ error: ownerCountError.message }, 500);
        if ((count ?? 0) <= 1) {
          return jsonResponse({ error: "You cannot remove the last owner from this Pro account" }, 400);
        }
      }

      const { error: deleteError } = await supabase
        .from("organization_members")
        .delete()
        .eq("organization_id", organizationId)
        .eq("user_id", targetUserId);

      if (deleteError) return jsonResponse({ error: deleteError.message }, 500);

      return jsonResponse({
        removed_user_id: targetUserId,
        message: "Team member removed",
      });
    }

    const inviteId = cleanString(body.invite_id);
    if (!inviteId) return jsonResponse({ error: "Missing invite" }, 400);

    const { data: invite, error: inviteError } = await supabase
      .from("organization_invites")
      .select("id,status")
      .eq("id", inviteId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (inviteError) return jsonResponse({ error: inviteError.message }, 500);
    if (!invite) return jsonResponse({ error: "Invite was not found" }, 404);
    if (invite.status !== "pending") {
      return jsonResponse({ error: "Only pending invites can be cancelled" }, 400);
    }

    const { error: updateError } = await supabase
      .from("organization_invites")
      .update({ status: "cancelled" })
      .eq("id", inviteId)
      .eq("organization_id", organizationId);

    if (updateError) return jsonResponse({ error: updateError.message }, 500);

    return jsonResponse({
      cancelled_invite_id: inviteId,
      message: "Invite cancelled",
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
