import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { agentStore } from "./agents.svelte";
import { dispose as disposeTerminal } from "../components/terminal/terminal-instances";
import { normalizeThreadSummaryStatus } from "./types";
import type {
  ActiveView,
  AgentDefinition,
  ContainerStatus,
  ContainerRuntimeKind,
  ContainerRuntimePreference,
  ContainerRuntimeStatus,
  ConfigOption,
  DisplayAgentDefinition,
  DisplayTask,
  DisplayThread,
  DisplayWorkspace,
  TaskCreatedPayload,
  TaskUpdatedPayload,
  ThreadMapping,
  ThreadSummary,
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
  provider: string;
}

interface HistoryNotification {
  type: string;
  thread_id: string;
}

interface Workspace {
  id: string;
  name: string;
  collapsed: boolean;
  containerStatus: ContainerStatus;
  agentDefinitionIds: string[];
}

function createAppState() {
  let demoMode = $state(
    import.meta.env.VITE_DEMO_MODE === "true" ||
      (globalThis as Record<string, unknown>).__EMERGENT_DEMO_MODE__ === true,
  );
  let workspaces = $state<Workspace[]>([]);
  let selectedAgentId = $state<string | null>(null);
  let selectedThreadId = $state<string | null>(null);
  let agentDefinitions = $state<Record<string, AgentDefinition>>({});
  let knownAgents = $state<KnownAgent[]>([]);
  let agentConnections = $state<Record<string, string[]>>({});
  let selectedWorkspaceId = $state<string | null>(null);
  let activeView = $state<ActiveView>("overview");
  let runtimePreference = $state<ContainerRuntimePreference>({
    selected_runtime: "docker",
  });
  let runtimeStatus = $state<ContainerRuntimeStatus | null>(null);
  let terminalSessionIds = $state<Record<string, string>>({});
  let tasks = $state<Record<string, DisplayTask>>({});
  let selectedTaskId = $state<string | null>(null);
  let taskSidebarMode = $state<"detail" | "create" | null>(null);
  /** Per-agent system prompt; frontend-only (see DisplayAgentDefinition.systemPrompt). */
  let agentSystemPrompts = $state<Record<string, string>>({});
  let initializePromise: Promise<void> | null = null;
  let listenerCleanup: UnlistenFn[] = [];
  let listenersReady = false;

  // ── Initialization ────────────────────────────────────────────

  async function setupAfterConnect() {
    // Load runtime preference and availability first so the app can show the
    // correct unavailable state before workspace-specific views mount.
    try {
      const [preference, status] = await Promise.all([
        invoke<ContainerRuntimePreference>("get_container_runtime_preference"),
        invoke<ContainerRuntimeStatus>("get_container_runtime_status"),
      ]);
      runtimePreference = preference;
      runtimeStatus = status;
    } catch {
      runtimePreference = { selected_runtime: "docker" };
      runtimeStatus = {
        selected_runtime: "docker",
        available: false,
        version: null,
        message: "Failed to detect the selected container runtime.",
      };
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
          agentDefinitionIds: [],
        });
      }
      if (workspaces.length > 0 && !selectedWorkspaceId) {
        selectedWorkspaceId = workspaces[0]!.id;
      }
      // Load agent definitions for each workspace
      for (const ws of workspaces) {
        try {
          const defs = await invoke<AgentDefinition[]>("list_agent_definitions", {
            workspaceId: ws.id,
          });
          for (const def of defs) {
            agentDefinitions[def.id] = def;
            ws.agentDefinitionIds.push(def.id);
          }
        } catch {
          // Workspace may not have any definitions yet
        }
      }

      // Load persisted thread mappings for each workspace
      for (const ws of workspaces) {
        try {
          const mappings = await invoke<ThreadMapping[]>("list_thread_mappings", {
            workspaceId: ws.id,
          });
          for (const mapping of mappings) {
            const def = agentDefinitions[mapping.agent_definition_id];
            if (def) {
              agentStore.registerPersistedThread(
                mapping.thread_id,
                mapping.agent_definition_id,
                def,
                mapping.acp_session_id,
                mapping.task_id,
              );
            }
          }
        } catch {
          // No persisted threads for this workspace
        }
      }

      // Load tasks for each workspace
      for (const ws of workspaces) {
        try {
          const taskList = await invoke<DisplayTask[]>("list_tasks", {
            workspaceId: ws.id,
          });
          for (const task of taskList) {
            tasks[task.id] = task;
          }
        } catch (e) {
          console.warn("Failed to load tasks:", e);
        }
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
    await setupListeners();
    await syncLiveThreads();
  }

  async function syncLiveThreads() {
    const liveThreads = await Promise.all(
      Object.keys(agentDefinitions).map(async (agentId) => {
        const live = await invoke<ThreadSummary[]>("list_threads", { agentId });
        return live.map((thread) => ({ agentId, thread }));
      }),
    );

    for (const { agentId, thread } of liveThreads.flat()) {
      const def = agentDefinitions[agentId];
      if (!def) continue;

      const existing = agentStore.getThread(thread.id);
      if (!existing) {
        const task = Object.values(tasks).find((t) => t.session_id === thread.id);
        agentStore.registerPersistedThread(
          thread.id,
          agentId,
          def,
          thread.acp_session_id,
          task?.id ?? null,
        );
      }

      const [history, configOptions] = await Promise.all([
        invoke<HistoryNotification[]>("get_history", {
          threadId: thread.id,
        }).catch(() => []),
        invoke<ConfigOption[]>("get_thread_config", {
          threadId: thread.id,
        }).catch(() => []),
      ]);

      agentStore.syncThreadSnapshot(thread.id, {
        status: normalizeThreadSummaryStatus(String(thread.status)),
        acpSessionId: thread.acp_session_id,
        history,
        configOptions,
      });
    }
  }

  async function initialize() {
    if (demoMode) {
      mockState.seedDemoMockMetrics();
      const firstWs = (mockState.swarms as unknown as DisplayWorkspace[])[0];
      if (firstWs && !selectedWorkspaceId) {
        selectedWorkspaceId = firstWs.id;
      }
      return;
    }

    if (!initializePromise) {
      initializePromise = setupAfterConnect().catch((e) => {
        initializePromise = null;
        console.error("Failed to initialize:", e);
      });
    }

    await initializePromise;
  }

  async function setupListeners() {
    if (listenersReady) return;

    listenerCleanup.push(
      await listen<WorkspaceStatusChangePayload>("workspace:status-change", (e) => {
        const ws = workspaces.find((w) => w.id === e.payload.workspace_id);
        if (ws) ws.containerStatus = e.payload.status;

        if (e.payload.status.state === "running") {
          refreshKnownAgents(e.payload.workspace_id);
        }

        if (e.payload.status.state !== "running") {
          delete terminalSessionIds[e.payload.workspace_id];
        }
      }),
    );

    listenerCleanup.push(
      await listen<TopologyChangedPayload>("swarm:topology-changed", (e) => {
        refreshConnections(e.payload.thread_id_a);
        refreshConnections(e.payload.thread_id_b);
      }),
    );

    listenerCleanup.push(
      await listen<TaskCreatedPayload>("task:created", (e) => {
        tasks[e.payload.task.id] = e.payload.task;
      }),
    );

    listenerCleanup.push(
      await listen<TaskUpdatedPayload>("task:updated", (e) => {
        const task = e.payload.task;
        tasks[task.id] = task;

        if (task.session_id && !agentStore.getThread(task.session_id)) {
          const def = agentDefinitions[task.agent_id];
          if (def) {
            agentStore.registerPersistedThread(task.session_id, task.agent_id, def, null, task.id);
          }
        }
      }),
    );

    listenersReady = true;
  }

  async function refreshKnownAgents(workspaceId: string) {
    try {
      knownAgents = await invoke<KnownAgent[]>("known_agents", { workspaceId });
    } catch {
      knownAgents = [];
    }
  }

  // ── Workspace management ──────────────────────────────────────

  async function createWorkspace(name: string): Promise<string> {
    const id = await invoke<string>("create_workspace", { name });
    workspaces.push({
      id,
      name,
      collapsed: false,
      containerStatus: { state: "building" },
      agentDefinitionIds: [],
    });
    selectedWorkspaceId = id;
    activeView = "settings";

    return id;
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
    disposeTerminal(workspaceId);
    delete terminalSessionIds[workspaceId];
    const idx = workspaces.findIndex((w) => w.id === workspaceId);
    if (idx !== -1) workspaces.splice(idx, 1);
    if (selectedWorkspaceId === workspaceId) {
      selectedWorkspaceId = workspaces[0]?.id ?? null;
    }
  }

  async function setContainerRuntimePreference(selectedRuntime: ContainerRuntimeKind) {
    runtimePreference = { selected_runtime: selectedRuntime };
    runtimeStatus = await invoke<ContainerRuntimeStatus>("set_container_runtime_preference", {
      selectedRuntime,
    });

    if (
      selectedWorkspaceId &&
      workspaces.find((w) => w.id === selectedWorkspaceId)?.containerStatus.state === "running"
    ) {
      await refreshKnownAgents(selectedWorkspaceId);
    } else {
      knownAgents = [];
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
    if (demoMode) {
      const list = mockState.swarms as unknown as DisplayWorkspace[];
      return list.map((w) => ({
        id: w.id,
        name: w.name,
        collapsed: w.collapsed,
        containerStatus: w.containerStatus,
        agentDefinitions: w.agentDefinitions.map((ad) => ({
          id: ad.id,
          name: ad.name,
          cli: ad.cli,
          provider: ad.provider ?? null,
          systemPrompt: agentSystemPrompts[ad.id] ?? ad.systemPrompt ?? "",
          threads: ad.threads,
        })),
      }));
    }
    return workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      collapsed: w.collapsed,
      containerStatus: w.containerStatus,
      agentDefinitions: (w.agentDefinitionIds ?? [])
        .map((defId): DisplayAgentDefinition | null => {
          const def = agentDefinitions[defId];
          if (!def) return null;
          const threads = agentStore.getThreadsForAgent(defId);
          const displayThreads = threads.map((t) => agentStore.toDisplayThread(t));
          return {
            id: def.id,
            name: def.name,
            cli: def.cli,
            provider: def.provider ?? null,
            systemPrompt: agentSystemPrompts[defId] ?? "",
            threads: displayThreads,
          };
        })
        .filter(Boolean) as DisplayAgentDefinition[],
    }));
  }

  // ── Task management ──────────────────────────────────────────

  const workspaceTasks = $derived(
    demoMode
      ? mockState.getWorkspaceTasks(selectedWorkspaceId)
      : Object.values(tasks).filter((t) => t.workspace_id === selectedWorkspaceId),
  );

  const activeWorkspaceTaskCount = $derived(
    workspaceTasks.filter((t) => t.status === "working" || t.status === "pending").length,
  );

  const agentTasks = $derived(Object.values(tasks).filter((t) => t.agent_id === selectedAgentId));

  function selectTask(taskId: string) {
    selectedTaskId = taskId;
    taskSidebarMode = "detail";
  }

  function openCreateTask() {
    selectedTaskId = null;
    taskSidebarMode = "create";
  }

  function closeTaskSidebar() {
    selectedTaskId = null;
    taskSidebarMode = null;
  }

  function showTasks() {
    activeView = "tasks";
    selectedTaskId = null;
    taskSidebarMode = null;
  }

  function showOverview() {
    activeView = "overview";
  }

  function showAppSettings() {
    activeView = "app-settings";
  }

  function showWorkspaceSettings() {
    activeView = "settings";
  }

  async function createTask(
    workspaceId: string,
    title: string,
    description: string,
    agentId: string,
    blockerIds: string[],
    parentId?: string,
  ): Promise<string> {
    return invoke<string>("create_task", {
      workspaceId,
      title,
      description,
      agentId,
      blockerIds,
      parentId: parentId ?? null,
    });
  }

  // ── Swarm connection management ──────────────────────────────

  async function refreshConnections(agentId: string) {
    try {
      const connections = await invoke<string[]>("get_thread_connections", {
        threadId: agentId,
      });
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

  function selectWorkspace(workspaceId: string) {
    selectedWorkspaceId = workspaceId;
    activeView = "overview";
    // Clear any task sidebar state scoped to the previous workspace
    selectedTaskId = null;
    taskSidebarMode = null;
  }

  function selectAgent(agentId: string) {
    if (demoMode) {
      mockState.selectedAgentId = agentId;
      selectedThreadId = null;
      activeView = "agent-threads";
      return;
    }

    selectedAgentId = agentId;
    selectedThreadId = null;
    // Find which workspace this agent belongs to and select it
    const workspace = workspaces.find((w) => w.agentDefinitionIds.includes(agentId));
    if (workspace) selectedWorkspaceId = workspace.id;
    activeView = "agent-threads";
  }

  function selectThread(threadId: string) {
    if (demoMode) {
      selectedThreadId = threadId;
      const owner = mockState.agentIdForThread(threadId);
      if (owner) mockState.selectedAgentId = owner;
      activeView = "agent-chat";
      return;
    }

    selectedThreadId = threadId;
    activeView = "agent-chat";

    // Ensure the agent is selected (needed when navigating from task views)
    const conn = agentStore.getThread(threadId);
    if (conn && conn.agentDefinitionId && conn.agentDefinitionId !== selectedAgentId) {
      selectedAgentId = conn.agentDefinitionId;
    }

    // Auto-resume dead threads that have a persisted ACP session, but only
    // when the owning workspace's container is actually running — otherwise
    // the backend returns Err synchronously and we'd get stuck in
    // "initializing".
    if (conn && conn.status === "dead" && conn.acpSessionId) {
      const ws = workspaces.find((w) => w.id === conn.workspaceId);
      if (ws?.containerStatus.state === "running") {
        agentStore.resetThreadState(threadId);
        conn.status = "initializing";
        invoke("resume_thread", {
          threadId,
          agentId: conn.agentDefinitionId,
          acpSessionId: conn.acpSessionId,
        }).catch((e: unknown) => {
          console.error("Failed to resume thread:", e);
          conn.status = "dead";
        });
      }
    }
  }

  function getSelectedSwarm(): DisplayWorkspace | undefined {
    if (demoMode) {
      const swarmList = mockState.swarms as unknown as DisplayWorkspace[];
      return swarmList.find((s) => s.id === selectedWorkspaceId) ?? swarmList[0];
    }
    const displayWorkspaces = getDisplayWorkspaces();
    return displayWorkspaces.find((w) => w.id === selectedWorkspaceId) ?? displayWorkspaces[0];
  }

  function getSelectedThread(): DisplayThread | undefined {
    if (demoMode) {
      return mockState.resolveSelectedThread(selectedThreadId);
    }
    // In chat view, look up by thread ID (threads store is keyed by thread ID)
    const lookupId = selectedThreadId ?? selectedAgentId;
    if (!lookupId) return undefined;
    const conn = agentStore.getThread(lookupId);
    if (!conn) return undefined;
    return agentStore.toDisplayThread(conn);
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
      return getSelectedThread();
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
    set activeView(v: ActiveView) {
      activeView = v;
    },
    get selectedSwarm() {
      return getSelectedSwarm();
    },
    get selectedWorkspaceContainerRunning(): boolean {
      if (demoMode) {
        const list = mockState.swarms as unknown as DisplayWorkspace[];
        const ws = list.find((w) => w.id === selectedWorkspaceId) ?? list[0];
        return ws?.containerStatus.state === "running";
      }
      const ws = workspaces.find((w) => w.id === selectedWorkspaceId);
      return ws?.containerStatus.state === "running";
    },
    get agentConnections() {
      return agentConnections;
    },
    get runtimePreference() {
      return runtimePreference;
    },
    get runtimeStatus() {
      return runtimeStatus;
    },
    initialize,
    createWorkspace,
    toggleSwarmCollapsed,
    updateWorkspace,
    deleteWorkspace,
    setContainerRuntimePreference,
    startContainer,
    stopContainer,
    rebuildContainer,
    sendPrompt: agentStore.sendPrompt,
    cancelPrompt: agentStore.cancelPrompt,
    setConfig: agentStore.setConfig,
    editQueue: agentStore.editQueue,
    registerQueueDumpHandler: agentStore.registerQueueDumpHandler,
    connectAgents,
    disconnectAgents,
    selectWorkspace,
    selectAgent,
    selectThread,
    startCreatingAgent() {
      activeView = "create-agent";
    },
    get selectedThreadId() {
      return selectedThreadId;
    },
    get selectedThread() {
      if (demoMode) {
        if (!selectedThreadId) return undefined;
        return mockState.findThread(selectedThreadId);
      }
      if (!selectedThreadId) return undefined;
      const conn = agentStore.getThread(selectedThreadId);
      if (!conn) return undefined;
      return agentStore.toDisplayThread(conn);
    },
    get selectedAgentDef(): DisplayAgentDefinition | undefined {
      if (demoMode) {
        const id = mockState.selectedAgentId;
        if (!id) return undefined;
        const swarmList = mockState.swarms as unknown as DisplayWorkspace[];
        for (const ws of swarmList) {
          const def = ws.agentDefinitions.find((d) => d.id === id);
          if (def) {
            return {
              ...def,
              systemPrompt: agentSystemPrompts[id] ?? def.systemPrompt ?? "",
              threads: def.threads,
            };
          }
        }
        return undefined;
      }
      if (!selectedAgentId) return undefined;
      const def = agentDefinitions[selectedAgentId];
      if (!def) return undefined;
      const threads = agentStore.getThreadsForAgent(selectedAgentId);
      return {
        ...def,
        provider: def.provider ?? null,
        systemPrompt: agentSystemPrompts[selectedAgentId] ?? "",
        threads: threads.map((t) => agentStore.toDisplayThread(t)),
      };
    },
    get agentDefinitionsMap() {
      return agentDefinitions;
    },
    async createAgentDefinition(
      workspaceId: string,
      name: string,
      cli: string,
      provider: string,
    ): Promise<string> {
      const agentId = await invoke<string>("create_agent", {
        workspaceId,
        name,
        cli,
        provider,
      });
      agentDefinitions[agentId] = {
        id: agentId,
        workspace_id: workspaceId,
        name,
        cli,
        provider,
      };
      const ws = workspaces.find((w) => w.id === workspaceId);
      if (ws) ws.agentDefinitionIds.push(agentId);
      return agentId;
    },
    async updateAgentDefinition(agentId: string, name?: string, provider?: string): Promise<void> {
      const payload: Record<string, unknown> = { agentId };
      if (name !== undefined) payload.name = name;
      if (provider !== undefined) payload.provider = provider;
      await invoke("update_agent", payload);
      const def = agentDefinitions[agentId];
      if (def) {
        if (name !== undefined) def.name = name;
        if (provider !== undefined) def.provider = provider || null;
      }
    },
    updateAgentSystemPrompt(agentId: string, next: string) {
      // Display-only until `AgentDefinition` / `update_agent` gain a persisted system-prompt field (post-redesign).
      agentSystemPrompts[agentId] = next;
    },
    async deleteAgentDefinition(agentId: string): Promise<void> {
      await invoke("delete_agent", { agentId });
      delete agentDefinitions[agentId];
      for (const ws of workspaces) {
        ws.agentDefinitionIds = ws.agentDefinitionIds.filter((id) => id !== agentId);
      }
      if (selectedAgentId === agentId) {
        selectedAgentId = null;
        activeView = "overview";
      }
    },
    async spawnThread(agentId: string): Promise<string> {
      const def = agentDefinitions[agentId];
      if (!def) throw new Error(`Agent ${agentId} not found`);
      return agentStore.spawnThread(agentId, def);
    },
    async stopThread(threadId: string): Promise<void> {
      await agentStore.stopThread(threadId);
    },
    async deleteThread(threadId: string): Promise<void> {
      const conn = agentStore.getThread(threadId);
      const workspaceId = conn?.workspaceId ?? selectedWorkspaceId;
      if (!workspaceId) return;
      // Kill on backend and remove persisted mapping
      await invoke("delete_thread", { threadId, workspaceId });
      // Remove from frontend store
      agentStore.deleteThread(threadId);
      // If we're viewing this thread, go back to thread list
      if (selectedThreadId === threadId) {
        selectedThreadId = null;
        activeView = "agent-threads";
      }
    },
    async resumeThread(threadId: string): Promise<void> {
      const conn = agentStore.getThread(threadId);
      if (!conn || !conn.acpSessionId) return;
      const ws = workspaces.find((w) => w.id === conn.workspaceId);
      if (ws?.containerStatus.state !== "running") return;
      agentStore.resetThreadState(threadId);
      conn.status = "initializing";
      try {
        await invoke("resume_thread", {
          threadId,
          agentId: conn.agentDefinitionId,
          acpSessionId: conn.acpSessionId,
        });
      } catch (e) {
        console.error("Failed to resume thread:", e);
        conn.status = "dead";
        throw e;
      }
    },
    refreshConnections,
    get tasks() {
      return tasks;
    },
    get selectedTaskId() {
      return selectedTaskId;
    },
    get taskSidebarMode() {
      return taskSidebarMode;
    },
    get workspaceTasks() {
      return workspaceTasks;
    },
    get activeWorkspaceTaskCount() {
      return activeWorkspaceTaskCount;
    },
    get agentTasks() {
      return agentTasks;
    },
    selectTask,
    openCreateTask,
    closeTaskSidebar,
    showTasks,
    showOverview,
    showAppSettings,
    showWorkspaceSettings,
    createTask,
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
