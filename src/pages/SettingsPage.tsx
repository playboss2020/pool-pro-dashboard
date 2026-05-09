import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ChevronRight,
  Clock3,
  Cpu,
  DollarSign,
  LogOut,
  PackagePlus,
  Pencil,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Thermometer,
  Trash2,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { AddDeviceSheet } from "../components/AddDeviceSheet";
import { clearSelectedDeviceId, deviceId, selectDeviceId } from "../lib/supabase";
import { sendCommand, unclaimDevice, updateDeviceName, updateElectricityRate, type PoolDevice } from "../lib/deviceApi";
import { useAuth } from "../hooks/useAuth";

type SettingsPageProps = {
  device: PoolDevice | null;
  userId: string;
};

type CalibrationMode = "temperature" | "wattage";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundToStep(value: number, step: number) {
  return Math.round(value / step) * step;
}

function formatTemperatureOffset(value: number) {
  const fixed = value.toFixed(1);
  return `${value > 0 ? "+" : ""}${fixed}°F`;
}

function formatWattageScale(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatElectricityRate(value: number) {
  return `$${value.toFixed(3)} / kWh`;
}

function seenRecently(lastSeen: string | null | undefined, maxAgeMs = 120000) {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < maxAgeMs;
}

function formatAgo(value: string | null | undefined) {
  if (!value) return "--";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatNumber(value: number | null | undefined, suffix = "", decimals = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value.toFixed(decimals)}${suffix}`;
}

function wifiLabel(rssi: number | null | undefined) {
  if (typeof rssi !== "number") return "Unknown";
  if (rssi >= -60) return "Excellent";
  if (rssi >= -70) return "Good";
  if (rssi >= -82) return "Weak";
  return "Poor";
}

function loraLabel(rssi: number | null | undefined, snr: number | null | undefined) {
  if (typeof rssi !== "number" && typeof snr !== "number") return "Unknown";
  if ((rssi ?? -999) >= -90 && (snr ?? -999) >= 5) return "Excellent";
  if ((rssi ?? -999) >= -105 && (snr ?? -999) >= 0) return "Good";
  if ((rssi ?? -999) >= -115) return "Weak";
  return "Poor";
}

function HealthRow({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="health-row">
      <div className="settings-row-icon">{icon}</div>
      <div className="settings-row-text">
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </div>
  );
}

function DeviceHealthSheet({ device, onClose }: { device: PoolDevice | null; onClose: () => void }) {
  const cloudOnline = device?.online_status === "online" && seenRecently(device?.last_seen);
  const nodeOnline = device?.node_online === true || seenRecently(device?.node_last_seen, 20000);
  const wifiRssi = device?.wifi_rssi ?? null;
  const loraRssi = device?.lora_rssi ?? null;
  const loraSnr = device?.lora_snr ?? null;

  return (
    <div className="calibration-backdrop" role="dialog" aria-modal="true">
      <div className="health-sheet">
        <div className="health-sheet-header">
          <div>
            <span className="eyebrow">Diagnostics</span>
            <h3>Device Health</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close device health">
            <X size={20} />
          </button>
        </div>

        <div className="health-status-grid">
          <div className={cloudOnline ? "health-status-pill good" : "health-status-pill bad"}>
            <span>Cloud</span>
            <strong>{cloudOnline ? "Online" : "Offline"}</strong>
          </div>
          <div className={nodeOnline ? "health-status-pill good" : "health-status-pill bad"}>
            <span>Node</span>
            <strong>{nodeOnline ? "Linked" : "Lost"}</strong>
          </div>
        </div>

        <div className="health-list">
          <HealthRow
            icon={<Wifi size={18} />}
            label="WiFi network"
            value={device?.wifi_ssid || "--"}
            detail={`${wifiLabel(wifiRssi)} ${formatNumber(wifiRssi, " dBm")} / hub last seen ${formatAgo(device?.last_seen)}`}
          />
          <HealthRow
            icon={<Radio size={18} />}
            label="LoRa link"
            value={`${loraLabel(loraRssi, loraSnr)} ${formatNumber(loraRssi, " dBm")}`}
            detail={`SNR ${formatNumber(loraSnr, " dB", 1)} / node last seen ${formatAgo(device?.node_last_seen)}`}
          />
          <HealthRow
            icon={<Cpu size={18} />}
            label="Firmware"
            value={device?.firmware_version || "--"}
            detail={`Device ID ${deviceId}`}
          />
          <HealthRow
            icon={<Clock3 size={18} />}
            label="Latest state"
            value={device?.updated_at ? new Date(device.updated_at).toLocaleString() : "--"}
            detail={device ? `Status row is ${device.online_status}` : "Waiting for device state"}
          />
        </div>
      </div>
    </div>
  );
}

function CalibrationPicker({
  title,
  value,
  min,
  max,
  step,
  unit,
  formatter,
  onCancel,
  onConfirm,
}: {
  title: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  formatter: (value: number) => string;
  onCancel: () => void;
  onConfirm: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const rows = useMemo(() => [-2, -1, 0, 1, 2].map((offset) => clamp(roundToStep(draft + offset * step, step), min, max)), [draft, max, min, step]);

  function move(delta: number) {
    setDraft((current) => clamp(roundToStep(current + delta, step), min, max));
  }

  return (
    <div className="calibration-backdrop" role="dialog" aria-modal="true">
      <div className="calibration-sheet">
        <div className="calibration-title">{title}</div>

        <div
          className="calibration-wheel"
          onWheel={(event) => {
            event.preventDefault();
            move(event.deltaY > 0 ? step : -step);
          }}
        >
          {rows.map((rowValue, index) => (
            <button
              key={`${rowValue}-${index}`}
              type="button"
              className={index === 2 ? "calibration-wheel-row selected" : "calibration-wheel-row"}
              onClick={() => setDraft(rowValue)}
            >
              {formatter(rowValue)}
            </button>
          ))}
          <div className="calibration-selection-line top" />
          <div className="calibration-selection-line bottom" />
        </div>

        <div className="calibration-stepper">
          <button type="button" onClick={() => move(-step)} aria-label={`Decrease ${title}`}>
            -
          </button>
          <strong>{unit}</strong>
          <button type="button" onClick={() => move(step)} aria-label={`Increase ${title}`}>
            +
          </button>
        </div>

        <div className="calibration-actions">
          <button type="button" onClick={onCancel}>
            cancel
          </button>
          <button type="button" className="confirm" onClick={() => onConfirm(draft)}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function ElectricityRateSheet({
  value,
  onCancel,
  onConfirm,
}: {
  value: number;
  onCancel: () => void;
  onConfirm: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value.toFixed(3));
  const parsedDraft = Number(draft);
  const canSave = draft.trim() !== "" && Number.isFinite(parsedDraft) && parsedDraft >= 0 && parsedDraft <= 2;

  return (
    <div className="calibration-backdrop" role="dialog" aria-modal="true">
      <div className="rate-sheet">
        <div className="health-sheet-header">
          <div>
            <span className="eyebrow">Energy</span>
            <h3>Electricity Rate</h3>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close electricity rate">
            <X size={20} />
          </button>
        </div>

        <label className="rate-input-wrap">
          <span>Price per kWh</span>
          <div>
            <strong>$</strong>
            <input
              inputMode="decimal"
              min="0"
              max="2"
              step="0.001"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
        </label>

        <p className="rate-help">Use the energy price from your electric bill. The History charts use this to estimate pump and heater cost.</p>

        <div className="rate-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="confirm" disabled={!canSave} onClick={() => onConfirm(Number(parsedDraft.toFixed(3)))}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function DeviceNameSheet({
  title,
  value,
  onCancel,
  onConfirm,
}: {
  title: string;
  value: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const cleanDraft = draft.trim();

  return (
    <div className="calibration-backdrop" role="dialog" aria-modal="true">
      <form
        className="rate-sheet"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(cleanDraft || "Pool Hub");
        }}
      >
        <div className="health-sheet-header">
          <div>
            <span className="eyebrow">Device</span>
            <h3>{title}</h3>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close device name">
            <X size={20} />
          </button>
        </div>

        <label className="rate-input-wrap compact">
          <span>Display name</span>
          <div>
            <Pencil size={22} />
            <input
              autoComplete="off"
              maxLength={40}
              placeholder="Main Pool"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
        </label>

        <p className="rate-help">This name appears on the dashboard and helps identify the hub when you add more devices later.</p>

        <div className="rate-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="confirm">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function RemoveDeviceSheet({
  device,
  removing,
  onCancel,
  onConfirm,
}: {
  device: PoolDevice | null;
  removing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="calibration-backdrop" role="dialog" aria-modal="true">
      <div className="rate-sheet">
        <div className="health-sheet-header">
          <div>
            <span className="eyebrow">Remove hub</span>
            <h3>Remove this pool hub?</h3>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close remove device" disabled={removing}>
            <X size={20} />
          </button>
        </div>

        <div className="remove-device-warning">
          <div className="settings-row-icon danger">
            <Trash2 size={20} />
          </div>
          <div className="settings-row-text">
            <span>{device?.name || "Pool Hub"}</span>
            <strong>{device?.serial_number || deviceId}</strong>
            <small>The hub will keep running locally, but this account will no longer control it online.</small>
          </div>
        </div>

        <p className="rate-help">Schedules, alerts, commands, and history for this account will be removed from the cloud. You can add the hub again later with its serial number and setup code.</p>

        <div className="rate-actions">
          <button type="button" onClick={onCancel} disabled={removing}>
            Cancel
          </button>
          <button type="button" className="danger-confirm" onClick={onConfirm} disabled={removing}>
            {removing ? "Removing..." : "Remove Hub"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage({ device, userId }: SettingsPageProps) {
  const auth = useAuth();
  const [activePicker, setActivePicker] = useState<CalibrationMode | null>(null);
  const [tempOffset, setTempOffset] = useState(0);
  const [wattageScale, setWattageScale] = useState(1);
  const [electricityRate, setElectricityRate] = useState(0.18);
  const [deviceName, setDeviceName] = useState("Pool Hub");
  const [showHealth, setShowHealth] = useState(false);
  const [showRateSheet, setShowRateSheet] = useState(false);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [showNameSheet, setShowNameSheet] = useState(false);
  const [showRemoveDevice, setShowRemoveDevice] = useState(false);
  const [removingDevice, setRemovingDevice] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const cloudOnline = device?.online_status === "online" && seenRecently(device?.last_seen);
  const nodeOnline = device?.node_online === true || seenRecently(device?.node_last_seen, 20000);

  useEffect(() => {
    setTempOffset(typeof device?.temp_calibration_offset === "number" ? device.temp_calibration_offset : 0);
    setWattageScale(typeof device?.wattage_calibration_scale === "number" ? device.wattage_calibration_scale : 1);
    setElectricityRate(typeof device?.electricity_rate_per_kwh === "number" ? device.electricity_rate_per_kwh : 0.18);
    setDeviceName(device?.name || "Pool Hub");
  }, [device?.electricity_rate_per_kwh, device?.name, device?.temp_calibration_offset, device?.wattage_calibration_scale]);

  async function saveCalibration(nextTempOffset = tempOffset, nextWattageScale = wattageScale) {
    setError("");
    setSaving("Saving calibration...");
    setTempOffset(nextTempOffset);
    setWattageScale(nextWattageScale);

    try {
      await sendCommand(userId, "set_calibration", {
        temp_offset_f: Number(nextTempOffset.toFixed(1)),
        wattage_scale: Number(nextWattageScale.toFixed(3)),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calibration failed");
    } finally {
      setSaving("");
    }
  }

  async function saveElectricityRate(nextRate: number) {
    setError("");
    setSaving("Saving electricity rate...");
    setElectricityRate(nextRate);

    try {
      await updateElectricityRate(nextRate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Electricity rate failed");
    } finally {
      setSaving("");
    }
  }

  async function saveDeviceName(nextName: string) {
    setError("");
    setSaving("Saving device name...");
    setDeviceName(nextName);

    try {
      await updateDeviceName(nextName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Device name failed");
    } finally {
      setSaving("");
    }
  }

  async function removeDeviceFromAccount() {
    if (!device) return;

    setError("");
    setRemovingDevice(true);
    setSaving("Removing hub from this account...");

    try {
      await unclaimDevice(device.device_id);
      clearSelectedDeviceId();
      try {
        window.sessionStorage.setItem("pool-dashboard-claim-success", "Pool hub was removed from this account.");
      } catch {
        // ignore
      }
      window.setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove hub");
      setRemovingDevice(false);
      setSaving("");
      setShowRemoveDevice(false);
    }
  }

  return (
    <div className="screen-stack">
      <section className="section-heading">
        <div>
          <span className="eyebrow">Account</span>
          <h2>Settings</h2>
        </div>
      </section>

      <article className="settings-card">
        <div className="settings-row">
          <div className="settings-row-icon">
            <Smartphone size={18} />
          </div>
          <div className="settings-row-text">
            <span>Signed in as</span>
            <strong>{auth.user?.email ?? "--"}</strong>
          </div>
        </div>

        <button className="settings-row settings-action-row" type="button" onClick={() => setShowNameSheet(true)}>
          <div className="settings-row-icon">
            <Pencil size={18} />
          </div>
          <div className="settings-row-text">
            <span>Device name</span>
            <strong>{deviceName}</strong>
            <small>{device?.serial_number || deviceId}</small>
          </div>
          <ChevronRight size={18} />
        </button>

        <div className="settings-row">
          <div className="settings-row-icon">
            <ShieldCheck size={18} />
          </div>
          <div className="settings-row-text">
            <span>Safety mode</span>
            <strong>ESP32 local control</strong>
          </div>
        </div>

        <button className="settings-row settings-action-row" type="button" onClick={() => setShowAddDevice(true)}>
          <div className="settings-row-icon">
            <PackagePlus size={18} />
          </div>
          <div className="settings-row-text">
            <span>Add another hub</span>
            <strong>Claim by serial number</strong>
          </div>
          <ChevronRight size={18} />
        </button>

        <button
          className="settings-row settings-action-row danger-row"
          type="button"
          onClick={() => setShowRemoveDevice(true)}
          disabled={!device}
        >
          <div className="settings-row-icon danger">
            <Trash2 size={18} />
          </div>
          <div className="settings-row-text">
            <span>Remove current hub</span>
            <strong>Unlink from this account</strong>
          </div>
          <ChevronRight size={18} />
        </button>
      </article>

      <section className="section-heading compact">
        <div>
          <span className="eyebrow">Sensor Tuning</span>
          <h2>Calibration & Cost</h2>
        </div>
      </section>

      <article className="settings-card">
        <button className="settings-row settings-action-row" type="button" onClick={() => setShowHealth(true)}>
          <div className="settings-row-icon">
            <Activity size={18} />
          </div>
          <div className="settings-row-text">
            <span>Hub and node status</span>
            <strong>{cloudOnline && nodeOnline ? "Healthy" : cloudOnline ? "Hub online / node check" : "Cloud offline"}</strong>
          </div>
          <ChevronRight size={18} />
        </button>

        <button className="settings-row settings-action-row" type="button" onClick={() => setActivePicker("temperature")}>
          <div className="settings-row-icon">
            <Thermometer size={18} />
          </div>
          <div className="settings-row-text">
            <span>Temperature calibration</span>
            <strong>{formatTemperatureOffset(tempOffset)}</strong>
          </div>
          <ChevronRight size={18} />
        </button>

        <button className="settings-row settings-action-row" type="button" onClick={() => setActivePicker("wattage")}>
          <div className="settings-row-icon">
            <Zap size={18} />
          </div>
          <div className="settings-row-text">
            <span>Wattage calibration</span>
            <strong>{formatWattageScale(wattageScale)}</strong>
          </div>
          <ChevronRight size={18} />
        </button>

        <button className="settings-row settings-action-row" type="button" onClick={() => setShowRateSheet(true)}>
          <div className="settings-row-icon">
            <DollarSign size={18} />
          </div>
          <div className="settings-row-text">
            <span>Electricity rate</span>
            <strong>{formatElectricityRate(electricityRate)}</strong>
          </div>
          <ChevronRight size={18} />
        </button>

        <button className="settings-row settings-action-row" type="button" onClick={() => void saveCalibration(0, 1)}>
          <div className="settings-row-icon">
            <SlidersHorizontal size={18} />
          </div>
          <div className="settings-row-text">
            <span>Reset calibration</span>
            <strong>0.0°F / 100%</strong>
          </div>
          <ChevronRight size={18} />
        </button>
      </article>

      {saving ? <div className="loading-box">{saving}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}

      <button className="primary-button danger" type="button" onClick={() => void auth.signOut?.()}>
        <LogOut size={18} />
        <span>Sign out</span>
      </button>

      {activePicker === "temperature" ? (
        <CalibrationPicker
          title="Temperature calibration"
          value={tempOffset}
          min={-10}
          max={10}
          step={0.2}
          unit="°F"
          formatter={formatTemperatureOffset}
          onCancel={() => setActivePicker(null)}
          onConfirm={(value) => {
            setActivePicker(null);
            void saveCalibration(value, wattageScale);
          }}
        />
      ) : null}

      {activePicker === "wattage" ? (
        <CalibrationPicker
          title="Wattage calibration"
          value={wattageScale}
          min={0.5}
          max={1.5}
          step={0.01}
          unit="watts"
          formatter={formatWattageScale}
          onCancel={() => setActivePicker(null)}
          onConfirm={(value) => {
            setActivePicker(null);
            void saveCalibration(tempOffset, value);
          }}
        />
      ) : null}

      {showHealth ? <DeviceHealthSheet device={device} onClose={() => setShowHealth(false)} /> : null}

      {showRateSheet ? (
        <ElectricityRateSheet
          value={electricityRate}
          onCancel={() => setShowRateSheet(false)}
          onConfirm={(value) => {
            setShowRateSheet(false);
            void saveElectricityRate(value);
          }}
        />
      ) : null}

      {showNameSheet ? (
        <DeviceNameSheet
          title="Rename Device"
          value={deviceName}
          onCancel={() => setShowNameSheet(false)}
          onConfirm={(value) => {
            setShowNameSheet(false);
            void saveDeviceName(value);
          }}
        />
      ) : null}

      {showRemoveDevice ? (
        <RemoveDeviceSheet
          device={device}
          removing={removingDevice}
          onCancel={() => setShowRemoveDevice(false)}
          onConfirm={() => void removeDeviceFromAccount()}
        />
      ) : null}

      {showAddDevice ? (
        <AddDeviceSheet
          onCancel={() => setShowAddDevice(false)}
          onClaimed={(nextDeviceId) => {
            selectDeviceId(nextDeviceId);
            setShowAddDevice(false);
            try {
              window.sessionStorage.setItem("pool-dashboard-claim-success", "Congratulations, your pool hub was added.");
            } catch {
              // ignore
            }
            setSaving("Congratulations, your pool hub was added. Opening dashboard...");
            window.setTimeout(() => window.location.reload(), 600);
          }}
        />
      ) : null}
    </div>
  );
}
