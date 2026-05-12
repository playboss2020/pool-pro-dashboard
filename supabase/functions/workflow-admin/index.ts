import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/deviceAuth.ts";

type AdminAction =
  | "overview"
  | "create_pro_account"
  | "register_device"
  | "assign_device"
  | "update_organization_status"
  | "delete_organization"
  | "get_firmware_templates"
  | "save_firmware_template"
  | "record_firmware_download"
  | "list_firmware_downloads";

function getBearerToken(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function cleanEmail(value: unknown) {
  return cleanString(value).toLowerCase();
}

function normalizeSerial(value: unknown) {
  return cleanString(value).toUpperCase().replace(/\s+/g, "");
}

function cleanFirmwareTarget(value: unknown) {
  const target = cleanString(value).toLowerCase();
  return target === "hub" || target === "node" ? target : null;
}

function allowedAdminEmails() {
  return new Set(
    (Deno.env.get("WORKFLOW_ADMIN_EMAILS") ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isOnline(device: { online_status?: string | null; last_seen?: string | null }) {
  if (device.online_status !== "online" || !device.last_seen) return false;
  return Date.now() - new Date(device.last_seen).getTime() < 120000;
}

function countBy<T>(items: T[], keyForItem: (item: T) => string | null | undefined) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyForItem(item);
    if (!key) return counts;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

async function requireWorkflowAdmin(req: Request, action: AdminAction) {
  const token = getBearerToken(req);
  if (!token) {
    return {
      ok: false as const,
      status: 401,
      response: jsonResponse({ error: "Missing authorization" }, 401),
    };
  }

  const supabase = serviceClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;

  if (userError || !user?.email) {
    return {
      ok: false as const,
      status: 401,
      response: jsonResponse({ error: "Invalid user" }, 401),
    };
  }

  const admins = allowedAdminEmails();
  const isAdmin = admins.has(user.email.toLowerCase());

  if (!isAdmin && action === "overview") {
    return {
      ok: false as const,
      status: 200,
      response: jsonResponse({ is_admin: false }),
    };
  }

  if (!isAdmin) {
    return {
      ok: false as const,
      status: 403,
      response: jsonResponse({ error: "This account is not a Workflow admin" }, 403),
    };
  }

  return {
    ok: true as const,
    supabase,
    user,
  };
}

async function loadOverview(supabase: ReturnType<typeof serviceClient>, adminEmail: string) {
  const [
    organizationsResult,
    membersResult,
    invitesResult,
    devicesResult,
    claimsResult,
    downloadsResult,
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("id,name,plan,account_status,suspended_at,logo_url,company_email,company_phone,company_address,company_city,company_state,company_zip,created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("organization_members")
      .select("organization_id,user_id,role,display_name,email,created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("organization_invites")
      .select("id,organization_id,email,role,status,created_at,expires_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("devices")
      .select("id,user_id,organization_id,device_id,serial_number,name,property_name,address,city,state,zip,current_temp,pump_on,heater_enabled,setpoint,total_kwh,online_status,last_seen,updated_at")
      .order("updated_at", { ascending: false }),
    supabase
      .from("device_claims")
      .select("id,serial_number,device_id,claimed_by,claimed_at,expires_at,created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("workflow_firmware_downloads")
      .select("device_id,target,downloaded_at")
      .order("downloaded_at", { ascending: false }),
  ]);

  for (const result of [organizationsResult, membersResult, invitesResult, devicesResult, claimsResult, downloadsResult]) {
    if (result.error) throw result.error;
  }

  const organizations = organizationsResult.data ?? [];
  const members = membersResult.data ?? [];
  const invites = invitesResult.data ?? [];
  const devices = devicesResult.data ?? [];
  const claims = claimsResult.data ?? [];
  const downloads = downloadsResult.data ?? [];
  const devicesByOrg = countBy(devices, (device) => cleanString(device.organization_id));
  const membersByOrg = countBy(members, (member) => cleanString(member.organization_id));
  const invitesByOrg = countBy(invites, (invite) => cleanString(invite.organization_id));
  const organizationNameById = new Map(organizations.map((organization) => [organization.id, organization.name]));
  const hubDownloadDeviceIds = new Set(
    downloads
      .filter((download) => download.target === "hub")
      .map((download) => cleanString(download.device_id))
      .filter(Boolean),
  );

  return {
    is_admin: true,
    admin_email: adminEmail,
    stats: {
      total_organizations: organizations.length,
      pro_organizations: organizations.filter((organization) => organization.plan === "pro").length,
      enterprise_organizations: organizations.filter((organization) => organization.plan === "enterprise").length,
      suspended_organizations: organizations.filter((organization) => organization.account_status === "suspended").length,
      total_devices: devices.length,
      online_devices: devices.filter(isOnline).length,
      unassigned_devices: devices.filter((device) => !device.organization_id).length,
      unclaimed_devices: claims.filter((claim) => !claim.claimed_by).length,
      ready_to_claim_devices: claims.filter((claim) => !claim.claimed_by).length,
      devices_missing_firmware_download: claims.filter((claim) => !hubDownloadDeviceIds.has(claim.device_id)).length,
      hub_firmware_downloaded_devices: hubDownloadDeviceIds.size,
      pending_invites: invites.length,
    },
    organizations: organizations.map((organization) => ({
      ...organization,
      device_count: devicesByOrg[organization.id] ?? 0,
      member_count: membersByOrg[organization.id] ?? 0,
      pending_invite_count: invitesByOrg[organization.id] ?? 0,
    })),
    members,
    invites,
    devices: devices.map((device) => ({
      ...device,
      organization_name: device.organization_id ? organizationNameById.get(device.organization_id) ?? null : null,
    })),
    claims,
  };
}

async function updateOrganizationStatus(supabase: ReturnType<typeof serviceClient>, body: Record<string, unknown>) {
  const organizationId = cleanString(body.organization_id);
  const accountStatus = cleanString(body.account_status);

  if (!organizationId || !["active", "suspended"].includes(accountStatus)) {
    return jsonResponse({ error: "Organization and valid account status are required" }, 400);
  }

  const { data: organization, error } = await supabase
    .from("organizations")
    .update({
      account_status: accountStatus,
      suspended_at: accountStatus === "suspended" ? new Date().toISOString() : null,
    })
    .eq("id", organizationId)
    .select("id,name,account_status,suspended_at")
    .single();

  if (error) throw error;

  return jsonResponse({
    organization,
    message: accountStatus === "suspended" ? "Pro account suspended" : "Pro account reactivated",
  });
}

async function deleteOrganization(supabase: ReturnType<typeof serviceClient>, body: Record<string, unknown>) {
  const organizationId = cleanString(body.organization_id);
  const confirmName = cleanString(body.confirm_name);

  if (!organizationId || !confirmName) {
    return jsonResponse({ error: "Organization and confirmation name are required" }, 400);
  }

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id,name")
    .eq("id", organizationId)
    .maybeSingle();

  if (organizationError) throw organizationError;
  if (!organization) return jsonResponse({ error: "Organization not found" }, 404);
  if (confirmName !== organization.name) {
    return jsonResponse({ error: "Confirmation name does not match the Pro account name" }, 400);
  }

  const { error: deleteError } = await supabase
    .from("organizations")
    .delete()
    .eq("id", organizationId);

  if (deleteError) throw deleteError;

  return jsonResponse({
    organization_id: organizationId,
    message: "Pro account deleted. Devices were unassigned, not erased.",
  });
}

async function findUserByEmail(supabase: ReturnType<typeof serviceClient>, email: string) {
  let page = 1;
  while (page <= 10) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 100) return null;
    page += 1;
  }

  return null;
}

async function createProAccount(supabase: ReturnType<typeof serviceClient>, body: Record<string, unknown>) {
  const companyName = cleanString(body.company_name) || "New Pro Account";
  const ownerEmail = cleanEmail(body.owner_email);
  const companyPhone = cleanString(body.company_phone);
  const plan = cleanString(body.plan) === "enterprise" ? "enterprise" : "pro";

  if (!ownerEmail || !ownerEmail.includes("@")) {
    return jsonResponse({ error: "Owner email is required" }, 400);
  }

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .insert({
      name: companyName,
      plan,
      company_email: ownerEmail,
      company_phone: companyPhone || null,
    })
    .select("id,name,plan,company_email,company_phone,created_at")
    .single();

  if (organizationError) throw organizationError;

  let ownerUser = await findUserByEmail(supabase, ownerEmail);
  let inviteStatus = "not_needed";

  if (!ownerUser) {
    const { data: invitedUser, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(ownerEmail, {
      data: {
        organization_id: organization.id,
        organization_role: "owner",
      },
    });

    if (inviteError) {
      inviteStatus = `email_invite_failed: ${inviteError.message}`;
    } else {
      ownerUser = invitedUser.user;
      inviteStatus = "email_invite_sent";
    }
  }

  if (ownerUser?.id) {
    const { error: memberError } = await supabase
      .from("organization_members")
      .upsert({
        organization_id: organization.id,
        user_id: ownerUser.id,
        role: "owner",
        email: ownerEmail,
      }, {
        onConflict: "organization_id,user_id",
      });

    if (memberError) throw memberError;
  } else {
    const { error: inviteRowError } = await supabase
      .from("organization_invites")
      .insert({
        organization_id: organization.id,
        email: ownerEmail,
        role: "owner",
        status: "pending",
      });

    if (inviteRowError && inviteRowError.code !== "23505") throw inviteRowError;
    if (inviteStatus === "not_needed") inviteStatus = "pending_invite_created";
  }

  return jsonResponse({
    organization,
    owner_user_id: ownerUser?.id ?? null,
    invite_status: inviteStatus,
    message: "Pro account created",
  });
}

async function hashSecret(supabase: ReturnType<typeof serviceClient>, value: string) {
  const { data, error } = await supabase.rpc("workflow_hash_secret", {
    p_secret: value,
  });

  if (error) throw error;
  if (!data || typeof data !== "string") throw new Error("Unable to hash device secret");
  return data;
}

async function registerDevice(
  supabase: ReturnType<typeof serviceClient>,
  adminUserId: string,
  body: Record<string, unknown>,
) {
  const serialNumber = normalizeSerial(body.serial_number);
  const deviceId = cleanString(body.device_id);
  const deviceSecret = cleanString(body.device_secret);
  const claimCode = cleanString(body.claim_code);
  const name = cleanString(body.name) || "Pool Hub";

  if (!serialNumber || serialNumber.length < 6) {
    return jsonResponse({ error: "Enter a valid serial number" }, 400);
  }

  if (!deviceId || deviceId.length < 4) {
    return jsonResponse({ error: "Enter a valid device ID" }, 400);
  }

  if (!deviceSecret || deviceSecret.length < 12) {
    return jsonResponse({ error: "Device secret must be at least 12 characters" }, 400);
  }

  const { data: existingClaim, error: existingClaimError } = await supabase
    .from("device_claims")
    .select("id,serial_number,device_id,claimed_by")
    .or(`serial_number.eq.${serialNumber},device_id.eq.${deviceId}`)
    .maybeSingle();

  if (existingClaimError) throw existingClaimError;
  if (existingClaim?.claimed_by) {
    return jsonResponse({ error: "This serial or device ID is already claimed" }, 409);
  }

  const deviceSecretHash = await hashSecret(supabase, deviceSecret);
  const claimCodeHash = claimCode ? await hashSecret(supabase, claimCode) : null;

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .upsert({
      user_id: adminUserId,
      device_id: deviceId,
      serial_number: serialNumber,
      name,
      online_status: "offline",
    }, {
      onConflict: "device_id",
    })
    .select("device_id,serial_number,name,online_status")
    .single();

  if (deviceError) throw deviceError;

  const { error: secretError } = await supabase
    .from("device_secrets")
    .upsert({
      device_id: deviceId,
      secret_hash: deviceSecretHash,
      rotated_at: new Date().toISOString(),
    }, {
      onConflict: "device_id",
    });

  if (secretError) throw secretError;

  const claimPayload = {
    serial_number: serialNumber,
    device_id: deviceId,
    device_secret_hash: deviceSecretHash,
    claim_code_hash: claimCodeHash,
    claimed_by: null,
    claimed_at: null,
  };

  const claimQuery = existingClaim?.id
    ? supabase.from("device_claims").update(claimPayload).eq("id", existingClaim.id)
    : supabase.from("device_claims").insert(claimPayload);

  const { data: claim, error: claimError } = await claimQuery
    .select("id,serial_number,device_id,claimed_by,claimed_at,expires_at,created_at")
    .single();

  if (claimError) throw claimError;

  return jsonResponse({
    device,
    claim,
    firmware: {
      device_id: deviceId,
      device_secret: deviceSecret,
      serial_number: serialNumber,
      claim_code: claimCode || null,
    },
    message: "Device registered",
  });
}

async function assignDevice(supabase: ReturnType<typeof serviceClient>, body: Record<string, unknown>) {
  const organizationId = cleanString(body.organization_id);
  const targetDeviceId = cleanString(body.device_id);
  const propertyName = cleanString(body.property_name);

  if (!organizationId || !targetDeviceId) {
    return jsonResponse({ error: "Organization and device are required" }, 400);
  }

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id,name")
    .eq("id", organizationId)
    .maybeSingle();

  if (organizationError) throw organizationError;
  if (!organization) return jsonResponse({ error: "Organization not found" }, 404);

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .update({
      organization_id: organizationId,
      property_name: propertyName || null,
      name: propertyName || "Pool Hub",
    })
    .eq("device_id", targetDeviceId)
    .select("device_id,serial_number,name,property_name,organization_id")
    .single();

  if (deviceError) throw deviceError;

  return jsonResponse({
    device,
    organization,
    message: "Device assigned to Pro account",
  });
}

async function getFirmwareTemplates(supabase: ReturnType<typeof serviceClient>) {
  const { data, error } = await supabase
    .from("workflow_firmware_templates")
    .select("target,version,code,updated_by,updated_at")
    .order("target", { ascending: true });

  if (error) throw error;
  return jsonResponse({ templates: data ?? [] });
}

async function saveFirmwareTemplate(
  supabase: ReturnType<typeof serviceClient>,
  adminUserId: string,
  body: Record<string, unknown>,
) {
  const target = cleanFirmwareTarget(body.target);
  const version = cleanString(body.version);
  const code = String(body.code ?? "");

  if (!target) {
    return jsonResponse({ error: "Firmware target must be hub or node" }, 400);
  }

  if (!version) {
    return jsonResponse({ error: "Firmware version is required" }, 400);
  }

  if (code.trim().length < 100) {
    return jsonResponse({ error: "Paste the full firmware code before saving" }, 400);
  }

  if (target === "hub") {
    const hasDeviceId = /^constexpr\s+char\s+DEVICE_ID\[\]\s*=.+;$/m.test(code);
    const hasDeviceSecret = /^constexpr\s+char\s+DEVICE_SECRET\[\]\s*=.+;$/m.test(code);
    if (!hasDeviceId || !hasDeviceSecret) {
      return jsonResponse({
        error: "Hub code must include constexpr char DEVICE_ID[] and DEVICE_SECRET[] so device downloads can be generated",
      }, 400);
    }
  }

  const { data: template, error } = await supabase
    .from("workflow_firmware_templates")
    .upsert({
      target,
      version,
      code,
      updated_by: adminUserId,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "target",
    })
    .select("target,version,code,updated_by,updated_at")
    .single();

  if (error) throw error;

  return jsonResponse({
    template,
    message: `${target === "hub" ? "Hub" : "Node"} firmware template saved`,
  });
}

async function recordFirmwareDownload(
  supabase: ReturnType<typeof serviceClient>,
  adminUserId: string,
  body: Record<string, unknown>,
) {
  const target = cleanFirmwareTarget(body.target);
  const deviceId = cleanString(body.device_id);
  const serialNumber = normalizeSerial(body.serial_number);
  const templateVersion = cleanString(body.template_version);
  const code = typeof body.code === "string" ? body.code : null;
  const fileName = cleanString(body.file_name);

  if (!target || !deviceId) {
    return jsonResponse({ error: "Firmware target and device ID are required" }, 400);
  }

  const { data: download, error } = await supabase
    .from("workflow_firmware_downloads")
    .insert({
      device_id: deviceId,
      serial_number: serialNumber || null,
      target,
      template_version: templateVersion || null,
      downloaded_by: adminUserId,
      code,
      file_name: fileName || null,
    })
    .select("id,device_id,serial_number,target,template_version,downloaded_at,file_name")
    .single();

  if (error) throw error;

  return jsonResponse({
    download,
    message: `${target === "hub" ? "Hub" : "Node"} firmware download recorded`,
  });
}

async function listFirmwareDownloads(
  supabase: ReturnType<typeof serviceClient>,
  body: Record<string, unknown>,
) {
  const includeCode = body.include_code === true;
  const requestedId = typeof body.id === "string" ? body.id.trim() : "";

  if (requestedId) {
    const { data: row, error } = await supabase
      .from("workflow_firmware_downloads")
      .select("id,device_id,serial_number,target,template_version,downloaded_at,file_name,code")
      .eq("id", requestedId)
      .maybeSingle();
    if (error) throw error;
    return jsonResponse({ download: row });
  }

  const columns = includeCode
    ? "id,device_id,serial_number,target,template_version,downloaded_at,file_name,code"
    : "id,device_id,serial_number,target,template_version,downloaded_at,file_name";

  const { data, error } = await supabase
    .from("workflow_firmware_downloads")
    .select(columns)
    .order("downloaded_at", { ascending: false })
    .limit(200);

  if (error) throw error;

  return jsonResponse({ downloads: data ?? [] });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = (cleanString(body.action) || "overview") as AdminAction;

    if (![
      "overview",
      "create_pro_account",
      "register_device",
      "assign_device",
      "update_organization_status",
      "delete_organization",
      "get_firmware_templates",
      "save_firmware_template",
      "record_firmware_download",
      "list_firmware_downloads",
    ].includes(action)) {
      return jsonResponse({ error: "Invalid admin action" }, 400);
    }

    const admin = await requireWorkflowAdmin(req, action);
    if (!admin.ok) return admin.response;

    if (action === "create_pro_account") return await createProAccount(admin.supabase, body);
    if (action === "register_device") return await registerDevice(admin.supabase, admin.user.id, body);
    if (action === "assign_device") return await assignDevice(admin.supabase, body);
    if (action === "update_organization_status") return await updateOrganizationStatus(admin.supabase, body);
    if (action === "delete_organization") return await deleteOrganization(admin.supabase, body);
    if (action === "get_firmware_templates") return await getFirmwareTemplates(admin.supabase);
    if (action === "save_firmware_template") return await saveFirmwareTemplate(admin.supabase, admin.user.id, body);
    if (action === "record_firmware_download") return await recordFirmwareDownload(admin.supabase, admin.user.id, body);
    if (action === "list_firmware_downloads") return await listFirmwareDownloads(admin.supabase, body);

    return jsonResponse(await loadOverview(admin.supabase, admin.user.email ?? ""));
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
