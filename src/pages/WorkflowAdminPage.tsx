import {
  Building2,
  Ban,
  CheckCircle2,
  Copy,
  Database,
  DollarSign,
  Download,
  FileCode2,
  KeyRound,
  Link2,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
  UserRoundPlus,
  Wifi,
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  assignWorkflowDeviceToOrganization,
  createWorkflowProAccount,
  fetchWorkflowFirmwareTemplates,
  registerWorkflowDevice,
  deleteWorkflowOrganization,
  recordWorkflowFirmwareDownload,
  fetchWorkflowFirmwareDownloads,
  fetchWorkflowFirmwareDownloadCode,
  type WorkflowFirmwareDownloadRecord,
  saveWorkflowFirmwareTemplate,
  updateWorkflowOrganizationStatus,
  type FirmwareTarget,
  type WorkflowFirmwareTemplate,
  type WorkflowAdminRegisterDeviceResponse,
  type WorkflowAdminOrganization,
  type WorkflowAdminOverview,
} from "../lib/deviceApi";
import {
  downloadTextFile,
  generateHubFirmware,
  generateNodeFirmware,
  hubFirmwareFileName,
  nodeFirmwareFileName,
  pairIdForDevice,
} from "../lib/firmwareDownload";
import type {
  OrganizationMember,
  PoolDevice,
  SentryAdminOverview,
  StripeRevenueOverview,
} from "../lib/deviceApi";
import { fetchSentryAdminIssues, fetchStripeRevenueOverview, resolveSentryIssue } from "../lib/deviceApi";
import { DashboardPage } from "./DashboardPage";
import { ProDashboardPage } from "./ProDashboardPage";

type WorkflowAdminPageProps = {
  overview: WorkflowAdminOverview;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
  testDevice?: PoolDevice | null;
  testUserId?: string;
  testLoading?: boolean;
  testError?: string;
  onTestRefresh?: () => void;
  onTestCommandSettled?: () => void;
};

type AdminSection =
  | "overview"
  | "revenue"
  | "errors"
  | "createProAccount"
  | "proCompanies"
  | "assignDevice"
  | "registerDevice"
  | "devices"
  | "claims"
  | "firmware"
  | "testDashboard"
  | "testProDashboard";

function wasSeenRecently(lastSeen: string | null | undefined) {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 120000;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatShortDateTime(value: string | null | undefined) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statCard(label: string, value: string | number, detail: string, icon: ReactNode, tone = "") {
  return (
    <div className={`workflow-stat-card ${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      {icon}
    </div>
  );
}

function overviewBand(label: string, value: string | number, detail: string, icon: ReactNode, tone = "") {
  return (
    <article className={`workflow-overview-band ${tone}`}>
      <span className="workflow-overview-band-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <small>{detail}</small>
      </div>
      <strong>{value}</strong>
    </article>
  );
}

const HOME_MONTHLY_PRICE = 9;
const PRO_MONTHLY_PRICE = 19;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function randomToken(length = 24) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomClaimCode() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(value).padStart(6, "0");
}

function nextDeviceNumber(overview: WorkflowAdminOverview) {
  const values = [
    ...overview.claims.map((claim) => claim.serial_number),
    ...overview.devices.map((device) => device.serial_number ?? device.device_id),
  ];

  const highest = values.reduce((max, value) => {
    const match = String(value ?? "").match(/(\d+)$/);
    const numberValue = match ? Number(match[1]) : 0;
    return Number.isFinite(numberValue) ? Math.max(max, numberValue) : max;
  }, 0);

  return highest + 1;
}

function firmwareSnippet(result: WorkflowAdminRegisterDeviceResponse) {
  return [
    `#define PAIR_ID "${pairIdForDevice(result)}"`,
    `#define DEVICE_ID "${result.firmware.device_id}"`,
    `#define DEVICE_SECRET "${result.firmware.device_secret}"`,
    `#define DEVICE_SERIAL_NUMBER "${result.firmware.serial_number}"`,
    result.firmware.claim_code ? `// Setup code for customer app: ${result.firmware.claim_code}` : "// Setup code: none",
  ].join("\n");
}

const workflowSectionTargets: Partial<Record<AdminSection, string>> = {
  overview: "workflow-overview",
  registerDevice: "workflow-register-device",
  createProAccount: "workflow-create-pro",
  assignDevice: "workflow-assign-device",
  proCompanies: "workflow-pro-companies",
  devices: "workflow-recent-devices",
  claims: "workflow-claims",
};

function workflowHeaderTitle(section: AdminSection) {
  if (section === "firmware") return "Keep the latest hub and node code ready for manufacturing.";
  if (section === "registerDevice") return "Generate serials, setup codes, and downloadable hub firmware.";
  if (section === "createProAccount") return "Create customer companies and owner access.";
  if (section === "assignDevice") return "Link registered hubs to Pro companies and properties.";
  if (section === "proCompanies") return "Review, suspend, reactivate, or delete Pro accounts.";
  if (section === "devices") return "Check recently registered hub status.";
  if (section === "claims") return "Review device claim records for customer onboarding.";
  if (section === "testDashboard") return "Live test of the homeowner dashboard with your real devices.";
  if (section === "testProDashboard") return "Live test of the full Pro dashboard experience.";
  if (section === "revenue") return "Live Stripe revenue, subscriptions, and payouts.";
  if (section === "errors") return "Live errors from your apps via Sentry.";
  return "Manage Pro accounts, devices, and onboarding.";
}

export function WorkflowAdminPage({
  overview,
  onRefresh,
  onSignOut,
  testDevice,
  testUserId,
  testLoading,
  testError,
  onTestRefresh,
  onTestCommandSettled,
}: WorkflowAdminPageProps) {
  const [activeSection, setActiveSection] = useState<AdminSection>("overview");
  const [companyName, setCompanyName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [plan, setPlan] = useState<"pro" | "enterprise">("pro");
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const [createError, setCreateError] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [targetDeviceId, setTargetDeviceId] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState("");
  const [assignError, setAssignError] = useState("");
  const [deviceSerial, setDeviceSerial] = useState("");
  const [newDeviceId, setNewDeviceId] = useState("");
  const [newDeviceSecret, setNewDeviceSecret] = useState("");
  const [newClaimCode, setNewClaimCode] = useState("");
  const [newDeviceName, setNewDeviceName] = useState("Pool Hub");
  const [registeringDevice, setRegisteringDevice] = useState(false);
  const [registerDeviceError, setRegisterDeviceError] = useState("");
  const [registeredDevice, setRegisteredDevice] = useState<WorkflowAdminRegisterDeviceResponse | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [organizationActionBusy, setOrganizationActionBusy] = useState("");
  const [organizationActionMessage, setOrganizationActionMessage] = useState("");
  const [organizationActionError, setOrganizationActionError] = useState("");
  const [firmwareTemplates, setFirmwareTemplates] = useState<WorkflowFirmwareTemplate[]>([]);
  const [firmwareTarget, setFirmwareTarget] = useState<FirmwareTarget>("hub");
  const [firmwareVersion, setFirmwareVersion] = useState("");
  const [firmwareCode, setFirmwareCode] = useState("");
  const [firmwareLoading, setFirmwareLoading] = useState(false);
  const [firmwareSaving, setFirmwareSaving] = useState(false);
  const [firmwareMessage, setFirmwareMessage] = useState("");
  const [firmwareError, setFirmwareError] = useState("");
  const [testProOrgId, setTestProOrgId] = useState("");
  const [downloadHistory, setDownloadHistory] = useState<WorkflowFirmwareDownloadRecord[]>([]);
  const [downloadHistoryLoading, setDownloadHistoryLoading] = useState(false);
  const [downloadHistoryError, setDownloadHistoryError] = useState("");
  const [downloadBusyId, setDownloadBusyId] = useState("");

  async function loadDownloadHistory() {
    setDownloadHistoryLoading(true);
    setDownloadHistoryError("");
    try {
      setDownloadHistory(await fetchWorkflowFirmwareDownloads());
    } catch (err) {
      setDownloadHistoryError(err instanceof Error ? err.message : "Unable to load downloads");
    } finally {
      setDownloadHistoryLoading(false);
    }
  }

  async function reDownloadFirmware(record: WorkflowFirmwareDownloadRecord) {
    setDownloadBusyId(record.id);
    try {
      const full = await fetchWorkflowFirmwareDownloadCode(record.id);
      if (!full.code) throw new Error("This download has no archived code (it predates the audit feature).");
      const fileName = full.file_name ?? `WorkflowPool_${full.target}_${full.device_id}.ino`;
      downloadTextFile(fileName, full.code);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Re-download failed");
    } finally {
      setDownloadBusyId("");
    }
  }
  const [revenue, setRevenue] = useState<StripeRevenueOverview | null>(null);
  const [revenueLoading, setRevenueLoading] = useState(false);
  const [revenueError, setRevenueError] = useState("");
  const [sentryData, setSentryData] = useState<SentryAdminOverview | null>(null);
  const [sentryLoading, setSentryLoading] = useState(false);
  const [sentryError, setSentryError] = useState("");
  const [resolvingIssueId, setResolvingIssueId] = useState("");

  async function loadSentryIssues() {
    setSentryLoading(true);
    setSentryError("");
    try {
      setSentryData(await fetchSentryAdminIssues());
    } catch (err) {
      setSentryError(err instanceof Error ? err.message : "Unable to load Sentry data");
    } finally {
      setSentryLoading(false);
    }
  }

  async function handleResolveSentry(issueId: string, project: string) {
    setResolvingIssueId(issueId);
    try {
      await resolveSentryIssue(issueId, project);
      await loadSentryIssues();
    } catch (err) {
      setSentryError(err instanceof Error ? err.message : "Resolve failed");
    } finally {
      setResolvingIssueId("");
    }
  }

  useEffect(() => {
    if (activeSection === "errors" && !sentryData && !sentryLoading) {
      void loadSentryIssues();
    }
  }, [activeSection]);

  async function loadRevenue() {
    setRevenueLoading(true);
    setRevenueError("");
    try {
      setRevenue(await fetchStripeRevenueOverview());
    } catch (err) {
      setRevenueError(err instanceof Error ? err.message : "Unable to load Stripe data");
    } finally {
      setRevenueLoading(false);
    }
  }

  useEffect(() => {
    if (activeSection === "registerDevice" && downloadHistory.length === 0 && !downloadHistoryLoading) {
      void loadDownloadHistory();
    }
    if (activeSection === "revenue" && !revenue && !revenueLoading) {
      void loadRevenue();
    }
  }, [activeSection]);

  const unassignedDevices = useMemo(
    () => overview.devices.filter((device) => !device.organization_id),
    [overview.devices],
  );

  const customerOrganizations = overview.organizations;
  const recentDevices = overview.devices.slice(0, 10);
  const selectedOrganization = useMemo(
    () => overview.organizations.find((organization) => organization.id === selectedOrganizationId) ?? overview.organizations[0] ?? null,
    [overview.organizations, selectedOrganizationId],
  );
  const selectedOrganizationDevices = useMemo(
    () => selectedOrganization ? overview.devices.filter((device) => device.organization_id === selectedOrganization.id) : [],
    [overview.devices, selectedOrganization],
  );
  const selectedOrganizationMembers = useMemo(
    () => selectedOrganization ? overview.members.filter((member) => member.organization_id === selectedOrganization.id) : [],
    [overview.members, selectedOrganization],
  );
  const selectedOrganizationInvites = useMemo(
    () => selectedOrganization ? overview.invites.filter((invite) => invite.organization_id === selectedOrganization.id) : [],
    [overview.invites, selectedOrganization],
  );
  const latestHubTemplate = useMemo(
    () => firmwareTemplates.find((template) => template.target === "hub") ?? null,
    [firmwareTemplates],
  );
  const latestNodeTemplate = useMemo(
    () => firmwareTemplates.find((template) => template.target === "node") ?? null,
    [firmwareTemplates],
  );
  const readyToClaimDevices = overview.stats.ready_to_claim_devices ?? overview.stats.unclaimed_devices;
  const devicesMissingFirmwareDownload = overview.stats.devices_missing_firmware_download
    ?? overview.claims.filter((claim) => !claim.claimed_by).length;
  const hubFirmwareDownloadedDevices = overview.stats.hub_firmware_downloaded_devices ?? 0;
  const revenueSnapshot = useMemo(() => {
    const activeProCustomers = overview.organizations.filter(
      (organization) => organization.plan === "pro" && organization.account_status !== "suspended",
    ).length;
    const organizationDeviceIds = new Set(
      overview.devices
        .filter((device) => device.organization_id)
        .map((device) => device.device_id),
    );
    const homeownerCustomers = new Set(
      overview.claims
        .filter((claim) => claim.claimed_by && !organizationDeviceIds.has(claim.device_id))
        .map((claim) => claim.claimed_by),
    ).size;
    const estimatedMonthlyRevenue = activeProCustomers * PRO_MONTHLY_PRICE + homeownerCustomers * HOME_MONTHLY_PRICE;
    const averageRevenuePerDevice = overview.stats.total_devices > 0
      ? estimatedMonthlyRevenue / overview.stats.total_devices
      : 0;

    return {
      activeProCustomers,
      homeownerCustomers,
      estimatedMonthlyRevenue,
      averageRevenuePerDevice,
    };
  }, [overview.claims, overview.devices, overview.organizations, overview.stats.total_devices]);

  useEffect(() => {
    if (!organizationId && overview.organizations[0]?.id) {
      setOrganizationId(overview.organizations[0].id);
    }
  }, [organizationId, overview.organizations]);

  useEffect(() => {
    if (!selectedOrganizationId && overview.organizations[0]?.id) {
      setSelectedOrganizationId(overview.organizations[0].id);
    }
    if (selectedOrganizationId && !overview.organizations.some((organization) => organization.id === selectedOrganizationId)) {
      setSelectedOrganizationId(overview.organizations[0]?.id ?? "");
    }
  }, [overview.organizations, selectedOrganizationId]);

  useEffect(() => {
    if (!targetDeviceId && unassignedDevices[0]?.device_id) {
      setTargetDeviceId(unassignedDevices[0].device_id);
    }
  }, [targetDeviceId, unassignedDevices]);

  useEffect(() => {
    if (activeSection === "firmware") return;
    scrollToWorkflowSection(activeSection);
  }, [activeSection]);

  useEffect(() => {
    void loadFirmwareTemplates();
  }, []);

  useEffect(() => {
    const template = firmwareTemplates.find((item) => item.target === firmwareTarget);
    setFirmwareVersion(template?.version ?? "");
    setFirmwareCode(template?.code ?? "");
    setFirmwareMessage("");
    setFirmwareError("");
  }, [firmwareTarget, firmwareTemplates]);

  async function loadFirmwareTemplates() {
    setFirmwareLoading(true);
    setFirmwareError("");

    try {
      const templates = await fetchWorkflowFirmwareTemplates();
      setFirmwareTemplates(templates);
    } catch (err) {
      setFirmwareError(err instanceof Error ? err.message : "Unable to load firmware templates");
    } finally {
      setFirmwareLoading(false);
    }
  }

  function scrollToWorkflowSection(section: AdminSection) {
    const targetId = workflowSectionTargets[section];
    if (!targetId) return;
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function showWorkflowSection(section: AdminSection) {
    setActiveSection(section);
    if (section !== "firmware") {
      scrollToWorkflowSection(section);
    }
  }

  function generateDeviceFields() {
    const nextNumber = nextDeviceNumber(overview);
    const padded = String(nextNumber).padStart(6, "0");
    setDeviceSerial(`WF-POOL-${padded}`);
    setNewDeviceId(`pool-hub-${padded}`);
    setNewDeviceSecret(randomToken(18));
    setNewClaimCode(randomClaimCode());
    setNewDeviceName("Pool Hub");
    setRegisterDeviceError("");
    setRegisteredDevice(null);
  }

  async function handleCreateProAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateMessage("");
    setCreateError("");

    try {
      const result = await createWorkflowProAccount({
        company_name: companyName,
        owner_email: ownerEmail,
        company_phone: companyPhone,
        plan,
      });

      setCreateMessage(`${result.organization.name} was created for ${result.organization.company_email}.`);
      setCompanyName("");
      setOwnerEmail("");
      setCompanyPhone("");
      setPlan("pro");
      await onRefresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unable to create Pro account");
    } finally {
      setCreating(false);
    }
  }

  async function handleAssignDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAssigning(true);
    setAssignMessage("");
    setAssignError("");

    try {
      const result = await assignWorkflowDeviceToOrganization({
        organization_id: organizationId,
        device_id: targetDeviceId,
        property_name: propertyName,
      });

      setAssignMessage(`${result.device.device_id} was assigned to ${result.organization.name}.`);
      setPropertyName("");
      await onRefresh();
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Unable to assign device");
    } finally {
      setAssigning(false);
    }
  }

  async function handleRegisterDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegisteringDevice(true);
    setRegisterDeviceError("");
    setRegisteredDevice(null);

    try {
      const result = await registerWorkflowDevice({
        serial_number: deviceSerial,
        device_id: newDeviceId,
        device_secret: newDeviceSecret,
        claim_code: newClaimCode,
        name: newDeviceName,
      });

      setRegisteredDevice(result);
      await onRefresh();
    } catch (err) {
      setRegisterDeviceError(err instanceof Error ? err.message : "Unable to register device");
    } finally {
      setRegisteringDevice(false);
    }
  }

  async function copyRegisteredFirmware() {
    if (!registeredDevice) return;
    try {
      await navigator.clipboard.writeText(firmwareSnippet(registeredDevice));
    } catch {
      // Clipboard may be blocked in some browser modes. The code remains visible.
    }
  }

  async function downloadRegisteredHubCode() {
    if (!registeredDevice) return;
    const fileName = hubFirmwareFileName(registeredDevice);
    const code = generateHubFirmware(registeredDevice, latestHubTemplate?.code);
    downloadTextFile(fileName, code);

    try {
      await recordWorkflowFirmwareDownload({
        device_id: registeredDevice.firmware.device_id,
        serial_number: registeredDevice.firmware.serial_number,
        target: "hub",
        template_version: latestHubTemplate?.version ?? "bundled fallback",
        code,
        file_name: fileName,
      });
      await loadDownloadHistory();
      await onRefresh();
    } catch (err) {
      console.warn("Hub firmware downloaded, but download audit failed", err);
    }
  }

  async function downloadRegisteredNodeCode() {
    if (!registeredDevice || !latestNodeTemplate?.code) return;

    const fileName = nodeFirmwareFileName(registeredDevice);
    const code = generateNodeFirmware(registeredDevice, latestNodeTemplate.code);
    downloadTextFile(fileName, code);

    try {
      await recordWorkflowFirmwareDownload({
        device_id: registeredDevice.firmware.device_id,
        serial_number: registeredDevice.firmware.serial_number,
        target: "node",
        template_version: latestNodeTemplate.version,
        code,
        file_name: fileName,
      });
      await loadDownloadHistory();
      await onRefresh();
    } catch (err) {
      console.warn("Node firmware downloaded, but download audit failed", err);
    }
  }

  async function handleSaveFirmwareTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFirmwareSaving(true);
    setFirmwareMessage("");
    setFirmwareError("");

    try {
      const result = await saveWorkflowFirmwareTemplate({
        target: firmwareTarget,
        version: firmwareVersion,
        code: firmwareCode,
      });

      setFirmwareMessage(result.message);
      await loadFirmwareTemplates();
    } catch (err) {
      setFirmwareError(err instanceof Error ? err.message : "Unable to save firmware template");
    } finally {
      setFirmwareSaving(false);
    }
  }

  async function handleOrganizationStatus(organization: WorkflowAdminOrganization) {
    const currentlySuspended = organization.account_status === "suspended";
    const nextStatus = currentlySuspended ? "active" : "suspended";

    if (!currentlySuspended) {
      const ok = window.confirm(`Suspend ${organization.name}? Their Pro dashboard access will be blocked, but devices will keep running locally.`);
      if (!ok) return;
    }

    setOrganizationActionBusy(organization.id);
    setOrganizationActionMessage("");
    setOrganizationActionError("");

    try {
      const result = await updateWorkflowOrganizationStatus(organization.id, nextStatus);
      setOrganizationActionMessage(result.message);
      await onRefresh();
    } catch (err) {
      setOrganizationActionError(err instanceof Error ? err.message : "Unable to update Pro account");
    } finally {
      setOrganizationActionBusy("");
    }
  }

  async function handleDeleteOrganization(organization: WorkflowAdminOrganization) {
    const confirmName = window.prompt(`Type "${organization.name}" to permanently delete this Pro account. Devices will be unassigned, not erased.`);
    if (confirmName === null) return;

    setOrganizationActionBusy(organization.id);
    setOrganizationActionMessage("");
    setOrganizationActionError("");

    try {
      const result = await deleteWorkflowOrganization(organization.id, confirmName);
      setOrganizationActionMessage(result.message);
      setSelectedOrganizationId("");
      await onRefresh();
    } catch (err) {
      setOrganizationActionError(err instanceof Error ? err.message : "Unable to delete Pro account");
    } finally {
      setOrganizationActionBusy("");
    }
  }

  return (
    <div className="workflow-admin-shell">
      <aside className="workflow-admin-sidebar">
        <div className="workflow-admin-brand">
          <div className="workflow-admin-mark">
            <ShieldCheck size={20} />
          </div>
          <div>
            <strong>Workflow Admin</strong>
            <span>Internal owner dashboard</span>
          </div>
        </div>

        <nav className="workflow-admin-nav" aria-label="Workflow admin sections">
          <button
            type="button"
            className={activeSection === "overview" ? "active" : ""}
            onClick={() => showWorkflowSection("overview")}
          >
            <Building2 size={17} />
            Overview
          </button>

          <span className="workflow-admin-nav-group">Business</span>
          <button
            type="button"
            className={activeSection === "revenue" ? "active" : ""}
            onClick={() => showWorkflowSection("revenue")}
          >
            <DollarSign size={17} />
            Revenue
          </button>
          <button
            type="button"
            className={activeSection === "errors" ? "active" : ""}
            onClick={() => showWorkflowSection("errors")}
          >
            <Ban size={17} />
            Errors
          </button>

          <span className="workflow-admin-nav-group">Pro Accounts</span>
          <button
            type="button"
            className={activeSection === "createProAccount" ? "active" : ""}
            onClick={() => showWorkflowSection("createProAccount")}
          >
            <Plus size={17} />
            Create Pro
          </button>
          <button
            type="button"
            className={activeSection === "proCompanies" ? "active" : ""}
            onClick={() => showWorkflowSection("proCompanies")}
          >
            <UserRoundPlus size={17} />
            Pro Companies
          </button>
          <button
            type="button"
            className={activeSection === "assignDevice" ? "active" : ""}
            onClick={() => showWorkflowSection("assignDevice")}
          >
            <Link2 size={17} />
            Assign Device
          </button>

          <span className="workflow-admin-nav-group">Hardware</span>
          <button
            type="button"
            className={activeSection === "registerDevice" ? "active" : ""}
            onClick={() => showWorkflowSection("registerDevice")}
          >
            <KeyRound size={17} />
            Register Device
          </button>
          <button
            type="button"
            className={activeSection === "devices" ? "active" : ""}
            onClick={() => showWorkflowSection("devices")}
          >
            <Database size={17} />
            Devices
          </button>
          <button
            type="button"
            className={activeSection === "claims" ? "active" : ""}
            onClick={() => showWorkflowSection("claims")}
          >
            <ShieldCheck size={17} />
            Claim Records
          </button>
          <button
            type="button"
            className={activeSection === "firmware" ? "active" : ""}
            onClick={() => showWorkflowSection("firmware")}
          >
            <FileCode2 size={17} />
            Firmware
          </button>

          <span className="workflow-admin-nav-group">Live Testing</span>
          <button
            type="button"
            className={activeSection === "testDashboard" ? "active" : ""}
            onClick={() => showWorkflowSection("testDashboard")}
          >
            <Wifi size={17} />
            Test Dashboard
          </button>
          <button
            type="button"
            className={activeSection === "testProDashboard" ? "active" : ""}
            onClick={() => showWorkflowSection("testProDashboard")}
          >
            <Building2 size={17} />
            Test Pro Dashboard
          </button>
        </nav>

        <div className="workflow-admin-identity">
          <span>Signed in as</span>
          <strong>{overview.admin_email}</strong>
        </div>

        <button type="button" className="workflow-admin-signout" onClick={onSignOut}>
          <LogOut size={17} />
          Sign out
        </button>
      </aside>

      <main className="workflow-admin-main">
        <header className="workflow-admin-header">
          <div>
            <span>{activeSection === "firmware" ? "Firmware library" : "Company owner console"}</span>
            <h1>{workflowHeaderTitle(activeSection)}</h1>
          </div>
          <button
            type="button"
            onClick={() => activeSection === "firmware" ? void loadFirmwareTemplates() : void onRefresh()}
          >
            <RefreshCw size={18} />
            Refresh
          </button>
        </header>

        {activeSection === "testDashboard" ? (
          <section className="workflow-section" id="workflow-test-dashboard">
            <div className="workflow-section-heading">
              <h2>Live device test</h2>
              <p>Use the real homeowner dashboard against your actual pool hub. Commands send and live data updates in real time.</p>
            </div>
            {testUserId ? (
              <div className="workflow-test-dashboard-frame">
                <DashboardPage
                  device={testDevice ?? null}
                  userId={testUserId}
                  loading={Boolean(testLoading)}
                  error={testError ?? ""}
                  onRefresh={onTestRefresh ?? (() => {})}
                  onCommandSettled={onTestCommandSettled ?? (() => {})}
                />
              </div>
            ) : (
              <div className="workflow-empty-state">
                No device available. Make sure a hub is registered and online.
              </div>
            )}
          </section>
        ) : null}

        {activeSection === "testProDashboard" ? (() => {
          const activeOrgId = testProOrgId || overview.organizations[0]?.id || "";
          const activeOrg = overview.organizations.find((o) => o.id === activeOrgId) ?? null;
          const orgDevices = activeOrg ? overview.devices.filter((d) => d.organization_id === activeOrg.id) : [];
          const orgMembers = activeOrg ? overview.members.filter((m) => m.organization_id === activeOrg.id) : [];
          const orgInvites = activeOrg ? overview.invites.filter((i) => i.organization_id === activeOrg.id) : [];
          const adminMembership: OrganizationMember = {
            organization_id: activeOrg?.id ?? "",
            user_id: testUserId ?? "admin",
            role: "owner",
            display_name: "Workflow Admin",
            email: overview.admin_email,
            created_at: new Date().toISOString(),
          };
          return (
            <section className="workflow-section" id="workflow-test-pro-dashboard">
              <div className="workflow-section-heading">
                <h2>Live Pro dashboard test</h2>
                <p>Walk through every Pro feature with real data — fleet view, properties, schedules, members. Drill into any property to open the live homeowner dashboard with that device's real-time data.</p>
              </div>

              {overview.organizations.length === 0 ? (
                <div className="workflow-empty-state">
                  No Pro organizations exist yet. Create one in <strong>Create Pro</strong> first.
                </div>
              ) : (
                <>
                  <div className="workflow-test-org-picker">
                    <label>
                      <span>Select an organization</span>
                      <select
                        value={activeOrgId}
                        onChange={(event) => setTestProOrgId(event.target.value)}
                      >
                        {overview.organizations.map((org) => (
                          <option key={org.id} value={org.id}>
                            {org.name} · {org.plan} · {org.device_count} device{org.device_count === 1 ? "" : "s"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <small>You're viewing this dashboard as the company owner. Device commands run live on the hub.</small>
                  </div>

                  {activeOrg ? (
                    <div className="workflow-test-dashboard-frame">
                      <ProDashboardPage
                        organization={activeOrg}
                        membership={adminMembership}
                        devices={orgDevices as unknown as PoolDevice[]}
                        members={orgMembers}
                        invites={orgInvites}
                        scheduleOverrides={[]}
                        onSignOut={onSignOut}
                        onOpenDevice={(deviceId) => {
                          showWorkflowSection("testDashboard");
                          // The Test Dashboard uses the admin's own selected hub; deep-link awareness can be added later
                          console.info("[admin test] open device", deviceId);
                        }}
                        onOrganizationUpdated={() => void onRefresh()}
                        onPropertyUpdated={() => void onRefresh()}
                        onScheduleOverrideSaved={() => {}}
                        onScheduleOverrideCancelled={() => {}}
                        onInviteCreated={() => void onRefresh()}
                        onMemberRemoved={() => void onRefresh()}
                        onInviteCancelled={() => void onRefresh()}
                      />
                    </div>
                  ) : null}
                </>
              )}
            </section>
          );
        })() : null}

        {activeSection === "revenue" ? (
          <section className="workflow-section" id="workflow-revenue">
            <div className="workflow-section-heading">
              <h2>Revenue & subscriptions</h2>
              <p>Live data pulled from Stripe. Use this to track MRR, payouts, and recent activity.</p>
            </div>

            {revenueLoading && !revenue ? (
              <div className="workflow-empty-state">Loading Stripe data…</div>
            ) : null}
            {revenueError ? <div className="error-box">{revenueError}</div> : null}

            {revenue ? (
              <>
                <div className="workflow-revenue-hero">
                  <article className="workflow-revenue-hero-card mrr">
                    <div className="workflow-revenue-hero-icon"><DollarSign size={28} /></div>
                    <span>Monthly Recurring Revenue</span>
                    <strong>{formatCurrency(revenue.mrr_cents / 100)}</strong>
                    <small>Projected from active subscriptions</small>
                  </article>
                  <article className="workflow-revenue-hero-card members">
                    <div className="workflow-revenue-hero-icon"><UserRoundPlus size={28} /></div>
                    <span>Active Memberships</span>
                    <strong>{revenue.active_subscriptions}</strong>
                    <small>{revenue.active_subscriptions === 1 ? "Paying customer" : "Paying customers"}</small>
                  </article>
                </div>

                <div className="workflow-revenue-grid">
                  <article className="workflow-revenue-card green">
                    <div className="workflow-revenue-card-icon"><DollarSign size={18} /></div>
                    <span>This month gross</span>
                    <strong>{formatCurrency(revenue.current_month.gross_revenue_cents / 100)}</strong>
                    <small>{revenue.current_month.charges_count} charge{revenue.current_month.charges_count === 1 ? "" : "s"}</small>
                  </article>
                  <article className="workflow-revenue-card teal">
                    <div className="workflow-revenue-card-icon"><CheckCircle2 size={18} /></div>
                    <span>Net this month</span>
                    <strong>{formatCurrency(revenue.current_month.net_revenue_cents / 100)}</strong>
                    <small>After Stripe fees</small>
                  </article>
                  <article className="workflow-revenue-card orange">
                    <div className="workflow-revenue-card-icon"><Ban size={18} /></div>
                    <span>Stripe fees</span>
                    <strong>{formatCurrency(revenue.current_month.stripe_fees_cents / 100)}</strong>
                    <small>Processing this month</small>
                  </article>
                  <article className="workflow-revenue-card red">
                    <div className="workflow-revenue-card-icon"><RotateCcw size={18} /></div>
                    <span>Refunds</span>
                    <strong>{formatCurrency(revenue.current_month.refunds_cents / 100)}</strong>
                    <small>This month</small>
                  </article>
                  <article className="workflow-revenue-card blue">
                    <div className="workflow-revenue-card-icon"><Download size={18} /></div>
                    <span>Available for payout</span>
                    <strong>{formatCurrency(revenue.balance.available_cents / 100)}</strong>
                    <small>{revenue.balance.currency.toUpperCase()} ready to bank</small>
                  </article>
                  <article className="workflow-revenue-card purple">
                    <div className="workflow-revenue-card-icon"><RefreshCw size={18} /></div>
                    <span>Pending in Stripe</span>
                    <strong>{formatCurrency(revenue.balance.pending_cents / 100)}</strong>
                    <small>Settling now</small>
                  </article>
                </div>

                {Object.keys(revenue.plans_count).length > 0 ? (
                  <div className="workflow-revenue-plans">
                    <h3>Active memberships by plan</h3>
                    <div className="workflow-revenue-plan-list">
                      {(() => {
                        const total = Object.values(revenue.plans_count).reduce((s, n) => s + n, 0);
                        const colors = ["#2eb6e8", "#7c5ce8", "#22c55e", "#f59e0b", "#ef4444"];
                        return Object.entries(revenue.plans_count).map(([plan, count], i) => {
                          const pct = total > 0 ? (count / total) * 100 : 0;
                          return (
                            <div key={plan} className="workflow-revenue-plan-row">
                              <div className="workflow-revenue-plan-info">
                                <strong>{plan}</strong>
                                <span>{count} member{count === 1 ? "" : "s"} · {pct.toFixed(0)}%</span>
                              </div>
                              <div className="workflow-revenue-plan-bar">
                                <div
                                  className="workflow-revenue-plan-bar-fill"
                                  style={{ width: `${pct}%`, background: colors[i % colors.length] }}
                                />
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                ) : null}

                {revenue.monthly_revenue.length > 0 ? (
                  <div className="workflow-revenue-trend">
                    <h3>Monthly revenue (last 6 months)</h3>
                    <div className="workflow-revenue-bars">
                      {(() => {
                        const max = Math.max(...revenue.monthly_revenue.map((m) => m.amount_cents), 1);
                        return revenue.monthly_revenue.map((m) => (
                          <div key={m.month} className="workflow-revenue-bar">
                            <span className="workflow-revenue-bar-amount">{formatCurrency(m.amount_cents / 100)}</span>
                            <div className="workflow-revenue-bar-fill" style={{ height: `${Math.max((m.amount_cents / max) * 100, 2)}%` }} />
                            <span className="workflow-revenue-bar-label">{m.month.slice(5)}</span>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                ) : null}

                <div className="workflow-revenue-table-wrap">
                  <h3>Recent charges</h3>
                  {revenue.recent_charges.length === 0 ? (
                    <p className="workflow-empty">No recent charges this month.</p>
                  ) : (
                    <table className="workflow-revenue-table">
                      <thead>
                        <tr><th>Date</th><th>Email</th><th>Amount</th><th>Status</th></tr>
                      </thead>
                      <tbody>
                        {revenue.recent_charges.map((c) => (
                          <tr key={c.id}>
                            <td>{formatShortDateTime(new Date(c.created * 1000).toISOString())}</td>
                            <td>{c.customer_email ?? "—"}</td>
                            <td>{formatCurrency(c.amount_cents / 100)}</td>
                            <td>{c.refunded ? "Refunded" : c.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="workflow-revenue-table-wrap">
                  <h3>Recent payouts to your bank</h3>
                  {revenue.recent_payouts.length === 0 ? (
                    <p className="workflow-empty">No payouts yet.</p>
                  ) : (
                    <table className="workflow-revenue-table">
                      <thead>
                        <tr><th>Arrival</th><th>Amount</th><th>Status</th></tr>
                      </thead>
                      <tbody>
                        {revenue.recent_payouts.map((p) => (
                          <tr key={p.id}>
                            <td>{formatShortDateTime(new Date(p.arrival_date * 1000).toISOString())}</td>
                            <td>{formatCurrency(p.amount_cents / 100)}</td>
                            <td>{p.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        {activeSection === "errors" ? (
          <section className="workflow-section" id="workflow-errors">
            <div className="workflow-section-heading">
              <h2>Live errors</h2>
              <p>Unresolved issues from your apps (last 14 days). Pulled live from Sentry.</p>
            </div>

            {sentryLoading && !sentryData ? (
              <div className="workflow-empty-state">Loading Sentry data…</div>
            ) : null}
            {sentryError ? <div className="error-box">{sentryError}</div> : null}

            {sentryData ? (
              <>
                <div className="workflow-revenue-grid">
                  <article className="workflow-revenue-card red">
                    <div className="workflow-revenue-card-icon"><Ban size={18} /></div>
                    <span>Critical issues</span>
                    <strong>{sentryData.stats.critical}</strong>
                    <small>Fatal + error level</small>
                  </article>
                  <article className="workflow-revenue-card orange">
                    <div className="workflow-revenue-card-icon"><ShieldCheck size={18} /></div>
                    <span>Warnings</span>
                    <strong>{sentryData.stats.warnings}</strong>
                    <small>Less severe</small>
                  </article>
                  <article className="workflow-revenue-card purple">
                    <div className="workflow-revenue-card-icon"><Database size={18} /></div>
                    <span>Total events</span>
                    <strong>{sentryData.stats.total_events.toLocaleString()}</strong>
                    <small>Across all issues</small>
                  </article>
                  <article className="workflow-revenue-card blue">
                    <div className="workflow-revenue-card-icon"><UserRoundPlus size={18} /></div>
                    <span>Affected users</span>
                    <strong>{sentryData.stats.affected_users.toLocaleString()}</strong>
                    <small>Unique users hit</small>
                  </article>
                </div>

                <div className="workflow-revenue-table-wrap">
                  <h3>Recent unresolved issues</h3>
                  {sentryData.issues.length === 0 ? (
                    <p className="workflow-empty">No unresolved issues. Everything's running clean.</p>
                  ) : (
                    <div className="workflow-sentry-issue-list">
                      {sentryData.issues.map((issue) => (
                        <article key={issue.id} className={`workflow-sentry-issue level-${issue.level}`}>
                          <div className="workflow-sentry-issue-main">
                            <div className="workflow-sentry-issue-header">
                              <span className={`workflow-sentry-level level-${issue.level}`}>{issue.level}</span>
                              <span className="workflow-sentry-project">{issue.project}</span>
                              <span className="workflow-sentry-when">Last seen {formatShortDateTime(issue.last_seen)}</span>
                            </div>
                            <h4>{issue.title}</h4>
                            {issue.culprit ? <p className="workflow-sentry-culprit">{issue.culprit}</p> : null}
                            <div className="workflow-sentry-stats">
                              <span><strong>{issue.count.toLocaleString()}</strong> event{issue.count === 1 ? "" : "s"}</span>
                              <span><strong>{issue.user_count.toLocaleString()}</strong> user{issue.user_count === 1 ? "" : "s"}</span>
                              <span>First seen {formatShortDateTime(issue.first_seen)}</span>
                            </div>
                          </div>
                          <div className="workflow-sentry-issue-actions">
                            <a href={issue.permalink} target="_blank" rel="noreferrer" className="workflow-sentry-link">
                              View in Sentry
                            </a>
                            <button
                              type="button"
                              className="workflow-sentry-resolve"
                              disabled={resolvingIssueId === issue.id}
                              onClick={() => handleResolveSentry(issue.id, issue.project)}
                            >
                              {resolvingIssueId === issue.id ? "Resolving…" : "Resolve"}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        {activeSection !== "firmware" && activeSection !== "testDashboard" && activeSection !== "testProDashboard" && activeSection !== "revenue" && activeSection !== "errors" ? (
          <>
        {activeSection === "overview" ? (
        <>
          <section className="workflow-overview-dashboard" id="workflow-overview">
            <article className="workflow-overview-hero">
              <div>
                <span>Company snapshot</span>
                <h2>{overview.stats.online_devices} of {overview.stats.total_devices} hubs online</h2>
                <p>
                  {overview.stats.total_organizations} Pro companies, {overview.stats.unassigned_devices} unassigned hubs,
                  and {overview.stats.unclaimed_devices} hubs waiting to be claimed.
                </p>
              </div>
              <div className="workflow-overview-hero-metrics">
                <span><strong>{overview.stats.total_organizations}</strong> Pro companies</span>
                <span><strong>{overview.stats.total_devices}</strong> Total devices</span>
                <span><strong>{overview.stats.pending_invites}</strong> Pending invites</span>
              </div>
            </article>

            <div className="workflow-overview-bands">
              {overviewBand("Online hubs", overview.stats.online_devices, "Seen in the last 2 minutes", <Wifi size={21} />, "online")}
              {overviewBand("Unclaimed hubs", overview.stats.unclaimed_devices, `${overview.stats.pending_invites} pending invites`, <UserRoundPlus size={21} />, overview.stats.unclaimed_devices > 0 ? "attention" : "")}
              {overviewBand("Unassigned devices", overview.stats.unassigned_devices, "Registered but not linked to a company", <Database size={21} />, overview.stats.unassigned_devices > 0 ? "attention" : "")}
            </div>
          </section>

          <section className="workflow-overview-lanes">
            <article className="workflow-overview-lane">
              <div className="workflow-overview-heading">
                <span>Manufacturing / Inventory</span>
                <h2>Hardware readiness</h2>
              </div>
              <div className="workflow-overview-bands compact">
                {overviewBand("Ready-to-claim devices", readyToClaimDevices, "Registered and waiting for customer setup", <KeyRound size={20} />, "online")}
                {overviewBand("Missing firmware download", devicesMissingFirmwareDownload, `${hubFirmwareDownloadedDevices} hub downloads recorded`, <Download size={20} />, devicesMissingFirmwareDownload > 0 ? "attention" : "online")}
                {overviewBand("Latest hub firmware", latestHubTemplate?.version || "Not saved", latestHubTemplate ? `Updated ${formatShortDateTime(latestHubTemplate.updated_at)}` : "Paste latest hub code", <FileCode2 size={20} />, latestHubTemplate ? "online" : "attention")}
                {overviewBand("Latest node firmware", latestNodeTemplate?.version || "Not saved", latestNodeTemplate ? `Updated ${formatShortDateTime(latestNodeTemplate.updated_at)}` : "Paste latest node code", <Settings size={20} />, latestNodeTemplate ? "online" : "attention")}
              </div>
            </article>

            <article className="workflow-overview-lane revenue">
              <div className="workflow-overview-heading">
                <span>Revenue Snapshot</span>
                <h2>Monthly subscription view</h2>
              </div>
              <div className="workflow-overview-bands compact">
                {overviewBand("Estimated monthly revenue", formatCurrency(revenueSnapshot.estimatedMonthlyRevenue), "Home $9 + Pro $19; enterprise excluded", <DollarSign size={20} />, "online")}
                {overviewBand("Pro customers", revenueSnapshot.activeProCustomers, `${overview.stats.suspended_organizations} suspended`, <Building2 size={20} />)}
                {overviewBand("Homeowner customers", revenueSnapshot.homeownerCustomers, "Claimed devices outside Pro accounts", <UserRoundPlus size={20} />)}
                {overviewBand("Average per device", formatCurrency(revenueSnapshot.averageRevenuePerDevice), `${overview.stats.total_devices} registered devices`, <Database size={20} />)}
              </div>
            </article>
          </section>
        </>
        ) : null}

        {["registerDevice", "createProAccount", "assignDevice"].includes(activeSection) ? (
        <section className="workflow-admin-grid workflow-admin-page-grid">
          {activeSection === "registerDevice" ? (
          <form className="workflow-admin-panel workflow-scroll-target" id="workflow-register-device" onSubmit={handleRegisterDevice}>
            <div className="workflow-panel-heading">
              <div>
                <span>Manufacturing</span>
                <h2>Register new device</h2>
              </div>
              <KeyRound size={20} />
            </div>

            <button className="workflow-secondary-button" type="button" onClick={generateDeviceFields}>
              Generate next serial
            </button>

            <div className="workflow-form-row">
              <label>
                Serial number
                <input value={deviceSerial} onChange={(event) => setDeviceSerial(event.target.value.toUpperCase())} placeholder="WF-POOL-000010" required />
              </label>
              <label>
                Device ID
                <input value={newDeviceId} onChange={(event) => setNewDeviceId(event.target.value)} placeholder="pool-hub-000010" required />
              </label>
            </div>

            <label>
              Device secret
              <input value={newDeviceSecret} onChange={(event) => setNewDeviceSecret(event.target.value)} placeholder="Generate or type a strong secret" required />
            </label>

            <div className="workflow-form-row">
              <label>
                Setup code
                <input value={newClaimCode} onChange={(event) => setNewClaimCode(event.target.value)} placeholder="Optional, like 123456" />
              </label>
              <label>
                Default name
                <input value={newDeviceName} onChange={(event) => setNewDeviceName(event.target.value)} placeholder="Pool Hub" />
              </label>
            </div>

            {registeredDevice ? (
              <div className="workflow-firmware-box">
                <div>
                  <strong>Firmware values</strong>
                  <span className="workflow-firmware-actions">
                    <button type="button" onClick={() => void copyRegisteredFirmware()}>
                      <Copy size={14} />
                      Copy
                    </button>
                    <button type="button" onClick={() => void downloadRegisteredHubCode()}>
                      <Download size={14} />
                      Hub code
                    </button>
                    <button
                      type="button"
                      disabled={!latestNodeTemplate?.code}
                      onClick={() => void downloadRegisteredNodeCode()}
                    >
                      <Download size={14} />
                      Node code
                    </button>
                  </span>
                </div>
                <pre>{firmwareSnippet(registeredDevice)}</pre>
                <small>
                  Download the matched hub and node sketches now. Hub uses {latestHubTemplate ? `saved template ${latestHubTemplate.version}` : "bundled fallback template"}.
                  Node uses {latestNodeTemplate ? `saved template ${latestNodeTemplate.version}` : "the node template after you save it in Firmware"}.
                </small>
              </div>
            ) : null}

            {registerDeviceError && <div className="workflow-admin-message error">{registerDeviceError}</div>}

            <button type="submit" disabled={registeringDevice}>
              {registeringDevice ? "Registering..." : "Register device"}
            </button>
          </form>
          ) : null}

          {activeSection === "registerDevice" ? (
            <section className="workflow-admin-panel workflow-download-history" id="workflow-download-history">
              <div className="workflow-panel-heading">
                <div>
                  <span>Audit log</span>
                  <h2>Firmware downloads</h2>
                </div>
                <button
                  type="button"
                  className="workflow-icon-button"
                  onClick={() => void loadDownloadHistory()}
                  disabled={downloadHistoryLoading}
                  aria-label="Refresh downloads"
                >
                  <RefreshCw size={16} />
                </button>
              </div>

              {downloadHistoryError ? (
                <div className="workflow-admin-message error">{downloadHistoryError}</div>
              ) : null}

              {downloadHistoryLoading && downloadHistory.length === 0 ? (
                <p className="workflow-empty">Loading downloads…</p>
              ) : downloadHistory.length === 0 ? (
                <p className="workflow-empty">
                  No firmware downloads yet. Once you register a device and click Download, the audit log shows here.
                </p>
              ) : (
                <table className="workflow-revenue-table">
                  <thead>
                    <tr>
                      <th>Serial</th>
                      <th>Device ID</th>
                      <th>Target</th>
                      <th>Version</th>
                      <th>Downloaded</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {downloadHistory.map((d) => (
                      <tr key={d.id}>
                        <td><strong>{d.serial_number ?? "—"}</strong></td>
                        <td>{d.device_id}</td>
                        <td>
                          <span className={`workflow-target-tag ${d.target}`}>
                            {d.target === "hub" ? "Hub" : "Node"}
                          </span>
                        </td>
                        <td>{d.template_version ?? "—"}</td>
                        <td>{formatShortDateTime(d.downloaded_at)}</td>
                        <td>
                          <button
                            type="button"
                            className="workflow-icon-button"
                            disabled={downloadBusyId === d.id}
                            onClick={() => void reDownloadFirmware(d)}
                            title="Re-download this exact .ino file"
                          >
                            {downloadBusyId === d.id ? "…" : <Download size={14} />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ) : null}

          {activeSection === "createProAccount" ? (
          <form className="workflow-admin-panel workflow-scroll-target" id="workflow-create-pro" onSubmit={handleCreateProAccount}>
            <div className="workflow-panel-heading">
              <div>
                <span>New customer</span>
                <h2>Create Pro account</h2>
              </div>
              <Plus size={20} />
            </div>

            <label>
              Company name
              <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Vacation Homes LLC" />
            </label>

            <label>
              Owner email
              <input
                type="email"
                value={ownerEmail}
                onChange={(event) => setOwnerEmail(event.target.value)}
                placeholder="owner@company.com"
                required
              />
            </label>

            <div className="workflow-form-row">
              <label>
                Phone
                <input value={companyPhone} onChange={(event) => setCompanyPhone(event.target.value)} placeholder="(407) 555-0199" />
              </label>
              <label>
                Plan
                <select value={plan} onChange={(event) => setPlan(event.target.value as "pro" | "enterprise")}>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </label>
            </div>

            {createMessage && (
              <div className="workflow-admin-message success">
                <CheckCircle2 size={16} />
                {createMessage}
              </div>
            )}
            {createError && <div className="workflow-admin-message error">{createError}</div>}

            <button type="submit" disabled={creating}>
              {creating ? "Creating..." : "Create Pro account"}
            </button>
          </form>
          ) : null}

          {activeSection === "assignDevice" ? (
          <form className="workflow-admin-panel workflow-scroll-target" id="workflow-assign-device" onSubmit={handleAssignDevice}>
            <div className="workflow-panel-heading">
              <div>
                <span>Hub setup</span>
                <h2>Assign device to company</h2>
              </div>
              <Link2 size={20} />
            </div>

            <label>
              Company
              <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} required>
                {overview.organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Unassigned device
              <select value={targetDeviceId} onChange={(event) => setTargetDeviceId(event.target.value)} required>
                {unassignedDevices.length === 0 && <option value="">No unassigned devices</option>}
                {unassignedDevices.map((device) => (
                  <option key={device.device_id} value={device.device_id}>
                    {device.serial_number || device.device_id}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Property name
              <input value={propertyName} onChange={(event) => setPropertyName(event.target.value)} placeholder="Main Pool" />
            </label>

            {assignMessage && (
              <div className="workflow-admin-message success">
                <CheckCircle2 size={16} />
                {assignMessage}
              </div>
            )}
            {assignError && <div className="workflow-admin-message error">{assignError}</div>}

            <button type="submit" disabled={assigning || !targetDeviceId || !organizationId}>
              {assigning ? "Assigning..." : "Assign device"}
            </button>
          </form>
          ) : null}
        </section>
        ) : null}

        {["proCompanies", "devices"].includes(activeSection) ? (
        <section className="workflow-admin-columns workflow-admin-wide-grid">
          {activeSection === "proCompanies" ? (
          <div className="workflow-admin-panel workflow-scroll-target" id="workflow-pro-companies">
            <div className="workflow-panel-heading">
              <div>
                <span>Customers</span>
              <h2>Pro companies</h2>
              </div>
            </div>

            {organizationActionMessage && (
              <div className="workflow-admin-message success">
                <CheckCircle2 size={16} />
                {organizationActionMessage}
              </div>
            )}
            {organizationActionError && <div className="workflow-admin-message error">{organizationActionError}</div>}

            <div className="workflow-admin-table">
              {customerOrganizations.map((organization) => {
                const suspended = organization.account_status === "suspended";
                const busy = organizationActionBusy === organization.id;
                return (
                <div className={selectedOrganization?.id === organization.id ? "workflow-admin-row selected" : "workflow-admin-row"} key={organization.id}>
                  <div>
                    <strong>{organization.name}</strong>
                    <span>{organization.company_email || "No owner email set"}</span>
                  </div>
                  <b className={suspended ? "offline" : "online"}>{suspended ? "Suspended" : organization.plan}</b>
                  <span>{organization.device_count} hubs</span>
                  <div className="workflow-admin-actions">
                    <button type="button" onClick={() => setSelectedOrganizationId(organization.id)}>
                      Review
                    </button>
                    <button type="button" disabled={busy} onClick={() => void handleOrganizationStatus(organization)}>
                      {suspended ? <RotateCcw size={14} /> : <Ban size={14} />}
                      {suspended ? "Reactivate" : "Suspend"}
                    </button>
                    <button className="danger" type="button" disabled={busy} onClick={() => void handleDeleteOrganization(organization)}>
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </div>
              )})}
              {customerOrganizations.length === 0 && <p className="workflow-empty">No Pro companies yet.</p>}
            </div>

            {selectedOrganization ? (
              <div className="workflow-admin-detail">
                <div>
                  <span>Selected Pro account</span>
                  <strong>{selectedOrganization.name}</strong>
                  <small>{selectedOrganization.company_email || "No owner email"} · Created {formatDate(selectedOrganization.created_at)}</small>
                </div>
                <div className="workflow-detail-grid">
                  <div><span>Status</span><strong>{selectedOrganization.account_status === "suspended" ? "Suspended" : "Active"}</strong></div>
                  <div><span>Devices</span><strong>{selectedOrganizationDevices.length}</strong></div>
                  <div><span>Members</span><strong>{selectedOrganizationMembers.length}</strong></div>
                  <div><span>Invites</span><strong>{selectedOrganizationInvites.length}</strong></div>
                </div>
                <div className="workflow-detail-list">
                  <strong>Assigned hubs</strong>
                  {selectedOrganizationDevices.slice(0, 4).map((device) => (
                    <span key={device.device_id}>{device.property_name || device.name} · {device.serial_number || device.device_id}</span>
                  ))}
                  {selectedOrganizationDevices.length === 0 ? <span>No hubs assigned yet.</span> : null}
                </div>
              </div>
            ) : null}
          </div>
          ) : null}

          {activeSection === "devices" ? (
          <div className="workflow-admin-panel workflow-scroll-target" id="workflow-recent-devices">
            <div className="workflow-panel-heading">
              <div>
                <span>Hardware</span>
                <h2>Recent devices</h2>
              </div>
            </div>

            <div className="workflow-admin-table">
              {recentDevices.map((device) => {
                const online = device.online_status === "online" && wasSeenRecently(device.last_seen);
                return (
                  <div className="workflow-admin-row" key={device.device_id}>
                    <div>
                      <strong>{device.property_name || device.name || device.device_id}</strong>
                      <span>{device.serial_number || device.device_id}</span>
                    </div>
                    <b className={online ? "online" : "offline"}>{online ? "Online" : "Offline"}</b>
                    <span>{device.organization_name || "Unassigned"}</span>
                    <small>{formatShortDateTime(device.last_seen)}</small>
                  </div>
                );
              })}
              {recentDevices.length === 0 && <p className="workflow-empty">No hubs registered yet.</p>}
            </div>
          </div>
          ) : null}
        </section>
        ) : null}

        {activeSection === "claims" ? (
        <section className="workflow-admin-panel workflow-scroll-target" id="workflow-claims">
          <div className="workflow-panel-heading">
            <div>
              <span>Manufacturing</span>
              <h2>Latest claim records</h2>
            </div>
          </div>

          <div className="workflow-claim-grid">
            {overview.claims.slice(0, 12).map((claim) => (
              <div className="workflow-claim-card" key={claim.id}>
                <strong>{claim.serial_number}</strong>
                <span>{claim.device_id}</span>
                <small>{claim.claimed_by ? `Claimed ${formatDate(claim.claimed_at)}` : "Ready to claim"}</small>
              </div>
            ))}
            {overview.claims.length === 0 && <p className="workflow-empty">No claim records yet.</p>}
          </div>
        </section>
        ) : null}
          </>
        ) : null}

        {activeSection === "firmware" ? (
          <>
            <section className="workflow-stats-grid">
              {statCard(
                "Latest hub code",
                latestHubTemplate?.version || "Not saved",
                latestHubTemplate ? `Updated ${formatShortDateTime(latestHubTemplate.updated_at)}` : "Using bundled fallback",
                <FileCode2 size={24} />,
                latestHubTemplate ? "online" : "attention",
              )}
              {statCard(
                "Latest node code",
                latestNodeTemplate?.version || "Not saved",
                latestNodeTemplate ? `Updated ${formatShortDateTime(latestNodeTemplate.updated_at)}` : "Paste node sketch when ready",
                <Settings size={24} />,
                latestNodeTemplate ? "online" : "attention",
              )}
              {statCard(
                "Hub downloads",
                latestHubTemplate ? "Cloud template" : "Bundled template",
                "New device downloads use this hub code",
                <Download size={24} />,
              )}
              {statCard(
                "Safety",
                "Admin only",
                "Frontend users cannot edit firmware templates",
                <ShieldCheck size={24} />,
              )}
            </section>

            <section className="workflow-admin-grid firmware-grid">
              <form className="workflow-admin-panel workflow-firmware-editor" onSubmit={handleSaveFirmwareTemplate}>
                <div className="workflow-panel-heading">
                  <div>
                    <span>Firmware settings</span>
                    <h2>Paste latest code</h2>
                  </div>
                  <Save size={20} />
                </div>

                <div className="workflow-template-tabs" role="tablist" aria-label="Firmware target">
                  <button
                    type="button"
                    className={firmwareTarget === "hub" ? "active" : ""}
                    onClick={() => setFirmwareTarget("hub")}
                  >
                    Hub code
                  </button>
                  <button
                    type="button"
                    className={firmwareTarget === "node" ? "active" : ""}
                    onClick={() => setFirmwareTarget("node")}
                  >
                    Node code
                  </button>
                </div>

                <label>
                  Version label
                  <input
                    value={firmwareVersion}
                    onChange={(event) => setFirmwareVersion(event.target.value)}
                    placeholder={firmwareTarget === "hub" ? "Hub V6.1 MQTT" : "Node V6.1 LoRa"}
                    required
                  />
                </label>

                <label>
                  Full {firmwareTarget} sketch code
                  <textarea
                    className="workflow-code-textarea"
                    value={firmwareCode}
                    onChange={(event) => setFirmwareCode(event.target.value)}
                    placeholder={`Paste the full latest ${firmwareTarget} Arduino code here`}
                    spellCheck={false}
                    required
                  />
                </label>

                {firmwareMessage && (
                  <div className="workflow-admin-message success">
                    <CheckCircle2 size={16} />
                    {firmwareMessage}
                  </div>
                )}
                {firmwareError && <div className="workflow-admin-message error">{firmwareError}</div>}

                <button type="submit" disabled={firmwareSaving}>
                  {firmwareSaving ? "Saving..." : `Save latest ${firmwareTarget} code`}
                </button>
              </form>

              <div className="workflow-admin-panel workflow-template-summary">
                <div className="workflow-panel-heading">
                  <div>
                    <span>How this works</span>
                    <h2>Code library</h2>
                  </div>
                  <FileCode2 size={20} />
                </div>

                <div className="workflow-template-meta">
                  <strong>Hub template</strong>
                  <span>{latestHubTemplate?.version || "Not saved yet"}</span>
                  <small>
                    When you register a new device, the Hub code download injects the device ID, secret,
                    serial number, setup code, and unique LoRa pair ID into the latest saved hub sketch.
                  </small>
                </div>

                <div className="workflow-template-meta">
                  <strong>Node template</strong>
                  <span>{latestNodeTemplate?.version || "Not saved yet"}</span>
                  <small>
                    Save the latest node sketch here. The Register Device page will generate a matched node
                    sketch with the same PAIR_ID used by that hub.
                  </small>
                </div>

                <div className="workflow-template-meta warning">
                  <strong>Important</strong>
                  <span>Paste full working sketches</span>
                  <small>
                    This stores the latest code for manufacturing. Existing installed hubs do not update automatically;
                    OTA updates would be a separate release system later.
                  </small>
                </div>

                {firmwareLoading ? <p className="workflow-empty">Loading firmware templates...</p> : null}
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
