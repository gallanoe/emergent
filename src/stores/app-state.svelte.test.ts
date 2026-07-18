import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { appState } from "./app-state.svelte";
import { agentStore } from "./agents.svelte";
import type { DisplayTask } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

type IPCHandlers = Record<string, (args: Record<string, unknown>) => unknown>;

/**
 * Installs an IPC mock that also plays the role of the Tauri event plugin, so
 * `listen()` registrations can be counted and their handlers invoked directly.
 * We drive the event plugin by hand (rather than `shouldMockEvents`) because
 * some tests need to run code *during* a `listen()` round-trip.
 */
function installIPC(handlers: IPCHandlers = {}) {
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const listeners = new Map<string, number[]>();
  let unlistenCount = 0;

  mockIPC((cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    if (cmd === "plugin:event|listen") {
      const event = a.event as string;
      const handler = a.handler as number;
      const existing = listeners.get(event) ?? [];
      existing.push(handler);
      listeners.set(event, existing);
      // Let a test observe (and interfere) mid-setup.
      handlers["plugin:event|listen"]?.(a);
      return handler;
    }
    if (cmd === "plugin:event|unlisten") {
      unlistenCount += 1;
      return null;
    }
    calls.push({ cmd, args: a });
    const handler = handlers[cmd];
    if (handler) return handler(a);
    return null;
  });

  return {
    calls,
    /** Commands invoked, in order. */
    get cmds() {
      return calls.map((c) => c.cmd);
    },
    argsFor(cmd: string) {
      return calls.find((c) => c.cmd === cmd)?.args;
    },
    countOf(cmd: string) {
      return calls.filter((c) => c.cmd === cmd).length;
    },
    get listenedEvents() {
      return [...listeners.keys()];
    },
    get unlistenCount() {
      return unlistenCount;
    },
    /** Deliver an event to every handler still registered for it. */
    emit(event: string, payload: unknown) {
      const internals = (globalThis as Record<string, any>).__TAURI_INTERNALS__;
      for (const id of listeners.get(event) ?? []) {
        internals.runCallback(id, { event, id, payload });
      }
    },
  };
}

function makeTask(over: Partial<DisplayTask> & { id: string }): DisplayTask {
  return {
    title: "task",
    description: "",
    status: "pending",
    parent_id: null,
    blocker_ids: [],
    agent_id: "agent-x",
    session_id: null,
    workspace_id: "ws-x",
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function defineAgent(agentId: string, workspaceId: string, over: Record<string, unknown> = {}) {
  appState.agentDefinitionsMap[agentId] = {
    id: agentId,
    workspace_id: workspaceId,
    name: agentId,
    provider: "claude",
    ...over,
  };
}

/**
 * `appState` is a module singleton, so every test has to hand the store back in
 * a pristine state: no workspaces, no agent definitions, no tasks, no threads,
 * and no lingering selection.
 */
async function resetStore() {
  installIPC();
  appState.demoMode = false;
  appState.teardown();

  const threadId = appState.selectedThreadId;
  if (threadId) {
    // `deleteThread` is the only path that clears `selectedThreadId`; it needs a
    // resolvable workspace, which the injected thread provides.
    agentStore._test.injectThread(threadId, {
      id: threadId,
      agentDefinitionId: "reset",
    });
    await appState.deleteThread(threadId);
  }

  for (const id of appState.workspaces.map((w) => w.id)) {
    await appState.deleteWorkspace(id);
  }
  // A selection can point at an id that was never in `workspaces` (several tests
  // call `selectWorkspace` with a synthetic id); deleting it is the only public
  // path back to a null selection.
  if (appState.selectedWorkspaceId) {
    await appState.deleteWorkspace(appState.selectedWorkspaceId);
  }
  for (const id of Object.keys(appState.agentDefinitionsMap)) {
    delete appState.agentDefinitionsMap[id];
  }
  for (const id of Object.keys(appState.tasks)) {
    delete appState.tasks[id];
  }
  for (const id of Object.keys(agentStore.threads)) {
    agentStore._test.removeThread(id);
  }
  appState.selectedAgentId = null;
  appState.closeTaskSidebar();
  appState.activeView = "overview";
  flushSync();
  clearMocks();
}

afterEach(async () => {
  await resetStore();
  vi.restoreAllMocks();
});

// ── Existing coverage ─────────────────────────────────────────────────────────

describe("appState.updateAgentSystemPrompt", () => {
  const agentId = "vitest-system-prompt-agent";

  beforeEach(() => {
    appState.demoMode = false;
    flushSync();
  });

  afterEach(() => {
    appState.updateAgentSystemPrompt(agentId, "");
    delete appState.agentDefinitionsMap[agentId];
    appState.selectedAgentId = null;
    flushSync();
  });

  it("updates selectedAgentDef.systemPrompt without invoking the backend", () => {
    appState.agentDefinitionsMap[agentId] = {
      id: agentId,
      workspace_id: "ws-vitest",
      name: "Vitest agent",
      provider: "claude",
    };
    appState.selectedAgentId = agentId;
    flushSync();

    expect(appState.selectedAgentDef?.systemPrompt).toBe("");

    appState.updateAgentSystemPrompt(agentId, "You are concise.");
    flushSync();

    expect(appState.selectedAgentDef?.systemPrompt).toBe("You are concise.");
  });
});

// ── initialize() ──────────────────────────────────────────────────────────────

describe("appState.initialize", () => {
  it("hydrates workspaces, agent definitions, threads, tasks and known agents", async () => {
    const ipc = installIPC({
      list_workspaces: () => [
        { id: "ws-a", name: "Alpha" },
        { id: "ws-b", name: "Beta" },
      ],
      list_agent_definitions: (a) =>
        a.workspaceId === "ws-a"
          ? [
              {
                id: "ag-1",
                workspace_id: "ws-a",
                name: "Claude",
                provider: "claude",
              },
            ]
          : [],
      list_thread_mappings: (a) =>
        a.workspaceId === "ws-a"
          ? [
              {
                thread_id: "th-1",
                agent_definition_id: "ag-1",
                acp_session_id: "acp-1",
              },
            ]
          : [],
      list_tasks: (a) =>
        a.workspaceId === "ws-a" ? [makeTask({ id: "tk-1", workspace_id: "ws-a" })] : [],
      known_agents: () => [
        {
          name: "claude",
          command: "claude",
          available: true,
          provider: "claude",
        },
      ],
      list_threads: () => [],
    });

    await appState.initialize();
    flushSync();

    expect(appState.workspaces.map((w) => w.name)).toEqual(["Alpha", "Beta"]);
    expect(appState.selectedWorkspaceId).toBe("ws-a");
    expect(appState.workspaces[0]!.agentDefinitions.map((d) => d.id)).toEqual(["ag-1"]);
    expect(agentStore.getThread("th-1")?.acpSessionId).toBe("acp-1");
    expect(appState.tasks["tk-1"]?.workspace_id).toBe("ws-a");
    expect(appState.knownAgents.map((k) => k.name)).toEqual(["claude"]);
    // Task listeners were wired as part of initialization.
    expect(ipc.listenedEvents).toContain("task:created");
    expect(ipc.listenedEvents).toContain("task:updated");
  });

  it("is idempotent — a second call reuses the memoized promise", async () => {
    const ipc = installIPC({
      list_workspaces: () => [{ id: "ws-a", name: "Alpha" }],
    });

    await appState.initialize();
    const firstCount = ipc.countOf("list_workspaces");
    await appState.initialize();

    expect(firstCount).toBe(1);
    expect(ipc.countOf("list_workspaces")).toBe(1);
    expect(appState.workspaces).toHaveLength(1);
  });

  it("survives per-workspace failures for definitions, mappings and tasks", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installIPC({
      list_workspaces: () => [{ id: "ws-a", name: "Alpha" }],
      list_agent_definitions: () => {
        throw new Error("no defs");
      },
      list_thread_mappings: () => {
        throw new Error("no mappings");
      },
      list_tasks: () => {
        throw new Error("no tasks");
      },
      known_agents: () => {
        throw new Error("detection failed");
      },
    });

    await appState.initialize();
    flushSync();

    expect(appState.workspaces).toHaveLength(1);
    expect(appState.workspaces[0]!.agentDefinitions).toEqual([]);
    expect(appState.knownAgents).toEqual([]);
    expect(warn).toHaveBeenCalledWith("Failed to load tasks:", expect.anything());
  });

  it("skips thread mappings whose agent definition is unknown", async () => {
    installIPC({
      list_workspaces: () => [{ id: "ws-a", name: "Alpha" }],
      list_agent_definitions: () => [],
      list_thread_mappings: () => [
        {
          thread_id: "th-orphan",
          agent_definition_id: "missing",
          acp_session_id: null,
        },
      ],
      list_tasks: () => [],
      known_agents: () => [],
      list_threads: () => [],
    });

    await appState.initialize();

    expect(agentStore.getThread("th-orphan")).toBeUndefined();
  });

  it("tolerates list_workspaces failing outright", async () => {
    installIPC({
      list_workspaces: () => {
        throw new Error("backend down");
      },
      list_threads: () => [],
    });

    await appState.initialize();
    flushSync();

    expect(appState.workspaces).toEqual([]);
    expect(appState.selectedWorkspaceId).toBeNull();
  });

  it("logs and clears the memoized promise when setup rejects", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ipc = installIPC({
      list_workspaces: () => [{ id: "ws-a", name: "Alpha" }],
      list_agent_definitions: () => [
        {
          id: "ag-1",
          workspace_id: "ws-a",
          name: "A",
          provider: null,
        },
      ],
      list_thread_mappings: () => [],
      list_tasks: () => [],
      known_agents: () => [],
      // syncLiveThreads runs outside the swallowing try/catch.
      list_threads: () => {
        throw new Error("threads unavailable");
      },
    });

    await appState.initialize();

    expect(error).toHaveBeenCalledWith("Failed to initialize:", expect.anything());

    // The promise was reset, so a retry actually re-runs setup.
    const before = ipc.countOf("list_workspaces");
    await appState.initialize();
    expect(ipc.countOf("list_workspaces")).toBe(before + 1);
  });

  it("does nothing but pick a demo workspace when demoMode is on", async () => {
    const ipc = installIPC({
      list_workspaces: () => [{ id: "ws-a", name: "Alpha" }],
    });
    appState.demoMode = true;

    await appState.initialize();
    flushSync();

    expect(ipc.cmds).toEqual([]);
    expect(appState.selectedWorkspaceId).toBe("ws1");
  });
});

// ── syncLiveThreads ───────────────────────────────────────────────────────────

describe("appState live-thread sync", () => {
  function liveThreadIPC(over: IPCHandlers = {}) {
    return installIPC({
      list_workspaces: () => [{ id: "ws-a", name: "Alpha" }],
      list_agent_definitions: () => [
        {
          id: "ag-1",
          workspace_id: "ws-a",
          name: "A",
          provider: "claude",
        },
      ],
      list_thread_mappings: () => [],
      list_tasks: () => [
        makeTask({
          id: "tk-1",
          workspace_id: "ws-a",
          agent_id: "ag-1",
          session_id: "th-live",
        }),
      ],
      known_agents: () => [],
      list_threads: () => [
        {
          id: "th-live",
          agent_id: "ag-1",
          status: "idle",
          workspace_id: "ws-a",
          acp_session_id: "acp-live",
        },
      ],
      get_history: () => [],
      get_thread_config: () => [
        { id: "model", name: "Model", options: [], currentValue: "sonnet" },
      ],
      ...over,
    });
  }

  it("registers unseen live threads and links them to their task", async () => {
    liveThreadIPC();

    await appState.initialize();
    flushSync();

    const thread = agentStore.getThread("th-live");
    expect(thread?.taskId).toBe("tk-1");
    expect(thread?.status).toBe("idle");
    expect(thread?.acpSessionId).toBe("acp-live");
    expect(thread?.configOptions).toHaveLength(1);
  });

  it("falls back to empty history/config when those calls fail", async () => {
    liveThreadIPC({
      get_history: () => {
        throw new Error("nope");
      },
      get_thread_config: () => {
        throw new Error("nope");
      },
    });

    await appState.initialize();
    flushSync();

    const thread = agentStore.getThread("th-live");
    expect(thread?.configOptions).toEqual([]);
    expect(thread?.messages).toEqual([]);
  });

  it("coerces an unrecognized backend status to dead", async () => {
    liveThreadIPC({
      list_threads: () => [
        {
          id: "th-live",
          agent_id: "ag-1",
          status: "who-knows",
          workspace_id: "ws-a",
          acp_session_id: null,
        },
      ],
    });

    await appState.initialize();
    flushSync();

    expect(agentStore.getThread("th-live")?.status).toBe("dead");
  });
});

// ── Listeners / teardown ──────────────────────────────────────────────────────

describe("appState task listeners", () => {
  async function initWithAgent() {
    const ipc = installIPC({
      list_workspaces: () => [{ id: "ws-a", name: "Alpha" }],
      list_agent_definitions: () => [
        {
          id: "ag-1",
          workspace_id: "ws-a",
          name: "A",
          provider: "claude",
        },
      ],
      list_thread_mappings: () => [],
      list_tasks: () => [],
      known_agents: () => [],
      list_threads: () => [],
    });
    await appState.initialize();
    flushSync();
    return ipc;
  }

  it("records tasks arriving on task:created", async () => {
    const ipc = await initWithAgent();

    ipc.emit("task:created", {
      task: makeTask({ id: "tk-new", workspace_id: "ws-a" }),
    });
    flushSync();

    expect(appState.tasks["tk-new"]?.id).toBe("tk-new");
    expect(appState.workspaceTasks.map((t) => t.id)).toEqual(["tk-new"]);
  });

  it("registers a persisted thread the first time task:updated names a session", async () => {
    const ipc = await initWithAgent();

    ipc.emit("task:updated", {
      task: makeTask({
        id: "tk-1",
        workspace_id: "ws-a",
        agent_id: "ag-1",
        session_id: "th-from-task",
        status: "working",
      }),
    });
    flushSync();

    expect(appState.tasks["tk-1"]?.status).toBe("working");
    const thread = agentStore.getThread("th-from-task");
    expect(thread?.agentDefinitionId).toBe("ag-1");
    expect(thread?.taskId).toBe("tk-1");
  });

  it("does not register a thread for a task whose agent is unknown", async () => {
    const ipc = await initWithAgent();

    ipc.emit("task:updated", {
      task: makeTask({
        id: "tk-2",
        workspace_id: "ws-a",
        agent_id: "ghost",
        session_id: "th-x",
      }),
    });
    flushSync();

    expect(appState.tasks["tk-2"]).toBeDefined();
    expect(agentStore.getThread("th-x")).toBeUndefined();
  });

  it("teardown unlistens and leaves the store re-initializable", async () => {
    const ipc = await initWithAgent();
    const registered = ipc.listenedEvents.length;
    expect(registered).toBeGreaterThan(0);

    appState.teardown();

    // Every listener that this store and its two child stores registered.
    expect(ipc.unlistenCount).toBeGreaterThanOrEqual(registered);

    ipc.emit("task:created", { task: makeTask({ id: "tk-after-teardown" }) });
    flushSync();
    expect(appState.tasks["tk-after-teardown"]).toBeUndefined();
  });

  it("abandons a listener setup that a teardown interrupts", async () => {
    let tornDown = false;
    const ipc = installIPC({
      list_workspaces: () => [],
      known_agents: () => [],
      "plugin:event|listen": (a) => {
        if (a.event === "task:created" && !tornDown) {
          tornDown = true;
          appState.teardown();
        }
      },
    });

    await appState.initialize();
    flushSync();

    expect(tornDown).toBe(true);
    // Both task listeners were registered, then immediately released.
    expect(ipc.listenedEvents).toContain("task:updated");

    ipc.emit("task:created", { task: makeTask({ id: "tk-abandoned" }) });
    flushSync();
    expect(appState.tasks["tk-abandoned"]).toBeUndefined();
  });
});

// ── Workspace CRUD ────────────────────────────────────────────────────────────

describe("appState workspace management", () => {
  it("creates a workspace, selects it and re-detects agents", async () => {
    const ipc = installIPC({
      create_workspace: () => "ws-new",
      known_agents: () => [
        {
          name: "codex",
          command: "codex",
          available: false,
          provider: "codex",
        },
      ],
    });

    const id = await appState.createWorkspace("Fresh");
    flushSync();

    expect(id).toBe("ws-new");
    expect(ipc.argsFor("create_workspace")).toEqual({ name: "Fresh" });
    expect(appState.selectedWorkspaceId).toBe("ws-new");
    expect(appState.activeView).toBe("settings");
    expect(appState.knownAgents.map((k) => k.name)).toEqual(["codex"]);
    expect(appState.selectedWorkspace?.name).toBe("Fresh");
  });

  it("renames a workspace through update_workspace", async () => {
    const ipc = installIPC({
      create_workspace: () => "ws-1",
      known_agents: () => [],
    });
    await appState.createWorkspace("Old");

    await appState.updateWorkspace("ws-1", "New");
    flushSync();

    expect(ipc.argsFor("update_workspace")).toEqual({
      workspaceId: "ws-1",
      name: "New",
    });
    expect(appState.workspaces[0]!.name).toBe("New");
  });

  it("ignores a rename for an unknown workspace id", async () => {
    installIPC({ create_workspace: () => "ws-1", known_agents: () => [] });
    await appState.createWorkspace("Old");

    await appState.updateWorkspace("ws-missing", "New");
    flushSync();

    expect(appState.workspaces[0]!.name).toBe("Old");
  });

  it("deletes a workspace and reselects the first survivor", async () => {
    let next = 0;
    installIPC({
      create_workspace: () => `ws-${++next}`,
      known_agents: () => [],
    });
    await appState.createWorkspace("First");
    await appState.createWorkspace("Second");
    flushSync();
    expect(appState.selectedWorkspaceId).toBe("ws-2");

    await appState.deleteWorkspace("ws-2");
    flushSync();

    expect(appState.workspaces.map((w) => w.id)).toEqual(["ws-1"]);
    expect(appState.selectedWorkspaceId).toBe("ws-1");
  });

  it("clears the selection when the last workspace is deleted", async () => {
    installIPC({ create_workspace: () => "ws-only", known_agents: () => [] });
    await appState.createWorkspace("Only");

    await appState.deleteWorkspace("ws-only");
    flushSync();

    expect(appState.selectedWorkspaceId).toBeNull();
    expect(appState.selectedWorkspace).toBeUndefined();
  });

  it("keeps the selection when deleting a workspace that was not selected", async () => {
    let next = 0;
    installIPC({
      create_workspace: () => `ws-${++next}`,
      known_agents: () => [],
    });
    await appState.createWorkspace("First");
    await appState.createWorkspace("Second");

    await appState.deleteWorkspace("ws-1");
    flushSync();

    expect(appState.selectedWorkspaceId).toBe("ws-2");
  });

  it("toggles collapsed state, and routes to mock data in demo mode", async () => {
    installIPC({ create_workspace: () => "ws-1", known_agents: () => [] });
    await appState.createWorkspace("First");
    flushSync();

    expect(appState.workspaces[0]!.collapsed).toBe(false);
    appState.toggleWorkspaceCollapsed("ws-1");
    flushSync();
    expect(appState.workspaces[0]!.collapsed).toBe(true);

    // Unknown ids are a no-op.
    appState.toggleWorkspaceCollapsed("ws-nope");
    flushSync();
    expect(appState.workspaces[0]!.collapsed).toBe(true);

    appState.demoMode = true;
    const before = appState.workspaces.find((w) => w.id === "ws1")!.collapsed;
    appState.toggleWorkspaceCollapsed("ws1");
    flushSync();
    expect(appState.workspaces.find((w) => w.id === "ws1")!.collapsed).toBe(!before);
    // Restore the shared mock fixture.
    appState.toggleWorkspaceCollapsed("ws1");
    appState.demoMode = false;
  });
});

// ── Agent definitions ─────────────────────────────────────────────────────────

describe("appState agent definitions", () => {
  beforeEach(async () => {
    installIPC({ create_workspace: () => "ws-1", known_agents: () => [] });
    await appState.createWorkspace("Alpha");
    flushSync();
  });

  it("creates an agent definition and attaches it to the workspace", async () => {
    const ipc = installIPC({ create_agent: () => "ag-new" });

    const id = await appState.createAgentDefinition("ws-1", "Sonnet", "claude");
    flushSync();

    expect(id).toBe("ag-new");
    expect(ipc.argsFor("create_agent")).toEqual({
      workspaceId: "ws-1",
      name: "Sonnet",
      provider: "claude",
    });
    expect(appState.workspaces[0]!.agentDefinitions.map((d) => d.name)).toEqual(["Sonnet"]);
  });

  it("updates only the fields it is given", async () => {
    const ipc = installIPC({ create_agent: () => "ag-1" });
    await appState.createAgentDefinition("ws-1", "Old", "claude");

    await appState.updateAgentDefinition("ag-1", "Renamed");
    flushSync();
    expect(ipc.argsFor("update_agent")).toEqual({
      agentId: "ag-1",
      name: "Renamed",
    });
    expect(appState.agentDefinitionsMap["ag-1"]!.name).toBe("Renamed");
    expect(appState.agentDefinitionsMap["ag-1"]!.provider).toBe("claude");

    // Switching harness is explicit; it can never be cleared, since a
    // definition without one could not spawn.
    await appState.updateAgentDefinition("ag-1", undefined, "codex");
    flushSync();
    expect(appState.agentDefinitionsMap["ag-1"]!.provider).toBe("codex");
    expect(appState.agentDefinitionsMap["ag-1"]!.name).toBe("Renamed");
  });

  it("updates nothing locally for an unknown agent id", async () => {
    installIPC();
    await appState.updateAgentDefinition("ag-ghost", "X");
    expect(appState.agentDefinitionsMap["ag-ghost"]).toBeUndefined();
  });

  it("deletes an agent definition and clears it from the selection", async () => {
    const ipc = installIPC({ create_agent: () => "ag-1" });
    await appState.createAgentDefinition("ws-1", "Doomed", "claude");
    appState.selectAgent("ag-1");
    flushSync();
    expect(appState.activeView).toBe("agent-threads");

    await appState.deleteAgentDefinition("ag-1");
    flushSync();

    expect(ipc.argsFor("delete_agent")).toEqual({ agentId: "ag-1" });
    expect(appState.agentDefinitionsMap["ag-1"]).toBeUndefined();
    expect(appState.workspaces[0]!.agentDefinitions).toEqual([]);
    expect(appState.selectedAgentId).toBeNull();
    expect(appState.activeView).toBe("overview");
  });

  it("leaves the selection alone when a different agent is deleted", async () => {
    let n = 0;
    installIPC({ create_agent: () => `ag-${++n}` });
    await appState.createAgentDefinition("ws-1", "Keep", "claude");
    await appState.createAgentDefinition("ws-1", "Drop", "claude");
    appState.selectAgent("ag-1");
    appState.activeView = "agent-chat";

    await appState.deleteAgentDefinition("ag-2");
    flushSync();

    expect(appState.selectedAgentId).toBe("ag-1");
    expect(appState.activeView).toBe("agent-chat");
  });

  it("exposes selectedAgentDef with live threads, and undefined when unresolvable", () => {
    expect(appState.selectedAgentDef).toBeUndefined();

    appState.selectedAgentId = "ag-ghost";
    flushSync();
    expect(appState.selectedAgentDef).toBeUndefined();

    defineAgent("ag-1", "ws-1", { provider: "gemini" });
    agentStore._test.injectThread("th-1", {
      id: "th-1",
      agentDefinitionId: "ag-1",
    });
    appState.selectedAgentId = "ag-1";
    flushSync();

    expect(appState.selectedAgentDef?.provider).toBe("gemini");
    expect(appState.selectedAgentDef?.threads.map((t) => t.id)).toEqual(["th-1"]);
  });

  it("drops dangling agent definition ids from the display list", async () => {
    installIPC({ create_agent: () => "ag-1" });
    await appState.createAgentDefinition("ws-1", "Ghost", "claude");
    // Simulate a definition removed from the map without the workspace knowing.
    delete appState.agentDefinitionsMap["ag-1"];
    flushSync();

    expect(appState.workspaces[0]!.agentDefinitions).toEqual([]);
  });
});

// ── Selection & view switching ────────────────────────────────────────────────

describe("appState selection and views", () => {
  it("selectWorkspace resets the task sidebar and returns to overview", () => {
    appState.selectTask("tk-1");
    flushSync();
    expect(appState.taskSidebarMode).toBe("detail");

    appState.selectWorkspace("ws-42");
    flushSync();

    expect(appState.selectedWorkspaceId).toBe("ws-42");
    expect(appState.activeView).toBe("overview");
    expect(appState.selectedTaskId).toBeNull();
    expect(appState.taskSidebarMode).toBeNull();
  });

  it("selectAgent follows the agent to its owning workspace", async () => {
    installIPC({
      create_workspace: () => "ws-1",
      known_agents: () => [],
      create_agent: () => "ag-1",
    });
    await appState.createWorkspace("Alpha");
    await appState.createAgentDefinition("ws-1", "A", "claude");
    appState.selectWorkspace("ws-other");
    flushSync();

    appState.selectAgent("ag-1");
    flushSync();

    expect(appState.selectedAgentId).toBe("ag-1");
    expect(appState.selectedWorkspaceId).toBe("ws-1");
    expect(appState.activeView).toBe("agent-threads");
  });

  it("selectAgent keeps the current workspace for an unowned agent", () => {
    appState.selectWorkspace("ws-keep");
    appState.selectAgent("ag-unowned");
    flushSync();

    expect(appState.selectedWorkspaceId).toBe("ws-keep");
    expect(appState.selectedAgentId).toBe("ag-unowned");
  });

  it("routes agent selection through the mock store in demo mode", () => {
    appState.demoMode = true;
    appState.selectAgent("a3");
    flushSync();

    expect(appState.selectedAgentId).toBe("a3");
    expect(appState.activeView).toBe("agent-threads");
    expect(appState.selectedAgentDef?.name).toBe("gemini-explorer");

    // The demo setter ignores null.
    appState.selectedAgentId = null;
    expect(appState.selectedAgentId).toBe("a3");
    appState.selectedAgentId = "a1";
    expect(appState.selectedAgentId).toBe("a1");
    appState.demoMode = false;
  });

  it("view helpers move activeView and clear task state", () => {
    appState.selectTask("tk-9");
    flushSync();
    expect(appState.selectedTaskId).toBe("tk-9");

    appState.showTasks();
    flushSync();
    expect(appState.activeView).toBe("tasks");
    expect(appState.selectedTaskId).toBeNull();
    expect(appState.taskSidebarMode).toBeNull();

    appState.showOverview();
    expect(appState.activeView).toBe("overview");
    appState.showAppSettings();
    expect(appState.activeView).toBe("app-settings");
    appState.showWorkspaceSettings();
    expect(appState.activeView).toBe("settings");
    appState.startCreatingAgent();
    expect(appState.activeView).toBe("create-agent");
  });

  it("openCreateTask and closeTaskSidebar drive the sidebar mode", () => {
    appState.openCreateTask();
    flushSync();
    expect(appState.taskSidebarMode).toBe("create");
    expect(appState.selectedTaskId).toBeNull();

    appState.closeTaskSidebar();
    flushSync();
    expect(appState.taskSidebarMode).toBeNull();
  });

  it("selectedWorkspace falls back to the first workspace when the id is stale", async () => {
    installIPC({ create_workspace: () => "ws-1", known_agents: () => [] });
    await appState.createWorkspace("Alpha");
    appState.selectWorkspace("ws-does-not-exist");
    flushSync();

    expect(appState.selectedWorkspace?.id).toBe("ws-1");
  });

  it("selectedWorkspace resolves against mock data in demo mode", () => {
    appState.demoMode = true;
    appState.selectWorkspace("ws2");
    flushSync();
    expect(appState.selectedWorkspace?.name).toBe("api-migration");

    appState.selectWorkspace("nope");
    flushSync();
    expect(appState.selectedWorkspace?.id).toBe("ws1");
    appState.demoMode = false;
  });

  it("exposes demo workspaces with system prompts layered on top", () => {
    appState.demoMode = true;
    flushSync();

    const ws = appState.workspaces.find((w) => w.id === "ws1")!;
    expect(ws.agentDefinitions.length).toBeGreaterThan(0);
    expect(ws.agentDefinitions[0]!.systemPrompt).toBe("");

    appState.updateAgentSystemPrompt(ws.agentDefinitions[0]!.id, "demo prompt");
    flushSync();
    expect(appState.workspaces.find((w) => w.id === "ws1")!.agentDefinitions[0]!.systemPrompt).toBe(
      "demo prompt",
    );

    appState.updateAgentSystemPrompt(ws.agentDefinitions[0]!.id, "");
    appState.demoMode = false;
  });
});

// ── Thread selection ──────────────────────────────────────────────────────────

describe("appState.selectThread", () => {
  it("opens chat, syncs the selected agent and refreshes the queue", async () => {
    const ipc = installIPC({ list_queue: () => [] });
    defineAgent("ag-1", "ws-1");
    agentStore._test.injectThread("th-1", {
      id: "th-1",
      agentDefinitionId: "ag-1",
      status: "idle",
    });

    appState.selectThread("th-1");
    flushSync();
    await Promise.resolve();

    expect(appState.selectedThreadId).toBe("th-1");
    expect(appState.activeView).toBe("agent-chat");
    expect(appState.selectedAgentId).toBe("ag-1");
    expect(appState.selectedThread?.id).toBe("th-1");
    expect(ipc.countOf("list_queue")).toBe(1);
  });

  it("auto-resumes a dead thread that still has an ACP session", async () => {
    let resumeArgs: Record<string, unknown> | undefined;
    installIPC({
      list_queue: () => [],
      resume_thread: (a) => {
        resumeArgs = a;
        return null;
      },
    });
    defineAgent("ag-1", "ws-1");
    agentStore._test.injectThread("th-dead", {
      id: "th-dead",
      agentDefinitionId: "ag-1",
      status: "dead",
      acpSessionId: "acp-1",
    });

    appState.selectThread("th-dead");
    flushSync();

    expect(agentStore.getThread("th-dead")?.status).toBe("initializing");
    await vi.waitFor(() => expect(resumeArgs).toBeDefined());
    expect(resumeArgs).toEqual({
      threadId: "th-dead",
      agentId: "ag-1",
      acpSessionId: "acp-1",
    });
  });

  it("marks the thread dead again when the auto-resume fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    installIPC({
      list_queue: () => [],
      resume_thread: () => {
        throw new Error("spawn failed");
      },
    });
    defineAgent("ag-1", "ws-1");
    agentStore._test.injectThread("th-dead", {
      id: "th-dead",
      agentDefinitionId: "ag-1",
      status: "dead",
      acpSessionId: "acp-1",
    });

    appState.selectThread("th-dead");
    flushSync();

    await vi.waitFor(() => expect(agentStore.getThread("th-dead")?.status).toBe("dead"));
    expect(error).toHaveBeenCalledWith("Failed to resume thread:", expect.anything());
  });

  it("leaves a dead thread without an ACP session alone", async () => {
    const ipc = installIPC({ list_queue: () => [] });
    defineAgent("ag-1", "ws-1");
    agentStore._test.injectThread("th-dead", {
      id: "th-dead",
      agentDefinitionId: "ag-1",
      status: "dead",
      acpSessionId: null,
    });

    appState.selectThread("th-dead");
    flushSync();
    await Promise.resolve();

    expect(agentStore.getThread("th-dead")?.status).toBe("dead");
    expect(ipc.countOf("resume_thread")).toBe(0);
  });

  it("selects an unknown thread id without resolving a thread", async () => {
    installIPC({ list_queue: () => [] });

    appState.selectThread("th-ghost");
    flushSync();
    await Promise.resolve();

    expect(appState.selectedThreadId).toBe("th-ghost");
    expect(appState.selectedThread).toBeUndefined();
    expect(appState.selectedAgent).toBeUndefined();
  });

  it("resolves the owning agent from mock data in demo mode", () => {
    appState.demoMode = true;
    appState.selectThread("t4");
    flushSync();

    expect(appState.selectedThreadId).toBe("t4");
    expect(appState.activeView).toBe("agent-chat");
    expect(appState.selectedAgentId).toBe("a2");
    expect(appState.selectedThread?.id).toBe("t4");
    // `selectedAgent` resolves the currently open thread.
    expect(appState.selectedAgent?.id).toBe("t4");
    appState.demoMode = false;
  });

  it("selectedAgent falls back to the selected agent id when no thread is open", () => {
    defineAgent("ag-1", "ws-1");
    agentStore._test.injectThread("ag-1", {
      id: "ag-1",
      agentDefinitionId: "ag-1",
    });
    appState.selectedAgentId = "ag-1";
    flushSync();

    expect(appState.selectedThreadId).toBeNull();
    expect(appState.selectedThread).toBeUndefined();
    expect(appState.selectedAgent?.id).toBe("ag-1");
  });

  it("selectedAgent is undefined with nothing selected at all", () => {
    expect(appState.selectedThreadId).toBeNull();
    expect(appState.selectedAgentId).toBeNull();
    expect(appState.selectedAgent).toBeUndefined();
  });

  it("demo selectedThread is undefined until a thread is picked", () => {
    appState.demoMode = true;
    flushSync();
    expect(appState.selectedThread).toBeUndefined();
    appState.demoMode = false;
  });
});

// ── Queue projections ─────────────────────────────────────────────────────────

describe("appState queue getters", () => {
  it("return empty lists when no thread is selected", () => {
    expect(appState.selectedThreadPendingQueue).toEqual([]);
    expect(appState.selectedThreadComposerQueue).toEqual([]);
    expect(appState.selectedThreadNotificationQueue).toEqual([]);
  });

  it("split the pending queue into composer items and notifications", async () => {
    installIPC({ list_queue: () => [] });
    agentStore._test.injectThread("th-q", {
      id: "th-q",
      agentDefinitionId: "ag-1",
      pendingQueue: [
        { id: "q1", content: "typed", submittedAt: 1, source: "user" },
        { id: "q2", content: "from task", submittedAt: 2, source: "task" },
        { id: "q3", content: "from peer", submittedAt: 3, source: "thread" },
      ],
    });

    appState.selectThread("th-q");
    flushSync();
    await Promise.resolve();

    expect(appState.selectedThreadPendingQueue.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
    expect(appState.selectedThreadComposerQueue.map((q) => q.id)).toEqual(["q1"]);
    expect(appState.selectedThreadNotificationQueue.map((q) => q.id)).toEqual(["q2", "q3"]);
  });

  it("return empty lists for a selected thread that no longer exists", async () => {
    installIPC({ list_queue: () => [] });
    appState.selectThread("th-gone");
    flushSync();
    await Promise.resolve();

    expect(appState.selectedThreadPendingQueue).toEqual([]);
    expect(appState.selectedThreadComposerQueue).toEqual([]);
    expect(appState.selectedThreadNotificationQueue).toEqual([]);
  });
});

// ── Thread lifecycle commands ─────────────────────────────────────────────────

describe("appState thread lifecycle", () => {
  it("spawnThread delegates to the agent store with the agent definition", async () => {
    const ipc = installIPC({ spawn_thread: () => "th-spawned" });
    defineAgent("ag-1", "ws-1");

    const id = await appState.spawnThread("ag-1");
    flushSync();

    expect(id).toBe("th-spawned");
    expect(ipc.argsFor("spawn_thread")).toEqual({ agentId: "ag-1" });
    expect(agentStore.getThread("th-spawned")?.workspaceId).toBe("ws-1");
  });

  it("spawnThread rejects for an unknown agent", async () => {
    installIPC();
    await expect(appState.spawnThread("ag-ghost")).rejects.toThrow("Agent ag-ghost not found");
  });

  it("stopThread forwards to the backend", async () => {
    const ipc = installIPC({ shutdown_thread: () => null });
    agentStore._test.injectThread("th-1", {
      id: "th-1",
      agentDefinitionId: "ag-1",
      status: "idle",
    });

    await appState.stopThread("th-1");
    flushSync();

    expect(ipc.countOf("shutdown_thread")).toBe(1);
  });

  it("deleteThread removes the thread and leaves the chat view", async () => {
    const ipc = installIPC({ list_queue: () => [], delete_thread: () => null });
    agentStore._test.injectThread("th-1", {
      id: "th-1",
      agentDefinitionId: "ag-1",
      workspaceId: "ws-7",
    });
    appState.selectThread("th-1");
    flushSync();
    await Promise.resolve();

    await appState.deleteThread("th-1");
    flushSync();

    expect(ipc.argsFor("delete_thread")).toEqual({
      threadId: "th-1",
      workspaceId: "ws-7",
    });
    expect(agentStore.getThread("th-1")).toBeUndefined();
    expect(appState.selectedThreadId).toBeNull();
    expect(appState.activeView).toBe("agent-threads");
  });

  it("deleteThread falls back to the selected workspace for an unknown thread", async () => {
    const ipc = installIPC({ delete_thread: () => null });
    appState.selectWorkspace("ws-current");
    flushSync();

    await appState.deleteThread("th-unknown");

    expect(ipc.argsFor("delete_thread")).toEqual({
      threadId: "th-unknown",
      workspaceId: "ws-current",
    });
  });

  it("deleteThread is a no-op when no workspace can be resolved", async () => {
    const ipc = installIPC({ delete_thread: () => null });
    expect(appState.selectedWorkspaceId).toBeNull();

    await appState.deleteThread("th-unknown");

    expect(ipc.countOf("delete_thread")).toBe(0);
  });

  it("resumeThread resets state and resumes the ACP session", async () => {
    const ipc = installIPC({ resume_thread: () => null });
    agentStore._test.injectThread("th-1", {
      id: "th-1",
      agentDefinitionId: "ag-1",
      status: "dead",
      acpSessionId: "acp-9",
    });

    await appState.resumeThread("th-1");
    flushSync();

    expect(ipc.argsFor("resume_thread")).toEqual({
      threadId: "th-1",
      agentId: "ag-1",
      acpSessionId: "acp-9",
    });
    expect(agentStore.getThread("th-1")?.status).toBe("initializing");
  });

  it("resumeThread rethrows and marks the thread dead on failure", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    installIPC({
      resume_thread: () => {
        throw new Error("resume failed");
      },
    });
    agentStore._test.injectThread("th-1", {
      id: "th-1",
      agentDefinitionId: "ag-1",
      status: "dead",
      acpSessionId: "acp-9",
    });

    await expect(appState.resumeThread("th-1")).rejects.toBeTruthy();
    flushSync();

    expect(agentStore.getThread("th-1")?.status).toBe("dead");
    expect(error).toHaveBeenCalledWith("Failed to resume thread:", expect.anything());
  });

  it("resumeThread is a no-op without a thread or an ACP session", async () => {
    const ipc = installIPC({ resume_thread: () => null });
    agentStore._test.injectThread("th-1", {
      id: "th-1",
      agentDefinitionId: "ag-1",
      status: "dead",
      acpSessionId: null,
    });

    await appState.resumeThread("th-missing");
    await appState.resumeThread("th-1");

    expect(ipc.countOf("resume_thread")).toBe(0);
  });
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

describe("appState tasks", () => {
  it("createTask forwards every field, defaulting parentId to null", async () => {
    const ipc = installIPC({ create_task: () => "tk-created" });

    const id = await appState.createTask("ws-1", "Title", "Body", "ag-1", ["tk-0"]);
    expect(id).toBe("tk-created");
    expect(ipc.argsFor("create_task")).toEqual({
      workspaceId: "ws-1",
      title: "Title",
      description: "Body",
      agentId: "ag-1",
      blockerIds: ["tk-0"],
      parentId: null,
    });

    await appState.createTask("ws-1", "Child", "", "ag-1", [], "tk-created");
    expect(ipc.calls.filter((c) => c.cmd === "create_task")[1]!.args.parentId).toBe("tk-created");
  });

  it("derives workspace tasks, the active count and per-agent tasks", () => {
    appState.tasks["tk-1"] = makeTask({
      id: "tk-1",
      workspace_id: "ws-1",
      agent_id: "ag-1",
      status: "working",
    });
    appState.tasks["tk-2"] = makeTask({
      id: "tk-2",
      workspace_id: "ws-1",
      agent_id: "ag-2",
      status: "pending",
    });
    appState.tasks["tk-3"] = makeTask({
      id: "tk-3",
      workspace_id: "ws-1",
      agent_id: "ag-1",
      status: "completed",
    });
    appState.tasks["tk-4"] = makeTask({
      id: "tk-4",
      workspace_id: "ws-2",
      agent_id: "ag-1",
    });
    appState.selectWorkspace("ws-1");
    appState.selectedAgentId = "ag-1";
    flushSync();

    expect(appState.workspaceTasks.map((t) => t.id).toSorted()).toEqual(["tk-1", "tk-2", "tk-3"]);
    // Only working + pending count as active.
    expect(appState.activeWorkspaceTaskCount).toBe(2);
    expect(appState.agentTasks.map((t) => t.id).toSorted()).toEqual(["tk-1", "tk-3", "tk-4"]);
  });

  it("selectTask opens the detail sidebar for that task", () => {
    appState.tasks["tk-1"] = makeTask({ id: "tk-1" });
    appState.selectTask("tk-1");
    flushSync();

    expect(appState.selectedTaskId).toBe("tk-1");
    expect(appState.taskSidebarMode).toBe("detail");
    expect(appState.tasks["tk-1"]?.id).toBe("tk-1");
  });

  it("projects demo tasks into the by-id lookup so detail views resolve", () => {
    appState.demoMode = true;
    appState.selectWorkspace("ws1");
    flushSync();

    const listed = appState.workspaceTasks;
    expect(listed.length).toBeGreaterThan(0);
    for (const task of listed) {
      expect(appState.tasks[task.id]?.id).toBe(task.id);
    }
    appState.demoMode = false;
  });
});
