import { useState, type FormEvent } from "react";
import { KeyRound, PackagePlus, Pencil, X } from "lucide-react";
import { claimDevice } from "../lib/deviceApi";

type AddDeviceSheetProps = {
  onCancel: () => void;
  onClaimed: (deviceId: string) => void;
};

export function AddDeviceSheet({ onCancel, onClaimed }: AddDeviceSheetProps) {
  const [serialNumber, setSerialNumber] = useState("");
  const [claimCode, setClaimCode] = useState("");
  const [deviceName, setDeviceName] = useState("Pool Hub");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const canClaim = serialNumber.trim().length >= 4 && claimCode.trim().length >= 3 && !loading;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canClaim) return;

    setLoading(true);
    setError("");

    try {
      const device = await claimDevice(serialNumber, claimCode, deviceName);
      onClaimed(device.device_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to claim device");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="calibration-backdrop" role="dialog" aria-modal="true">
      <form className="rate-sheet" onSubmit={handleSubmit}>
        <div className="health-sheet-header">
          <div>
            <span className="eyebrow">Setup</span>
            <h3>Add Device</h3>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close add device">
            <X size={20} />
          </button>
        </div>

        <label className="rate-input-wrap">
          <span>Device name</span>
          <div>
            <Pencil size={22} />
            <input
              autoComplete="off"
              maxLength={40}
              placeholder="Beach House Pool"
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
            />
          </div>
        </label>

        <label className="rate-input-wrap compact">
          <span>Serial number</span>
          <div>
            <PackagePlus size={24} />
            <input
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="WF-POOL-000001"
              value={serialNumber}
              onChange={(event) => setSerialNumber(event.target.value.toUpperCase())}
            />
          </div>
        </label>

        <label className="rate-input-wrap compact">
          <span>Setup code</span>
          <div>
            <KeyRound size={22} />
            <input
              autoComplete="off"
              placeholder="Printed on the hub label"
              value={claimCode}
              onChange={(event) => setClaimCode(event.target.value)}
            />
          </div>
        </label>

        <p className="rate-help">Type the serial number and setup code from the hub label. After it is added, this app opens that hub automatically.</p>

        {error ? <div className="error-box">{error}</div> : null}

        <div className="rate-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="confirm" disabled={!canClaim}>
            {loading ? "Adding..." : "Add Device"}
          </button>
        </div>
      </form>
    </div>
  );
}
