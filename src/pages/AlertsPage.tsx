import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";
import type { DeviceAlert } from "../lib/deviceApi";
import type { UseAlertsResult } from "../hooks/useAlerts";

type AlertsPageProps = {
  alerts: UseAlertsResult;
};

const alertLabels: Record<string, string> = {
  heater_no_watts: "Heater wattage",
  node_offline: "Node offline",
  pump_no_watts: "Pump wattage",
  schedule_sync_failed: "Schedule sync",
  weak_wifi: "Weak WiFi",
  wifi_disconnected: "WiFi reconnect",
};

function alertTitle(alert: DeviceAlert) {
  return alertLabels[alert.alert_type] ?? alert.alert_type.replace(/_/g, " ");
}

function alertTime(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function AlertCard({ alert, onAcknowledge }: { alert: DeviceAlert; onAcknowledge: (alertId: string) => void }) {
  const recovered = Boolean(alert.resolved_at);
  const quiet = recovered || alert.acknowledged;

  return (
    <article className={`alert-card ${alert.severity} ${quiet ? "resolved" : ""}`}>
      {recovered ? <CheckCircle2 size={22} /> : <ShieldAlert size={22} />}
      <div>
        <div className="alert-card-topline">
          <span className="eyebrow">{alertTitle(alert)}</span>
          <span className={`alert-status-pill ${recovered ? "resolved" : alert.acknowledged ? "acknowledged" : "active"}`}>
            {recovered ? "Recovered" : alert.acknowledged ? "Acked" : alert.severity}
          </span>
        </div>
        <h3>{alert.message}</h3>
        <p>
          {alertTime(alert.created_at)}
          {alert.resolved_at ? ` - recovered ${alertTime(alert.resolved_at)}` : ""}
        </p>
      </div>
      {!alert.acknowledged ? (
        <button type="button" onClick={() => onAcknowledge(alert.id)}>
          Ack
        </button>
      ) : null}
    </article>
  );
}

export function AlertsPage({ alerts }: AlertsPageProps) {
  const { alerts: alertRows, loading, error, acknowledge, refresh } = alerts;
  const activeAlerts = alertRows.filter((alert) => !alert.acknowledged && !alert.resolved_at);
  const recentAlerts = alertRows.filter((alert) => alert.acknowledged || alert.resolved_at);

  return (
    <div className="screen-stack">
      <section className="section-heading">
        <div>
          <span className="eyebrow">Safety</span>
          <h2>Alerts</h2>
        </div>
        <button className="icon-button" type="button" onClick={() => void refresh({ quiet: true })} aria-label="Refresh alerts">
          <RefreshCw size={18} />
        </button>
      </section>

      {loading ? <div className="loading-box">Loading alerts...</div> : null}
      {error ? <div className="error-box">{error}</div> : null}

      {activeAlerts.length === 0 && !loading ? (
        <div className="empty-state">
          <CheckCircle2 size={38} />
          <h3>All clear</h3>
          <p>No active alerts for this pool hub.</p>
        </div>
      ) : null}

      {activeAlerts.length > 0 ? (
        <section className="alert-section">
          <div className="alert-section-title">
            <AlertTriangle size={16} />
            <span>{activeAlerts.length === 1 ? "Active alert" : "Active alerts"}</span>
          </div>
          {activeAlerts.map((alert) => (
            <AlertCard alert={alert} key={alert.id} onAcknowledge={acknowledge} />
          ))}
        </section>
      ) : null}

      {recentAlerts.length > 0 ? (
        <section className="alert-section">
          <div className="alert-section-title muted">
            <CheckCircle2 size={16} />
            <span>Recent activity</span>
          </div>
          {recentAlerts.map((alert) => (
            <AlertCard alert={alert} key={alert.id} onAcknowledge={acknowledge} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
