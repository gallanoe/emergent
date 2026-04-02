import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { agentStore } from "./agents.svelte";
import type {
  ContainerStatus,
  DisplayAgent,
  DisplayWorkspace,
  DockerStatus,
  SwarmMessageLogEntry,
  SwarmMessagePayload,
  TopologyChangedPayload,
  WorkspaceSummary,
  WorkspaceStatusChangePayload,
} from "./types";

// Import mock data for demo mode
import { appState as mockState } from "./mock-data.svelte";

interface KnownAgent {
  name: string;
  command: string;
  available: boolean;
}

interface Workspace {
  id: string;
  name: string;
  collapsed: boolean;
  containerStatus: ContainerStatus;
  agentIds: string[];
}

function createAppState() {
  let demoMode = $state(
    import.meta.env.VITE_DEMO_MODE === "true" ||
      (globalThis as Record<string, unknown>).__EMERGENT_DEMO_MODE__ === true,
  );
  let workspaces = $state<Workspace[]>([]);
  let selectedAgentId = $state<string | null>(null);
  let knownAgents = $state<KnownAgent[]>([]);
  let agentConnections = $state<Record<string, string[]>>({});
  let swarmMessageLog = $state<SwarmMessageLogEntry[]>([]);
  let selectedWorkspaceId = $state<string | null>(null);
  let activeView = $state<"swarm" | "agent" | "settings" | "terminal">("swarm");
  let dockerStatus = $state<DockerStatus | null>(null);
  let terminalSessionIds = $state<Record<string, string>>({});

  // ── Initialization ────────────────────────────────────────────

  interface AgentSummary {
    id: string;
    cli: string;
    status: string;
    workspace_id: string;
    role?: string;
  }

  async function setupAfterConnect() {
    // Detect Docker availability
    try {
      dockerStatus = await invoke<DockerStatus>("detect_docker");
    } catch {
      dockerStatus = { docker_available: false, docker_version: null };
    }

    // Load existing workspaces
    try {
      const wsList = await invoke<WorkspaceSummary[]>("list_workspaces");
      for (const ws of wsList) {
        workspaces.push({
          id: ws.id,
          name: ws.name,
          collapsed: false,
          containerStatus: ws.container_status,
          agentIds: [],
        });
      }
      if (workspaces.length > 0 && !selectedWorkspaceId) {
        selectedWorkspaceId = workspaces[0]!.id;
      }
      // Refresh known agents for the first running workspace
      const runningWs = workspaces.find((w) => w.containerStatus.state === "running");
      if (runningWs) {
        await refreshKnownAgents(runningWs.id);
      }
    } catch {
      // No workspaces yet
    }

    await agentStore.setupListeners();

    // Listen for workspace status changes
    await listen<WorkspaceStatusChangePayload>("workspace:status-change", (e) => {
      const ws = workspaces.find((w) => w.id === e.payload.workspace_id);
      if (ws) ws.containerStatus = e.payload.status;

      // Refresh known agents when container starts running
      if (e.payload.status.state === "running") {
        refreshKnownAgents(e.payload.workspace_id);
      }

      // Clear terminal session when container stops
      if (e.payload.status.state !== "running") {
        delete terminalSessionIds[e.payload.workspace_id];
      }
    });

    // Listen for swarm messages (global, not per-agent)
    await listen<SwarmMessagePayload>("swarm:message", (e) => {
      const p = e.payload;
      swarmMessageLog.push({
        id: crypto.randomUUID(),
        fromName: p.from_agent_name,
        toName: p.to_agent_name,
        preview: p.body.length > 40 ? p.body.slice(0, 40) + "…" : p.body,
        timestamp: new Date(p.timestamp).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
      });
      // Keep last 50 entries
      if (swarmMessageLog.length > 50) {
        swarmMessageLog.splice(0, swarmMessageLog.length - 50);
      }
    });

    // Listen for topology changes (connections created/removed externally)
    await listen<TopologyChangedPayload>("swarm:topology-changed", (e) => {
      refreshConnections(e.payload.agent_id_a);
      refreshConnections(e.payload.agent_id_b);
    });

    // When an agent is spawned externally (e.g. via MCP tool), pick it up
    agentStore.registerUnknownAgentHandler(() => reconnectToExistingAgents());

    // Reconnect to any existing agents from the daemon
    await reconnectToExistingAgents();
  }

  async function initialize() {
    if (demoMode) return;

    try {
      await setupAfterConnect();
    } catch (e) {
      console.error("Failed to initialize:", e);
    }
  }

  async function refreshKnownAgents(workspaceId: string) {
    try {
      knownAgents = await invoke<KnownAgent[]>("known_agents", { workspaceId });
    } catch {
      knownAgents = [];
    }
  }

  async function reconnectToExistingAgents() {
    const agents = await invoke<AgentSummary[]>("list_agents");
    const newAgents = [];
    for (const agent of agents) {
      // Skip agents already in the local store
      if (agentStore.getAgent(agent.id)) continue;

      // Find workspace by workspace_id
      const workspace = workspaces.find((w) => w.id === agent.workspace_id);
      if (!workspace) continue; // Skip agents with unknown workspaces

      // Register agent in store without spawning (it already exists on daemon)
      const agentName = knownAgents.find((k) => k.command === agent.cli)?.name ?? agent.cli;
      agentStore.registerExistingAgent(agent.id, workspace.id, agent.cli, agentName, agent.role);
      workspace.agentIds.push(agent.id);

      // Replay history — notifications are typed via DaemonNotification union in agent store
      const history = await invoke<Parameters<typeof agentStore.replayNotifications>[0]>(
        "get_history",
        { agentId: agent.id },
      );
      agentStore.replayNotifications(history);

      if (!selectedAgentId) selectedAgentId = agent.id;
      newAgents.push(agent);
    }

    // Refresh connections for all agents (new agents need initial state,
    // existing agents may have gained peers from external connect calls)
    await Promise.all(agents.map((agent) => refreshConnections(agent.id)));
  }

  // ── Workspace management ──────────────────────────────────────

  async function createWorkspace(name: string): Promise<string> {
    const id = await invoke<string>("create_workspace", { name });
    workspaces.push({
      id,
      name,
      collapsed: false,
      containerStatus: { state: "running" },
      agentIds: [],
    });
    selectedWorkspaceId = id;
    activeView = "settings";

    // Refresh known agents now that the container is running
    await refreshKnownAgents(id);

    return id;
  }

  async function addAgentToWorkspace(
    workspaceId: string,
    agentBinary: string,
    agentName: string,
  ): Promise<string> {
    const workspace = workspaces.find((w) => w.id === workspaceId);
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

    const agentId = await agentStore.spawnAgent(workspaceId, agentBinary, agentName);
    workspace.agentIds.push(agentId);

    if (!selectedAgentId) {
      selectedAgentId = agentId;
    }

    return agentId;
  }

  async function killAgent(agentId: string): Promise<void> {
    // Find the agent's position before removing it (for selection logic)
    let nextSelection: string | null = null;
    for (const workspace of workspaces) {
      const idx = workspace.agentIds.indexOf(agentId);
      if (idx === -1) continue;

      // Determine next selection: prefer above, then below, then other workspaces
      if (idx > 0) {
        nextSelection = workspace.agentIds[idx - 1] ?? null;
      } else if (workspace.agentIds.length > 1) {
        nextSelection = workspace.agentIds[idx + 1] ?? null;
      } else {
        // Workspace will be empty — find first agent in any other workspace
        const otherAgent = workspaces
          .filter((w) => w.id !== workspace.id)
          .flatMap((w) => w.agentIds)[0];
        nextSelection = otherAgent ?? null;
      }

      // Remove from workspace
      workspace.agentIds.splice(idx, 1);
      break;
    }

    await agentStore.killAgent(agentId);

    if (selectedAgentId === agentId) {
      selectedAgentId = nextSelection;
    }
  }

  async function startContainer(workspaceId: string) {
    await invoke("start_container", { workspaceId });
  }

  async function stopContainer(workspaceId: string) {
    await invoke("stop_container", { workspaceId });
  }

  async function rebuildContainer(workspaceId: string) {
    await invoke("rebuild_container", { workspaceId });
  }

  async function updateWorkspace(workspaceId: string, name: string) {
    await invoke("update_workspace", { workspaceId, name });
    const ws = workspaces.find((w) => w.id === workspaceId);
    if (ws) ws.name = name;
  }

  async function deleteWorkspace(workspaceId: string) {
    await invoke("delete_workspace", { workspaceId });
    const idx = workspaces.findIndex((w) => w.id === workspaceId);
    if (idx !== -1) workspaces.splice(idx, 1);
    if (selectedWorkspaceId === workspaceId) {
      selectedWorkspaceId = workspaces[0]?.id ?? null;
    }
  }

  function toggleSwarmCollapsed(swarmId: string) {
    if (demoMode) {
      mockState.toggleSwarmCollapsed(swarmId);
      return;
    }
    const workspace = workspaces.find((w) => w.id === swarmId);
    if (workspace) workspace.collapsed = !workspace.collapsed;
  }

  // ── Computed display data ─────────────────────────────────────

  function getDisplayWorkspaces(): DisplayWorkspace[] {
    if (demoMode) return mockState.swarms as unknown as DisplayWorkspace[];
    return workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      collapsed: w.collapsed,
      containerStatus: w.containerStatus,
      agents: w.agentIds
        .map((id) => agentStore.getAgent(id))
        .filter(Boolean)
        .map((conn) => agentStore.toDisplayAgent(conn!)),
    }));
  }

  // ── Swarm connection management ──────────────────────────────

  async function refreshConnections(agentId: string) {
    try {
      const connections = await invoke<string[]>("get_agent_connections", { agentId });
      agentConnections[agentId] = connections;
    } catch {
      // Agent may have been killed
    }
  }

  async function connectAgents(agentIdA: string, agentIdB: string) {
    await invoke("connect_agents", { agentIdA, agentIdB });
    await refreshConnections(agentIdA);
    await refreshConnections(agentIdB);
  }

  async function disconnectAgents(agentIdA: string, agentIdB: string) {
    await invoke("disconnect_agents", { agentIdA, agentIdB });
    await refreshConnections(agentIdA);
    await refreshConnections(agentIdB);
  }

  async function setAgentPermissions(agentId: string, enabled: boolean) {
    agentStore.setManagementPermissions(agentId, enabled);
    await invoke("set_agent_permissions", { agentId, enabled });
  }

  function selectWorkspace(workspaceId: string) {
    selectedWorkspaceId = workspaceId;
    activeView = "swarm";
  }

  function selectAgent(agentId: string) {
    selectedAgentId = agentId;
    // Find which workspace this agent belongs to and select it
    const workspace = workspaces.find((w) => w.agentIds.includes(agentId));
    if (workspace) selectedWorkspaceId = workspace.id;
    activeView = "agent";
  }

  function getSelectedSwarm(): DisplayWorkspace | undefined {
    if (demoMode) {
      const swarmList = mockState.swarms as unknown as DisplayWorkspace[];
      return swarmList.find((s) => s.id === selectedWorkspaceId) ?? swarmList[0];
    }
    const displayWorkspaces = getDisplayWorkspaces();
    return displayWorkspaces.find((w) => w.id === selectedWorkspaceId) ?? displayWorkspaces[0];
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
      return getDisplayWorkspaces();
    },
    get selectedAgent() {
      return getSelectedAgent();
    },
    get knownAgents() {
      return knownAgents;
    },
    get selectedSwarmId() {
      return selectedWorkspaceId;
    },
    get activeView() {
      return activeView;
    },
    set activeView(v: "swarm" | "agent" | "settings" | "terminal") {
      activeView = v;
    },
    get selectedSwarm() {
      return getSelectedSwarm();
    },
    get agentConnections() {
      return agentConnections;
    },
    get swarmMessageLog() {
      return swarmMessageLog;
    },
    get dockerStatus() {
      return dockerStatus;
    },
    initialize,
    createWorkspace,
    addAgentToWorkspace,
    toggleSwarmCollapsed,
    killAgent,
    updateWorkspace,
    deleteWorkspace,
    startContainer,
    stopContainer,
    rebuildContainer,
    sendPrompt: agentStore.sendPrompt,
    cancelPrompt: agentStore.cancelPrompt,
    setConfig: agentStore.setConfig,
    editQueue: agentStore.editQueue,
    setRole: agentStore.setRole,
    registerQueueDumpHandler: agentStore.registerQueueDumpHandler,
    connectAgents,
    disconnectAgents,
    setAgentPermissions,
    selectWorkspace,
    selectAgent,
    refreshConnections,
    get terminalSessionIds() {
      return terminalSessionIds;
    },
    setTerminalSessionId(workspaceId: string, sessionId: string | null) {
      if (sessionId) {
        terminalSessionIds[workspaceId] = sessionId;
      } else {
        delete terminalSessionIds[workspaceId];
      }
    },
  };
}

export const appState = createAppState();
