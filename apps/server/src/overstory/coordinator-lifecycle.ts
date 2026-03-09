import type { ExecResult } from "./cli-bridge.js";
import type { CoordinatorState } from "@emergent/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoordinatorOps {
  status: (cwd: string) => Promise<{ running: boolean; error?: string }>;
  start: (cwd: string) => Promise<ExecResult>;
  stop: (cwd: string) => Promise<ExecResult>;
  hasConfig: (path: string) => boolean;
}

export interface CoordinatorInfo {
  state: CoordinatorState;
  startedByUs: boolean;
  error?: string;
}

interface WorkspaceEntry {
  info: CoordinatorInfo;
  path: string;
  healthTimer: ReturnType<typeof setInterval> | undefined;
}

type StateChangeCallback = (
  workspaceId: string,
  info: CoordinatorInfo,
) => void;

// ---------------------------------------------------------------------------
// Pure reducer functions (testable without side effects)
// ---------------------------------------------------------------------------

const INITIAL_INFO: CoordinatorInfo = {
  state: "idle",
  startedByUs: false,
};

export function reduceOnConfigCheck(
  _state: CoordinatorInfo,
  hasConfig: boolean,
): CoordinatorInfo {
  if (!hasConfig) {
    return { state: "disabled", startedByUs: false };
  }
  return { state: "checking", startedByUs: false };
}

export function reduceOnStatusResult(
  state: CoordinatorInfo,
  status: { running: boolean; error?: string },
): CoordinatorInfo {
  if (status.error) {
    return { state: "error", startedByUs: false, error: status.error };
  }
  if (status.running) {
    return { state: "running", startedByUs: state.startedByUs };
  }
  // Not running — caller decides whether to start
  return { state: "stopped", startedByUs: false };
}

export function reduceOnStartResult(
  _state: CoordinatorInfo,
  result: { ok: boolean; error?: string },
): CoordinatorInfo {
  if (result.ok) {
    return { state: "running", startedByUs: true };
  }
  return {
    state: "error",
    startedByUs: false,
    error: result.error ?? "Start failed",
  };
}

export function reduceOnHealthPoll(
  state: CoordinatorInfo,
  status: { running: boolean; error?: string },
): CoordinatorInfo {
  if (status.error) {
    return { ...state, state: "error", error: status.error };
  }
  if (status.running) {
    return { ...state, state: "running" };
  }
  return { ...state, state: "stopped" };
}

// ---------------------------------------------------------------------------
// Orchestration layer
// ---------------------------------------------------------------------------

const HEALTH_POLL_INTERVAL = 15_000;

export function createCoordinatorLifecycle(
  ops: CoordinatorOps,
  onStateChange: StateChangeCallback,
) {
  const workspaces = new Map<string, WorkspaceEntry>();

  function getInfo(workspaceId: string): CoordinatorInfo {
    return workspaces.get(workspaceId)?.info ?? INITIAL_INFO;
  }

  function updateState(workspaceId: string, info: CoordinatorInfo): void {
    const entry = workspaces.get(workspaceId);
    if (entry) {
      const prev = entry.info;
      entry.info = info;
      if (prev.state !== info.state || prev.error !== info.error) {
        onStateChange(workspaceId, info);
      }
    }
  }

  function startHealthPolling(workspaceId: string, path: string): void {
    const entry = workspaces.get(workspaceId);
    if (!entry || entry.healthTimer) return;

    const timer = setInterval(async () => {
      const current = workspaces.get(workspaceId);
      if (!current) return;

      try {
        const status = await ops.status(path);
        const next = reduceOnHealthPoll(current.info, status);
        updateState(workspaceId, next);
      } catch {
        // Swallow errors in health poll
      }
    }, HEALTH_POLL_INTERVAL);

    // Allow process exit even with timers running
    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }

    entry.healthTimer = timer;
  }

  function stopHealthPolling(workspaceId: string): void {
    const entry = workspaces.get(workspaceId);
    if (entry?.healthTimer) {
      clearInterval(entry.healthTimer);
      entry.healthTimer = undefined;
    }
  }

  async function activateCoordinator(
    workspaceId: string,
    workspacePath: string,
  ): Promise<void> {
    // Initialize entry
    workspaces.set(workspaceId, {
      info: { ...INITIAL_INFO },
      path: workspacePath,
      healthTimer: undefined,
    });

    // Step 1: Check config
    const hasConfig = ops.hasConfig(workspacePath);
    const afterConfig = reduceOnConfigCheck(getInfo(workspaceId), hasConfig);
    updateState(workspaceId, afterConfig);

    if (afterConfig.state === "disabled") return;

    // Step 2: Check status
    try {
      const status = await ops.status(workspacePath);
      const afterStatus = reduceOnStatusResult(getInfo(workspaceId), status);
      updateState(workspaceId, afterStatus);

      if (afterStatus.state === "running") {
        startHealthPolling(workspaceId, workspacePath);
        return;
      }

      if (afterStatus.state === "error") return;
    } catch {
      updateState(workspaceId, {
        state: "error",
        startedByUs: false,
        error: "Status check failed",
      });
      return;
    }

    // Step 3: Start coordinator
    updateState(workspaceId, { state: "starting", startedByUs: false });

    try {
      const result = await ops.start(workspacePath);
      const ok = result.exitCode === 0;

      if (ok) {
        // Brief delay then confirm with status check
        await new Promise((r) => setTimeout(r, 1_000));
        const confirmStatus = await ops.status(workspacePath);
        const afterStart = confirmStatus.running
          ? reduceOnStartResult(getInfo(workspaceId), { ok: true })
          : reduceOnStartResult(getInfo(workspaceId), {
              ok: false,
              error: "Coordinator started but status check failed",
            });
        updateState(workspaceId, afterStart);

        if (afterStart.state === "running") {
          startHealthPolling(workspaceId, workspacePath);
        }
      } else {
        const afterStart = reduceOnStartResult(getInfo(workspaceId), {
          ok: false,
          error: result.stderr || "Start command failed",
        });
        updateState(workspaceId, afterStart);
      }
    } catch (err) {
      updateState(workspaceId, {
        state: "error",
        startedByUs: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function deactivateCoordinator(workspaceId: string): void {
    stopHealthPolling(workspaceId);
    workspaces.delete(workspaceId);
  }

  function getCoordinatorState(workspaceId: string): CoordinatorInfo {
    return getInfo(workspaceId);
  }

  async function manualStart(
    workspaceId: string,
    workspacePath: string,
  ): Promise<CoordinatorInfo> {
    // Re-initialize entry if needed
    if (!workspaces.has(workspaceId)) {
      workspaces.set(workspaceId, {
        info: { ...INITIAL_INFO },
        path: workspacePath,
        healthTimer: undefined,
      });
    }

    updateState(workspaceId, { state: "starting", startedByUs: false });

    try {
      const result = await ops.start(workspacePath);
      const ok = result.exitCode === 0;

      if (ok) {
        await new Promise((r) => setTimeout(r, 1_000));
        const confirmStatus = await ops.status(workspacePath);
        const afterStart = confirmStatus.running
          ? reduceOnStartResult(getInfo(workspaceId), { ok: true })
          : reduceOnStartResult(getInfo(workspaceId), {
              ok: false,
              error: "Start succeeded but status check failed",
            });
        updateState(workspaceId, afterStart);

        if (afterStart.state === "running") {
          startHealthPolling(workspaceId, workspacePath);
        }
        return afterStart;
      }

      const afterStart = reduceOnStartResult(getInfo(workspaceId), {
        ok: false,
        error: result.stderr || "Start command failed",
      });
      updateState(workspaceId, afterStart);
      return afterStart;
    } catch (err) {
      const errorInfo: CoordinatorInfo = {
        state: "error",
        startedByUs: false,
        error: err instanceof Error ? err.message : String(err),
      };
      updateState(workspaceId, errorInfo);
      return errorInfo;
    }
  }

  async function manualStop(
    workspaceId: string,
    workspacePath: string,
  ): Promise<CoordinatorInfo> {
    stopHealthPolling(workspaceId);

    if (!workspaces.has(workspaceId)) {
      workspaces.set(workspaceId, {
        info: { ...INITIAL_INFO },
        path: workspacePath,
        healthTimer: undefined,
      });
    }

    updateState(workspaceId, { state: "stopping", startedByUs: false });

    try {
      await ops.stop(workspacePath);
      const info: CoordinatorInfo = { state: "stopped", startedByUs: false };
      updateState(workspaceId, info);
      return info;
    } catch (err) {
      const errorInfo: CoordinatorInfo = {
        state: "error",
        startedByUs: false,
        error: err instanceof Error ? err.message : String(err),
      };
      updateState(workspaceId, errorInfo);
      return errorInfo;
    }
  }

  function shutdownAll(): void {
    for (const [id] of workspaces) {
      stopHealthPolling(id);
    }
    workspaces.clear();
  }

  return {
    activateCoordinator,
    deactivateCoordinator,
    getCoordinatorState,
    manualStart,
    manualStop,
    shutdownAll,
  };
}

export type CoordinatorLifecycle = ReturnType<typeof createCoordinatorLifecycle>;
