import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronUp, Flame, PackagePlus, Power, Radio, Thermometer, Zap } from "lucide-react";
import { fetchLatestCommand, sendCommand, type DeviceCommandType, type PoolDevice } from "../lib/deviceApi";
import { isDirectMqttConfigured } from "../lib/mqttClient";
import { useTransparentImage } from "../hooks/useTransparentImage";
import pumpIconSrc from "../assets/pump-icon.png";

type DashboardPageProps = {
  device: PoolDevice | null;
  userId: string;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onCommandSettled: () => void;
  demoMode?: boolean;
};

function formatValue(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${Number(value).toFixed(suffix === " kWh" ? 2 : 0)}${suffix}`;
}

function wasSeenRecently(lastSeen: string | null | undefined) {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 120000;
}

function formatEtaMinutes(totalMinutes: number) {
  if (totalMinutes <= 0) return "At setpoint";
  if (totalMinutes < 60) return `~${Math.round(totalMinutes)}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return minutes === 0 ? `~${hours}h` : `~${hours}h ${minutes}m`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
}

type ReorderCardId = "heater" | "pump";
const DEFAULT_CARD_ORDER: ReorderCardId[] = ["heater", "pump"];
const CARD_ORDER_STORAGE_KEY = "pool-dashboard-card-order";

function loadCardOrder(): ReorderCardId[] {
  if (typeof window === "undefined") return DEFAULT_CARD_ORDER;
  try {
    const raw = window.localStorage.getItem(CARD_ORDER_STORAGE_KEY);
    if (!raw) return DEFAULT_CARD_ORDER;
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length === DEFAULT_CARD_ORDER.length &&
      parsed.every((item) => DEFAULT_CARD_ORDER.includes(item as ReorderCardId))
    ) {
      return parsed as ReorderCardId[];
    }
  } catch {
    // ignore
  }
  return DEFAULT_CARD_ORDER;
}

function PumpIcon({
  width = 44,
  height = 32,
  src,
}: {
  width?: number;
  height?: number;
  src: string;
}) {
  return (
    <span
      className="pump-icon-img"
      aria-hidden="true"
      style={
        {
          width,
          height,
          backgroundImage: `url(${src})`,
        } as CSSProperties
      }
    />
  );
}

export function NoDeviceDashboard({ error, onAddDevice }: { error?: string; onAddDevice: () => void }) {
  return (
    <div className="screen-stack dashboard-shell">
      <section className="empty-state no-device-state">
        <div className="no-device-icon">
          <PackagePlus size={40} />
        </div>
        <h3>Add your pool hub</h3>
        <p>No pool controller is connected to this account yet. Add your hub by serial number to open the live dashboard.</p>
        <button className="primary-button compact" type="button" onClick={onAddDevice}>
          <PackagePlus size={18} />
          <span>Add Device</span>
        </button>
      </section>
      {error ? <div className="error-box">{error}</div> : null}
    </div>
  );
}

export function DashboardPage({
  device,
  userId,
  loading,
  error,
  onRefresh,
  onCommandSettled,
  demoMode = false,
}: DashboardPageProps) {
  const cleanPumpIconSrc = useTransparentImage(pumpIconSrc, 24, 14);
  const [optimisticPumpOn, setOptimisticPumpOn] = useState<boolean | null>(null);
  const [optimisticHeaterOn, setOptimisticHeaterOn] = useState<boolean | null>(null);
  const [optimisticSetpoint, setOptimisticSetpoint] = useState<number | null>(null);
  const [commandError, setCommandError] = useState("");
  const setpointTimerRef = useRef<number | null>(null);
  const setpointCommandInFlightRef = useRef(false);
  const pendingSetpointRef = useRef<number | null>(null);
  const setpointDraftRef = useRef(84);
  const pumpClearTimerRef = useRef<number | null>(null);
  const heaterClearTimerRef = useRef<number | null>(null);
  const pumpOptimisticUntilRef = useRef(0);
  const heaterOptimisticUntilRef = useRef(0);
  const setpointOptimisticUntilRef = useRef(0);
  const commandStatusTimerRef = useRef<number | null>(null);
  const commandWatchTokenRef = useRef(0);
  const commandHoldMs = 6500;
  const temp = device?.current_temp ?? null;
  const setpoint = optimisticSetpoint ?? device?.setpoint ?? 84;
  const pumpOn = optimisticPumpOn ?? device?.pump_on ?? false;
  const heaterOn = optimisticHeaterOn ?? device?.heater_enabled ?? false;
  const online = device?.online_status === "online" && wasSeenRecently(device?.last_seen);
  const deviceUpdatedAtMs = device?.updated_at ? new Date(device.updated_at).getTime() : 0;
  const difference = Math.max(0, Number(setpoint) - Number(temp ?? setpoint));
  const heatEta = heaterOn && temp !== null ? formatEtaMinutes(difference * 18) : "--";
  const heatStatus = !online ? "Offline" : heaterOn ? (difference <= 0 ? "Holding" : "Heating") : "Off";
  const showHeatingFlame = heatStatus === "Heating";
  const dialMin = 60;
  const dialMax = 104;
  const dialStartAngle = 140;
  const dialSweep = 260;
  const dialValueRatio = clamp((Number(setpoint) - dialMin) / (dialMax - dialMin), 0, 1);
  const dialCurrentRatio = clamp(((temp ?? dialMin) - dialMin) / (dialMax - dialMin), 0, 1);
  const dialSetpointAngle = dialStartAngle + dialValueRatio * dialSweep;
  const dialCurrentAngle = dialStartAngle + dialCurrentRatio * dialSweep;
  const dialArcPath = `M ${polarToCartesian(120, 120, 84, dialStartAngle).x} ${polarToCartesian(120, 120, 84, dialStartAngle).y} A 84 84 0 1 1 ${polarToCartesian(120, 120, 84, dialStartAngle + dialSweep).x} ${polarToCartesian(120, 120, 84, dialStartAngle + dialSweep).y}`;
  const dialSetpointKnob = polarToCartesian(120, 120, 84, dialSetpointAngle);
  const dialCurrentKnob = polarToCartesian(120, 120, 84, dialCurrentAngle);
  const currentLabelPos = polarToCartesian(120, 120, 108, dialCurrentAngle);
  const dialTicks = useMemo(
    () =>
      Array.from({ length: 48 }, (_, idx) => {
        const ratio = idx / 47;
        const angle = dialStartAngle + ratio * dialSweep;
        const major = idx % 6 === 0;
        const outer = polarToCartesian(120, 120, 102, angle);
        const inner = polarToCartesian(120, 120, major ? 93 : 96, angle);
        return { idx, outer, inner };
      }),
    [dialStartAngle, dialSweep],
  );
  const dialDraggingRef = useRef(false);
  const [editMode, setEditMode] = useState(false);
  const [cardOrder, setCardOrder] = useState<ReorderCardId[]>(() => loadCardOrder());
  const [draggingCardId, setDraggingCardId] = useState<ReorderCardId | null>(null);
  const longPressRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(CARD_ORDER_STORAGE_KEY, JSON.stringify(cardOrder));
    } catch {
      // ignore
    }
  }, [cardOrder]);

  useEffect(() => {
    return () => {
      if (longPressRef.current) window.clearTimeout(longPressRef.current);
    };
  }, []);

  function cancelLongPress() {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
    pointerStartRef.current = null;
  }

  function handleReorderPointerDown(id: ReorderCardId, event: ReactPointerEvent<HTMLDivElement>) {
    if (editMode) {
      setDraggingCardId(id);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      return;
    }
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    if (longPressRef.current) window.clearTimeout(longPressRef.current);
    longPressRef.current = window.setTimeout(() => {
      setEditMode(true);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          navigator.vibrate(15);
        } catch {
          // ignore
        }
      }
      longPressRef.current = null;
    }, 550);
  }

  function handleReorderPointerMove(_id: ReorderCardId, event: ReactPointerEvent<HTMLDivElement>) {
    if (!editMode) {
      if (pointerStartRef.current) {
        const dx = event.clientX - pointerStartRef.current.x;
        const dy = event.clientY - pointerStartRef.current.y;
        if (Math.hypot(dx, dy) > 8) {
          cancelLongPress();
        }
      }
      return;
    }

    if (!draggingCardId) return;
    const elements = document.elementsFromPoint(event.clientX, event.clientY);
    const targetEl = elements.find(
      (el) => el instanceof HTMLElement && el.dataset.cardId && el.dataset.cardId !== draggingCardId,
    ) as HTMLElement | undefined;
    if (!targetEl) return;
    const targetId = targetEl.dataset.cardId as ReorderCardId;
    setCardOrder((current) => {
      const fromIdx = current.indexOf(draggingCardId);
      const toIdx = current.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return current;
      const next = [...current];
      [next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
      return next;
    });
  }

  function handleReorderPointerUp() {
    cancelLongPress();
    setDraggingCardId(null);
  }

  function exitEditMode() {
    setEditMode(false);
    setDraggingCardId(null);
    cancelLongPress();
  }

  function clearTimer(timerRef: MutableRefObject<number | null>) {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => {
    if (optimisticSetpoint === null && typeof device?.setpoint === "number") {
      setpointDraftRef.current = device.setpoint;
    }
  }, [device?.setpoint, optimisticSetpoint]);

  useEffect(() => {
    const allowPumpReconcile = deviceUpdatedAtMs > 0 || Date.now() >= pumpOptimisticUntilRef.current;
    if (optimisticPumpOn !== null && allowPumpReconcile && device?.pump_on === optimisticPumpOn) {
      clearTimer(pumpClearTimerRef);
      pumpClearTimerRef.current = window.setTimeout(() => {
        setOptimisticPumpOn(null);
        pumpOptimisticUntilRef.current = 0;
      }, 850);
    }

    const allowHeaterReconcile = deviceUpdatedAtMs > 0 || Date.now() >= heaterOptimisticUntilRef.current;
    if (optimisticHeaterOn !== null && allowHeaterReconcile && device?.heater_enabled === optimisticHeaterOn) {
      clearTimer(heaterClearTimerRef);
      heaterClearTimerRef.current = window.setTimeout(() => {
        setOptimisticHeaterOn(null);
        heaterOptimisticUntilRef.current = 0;
      }, 850);
    }

    if (
      optimisticSetpoint !== null &&
      (deviceUpdatedAtMs > 0 || Date.now() >= setpointOptimisticUntilRef.current) &&
      typeof device?.setpoint === "number" &&
      device.setpoint === optimisticSetpoint
    ) {
      setOptimisticSetpoint(null);
      pendingSetpointRef.current = null;
      setpointOptimisticUntilRef.current = 0;
    }
  }, [
    device?.heater_enabled,
    device?.pump_on,
    device?.setpoint,
    deviceUpdatedAtMs,
    optimisticHeaterOn,
    optimisticPumpOn,
    optimisticSetpoint,
  ]);

  useEffect(() => {
    return () => {
      if (setpointTimerRef.current) window.clearTimeout(setpointTimerRef.current);
      if (commandStatusTimerRef.current) window.clearInterval(commandStatusTimerRef.current);
      clearTimer(pumpClearTimerRef);
      clearTimer(heaterClearTimerRef);
    };
  }, []);

  function watchCommandUntilSettled(commandId: string) {
    commandWatchTokenRef.current += 1;
    const token = commandWatchTokenRef.current;
    const startedAt = Date.now();

    if (commandStatusTimerRef.current) {
      window.clearInterval(commandStatusTimerRef.current);
    }

    commandStatusTimerRef.current = window.setInterval(async () => {
      if (commandWatchTokenRef.current !== token) return;

      try {
        const latest = await fetchLatestCommand(commandId);
        if (commandWatchTokenRef.current !== token) return;

        if (latest.status === "completed" || latest.status === "failed") {
          if (commandStatusTimerRef.current) {
            window.clearInterval(commandStatusTimerRef.current);
            commandStatusTimerRef.current = null;
          }

          if (latest.status === "failed") {
            setCommandError(latest.error ?? "Command failed");
          }

          onRefresh();
          onCommandSettled();
        }
      } catch {
        // The normal device refresh burst still runs. This watcher is only an
        // extra nudge so the UI catches completed commands quickly.
      }

      if (Date.now() - startedAt > 15000 && commandStatusTimerRef.current) {
        window.clearInterval(commandStatusTimerRef.current);
        commandStatusTimerRef.current = null;
        onRefresh();
      }
    }, 1200);
  }

  async function sendDashboardCommand(commandType: DeviceCommandType, payload: Record<string, unknown> = {}) {
    if (demoMode) {
      console.info("Demo command ignored", commandType, payload);
      onCommandSettled();
      return true;
    }

    try {
      setCommandError("");
      const command = await sendCommand(userId, commandType, payload);
      if (!isDirectMqttConfigured()) {
        watchCommandUntilSettled(command.id);
        onCommandSettled();
      }
      return true;
    } catch (err) {
      setCommandError(err instanceof Error ? err.message : "Command failed");
      return false;
    }
  }

  function flushSetpointCommand() {
    if (setpointCommandInFlightRef.current) return;
    const nextSetpoint = pendingSetpointRef.current;
    if (nextSetpoint === null) {
      return;
    }

    pendingSetpointRef.current = null;
    setpointCommandInFlightRef.current = true;

    void sendDashboardCommand("set_setpoint", { setpoint: nextSetpoint }).then((ok) => {
      if (!ok) {
        setOptimisticSetpoint(null);
        setpointOptimisticUntilRef.current = 0;
      }
    }).finally(() => {
      setpointCommandInFlightRef.current = false;
      if (pendingSetpointRef.current !== null) {
        queueSetpointCommand(pendingSetpointRef.current, 60);
        return;
      }
    });
  }

  async function handlePumpToggle() {
    const nextPumpState = !pumpOn;
    clearTimer(pumpClearTimerRef);
    pumpOptimisticUntilRef.current = Date.now() + commandHoldMs;
    setOptimisticPumpOn(nextPumpState);
    if (!nextPumpState) {
      heaterOptimisticUntilRef.current = Date.now() + commandHoldMs;
      setOptimisticHeaterOn(false);
    }
    const ok = await sendDashboardCommand(nextPumpState ? "pump_on" : "pump_off");
    if (!ok) {
      setOptimisticPumpOn(null);
      if (!nextPumpState) setOptimisticHeaterOn(null);
    }
  }

  async function handleHeaterToggle() {
    const nextHeaterState = !heaterOn;
    clearTimer(heaterClearTimerRef);
    heaterOptimisticUntilRef.current = Date.now() + commandHoldMs;
    setOptimisticHeaterOn(nextHeaterState);
    if (nextHeaterState) {
      pumpOptimisticUntilRef.current = Date.now() + commandHoldMs;
      setOptimisticPumpOn(true);
    }
    const ok = await sendDashboardCommand(nextHeaterState ? "heater_enable" : "heater_disable");
    if (!ok) {
      setOptimisticHeaterOn(null);
      if (nextHeaterState) setOptimisticPumpOn(null);
    }
  }

  function queueSetpointCommand(nextSetpoint: number, delayMs = 350) {
    pendingSetpointRef.current = nextSetpoint;
    if (setpointTimerRef.current) {
      window.clearTimeout(setpointTimerRef.current);
    }

    setpointTimerRef.current = window.setTimeout(() => {
      setpointTimerRef.current = null;
      flushSetpointCommand();
    }, delayMs);
  }

  function handleSetpoint(delta: number) {
    const nextSetpoint = clamp(setpointDraftRef.current + delta, 60, 104);
    setpointDraftRef.current = nextSetpoint;
    setpointOptimisticUntilRef.current = Date.now() + commandHoldMs;
    setOptimisticSetpoint(nextSetpoint);
    queueSetpointCommand(nextSetpoint);
  }

  function updateSetpointFromPointer(clientX: number, clientY: number, svgElement: SVGSVGElement) {
    const rect = svgElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const angle = (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI;
    const normalized = (angle + 360) % 360;
    const start = dialStartAngle % 360;
    const deltaRaw = (normalized - start + 360) % 360;
    const constrainedDelta = clamp(deltaRaw, 0, dialSweep);
    const ratio = constrainedDelta / dialSweep;
    const nextSetpoint = Math.round(dialMin + ratio * (dialMax - dialMin));
    setpointDraftRef.current = nextSetpoint;
    setpointOptimisticUntilRef.current = Date.now() + commandHoldMs;
    setOptimisticSetpoint(nextSetpoint);
    queueSetpointCommand(nextSetpoint);
  }

  return (
    <div className="screen-stack dashboard-shell">
      {demoMode ? (
        <div className="demo-mode-banner">
          Demo mode · buttons are simulated and no real pool equipment is controlled.
        </div>
      ) : null}
      <section className="hero-card">
        <div className="hero-topline">
          <div className="hero-title-block">
            <span>{device?.name ?? "Pool Hub"}</span>
            <p className="hero-subtitle">Pool Controller</p>
          </div>
          <div className="hero-actions">
            <div className="hero-water-temp">
              <Thermometer size={14} />
              <div>
                <span>Water Temp</span>
                <strong>{formatValue(temp, "°F")}</strong>
              </div>
            </div>
            <div className="hero-water-temp hero-energy-chip">
              <Zap size={14} />
              <div>
                <span>Total Energy</span>
                <strong>{formatValue(device?.total_kwh, " kWh")}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="status-row">
          <span className={online ? "status-pill online" : "status-pill offline"}>
            <Radio size={14} />
            {online ? "Online" : "Offline"}
          </span>
        </div>

      </section>

      {editMode ? (
        <div className="reorder-banner">
          <span>Drag cards to reorder</span>
          <button type="button" className="reorder-done" onClick={exitEditMode}>
            Done
          </button>
        </div>
      ) : null}

      <div className={editMode ? "reorder-zone editing" : "reorder-zone"}>
      {cardOrder.map((cardId) => {
        const isDragging = draggingCardId === cardId;
        const wrapperClass = `reorder-card ${editMode ? "wiggling" : ""} ${isDragging ? "dragging" : ""}`;
        return (
          <div
            key={cardId}
            data-card-id={cardId}
            className={wrapperClass}
            onPointerDown={(event) => handleReorderPointerDown(cardId, event)}
            onPointerMove={(event) => handleReorderPointerMove(cardId, event)}
            onPointerUp={handleReorderPointerUp}
            onPointerCancel={handleReorderPointerUp}
          >
            {cardId === "heater" ? (
      <section className="dial-card">
        <div className="heater-header-row">
          <div className="heater-header-title">
            <Flame size={18} />
            <span>Heater</span>
          </div>
          <div className="pump-status-block">
            <strong className="pump-status-text">{heaterOn ? "On" : "Off"}</strong>
            <button
              type="button"
              className={heaterOn ? "heater-power-button on" : "heater-power-button"}
              onClick={() => void handleHeaterToggle()}
              aria-label={heaterOn ? "Turn heater off" : "Turn heater on"}
            >
              <Power size={20} strokeWidth={2.4} />
            </button>
          </div>
        </div>
        <div className="dial-summary-row">
          <div className="dial-summary-block">
            <span>Current Temperature</span>
            <strong>{formatValue(temp, "°F")}</strong>
          </div>
          <div className="dial-summary-block">
            <span>Target Temperature</span>
            <strong>{formatValue(setpoint, "°F")}</strong>
          </div>
        </div>
        <div className="dial-wrap">
          <svg
            viewBox="0 0 240 240"
            className="temp-dial"
            onPointerDown={(event) => {
              dialDraggingRef.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              updateSetpointFromPointer(event.clientX, event.clientY, event.currentTarget);
            }}
            onPointerMove={(event) => {
              if (!dialDraggingRef.current) return;
              updateSetpointFromPointer(event.clientX, event.clientY, event.currentTarget);
            }}
            onPointerUp={(event) => {
              dialDraggingRef.current = false;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              dialDraggingRef.current = false;
            }}
          >
            <g className="dial-ticks">
              {dialTicks.map((tick) => (
                <line
                  key={tick.idx}
                  x1={tick.outer.x}
                  y1={tick.outer.y}
                  x2={tick.inner.x}
                  y2={tick.inner.y}
                  className={tick.idx <= Math.round(dialValueRatio * 47) ? "tick active" : "tick"}
                />
              ))}
            </g>
            <path
              className="dial-track"
              d={dialArcPath}
            />
            <path
              className="dial-fill"
              d={dialArcPath}
              pathLength={100}
              strokeDasharray={`${Math.max(1, dialValueRatio * 100)} 100`}
            />
            <circle className="dial-current-dot" cx={dialCurrentKnob.x} cy={dialCurrentKnob.y} r="5.5" />
            <circle className="dial-knob" cx={dialSetpointKnob.x} cy={dialSetpointKnob.y} r="11" />
          </svg>
          <div className="dial-center">
            <div className="dial-status-line">
              <span className={showHeatingFlame ? "status-flame active" : "status-flame"}>
                {showHeatingFlame ? <Flame size={11} strokeWidth={2.4} /> : null}
              </span>
              <span>{heatStatus}</span>
            </div>
            <strong>{formatValue(setpoint, "°")}</strong>
            <small>Temp Setting</small>
          </div>
          <span className="dial-label dial-label-min">{dialMin}°</span>
          <span className="dial-label dial-label-max">{dialMax}°</span>
          <span
            className="dial-current-text moving"
            style={
              {
                left: `${(currentLabelPos.x / 240) * 100}%`,
                top: `${(currentLabelPos.y / 240) * 100}%`,
              } as CSSProperties
            }
          >
            Currently {formatValue(temp, "°")}
          </span>
          <div className="dial-controls inline">
            <button className="round-control" type="button" onClick={() => handleSetpoint(-1)} aria-label="Decrease setpoint">
              <ChevronDown size={22} />
            </button>
            <button className="round-control" type="button" onClick={() => handleSetpoint(1)} aria-label="Increase setpoint">
              <ChevronUp size={22} />
            </button>
          </div>
        </div>
        <div className="dial-meta-grid">
          <div className="mini-stat">
            <span>Heat ETA</span>
            <strong>{heatEta}</strong>
          </div>
          <div className="mini-stat">
            <span className="mini-stat-label">
              <Zap size={13} />
              Heater Watts
            </span>
            <strong>{formatValue(device?.heater_watts, " W")}</strong>
          </div>
        </div>
      </section>
            ) : null}
            {cardId === "pump" ? (
      <section className="control-grid pump-section">
        <article className={`control-tile pump-card ${optimisticPumpOn !== null ? "sticky" : ""}`}>
          <div className="pump-card-header">
            <div className="pump-title">
              <PumpIcon width={48} height={36} src={cleanPumpIconSrc} />
              <span>Pump</span>
            </div>
            <div className="pump-right-stack">
              <div className="pump-status-block">
                <strong className="pump-status-text">{pumpOn ? "On" : "Off"}</strong>
                <button
                  type="button"
                  className={pumpOn ? "heater-power-button on" : "heater-power-button"}
                  onClick={() => void handlePumpToggle()}
                  aria-label={pumpOn ? "Turn pump off" : "Turn pump on"}
                >
                  <Power size={20} strokeWidth={2.4} />
                </button>
              </div>
              <div className="pump-watts-chip">
                <span className="mini-stat-label">
                  <Zap size={13} />
                  Pump Watts
                </span>
                <strong>{formatValue(device?.pump_watts, " W")}</strong>
              </div>
            </div>
          </div>

        </article>
      </section>
            ) : null}
          </div>
        );
      })}
      </div>

      <section className="metrics-grid summary-grid">
        <div className="metric-card metrics-summary">
          <div className="summary-cell">
            <Zap size={18} />
            <span>Pump Watts</span>
            <strong>{formatValue(device?.pump_watts, " W")}</strong>
          </div>
          <div className="summary-divider" />
          <div className="summary-cell">
            <Zap size={18} />
            <span>Heater Watts</span>
            <strong>{formatValue(device?.heater_watts, " W")}</strong>
          </div>
          <div className="summary-divider" />
          <div className="summary-cell">
            <Zap size={18} />
            <span>Total Energy</span>
            <strong>{formatValue(device?.total_kwh, " kWh")}</strong>
          </div>
        </div>
      </section>

      {commandError ? <div className="error-box">{commandError}</div> : null}
      {error ? <div className="error-box">{error}</div> : null}
      {loading ? <div className="loading-box">Loading pool state...</div> : null}
    </div>
  );
}
