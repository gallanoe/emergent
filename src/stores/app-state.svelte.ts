import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { agentStore } from "./agents.svelte";
import { usageStore } from "./usage.svelte";
import { normalizeThreadSummaryStatus } from "./types";
import { partitionPendingQueue } from "../lib/chat-utils";
import type {
  ActiveView,
  AgentDefinition,
  ConfigOption,
  DisplayAgentDefinition,
  DisplayTask,
  DisplayThread,
  DisplayWorkspace,
  TaskCreatedPayload,
  TaskUpdatedPayload,
  ThreadMapping,
  ThreadSummary,
  WorkspaceSummary,
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
  let selectedWorkspaceId = $state<string | null>(null);
  let activeView = $state<ActiveView>("overview");
  let tasks = $state<Record<string, DisplayTask>>({});
  let selectedTaskId = $state<string | null>(null);
  let taskSidebarMode = $state<"detail" | "create" | null>(null);
  /** Per-agent system prompt; frontend-only (see DisplayAgentDefinition.systemPrompt). */
  let agentSystemPrompts = $state<Record<string, string>>({});
  let initializePromise: Promise<void> | null = null;
  let listenerCleanup: UnlistenFn[] = [];
  let listenersReady = false;
  /** Bumped by teardown so an in-flight setupListeners knows to abandon. */
  let setupEpoch = 0;

  async function setupAfterConnect() {
    try {
      const wsList = await invoke<WorkspaceSummary[]>("list_workspaces");
      for (const ws of wsList) {
        workspaces.push({
          id: ws.id,
          name: ws.name,
          collapsed: false,
          agentDefinitionIds: [],
        });
      }
      if (workspaces.length > 0 && !selectedWorkspaceId) {
        selectedWorkspaceId = workspaces[0]!.id;
      }
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

      // Agent availability is detected on the host PATH (workspace-independent),
      // so refresh once at startup regardless of whether any workspace exists.
      await refreshKnownAgents();
    } catch {
      // No workspaces yet
    }

    await agentStore.setupListeners();
    await usageStore.setupListeners();
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
      const firstWs = (mockState.workspaces as unknown as DisplayWorkspace[])[0];
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

    // See the matching note in agents.svelte.ts: `listen()` is async, so commit
    // the collected unlisteners only if no teardown landed while we awaited.
    const myEpoch = setupEpoch;
    const pending: UnlistenFn[] = [];

    pending.push(
      await listen<TaskCreatedPayload>("task:created", (e) => {
        tasks[e.payload.task.id] = e.payload.task;
      }),
    );

    pending.push(
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

    if (myEpoch !== setupEpoch) {
      for (const unlisten of pending) unlisten();
      return;
    }

    listenerCleanup = pending;
    listenersReady = true;
  }

  /**
   * Tear down every listener this store owns, then the two stores whose
   * listeners `initialize()` sets up — so teardown mirrors setup from one
   * entry point.
   *
   * Also resets `initializePromise` so a later `initialize()` re-runs rather
   * than resolving instantly against the previous run's promise.
   */
  function teardown() {
    setupEpoch += 1;
    for (const unlisten of listenerCleanup) unlisten();
    listenerCleanup = [];
    listenersReady = false;
    initializePromise = null;

    agentStore.teardown();
    usageStore.teardown();
  }

  async function refreshKnownAgents() {
    try {
      knownAgents = await invoke<KnownAgent[]>("known_agents");
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
      agentDefinitionIds: [],
    });
    selectedWorkspaceId = id;
    activeView = "settings";

    // Re-detect available agent CLIs (host-wide) so the agent creator is
    // populated even on a fresh launch where no workspace existed at startup.
    await refreshKnownAgents();

    return id;
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

  function toggleWorkspaceCollapsed(workspaceId: string) {
    if (demoMode) {
      mockState.toggleWorkspaceCollapsed(workspaceId);
      return;
    }
    const workspace = workspaces.find((w) => w.id === workspaceId);
    if (workspace) workspace.collapsed = !workspace.collapsed;
  }

  // ── Computed display data ─────────────────────────────────────

  function getDisplayWorkspaces(): DisplayWorkspace[] {
    if (demoMode) {
      const list = mockState.workspaces as unknown as DisplayWorkspace[];
      return list.map((w) => ({
        id: w.id,
        name: w.name,
        collapsed: w.collapsed,
        agentDefinitions: w.agentDefinitions.map((ad) => ({
          id: ad.id,
          name: ad.name,
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
      agentDefinitions: (w.agentDefinitionIds ?? [])
        .map((defId): DisplayAgentDefinition | null => {
          const def = agentDefinitions[defId];
          if (!def) return null;
          const threads = agentStore.getThreadsForAgent(defId);
          const displayThreads = threads.map((t) => agentStore.toDisplayThread(t));
          return {
            id: def.id,
            name: def.name,
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

  /**
   * Task lookup by id. Demo mode has no backend to populate the `tasks` record,
   * so it is projected from the mock data — otherwise `workspaceTasks` would
   * render a populated table while every by-id lookup against `tasks` returned
   * undefined, leaving the detail sidebar blank and the chat banner missing.
   */
  const tasksById = $derived(
    demoMode ? Object.fromEntries(mockState.allTasks.map((t) => [t.id, t])) : tasks,
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

    // Seed the queue mirror from the backend (the authoritative source) so a
    // thread opened after messages were injected shows its held queue.
    void agentStore.refreshQueue(threadId);

    // Ensure the agent is selected (needed when navigating from task views)
    const conn = agentStore.getThread(threadId);
    if (conn && conn.agentDefinitionId && conn.agentDefinitionId !== selectedAgentId) {
      selectedAgentId = conn.agentDefinitionId;
    }

    // Auto-resume dead threads that have a persisted ACP session.
    if (conn && conn.status === "dead" && conn.acpSessionId) {
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

  function getSelectedWorkspace(): DisplayWorkspace | undefined {
    if (demoMode) {
      const workspaceList = mockState.workspaces as unknown as DisplayWorkspace[];
      return workspaceList.find((s) => s.id === selectedWorkspaceId) ?? workspaceList[0];
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
    get workspaces() {
      return getDisplayWorkspaces();
    },
    get selectedAgent() {
      return getSelectedThread();
    },
    get knownAgents() {
      return knownAgents;
    },
    get selectedWorkspaceId() {
      return selectedWorkspaceId;
    },
    get activeView() {
      return activeView;
    },
    set activeView(v: ActiveView) {
      activeView = v;
    },
    get selectedWorkspace() {
      return getSelectedWorkspace();
    },
    initialize,
    teardown,
    createWorkspace,
    toggleWorkspaceCollapsed,
    updateWorkspace,
    deleteWorkspace,
    sendPrompt: agentStore.sendPrompt,
    cancelPrompt: agentStore.cancelPrompt,
    setConfig: agentStore.setConfig,
    removeQueueItem: agentStore.removeQueueItem,
    updateQueueItem: agentStore.updateQueueItem,
    clearQueue: agentStore.clearQueue,
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
    get selectedThreadPendingQueue() {
      if (!selectedThreadId) return [];
      return agentStore.getThread(selectedThreadId)?.pendingQueue ?? [];
    },
    get selectedThreadComposerQueue() {
      if (!selectedThreadId) return [];
      return partitionPendingQueue(agentStore.getThread(selectedThreadId)?.pendingQueue ?? [])
        .composer;
    },
    get selectedThreadNotificationQueue() {
      if (!selectedThreadId) return [];
      return partitionPendingQueue(agentStore.getThread(selectedThreadId)?.pendingQueue ?? [])
        .notifications;
    },
    get selectedAgentDef(): DisplayAgentDefinition | undefined {
      if (demoMode) {
        const id = mockState.selectedAgentId;
        if (!id) return undefined;
        const workspaceList = mockState.workspaces as unknown as DisplayWorkspace[];
        for (const ws of workspaceList) {
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
      provider: string,
    ): Promise<string> {
      const agentId = await invoke<string>("create_agent", {
        workspaceId,
        name,
        provider,
      });
      agentDefinitions[agentId] = {
        id: agentId,
        workspace_id: workspaceId,
        name,
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
    get tasks() {
      return tasksById;
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
  };
}

export const appState = createAppState();
