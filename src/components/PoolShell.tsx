import { BarChart3, Bell, CalendarDays, Gauge, Home, Settings } from "lucide-react";
import type { ReactNode } from "react";
import workflowLogo from "../assets/workflow-pool-logo.png";
import { useTransparentImage } from "../hooks/useTransparentImage";

type Tab = "dashboard" | "schedules" | "analytics" | "alerts" | "settings";

type PoolShellProps = {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  children: ReactNode;
  alertCount?: number;
  onHubSwitcherOpen?: () => void;
  variant?: "phone" | "desktop";
};

const tabs = [
  { id: "dashboard" as const, label: "Dashboard", icon: Gauge },
  { id: "schedules" as const, label: "Schedules", icon: CalendarDays },
  { id: "analytics" as const, label: "History", icon: BarChart3 },
  { id: "settings" as const, label: "Settings", icon: Settings },
];

export function PoolShell({
  activeTab,
  onTabChange,
  children,
  alertCount = 0,
  onHubSwitcherOpen,
  variant = "phone",
}: PoolShellProps) {
  const cleanLogoSrc = useTransparentImage(workflowLogo);
  return (
    <div className={variant === "desktop" ? "app-background desktop-dashboard-background" : "app-background"}>
      <div className={variant === "desktop" ? "phone-frame desktop-dashboard-frame" : "phone-frame"}>
        <header className="app-header">
          <div className="header-left-actions">
            <button
              type="button"
              className="header-bell header-home"
              onClick={onHubSwitcherOpen}
              aria-label="Open hub switcher"
            >
              <Home size={20} />
            </button>
          </div>
          <div className="header-logo-wrap" role="img" aria-label="Workflow Pool Automation">
            <div className="header-logo-fox" style={{ backgroundImage: `url(${cleanLogoSrc})` }} />
            <div className="header-logo-text">
              <span className="header-logo-title">WORKFLOW</span>
              <span className="header-logo-sub">POOL AUTOMATION</span>
            </div>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className={activeTab === "alerts" ? "header-bell active" : "header-bell"}
              onClick={() => onTabChange("alerts")}
              aria-label="Open notifications"
            >
              <Bell size={20} />
              {alertCount > 0 ? <span className="bell-badge">{alertCount > 9 ? "9+" : alertCount}</span> : null}
            </button>
          </div>
        </header>

        <main className="app-content">{children}</main>

        <nav className="bottom-tabs" aria-label="Primary navigation">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={tab.id === activeTab ? "tab-button active" : "tab-button"}
                type="button"
                onClick={() => onTabChange(tab.id)}
              >
                <Icon size={19} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
