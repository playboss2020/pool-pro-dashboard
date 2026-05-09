import { useMemo, useState } from "react";
import { CalendarDays, PencilLine, Plus } from "lucide-react";
import { deviceId } from "../lib/supabase";
import type { DeviceSchedule } from "../lib/deviceApi";
import { useCommands } from "../hooks/useCommands";
import { useSchedules } from "../hooks/useSchedules";

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type SchedulesPageProps = {
  userId: string;
};

function formatTime12h(value: string | null | undefined) {
  if (!value) return "--";
  const [hourRaw, minuteRaw] = value.split(":");
  const hour24 = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour24) || !Number.isFinite(minute)) return "--";

  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function defaultScheduleName(target: "pump" | "heater") {
  return target === "pump" ? "Pool pump schedule" : "Heater schedule";
}

export function SchedulesPage({ userId }: SchedulesPageProps) {
  const { schedules, loading, error, save } = useSchedules();
  const { pendingLabel, error: commandError, runCommand } = useCommands(userId);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [scheduleName, setScheduleName] = useState("");
  const [target, setTarget] = useState<"pump" | "heater">("pump");
  const [startTime, setStartTime] = useState("06:00");
  const [endTime, setEndTime] = useState("08:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  const selectedSchedule = useMemo(
    () => schedules.find((item) => item.id === selectedScheduleId) ?? null,
    [schedules, selectedScheduleId],
  );
  const visibleSchedules = useMemo(
    () => (editorOpen && selectedScheduleId ? schedules.filter((item) => item.id !== selectedScheduleId) : schedules),
    [editorOpen, schedules, selectedScheduleId],
  );

  function resetForm() {
    setSelectedScheduleId(null);
    setScheduleName("");
    setTarget("pump");
    setStartTime("06:00");
    setEndTime("08:00");
    setDays([1, 2, 3, 4, 5]);
    setEnabled(true);
    setFormError("");
    setFormSuccess("");
  }

  function openNewSchedule() {
    resetForm();
    setEditorOpen(true);
  }

  function closeEditor() {
    resetForm();
    setEditorOpen(false);
  }

  function loadSchedule(schedule: DeviceSchedule) {
    setSelectedScheduleId(schedule.id);
    setScheduleName(schedule.name ?? "");
    setTarget(schedule.target);
    setStartTime(schedule.start_time?.slice(0, 5) ?? "06:00");
    setEndTime(schedule.end_time?.slice(0, 5) ?? "08:00");
    setDays(schedule.days_of_week);
    setEnabled(schedule.enabled);
    setFormError("");
    setFormSuccess("");
    setEditorOpen(true);
  }

  function toggleDay(index: number) {
    setDays((current) => (current.includes(index) ? current.filter((day) => day !== index) : [...current, index].sort((a, b) => a - b)));
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFormSuccess("");

    if (!startTime || !endTime) {
      setFormError("Start and end times are required.");
      return;
    }

    if (days.length === 0) {
      setFormError("Select at least one day.");
      return;
    }

    setSaving(true);

    try {
      const saved = await save({
        id: selectedSchedule?.id,
        user_id: userId,
        device_id: deviceId,
        name: scheduleName.trim() || defaultScheduleName(target),
        target,
        start_time: `${startTime}:00`,
        end_time: `${endTime}:00`,
        days_of_week: days,
        enabled,
        duration_minutes: null,
      });

      await runCommand("Syncing schedules", "sync_schedules");

      setSelectedScheduleId(saved.id);
      setFormSuccess("Schedule saved and sync requested.");
      setEditorOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to save schedule");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="screen-stack">
      <section className="section-heading">
        <div>
          <span className="eyebrow">Local-first</span>
          <h2>Schedules</h2>
        </div>
      </section>

      {loading ? <div className="loading-box">Loading schedules...</div> : null}
      {error ? <div className="error-box">{error}</div> : null}

      {!editorOpen ? (
        <section className="schedule-create-strip">
          <div>
            <span className="eyebrow">Add automation</span>
            <strong>New schedule</strong>
          </div>
          <button className="primary-button compact" type="button" onClick={openNewSchedule}>
            <Plus size={18} />
            <span>Create</span>
          </button>
        </section>
      ) : null}

      {editorOpen ? (
      <section className="schedule-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{selectedSchedule ? "Editing" : "New schedule"}</span>
            <h3>{selectedSchedule ? "Update schedule" : "Create schedule"}</h3>
          </div>
          <button className="text-button" type="button" onClick={closeEditor}>
            Cancel
          </button>
        </div>

        <form className="schedule-form" onSubmit={handleSave}>
          <label>
            Schedule name
            <input
              type="text"
              value={scheduleName}
              onChange={(event) => setScheduleName(event.target.value)}
              placeholder={defaultScheduleName(target)}
              maxLength={40}
            />
          </label>

          <label>
            Target
            <div className="segmented-control">
              <button
                className={target === "pump" ? "segment active" : "segment"}
                type="button"
                onClick={() => setTarget("pump")}
                disabled={saving}
              >
                Pump
              </button>
              <button
                className={target === "heater" ? "segment active" : "segment"}
                type="button"
                onClick={() => setTarget("heater")}
                disabled={saving}
              >
                Heater
              </button>
            </div>
          </label>

          <div className="schedule-time-grid">
            <label>
              Start time
              <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required />
            </label>
            <label>
              End time
              <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required />
            </label>
          </div>

          <div>
            <span className="helper-text">Days of week</span>
            <div className="day-row">
              {dayLabels.map((day, index) => (
                <button
                  className={days.includes(index) ? "day-chip active" : "day-chip"}
                  key={day}
                  type="button"
                  onClick={() => toggleDay(index)}
                  disabled={saving}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          <label className="switch-row">
            <span>Enabled</span>
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={saving} />
          </label>

          {formSuccess ? <div className="success-box">{formSuccess}</div> : null}
          {formError ? <div className="error-box">{formError}</div> : null}

          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? "Saving..." : selectedSchedule ? "Save changes" : "Create schedule"}
          </button>
        </form>
      </section>
      ) : null}

      {schedules.length === 0 && !loading ? (
        <div className="empty-state">
          <CalendarDays size={36} />
          <h3>No schedules yet</h3>
          <p>Create your first schedule above. The ESP32 remains the scheduler and syncs from Supabase.</p>
        </div>
      ) : null}

      {visibleSchedules.map((schedule) => (
        <article className="schedule-card" key={schedule.id}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">{schedule.target}</span>
              <h3>{schedule.name || defaultScheduleName(schedule.target)}</h3>
            </div>
            <button className="icon-button" type="button" onClick={() => loadSchedule(schedule)} aria-label="Edit schedule">
              <PencilLine size={16} />
            </button>
          </div>
          <span className={schedule.enabled ? "schedule-status-pill enabled" : "schedule-status-pill paused"}>
            {schedule.enabled ? "Enabled" : "Paused"}
          </span>
          <strong>
            {formatTime12h(schedule.start_time)} - {formatTime12h(schedule.end_time)}
          </strong>
          <div className="day-row">
            {dayLabels.map((day, index) => (
              <span className={schedule.days_of_week.includes(index) ? "day-chip active" : "day-chip"} key={day}>
                {day}
              </span>
            ))}
          </div>
        </article>
      ))}

      <p className="helper-text">Device: {deviceId}</p>
      {pendingLabel ? <div className="floating-status">{pendingLabel}...</div> : null}
      {commandError ? <div className="error-box">{commandError}</div> : null}
    </div>
  );
}
