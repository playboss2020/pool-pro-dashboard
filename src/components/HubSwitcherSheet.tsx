import { CheckCircle2, X } from "lucide-react";
import type { PoolDevice } from "../lib/deviceApi";

type HubSwitcherItem = Pick<
  PoolDevice,
  "device_id" | "serial_number" | "name" | "current_temp" | "pump_on" | "heater_enabled" | "online_status" | "last_seen"
> & {
  preview?: boolean;
};

type HubSwitcherSheetProps = {
  devices: PoolDevice[];
  selectedDeviceId: string;
  onClose: () => void;
  onSelectDevice: (deviceId: string) => void;
};

const previewHubs: HubSwitcherItem[] = [
  {
    device_id: "preview-ocean-villa",
    serial_number: "WF-POOL-000124",
    name: "Ocean Villa",
    current_temp: 84,
    pump_on: true,
    heater_enabled: false,
    online_status: "online",
    last_seen: new Date().toISOString(),
    preview: true,
  },
  {
    device_id: "preview-lake-house",
    serial_number: "WF-POOL-000125",
    name: "Lake House",
    current_temp: 78,
    pump_on: false,
    heater_enabled: true,
    online_status: "offline",
    last_seen: null,
    preview: true,
  },
];

function formatValue(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${Number(value).toFixed(suffix === " kWh" ? 2 : 0)}${suffix}`;
}

function wasSeenRecently(lastSeen: string | null | undefined) {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 120000;
}

function hubStatus(device: Pick<PoolDevice, "last_seen" | "online_status">) {
  return device.online_status === "online" && wasSeenRecently(device.last_seen) ? "Online" : "Offline";
}

export function HubSwitcherSheet({ devices, selectedDeviceId, onClose, onSelectDevice }: HubSwitcherSheetProps) {
  const realDevices = devices.length > 0 ? devices : [];
  const showPreview = realDevices.length < 2;

  function renderHubCard(hub: HubSwitcherItem) {
    const selected = hub.device_id === selectedDeviceId && !hub.preview;
    const status = hubStatus(hub);
    return (
      <button
        className={selected ? "hub-switch-card selected" : hub.preview ? "hub-switch-card preview" : "hub-switch-card"}
        type="button"
        key={hub.device_id}
        disabled={hub.preview || selected}
        onClick={() => onSelectDevice(hub.device_id)}
      >
        <div className="hub-switch-main">
          <span className={status === "Online" ? "hub-status-dot online" : "hub-status-dot"} />
          <div>
            <strong>{hub.name || "Pool Hub"}</strong>
            <small>{hub.serial_number || hub.device_id}</small>
          </div>
        </div>
        <div className="hub-switch-metrics">
          <span>{formatValue(hub.current_temp, "°F")}</span>
          <span>{hub.pump_on ? "Pump on" : "Pump off"}</span>
          <span>{hub.heater_enabled ? "Heat on" : "Heat off"}</span>
        </div>
        {selected ? (
          <span className="hub-selected-pill">
            <CheckCircle2 size={14} />
            Active
          </span>
        ) : hub.preview ? (
          <span className="hub-selected-pill preview">Preview</span>
        ) : null}
      </button>
    );
  }

  return (
    <div className="calibration-backdrop" role="dialog" aria-modal="true">
      <div className="hub-switch-sheet">
        <div className="health-sheet-header">
          <div>
            <span className="eyebrow">My Hubs</span>
            <h3>Switch Pool</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close hub switcher">
            <X size={20} />
          </button>
        </div>

        <div className="hub-switch-list">
          {realDevices.length > 0 ? realDevices.map(renderHubCard) : (
            <div className="hub-switch-empty">No claimed hubs yet. Add one from Settings using its serial number.</div>
          )}
        </div>

        {showPreview ? (
          <div className="hub-preview-block">
            <span className="eyebrow">Preview layout</span>
            <div className="hub-switch-list">{previewHubs.map(renderHubCard)}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
