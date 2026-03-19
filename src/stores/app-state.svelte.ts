import { open } from "@tauri-apps/plugin-dialog";
import { agentStore } from "./agents.svelte";
import type { DisplayAgent, DisplaySwarm } from "./types";

// Import mock data for demo mode
import { appState as mockState } from "./mock-data.svelte";

interface Swarm {
  id: string;
  name: string;
  workingDirectory: string;
  collapsed: boolean;
  agentIds: string[];
}

function createAppState() {
  let demoMode = $state(true);
  let swarms = $state<Swarm[]>([]);
  let selectedAgentId = $state<string | null>(null);
  let availableAgents = $state<
    { name: string; binary: string; path: string }[]
  >([]);

  // ── Initialization ────────────────────────────────────────────

  async function initialize() {
    // TODO: remove hardcoded demo mode
    demoMode = true;
    return;

    const detected = await agentStore.detectAgents();
    availableAgents = detected;

    if (detected.length > 0) {
      demoMode = false;
      await agentStore.setupListeners();
    }
  }

  // ── Swarm management ──────────────────────────────────────────

  function createSwarm(name: string, workingDirectory: string): string {
    const id = crypto.randomUUID();
    swarms.push({ id, name, workingDirectory, collapsed: false, agentIds: [] });
    return id;
  }

  async function addAgentToSwarm(
    swarmId: string,
    agentBinary: string,
  ): Promise<string> {
    const swarm = swarms.find((s) => s.id === swarmId);
    if (!swarm) throw new Error(`Swarm ${swarmId} not found`);

    const agentId = await agentStore.spawnAgent(
      swarmId,
      swarm.workingDirectory,
      agentBinary,
    );
    swarm.agentIds.push(agentId);

    if (!selectedAgentId) {
      selectedAgentId = agentId;
    }

    return agentId;
  }

  async function newSwarm(): Promise<void> {
    if (demoMode || availableAgents.length === 0) return;

    const selected = await open({ directory: true, multiple: false });
    if (!selected) return; // user cancelled

    const path = selected as string;
    const name = path.split("/").pop() || path;
    const swarmId = createSwarm(name, path);

    // Auto-spawn one agent using the first detected CLI
    await addAgentToSwarm(swarmId, availableAgents[0]!.binary);
  }

  function toggleSwarmCollapsed(swarmId: string) {
    if (demoMode) {
      mockState.toggleSwarmCollapsed(swarmId);
      return;
    }
    const swarm = swarms.find((s) => s.id === swarmId);
    if (swarm) swarm.collapsed = !swarm.collapsed;
  }

  // ── Computed display data ─────────────────────────────────────

  function getDisplaySwarms(): DisplaySwarm[] {
    if (demoMode) {
      return mockState.swarms;
    }
    return swarms.map((s) => ({
      id: s.id,
      name: s.name,
      collapsed: s.collapsed,
      agents: s.agentIds
        .map((id) => agentStore.getAgent(id))
        .filter(Boolean)
        .map((conn) => agentStore.toDisplayAgent(conn!)),
    }));
  }

  function getSelectedAgent(): DisplayAgent | undefined {
    if (demoMode) {
      return mockState.selectedAgent;
    }
    if (!selectedAgentId) return undefined;
    const conn = agentStore.getAgent(selectedAgentId);
    if (!conn) return undefined;
    return agentStore.toDisplayAgent(conn);
  }

  return {
    get demoMode() {
      return demoMode;
    },
    set demoMode(v: boolean) {
      demoMode = v;
    },
    get selectedAgentId() {
      if (demoMode) return mockState.selectedAgentId;
      return selectedAgentId;
    },
    set selectedAgentId(id: string | null) {
      if (demoMode) {
        if (id) mockState.selectedAgentId = id;
      } else {
        selectedAgentId = id;
      }
    },
    get swarms() {
      return getDisplaySwarms();
    },
    get selectedAgent() {
      return getSelectedAgent();
    },
    get availableAgents() {
      return availableAgents;
    },
    initialize,
    createSwarm,
    addAgentToSwarm,
    newSwarm,
    toggleSwarmCollapsed,
    sendPrompt: agentStore.sendPrompt,
    cancelPrompt: agentStore.cancelPrompt,
  };
}

export const appState = createAppState();
