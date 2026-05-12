import { deviceId, requireSupabase, supabase } from "./supabase";
import { isDirectMqttConfigured, publishDirectMqttCommand } from "./mqttClient";

export type PoolDevice = {
  id: string;
  user_id: string;
  organization_id?: string | null;
  device_id: string;
  serial_number: string | null;
  name: string;
  property_name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  property_notes?: string | null;
  current_temp: number | null;
  pump_on: boolean;
  heater_enabled: boolean;
  heater_relay_on: boolean;
  setpoint: number | null;
  pump_watts: number | null;
  heater_watts: number | null;
  total_kwh: number | null;
  electricity_rate_per_kwh: number | null;
  temp_calibration_offset: number | null;
  wattage_calibration_scale: number | null;
  last_seen: string | null;
  online_status: "online" | "offline" | "unknown";
  firmware_version: string | null;
  wifi_ssid: string | null;
  wifi_rssi: number | null;
  lora_rssi?: number | null;
  lora_snr?: number | null;
  node_online?: boolean | null;
  node_last_seen?: string | null;
  updated_at: string;
};

export type DeviceCommandType =
  | "pump_on"
  | "pump_off"
  | "heater_enable"
  | "heater_disable"
  | "set_setpoint"
  | "set_calibration"
  | "sync_schedules"
  | "reboot_device"
  | "clear_alerts";

export type DeviceCommand = {
  id: string;
  command_type: DeviceCommandType;
  payload: Record<string, unknown>;
  status: "pending" | "acknowledged" | "completed" | "failed";
  created_at: string;
  acknowledged_at: string | null;
  completed_at: string | null;
  error: string | null;
};

export type DeviceSchedule = {
  id: string;
  user_id: string;
  device_id: string;
  name: string | null;
  target: "pump" | "heater";
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
  days_of_week: number[];
  enabled: boolean;
  updated_at: string;
};

export type DeviceScheduleOverride = {
  id: string;
  user_id: string;
  device_id: string;
  name: string | null;
  override_type: "reservation_heat" | string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  pump_on: boolean;
  heater_enabled: boolean;
  setpoint: number | null;
  suspend_regular_schedules: boolean;
  status: "scheduled" | "active" | "completed" | "cancelled" | string;
  created_at: string;
  updated_at: string;
};

export type DeviceAlert = {
  id: string;
  alert_type: string;
  alert_key: string | null;
  severity: "info" | "warning" | "critical";
  message: string;
  acknowledged: boolean;
  created_at: string;
  resolved_at: string | null;
};

export type DeviceHistory = {
  id: string;
  device_id: string;
  current_temp: number | null;
  pump_watts: number | null;
  heater_watts: number | null;
  total_kwh: number | null;
  created_at: string;
  sample_count: number;
};

export type HistoryPeriod = "day" | "month" | "year";

export type ClaimedDeviceResponse = {
  device: PoolDevice;
};

export type UnclaimedDeviceResponse = {
  removed_device_id: string;
  message: string;
};

export type Organization = {
  id: string;
  name: string;
  plan: "pro" | "enterprise" | string;
  account_status?: "active" | "suspended" | string;
  suspended_at?: string | null;
  logo_url?: string | null;
  company_address?: string | null;
  company_city?: string | null;
  company_state?: string | null;
  company_zip?: string | null;
  company_phone?: string | null;
  company_email?: string | null;
  company_notes?: string | null;
  created_at: string;
};

export type OrganizationRole = "owner" | "manager" | "technician" | "viewer";

export type OrganizationMember = {
  organization_id: string;
  user_id: string;
  role: OrganizationRole | string;
  display_name: string | null;
  email: string | null;
  created_at: string | null;
};

export type OrganizationInvite = {
  id: string;
  organization_id: string;
  email: string;
  role: OrganizationRole | string;
  status: "pending" | "accepted" | "cancelled" | "expired" | string;
  invited_by: string | null;
  created_at: string;
  accepted_at: string | null;
  expires_at: string | null;
};

export type TeamManagementResponse = {
  message: string;
  removed_user_id?: string;
  cancelled_invite_id?: string;
};

export type ProAccount = {
  organization: Organization;
  membership: OrganizationMember;
  devices: PoolDevice[];
  members: OrganizationMember[];
  invites: OrganizationInvite[];
  scheduleOverrides: DeviceScheduleOverride[];
};

export type BootstrapProAccountResponse = {
  organization_id: string;
  linked_devices: number;
  message: string;
};

export type WorkflowAdminStats = {
  total_organizations: number;
  pro_organizations: number;
  enterprise_organizations: number;
  suspended_organizations: number;
  total_devices: number;
  online_devices: number;
  unassigned_devices: number;
  unclaimed_devices: number;
  ready_to_claim_devices?: number;
  devices_missing_firmware_download?: number;
  hub_firmware_downloaded_devices?: number;
  pending_invites: number;
};

export type WorkflowAdminOrganization = Organization & {
  device_count: number;
  member_count: number;
  pending_invite_count: number;
};

export type WorkflowAdminDevice = Pick<
  PoolDevice,
  | "id"
  | "user_id"
  | "organization_id"
  | "device_id"
  | "serial_number"
  | "name"
  | "property_name"
  | "address"
  | "city"
  | "state"
  | "zip"
  | "current_temp"
  | "pump_on"
  | "heater_enabled"
  | "setpoint"
  | "total_kwh"
  | "online_status"
  | "last_seen"
  | "updated_at"
> & {
  organization_name: string | null;
};

export type WorkflowAdminClaim = {
  id: string;
  serial_number: string;
  device_id: string;
  claimed_by: string | null;
  claimed_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export type WorkflowAdminOverview = {
  is_admin: boolean;
  admin_email: string;
  stats: WorkflowAdminStats;
  organizations: WorkflowAdminOrganization[];
  members: OrganizationMember[];
  invites: OrganizationInvite[];
  devices: WorkflowAdminDevice[];
  claims: WorkflowAdminClaim[];
};

export type WorkflowAdminCreateProInput = {
  company_name: string;
  owner_email: string;
  company_phone: string;
  plan: "pro" | "enterprise";
};

export type WorkflowAdminCreateProResponse = {
  organization: Pick<Organization, "id" | "name" | "plan" | "company_email" | "company_phone" | "created_at">;
  owner_user_id: string | null;
  invite_status: string;
  message: string;
};

export type WorkflowAdminRegisterDeviceInput = {
  serial_number: string;
  device_id: string;
  device_secret: string;
  claim_code: string;
  name: string;
};

export type WorkflowAdminRegisterDeviceResponse = {
  device: Pick<PoolDevice, "device_id" | "serial_number" | "name" | "online_status">;
  claim: WorkflowAdminClaim;
  firmware: {
    device_id: string;
    device_secret: string;
    serial_number: string;
    claim_code: string | null;
  };
  message: string;
};

export type WorkflowAdminAssignDeviceInput = {
  organization_id: string;
  device_id: string;
  property_name: string;
};

export type WorkflowAdminAssignDeviceResponse = {
  device: Pick<PoolDevice, "device_id" | "serial_number" | "name" | "property_name" | "organization_id">;
  organization: Pick<Organization, "id" | "name">;
  message: string;
};

export type WorkflowAdminOrganizationActionResponse = {
  organization?: Pick<Organization, "id" | "name" | "account_status" | "suspended_at">;
  organization_id?: string;
  message: string;
};

export type FirmwareTarget = "hub" | "node";

export type WorkflowFirmwareTemplate = {
  target: FirmwareTarget;
  version: string;
  code: string;
  updated_by: string | null;
  updated_at: string;
};

export type WorkflowFirmwareTemplatesResponse = {
  templates: WorkflowFirmwareTemplate[];
};

export type WorkflowFirmwareTemplateSaveInput = {
  target: FirmwareTarget;
  version: string;
  code: string;
};

export type WorkflowFirmwareTemplateSaveResponse = {
  template: WorkflowFirmwareTemplate;
  message: string;
};

export type WorkflowFirmwareDownloadInput = {
  device_id: string;
  serial_number: string | null;
  target: FirmwareTarget;
  template_version: string;
};

export type WorkflowFirmwareDownloadResponse = {
  download: {
    id: string;
    device_id: string;
    serial_number: string | null;
    target: FirmwareTarget;
    template_version: string | null;
    downloaded_at: string;
  };
  message: string;
};

export type DevicePropertyInput = {
  name: string;
  property_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  property_notes: string;
};

export type OrganizationProfileInput = {
  name: string;
  company_address: string;
  company_city: string;
  company_state: string;
  company_zip: string;
  company_phone: string;
  company_email: string;
  company_notes: string;
};

export type DeviceScheduleOverrideInput = {
  user_id: string;
  device_id: string;
  name: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  setpoint: number | null;
};

const DEVICE_SELECT_COLUMNS = [
  "id",
  "user_id",
  "device_id",
  "serial_number",
  "name",
  "current_temp",
  "pump_on",
  "heater_enabled",
  "heater_relay_on",
  "setpoint",
  "pump_watts",
  "heater_watts",
  "total_kwh",
  "electricity_rate_per_kwh",
  "temp_calibration_offset",
  "wattage_calibration_scale",
  "last_seen",
  "online_status",
  "firmware_version",
  "wifi_ssid",
  "wifi_rssi",
  "lora_rssi",
  "lora_snr",
  "node_online",
  "node_last_seen",
  "updated_at",
].join(",");

const PRO_DEVICE_SELECT_COLUMNS = [
  DEVICE_SELECT_COLUMNS,
  "organization_id",
  "property_name",
  "address",
  "city",
  "state",
  "zip",
  "property_notes",
].join(",");

const ORGANIZATION_SELECT_COLUMNS = [
  "id",
  "name",
  "plan",
  "account_status",
  "suspended_at",
  "logo_url",
  "company_address",
  "company_city",
  "company_state",
  "company_zip",
  "company_phone",
  "company_email",
  "company_notes",
  "created_at",
].join(",");

const ORGANIZATION_MEMBER_SELECT_COLUMNS = "organization_id,user_id,role,display_name,email,created_at";
const ORGANIZATION_INVITE_SELECT_COLUMNS = "id,organization_id,email,role,status,invited_by,created_at,accepted_at,expires_at";
const SCHEDULE_OVERRIDE_SELECT_COLUMNS = [
  "id",
  "user_id",
  "device_id",
  "name",
  "override_type",
  "start_date",
  "end_date",
  "start_time",
  "end_time",
  "pump_on",
  "heater_enabled",
  "setpoint",
  "suspend_regular_schedules",
  "status",
  "created_at",
  "updated_at",
].join(",");

export async function fetchDevice() {
  const client = requireSupabase();
  const { data, error } = await client
    .from("devices")
    .select(DEVICE_SELECT_COLUMNS)
    .eq("device_id", deviceId)
    .maybeSingle<PoolDevice>();

  if (error) throw error;
  return data as PoolDevice | null;
}

export async function fetchDevices() {
  const client = requireSupabase();
  const { data, error } = await client
    .from("devices")
    .select(DEVICE_SELECT_COLUMNS)
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as PoolDevice[];
}

export async function fetchProAccount(userId: string): Promise<ProAccount | null> {
  const client = requireSupabase();
  const { data: membershipData, error: membershipError } = await client
    .from("organization_members")
    .select(ORGANIZATION_MEMBER_SELECT_COLUMNS)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    // If the Pro tables have not been deployed yet, keep the regular homeowner
    // dashboard working instead of blocking login.
    if (membershipError.code === "42P01" || membershipError.code === "42703") return null;
    throw membershipError;
  }

  if (!membershipData) return null;

  const membership: OrganizationMember = {
    organization_id: String(membershipData.organization_id),
    user_id: String(membershipData.user_id),
    role: String(membershipData.role),
    display_name: membershipData.display_name ? String(membershipData.display_name) : null,
    email: membershipData.email ? String(membershipData.email) : null,
    created_at: membershipData.created_at ? String(membershipData.created_at) : null,
  };

  const { data: organization, error: organizationError } = await client
    .from("organizations")
    .select(ORGANIZATION_SELECT_COLUMNS)
    .eq("id", membership.organization_id)
    .single<Organization>();

  if (organizationError) throw organizationError;

  const { data: devices, error: devicesError } = await client
    .from("devices")
    .select(PRO_DEVICE_SELECT_COLUMNS)
    .eq("organization_id", organization.id)
    .order("property_name", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });

  if (devicesError) throw devicesError;

  const { data: members, error: membersError } = await client
    .from("organization_members")
    .select(ORGANIZATION_MEMBER_SELECT_COLUMNS)
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: true });

  if (membersError) throw membersError;

  const { data: invites, error: invitesError } = await client
    .from("organization_invites")
    .select(ORGANIZATION_INVITE_SELECT_COLUMNS)
    .eq("organization_id", organization.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (invitesError) {
    if (!["42P01", "42703", "PGRST205"].includes(invitesError.code ?? "")) throw invitesError;
  }

  const deviceIds = ((devices ?? []) as unknown as PoolDevice[]).map((device) => device.device_id);
  let scheduleOverrides: DeviceScheduleOverride[] = [];
  if (deviceIds.length > 0) {
    const { data: overrides, error: overridesError } = await client
      .from("device_schedule_overrides")
      .select(SCHEDULE_OVERRIDE_SELECT_COLUMNS)
      .in("device_id", deviceIds)
      .neq("status", "cancelled")
      .order("start_date", { ascending: true });

    if (overridesError) {
      if (!["42P01", "42703", "PGRST205"].includes(overridesError.code ?? "")) throw overridesError;
    } else {
      scheduleOverrides = (overrides ?? []) as unknown as DeviceScheduleOverride[];
    }
  }

  return {
    organization,
    membership,
    devices: (devices ?? []) as unknown as PoolDevice[],
    members: (members ?? []) as unknown as OrganizationMember[],
    invites: (invites ?? []) as unknown as OrganizationInvite[],
    scheduleOverrides,
  };
}

export async function bootstrapProAccount() {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<BootstrapProAccountResponse>("bootstrap-pro-account", {
    body: {
      org_name: "Workflow Pro Account",
      property_name: "Main Pool",
    },
  });

  if (error) throw error;
  if (!data?.organization_id) throw new Error("Pro account was not created");
  return data;
}

export async function fetchWorkflowAdminOverview() {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<WorkflowAdminOverview | { is_admin: false }>("workflow-admin", {
    body: {
      action: "overview",
    },
  });

  if (error) throw error;
  if (!data?.is_admin) return null;
  return data as WorkflowAdminOverview;
}

export async function createWorkflowProAccount(input: WorkflowAdminCreateProInput) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<WorkflowAdminCreateProResponse>("workflow-admin", {
    body: {
      action: "create_pro_account",
      ...input,
    },
  });

  if (error) throw error;
  if (!data?.organization?.id) throw new Error("Pro account was not created");
  return data;
}

export async function registerWorkflowDevice(input: WorkflowAdminRegisterDeviceInput) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<WorkflowAdminRegisterDeviceResponse>("workflow-admin", {
    body: {
      action: "register_device",
      ...input,
    },
  });

  if (error) throw error;
  if (!data?.firmware?.device_id) throw new Error("Device was not registered");
  return data;
}

export async function assignWorkflowDeviceToOrganization(input: WorkflowAdminAssignDeviceInput) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<WorkflowAdminAssignDeviceResponse>("workflow-admin", {
    body: {
      action: "assign_device",
      ...input,
    },
  });

  if (error) throw error;
  if (!data?.device?.device_id) throw new Error("Device was not assigned");
  return data;
}

export async function updateWorkflowOrganizationStatus(organizationId: string, accountStatus: "active" | "suspended") {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<WorkflowAdminOrganizationActionResponse>("workflow-admin", {
    body: {
      action: "update_organization_status",
      organization_id: organizationId,
      account_status: accountStatus,
    },
  });

  if (error) throw error;
  if (!data?.organization?.id) throw new Error(data?.message || "Organization status was not updated");
  return data;
}

export async function deleteWorkflowOrganization(organizationId: string, confirmName: string) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<WorkflowAdminOrganizationActionResponse>("workflow-admin", {
    body: {
      action: "delete_organization",
      organization_id: organizationId,
      confirm_name: confirmName,
    },
  });

  if (error) throw error;
  if (!data?.organization_id) throw new Error(data?.message || "Organization was not deleted");
  return data;
}

export async function fetchWorkflowFirmwareTemplates() {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<WorkflowFirmwareTemplatesResponse>("workflow-admin", {
    body: {
      action: "get_firmware_templates",
    },
  });

  if (error) throw error;
  return data?.templates ?? [];
}

export async function saveWorkflowFirmwareTemplate(input: WorkflowFirmwareTemplateSaveInput) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<WorkflowFirmwareTemplateSaveResponse>("workflow-admin", {
    body: {
      action: "save_firmware_template",
      ...input,
    },
  });

  if (error) throw error;
  if (!data?.template) throw new Error("Firmware template was not saved");
  return data;
}

export async function recordWorkflowFirmwareDownload(input: WorkflowFirmwareDownloadInput) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<WorkflowFirmwareDownloadResponse>("workflow-admin", {
    body: {
      action: "record_firmware_download",
      ...input,
    },
  });

  if (error) throw error;
  if (!data?.download?.id) throw new Error("Firmware download was not recorded");
  return data;
}

export async function sendCommand(
  userId: string,
  commandType: DeviceCommandType,
  payload: Record<string, unknown> = {},
) {
  if (isDirectMqttConfigured()) {
    const command: DeviceCommand = {
      id: crypto.randomUUID(),
      command_type: commandType,
      payload,
      status: "pending",
      created_at: new Date().toISOString(),
      acknowledged_at: null,
      completed_at: null,
      error: null,
    };

    try {
      await publishDirectMqttCommand({
        id: command.id,
        command_type: commandType,
        payload,
        created_at: command.created_at,
      });

      if (supabase) {
        // MQTT is the real-time control path. Supabase only records a log here,
        // so do not block the button feel if the database is slow or restricted.
        void supabase.from("device_commands").insert({
          id: command.id,
          user_id: userId,
          device_id: deviceId,
          command_type: commandType,
          payload,
          status: "pending",
          created_at: command.created_at,
        }).then(({ error }) => {
          if (error) {
            console.warn("Direct MQTT command published, but Supabase command log failed", error);
          }
        });
      }

      return command;
    } catch (error) {
      console.warn("Direct MQTT command failed, falling back to Supabase function", error);
    }
  }

  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<{
    command: DeviceCommand;
    mqtt: "published" | "not_configured" | "failed";
  }>("send-device-command", {
    body: {
      device_id: deviceId,
      command_type: commandType,
      payload,
      user_id: userId,
    },
  });

  if (error) throw error;
  if (!data?.command) throw new Error("Command was not created");
  return data.command;
}

export async function sendCommandToDevice(
  userId: string,
  targetDeviceId: string,
  commandType: DeviceCommandType,
  payload: Record<string, unknown> = {},
) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<{
    command: DeviceCommand;
    mqtt: "published" | "not_configured" | "failed";
  }>("send-device-command", {
    body: {
      device_id: targetDeviceId,
      command_type: commandType,
      payload,
      user_id: userId,
    },
  });

  if (error) throw error;
  if (!data?.command) throw new Error("Command was not created");
  return data.command;
}

export async function fetchLatestCommand(commandId: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("device_commands")
    .select("id,command_type,payload,status,created_at,acknowledged_at,completed_at,error")
    .eq("id", commandId)
    .single<DeviceCommand>();

  if (error) throw error;
  return data;
}

export async function fetchSchedules() {
  const client = requireSupabase();
  const { data, error } = await client
    .from("device_schedules")
    .select("id,user_id,device_id,name,target,start_time,end_time,duration_minutes,days_of_week,enabled,updated_at")
    .eq("device_id", deviceId)
    .order("target", { ascending: true });

  if (error) throw error;
  return (data ?? []) as DeviceSchedule[];
}

export async function upsertSchedule(input: Omit<DeviceSchedule, "id" | "updated_at"> & { id?: string }) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("device_schedules")
    .upsert(input)
    .select("*")
    .single<DeviceSchedule>();

  if (error) throw error;
  return data;
}

export async function saveScheduleOverride(input: DeviceScheduleOverrideInput, overrideId?: string) {
  const client = requireSupabase();
  const payload = {
    user_id: input.user_id,
    device_id: input.device_id,
    name: input.name.trim() || "Reservation heat",
    override_type: "reservation_heat",
    start_date: input.start_date,
    end_date: input.end_date,
    start_time: `${input.start_time}:00`,
    end_time: `${input.end_time}:00`,
    pump_on: true,
    heater_enabled: true,
    setpoint: input.setpoint,
    suspend_regular_schedules: true,
    status: "scheduled",
  };

  const query = overrideId
    ? client.from("device_schedule_overrides").update(payload).eq("id", overrideId)
    : client.from("device_schedule_overrides").insert(payload);

  const { data, error } = await query.select(SCHEDULE_OVERRIDE_SELECT_COLUMNS).single<DeviceScheduleOverride>();

  if (error) throw error;
  return data;
}

export async function cancelScheduleOverride(overrideId: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("device_schedule_overrides")
    .update({ status: "cancelled" })
    .eq("id", overrideId)
    .select(SCHEDULE_OVERRIDE_SELECT_COLUMNS)
    .single<DeviceScheduleOverride>();

  if (error) throw error;
  return data;
}

export async function fetchAlerts() {
  const client = requireSupabase();
  const { data, error } = await client
    .from("device_alerts")
    .select("id,alert_type,alert_key,severity,message,acknowledged,created_at,resolved_at")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) throw error;
  return (data ?? []) as DeviceAlert[];
}

export async function acknowledgeAlert(alertId: string) {
  const client = requireSupabase();
  const { error } = await client.from("device_alerts").update({ acknowledged: true }).eq("id", alertId);
  if (error) throw error;
}

export async function updateElectricityRate(ratePerKwh: number) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("devices")
    .update({ electricity_rate_per_kwh: ratePerKwh })
    .eq("device_id", deviceId)
    .select("*")
    .single<PoolDevice>();

  if (error) throw error;
  return data;
}

export async function updateDeviceName(name: string) {
  const client = requireSupabase();
  const cleanName = name.trim() || "Pool Hub";
  const { data, error } = await client
    .from("devices")
    .update({ name: cleanName })
    .eq("device_id", deviceId)
    .select("*")
    .single<PoolDevice>();

  if (error) throw error;
  return data;
}

export async function updateDeviceProperty(targetDeviceId: string, input: DevicePropertyInput) {
  const client = requireSupabase();
  const cleanName = input.name.trim() || input.property_name.trim() || "Pool Hub";
  const cleanPropertyName = input.property_name.trim() || cleanName;

  const { data, error } = await client
    .from("devices")
    .update({
      name: cleanName,
      property_name: cleanPropertyName,
      address: input.address.trim() || null,
      city: input.city.trim() || null,
      state: input.state.trim() || null,
      zip: input.zip.trim() || null,
      property_notes: input.property_notes.trim() || null,
    })
    .eq("device_id", targetDeviceId)
    .select(PRO_DEVICE_SELECT_COLUMNS)
    .single<PoolDevice>();

  if (error) throw error;
  return data;
}

export async function updateOrganizationProfile(organizationId: string, input: OrganizationProfileInput) {
  const client = requireSupabase();
  const cleanName = input.name.trim() || "Workflow Pro Account";

  const { data, error } = await client
    .from("organizations")
    .update({
      name: cleanName,
      company_address: input.company_address.trim() || null,
      company_city: input.company_city.trim() || null,
      company_state: input.company_state.trim() || null,
      company_zip: input.company_zip.trim() || null,
      company_phone: input.company_phone.trim() || null,
      company_email: input.company_email.trim() || null,
      company_notes: input.company_notes.trim() || null,
    })
    .eq("id", organizationId)
    .select(ORGANIZATION_SELECT_COLUMNS)
    .single<Organization>();

  if (error) throw error;
  return data;
}

export async function uploadOrganizationLogo(organizationId: string, file: File) {
  const client = requireSupabase();

  if (!file.type.startsWith("image/")) {
    throw new Error("Logo must be an image file.");
  }

  if (file.size > 2 * 1024 * 1024) {
    throw new Error("Logo must be 2 MB or smaller.");
  }

  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${organizationId}/${Date.now()}.${extension}`;

  const { error: uploadError } = await client.storage
    .from("organization-logos")
    .upload(path, file, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data: publicUrlData } = client.storage.from("organization-logos").getPublicUrl(path);
  const logoUrl = publicUrlData.publicUrl;

  const { data, error } = await client
    .from("organizations")
    .update({ logo_url: logoUrl })
    .eq("id", organizationId)
    .select(ORGANIZATION_SELECT_COLUMNS)
    .single<Organization>();

  if (error) throw error;
  return data;
}

export async function inviteOrganizationMember(organizationId: string, email: string, role: OrganizationRole) {
  const client = requireSupabase();
  const cleanEmail = email.trim().toLowerCase();

  const { data, error } = await client
    .from("organization_invites")
    .insert({
      organization_id: organizationId,
      email: cleanEmail,
      role,
      status: "pending",
    })
    .select(ORGANIZATION_INVITE_SELECT_COLUMNS)
    .single<OrganizationInvite>();

  if (error) throw error;
  return data;
}

export async function removeOrganizationMember(organizationId: string, userId: string) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<TeamManagementResponse>("manage-team", {
    body: {
      action: "remove_member",
      organization_id: organizationId,
      user_id: userId,
    },
  });

  if (error) throw error;
  if (!data?.removed_user_id) throw new Error(data?.message || "Team member was not removed");
  return data;
}

export async function cancelOrganizationInvite(organizationId: string, inviteId: string) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<TeamManagementResponse>("manage-team", {
    body: {
      action: "cancel_invite",
      organization_id: organizationId,
      invite_id: inviteId,
    },
  });

  if (error) throw error;
  if (!data?.cancelled_invite_id) throw new Error(data?.message || "Invite was not cancelled");
  return data;
}

export async function claimDevice(serialNumber: string, claimCode = "", name = "Pool Hub") {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<ClaimedDeviceResponse>("claim-device", {
    body: {
      serial_number: serialNumber,
      claim_code: claimCode,
      name,
    },
  });

  if (error) throw error;
  if (!data?.device) throw new Error("Device was not claimed");
  return data.device;
}

export async function unclaimDevice(targetDeviceId = deviceId) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke<UnclaimedDeviceResponse>("unclaim-device", {
    body: {
      device_id: targetDeviceId,
    },
  });

  if (error) throw error;
  if (!data?.removed_device_id) throw new Error("Device was not removed");
  return data;
}

function numberOrNull(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export async function fetchHistory(
  period: HistoryPeriod,
  startIso: string,
  endIso: string,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("get_device_history_stats", {
    p_device_id: deviceId,
    p_period: period,
    p_start: startIso,
    p_end: endIso,
    p_timezone: timezone,
  });

  if (error) throw error;
  return (data ?? []).map((row: {
    bucket_start: string;
    current_temp: unknown;
    pump_watts: unknown;
    heater_watts: unknown;
    total_kwh: unknown;
    sample_count: number | null;
  }, index: number): DeviceHistory => ({
    id: `${row.bucket_start}-${index}`,
    device_id: deviceId,
    current_temp: numberOrNull(row.current_temp),
    pump_watts: numberOrNull(row.pump_watts),
    heater_watts: numberOrNull(row.heater_watts),
    total_kwh: numberOrNull(row.total_kwh),
    created_at: row.bucket_start,
    sample_count: row.sample_count ?? 0,
  }));
}
