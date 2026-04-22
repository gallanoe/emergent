<script lang="ts">
  import { appState } from "./stores/app-state.svelte";
  import InnerSidebar from "./components/sidebar/InnerSidebar.svelte";
  import ChatArea from "./components/chat/ChatArea.svelte";
  import ChatInput from "./components/chat/ChatInput.svelte";
  import TaskSessionHeader from "./components/chat/TaskSessionHeader.svelte";
  import SwarmView from "./components/swarm/SwarmView.svelte";
  import SettingsView from "./components/settings/SettingsView.svelte";
  import RuntimeSelector from "./components/settings/RuntimeSelector.svelte";
  import TerminalView from "./components/terminal/TerminalView.svelte";
  import ThreadListView from "./components/agent/ThreadListView.svelte";
  import AgentSettingsView from "./components/agent/AgentSettingsView.svelte";
  import AgentCreatorView from "./components/agent/AgentCreatorView.svelte";
  import TaskTableView from "./components/tasks/TaskTableView.svelte";
  import TaskDetailSidebar from "./components/tasks/TaskDetailSidebar.svelte";
  import CreateTaskSidebar from "./components/tasks/CreateTaskSidebar.svelte";
  import { ConfirmDialog } from "./lib/primitives";
  import ContextMenu from "./components/sidebar/ContextMenu.svelte";
  import CreateWorkspaceDialog from "./components/CreateWorkspaceDialog.svelte";
  import {
    Plus,
    Square,
    Play,
    RefreshCw,
    Trash2,
    Loader,
  } from "@lucide/svelte";
  import { isEditableTarget } from "./lib/editable-guard";
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import type {
    MenuItem,
    ContainerStatus,
    WorkspaceStatusChangePayload,
  } from "./stores/types";

  let externalContent = $state<{ text: string; seq: number } | null>(null);
  let seq = 0;
  let shutdownTarget = $state<{ id: string; name: string } | null>(null);
  let showCreateWorkspace = $state(false);
  let taskStatusFilter = $state<
    "all" | "working" | "pending" | "completed" | "failed"
  >("all");
  const filteredWorkspaceTasks = $derived(
    taskStatusFilter === "all"
      ? appState.workspaceTasks
      : appState.workspaceTasks.filter((t) => t.status === taskStatusFilter),
  );
  let workspaceMenu = $state<{
    x: number;
    y: number;
    workspaceId: string;
  } | null>(null);
  let deleteTarget = $state<{ id: string; name: string } | null>(null);

  function workspaceMenuItems(status: ContainerStatus): MenuItem[] {
    switch (status.state) {
      case "running":
        return [
          { id: "stop", label: "Stop", icon: Square },
          { id: "sep", label: "", separator: true },
          { id: "delete", label: "Delete", icon: Trash2, danger: true },
        ];
      case "stopped":
        return [
          { id: "start", label: "Start", icon: Play },
          { id: "sep", label: "", separator: true },
          { id: "delete", label: "Delete", icon: Trash2, danger: true },
        ];
      case "building":
        return [
          { id: "building", label: "Building…", icon: Loader, disabled: true },
          { id: "sep", label: "", separator: true },
          {
            id: "delete",
            label: "Delete",
            icon: Trash2,
            danger: true,
            disabled: true,
          },
        ];
      case "error":
        return [
          { id: "rebuild", label: "Rebuild", icon: RefreshCw },
          { id: "sep", label: "", separator: true },
          { id: "delete", label: "Delete", icon: Trash2, danger: true },
        ];
    }
  }

  function handleWorkspaceMenuAction(actionId: string) {
    if (!workspaceMenu) return;
    const wsId = workspaceMenu.workspaceId;
    const ws = appState.swarms.find((s) => s.id === wsId);
    workspaceMenu = null;

    switch (actionId) {
      case "stop":
        appState.stopContainer(wsId);
        break;
      case "start":
        appState.startContainer(wsId);
        break;
      case "rebuild":
        appState.rebuildContainer(wsId);
        break;
      case "delete":
        if (ws) deleteTarget = { id: wsId, name: ws.name };
        break;
    }
  }

  async function confirmDeleteWorkspace() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    deleteTarget = null;
    if (appState.selectedSwarmId === id) {
      appState.activeView = "swarm";
    }
    await appState.deleteWorkspace(id);
  }

  const isEmptyOrRuntimeMissing = $derived(
    (appState.runtimeStatus && !appState.runtimeStatus.available) ||
      (!appState.demoMode && appState.swarms.length === 0),
  );

  const showWorkspaceNameHeader = $derived(
    appState.selectedSwarm &&
      !isEmptyOrRuntimeMissing &&
      appState.activeView !== "overview" &&
      appState.activeView !== "app-settings" &&
      appState.activeView !== "agent-chat",
  );

  function pushToInput(text: string) {
    externalContent = { text, seq: ++seq };
  }

  function requestShutdown(agentId: string, agentName: string) {
    shutdownTarget = { id: agentId, name: agentName };
  }

  async function confirmShutdown() {
    if (!shutdownTarget) return;
    const id = shutdownTarget.id;
    shutdownTarget = null;
    await appState.killThread(id);
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;
    if (!meta || e.altKey || e.shiftKey) return;
    if (isEditableTarget(document.activeElement)) return;

    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      void handleNewThread();
    } else if (e.key === ".") {
      e.preventDefault();
      if (appState.selectedSwarmId) {
        appState.showOverview();
      }
    }
  }

  onMount(() => {
    appState.initialize();

    window.addEventListener("keydown", onGlobalKeydown);

    // Close workspace menu when its target workspace changes status
    const unlistenPromise = listen<WorkspaceStatusChangePayload>(
      "workspace:status-change",
      (e) => {
        if (
          workspaceMenu &&
          e.payload.workspace_id === workspaceMenu.workspaceId
        ) {
          workspaceMenu = null;
        }
      },
    );

    // Register handler for queue dump on error.
    // Only dump if the errored agent is currently selected — otherwise
    // the content would be sent to the wrong agent.
    appState.registerQueueDumpHandler((agentId: string, content: string) => {
      if (agentId === appState.selectedAgentId) {
        pushToInput(content);
      }
    });

    return () => {
      window.removeEventListener("keydown", onGlobalKeydown);
      unlistenPromise.then((fn) => fn());
    };
  });

  function handleEditQueue() {
    const agent = appState.selectedAgent;
    if (!agent) return;
    const content = appState.editQueue(agent.id);
    if (content) {
      pushToInput(content);
    }
  }

  async function handleNewThread() {
    const agentId = appState.selectedAgentId;
    if (agentId) {
      const threadId = await appState.spawnThread(agentId);
      appState.selectThread(threadId);
    }
  }
</script>

<div class="grid h-screen grid-cols-[240px_1fr]">
  <InnerSidebar
    swarm={appState.selectedSwarm}
    workspaces={appState.swarms}
    selectedWorkspaceId={appState.selectedSwarmId}
    activeView={appState.activeView}
    selectedAgentId={appState.selectedAgentId}
    demoMode={appState.demoMode}
    activeTaskCount={appState.activeWorkspaceTaskCount}
    onSelectWorkspace={(id) => appState.selectWorkspace(id)}
    onCreateWorkspace={() => (showCreateWorkspace = true)}
    onSelectAgent={(id) => appState.selectAgent(id)}
    onCreateAgent={() => appState.startCreatingAgent()}
    onNewThread={handleNewThread}
    onOpenTasks={() => appState.showTasks()}
    onOpenTerminal={() => {
      appState.activeView = "terminal";
    }}
    onOpenAppSettings={() => appState.showAppSettings()}
  />
  <main class="relative flex min-h-0 min-w-0 flex-col">
    {#if showWorkspaceNameHeader}
      <div
        class="relative z-[60] flex h-[38px] flex-shrink-0 items-center border-b border-border-default px-5"
      >
        <span class="text-[13px] font-semibold text-fg-heading"
          >{appState.selectedSwarm!.name}</span
        >
      </div>
    {/if}
    {#if appState.runtimeStatus && !appState.runtimeStatus.available}
      <div
        class="flex flex-col items-center justify-center flex-1 gap-4 text-center px-6"
      >
        <div
          class="w-10 h-10 rounded-full bg-bg-hover flex items-center justify-center text-warning"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path
              d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"
            /><path d="M12 9v4" /><path d="M12 17h.01" /></svg
          >
        </div>
        <div class="text-[13px] font-semibold text-fg-heading">
          Selected runtime unavailable
        </div>
        <div class="text-[12px] text-fg-muted max-w-xs leading-relaxed">
          Emergent could not reach the selected container runtime. Switch
          runtimes here or fix the selected runtime, then try again.
        </div>
        <div class="w-full max-w-sm">
          <RuntimeSelector
            preference={appState.runtimePreference}
            status={appState.runtimeStatus}
            onChange={appState.setContainerRuntimePreference}
            align="center"
          />
        </div>
      </div>
    {:else if !appState.demoMode && appState.swarms.length === 0}
      <div
        class="flex flex-col items-center justify-center flex-1 gap-4 text-center px-6"
      >
        <div
          class="w-10 h-10 rounded-full bg-bg-hover flex items-center justify-center text-fg-muted"
        >
          <Plus size={20} />
        </div>
        <div class="text-[13px] font-semibold text-fg-heading">
          No workspaces yet
        </div>
        <div class="text-[12px] text-fg-muted">
          Create a workspace to get started
        </div>
        <div class="w-full max-w-sm">
          <RuntimeSelector
            preference={appState.runtimePreference}
            status={appState.runtimeStatus}
            onChange={appState.setContainerRuntimePreference}
            align="center"
          />
        </div>
        <button
          class="mt-1 h-7 px-4 rounded-[5px] text-[12px] font-medium text-bg-base bg-accent hover:bg-accent-hover transition-colors"
          onclick={() => (showCreateWorkspace = true)}
        >
          Create Workspace
        </button>
      </div>
    {:else if appState.activeView === "overview" && appState.selectedSwarm}
      <div class="p-6 text-[12px] text-fg-muted">
        Overview — built in Phase 6
      </div>
    {:else if appState.activeView === "app-settings"}
      <div class="p-6 text-[12px] text-fg-muted">
        Application settings — built in Phase 5
      </div>
    {:else if appState.activeView === "settings" && appState.selectedSwarmId}
      <SettingsView
        workspaceId={appState.selectedSwarmId}
        containerStatus={appState.selectedSwarm?.containerStatus ?? {
          state: "stopped",
        }}
        runtimePreference={appState.runtimePreference}
        runtimeStatus={appState.runtimeStatus}
        onUpdateName={(name) =>
          appState.updateWorkspace(appState.selectedSwarmId!, name)}
        onRuntimeChange={appState.setContainerRuntimePreference}
        onStart={() => appState.startContainer(appState.selectedSwarmId!)}
        onStop={() => appState.stopContainer(appState.selectedSwarmId!)}
        onRebuild={() => appState.rebuildContainer(appState.selectedSwarmId!)}
      />
    {:else if appState.activeView === "terminal" && appState.selectedSwarmId}
      <TerminalView
        workspaceId={appState.selectedSwarmId}
        containerStatus={appState.selectedSwarm?.containerStatus ?? {
          state: "stopped",
        }}
        sessionId={appState.terminalSessionIds[appState.selectedSwarmId] ??
          null}
        onSessionCreated={(sid) =>
          appState.setTerminalSessionId(appState.selectedSwarmId!, sid)}
        onSessionEnded={() =>
          appState.setTerminalSessionId(appState.selectedSwarmId!, null)}
      />
    {:else if appState.activeView === "swarm" && appState.selectedSwarm}
      <SwarmView
        swarm={appState.selectedSwarm}
        agentConnections={appState.agentConnections}
        demoMode={appState.demoMode}
        onSelectAgent={(id) => appState.selectAgent(id)}
      />
    {:else if appState.activeView === "create-agent" && appState.selectedSwarmId}
      <AgentCreatorView
        knownAgents={appState.knownAgents}
        onCreate={async (cli, name, role) => {
          const agentId = await appState.createAgentDefinition(
            appState.selectedSwarmId!,
            name,
            role,
            cli,
          );
          appState.selectAgent(agentId);
        }}
        onCancel={() => {
          if (appState.selectedSwarmId) {
            appState.selectWorkspace(appState.selectedSwarmId);
          }
        }}
      />
    {:else if appState.activeView === "tasks" && appState.selectedSwarmId}
      <div class="flex flex-col h-full min-h-0">
        <div
          class="flex items-center h-[38px] px-5 border-b border-border-default flex-shrink-0 relative z-[60]"
        >
          <span class="text-[13px] font-semibold text-fg-heading"
            >{appState.selectedSwarm?.name ?? ""}</span
          >
        </div>
        <div
          class="flex-1 min-h-0"
          style="display:grid; grid-template-columns: {appState.taskSidebarMode
            ? '1fr 320px'
            : '1fr'};"
        >
          <!-- Table -->
          <div class="overflow-y-auto p-3.5">
            <div class="flex items-center justify-between mb-3 px-1">
              <div class="text-[11px] text-fg-disabled">
                {filteredWorkspaceTasks.length} of {appState.workspaceTasks
                  .length} tasks
              </div>
              <button
                class="flex items-center gap-1.5 text-[11px] font-medium text-bg-base bg-accent hover:bg-accent-hover rounded-md px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-accent"
                onclick={() => appState.openCreateTask()}
                disabled={!appState.selectedWorkspaceContainerRunning}
                title={appState.selectedWorkspaceContainerRunning
                  ? "Create a new task"
                  : "Start the workspace container to create tasks"}
              >
                <Plus size={11} />
                New task
              </button>
            </div>
            <div class="flex items-center gap-1 mb-3 px-1">
              {#each ["all", "working", "pending", "completed", "failed"] as f (f)}
                <button
                  class="px-2.5 py-1 rounded-md text-[10px] font-medium capitalize border transition-colors
                    {taskStatusFilter === f
                    ? 'bg-bg-selected text-fg-heading border-border-strong'
                    : 'text-fg-muted border-border-default hover:bg-bg-hover'}"
                  onclick={() =>
                    (taskStatusFilter = f as typeof taskStatusFilter)}
                >
                  {f}
                </button>
              {/each}
            </div>
            <TaskTableView
              tasks={filteredWorkspaceTasks}
              selectedTaskId={appState.selectedTaskId}
              agentNames={Object.fromEntries(
                Object.values(appState.agentDefinitionsMap ?? {}).map((d) => [
                  d.id,
                  d.name,
                ]),
              )}
              onSelectTask={(id) => appState.selectTask(id)}
              onNavigateToSession={(threadId) =>
                appState.selectThread(threadId)}
            />
          </div>
          <!-- Sidebar -->
          {#if appState.taskSidebarMode === "detail" && appState.selectedTaskId}
            {@const task = appState.tasks[appState.selectedTaskId]}
            {#if task}
              <TaskDetailSidebar
                {task}
                allTasks={appState.tasks}
                agentNames={Object.fromEntries(
                  Object.values(appState.agentDefinitionsMap ?? {}).map((d) => [
                    d.id,
                    d.name,
                  ]),
                )}
                onClose={() => appState.closeTaskSidebar()}
                onSelectTask={(id) => appState.selectTask(id)}
                onNavigateToSession={(threadId) =>
                  appState.selectThread(threadId)}
              />
            {/if}
          {:else if appState.taskSidebarMode === "create"}
            <CreateTaskSidebar
              agentDefinitions={Object.values(
                appState.agentDefinitionsMap ?? {},
              )}
              existingTasks={appState.workspaceTasks}
              onClose={() => appState.closeTaskSidebar()}
              onCreate={async (title, desc, agentId, blockerIds) => {
                await appState.createTask(
                  appState.selectedSwarmId!,
                  title,
                  desc,
                  agentId,
                  blockerIds,
                );
                appState.closeTaskSidebar();
              }}
            />
          {/if}
        </div>
      </div>
    {:else if appState.activeView === "agent-threads" && appState.selectedAgentDef}
      <div
        class="flex-1 min-h-0"
        style="display:grid; grid-template-columns: {appState.taskSidebarMode
          ? '1fr 320px'
          : '1fr'};"
      >
        <ThreadListView
          agentDefinition={appState.selectedAgentDef}
          tasks={appState.agentTasks}
          activeTab={appState.agentViewTab}
          containerRunning={appState.selectedWorkspaceContainerRunning}
          onSelectTask={(id) => appState.selectTask(id)}
          onSelectTab={(tab) => appState.setAgentViewTab(tab)}
          onSelectThread={(id) => appState.selectThread(id)}
          onNewThread={async () => {
            const threadId = await appState.spawnThread(
              appState.selectedAgentId!,
            );
            appState.selectThread(threadId);
          }}
          onOpenSettings={() => appState.openAgentSettings()}
          onResumeThread={(id) => appState.resumeThread(id)}
          onStopThread={(id) => appState.stopThread(id)}
          onDeleteThread={(id) => appState.deleteThread(id)}
        />
        {#if appState.taskSidebarMode === "detail" && appState.selectedTaskId}
          {@const task = appState.tasks[appState.selectedTaskId]}
          {#if task}
            <TaskDetailSidebar
              {task}
              allTasks={appState.tasks}
              agentNames={Object.fromEntries(
                Object.values(appState.agentDefinitionsMap ?? {}).map((d) => [
                  d.id,
                  d.name,
                ]),
              )}
              onClose={() => appState.closeTaskSidebar()}
              onSelectTask={(id) => appState.selectTask(id)}
              onNavigateToSession={(threadId) =>
                appState.selectThread(threadId)}
            />
          {/if}
        {/if}
      </div>
    {:else if appState.activeView === "agent-settings" && appState.selectedAgentDef}
      <AgentSettingsView
        agentDefinition={appState.selectedAgentDef}
        onBack={() => appState.backToThreads()}
        onUpdate={(name, role) =>
          appState.updateAgentDefinition(appState.selectedAgentId!, name, role)}
        onDelete={() =>
          appState.deleteAgentDefinition(appState.selectedAgentId!)}
      />
    {:else if appState.activeView === "agent-chat" && appState.selectedThread}
      <div
        class="flex-1 min-h-0"
        style="display:grid; grid-template-columns: {appState.taskSidebarMode
          ? '1fr 320px'
          : '1fr'};"
      >
        <div class="relative flex flex-col min-h-0 min-w-0">
          <div
            class="flex items-center h-[38px] px-4 border-b border-border-default flex-shrink-0 relative z-[60] gap-2"
          >
            <button
              class="interactive flex items-center justify-center w-[24px] h-[24px] rounded-[5px] text-fg-muted"
              title="Back to threads"
              onclick={() => appState.backToThreads()}
            >
              ‹
            </button>
            <span class="text-[13px] font-semibold text-fg-heading"
              >{appState.selectedAgentDef?.name ?? ""}</span
            >
            <span class="text-[12px] text-fg-disabled">/</span>
            <span class="text-[12px] text-fg-muted"
              >{appState.selectedThread.name}</span
            >
          </div>
          {#if appState.selectedThread.taskId}
            {@const task = appState.tasks[appState.selectedThread.taskId]}
            {#if task}
              <TaskSessionHeader
                {task}
                onOpen={() => appState.selectTask(task.id)}
              />
            {/if}
          {/if}
          <ChatArea
            agent={appState.selectedAgent}
            onEditQueue={handleEditQueue}
          />
          <ChatInput
            agent={appState.selectedAgent}
            demoMode={appState.demoMode}
            containerRunning={appState.selectedWorkspaceContainerRunning}
            {externalContent}
            onSend={(text) => {
              const threadId = appState.selectedThreadId;
              if (threadId) appState.sendPrompt(threadId, text);
            }}
            onInterrupt={() => {
              const threadId = appState.selectedThreadId;
              if (threadId) appState.cancelPrompt(threadId);
            }}
            onSetConfig={(configId, value) => {
              const threadId = appState.selectedThreadId;
              if (threadId) appState.setConfig(threadId, configId, value);
            }}
          />
        </div>
        {#if appState.taskSidebarMode === "detail" && appState.selectedTaskId}
          {@const task = appState.tasks[appState.selectedTaskId]}
          {#if task}
            <TaskDetailSidebar
              {task}
              allTasks={appState.tasks}
              agentNames={Object.fromEntries(
                Object.values(appState.agentDefinitionsMap ?? {}).map((d) => [
                  d.id,
                  d.name,
                ]),
              )}
              onClose={() => appState.closeTaskSidebar()}
              onSelectTask={(id) => appState.selectTask(id)}
              onNavigateToSession={(threadId) =>
                appState.selectThread(threadId)}
            />
          {/if}
        {/if}
      </div>
    {:else}
      <ChatArea agent={appState.selectedAgent} onEditQueue={handleEditQueue} />
      <ChatInput
        agent={appState.selectedAgent}
        demoMode={appState.demoMode}
        containerRunning={appState.selectedWorkspaceContainerRunning}
        {externalContent}
        onSend={(text) => {
          const agent = appState.selectedAgent;
          if (agent) appState.sendPrompt(agent.id, text);
        }}
        onInterrupt={() => {
          const agent = appState.selectedAgent;
          if (agent) appState.cancelPrompt(agent.id);
        }}
        onSetConfig={(configId, value) => {
          const agent = appState.selectedAgent;
          if (agent) appState.setConfig(agent.id, configId, value);
        }}
      />
    {/if}
  </main>
</div>

{#if shutdownTarget}
  <ConfirmDialog
    title="Shutdown {shutdownTarget.name}?"
    description="Any in-progress work will be stopped immediately. This cannot be undone."
    confirmLabel="Shutdown"
    confirmVariant="danger"
    onConfirm={confirmShutdown}
    onCancel={() => {
      shutdownTarget = null;
    }}
  />
{/if}

{#if showCreateWorkspace}
  <CreateWorkspaceDialog
    onConfirm={async (name) => {
      showCreateWorkspace = false;
      await appState.createWorkspace(name);
    }}
    onCancel={() => (showCreateWorkspace = false)}
  />
{/if}

{#if workspaceMenu}
  {@const menu = workspaceMenu}
  {@const ws = appState.swarms.find((s) => s.id === menu.workspaceId)}
  {#if ws}
    <ContextMenu
      x={menu.x}
      y={menu.y}
      items={workspaceMenuItems(ws.containerStatus)}
      onSelect={handleWorkspaceMenuAction}
      onClose={() => (workspaceMenu = null)}
    />
  {/if}
{/if}

{#if deleteTarget}
  <ConfirmDialog
    title="Delete {deleteTarget.name}?"
    description="All agents will be terminated. The container, image, and workspace files will be permanently deleted."
    confirmLabel="Delete"
    confirmVariant="danger"
    onConfirm={confirmDeleteWorkspace}
    onCancel={() => {
      deleteTarget = null;
    }}
  />
{/if}
