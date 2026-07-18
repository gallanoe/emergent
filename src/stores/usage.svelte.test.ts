import { describe, it, expect, afterEach } from "vitest";
import { flushSync } from "svelte";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStorePayload(
  agentId: string,
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
  costAmount = 0,
) {
  return {
    agents: [
      {
        agent_definition_id: agentId,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cached_read_tokens: 0,
        cached_write_tokens: 0,
        thought_tokens: 0,
        total_tokens: totalTokens,
        turn_count: 1,
        last_turn_at: "2026-04-25T10:00:00Z",
        cost_amount: costAmount,
        cost_currency: costAmount > 0 ? "USD" : null,
      },
    ],
  };
}

/** A "thread:turn-usage" event payload, as emitted by the Rust side. */
function makeTurn(agentId: string, overrides: Record<string, unknown> = {}) {
  return {
    thread_id: "th-1",
    workspace_id: "ws-live",
    agent_definition_id: agentId,
    input_tokens: 100,
    output_tokens: 20,
    cached_read_tokens: 5,
    cached_write_tokens: 3,
    thought_tokens: 7,
    total_tokens: 135,
    at: "2026-04-25T11:00:00Z",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("usageStore", () => {
  // Import the store fresh for each test by re-importing after mocks are cleared.
  // Because the store is a module singleton we reset state indirectly by
  // loading a fresh workspace (which replaces the entries in totalsMap).

  afterEach(async () => {
    // Teardown first: unlisten() round-trips through the IPC mock, so clearing
    // the mocks before detaching would leave the singleton holding a dead
    // subscription and make the next setupListeners() a no-op.
    const { usageStore } = await import("./usage.svelte");
    usageStore.teardown();
    clearMocks();
  });

  it("returns zero-filled default for unknown agent", async () => {
    // Dynamically import so the module sees the mocked IPC
    const { usageStore } = await import("./usage.svelte");
    const totals = usageStore.agentTotals("totally-unknown-agent-id");
    expect(totals.totalTokens).toBe(0);
    expect(totals.inputTokens).toBe(0);
    expect(totals.outputTokens).toBe(0);
    expect(totals.costAmount).toBe(0);
    expect(totals.costCurrency).toBeNull();
    expect(totals.turnCount).toBe(0);
  });

  it("loadForWorkspace populates agentTotals from backend snapshot", async () => {
    mockIPC((cmd) => {
      if (cmd === "get_workspace_usage") {
        return makeStorePayload("agent-abc", 1200, 280, 1480, 0.042);
      }
    });

    const { usageStore } = await import("./usage.svelte");
    await usageStore.loadForWorkspace("ws-test-1");
    flushSync();

    const totals = usageStore.agentTotals("agent-abc");
    expect(totals.inputTokens).toBe(1200);
    expect(totals.outputTokens).toBe(280);
    expect(totals.totalTokens).toBe(1480);
    expect(totals.costAmount).toBeCloseTo(0.042);
    expect(totals.costCurrency).toBe("USD");
    expect(totals.turnCount).toBe(1);
  });

  it("loadForWorkspace with empty agents list leaves entry at zero", async () => {
    mockIPC((cmd) => {
      if (cmd === "get_workspace_usage") {
        return { agents: [] };
      }
    });

    const { usageStore } = await import("./usage.svelte");
    await usageStore.loadForWorkspace("ws-empty");
    flushSync();

    const totals = usageStore.agentTotals("no-such-agent");
    expect(totals.totalTokens).toBe(0);
    expect(totals.costAmount).toBe(0);
  });

  it("costAmount defaults to 0 when backend sends 0", async () => {
    mockIPC((cmd) => {
      if (cmd === "get_workspace_usage") {
        return makeStorePayload("agent-nocost", 500, 100, 600, 0);
      }
    });

    const { usageStore } = await import("./usage.svelte");
    await usageStore.loadForWorkspace("ws-nocost");
    flushSync();

    expect(usageStore.agentTotals("agent-nocost").costAmount).toBe(0);
  });

  it("agentTotals returns the correct agent when multiple are loaded", async () => {
    mockIPC((cmd) => {
      if (cmd === "get_workspace_usage") {
        return {
          agents: [
            {
              agent_definition_id: "agent-1",
              input_tokens: 1000,
              output_tokens: 200,
              cached_read_tokens: 0,
              cached_write_tokens: 0,
              thought_tokens: 0,
              total_tokens: 1200,
              turn_count: 3,
              last_turn_at: null,
              cost_amount: 0.01,
              cost_currency: "USD",
            },
            {
              agent_definition_id: "agent-2",
              input_tokens: 500,
              output_tokens: 50,
              cached_read_tokens: 0,
              cached_write_tokens: 0,
              thought_tokens: 0,
              total_tokens: 550,
              turn_count: 1,
              last_turn_at: null,
              cost_amount: 0,
              cost_currency: null,
            },
          ],
        };
      }
    });

    const { usageStore } = await import("./usage.svelte");
    await usageStore.loadForWorkspace("ws-multi");
    flushSync();

    expect(usageStore.agentTotals("agent-1").totalTokens).toBe(1200);
    expect(usageStore.agentTotals("agent-1").turnCount).toBe(3);
    expect(usageStore.agentTotals("agent-2").totalTokens).toBe(550);
    expect(usageStore.agentTotals("agent-2").costAmount).toBe(0);
  });

  // ── Live turn-usage events ──────────────────────────────────────────────────

  describe("live turn-usage events", () => {
    it("accumulates a turn onto a previously untracked agent", async () => {
      mockIPC(() => {}, { shouldMockEvents: true });
      const { usageStore } = await import("./usage.svelte");
      await usageStore.setupListeners();

      await emit("thread:turn-usage", makeTurn("agent-live-1"));
      flushSync();

      const totals = usageStore.agentTotals("agent-live-1");
      expect(totals.inputTokens).toBe(100);
      expect(totals.outputTokens).toBe(20);
      expect(totals.cachedReadTokens).toBe(5);
      expect(totals.cachedWriteTokens).toBe(3);
      expect(totals.thoughtTokens).toBe(7);
      expect(totals.totalTokens).toBe(135);
      expect(totals.turnCount).toBe(1);
      expect(totals.lastTurnAt).toBe("2026-04-25T11:00:00Z");
    });

    it("sums successive turns and advances lastTurnAt", async () => {
      mockIPC(() => {}, { shouldMockEvents: true });
      const { usageStore } = await import("./usage.svelte");
      await usageStore.setupListeners();

      await emit("thread:turn-usage", makeTurn("agent-live-2"));
      await emit(
        "thread:turn-usage",
        makeTurn("agent-live-2", { total_tokens: 65, at: "2026-04-25T12:00:00Z" }),
      );
      flushSync();

      const totals = usageStore.agentTotals("agent-live-2");
      expect(totals.inputTokens).toBe(200);
      expect(totals.totalTokens).toBe(200);
      expect(totals.turnCount).toBe(2);
      expect(totals.lastTurnAt).toBe("2026-04-25T12:00:00Z");
    });

    it("treats omitted optional token fields as zero", async () => {
      mockIPC(() => {}, { shouldMockEvents: true });
      const { usageStore } = await import("./usage.svelte");
      await usageStore.setupListeners();

      await emit("thread:turn-usage", {
        thread_id: "th-2",
        workspace_id: "ws-live",
        agent_definition_id: "agent-sparse",
        input_tokens: 10,
        output_tokens: 2,
        total_tokens: 12,
        at: "2026-04-25T11:30:00Z",
      });
      flushSync();

      const totals = usageStore.agentTotals("agent-sparse");
      expect(totals.cachedReadTokens).toBe(0);
      expect(totals.cachedWriteTokens).toBe(0);
      expect(totals.thoughtTokens).toBe(0);
      expect(totals.totalTokens).toBe(12);
    });

    it("layers a live turn on top of a loaded snapshot for the same agent", async () => {
      mockIPC(
        (cmd) => {
          if (cmd === "get_workspace_usage") {
            return makeStorePayload("agent-layered", 1000, 200, 1200);
          }
        },
        { shouldMockEvents: true },
      );
      const { usageStore } = await import("./usage.svelte");
      await usageStore.setupListeners();
      await usageStore.loadForWorkspace("ws-layered");

      await emit("thread:turn-usage", makeTurn("agent-layered"));
      flushSync();

      const totals = usageStore.agentTotals("agent-layered");
      expect(totals.inputTokens).toBe(1100);
      expect(totals.totalTokens).toBe(1335);
      // The snapshot already recorded one turn; the live event adds a second.
      expect(totals.turnCount).toBe(2);
    });

    it("registers the listener only once across repeated setupListeners calls", async () => {
      const listened: string[] = [];
      mockIPC((cmd, args) => {
        if (cmd === "plugin:event|listen") {
          listened.push((args as { event: string }).event);
          return listened.length;
        }
      });

      const { usageStore } = await import("./usage.svelte");
      await usageStore.setupListeners();
      await usageStore.setupListeners();
      await usageStore.setupListeners();

      expect(listened).toEqual(["thread:turn-usage"]);
    });

    it("stops applying deltas after teardown", async () => {
      mockIPC(() => {}, { shouldMockEvents: true });
      const { usageStore } = await import("./usage.svelte");
      await usageStore.setupListeners();

      await emit("thread:turn-usage", makeTurn("agent-torn"));
      flushSync();
      expect(usageStore.agentTotals("agent-torn").turnCount).toBe(1);

      usageStore.teardown();
      await emit("thread:turn-usage", makeTurn("agent-torn"));
      flushSync();

      expect(usageStore.agentTotals("agent-torn").turnCount).toBe(1);
      expect(usageStore.agentTotals("agent-torn").inputTokens).toBe(100);
    });

    it("buffers events that arrive mid-load and replays them onto the snapshot", async () => {
      let releaseLoad!: (value: unknown) => void;
      mockIPC(
        (cmd) => {
          if (cmd === "get_workspace_usage") {
            return new Promise((resolve) => {
              releaseLoad = resolve;
            });
          }
        },
        { shouldMockEvents: true },
      );

      const { usageStore } = await import("./usage.svelte");
      await usageStore.setupListeners();

      const loading = usageStore.loadForWorkspace("ws-buffered");

      // Arrives while the snapshot request is still in flight.
      await emit("thread:turn-usage", makeTurn("agent-buffered"));
      flushSync();
      // Not applied yet — it is sitting in the buffer.
      expect(usageStore.agentTotals("agent-buffered").turnCount).toBe(0);

      releaseLoad(makeStorePayload("agent-buffered", 1000, 200, 1200));
      await loading;
      flushSync();

      // The snapshot did not clobber the live delta: both are present.
      const totals = usageStore.agentTotals("agent-buffered");
      expect(totals.inputTokens).toBe(1100);
      expect(totals.totalTokens).toBe(1335);
      expect(totals.turnCount).toBe(2);
    });
  });

  // ── Rapid workspace switching ──────────────────────────────────────────────

  it("discards the result of a load that a newer load superseded", async () => {
    const gates: Record<string, (value: unknown) => void> = {};
    mockIPC((cmd, args) => {
      if (cmd === "get_workspace_usage") {
        const id = (args as { workspaceId: string }).workspaceId;
        return new Promise((resolve) => {
          gates[id] = resolve;
        });
      }
    });

    const { usageStore } = await import("./usage.svelte");

    const stale = usageStore.loadForWorkspace("ws-stale");
    const fresh = usageStore.loadForWorkspace("ws-fresh");

    // The superseded request answers first — its snapshot must be thrown away.
    gates["ws-stale"]!(makeStorePayload("agent-stale", 9999, 9999, 19998));
    gates["ws-fresh"]!(makeStorePayload("agent-fresh", 10, 2, 12));
    await Promise.all([stale, fresh]);
    flushSync();

    expect(usageStore.agentTotals("agent-stale").totalTokens).toBe(0);
    expect(usageStore.agentTotals("agent-fresh").totalTokens).toBe(12);
  });

  it("tolerates a backend response with no agents field", async () => {
    mockIPC((cmd) => {
      if (cmd === "get_workspace_usage") return null;
    });

    const { usageStore } = await import("./usage.svelte");
    await usageStore.loadForWorkspace("ws-null");
    flushSync();

    expect(usageStore.agentTotals("anything").totalTokens).toBe(0);
  });

  it("replaces the previous workspace's totals rather than merging them", async () => {
    mockIPC((cmd, args) => {
      if (cmd === "get_workspace_usage") {
        const id = (args as { workspaceId: string }).workspaceId;
        return id === "ws-first"
          ? makeStorePayload("agent-first", 100, 20, 120)
          : makeStorePayload("agent-second", 7, 3, 10);
      }
    });

    const { usageStore } = await import("./usage.svelte");
    await usageStore.loadForWorkspace("ws-first");
    flushSync();
    expect(usageStore.agentTotals("agent-first").totalTokens).toBe(120);

    await usageStore.loadForWorkspace("ws-second");
    flushSync();

    // agent-first belonged to the previous workspace and must not bleed through.
    expect(usageStore.agentTotals("agent-first").totalTokens).toBe(0);
    expect(usageStore.agentTotals("agent-second").totalTokens).toBe(10);
  });
});
