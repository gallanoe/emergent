import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  reduceOnConfigCheck,
  reduceOnStatusResult,
  reduceOnStartResult,
  reduceOnHealthPoll,
  createCoordinatorLifecycle,
} from "./coordinator-lifecycle.js";
import type { CoordinatorOps, CoordinatorInfo } from "./coordinator-lifecycle.js";

// ---------------------------------------------------------------------------
// Pure reducer tests
// ---------------------------------------------------------------------------

describe("reduceOnConfigCheck", () => {
  const idle: CoordinatorInfo = { state: "idle", startedByUs: false };

  it("returns disabled when no config", () => {
    expect(reduceOnConfigCheck(idle, false)).toEqual({
      state: "disabled",
      startedByUs: false,
    });
  });

  it("returns checking when config exists", () => {
    expect(reduceOnConfigCheck(idle, true)).toEqual({
      state: "checking",
      startedByUs: false,
    });
  });
});

describe("reduceOnStatusResult", () => {
  const checking: CoordinatorInfo = { state: "checking", startedByUs: false };

  it("returns running when coordinator is running", () => {
    expect(reduceOnStatusResult(checking, { running: true })).toEqual({
      state: "running",
      startedByUs: false,
    });
  });

  it("preserves startedByUs when running", () => {
    const started: CoordinatorInfo = { state: "checking", startedByUs: true };
    expect(reduceOnStatusResult(started, { running: true })).toEqual({
      state: "running",
      startedByUs: true,
    });
  });

  it("returns stopped when not running", () => {
    expect(reduceOnStatusResult(checking, { running: false })).toEqual({
      state: "stopped",
      startedByUs: false,
    });
  });

  it("returns error when status has error", () => {
    expect(
      reduceOnStatusResult(checking, { running: false, error: "ov_not_found" }),
    ).toEqual({
      state: "error",
      startedByUs: false,
      error: "ov_not_found",
    });
  });
});

describe("reduceOnStartResult", () => {
  const starting: CoordinatorInfo = { state: "starting", startedByUs: false };

  it("returns running with startedByUs on success", () => {
    expect(reduceOnStartResult(starting, { ok: true })).toEqual({
      state: "running",
      startedByUs: true,
    });
  });

  it("returns error on failure", () => {
    expect(
      reduceOnStartResult(starting, { ok: false, error: "tmux not found" }),
    ).toEqual({
      state: "error",
      startedByUs: false,
      error: "tmux not found",
    });
  });
});

describe("reduceOnHealthPoll", () => {
  const running: CoordinatorInfo = { state: "running", startedByUs: true };

  it("stays running when still running", () => {
    expect(reduceOnHealthPoll(running, { running: true })).toEqual({
      state: "running",
      startedByUs: true,
    });
  });

  it("transitions to stopped when no longer running", () => {
    expect(reduceOnHealthPoll(running, { running: false })).toEqual({
      state: "stopped",
      startedByUs: true,
    });
  });

  it("transitions to error on error", () => {
    expect(
      reduceOnHealthPoll(running, { running: false, error: "connection lost" }),
    ).toEqual({
      state: "error",
      startedByUs: true,
      error: "connection lost",
    });
  });
});

// ---------------------------------------------------------------------------
// Orchestration tests
// ---------------------------------------------------------------------------

describe("createCoordinatorLifecycle", () => {
  let mockOps: CoordinatorOps;
  let onStateChange: ReturnType<typeof vi.fn<(workspaceId: string, info: CoordinatorInfo) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockOps = {
      status: vi.fn().mockResolvedValue({ running: false }),
      start: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
      stop: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
      hasConfig: vi.fn().mockReturnValue(true),
    };
    onStateChange = vi.fn<(workspaceId: string, info: CoordinatorInfo) => void>();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets disabled when hasConfig returns false", async () => {
    vi.mocked(mockOps.hasConfig).mockReturnValue(false);
    const lifecycle = createCoordinatorLifecycle(mockOps, onStateChange);

    await lifecycle.activateCoordinator("ws-1", "/path");

    expect(mockOps.status).not.toHaveBeenCalled();
    expect(lifecycle.getCoordinatorState("ws-1").state).toBe("disabled");
    expect(onStateChange).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ state: "disabled" }),
    );
  });

  it("detects already-running coordinator without starting", async () => {
    vi.mocked(mockOps.status).mockResolvedValue({ running: true });
    const lifecycle = createCoordinatorLifecycle(mockOps, onStateChange);

    await lifecycle.activateCoordinator("ws-1", "/path");

    expect(mockOps.start).not.toHaveBeenCalled();
    expect(lifecycle.getCoordinatorState("ws-1").state).toBe("running");
    expect(lifecycle.getCoordinatorState("ws-1").startedByUs).toBe(false);
  });

  it("starts coordinator when not running", async () => {
    // First status call: not running. Second (confirmation): running.
    vi.mocked(mockOps.status)
      .mockResolvedValueOnce({ running: false })
      .mockResolvedValueOnce({ running: true });
    const lifecycle = createCoordinatorLifecycle(mockOps, onStateChange);

    const promise = lifecycle.activateCoordinator("ws-1", "/path");
    // Fast-forward past the 1s confirmation delay
    await vi.advanceTimersByTimeAsync(1_500);
    await promise;

    expect(mockOps.start).toHaveBeenCalled();
    expect(lifecycle.getCoordinatorState("ws-1").state).toBe("running");
    expect(lifecycle.getCoordinatorState("ws-1").startedByUs).toBe(true);
  });

  it("sets error when start fails", async () => {
    vi.mocked(mockOps.status).mockResolvedValue({ running: false });
    vi.mocked(mockOps.start).mockResolvedValue({
      stdout: "",
      stderr: "tmux not found",
      exitCode: 1,
    });
    const lifecycle = createCoordinatorLifecycle(mockOps, onStateChange);

    await lifecycle.activateCoordinator("ws-1", "/path");

    expect(lifecycle.getCoordinatorState("ws-1").state).toBe("error");
    expect(onStateChange).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ state: "error" }),
    );
  });

  it("deactivateCoordinator does NOT call stop", () => {
    const lifecycle = createCoordinatorLifecycle(mockOps, onStateChange);

    // Manually set up a workspace entry via activate
    lifecycle.deactivateCoordinator("ws-1");

    expect(mockOps.stop).not.toHaveBeenCalled();
  });

  it("health poll detects state change", async () => {
    vi.mocked(mockOps.status).mockResolvedValue({ running: true });
    const lifecycle = createCoordinatorLifecycle(mockOps, onStateChange);

    await lifecycle.activateCoordinator("ws-1", "/path");
    onStateChange.mockClear();

    // Now coordinator stops externally
    vi.mocked(mockOps.status).mockResolvedValue({ running: false });

    // Advance past health poll interval (15s)
    await vi.advanceTimersByTimeAsync(15_000);

    // Wait for the async poll to complete
    await vi.advanceTimersByTimeAsync(100);

    expect(onStateChange).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ state: "stopped" }),
    );
  });

  it("shutdownAll clears all health timers", async () => {
    vi.mocked(mockOps.status).mockResolvedValue({ running: true });
    const lifecycle = createCoordinatorLifecycle(mockOps, onStateChange);

    await lifecycle.activateCoordinator("ws-1", "/path");
    await lifecycle.activateCoordinator("ws-2", "/path2");

    lifecycle.shutdownAll();

    // Verify no more polls fire
    onStateChange.mockClear();
    vi.mocked(mockOps.status).mockClear();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockOps.status).not.toHaveBeenCalled();
  });
});
