import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLatestCommand, sendCommand, type DeviceCommand, type DeviceCommandType } from "../lib/deviceApi";

type CommandState = {
  pendingLabel: string;
  lastCommand: DeviceCommand | null;
  error: string;
  commandHoldMs: number;
};

export function useCommands(userId: string | undefined, onSettled?: () => void) {
  const [state, setState] = useState<CommandState>({
    pendingLabel: "",
    lastCommand: null,
    error: "",
    commandHoldMs: 1400,
  });
  const timeoutRef = useRef<number | null>(null);
  const clearSuccessRef = useRef<number | null>(null);
  const pollingRef = useRef(false);
  const commandTokenRef = useRef(0);
  const avgRoundTripMsRef = useRef(900);

  function getCommandHoldMs() {
    return Math.max(800, Math.min(2500, Math.round(avgRoundTripMsRef.current * 1.25)));
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearInterval(timeoutRef.current);
      if (clearSuccessRef.current) window.clearTimeout(clearSuccessRef.current);
    };
  }, []);

  const runCommand = useCallback(
    async (label: string, commandType: DeviceCommandType, payload: Record<string, unknown> = {}) => {
      if (!userId) return;
      const commandToken = commandTokenRef.current + 1;
      commandTokenRef.current = commandToken;

      if (timeoutRef.current) {
        window.clearInterval(timeoutRef.current);
      }

      setState((current) => ({ pendingLabel: label, lastCommand: null, error: "", commandHoldMs: current.commandHoldMs }));
      if (clearSuccessRef.current) {
        window.clearTimeout(clearSuccessRef.current);
        clearSuccessRef.current = null;
      }

      try {
        const command = await sendCommand(userId, commandType, payload);
        setState((current) => ({ pendingLabel: label, lastCommand: command, error: "", commandHoldMs: current.commandHoldMs }));

        const startedAt = Date.now();
        timeoutRef.current = window.setInterval(async () => {
          if (pollingRef.current) return;
          pollingRef.current = true;

          const latest = await fetchLatestCommand(command.id).finally(() => {
            pollingRef.current = false;
          });
          if (commandTokenRef.current !== commandToken) return;

          const commandDone = latest.status === "completed" || latest.status === "failed";
          const elapsedMs = Date.now() - startedAt;
          if (commandDone) {
            avgRoundTripMsRef.current = Math.round(avgRoundTripMsRef.current * 0.65 + elapsedMs * 0.35);
          }

          setState({
            pendingLabel: commandDone ? "" : label,
            lastCommand: latest,
            error: latest.error ?? "",
            commandHoldMs: getCommandHoldMs(),
          });

          if (latest.status === "completed" || latest.status === "failed" || Date.now() - startedAt > 20000) {
            if (timeoutRef.current) window.clearInterval(timeoutRef.current);
            timeoutRef.current = null;
            onSettled?.();
            if (latest.status === "completed") {
              clearSuccessRef.current = window.setTimeout(() => {
                setState((current) =>
                  current.lastCommand?.id === latest.id
                    ? { ...current, lastCommand: null }
                    : current,
                );
              }, 800);
            }
            if (Date.now() - startedAt > 20000 && latest.status !== "completed") {
              setState((current) => ({
                ...current,
                pendingLabel: "",
                error: "Command timed out waiting for hub confirmation.",
                commandHoldMs: getCommandHoldMs(),
              }));
            }
          }
        }, 1500);
      } catch (err) {
        if (commandTokenRef.current !== commandToken) return;
        setState({
          pendingLabel: "",
          lastCommand: null,
          error: err instanceof Error ? err.message : "Command failed",
          commandHoldMs: getCommandHoldMs(),
        });
      }
    },
    [onSettled, userId],
  );

  return { ...state, runCommand };
}
