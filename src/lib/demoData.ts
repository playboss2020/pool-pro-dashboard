import type {
  DeviceScheduleOverride,
  Organization,
  OrganizationInvite,
  OrganizationMember,
  PoolDevice,
} from "./deviceApi";

const demoUserId = "00000000-0000-4000-8000-000000000001";
const demoOrgId = "00000000-0000-4000-8000-000000000100";

function isoMinutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60000).toISOString();
}

function dateKey(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

function poolDevice(input: Partial<PoolDevice> & Pick<PoolDevice, "device_id" | "name" | "property_name">): PoolDevice {
  return {
    id: crypto.randomUUID(),
    user_id: demoUserId,
    organization_id: demoOrgId,
    device_id: input.device_id,
    serial_number: input.serial_number ?? input.device_id.toUpperCase().replace("POOL-", "WF-"),
    name: input.name,
    property_name: input.property_name,
    address: input.address ?? "3857 Mount Vernon Way",
    city: input.city ?? "Kissimmee",
    state: input.state ?? "FL",
    zip: input.zip ?? "34741",
    property_notes: input.property_notes ?? null,
    current_temp: input.current_temp ?? 84,
    pump_on: input.pump_on ?? false,
    heater_enabled: input.heater_enabled ?? false,
    heater_relay_on: input.heater_relay_on ?? false,
    setpoint: input.setpoint ?? 88,
    pump_watts: input.pump_watts ?? 0,
    heater_watts: input.heater_watts ?? 0,
    total_kwh: input.total_kwh ?? 0,
    electricity_rate_per_kwh: input.electricity_rate_per_kwh ?? 0.18,
    temp_calibration_offset: input.temp_calibration_offset ?? 0,
    wattage_calibration_scale: input.wattage_calibration_scale ?? 1,
    last_seen: input.last_seen ?? isoMinutesAgo(1),
    online_status: input.online_status ?? "online",
    firmware_version: input.firmware_version ?? "demo-1.0.0",
    wifi_ssid: input.wifi_ssid ?? "Workflow Guest WiFi",
    wifi_rssi: input.wifi_rssi ?? -58,
    lora_rssi: input.lora_rssi ?? -92,
    lora_snr: input.lora_snr ?? 7.5,
    node_online: input.node_online ?? true,
    node_last_seen: input.node_last_seen ?? isoMinutesAgo(1),
    updated_at: input.updated_at ?? isoMinutesAgo(1),
  };
}

export const demoOrganization: Organization = {
  id: demoOrgId,
  name: "Coastal Vacation Homes",
  plan: "pro",
  logo_url: null,
  company_address: "1200 Market Street",
  company_city: "Kissimmee",
  company_state: "FL",
  company_zip: "34741",
  company_phone: "(407) 555-0128",
  company_email: "owner@coastalvacationhomes.com",
  company_notes: null,
  created_at: isoMinutesAgo(60 * 24 * 30),
};

export const demoMembership: OrganizationMember = {
  organization_id: demoOrgId,
  user_id: demoUserId,
  role: "owner",
  display_name: "Demo Owner",
  email: "owner@coastalvacationhomes.com",
  created_at: isoMinutesAgo(60 * 24 * 30),
};

export const demoMembers: OrganizationMember[] = [
  demoMembership,
  {
    organization_id: demoOrgId,
    user_id: "00000000-0000-4000-8000-000000000002",
    role: "manager",
    display_name: "Office Manager",
    email: "manager@coastalvacationhomes.com",
    created_at: isoMinutesAgo(60 * 24 * 18),
  },
  {
    organization_id: demoOrgId,
    user_id: "00000000-0000-4000-8000-000000000003",
    role: "technician",
    display_name: "Pool Technician",
    email: "tech@coastalvacationhomes.com",
    created_at: isoMinutesAgo(60 * 24 * 9),
  },
];

export const demoInvites: OrganizationInvite[] = [
  {
    id: "00000000-0000-4000-8000-000000000201",
    organization_id: demoOrgId,
    email: "viewer@coastalvacationhomes.com",
    role: "viewer",
    status: "pending",
    invited_by: demoUserId,
    created_at: isoMinutesAgo(60 * 10),
    accepted_at: null,
    expires_at: null,
  },
];

export const demoDevices: PoolDevice[] = [
  poolDevice({
    device_id: "pool-demo-main",
    serial_number: "WF-POOL-DEMO-001",
    name: "Main Pool",
    property_name: "Main Pool",
    current_temp: 84,
    pump_on: true,
    heater_enabled: true,
    heater_relay_on: true,
    setpoint: 89,
    pump_watts: 1060,
    heater_watts: 4200,
    total_kwh: 182.4,
    address: "3857 Mount Vernon Way",
  }),
  poolDevice({
    device_id: "pool-demo-lake",
    serial_number: "WF-POOL-DEMO-002",
    name: "Lake House",
    property_name: "Lake House",
    current_temp: 82,
    pump_on: true,
    heater_enabled: false,
    setpoint: 87,
    pump_watts: 980,
    total_kwh: 136.9,
    address: "742 Lakeshore Drive",
    city: "Davenport",
    wifi_rssi: -63,
  }),
  poolDevice({
    device_id: "pool-demo-blue",
    serial_number: "WF-POOL-DEMO-003",
    name: "Blue Villa",
    property_name: "Blue Villa",
    current_temp: 79,
    pump_on: false,
    heater_enabled: false,
    setpoint: 86,
    total_kwh: 91.2,
    address: "221 Palm View Court",
    city: "Kissimmee",
  }),
  poolDevice({
    device_id: "pool-demo-sunset",
    serial_number: "WF-POOL-DEMO-004",
    name: "Sunset Retreat",
    property_name: "Sunset Retreat",
    current_temp: 77,
    pump_on: true,
    heater_enabled: false,
    setpoint: 88,
    pump_watts: 0,
    total_kwh: 164.1,
    address: "8803 Sunset Ridge Lane",
    city: "Four Corners",
    wifi_rssi: -79,
  }),
  poolDevice({
    device_id: "pool-demo-offline",
    serial_number: "WF-POOL-DEMO-005",
    name: "Garden Home",
    property_name: "Garden Home",
    current_temp: 81,
    pump_on: false,
    heater_enabled: false,
    setpoint: 86,
    total_kwh: 74.5,
    address: "451 Gardenia Avenue",
    city: "Kissimmee",
    online_status: "offline",
    node_online: false,
    last_seen: isoMinutesAgo(45),
    node_last_seen: isoMinutesAgo(52),
  }),
];

export const demoScheduleOverrides: DeviceScheduleOverride[] = [
  {
    id: "00000000-0000-4000-8000-000000000301",
    user_id: demoUserId,
    device_id: "pool-demo-main",
    name: "Weekend guest arrival",
    override_type: "reservation_heat",
    start_date: dateKey(0),
    end_date: dateKey(2),
    start_time: "08:00:00",
    end_time: "22:00:00",
    pump_on: true,
    heater_enabled: true,
    setpoint: 89,
    suspend_regular_schedules: true,
    status: "active",
    created_at: isoMinutesAgo(60 * 24),
    updated_at: isoMinutesAgo(45),
  },
  {
    id: "00000000-0000-4000-8000-000000000302",
    user_id: demoUserId,
    device_id: "pool-demo-lake",
    name: "Spring reservation",
    override_type: "reservation_heat",
    start_date: dateKey(4),
    end_date: dateKey(6),
    start_time: "09:00:00",
    end_time: "21:30:00",
    pump_on: true,
    heater_enabled: true,
    setpoint: 88,
    suspend_regular_schedules: true,
    status: "scheduled",
    created_at: isoMinutesAgo(60 * 8),
    updated_at: isoMinutesAgo(60 * 8),
  },
];

export const demoHomeDevice = demoDevices[0];
