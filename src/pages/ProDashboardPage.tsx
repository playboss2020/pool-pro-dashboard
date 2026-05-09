import { AlertTriangle, Building2, Edit3, Flame, Gauge, MapPin, Radio, Search, Thermometer, X, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { updateDeviceProperty, type DevicePropertyInput, type Organization, type OrganizationMember, type PoolDevice } from "../lib/deviceApi";

type ProDashboardPageProps = {
  organization: Organization;
  membership: OrganizationMember;
  devices: PoolDevice[];
  onOpenDevice: (deviceId: string) => void;
  onPropertyUpdated: (device: PoolDevice) => void;
  onSignOut: () => void;
};

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

export function ProDashboardPage({
  organization,
  membership,
  devices,
  onOpenDevice,
  onPropertyUpdated,
  onSignOut,
}: ProDashboardPageProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "alerts" | "offline" | "heating">("all");
  const [editingDevice, setEditingDevice] = useState<PoolDevice | null>(null);
  const [propertyForm, setPropertyForm] = useState<DevicePropertyInput | null>(null);
  const [savingProperty, setSavingProperty] = useState(false);
  const [propertyError, setPropertyError] = useState("");

  const fleetStats = useMemo(() => {
    const onlineCount = devices.filter((device) => device.online_status === "online" && wasSeenRecently(device.last_seen)).length;
    const nodeLostCount = devices.filter((device) => device.node_online === false).length;
    const heatingCount = devices.filter((device) => device.heater_enabled).length;
    const totalCost = devices.reduce((sum, device) => sum + (estimatedMonthlyCost(device) ?? 0), 0);

    return {
      onlineCount,
      offlineCount: Math.max(0, devices.length - onlineCount),
      nodeLostCount,
      heatingCount,
      totalCost,
    };
  }, [devices]);

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
      return true;
    });
  }, [devices, filter, query]);

  function openPropertyEditor(device: PoolDevice) {
    setEditingDevice(device);
    setPropertyForm(propertyFormFromDevice(device));
    setPropertyError("");
  }

  function updatePropertyForm(key: keyof DevicePropertyInput, value: string) {
    setPropertyForm((current) => current ? { ...current, [key]: value } : current);
  }

  async function saveProperty() {
    if (!editingDevice || !propertyForm) return;

    setSavingProperty(true);
    setPropertyError("");

    try {
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

  return (
    <div className="pro-app-shell">
      <aside className="pro-sidebar">
        <div className="pro-brand">
          <div className="pro-brand-mark">
            <Building2 size={24} />
          </div>
          <div>
            <span>Workflow Pro</span>
            <strong>{organization.name}</strong>
          </div>
        </div>

        <nav className="pro-nav" aria-label="Pro dashboard navigation">
          <button className="active" type="button">
            <Gauge size={18} />
            Fleet
          </button>
          <button type="button">
            <AlertTriangle size={18} />
            Alerts
          </button>
          <button type="button">
            <Zap size={18} />
            Energy
          </button>
        </nav>

        <div className="pro-account-card">
          <span>{membership.role}</span>
          <strong>{organization.plan} plan</strong>
          <button type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </aside>

      <main className="pro-main">
        <header className="pro-header">
          <div>
            <span className="eyebrow">Fleet Overview</span>
            <h1>{organization.name}</h1>
            <p>Monitor every pool controller, find properties quickly, and open the full dashboard for each location.</p>
          </div>
          <div className="pro-search">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by property, address, serial, or device ID"
            />
          </div>
        </header>

        <section className="pro-stats-grid" aria-label="Fleet status">
          <div className="pro-stat-card">
            <span>Online hubs</span>
            <strong>{fleetStats.onlineCount}/{devices.length}</strong>
          </div>
          <div className="pro-stat-card warning">
            <span>Needs attention</span>
            <strong>{fleetStats.offlineCount + fleetStats.nodeLostCount}</strong>
          </div>
          <div className="pro-stat-card heat">
            <span>Heating now</span>
            <strong>{fleetStats.heatingCount}</strong>
          </div>
          <div className="pro-stat-card money">
            <span>Estimated energy</span>
            <strong>{formatMoney(fleetStats.totalCost)}</strong>
          </div>
        </section>

        <section className="pro-toolbar">
          {(["all", "alerts", "offline", "heating"] as const).map((item) => (
            <button
              key={item}
              className={filter === item ? "active" : ""}
              type="button"
              onClick={() => setFilter(item)}
            >
              {item === "all" ? "All properties" : item}
            </button>
          ))}
        </section>

        <section className="pro-device-grid">
          {filteredDevices.map((device) => {
            const online = device.online_status === "online" && wasSeenRecently(device.last_seen);
            const attention = !online || device.node_online === false;
            const heatEta = formatHeatEta(device);
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
                  <span>{device.device_id}</span>
                  <div className="pro-device-actions">
                    <button className="secondary" type="button" onClick={() => openPropertyEditor(device)}>
                      <Edit3 size={15} />
                      Edit
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
      </main>

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
