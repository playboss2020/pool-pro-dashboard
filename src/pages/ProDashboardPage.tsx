import {
  AlertTriangle,
  Building2,
  CalendarRange,
  Edit3,
  Flame,
  Gauge,
  Map as MapIcon,
  MapPin,
  Radio,
  Search,
  Settings,
  ShieldCheck,
  Thermometer,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  cancelScheduleOverride,
  cancelOrganizationInvite,
  inviteOrganizationMember,
  removeOrganizationMember,
  saveScheduleOverride,
  sendCommandToDevice,
  updateDeviceProperty,
  updateOrganizationProfile,
  uploadOrganizationLogo,
  type DevicePropertyInput,
  type DeviceScheduleOverride,
  type DeviceScheduleOverrideInput,
  type Organization,
  type OrganizationInvite,
  type OrganizationMember,
  type OrganizationProfileInput,
  type OrganizationRole,
  type PoolDevice,
} from "../lib/deviceApi";
import { GoogleFleetMap } from "../components/GoogleFleetMap";

type ProDashboardPageProps = {
  organization: Organization;
  membership: OrganizationMember;
  devices: PoolDevice[];
  members: OrganizationMember[];
  invites: OrganizationInvite[];
  scheduleOverrides: DeviceScheduleOverride[];
  onOpenDevice: (deviceId: string) => void;
  onPropertyUpdated: (device: PoolDevice) => void;
  onOrganizationUpdated: (organization: Organization) => void;
  onInviteCreated: (invite: OrganizationInvite) => void;
  onMemberRemoved: (userId: string) => void;
  onInviteCancelled: (inviteId: string) => void;
  onScheduleOverrideSaved: (override: DeviceScheduleOverride) => void;
  onScheduleOverrideCancelled: (overrideId: string) => void;
  onSignOut: () => void;
  demoMode?: boolean;
};

type ProSection = "fleet" | "map" | "reservations" | "alerts" | "energy" | "team" | "settings";
type FleetMapStatus = "online" | "warning" | "offline";
type ReservationForm = Pick<DeviceScheduleOverrideInput, "name" | "start_date" | "end_date" | "start_time" | "end_time" | "setpoint">;
type ReservationView = "month" | "list";
type ReservationDisplayStatus = "scheduled" | "active" | "completed";
type TeamActionTarget =
  | { kind: "member"; userId: string; label: string; role: string }
  | { kind: "invite"; inviteId: string; label: string; role: string };

const roleOptions: { value: OrganizationRole; label: string; detail: string }[] = [
  { value: "owner", label: "Owner", detail: "Full access to company settings, billing, team, devices, and deletion." },
  { value: "manager", label: "Manager", detail: "Daily fleet management, schedules, alerts, and property details without deletion." },
  { value: "technician", label: "Technician", detail: "Service access for dashboards, alerts, diagnostics, and controls." },
  { value: "viewer", label: "Viewer", detail: "Read-only visibility for owners, office staff, or partners." },
];

function wasSeenRecently(lastSeen: string | null | undefined) {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 120000;
}

function formatTemp(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value)}°F` : "--";
}

function formatMoney(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "--";
  return `$${value.toFixed(2)}`;
}

function dateInputValue(date = new Date()) {
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

function localDateFromInput(value: string) {
  return new Date(`${value}T12:00:00`);
}

function formatDateLabel(value: string) {
  const date = localDateFromInput(value);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function formatDateLong(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(localDateFromInput(value));
}

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1, 12, 0, 0, 0);
}

function calendarDaysForMonth(date: Date) {
  const start = monthStart(date);
  const firstVisible = new Date(start);
  firstVisible.setDate(start.getDate() - start.getDay());

  return Array.from({ length: 42 }, (_item, index) => {
    const day = new Date(firstVisible);
    day.setDate(firstVisible.getDate() + index);
    return day;
  });
}

function formatTimeLabel(value: string | null | undefined) {
  if (!value) return "--";
  const [hourRaw, minuteRaw] = value.split(":");
  const hour24 = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour24) || !Number.isFinite(minute)) return "--";
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function formatRole(role: string) {
  return roleOptions.find((option) => option.value === role)?.label ?? role;
}

function propertyTitle(device: PoolDevice) {
  return device.property_name?.trim() || device.name || device.device_id;
}

function propertyAddress(device: PoolDevice) {
  const line = [device.address, device.city, device.state].filter(Boolean).join(", ");
  return line || "Address not set";
}

function estimatedMonthlyCost(device: PoolDevice) {
  if (typeof device.total_kwh !== "number") return null;
  const rate = typeof device.electricity_rate_per_kwh === "number" ? device.electricity_rate_per_kwh : 0.18;
  return device.total_kwh * rate;
}

function formatHeatEta(device: PoolDevice) {
  if (!device.heater_enabled) return null;
  if (typeof device.current_temp !== "number" || typeof device.setpoint !== "number") return "--";

  const difference = Math.max(0, device.setpoint - device.current_temp);
  if (difference <= 0) return "Holding";

  const totalMinutes = Math.round(difference * 18);
  if (totalMinutes < 60) return `~${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `~${hours}h` : `~${hours}h ${minutes}m`;
}

function propertyFormFromDevice(device: PoolDevice): DevicePropertyInput {
  return {
    name: device.name ?? "",
    property_name: device.property_name ?? device.name ?? "",
    address: device.address ?? "",
    city: device.city ?? "",
    state: device.state ?? "",
    zip: device.zip ?? "",
    property_notes: device.property_notes ?? "",
  };
}

function organizationFormFromProfile(organization: Organization): OrganizationProfileInput {
  return {
    name: organization.name ?? "",
    company_address: organization.company_address ?? "",
    company_city: organization.company_city ?? "",
    company_state: organization.company_state ?? "",
    company_zip: organization.company_zip ?? "",
    company_phone: organization.company_phone ?? "",
    company_email: organization.company_email ?? "",
    company_notes: organization.company_notes ?? "",
  };
}

function companyAddress(organization: Organization) {
  const line = [organization.company_address, organization.company_city, organization.company_state, organization.company_zip]
    .filter(Boolean)
    .join(", ");
  return line || "Company address not set";
}

function issueListForDevice(device: PoolDevice) {
  const online = device.online_status === "online" && wasSeenRecently(device.last_seen);
  const issues: { severity: "critical" | "warning"; title: string; message: string }[] = [];

  if (!online) {
    issues.push({
      severity: "critical",
      title: "Hub offline",
      message: "The cloud has not seen this hub recently.",
    });
  }

  if (device.node_online === false) {
    issues.push({
      severity: "critical",
      title: "Node lost",
      message: "The hub is not hearing the LoRa node.",
    });
  }

  if (typeof device.wifi_rssi === "number" && device.wifi_rssi < -75) {
    issues.push({
      severity: "warning",
      title: "Weak WiFi",
      message: `Signal is ${device.wifi_rssi} dBm.`,
    });
  }

  if (device.pump_on && typeof device.pump_watts === "number" && device.pump_watts <= 5) {
    issues.push({
      severity: "warning",
      title: "Pump has no watts",
      message: "Pump is commanded on, but power draw is near zero.",
    });
  }

  if (device.heater_enabled && typeof device.heater_watts === "number" && device.heater_watts <= 5) {
    issues.push({
      severity: "warning",
      title: "Heater has no watts",
      message: "Heater is enabled, but power draw is near zero.",
    });
  }

  return issues;
}

function fleetStatusForDevice(device: PoolDevice): { kind: FleetMapStatus; label: string } {
  const online = device.online_status === "online" && wasSeenRecently(device.last_seen);
  const issues = issueListForDevice(device);

  if (!online || device.node_online === false) return { kind: "offline", label: "Offline" };
  if (issues.length > 0) return { kind: "warning", label: "Warning" };
  return { kind: "online", label: "Online" };
}

function seededMapPoint(device: PoolDevice, index: number) {
  const seedText = `${device.device_id}-${propertyTitle(device)}-${propertyAddress(device)}`;
  let hash = 0;
  for (let i = 0; i < seedText.length; i += 1) {
    hash = (hash * 31 + seedText.charCodeAt(i)) >>> 0;
  }

  const column = index % 4;
  const row = Math.floor(index / 4) % 4;
  const jitterX = hash % 13;
  const jitterY = (hash >> 4) % 13;

  return {
    x: Math.min(88, Math.max(10, 15 + column * 22 + jitterX)),
    y: Math.min(86, Math.max(12, 18 + row * 18 + jitterY)),
  };
}

function memberName(member: OrganizationMember) {
  return member.display_name?.trim() || member.email?.trim() || member.user_id.slice(0, 8);
}

function reservationFormFromDevice(device: PoolDevice): ReservationForm {
  const today = dateInputValue();
  return {
    name: "Reservation heat",
    start_date: today,
    end_date: today,
    start_time: "08:00",
    end_time: "22:00",
    setpoint: typeof device.setpoint === "number" ? device.setpoint : 88,
  };
}

function reservationFormFromOverride(override: DeviceScheduleOverride, device: PoolDevice): ReservationForm {
  return {
    name: override.name ?? "Reservation heat",
    start_date: override.start_date,
    end_date: override.end_date,
    start_time: override.start_time?.slice(0, 5) ?? "08:00",
    end_time: override.end_time?.slice(0, 5) ?? "22:00",
    setpoint: typeof override.setpoint === "number" ? override.setpoint : (typeof device.setpoint === "number" ? device.setpoint : 88),
  };
}

function upcomingOverrideForDevice(overrides: DeviceScheduleOverride[], deviceId: string) {
  const today = dateInputValue();
  return overrides
    .filter((override) => override.device_id === deviceId && override.status !== "cancelled" && override.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0] ?? null;
}

function overrideDisplayStatus(override: DeviceScheduleOverride): ReservationDisplayStatus {
  if (override.status === "active" || override.status === "completed") return override.status;

  const today = dateInputValue();
  if (override.end_date < today) return "completed";
  if (override.start_date <= today && override.end_date >= today) return "active";
  return "scheduled";
}

function overrideRunsOnDate(override: DeviceScheduleOverride, date: Date) {
  const key = dateInputValue(date);
  return override.start_date <= key && override.end_date >= key;
}

export function ProDashboardPage({
  organization,
  membership,
  devices,
  members,
  invites,
  scheduleOverrides,
  onOpenDevice,
  onPropertyUpdated,
  onOrganizationUpdated,
  onInviteCreated,
  onMemberRemoved,
  onInviteCancelled,
  onScheduleOverrideSaved,
  onScheduleOverrideCancelled,
  onSignOut,
  demoMode = false,
}: ProDashboardPageProps) {
  const [activeSection, setActiveSection] = useState<ProSection>("fleet");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "alerts" | "offline" | "heating" | "scheduled">("all");
  const [reservationView, setReservationView] = useState<ReservationView>("month");
  const [reservationCalendarDate, setReservationCalendarDate] = useState(() => monthStart(new Date()));
  const [reservationStatusFilter, setReservationStatusFilter] = useState<"all" | ReservationDisplayStatus>("all");
  const [editingDevice, setEditingDevice] = useState<PoolDevice | null>(null);
  const [propertyForm, setPropertyForm] = useState<DevicePropertyInput | null>(null);
  const [savingProperty, setSavingProperty] = useState(false);
  const [propertyError, setPropertyError] = useState("");
  const [reservationDevice, setReservationDevice] = useState<PoolDevice | null>(null);
  const [reservationDeviceIds, setReservationDeviceIds] = useState<string[]>([]);
  const [editingReservationOverride, setEditingReservationOverride] = useState<DeviceScheduleOverride | null>(null);
  const [reservationForm, setReservationForm] = useState<ReservationForm | null>(null);
  const [showReservationProperties, setShowReservationProperties] = useState(false);
  const [reservationPropertyQuery, setReservationPropertyQuery] = useState("");
  const [savingReservation, setSavingReservation] = useState(false);
  const [reservationError, setReservationError] = useState("");
  const [reservationSuccess, setReservationSuccess] = useState("");
  const [organizationForm, setOrganizationForm] = useState<OrganizationProfileInput>(() =>
    organizationFormFromProfile(organization),
  );
  const [savingOrganization, setSavingOrganization] = useState(false);
  const [organizationError, setOrganizationError] = useState("");
  const [organizationSuccess, setOrganizationSuccess] = useState("");
  const [editingOrganization, setEditingOrganization] = useState(false);
  const [organizationLogoFile, setOrganizationLogoFile] = useState<File | null>(null);
  const [organizationLogoPreview, setOrganizationLogoPreview] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrganizationRole>("manager");
  const [savingInvite, setSavingInvite] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [teamActionTarget, setTeamActionTarget] = useState<TeamActionTarget | null>(null);
  const [teamActionBusy, setTeamActionBusy] = useState(false);
  const [teamActionError, setTeamActionError] = useState("");
  const canManageTeam = membership.role === "owner";

  useEffect(() => {
    setOrganizationForm(organizationFormFromProfile(organization));
  }, [organization]);

  useEffect(() => () => {
    if (organizationLogoPreview) {
      URL.revokeObjectURL(organizationLogoPreview);
    }
  }, [organizationLogoPreview]);

  useEffect(() => {
    if (!canManageTeam && activeSection === "team") {
      setActiveSection("fleet");
    }
  }, [activeSection, canManageTeam]);

  const fleetStats = useMemo(() => {
    const onlineCount = devices.filter((device) => device.online_status === "online" && wasSeenRecently(device.last_seen)).length;
    const nodeLostCount = devices.filter((device) => device.node_online === false).length;
    const heatingCount = devices.filter((device) => device.heater_enabled).length;
    const attentionDeviceCount = devices.filter((device) => issueListForDevice(device).length > 0).length;
    const totalCost = devices.reduce((sum, device) => sum + (estimatedMonthlyCost(device) ?? 0), 0);

    return {
      onlineCount,
      offlineCount: Math.max(0, devices.length - onlineCount),
      nodeLostCount,
      heatingCount,
      attentionDeviceCount,
      scheduledHeatCount: devices.filter((device) => upcomingOverrideForDevice(scheduleOverrides, device.device_id)).length,
      totalCost,
    };
  }, [devices, scheduleOverrides]);

  const energyStats = useMemo(() => {
    const costRows = devices
      .map((device) => ({
        device,
        cost: estimatedMonthlyCost(device),
      }))
      .filter((row): row is { device: PoolDevice; cost: number } => row.cost !== null && Number.isFinite(row.cost));

    const highestCostPool = [...costRows].sort((a, b) => b.cost - a.cost)[0] ?? null;
    const cheapestPool = [...costRows].sort((a, b) => a.cost - b.cost)[0] ?? null;
    const totalKwh = devices.reduce((sum, device) => sum + (typeof device.total_kwh === "number" ? device.total_kwh : 0), 0);

    return {
      estimatedMonthlyCost: costRows.reduce((sum, row) => sum + row.cost, 0),
      highestCostPool,
      cheapestPool,
      totalKwh,
    };
  }, [devices]);

  const fleetIssues = useMemo(() =>
    devices.flatMap((device) =>
      issueListForDevice(device).map((issue) => ({
        ...issue,
        device,
      })),
    ), [devices]);

  const filteredDevices = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    return devices.filter((device) => {
      const online = device.online_status === "online" && wasSeenRecently(device.last_seen);
      const hasAlert = device.node_online === false || !online;
      const searchable = [
        propertyTitle(device),
        propertyAddress(device),
        device.device_id,
        device.serial_number ?? "",
      ].join(" ").toLowerCase();

      if (cleanQuery && !searchable.includes(cleanQuery)) return false;
      if (filter === "alerts") return hasAlert;
      if (filter === "offline") return !online;
      if (filter === "heating") return device.heater_enabled;
      if (filter === "scheduled") return Boolean(upcomingOverrideForDevice(scheduleOverrides, device.device_id));
      return true;
    });
  }, [devices, filter, query, scheduleOverrides]);

  const reservationRows = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();

    return scheduleOverrides
      .map((override) => {
        const device = devices.find((item) => item.device_id === override.device_id) ?? null;
        const status = overrideDisplayStatus(override);
        return { override, device, status };
      })
      .filter(({ override, device, status }) => {
        if (override.status === "cancelled") return false;
        if (reservationStatusFilter !== "all" && status !== reservationStatusFilter) return false;
        if (!cleanQuery) return true;

        const searchable = [
          override.name ?? "",
          device ? propertyTitle(device) : "",
          device ? propertyAddress(device) : "",
          override.device_id,
          device?.serial_number ?? "",
        ].join(" ").toLowerCase();

        return searchable.includes(cleanQuery);
      })
      .sort((a, b) => {
        const dateSort = a.override.start_date.localeCompare(b.override.start_date);
        if (dateSort !== 0) return dateSort;
        return (a.override.start_time ?? "").localeCompare(b.override.start_time ?? "");
      });
  }, [devices, query, reservationStatusFilter, scheduleOverrides]);

  const reservationStats = useMemo(() => {
    const activeCount = reservationRows.filter((row) => row.status === "active").length;
    const scheduledCount = reservationRows.filter((row) => row.status === "scheduled").length;
    const today = localDateFromInput(dateInputValue());
    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(today.getDate() + 7);
    const nextSevenCount = reservationRows.filter((row) => {
      const start = localDateFromInput(row.override.start_date);
      return start >= today && start <= sevenDaysFromNow;
    }).length;
    const propertyCount = new Set(reservationRows.map((row) => row.override.device_id)).size;

    return { activeCount, scheduledCount, nextSevenCount, propertyCount };
  }, [reservationRows]);

  const reservationCalendarDays = useMemo(() => calendarDaysForMonth(reservationCalendarDate), [reservationCalendarDate]);

  const mapPins = useMemo(() =>
    filteredDevices.map((device, index) => ({
      device,
      point: seededMapPoint(device, index),
      status: fleetStatusForDevice(device),
    })),
  [filteredDevices]);

  const roleCounts = useMemo(() => {
    const counts: Record<OrganizationRole, number> = {
      owner: 0,
      manager: 0,
      technician: 0,
      viewer: 0,
    };

    members.forEach((member) => {
      if (member.role in counts) {
        counts[member.role as OrganizationRole] += 1;
      }
    });

    return counts;
  }, [members]);

  const ownerCount = roleCounts.owner;

  const nextOverridesByDevice = useMemo(() => {
    const result = new Map<string, DeviceScheduleOverride>();
    devices.forEach((device) => {
      const override = upcomingOverrideForDevice(scheduleOverrides, device.device_id);
      if (override) result.set(device.device_id, override);
    });
    return result;
  }, [devices, scheduleOverrides]);

  const selectedReservationDevices = useMemo(() =>
    reservationDeviceIds
      .map((deviceId) => devices.find((device) => device.device_id === deviceId))
      .filter((device): device is PoolDevice => Boolean(device)),
  [devices, reservationDeviceIds]);

  const filteredReservationPropertyDevices = useMemo(() => {
    const cleanQuery = reservationPropertyQuery.trim().toLowerCase();
    if (!cleanQuery) return devices;

    return devices.filter((device) => {
      const searchable = [
        propertyTitle(device),
        propertyAddress(device),
        device.device_id,
        device.serial_number ?? "",
      ].join(" ").toLowerCase();
      return searchable.includes(cleanQuery);
    });
  }, [devices, reservationPropertyQuery]);

  function openPropertyEditor(device: PoolDevice) {
    setEditingDevice(device);
    setPropertyForm(propertyFormFromDevice(device));
    setPropertyError("");
  }

  function updatePropertyForm(key: keyof DevicePropertyInput, value: string) {
    setPropertyForm((current) => current ? { ...current, [key]: value } : current);
  }

  function openReservationEditor(device: PoolDevice) {
    const existingOverride = nextOverridesByDevice.get(device.device_id) ?? null;
    setReservationDevice(device);
    setReservationDeviceIds([device.device_id]);
    setEditingReservationOverride(existingOverride);
    setReservationForm(existingOverride ? reservationFormFromOverride(existingOverride, device) : reservationFormFromDevice(device));
    setShowReservationProperties(false);
    setReservationPropertyQuery("");
    setReservationError("");
    setReservationSuccess("");
  }

  function openReservationOverrideEditor(override: DeviceScheduleOverride, device: PoolDevice | null) {
    const targetDevice = device ?? devices.find((item) => item.device_id === override.device_id);
    if (!targetDevice) return;

    setReservationDevice(targetDevice);
    setReservationDeviceIds([targetDevice.device_id]);
    setEditingReservationOverride(override);
    setReservationForm(reservationFormFromOverride(override, targetDevice));
    setShowReservationProperties(false);
    setReservationPropertyQuery("");
    setReservationError("");
    setReservationSuccess("");
  }

  function closeReservationEditor() {
    setReservationDevice(null);
    setReservationDeviceIds([]);
    setEditingReservationOverride(null);
    setReservationForm(null);
    setShowReservationProperties(false);
    setReservationPropertyQuery("");
    setReservationError("");
    setReservationSuccess("");
  }

  function updateReservationForm<K extends keyof ReservationForm>(key: K, value: ReservationForm[K]) {
    setReservationForm((current) => current ? { ...current, [key]: value } : current);
    setReservationError("");
    setReservationSuccess("");
  }

  function toggleReservationDevice(deviceId: string) {
    if (reservationDevice?.device_id === deviceId) return;
    setReservationDeviceIds((current) =>
      current.includes(deviceId)
        ? current.filter((selectedId) => selectedId !== deviceId)
        : [...current, deviceId],
    );
    setReservationError("");
    setReservationSuccess("");
  }

  async function saveProperty() {
    if (!editingDevice || !propertyForm) return;

    setSavingProperty(true);
    setPropertyError("");

    try {
      if (demoMode) {
        const cleanName = propertyForm.name.trim() || propertyForm.property_name.trim() || "Pool Hub";
        const updatedDevice: PoolDevice = {
          ...editingDevice,
          name: cleanName,
          property_name: propertyForm.property_name.trim() || cleanName,
          address: propertyForm.address.trim() || null,
          city: propertyForm.city.trim() || null,
          state: propertyForm.state.trim() || null,
          zip: propertyForm.zip.trim() || null,
          property_notes: propertyForm.property_notes.trim() || null,
          updated_at: new Date().toISOString(),
        };
        onPropertyUpdated(updatedDevice);
        setEditingDevice(null);
        setPropertyForm(null);
        return;
      }

      const saved = await updateDeviceProperty(editingDevice.device_id, propertyForm);
      onPropertyUpdated(saved);
      setEditingDevice(null);
      setPropertyForm(null);
    } catch (err) {
      setPropertyError(err instanceof Error ? err.message : "Unable to save property");
    } finally {
      setSavingProperty(false);
    }
  }

  async function saveReservation() {
    if (!reservationDevice || !reservationForm) return;

    setSavingReservation(true);
    setReservationError("");
    setReservationSuccess("");

    if (reservationForm.end_date < reservationForm.start_date) {
      setReservationError("End date must be after the start date.");
      setSavingReservation(false);
      return;
    }

    if (!reservationForm.start_time || !reservationForm.end_time) {
      setReservationError("Start and end times are required.");
      setSavingReservation(false);
      return;
    }

    if (selectedReservationDevices.length === 0) {
      setReservationError("Select at least one property.");
      setSavingReservation(false);
      return;
    }

    try {
      const savedOverrides: DeviceScheduleOverride[] = [];

      for (const targetDevice of selectedReservationDevices) {
        const existingOverride = targetDevice.device_id === reservationDevice.device_id
          ? editingReservationOverride
          : nextOverridesByDevice.get(targetDevice.device_id) ?? null;

        if (demoMode) {
          const now = new Date().toISOString();
          const saved: DeviceScheduleOverride = {
            id: existingOverride?.id ?? crypto.randomUUID(),
            user_id: membership.user_id,
            device_id: targetDevice.device_id,
            name: reservationForm.name.trim() || "Reservation heat",
            override_type: "reservation_heat",
            start_date: reservationForm.start_date,
            end_date: reservationForm.end_date,
            start_time: `${reservationForm.start_time}:00`,
            end_time: `${reservationForm.end_time}:00`,
            pump_on: true,
            heater_enabled: true,
            setpoint: reservationForm.setpoint,
            suspend_regular_schedules: true,
            status: "scheduled",
            created_at: existingOverride?.created_at ?? now,
            updated_at: now,
          };
          savedOverrides.push(saved);
          onScheduleOverrideSaved(saved);
          continue;
        }

        const saved = await saveScheduleOverride({
          user_id: membership.user_id,
          device_id: targetDevice.device_id,
          name: reservationForm.name,
          start_date: reservationForm.start_date,
          end_date: reservationForm.end_date,
          start_time: reservationForm.start_time,
          end_time: reservationForm.end_time,
          setpoint: reservationForm.setpoint,
        }, existingOverride?.id);

        savedOverrides.push(saved);
        onScheduleOverrideSaved(saved);
      }

      if (!demoMode) {
        for (const saved of savedOverrides) {
          await sendCommandToDevice(membership.user_id, saved.device_id, "sync_schedules", {
            reason: "reservation_heat_override",
            override_id: saved.id,
          });
        }
      }

      const propertyLabel = savedOverrides.length === 1 ? "property" : "properties";
      setReservationSuccess(demoMode
        ? `Demo reservation heat saved for ${savedOverrides.length} ${propertyLabel}.`
        : `Reservation heat saved for ${savedOverrides.length} ${propertyLabel} and schedule sync requested.`);
      window.setTimeout(() => {
        closeReservationEditor();
      }, 900);
    } catch (err) {
      setReservationError(err instanceof Error ? err.message : "Unable to save reservation heat");
    } finally {
      setSavingReservation(false);
    }
  }

  async function cancelReservation() {
    if (!reservationDevice || !editingReservationOverride) return;

    setSavingReservation(true);
    setReservationError("");
    setReservationSuccess("");

    try {
      const overridesToCancel = selectedReservationDevices
        .map((device) => device.device_id === reservationDevice.device_id
          ? editingReservationOverride
          : nextOverridesByDevice.get(device.device_id) ?? null)
        .filter((override): override is DeviceScheduleOverride => Boolean(override));

      for (const override of overridesToCancel) {
        if (demoMode) {
          onScheduleOverrideCancelled(override.id);
          continue;
        }

        const cancelled = await cancelScheduleOverride(override.id);
        onScheduleOverrideCancelled(cancelled.id);
        await sendCommandToDevice(membership.user_id, override.device_id, "sync_schedules", {
          reason: "reservation_heat_cancelled",
          override_id: cancelled.id,
        });
      }

      const propertyLabel = overridesToCancel.length === 1 ? "property" : "properties";
      setReservationSuccess(demoMode
        ? `Demo heat dates cancelled for ${overridesToCancel.length} ${propertyLabel}.`
        : `Heat dates cancelled for ${overridesToCancel.length} ${propertyLabel} and schedule sync requested.`);
      window.setTimeout(() => {
        closeReservationEditor();
      }, 900);
    } catch (err) {
      setReservationError(err instanceof Error ? err.message : "Unable to cancel heat dates");
    } finally {
      setSavingReservation(false);
    }
  }

  function updateOrganizationForm(key: keyof OrganizationProfileInput, value: string) {
    setOrganizationForm((current) => ({ ...current, [key]: value }));
    setOrganizationSuccess("");
    setOrganizationError("");
  }

  function updateOrganizationLogo(file: File | null) {
    setOrganizationLogoFile(file);
    setOrganizationLogoPreview(file ? URL.createObjectURL(file) : "");
    setOrganizationSuccess("");
    setOrganizationError("");
  }

  function resetOrganizationEdit() {
    setOrganizationForm(organizationFormFromProfile(organization));
    setOrganizationLogoFile(null);
    setOrganizationLogoPreview("");
    setEditingOrganization(false);
    setOrganizationError("");
    setOrganizationSuccess("");
  }

  async function saveOrganization() {
    if (!editingOrganization) {
      setEditingOrganization(true);
      setOrganizationSuccess("");
      setOrganizationError("");
      return;
    }

    setSavingOrganization(true);
    setOrganizationError("");
    setOrganizationSuccess("");

    try {
      if (demoMode) {
        const saved: Organization = {
          ...organization,
          ...organizationForm,
          name: organizationForm.name.trim() || organization.name,
          logo_url: organizationLogoPreview || organization.logo_url,
        };
        onOrganizationUpdated(saved);
        setOrganizationLogoFile(null);
        setOrganizationLogoPreview("");
        setEditingOrganization(false);
        setOrganizationSuccess("Demo company settings saved.");
        return;
      }

      let saved = await updateOrganizationProfile(organization.id, organizationForm);
      if (organizationLogoFile) {
        saved = await uploadOrganizationLogo(organization.id, organizationLogoFile);
      }
      onOrganizationUpdated(saved);
      setOrganizationLogoFile(null);
      setOrganizationLogoPreview("");
      setEditingOrganization(false);
      setOrganizationSuccess("Company settings saved.");
    } catch (err) {
      setOrganizationError(err instanceof Error ? err.message : "Unable to save company settings");
    } finally {
      setSavingOrganization(false);
    }
  }

  async function sendInvite() {
    const cleanEmail = inviteEmail.trim().toLowerCase();
    if (!cleanEmail) {
      setInviteError("Enter an email address.");
      return;
    }

    setSavingInvite(true);
    setInviteError("");
    setInviteSuccess("");

    try {
      if (demoMode) {
        onInviteCreated({
          id: crypto.randomUUID(),
          organization_id: organization.id,
          email: cleanEmail,
          role: inviteRole,
          status: "pending",
          invited_by: membership.user_id,
          created_at: new Date().toISOString(),
          accepted_at: null,
          expires_at: null,
        });
        setInviteEmail("");
        setInviteRole("manager");
        setInviteSuccess(`Demo invite saved for ${cleanEmail}.`);
        return;
      }

      const invite = await inviteOrganizationMember(organization.id, cleanEmail, inviteRole);
      onInviteCreated(invite);
      setInviteEmail("");
      setInviteRole("manager");
      setInviteSuccess(`Invite saved for ${cleanEmail}.`);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Unable to create invite");
    } finally {
      setSavingInvite(false);
    }
  }

  async function confirmTeamAction() {
    if (!teamActionTarget) return;

    setTeamActionBusy(true);
    setTeamActionError("");

    try {
      if (demoMode) {
        if (teamActionTarget.kind === "member") {
          onMemberRemoved(teamActionTarget.userId);
        } else {
          onInviteCancelled(teamActionTarget.inviteId);
        }
        setTeamActionTarget(null);
        return;
      }

      if (teamActionTarget.kind === "member") {
        const result = await removeOrganizationMember(organization.id, teamActionTarget.userId);
        onMemberRemoved(result.removed_user_id ?? teamActionTarget.userId);
      } else {
        const result = await cancelOrganizationInvite(organization.id, teamActionTarget.inviteId);
        onInviteCancelled(result.cancelled_invite_id ?? teamActionTarget.inviteId);
      }

      setTeamActionTarget(null);
    } catch (err) {
      setTeamActionError(err instanceof Error ? err.message : "Unable to update team");
    } finally {
      setTeamActionBusy(false);
    }
  }

  const sectionTitle = activeSection === "fleet"
    ? "Fleet Overview"
    : activeSection === "map"
      ? "Fleet Map"
      : activeSection === "reservations"
        ? "Heat Reservations"
        : activeSection === "alerts"
          ? "Fleet Alerts"
          : activeSection === "energy"
            ? "Energy Overview"
            : activeSection === "team"
              ? "Team Members"
              : "Company Settings";

  const sectionCopy = activeSection === "fleet"
    ? "Monitor every pool controller, find properties quickly, and open the full dashboard for each location."
    : activeSection === "map"
      ? "See every managed property in one place, with status colors for healthy, warning, and offline hubs."
      : activeSection === "reservations"
        ? "See every reservation heat schedule across the company and open any reservation to edit it."
        : activeSection === "alerts"
          ? "See which properties need attention before a guest or owner calls."
          : activeSection === "energy"
            ? "Compare energy use and estimated cost across every managed pool."
            : activeSection === "team"
              ? "Invite staff and assign the access level they should have across this Pro account."
              : "Manage the company profile that appears on this Pro dashboard.";

  const displayedOrganizationLogo = organizationLogoPreview || organization.logo_url || "";

  return (
    <div className="pro-app-shell">
      {demoMode ? (
        <div className="pro-demo-ribbon">
          Demo mode · no real devices, no Supabase writes, no customer data.
        </div>
      ) : null}
      <aside className="pro-sidebar">
        <div className="pro-brand">
          <div className="pro-brand-mark">
            {displayedOrganizationLogo ? (
              <img src={displayedOrganizationLogo} alt={`${organization.name} logo`} />
            ) : (
              <Building2 size={24} />
            )}
          </div>
          <div>
            <span>Workflow Pro</span>
            <strong>{organization.name}</strong>
          </div>
        </div>

        <nav className="pro-nav" aria-label="Pro dashboard navigation">
          <button className={activeSection === "fleet" ? "active" : ""} type="button" onClick={() => setActiveSection("fleet")}>
            <Gauge size={18} />
            Fleet
          </button>
          <button className={activeSection === "map" ? "active" : ""} type="button" onClick={() => setActiveSection("map")}>
            <MapIcon size={18} />
            Map
          </button>
          <button className={activeSection === "reservations" ? "active" : ""} type="button" onClick={() => setActiveSection("reservations")}>
            <CalendarRange size={18} />
            Reservations
          </button>
          <button className={activeSection === "alerts" ? "active" : ""} type="button" onClick={() => setActiveSection("alerts")}>
            <AlertTriangle size={18} />
            Alerts
          </button>
          <button className={activeSection === "energy" ? "active" : ""} type="button" onClick={() => setActiveSection("energy")}>
            <Zap size={18} />
            Energy
          </button>
          {canManageTeam ? (
            <button className={activeSection === "team" ? "active" : ""} type="button" onClick={() => setActiveSection("team")}>
              <Users size={18} />
              Team
            </button>
          ) : null}
          <button className={activeSection === "settings" ? "active" : ""} type="button" onClick={() => setActiveSection("settings")}>
            <Settings size={18} />
            Settings
          </button>
        </nav>

      </aside>

      <main className="pro-main">
        <header className="pro-header">
          <div className="pro-header-title">
            {displayedOrganizationLogo ? (
              <img className="pro-header-logo" src={displayedOrganizationLogo} alt={`${organization.name} logo`} />
            ) : null}
            <div>
              <span className="eyebrow">{sectionTitle}</span>
              <h1>{organization.name}</h1>
              <p>{sectionCopy}</p>
            </div>
          </div>
          {activeSection === "fleet" || activeSection === "map" || activeSection === "reservations" || activeSection === "alerts" || activeSection === "energy" ? (
            <div className="pro-search">
              <Search size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={activeSection === "reservations" ? "Search reservations, property, address, serial, or device ID" : "Search by property, address, serial, or device ID"}
              />
            </div>
          ) : null}
        </header>

        {activeSection === "team" ? null : activeSection === "reservations" ? (
          <section className="pro-stats-grid" aria-label="Reservation heat status">
            <div className="pro-stat-card heat">
              <span>Active now</span>
              <strong>{reservationStats.activeCount}</strong>
            </div>
            <div className="pro-stat-card scheduled">
              <span>Scheduled</span>
              <strong>{reservationStats.scheduledCount}</strong>
            </div>
            <div className="pro-stat-card money">
              <span>Next 7 days</span>
              <strong>{reservationStats.nextSevenCount}</strong>
            </div>
            <div className="pro-stat-card">
              <span>Properties</span>
              <strong>{reservationStats.propertyCount}</strong>
            </div>
          </section>
        ) : activeSection === "alerts" ? (
          <section className="pro-stats-grid alerts" aria-label="Fleet alert status">
            <div className="pro-stat-card">
              <span>Online hubs</span>
              <strong>{fleetStats.onlineCount}</strong>
            </div>
            <div className="pro-stat-card offline">
              <span>Offline hubs</span>
              <strong>{fleetStats.offlineCount}</strong>
            </div>
            <div className="pro-stat-card warning attention-wide">
              <span>Needs attention</span>
              <strong>{fleetStats.attentionDeviceCount}</strong>
              <small>{fleetIssues.length} active alert{fleetIssues.length === 1 ? "" : "s"} across the fleet</small>
            </div>
          </section>
        ) : activeSection === "map" ? (
          <section className="pro-stats-grid alerts" aria-label="Fleet map status">
            <div className="pro-stat-card">
              <span>Online hubs</span>
              <strong>{fleetStats.onlineCount}</strong>
            </div>
            <div className="pro-stat-card offline">
              <span>Offline hubs</span>
              <strong>{fleetStats.offlineCount}</strong>
            </div>
            <div className="pro-stat-card heat">
              <span>Heating now</span>
              <strong>{fleetStats.heatingCount}</strong>
            </div>
            <div className="pro-stat-card scheduled">
              <span>Scheduled heating</span>
              <strong>{fleetStats.scheduledHeatCount}</strong>
            </div>
          </section>
        ) : activeSection === "energy" ? (
          <section className="pro-stats-grid" aria-label="Energy status">
            <div className="pro-stat-card money energy-detail">
              <span>Estimated monthly cost</span>
              <strong>{formatMoney(energyStats.estimatedMonthlyCost)}</strong>
              <small>All managed pools</small>
            </div>
            <div className="pro-stat-card warning energy-detail">
              <span>Highest-cost pool</span>
              <strong>{formatMoney(energyStats.highestCostPool?.cost ?? null)}</strong>
              <small>{energyStats.highestCostPool ? propertyTitle(energyStats.highestCostPool.device) : "No energy data"}</small>
            </div>
            <div className="pro-stat-card money energy-detail">
              <span>Cheapest pool</span>
              <strong>{formatMoney(energyStats.cheapestPool?.cost ?? null)}</strong>
              <small>{energyStats.cheapestPool ? propertyTitle(energyStats.cheapestPool.device) : "No energy data"}</small>
            </div>
            <div className="pro-stat-card scheduled energy-detail">
              <span>Total energy used</span>
              <strong>{energyStats.totalKwh.toFixed(1)}</strong>
              <small>kWh across the fleet</small>
            </div>
          </section>
        ) : activeSection === "fleet" ? (
          <section className="pro-stats-grid" aria-label="Fleet status">
            <div className="pro-stat-card split-status">
              <div>
                <span>Online hubs</span>
                <strong>{fleetStats.onlineCount}</strong>
              </div>
              <div>
                <span>Offline hubs</span>
                <strong>{fleetStats.offlineCount}</strong>
              </div>
            </div>
            <div className="pro-stat-card money">
              <span>Estimated energy</span>
              <strong>{formatMoney(fleetStats.totalCost)}</strong>
            </div>
            <div className="pro-stat-card heat">
              <span>Heating now</span>
              <strong>{fleetStats.heatingCount}</strong>
            </div>
            <div className="pro-stat-card scheduled">
              <span>Scheduled heat</span>
              <strong>{fleetStats.scheduledHeatCount}</strong>
            </div>
          </section>
        ) : null}

        {activeSection === "fleet" ? (
          <>
            <section className="pro-toolbar">
              {(["all", "alerts", "offline", "heating", "scheduled"] as const).map((item) => (
                <button
                  key={item}
                  className={filter === item ? "active" : ""}
                  type="button"
                  onClick={() => setFilter(item)}
                >
                  {item === "all" ? "All properties" : item === "scheduled" ? "Scheduled heating" : item}
                </button>
              ))}
            </section>

            <section className="pro-device-grid">
              {filteredDevices.map((device) => {
                const online = device.online_status === "online" && wasSeenRecently(device.last_seen);
                const attention = !online || device.node_online === false;
                const heatEta = formatHeatEta(device);
                const nextOverride = nextOverridesByDevice.get(device.device_id);
                return (
                  <article className={attention ? "pro-device-card attention" : "pro-device-card"} key={device.device_id}>
                    <div className="pro-device-topline">
                      <div>
                        <h2>{propertyTitle(device)}</h2>
                        <p>
                          <MapPin size={14} />
                          {propertyAddress(device)}
                        </p>
                      </div>
                      <span className={online ? "pro-status online" : "pro-status offline"}>
                        <Radio size={14} />
                        {online ? "Online" : "Offline"}
                      </span>
                    </div>

                    <div className="pro-device-metrics">
                      <div>
                        <Thermometer size={17} />
                        <span>Water</span>
                        <strong>{formatTemp(device.current_temp)}</strong>
                      </div>
                      <div>
                        <Zap size={17} />
                        <span>Pump</span>
                        <strong>{device.pump_on ? "On" : "Off"}</strong>
                      </div>
                      <div>
                        <Flame size={17} />
                        <span>Heater</span>
                        <strong>{device.heater_enabled ? "On" : "Off"}</strong>
                      </div>
                      <div>
                        {heatEta ? <Flame size={17} /> : <Zap size={17} />}
                        <span>{heatEta ? "Heat ETA" : "Cost"}</span>
                        <strong>{heatEta ?? formatMoney(estimatedMonthlyCost(device))}</strong>
                      </div>
                    </div>

                    <div className="pro-device-footer">
                      <span>
                        {nextOverride
                          ? `Heat ${formatDateLabel(nextOverride.start_date)} - ${formatDateLabel(nextOverride.end_date)}`
                          : device.device_id}
                      </span>
                      <div className="pro-device-actions">
                        <button className="secondary" type="button" onClick={() => openPropertyEditor(device)}>
                          <Edit3 size={15} />
                          Edit
                        </button>
                        <button className="secondary" type="button" onClick={() => openReservationEditor(device)}>
                          <CalendarRange size={15} />
                          Heat dates
                        </button>
                        <button type="button" onClick={() => onOpenDevice(device.device_id)}>
                          Open dashboard
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>

            {filteredDevices.length === 0 ? (
              <div className="pro-empty-state">
                <strong>No properties found</strong>
                <span>Try a different search or filter.</span>
              </div>
            ) : null}
          </>
        ) : null}

        {activeSection === "reservations" ? (
          <section className="pro-reservations-panel">
            <div className="pro-reservations-toolbar">
              <div className="pro-calendar-nav">
                <button type="button" onClick={() => setReservationCalendarDate((current) => addMonths(current, -1))}>
                  Prev
                </button>
                <strong>{formatMonthLabel(reservationCalendarDate)}</strong>
                <button type="button" onClick={() => setReservationCalendarDate((current) => addMonths(current, 1))}>
                  Next
                </button>
              </div>

              <div className="pro-reservation-controls">
                <div className="pro-segmented-control" aria-label="Reservation view">
                  {(["month", "list"] as const).map((view) => (
                    <button
                      key={view}
                      className={reservationView === view ? "active" : ""}
                      type="button"
                      onClick={() => setReservationView(view)}
                    >
                      {view}
                    </button>
                  ))}
                </div>
                <div className="pro-segmented-control" aria-label="Reservation status">
                  {(["all", "active", "scheduled", "completed"] as const).map((status) => (
                    <button
                      key={status}
                      className={reservationStatusFilter === status ? "active" : ""}
                      type="button"
                      onClick={() => setReservationStatusFilter(status)}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {reservationView === "month" ? (
              <div className="pro-calendar-grid">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName) => (
                  <div className="pro-calendar-weekday" key={dayName}>{dayName}</div>
                ))}

                {reservationCalendarDays.map((day) => {
                  const dayKey = dateInputValue(day);
                  const inCurrentMonth = day.getMonth() === reservationCalendarDate.getMonth();
                  const isToday = dayKey === dateInputValue();
                  const dayReservations = reservationRows.filter((row) => overrideRunsOnDate(row.override, day));

                  return (
                    <div
                      className={[
                        "pro-calendar-day",
                        inCurrentMonth ? "" : "muted",
                        isToday ? "today" : "",
                      ].filter(Boolean).join(" ")}
                      key={dayKey}
                    >
                      <span>{day.getDate()}</span>
                      <div className="pro-calendar-events">
                        {dayReservations.slice(0, 3).map(({ override, device, status }) => (
                          <button
                            className={`pro-calendar-event ${status}`}
                            key={`${dayKey}-${override.id}`}
                            type="button"
                            onClick={() => openReservationOverrideEditor(override, device)}
                            disabled={!device}
                            title={`${device ? propertyTitle(device) : override.device_id} - ${override.name ?? "Reservation heat"}`}
                          >
                            <strong>{device ? propertyTitle(device) : override.device_id}</strong>
                            <small>{formatTimeLabel(override.start_time)} · {override.setpoint ?? "--"}°F</small>
                          </button>
                        ))}
                        {dayReservations.length > 3 ? (
                          <em>+{dayReservations.length - 3} more</em>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="pro-reservation-list">
                {reservationRows.map(({ override, device, status }) => (
                  <article className={`pro-reservation-row ${status}`} key={override.id}>
                    <div className="pro-reservation-date">
                      <span>{formatDateLabel(override.start_date)}</span>
                      <strong>{formatDateLabel(override.end_date)}</strong>
                    </div>
                    <div>
                      <strong>{override.name ?? "Reservation heat"}</strong>
                      <span>
                        {device ? propertyTitle(device) : override.device_id}
                        {" · "}
                        {formatTimeLabel(override.start_time)} - {formatTimeLabel(override.end_time)}
                      </span>
                    </div>
                    <b>{status}</b>
                    <button type="button" onClick={() => openReservationOverrideEditor(override, device)} disabled={!device}>
                      Open
                    </button>
                  </article>
                ))}
              </div>
            )}

            {reservationRows.length === 0 ? (
              <div className="pro-empty-state">
                <strong>No heat reservations found</strong>
                <span>Try a different search/filter, or create one from a property card.</span>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeSection === "map" ? (
          <section className="pro-map-layout">
            <div className="pro-map-panel">
              <div className="pro-map-heading">
                <div>
                  <span className="eyebrow">Live Fleet Status</span>
                  <h2>Property Map</h2>
                </div>
                <div className="pro-map-legend" aria-label="Map status legend">
                  <span><i className="online" /> Online</span>
                  <span><i className="warning" /> Warning</span>
                  <span><i className="offline" /> Offline</span>
                </div>
              </div>

              <div className="pro-map-canvas" aria-label="Fleet property map">
                <GoogleFleetMap points={mapPins} onOpenDevice={onOpenDevice} />
                {mapPins.map(({ device, point, status }) => (
                  <button
                    className={`pro-map-pin ${status.kind}`}
                    key={device.device_id}
                    style={{ left: `${point.x}%`, top: `${point.y}%` }}
                    type="button"
                    title={`${propertyTitle(device)} - ${status.label}`}
                    onClick={() => onOpenDevice(device.device_id)}
                  >
                    <MapPin size={19} />
                    <span>{propertyTitle(device).slice(0, 2).toUpperCase()}</span>
                  </button>
                ))}
              </div>
            </div>

            <aside className="pro-map-list-panel">
              <div className="pro-map-list-heading">
                <strong>{filteredDevices.length} properties</strong>
                <span>{fleetIssues.length} active alerts</span>
              </div>

              {filteredDevices.map((device) => {
                const status = fleetStatusForDevice(device);
                return (
                  <article className="pro-map-row" key={device.device_id}>
                    <div className={`pro-map-dot ${status.kind}`} />
                    <div>
                      <strong>{propertyTitle(device)}</strong>
                      <span>{propertyAddress(device)}</span>
                    </div>
                    <button type="button" onClick={() => onOpenDevice(device.device_id)}>
                      Open
                    </button>
                  </article>
                );
              })}

              {filteredDevices.length === 0 ? (
                <div className="pro-empty-state">
                  <strong>No map results</strong>
                  <span>Try a different search.</span>
                </div>
              ) : null}
            </aside>
          </section>
        ) : null}

        {activeSection === "alerts" ? (
          <section className="pro-list-panel">
            {fleetIssues.length > 0 ? fleetIssues.map((issue, index) => (
              <article className={`pro-alert-row ${issue.severity}`} key={`${issue.device.device_id}-${issue.title}-${index}`}>
                <div className="pro-alert-icon">
                  <AlertTriangle size={18} />
                </div>
                <div>
                  <strong>{issue.title}</strong>
                  <span>{propertyTitle(issue.device)} · {issue.message}</span>
                </div>
                <button type="button" onClick={() => onOpenDevice(issue.device.device_id)}>
                  Open
                </button>
              </article>
            )) : (
              <div className="pro-empty-state">
                <strong>No active fleet issues</strong>
                <span>Everything we can see from the cloud looks healthy.</span>
              </div>
            )}
          </section>
        ) : null}

        {activeSection === "energy" ? (
          <section className="pro-list-panel">
            {filteredDevices.map((device) => (
              <article className="pro-energy-row" key={device.device_id}>
                <div>
                  <strong>{propertyTitle(device)}</strong>
                  <span>{propertyAddress(device)}</span>
                </div>
                <div>
                  <span>Pump</span>
                  <strong>{typeof device.pump_watts === "number" ? `${Math.round(device.pump_watts)} W` : "--"}</strong>
                </div>
                <div>
                  <span>Heater</span>
                  <strong>{typeof device.heater_watts === "number" ? `${Math.round(device.heater_watts)} W` : "--"}</strong>
                </div>
                <div>
                  <span>Total kWh</span>
                  <strong>{typeof device.total_kwh === "number" ? device.total_kwh.toFixed(2) : "--"}</strong>
                </div>
                <div>
                  <span>Cost</span>
                  <strong>{formatMoney(estimatedMonthlyCost(device))}</strong>
                </div>
              </article>
            ))}
          </section>
        ) : null}

        {activeSection === "team" && canManageTeam ? (
          <section className="pro-team-layout">
            <div className="pro-role-grid">
              {roleOptions.map((role) => (
                <article className="pro-role-card" key={role.value}>
                  <div>
                    <ShieldCheck size={18} />
                    <strong>{role.label}</strong>
                  </div>
                  <span>{role.detail}</span>
                  <b>{roleCounts[role.value]} active</b>
                </article>
              ))}
            </div>

            <div className="pro-team-columns">
              <form
                className="pro-team-panel"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (canManageTeam) void sendInvite();
                }}
              >
                <div className="pro-team-heading">
                  <div>
                    <span className="eyebrow">Invite Staff</span>
                    <h2>Add a team member</h2>
                  </div>
                  <UserPlus size={24} />
                </div>

                <label>
                  Email address
                  <input
                    value={inviteEmail}
                    onChange={(event) => {
                      setInviteEmail(event.target.value);
                      setInviteError("");
                      setInviteSuccess("");
                    }}
                    placeholder="manager@example.com"
                    type="email"
                    disabled={!canManageTeam}
                  />
                </label>

                <label>
                  Role
                  <select
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value as OrganizationRole)}
                    disabled={!canManageTeam}
                  >
                    {roleOptions.map((role) => (
                      <option key={role.value} value={role.value}>{role.label}</option>
                    ))}
                  </select>
                </label>

                <button type="submit" disabled={savingInvite || !canManageTeam}>
                  {savingInvite ? "Saving invite..." : "Save invite"}
                </button>

                {!canManageTeam ? <div className="pro-permission-note">Only owners can invite or change team access.</div> : null}
                {inviteError ? <div className="error-box">{inviteError}</div> : null}
                {inviteSuccess ? <div className="success-box">{inviteSuccess}</div> : null}
              </form>

              <section className="pro-team-panel">
                <div className="pro-team-heading">
                  <div>
                    <span className="eyebrow">Current Team</span>
                    <h2>{members.length} members</h2>
                  </div>
                  <Users size={24} />
                </div>

                <div className="pro-team-list">
                  {members.map((member) => {
                    const isCurrentUser = member.user_id === membership.user_id;
                    const isLastOwner = member.role === "owner" && ownerCount <= 1;
                    const canRemoveMember = canManageTeam && !isCurrentUser && !isLastOwner;

                    return (
                      <article className="pro-team-row" key={`${member.organization_id}-${member.user_id}`}>
                        <div className="pro-team-avatar">{memberName(member).slice(0, 1).toUpperCase()}</div>
                        <div>
                          <strong>{memberName(member)}</strong>
                          <span>{member.email || member.user_id}</span>
                        </div>
                        <b>{isCurrentUser ? "You" : formatRole(member.role)}</b>
                        {canRemoveMember ? (
                          <button
                            className="danger"
                            type="button"
                            onClick={() => {
                              setTeamActionError("");
                              setTeamActionTarget({
                                kind: "member",
                                userId: member.user_id,
                                label: memberName(member),
                                role: formatRole(member.role),
                              });
                            }}
                          >
                            Remove
                          </button>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="pro-team-panel">
                <div className="pro-team-heading">
                  <div>
                    <span className="eyebrow">Pending</span>
                    <h2>{invites.length} invites</h2>
                  </div>
                  <UserPlus size={24} />
                </div>

                <div className="pro-team-list">
                  {invites.length > 0 ? invites.map((invite) => (
                    <article className="pro-team-row" key={invite.id}>
                      <div className="pro-team-avatar muted">{invite.email.slice(0, 1).toUpperCase()}</div>
                      <div>
                        <strong>{invite.email}</strong>
                        <span>Pending invite</span>
                      </div>
                      <b>{formatRole(invite.role)}</b>
                      <button
                        className="danger"
                        type="button"
                        onClick={() => {
                          setTeamActionError("");
                          setTeamActionTarget({
                            kind: "invite",
                            inviteId: invite.id,
                            label: invite.email,
                            role: formatRole(invite.role),
                          });
                        }}
                      >
                        Cancel
                      </button>
                    </article>
                  )) : (
                    <div className="pro-empty-state">
                      <strong>No pending invites</strong>
                      <span>Saved invites will appear here.</span>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {activeSection === "settings" ? (
          <form
            className="pro-settings-panel"
            onSubmit={(event) => {
              event.preventDefault();
              void saveOrganization();
            }}
          >
            <div className="pro-settings-heading">
              <div>
                <span className="eyebrow">Owner Information</span>
                <h2>Company Profile</h2>
                <p>This is the business profile for the Pro dashboard and future billing/team features.</p>
              </div>
            </div>

            <div className={editingOrganization ? "pro-profile-hero editing" : "pro-profile-hero"}>
              <div className="pro-profile-mark">
                {displayedOrganizationLogo ? (
                  <img src={displayedOrganizationLogo} alt={`${organization.name} logo`} />
                ) : (
                  <Building2 size={26} />
                )}
              </div>
              <div>
                <span className="eyebrow">Company</span>
                <h3>{editingOrganization ? "Editing company profile" : organization.name}</h3>
                <p>{editingOrganization ? "Update the business details shown across this Pro dashboard." : companyAddress(organization)}</p>
                {!editingOrganization ? (
                  <div className="pro-profile-contact-row">
                    <span>{organization.company_phone || "Phone not set"}</span>
                    <span>{organization.company_email || "Email not set"}</span>
                  </div>
                ) : null}
              </div>
              <div className="pro-profile-actions">
                {editingOrganization ? (
                  <>
                    <button
                      type="button"
                      className="secondary"
                      onClick={resetOrganizationEdit}
                      disabled={savingOrganization}
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={savingOrganization}>
                      {savingOrganization ? "Saving..." : "Save settings"}
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setEditingOrganization(true)}>
                    Edit
                  </button>
                )}
              </div>
            </div>

            <div className="pro-settings-account">
              <div>
                <span>Access level</span>
                <strong>{formatRole(membership.role)}</strong>
              </div>
              <div>
                <span>Subscription</span>
                <strong>{organization.plan} plan</strong>
              </div>
              <div>
                <span>Subscription status</span>
                <strong>{organization.plan === "pro" || organization.plan === "enterprise" ? "Active" : "Not active"}</strong>
              </div>
              <button className="danger" type="button" onClick={onSignOut}>Sign out</button>
            </div>

            {editingOrganization ? (
              <>
                <label className="pro-logo-upload">
                  Company logo
                  <div className="pro-logo-upload-row">
                    <div className="pro-logo-upload-preview">
                      {displayedOrganizationLogo ? (
                        <img src={displayedOrganizationLogo} alt={`${organization.name} logo preview`} />
                      ) : (
                        <Building2 size={26} />
                      )}
                    </div>
                    <div>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                        onChange={(event) => updateOrganizationLogo(event.target.files?.[0] ?? null)}
                      />
                      <small>PNG, JPG, WebP, GIF, or SVG. Max 2 MB.</small>
                    </div>
                  </div>
                </label>

                <label>
                  Company name
                  <input
                    value={organizationForm.name}
                    onChange={(event) => updateOrganizationForm("name", event.target.value)}
                    placeholder="Blue Coast Rentals"
                  />
                </label>

                <label>
                  Company address
                  <input
                    value={organizationForm.company_address}
                    onChange={(event) => updateOrganizationForm("company_address", event.target.value)}
                    placeholder="500 Ocean Drive"
                  />
                </label>

                <div className="pro-form-grid">
                  <label>
                    City
                    <input
                      value={organizationForm.company_city}
                      onChange={(event) => updateOrganizationForm("company_city", event.target.value)}
                      placeholder="Miami"
                    />
                  </label>
                  <label>
                    State
                    <input
                      value={organizationForm.company_state}
                      onChange={(event) => updateOrganizationForm("company_state", event.target.value)}
                      placeholder="FL"
                    />
                  </label>
                  <label>
                    ZIP
                    <input
                      value={organizationForm.company_zip}
                      onChange={(event) => updateOrganizationForm("company_zip", event.target.value)}
                      placeholder="33139"
                    />
                  </label>
                </div>

                <div className="pro-form-grid two">
                  <label>
                    Phone
                    <input
                      value={organizationForm.company_phone}
                      onChange={(event) => updateOrganizationForm("company_phone", event.target.value)}
                      placeholder="(555) 555-1234"
                    />
                  </label>
                  <label>
                    Email
                    <input
                      value={organizationForm.company_email}
                      onChange={(event) => updateOrganizationForm("company_email", event.target.value)}
                      placeholder="service@example.com"
                    />
                  </label>
                </div>

              </>
            ) : null}

            {organizationError ? <div className="error-box">{organizationError}</div> : null}
            {organizationSuccess ? <div className="success-box">{organizationSuccess}</div> : null}
          </form>
        ) : null}
      </main>

      {reservationDevice && reservationForm ? (
        <div className="pro-modal-backdrop" role="dialog" aria-modal="true" aria-label="Reservation heat schedule">
          <form
            className="pro-property-modal pro-reservation-modal"
            onSubmit={(event) => {
              event.preventDefault();
              void saveReservation();
            }}
          >
            <div className="pro-modal-header">
              <div>
                <span className="eyebrow">Reservation Heat</span>
                <h2>{propertyTitle(reservationDevice)}</h2>
              </div>
              <button
                className="pro-modal-close"
                type="button"
                onClick={closeReservationEditor}
                aria-label="Close reservation heat"
                disabled={savingReservation}
              >
                <X size={20} />
              </button>
            </div>

            <div className="pro-reservation-note">
              <CalendarRange size={20} />
                  <div>
                    <strong>{editingReservationOverride ? "Change or cancel this heat reservation." : "Pump and heater will both run for this date range."}</strong>
                    <span>Regular weekly schedules are paused during the override and resume after it ends.</span>
                  </div>
                </div>

            <div className="pro-reservation-properties">
              <div className="pro-reservation-properties-head">
                <div>
                  <span>Properties</span>
                  <strong>{selectedReservationDevices.length} selected</strong>
                </div>
                {showReservationProperties ? (
                  <div className="pro-reservation-property-tools">
                    <div className="pro-reservation-property-search">
                      <Search size={15} />
                      <input
                        value={reservationPropertyQuery}
                        onChange={(event) => setReservationPropertyQuery(event.target.value)}
                        placeholder="Search properties"
                      />
                    </div>
                    <button
                      className="icon"
                      type="button"
                      onClick={() => {
                        setShowReservationProperties(false);
                        setReservationPropertyQuery("");
                      }}
                      aria-label="Hide property selection"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setShowReservationProperties(true)}>
                    Add more properties
                  </button>
                )}
              </div>

              <div className="pro-reservation-selected">
                {selectedReservationDevices.map((device) => (
                  <span key={device.device_id}>{propertyTitle(device)}</span>
                ))}
              </div>

              {showReservationProperties ? (
                <div className="pro-reservation-property-list">
                  {filteredReservationPropertyDevices.map((device) => {
                    const isPrimary = device.device_id === reservationDevice.device_id;
                    const hasExistingHeat = Boolean(nextOverridesByDevice.get(device.device_id));
                    return (
                      <label className="pro-reservation-property-row" key={device.device_id}>
                        <input
                          type="checkbox"
                          checked={reservationDeviceIds.includes(device.device_id)}
                          disabled={isPrimary || savingReservation}
                          onChange={() => toggleReservationDevice(device.device_id)}
                        />
                        <div>
                          <strong>{propertyTitle(device)}</strong>
                          <span>{propertyAddress(device)}</span>
                        </div>
                        {isPrimary ? <b>Started here</b> : hasExistingHeat ? <b>Will update</b> : null}
                      </label>
                    );
                  })}
                  {filteredReservationPropertyDevices.length === 0 ? (
                    <div className="pro-reservation-property-empty">No properties match that search.</div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <label>
              Schedule name
              <input
                value={reservationForm.name}
                onChange={(event) => updateReservationForm("name", event.target.value)}
                placeholder="Guest arrival heat"
                maxLength={48}
              />
            </label>

            <div className="pro-form-grid two">
              <label>
                Start date
                <input
                  type="date"
                  value={reservationForm.start_date}
                  onChange={(event) => {
                    const nextStart = event.target.value;
                    updateReservationForm("start_date", nextStart);
                    if (reservationForm.end_date < nextStart) updateReservationForm("end_date", nextStart);
                  }}
                  required
                />
              </label>
              <label>
                End date
                <input
                  type="date"
                  value={reservationForm.end_date}
                  min={reservationForm.start_date}
                  onChange={(event) => updateReservationForm("end_date", event.target.value)}
                  required
                />
              </label>
            </div>

            <div className="pro-form-grid two">
              <label>
                Start time
                <input
                  type="time"
                  value={reservationForm.start_time}
                  onChange={(event) => updateReservationForm("start_time", event.target.value)}
                  required
                />
              </label>
              <label>
                End time
                <input
                  type="time"
                  value={reservationForm.end_time}
                  onChange={(event) => updateReservationForm("end_time", event.target.value)}
                  required
                />
              </label>
            </div>

            <label>
              Heater setpoint
              <input
                type="number"
                min={50}
                max={104}
                step={1}
                value={reservationForm.setpoint ?? ""}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  updateReservationForm("setpoint", Number.isFinite(nextValue) ? nextValue : null);
                }}
              />
            </label>

            {editingReservationOverride ? (
              <div className="pro-reservation-summary active">
                <span>Saved reservation</span>
                <strong>
                  {formatDateLabel(editingReservationOverride.start_date)} - {formatDateLabel(editingReservationOverride.end_date)}
                  {" · "}
                  {formatTimeLabel(editingReservationOverride.start_time)} - {formatTimeLabel(editingReservationOverride.end_time)}
                </strong>
              </div>
            ) : null}

            {reservationError ? <div className="error-box">{reservationError}</div> : null}
            {reservationSuccess ? <div className="success-box">{reservationSuccess}</div> : null}

            <div className="pro-modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={closeReservationEditor}
                disabled={savingReservation}
              >
                Cancel
              </button>
              {editingReservationOverride ? (
                <button type="button" className="danger" onClick={() => void cancelReservation()} disabled={savingReservation}>
                  Cancel heat dates
                </button>
              ) : null}
              <button type="submit" disabled={savingReservation}>
                {savingReservation ? "Saving..." : editingReservationOverride ? "Update heat dates" : "Save heat dates"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {teamActionTarget ? (
        <div className="pro-modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm team change">
          <div className="pro-property-modal pro-team-confirm-modal">
            <div className="pro-modal-header">
              <div>
                <span className="eyebrow">Team Access</span>
                <h2>{teamActionTarget.kind === "member" ? "Remove team member?" : "Cancel invite?"}</h2>
              </div>
              <button
                className="pro-modal-close"
                type="button"
                onClick={() => {
                  setTeamActionTarget(null);
                  setTeamActionError("");
                }}
                aria-label="Close team confirmation"
                disabled={teamActionBusy}
              >
                <X size={20} />
              </button>
            </div>

            <div className="pro-team-confirm-copy">
              <strong>{teamActionTarget.label}</strong>
              <span>
                {teamActionTarget.kind === "member"
                  ? `This ${teamActionTarget.role.toLowerCase()} will lose access to all properties in this Pro dashboard. Their login account will not be deleted.`
                  : `This pending ${teamActionTarget.role.toLowerCase()} invite will no longer be usable.`}
              </span>
            </div>

            {teamActionError ? <div className="error-box">{teamActionError}</div> : null}

            <div className="pro-modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setTeamActionTarget(null);
                  setTeamActionError("");
                }}
                disabled={teamActionBusy}
              >
                Keep access
              </button>
              <button type="button" className="danger" onClick={() => void confirmTeamAction()} disabled={teamActionBusy}>
                {teamActionBusy ? "Saving..." : teamActionTarget.kind === "member" ? "Remove member" : "Cancel invite"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingDevice && propertyForm ? (
        <div className="pro-modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit property">
          <form
            className="pro-property-modal"
            onSubmit={(event) => {
              event.preventDefault();
              void saveProperty();
            }}
          >
            <div className="pro-modal-header">
              <div>
                <span className="eyebrow">Property Details</span>
                <h2>{propertyTitle(editingDevice)}</h2>
              </div>
              <button
                className="pro-modal-close"
                type="button"
                onClick={() => {
                  setEditingDevice(null);
                  setPropertyForm(null);
                }}
                aria-label="Close property editor"
              >
                <X size={20} />
              </button>
            </div>

            <label>
              Dashboard name
              <input
                value={propertyForm.name}
                onChange={(event) => updatePropertyForm("name", event.target.value)}
                placeholder="Pool Hub"
              />
            </label>

            <label>
              Property name
              <input
                value={propertyForm.property_name}
                onChange={(event) => updatePropertyForm("property_name", event.target.value)}
                placeholder="Ocean Villa 12"
              />
            </label>

            <label>
              Address
              <input
                value={propertyForm.address}
                onChange={(event) => updatePropertyForm("address", event.target.value)}
                placeholder="123 Beach Ave"
              />
            </label>

            <div className="pro-form-grid">
              <label>
                City
                <input
                  value={propertyForm.city}
                  onChange={(event) => updatePropertyForm("city", event.target.value)}
                  placeholder="Miami"
                />
              </label>
              <label>
                State
                <input
                  value={propertyForm.state}
                  onChange={(event) => updatePropertyForm("state", event.target.value)}
                  placeholder="FL"
                />
              </label>
              <label>
                ZIP
                <input
                  value={propertyForm.zip}
                  onChange={(event) => updatePropertyForm("zip", event.target.value)}
                  placeholder="33139"
                />
              </label>
            </div>

            <label>
              Notes
              <textarea
                value={propertyForm.property_notes}
                onChange={(event) => updatePropertyForm("property_notes", event.target.value)}
                placeholder="Gate code, service notes, equipment location"
              />
            </label>

            {propertyError ? <div className="error-box">{propertyError}</div> : null}

            <div className="pro-modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setEditingDevice(null);
                  setPropertyForm(null);
                }}
              >
                Cancel
              </button>
              <button type="submit" disabled={savingProperty}>
                {savingProperty ? "Saving..." : "Save property"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
