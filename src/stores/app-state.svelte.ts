import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { agentStore } from "./agents.svelte";
import type { DisplayAgent, DisplaySwarm } from "./types";

// Import mock data for demo mode
import { appState as mockState } from "./mock-data.svelte";

interface KnownAgent {
  name: string;
  command: string;
  available: boolean;
}

interface Swarm {
  id: string;
  name: string;
  workingDirectory: string;
  collapsed: boolean;
  agentIds: string[];
}

type DaemonStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

function createAppState() {
  let demoMode = $state(import.meta.env.VITE_DEMO_MODE === "true");
  let swarms = $state<Swarm[]>([]);
  let selectedAgentId = $state<string | null>(null);
  let availableAgents = $state<{ name: string; binary: string; path: string }[]>([]);
  let knownAgents = $state<KnownAgent[]>([]);
  let daemonStatus = $state<DaemonStatus>("connecting");

  // ── Initialization ────────────────────────────────────────────

  interface AgentSummary {
    id: string;
    cli: string;
    status: string;
    working_directory: string;
  }

  async function initialize() {
    if (demoMode) return;

    try {
      daemonStatus = "connecting";
      const status = await invoke<string>("get_daemon_status");
      daemonStatus = status as DaemonStatus;

      if (daemonStatus !== "connected") return;

      const detected = await agentStore.detectAgents();
      availableAgents = detected;

      const known = await invoke<KnownAgent[]>("known_agents");
      knownAgents = known;

      await agentStore.setupListeners();

      // Reconnect to any existing agents from the daemon
      await reconnectToExistingAgents();
    } catch {
      daemonStatus = "disconnected";
    }
  }

  async function reconnectToExistingAgents() {
    const agents = await invoke<AgentSummary[]>("list_agents");
    for (const agent of agents) {
      // Find or create swarm by working_directory
      let swarm = swarms.find((s) => s.workingDirectory === agent.working_directory);
      if (!swarm) {
        const name = agent.working_directory.split("/").pop() || agent.working_directory;
        const id = createSwarm(name, agent.working_directory);
        swarm = swarms.find((s) => s.id === id)!;
      }

      // Register agent in store without spawning (it already exists on daemon)
      agentStore.registerExistingAgent(agent.id, swarm.id, agent.cli);
      swarm.agentIds.push(agent.id);

      // Replay history
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const history = await invoke<any[]>("get_history", { agentId: agent.id });
      agentStore.replayNotifications(history);

      if (!selectedAgentId) selectedAgentId = agent.id;
    }
  }

  // ── Swarm management ──────────────────────────────────────────

  function createSwarm(name: string, workingDirectory: string): string {
    const id = crypto.randomUUID();
    swarms.push({ id, name, workingDirectory, collapsed: false, agentIds: [] });
    return id;
  }

  async function addAgentToSwarm(swarmId: string, agentBinary: string): Promise<string> {
    const swarm = swarms.find((s) => s.id === swarmId);
    if (!swarm) throw new Error(`Swarm ${swarmId} not found`);

    const agentId = await agentStore.spawnAgent(swarmId, swarm.workingDirectory, agentBinary);
    swarm.agentIds.push(agentId);

    if (!selectedAgentId) {
      selectedAgentId = agentId;
    }

    return agentId;
  }

  async function newSwarm(): Promise<void> {
    if (demoMode) return;

    const selected = await open({ directory: true, multiple: false });
    if (!selected) return; // user cancelled

    const path = selected as string;
    const name = path.split("/").pop() || path;
    createSwarm(name, path);
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
    get knownAgents() {
      return knownAgents;
    },
    get daemonStatus() {
      return daemonStatus;
    },
    initialize,
    createSwarm,
    addAgentToSwarm,
    newSwarm,
    toggleSwarmCollapsed,
    sendPrompt: agentStore.sendPrompt,
    cancelPrompt: agentStore.cancelPrompt,
    editQueue: agentStore.editQueue,
    registerQueueDumpHandler: agentStore.registerQueueDumpHandler,
  };
}

export const appState = createAppState();
