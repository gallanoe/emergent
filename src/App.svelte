<script lang="ts">
  import { appState } from "./stores/app-state.svelte";
  import InnerSidebar from "./components/sidebar/InnerSidebar.svelte";
  import ChatArea from "./components/chat/ChatArea.svelte";
  import ChatInput from "./components/chat/ChatInput.svelte";
  import ChatTaskBanner from "./components/chat/ChatTaskBanner.svelte";
  import WorkspaceSettingsView from "./components/settings/WorkspaceSettingsView.svelte";
  import AppSettingsView from "./components/settings/AppSettingsView.svelte";
  import ThreadListView from "./components/agent/ThreadListView.svelte";
  import AgentCreatorView from "./components/agent/AgentCreatorView.svelte";
  import OverviewView from "./components/overview/OverviewView.svelte";
  import TaskTableView from "./components/tasks/TaskTableView.svelte";
  import TaskDetailSidebar from "./components/tasks/TaskDetailSidebar.svelte";
  import CreateTaskSidebar from "./components/tasks/CreateTaskSidebar.svelte";
  import CreateWorkspaceDialog from "./components/CreateWorkspaceDialog.svelte";
  import SearchCommand from "./components/SearchCommand.svelte";
  import { Plus } from "@lucide/svelte";
  import { isEditableTarget } from "./lib/editable-guard";
  import { onMount } from "svelte";

  let showCreateWorkspace = $state(false);
  let searchOpen = $state(false);

  // Task-sidebar layout is shared by the tasks, thread-list, and chat views:
  // a single content column, plus a 320px sidebar column when a sidebar is open.
  let taskGridColumns = $derived(
    appState.taskSidebarMode ? "1fr 320px" : "1fr",
  );

  // id -> display name, for the task views that render assignees.
  let agentNames = $derived(
    Object.fromEntries(
      Object.values(appState.agentDefinitionsMap ?? {}).map((d) => [
        d.id,
        d.name,
      ]),
    ),
  );

  // Push-to-composer channel for the Edit-queue action.
  // Incrementing seq triggers the $effect in ChatInput, which sets the
  // textarea value to `text` and focuses it. The item is also removed from
  // the queue via removeQueueItem before this fires.
  let composerPush = $state<{ text: string; seq: number }>({
    text: "",
    seq: 0,
  });

  function handleEditQueueItem(
    threadId: string | null,
    id: string,
    content: string,
  ) {
    if (!threadId) return;
    // Use the content captured at click-time (passed in) rather than re-reading
    // from the queue, which may already be empty if the queue drained concurrently.
    appState.removeQueueItem(threadId, id);
    composerPush = { text: content, seq: composerPush.seq + 1 };
  }

  // Local mirror of SearchCommand's ThreadHit shape. Re-exporting types
  // from .svelte files is a known rough edge; duplicating the shape here
  // is cleaner than forcing a shared module just for one type.
  type ThreadHit = {
    id: string;
    name: string;
    agentId: string;
    agentName: string;
    agentProvider: string | null;
    status:
      | "idle"
      | "working"
      | "initializing"
      | "cancelling"
      | "error"
      | "dead";
  };

  const searchThreads = $derived.by<ThreadHit[]>(() => {
    const workspace = appState.selectedWorkspace;
    if (!workspace) return [];
    return workspace.agentDefinitions.flatMap((def) =>
      def.threads.map((t) => ({
        id: t.id,
        name: t.name,
        agentId: def.id,
        agentName: def.name,
        agentProvider: def.provider,
        status: t.processStatus,
      })),
    );
  });

  function onGlobalKeydown(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;
    if (!meta || e.altKey || e.shiftKey) return;

    // ⌘K opens/dismisses the search palette. Handled before the
    // isEditableTarget guard so the shortcut fires even while the user is
    // mid-message in the chat composer.
    if (e.key === "k" || e.key === "K") {
      e.preventDefault();
      searchOpen = !searchOpen;
      return;
    }

    if (isEditableTarget(document.activeElement)) return;

    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      void handleNewThread();
    } else if (e.key === ".") {
      e.preventDefault();
      if (appState.selectedWorkspaceId) {
        appState.showOverview();
      }
    }
  }

  onMount(() => {
    appState.initialize();

    window.addEventListener("keydown", onGlobalKeydown);

    return () => {
      window.removeEventListener("keydown", onGlobalKeydown);
      // Detaches the Tauri listeners owned by appState, agentStore, and
      // usageStore. A no-op for the app's real lifetime (App unmounts only on
      // shutdown), but it keeps an HMR reload or a remount from stacking a
      // second set of listeners on the same events.
      appState.teardown();
    };
  });

  async function handleNewThread() {
    const agentId = appState.selectedAgentId;
    if (agentId) {
      const threadId = await appState.spawnThread(agentId);
      appState.selectThread(threadId);
    }
  }
</script>

<!-- The detail sidebar is identical across the tasks, thread-list, and chat
     views, so all three render this snippet rather than repeating the props. -->
{#snippet taskDetailSidebar()}
  {#if appState.taskSidebarMode === "detail" && appState.selectedTaskId}
    {@const task = appState.tasks[appState.selectedTaskId]}
    {#if task}
      <TaskDetailSidebar
        {task}
        allTasks={appState.tasks}
        {agentNames}
        onClose={() => appState.closeTaskSidebar()}
        onSelectTask={(id) => appState.selectTask(id)}
        onNavigateToSession={(threadId) => appState.selectThread(threadId)}
      />
    {/if}
  {/if}
{/snippet}

<div class="grid h-screen grid-cols-[240px_1fr]">
  <InnerSidebar
    workspace={appState.selectedWorkspace}
    workspaces={appState.workspaces}
    selectedWorkspaceId={appState.selectedWorkspaceId}
    activeView={appState.activeView}
    selectedAgentId={appState.selectedAgentId}
    demoMode={appState.demoMode}
    activeTaskCount={appState.activeWorkspaceTaskCount}
    onSelectWorkspace={(id) => appState.selectWorkspace(id)}
    onCreateWorkspace={() => (showCreateWorkspace = true)}
    onSelectAgent={(id) => appState.selectAgent(id)}
    onCreateAgent={() => appState.startCreatingAgent()}
    onOpenOverview={() => appState.showOverview()}
    overviewActive={appState.activeView === "overview"}
    onOpenTasks={() => appState.showTasks()}
    onOpenAppSettings={() => appState.showAppSettings()}
    onOpenWorkspaceSettings={() => appState.showWorkspaceSettings()}
    onOpenSearch={() => (searchOpen = true)}
  />
  <main class="relative flex h-full min-h-0 min-w-0 flex-col">
    <!--
      Invisible Tauri drag handle across the top of the main pane. Keeps the
      title-bar grab area usable when the sidebar is collapsed/hidden or the
      pointer is anywhere outside the sidebar strip. Do NOT remove — without
      this, the window can only be dragged from the 34px sidebar chrome,
      which breaks on secondary displays and in sidebar-hidden layouts.
    -->
    <div
      class="absolute inset-x-0 top-0 z-40 h-[28px] pointer-events-auto"
      data-tauri-drag-region
      aria-hidden="true"
    ></div>
    {#if !appState.demoMode && appState.workspaces.length === 0}
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
        <button
          type="button"
          data-testid="frontend-create-workspace"
          class="mt-1 h-7 px-4 rounded-[5px] text-[12px] font-medium text-bg-base bg-accent hover:bg-accent-hover transition-colors"
          onclick={() => (showCreateWorkspace = true)}
        >
          Create Workspace
        </button>
      </div>
    {:else if appState.activeView === "overview" && appState.selectedWorkspace}
      <OverviewView
        workspace={appState.selectedWorkspace}
        tasks={appState.workspaceTasks}
        onSelectThread={(id) => appState.selectThread(id)}
        onOpenTasks={() => appState.showTasks()}
      />
    {:else if appState.activeView === "app-settings"}
      <AppSettingsView />
    {:else if appState.activeView === "settings" && appState.selectedWorkspaceId}
      <WorkspaceSettingsView
        workspaceId={appState.selectedWorkspaceId}
        onUpdateName={(name) =>
          appState.updateWorkspace(appState.selectedWorkspaceId!, name)}
        onDelete={() => {
          const id = appState.selectedWorkspaceId!;
          appState.activeView = "overview";
          void appState.deleteWorkspace(id);
        }}
      />
    {:else if appState.activeView === "create-agent" && appState.selectedWorkspaceId}
      <AgentCreatorView
        knownAgents={appState.knownAgents}
        onCreate={async (name, provider) => {
          const agentId = await appState.createAgentDefinition(
            appState.selectedWorkspaceId!,
            name,
            provider,
          );
          appState.selectAgent(agentId);
        }}
        onCancel={() => {
          if (appState.selectedWorkspaceId) {
            appState.selectWorkspace(appState.selectedWorkspaceId);
          }
        }}
      />
    {:else if appState.activeView === "tasks" && appState.selectedWorkspaceId}
      <div
        class="grid min-h-0 flex-1 min-w-0"
        style="grid-template-columns: {taskGridColumns};"
      >
        <TaskTableView
          tasks={appState.workspaceTasks}
          selectedTaskId={appState.selectedTaskId}
          {agentNames}
          onSelectTask={(id) => appState.selectTask(id)}
          onNavigateToSession={(threadId) => appState.selectThread(threadId)}
          onCreateTask={() => appState.openCreateTask()}
        />
        {#if appState.taskSidebarMode === "create"}
          <CreateTaskSidebar
            agentDefinitions={Object.values(appState.agentDefinitionsMap ?? {})}
            existingTasks={appState.workspaceTasks}
            onClose={() => appState.closeTaskSidebar()}
            onCreate={async (title, desc, agentId, blockerIds) => {
              await appState.createTask(
                appState.selectedWorkspaceId!,
                title,
                desc,
                agentId,
                blockerIds,
              );
              appState.closeTaskSidebar();
            }}
          />
        {:else}
          {@render taskDetailSidebar()}
        {/if}
      </div>
    {:else if appState.activeView === "agent-threads" && appState.selectedAgentDef}
      {@const def = appState.selectedAgentDef}
      <div
        class="grid min-h-0 flex-1"
        style="grid-template-columns: {taskGridColumns};"
      >
        <ThreadListView
          agentDefinition={def}
          activeThreadId={appState.selectedThreadId}
          onSelectThread={(id) => appState.selectThread(id)}
          onNewThread={async () => {
            const threadId = await appState.spawnThread(def.id);
            appState.selectThread(threadId);
          }}
          onUpdateName={(name) => appState.updateAgentDefinition(def.id, name)}
          onUpdateSystemPrompt={(next) =>
            appState.updateAgentSystemPrompt(def.id, next)}
          onResumeThread={(id) => appState.resumeThread(id)}
          onStopThread={(id) => appState.stopThread(id)}
          onDeleteThread={(id) => appState.deleteThread(id)}
          onDeleteAgent={() => appState.deleteAgentDefinition(def.id)}
        />
        {@render taskDetailSidebar()}
      </div>
    {:else if appState.activeView === "agent-chat" && appState.selectedThread}
      {@const thread = appState.selectedThread}
      {@const task = thread.taskId
        ? (appState.tasks[thread.taskId] ?? null)
        : null}
      <div
        class="grid min-h-0 flex-1 min-w-0"
        style="grid-template-columns: {taskGridColumns};"
      >
        <div class="relative flex min-h-0 min-w-0 flex-col">
          {#if task}
            <ChatTaskBanner {task} onOpen={(id) => appState.selectTask(id)} />
          {/if}
          <ChatArea
            {thread}
            hasTaskBanner={task != null}
            notificationQueue={appState.selectedThreadNotificationQueue}
          />
          <ChatInput
            {thread}
            demoMode={appState.demoMode}
            pendingQueue={appState.selectedThreadComposerQueue}
            pushToComposer={composerPush}
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
            onRemoveQueueItem={(id) => {
              const threadId = appState.selectedThreadId;
              if (threadId) appState.removeQueueItem(threadId, id);
            }}
            onEditQueueItem={(id, content) =>
              handleEditQueueItem(appState.selectedThreadId, id, content)}
            onClearQueue={() => {
              const threadId = appState.selectedThreadId;
              if (threadId) appState.clearQueue(threadId);
            }}
          />
        </div>
        {@render taskDetailSidebar()}
      </div>
    {:else}
      <div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatArea
          thread={appState.selectedAgent}
          hasTaskBanner={false}
          notificationQueue={appState.selectedThreadNotificationQueue}
        />
        <ChatInput
          thread={appState.selectedAgent}
          demoMode={appState.demoMode}
          pendingQueue={appState.selectedThreadComposerQueue}
          pushToComposer={composerPush}
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
          onRemoveQueueItem={(id) => {
            const threadId = appState.selectedThreadId;
            if (threadId) appState.removeQueueItem(threadId, id);
          }}
          onEditQueueItem={(id, content) =>
            handleEditQueueItem(appState.selectedThreadId, id, content)}
          onClearQueue={() => {
            const threadId = appState.selectedThreadId;
            if (threadId) appState.clearQueue(threadId);
          }}
        />
      </div>
    {/if}
  </main>
</div>

{#if showCreateWorkspace}
  <CreateWorkspaceDialog
    onConfirm={async (name) => {
      showCreateWorkspace = false;
      await appState.createWorkspace(name);
    }}
    onCancel={() => (showCreateWorkspace = false)}
  />
{/if}

{#if searchOpen}
  <SearchCommand
    threads={searchThreads}
    onSelect={(threadId) => {
      // selectThread (src/stores/app-state.svelte.ts:556) handles setting
      // selectedThreadId, auto-selecting the owning agent, switching to
      // agent-chat, and dead-thread resume logic.
      appState.selectThread(threadId);
      searchOpen = false;
    }}
    onClose={() => (searchOpen = false)}
  />
{/if}
