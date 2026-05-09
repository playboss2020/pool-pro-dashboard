import { useEffect, useState } from "react";
import { AddDeviceSheet } from "./components/AddDeviceSheet";
import { PoolShell } from "./components/PoolShell";
import { useAuth } from "./hooks/useAuth";
import { useAlerts } from "./hooks/useAlerts";
import { useDevice } from "./hooks/useDevice";
import { useDevices } from "./hooks/useDevices";
import { useProAccount } from "./hooks/useProAccount";
import { HubSwitcherSheet } from "./components/HubSwitcherSheet";
import { AlertsPage } from "./pages/AlertsPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { DashboardPage, NoDeviceDashboard } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { ProDashboardPage } from "./pages/ProDashboardPage";
import { SchedulesPage } from "./pages/SchedulesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { bootstrapProAccount, type PoolDevice } from "./lib/deviceApi";
import { deviceId, selectDeviceId } from "./lib/supabase";
import "./styles.css";

type Tab = "dashboard" | "schedules" | "analytics" | "alerts" | "settings";
const claimSuccessStorageKey = "pool-dashboard-claim-success";
const proDeviceModeStorageKey = "pool-pro-open-device-dashboard";
const proSelfSetupEnabled = import.meta.env.VITE_ENABLE_PRO_SELF_SETUP === "true";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [showHubSwitcher, setShowHubSwitcher] = useState(false);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState("");
  const [proSetupBusy, setProSetupBusy] = useState(false);
  const [proSetupError, setProSetupError] = useState("");
  const [proDevicesOverride, setProDevicesOverride] = useState<PoolDevice[] | null>(null);
  const [showProDeviceDashboard, setShowProDeviceDashboard] = useState(() => {
    try {
      return window.sessionStorage.getItem(proDeviceModeStorageKey) === "true";
    } catch {
      return false;
    }
  });
  const auth = useAuth();
  const proAccount = useProAccount(auth.user?.id);
  const singleDeviceModeEnabled = Boolean(auth.user) && (!proAccount.account || showProDeviceDashboard);
  const { device, loading, error, refresh, refreshBurst } = useDevice(singleDeviceModeEnabled);
  const devices = useDevices(Boolean(auth.user) && !proAccount.account);
  const alerts = useAlerts(singleDeviceModeEnabled);
  const isProAccount = Boolean(proAccount.account);
  const proDevices = proDevicesOverride ?? proAccount.account?.devices ?? [];
  const checkingDevices = Boolean(auth.user) && !isProAccount && devices.loading;
  const hasNoDevices = Boolean(auth.user) && !isProAccount && !devices.loading && devices.devices.length === 0;

  useEffect(() => {
    try {
      const message = window.sessionStorage.getItem(claimSuccessStorageKey);
      if (!message) return;
      window.sessionStorage.removeItem(claimSuccessStorageKey);
      setClaimSuccess(message);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!claimSuccess) return undefined;
    const timeout = window.setTimeout(() => setClaimSuccess(""), 6500);
    return () => window.clearTimeout(timeout);
  }, [claimSuccess]);

  useEffect(() => {
    if (!auth.user || devices.loading || devices.devices.length === 0) return;
    const selectedDeviceExists = devices.devices.some((nextDevice) => nextDevice.device_id === deviceId);
    if (selectedDeviceExists) return;

    selectDeviceId(devices.devices[0].device_id);
    window.location.reload();
  }, [auth.user, devices.devices, devices.loading]);

  function handleDeviceClaimed(nextDeviceId: string) {
    selectDeviceId(nextDeviceId);
    setShowAddDevice(false);
    const message = "Congratulations, your pool hub was added.";
    setClaimSuccess(message);
    try {
      window.sessionStorage.setItem(claimSuccessStorageKey, message);
    } catch {
      // ignore
    }
    window.setTimeout(() => window.location.reload(), 650);
  }

  async function handleEnableProForCurrentAccount() {
    setProSetupBusy(true);
    setProSetupError("");

    try {
      await bootstrapProAccount();
      await proAccount.refresh();
      setShowProDeviceDashboard(false);
    } catch (err) {
      setProSetupError(err instanceof Error ? err.message : "Unable to enable Pro dashboard");
    } finally {
      setProSetupBusy(false);
    }
  }

  useEffect(() => {
    setProDevicesOverride(null);
  }, [proAccount.account?.organization.id]);

  if (!auth.configured) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>Supabase missing</h1>
          <p className="login-copy">Create `.env.local` from `.env.example` and add your anon key.</p>
        </div>
      </div>
    );
  }

  if (auth.loading) {
    return (
      <div className="login-screen">
        <div className="loading-box">Opening Pool Dashboard...</div>
      </div>
    );
  }

  if (!auth.user) {
    return <LoginPage />;
  }

  if (proAccount.loading) {
    return (
      <div className="login-screen">
        <div className="loading-box">Checking account access...</div>
      </div>
    );
  }

  if (proAccount.account && !showProDeviceDashboard) {
    return (
      <ProDashboardPage
        organization={proAccount.account.organization}
        membership={proAccount.account.membership}
        devices={proDevices}
        onSignOut={auth.signOut}
        onPropertyUpdated={(updatedDevice) => {
          setProDevicesOverride((current) => {
            const source = current ?? proAccount.account?.devices ?? [];
            return source.map((device) => device.device_id === updatedDevice.device_id ? updatedDevice : device);
          });
        }}
        onOpenDevice={(nextDeviceId) => {
          selectDeviceId(nextDeviceId);
          try {
            window.sessionStorage.setItem(proDeviceModeStorageKey, "true");
          } catch {
            // ignore
          }
          window.location.reload();
        }}
      />
    );
  }

  return (
    <PoolShell
      variant={proAccount.account ? "desktop" : "phone"}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      alertCount={alerts.activeAlertCount}
      onHubSwitcherOpen={() => {
        if (proAccount.account) {
          try {
            window.sessionStorage.removeItem(proDeviceModeStorageKey);
          } catch {
            // ignore
          }
          setShowProDeviceDashboard(false);
          return;
        }
        setShowHubSwitcher(true);
      }}
    >
      {proAccount.error ? <div className="error-box">{proAccount.error}</div> : null}
      {proSelfSetupEnabled && !proAccount.account ? (
        <div className="pro-self-setup-card">
          <div>
            <strong>Enable Pro dashboard</strong>
            <span>Use this same login as your Pro fleet account.</span>
          </div>
          <button type="button" onClick={() => void handleEnableProForCurrentAccount()} disabled={proSetupBusy}>
            {proSetupBusy ? "Enabling..." : "Make this account Pro"}
          </button>
          {proSetupError ? <small>{proSetupError}</small> : null}
        </div>
      ) : null}
      {claimSuccess ? <div className="success-box app-success-banner">{claimSuccess}</div> : null}
      {activeTab === "dashboard" && checkingDevices ? <div className="loading-box">Checking your hubs...</div> : null}
      {activeTab === "dashboard" && !checkingDevices && hasNoDevices ? (
        <NoDeviceDashboard error={devices.error} onAddDevice={() => setShowAddDevice(true)} />
      ) : null}
      {activeTab === "dashboard" && !checkingDevices && !hasNoDevices ? (
        <DashboardPage
          device={device}
          userId={auth.user.id}
          loading={loading}
          error={error || devices.error}
          onRefresh={refresh}
          onCommandSettled={refreshBurst}
        />
      ) : null}
      {activeTab === "schedules" ? <SchedulesPage userId={auth.user.id} /> : null}
      {activeTab === "analytics" ? <AnalyticsPage device={device} /> : null}
      {activeTab === "alerts" ? <AlertsPage alerts={alerts} /> : null}
      {activeTab === "settings" ? <SettingsPage device={device} userId={auth.user.id} /> : null}
      {showHubSwitcher ? (
        <HubSwitcherSheet
          devices={devices.devices}
          selectedDeviceId={deviceId}
          onClose={() => setShowHubSwitcher(false)}
          onSelectDevice={(nextDeviceId) => {
            if (nextDeviceId === deviceId) return;
            selectDeviceId(nextDeviceId);
            window.location.reload();
          }}
        />
      ) : null}
      {showAddDevice ? <AddDeviceSheet onCancel={() => setShowAddDevice(false)} onClaimed={handleDeviceClaimed} /> : null}
    </PoolShell>
  );
}
