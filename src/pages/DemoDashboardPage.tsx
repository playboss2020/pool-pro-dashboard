import { AlertTriangle, BarChart3, CalendarDays, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { PoolShell } from "../components/PoolShell";
import {
  demoDevices,
  demoHomeDevice,
  demoInvites,
  demoMembers,
  demoMembership,
  demoOrganization,
  demoScheduleOverrides,
} from "../lib/demoData";
import type { DeviceScheduleOverride, Organization, OrganizationInvite, OrganizationMember, PoolDevice } from "../lib/deviceApi";
import { DashboardPage } from "./DashboardPage";
import { ProDashboardPage } from "./ProDashboardPage";

type DemoTab = "dashboard" | "schedules" | "analytics" | "alerts" | "settings";

function selectedDemoDevice() {
  const params = new URLSearchParams(window.location.search);
  const requestedDeviceId = params.get("device") ?? "";
  return demoDevices.find((device) => device.device_id === requestedDeviceId) ?? demoHomeDevice;
}

function DemoPanel({
  icon,
  title,
  copy,
  children,
}: {
  icon: ReactNode;
  title: string;
  copy: string;
  children?: ReactNode;
}) {
  return (
    <div className="screen-stack dashboard-shell">
      <div className="demo-mode-banner">
        Demo mode · sample data only.
      </div>
      <section className="demo-mobile-panel">
        <div className="demo-mobile-icon">{icon}</div>
        <h2>{title}</h2>
        <p>{copy}</p>
        {children}
      </section>
    </div>
  );
}

export function DemoHomeownerDashboardPage() {
  const [activeTab, setActiveTab] = useState<DemoTab>("dashboard");
  const [device] = useState<PoolDevice>(() => selectedDemoDevice());

  return (
    <PoolShell activeTab={activeTab} onTabChange={setActiveTab} alertCount={2}>
      {activeTab === "dashboard" ? (
        <DashboardPage
          device={device}
          userId="demo-user"
          loading={false}
          error=""
          onRefresh={() => undefined}
          onCommandSettled={() => undefined}
          demoMode
        />
      ) : null}
      {activeTab === "schedules" ? (
        <DemoPanel
          icon={<CalendarDays size={32} />}
          title="Demo Schedules"
          copy="The real app lets homeowners create pump and heater schedules that sync down to the ESP32 hub and keep running locally."
        >
          <div className="demo-mobile-list">
            <span>Pump · Every day · 8:00 AM to 6:00 PM</span>
            <span>Heater · Fri-Sun · 9:00 AM to 9:30 PM</span>
          </div>
        </DemoPanel>
      ) : null}
      {activeTab === "analytics" ? (
        <DemoPanel
          icon={<BarChart3 size={32} />}
          title="Demo History"
          copy="The real dashboard shows temperature, pump watts, heater watts, kWh, and estimated cost over day, month, and year views."
        >
          <div className="demo-mobile-bars">
            <i style={{ height: "45%" }} />
            <i style={{ height: "72%" }} />
            <i style={{ height: "58%" }} />
            <i style={{ height: "88%" }} />
            <i style={{ height: "64%" }} />
            <i style={{ height: "78%" }} />
          </div>
        </DemoPanel>
      ) : null}
      {activeTab === "alerts" ? (
        <DemoPanel
          icon={<AlertTriangle size={32} />}
          title="Demo Alerts"
          copy="The real app alerts for node lost, weak WiFi, pump expected on with no watts, heater expected on with no watts, and schedule sync issues."
        >
          <div className="demo-mobile-list">
            <span>Weak WiFi · Sunset Retreat</span>
            <span>Node lost · Garden Home</span>
          </div>
        </DemoPanel>
      ) : null}
      {activeTab === "settings" ? (
        <DemoPanel
          icon={<Settings size={32} />}
          title="Demo Settings"
          copy="The real app includes device name, calibration, electricity rate, hub/node health, WiFi information, and remove-device tools."
        >
          <div className="demo-mobile-list">
            <span>Temperature calibration · 0.0°F</span>
            <span>Electricity rate · $0.18/kWh</span>
            <span>WiFi · Workflow Guest WiFi</span>
          </div>
        </DemoPanel>
      ) : null}
    </PoolShell>
  );
}

export function DemoProDashboardPage() {
  const [organization, setOrganization] = useState<Organization>(demoOrganization);
  const [devices, setDevices] = useState<PoolDevice[]>(demoDevices);
  const [members, setMembers] = useState<OrganizationMember[]>(demoMembers);
  const [invites, setInvites] = useState<OrganizationInvite[]>(demoInvites);
  const [scheduleOverrides, setScheduleOverrides] = useState<DeviceScheduleOverride[]>(demoScheduleOverrides);

  return (
    <ProDashboardPage
      organization={organization}
      membership={demoMembership}
      devices={devices}
      members={members}
      invites={invites}
      scheduleOverrides={scheduleOverrides}
      onSignOut={() => {
        window.location.href = "/?demo=home";
      }}
      onOrganizationUpdated={setOrganization}
      onPropertyUpdated={(updatedDevice) => {
        setDevices((current) =>
          current.map((device) => device.device_id === updatedDevice.device_id ? updatedDevice : device),
        );
      }}
      onInviteCreated={(invite) => {
        setInvites((current) => [invite, ...current.filter((item) => item.id !== invite.id)]);
      }}
      onMemberRemoved={(userId) => {
        setMembers((current) => current.filter((member) => member.user_id !== userId));
      }}
      onInviteCancelled={(inviteId) => {
        setInvites((current) => current.filter((invite) => invite.id !== inviteId));
      }}
      onScheduleOverrideSaved={(override) => {
        setScheduleOverrides((current) => [override, ...current.filter((item) => item.id !== override.id)]);
      }}
      onScheduleOverrideCancelled={(overrideId) => {
        setScheduleOverrides((current) => current.filter((override) => override.id !== overrideId));
      }}
      onOpenDevice={(deviceId) => {
        window.location.href = `/?demo=home&device=${encodeURIComponent(deviceId)}`;
      }}
      demoMode
    />
  );
}
