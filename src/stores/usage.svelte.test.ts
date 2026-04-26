import { describe, it, expect, afterEach } from "vitest";
import { flushSync } from "svelte";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("usageStore", () => {
  // Import the store fresh for each test by re-importing after mocks are cleared.
  // Because the store is a module singleton we reset state indirectly by
  // loading a fresh workspace (which replaces the entries in totalsMap).

  afterEach(() => {
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
});
