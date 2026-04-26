import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ── Types mirroring Rust AgentUsageTotals / WorkspaceUsageStore ──────────────

export interface AgentUsageTotals {
  agentDefinitionId: string;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  thoughtTokens: number;
  totalTokens: number;
  turnCount: number;
  lastTurnAt: string | null;
  costAmount: number;
  costCurrency: string | null;
}

interface WorkspaceUsageStorePayload {
  agents: Array<{
    agent_definition_id: string;
    input_tokens: number;
    output_tokens: number;
    cached_read_tokens: number;
    cached_write_tokens: number;
    thought_tokens: number;
    total_tokens: number;
    turn_count: number;
    last_turn_at: string | null;
    cost_amount: number;
    cost_currency: string | null;
  }>;
}

// Payload shape emitted by Rust on "thread:turn-usage"
interface TurnUsagePayload {
  thread_id: string;
  workspace_id: string;
  agent_definition_id: string;
  input_tokens: number;
  output_tokens: number;
  cached_read_tokens?: number;
  cached_write_tokens?: number;
  thought_tokens?: number;
  total_tokens: number;
  at: string;
}

// ── Zero-filled default ───────────────────────────────────────────────────────

function emptyTotals(agentDefinitionId: string): AgentUsageTotals {
  return {
    agentDefinitionId,
    inputTokens: 0,
    outputTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    thoughtTokens: 0,
    totalTokens: 0,
    turnCount: 0,
    lastTurnAt: null,
    costAmount: 0,
    costCurrency: null,
  };
}

function fromPayload(raw: WorkspaceUsageStorePayload["agents"][number]): AgentUsageTotals {
  return {
    agentDefinitionId: raw.agent_definition_id,
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    cachedReadTokens: raw.cached_read_tokens,
    cachedWriteTokens: raw.cached_write_tokens,
    thoughtTokens: raw.thought_tokens,
    totalTokens: raw.total_tokens,
    turnCount: raw.turn_count,
    lastTurnAt: raw.last_turn_at ?? null,
    costAmount: raw.cost_amount,
    costCurrency: raw.cost_currency ?? null,
  };
}

// ── Store ─────────────────────────────────────────────────────────────────────

function createUsageStore() {
  // Keyed by agent_definition_id → AgentUsageTotals
  let totalsMap = $state<Record<string, AgentUsageTotals>>({});

  // Tracks which workspace_id is currently being loaded so we can buffer
  // live events that arrive while the async invoke is in-flight.
  let loadingWorkspaceId: string | null = null;

  // The most-recently-requested workspace load. Used to discard results from
  // superseded loads (rapid workspace switching).
  let activeLoad: string | null = $state(null);

  // Buffer holds live TurnUsage events that arrive while loadForWorkspace is
  // in-flight. Once the load completes, buffered deltas are replayed on top
  // of the loaded snapshot to prevent a stale disk read from overwriting them.
  let eventBuffer: TurnUsagePayload[] = [];

  let unlisten: UnlistenFn | null = null;

  function handleTurnUsage(payload: TurnUsagePayload) {
    if (loadingWorkspaceId !== null) {
      // Buffer events arriving during an in-flight load (invariant: exactly
      // one workspace load is in-flight at a time; buffer cleared after load).
      eventBuffer.push(payload);
      return;
    }
    applyDelta(payload);
  }

  function applyDelta(p: TurnUsagePayload) {
    const existing = totalsMap[p.agent_definition_id] ?? emptyTotals(p.agent_definition_id);
    totalsMap[p.agent_definition_id] = {
      ...existing,
      inputTokens: existing.inputTokens + (p.input_tokens ?? 0),
      outputTokens: existing.outputTokens + (p.output_tokens ?? 0),
      cachedReadTokens: existing.cachedReadTokens + (p.cached_read_tokens ?? 0),
      cachedWriteTokens: existing.cachedWriteTokens + (p.cached_write_tokens ?? 0),
      thoughtTokens: existing.thoughtTokens + (p.thought_tokens ?? 0),
      totalTokens: existing.totalTokens + (p.total_tokens ?? 0),
      turnCount: existing.turnCount + 1,
      lastTurnAt: p.at,
    };
  }

  return {
    /** Returns totals for an agent, or a zero-filled default if not tracked. */
    agentTotals(agentDefinitionId: string): AgentUsageTotals {
      return totalsMap[agentDefinitionId] ?? emptyTotals(agentDefinitionId);
    },

    /**
     * Load persisted usage from the backend for the given workspace.
     * While the request is in-flight, incoming "thread:turn-usage" events are
     * buffered. Once the snapshot lands, buffered deltas are applied on top so
     * live data is never overwritten by a stale disk read.
     */
    async loadForWorkspace(workspaceId: string): Promise<void> {
      // Mark this as the active load so stale results from superseded calls
      // are discarded (rapid workspace switching guard).
      activeLoad = workspaceId;
      loadingWorkspaceId = workspaceId;
      eventBuffer = [];

      try {
        const result = await invoke<WorkspaceUsageStorePayload>("get_workspace_usage", {
          workspaceId,
        });

        // Discard if a newer loadForWorkspace call superseded this one.
        if (activeLoad !== workspaceId) return;

        // Replace the entire map with the loaded snapshot so stale totals from
        // prior workspace loads do not bleed through. Guard against null/undefined
        // when Tauri is mocked in tests.
        const next: Record<string, AgentUsageTotals> = {};
        for (const raw of result?.agents ?? []) {
          next[raw.agent_definition_id] = fromPayload(raw);
        }
        totalsMap = next;

        // Replay buffered live events on top of the freshly loaded snapshot.
        const buffered = eventBuffer.splice(0);
        for (const evt of buffered) {
          applyDelta(evt);
        }
      } finally {
        // Only clear loadingWorkspaceId if this load is still the active one.
        if (activeLoad === workspaceId) {
          loadingWorkspaceId = null;
          eventBuffer = [];
        }
      }
    },

    /** Subscribe to live turn-usage events. Call once on app init. */
    async setupListeners(): Promise<void> {
      if (unlisten) return;
      unlisten = await listen<TurnUsagePayload>("thread:turn-usage", (event) => {
        handleTurnUsage(event.payload);
      });
    },

    /** Remove event listeners. */
    teardown() {
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
    },
  };
}

export const usageStore = createUsageStore();
