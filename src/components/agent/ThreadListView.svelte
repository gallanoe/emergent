<script lang="ts">
  import type {
    DisplayAgentDefinition,
    DisplayThread,
    DisplayTask,
    AgentStatus,
  } from "../../stores/types";
  import { Settings, Plus, EllipsisVertical } from "@lucide/svelte";
  import ConfirmDialog from "../ConfirmDialog.svelte";
  import TaskTableView from "../tasks/TaskTableView.svelte";

  interface Props {
    agentDefinition: DisplayAgentDefinition;
    tasks: DisplayTask[];
    onSelectThread: (threadId: string) => void;
    onNewThread: () => void;
    onOpenSettings: () => void;
    onResumeThread: (threadId: string) => void;
    onStopThread: (threadId: string) => void;
    onDeleteThread: (threadId: string) => void;
    onSelectTask: (taskId: string) => void;
  }

  let {
    agentDefinition,
    tasks,
    onSelectThread,
    onNewThread,
    onOpenSettings,
    onResumeThread,
    onStopThread,
    onDeleteThread,
    onSelectTask,
  }: Props = $props();

  let activeTab = $state<"threads" | "tasks">("threads");

  let menuThreadId = $state<string | null>(null);
  let menuPos = $state({ x: 0, y: 0 });
  let deleteThreadId = $state<string | null>(null);

  function statusColor(status: AgentStatus | "dead"): string {
    switch (status) {
      case "idle":
        return "bg-success";
      case "working":
        return "bg-success animate-pulse";
      case "error":
        return "bg-error";
      case "initializing":
        return "bg-warning animate-pulse";
      case "dead":
        return "bg-fg-disabled opacity-40";
      default:
        return "bg-fg-disabled";
    }
  }

  function isAlive(status: AgentStatus | "dead"): boolean {
    return (
      status === "idle" || status === "working" || status === "initializing"
    );
  }

  function relativeTime(timestamp: string): string {
    if (!timestamp || timestamp === "just now") return "just now";
    return timestamp;
  }

  function openMenu(e: MouseEvent, threadId: string) {
    e.stopPropagation();
    if (menuThreadId === threadId) {
      menuThreadId = null;
    } else {
      const btn = e.currentTarget as HTMLElement;
      const rect = btn.getBoundingClientRect();
      menuPos = { x: rect.right, y: rect.bottom + 4 };
      menuThreadId = threadId;
    }
  }

  function handleAction(
    action: "resume" | "stop" | "delete",
    thread: DisplayThread,
  ) {
    menuThreadId = null;
    switch (action) {
      case "resume":
        onResumeThread(thread.id);
        break;
      case "stop":
        onStopThread(thread.id);
        break;
      case "delete":
        deleteThreadId = thread.id;
        break;
    }
  }
</script>

<!-- Close menu on click outside -->
{#if menuThreadId}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-40"
    onclick={() => (menuThreadId = null)}
    onkeydown={() => {}}
  ></div>
{/if}

<div class="flex flex-col min-h-0 flex-1">
  <!-- Top bar -->
  <div
    class="flex items-center h-[38px] px-5 border-b border-border-default flex-shrink-0 relative z-[60]"
  >
    <span class="text-[13px] font-semibold text-fg-heading flex-1 truncate"
      >{agentDefinition.name}</span
    >
    <button
      class="interactive flex items-center justify-center w-[26px] h-[26px] rounded-[5px] text-fg-muted"
      title="Agent settings"
      onclick={onOpenSettings}
    >
      <Settings size={14} />
    </button>
  </div>

  <!-- Segmented control -->
  <div class="px-5 pt-3">
    <div
      class="inline-flex items-center bg-bg-elevated border border-border-default rounded-lg p-[3px]"
    >
      <button
        class="px-4 py-[5px] rounded-md text-[11px] font-medium transition-colors
               {activeTab === 'threads'
          ? 'bg-bg-hover text-fg-heading shadow-sm'
          : 'text-fg-disabled'}"
        onclick={() => (activeTab = "threads")}
      >
        Threads
        <span
          class="ml-1 text-[10px] {activeTab === 'threads'
            ? 'text-fg-muted'
            : 'text-fg-disabled'}"
        >
          {agentDefinition.threads.length}
        </span>
      </button>
      <button
        class="px-4 py-[5px] rounded-md text-[11px] font-medium transition-colors
               {activeTab === 'tasks'
          ? 'bg-bg-hover text-fg-heading shadow-sm'
          : 'text-fg-disabled'}"
        onclick={() => (activeTab = "tasks")}
      >
        Tasks
        <span
          class="ml-1 text-[10px] {activeTab === 'tasks'
            ? 'text-fg-muted'
            : 'text-fg-disabled'}"
        >
          {tasks.length}
        </span>
      </button>
    </div>
  </div>

  {#if activeTab === "threads"}
    <!-- Thread list -->
    <div class="flex-1 overflow-y-auto p-3">
      <div class="flex items-center justify-between px-2.5 pb-2">
        <span class="text-[11px] text-fg-disabled">
          {agentDefinition.threads.length} thread{agentDefinition.threads
            .length !== 1
            ? "s"
            : ""}
        </span>
        <button
          class="text-[11px] text-fg-muted border border-border-default rounded-md px-3 py-1 hover:bg-bg-hover transition-colors"
          onclick={onNewThread}
        >
          <span class="flex items-center gap-1.5">
            <Plus size={12} />
            New thread
          </span>
        </button>
      </div>

      <div
        class="text-[10px] font-medium uppercase tracking-wider text-fg-disabled px-2.5 pt-3 pb-1"
      >
        Conversations
      </div>

      {#if agentDefinition.threads.length === 0}
        <div class="px-2.5 py-4 text-[11px] text-fg-disabled text-center">
          No threads yet. Create one to start a conversation.
        </div>
      {:else}
        <div class="max-h-[280px] overflow-y-auto relative">
          {#each agentDefinition.threads as thread (thread.id)}
            <div
              class="relative group mt-0.5 flex items-center rounded-md hover:bg-bg-hover transition-colors"
            >
              <button
                class="flex items-center gap-2 flex-1 min-w-0 px-2.5 py-[7px] text-[12px] text-fg-muted hover:text-fg-heading transition-colors"
                onclick={() => onSelectThread(thread.id)}
              >
                <span
                  class="w-[6px] h-[6px] rounded-full flex-shrink-0 {statusColor(
                    thread.processStatus,
                  )}"
                ></span>
                <span
                  class="text-[12px] flex-shrink-0 opacity-70 w-4 text-center"
                  >💬</span
                >
                <span class="flex-1 truncate text-left">{thread.name}</span>
                <span
                  class="text-[11px] text-fg-disabled flex-shrink-0 group-hover:hidden"
                  >{relativeTime(thread.updatedAt)}</span
                >
              </button>
              <!-- Kebab menu trigger -->
              <button
                class="flex items-center justify-center w-[26px] h-[26px] flex-shrink-0 rounded-[4px] text-fg-disabled opacity-0 group-hover:opacity-100 hover:text-fg-muted transition-all mr-0.5"
                title="Thread actions"
                onclick={(e) => openMenu(e, thread.id)}
              >
                <EllipsisVertical size={13} />
              </button>
            </div>
          {/each}
          <!-- Fade hint for overflow -->
          {#if agentDefinition.threads.length > 5}
            <div
              class="absolute bottom-0 left-0 right-1.5 h-6 bg-gradient-to-t from-bg-base to-transparent pointer-events-none"
            ></div>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <div class="p-3">
      <TaskTableView
        {tasks}
        selectedTaskId={null}
        agentScoped={true}
        onSelectTask={onSelectTask}
        onNavigateToSession={onSelectThread}
      />
    </div>
  {/if}
</div>

{#if menuThreadId}
  {@const thread = agentDefinition.threads.find((t) => t.id === menuThreadId)}
  {#if thread}
    <div
      class="fixed z-50 bg-bg-elevated border border-border-strong rounded-lg p-1 shadow-lg min-w-[130px]"
      style="left: {menuPos.x}px; top: {menuPos.y}px; transform: translateX(-100%);"
    >
      {#if isAlive(thread.processStatus)}
        <button
          class="flex items-center w-full px-2.5 py-[6px] rounded-md text-[11px] text-fg-muted hover:bg-bg-hover hover:text-fg-heading"
          onclick={() => handleAction("stop", thread)}
        >
          Stop
        </button>
      {:else}
        <button
          class="flex items-center w-full px-2.5 py-[6px] rounded-md text-[11px] text-fg-muted hover:bg-bg-hover hover:text-fg-heading"
          onclick={() => handleAction("resume", thread)}
        >
          Start
        </button>
      {/if}
      <button
        class="flex items-center w-full px-2.5 py-[6px] rounded-md text-[11px] text-error hover:bg-error/10"
        onclick={() => handleAction("delete", thread)}
      >
        Delete
      </button>
    </div>
  {/if}
{/if}

{#if deleteThreadId}
  <ConfirmDialog
    title="Delete thread?"
    description="This thread and its session will be permanently removed."
    confirmLabel="Delete"
    onConfirm={() => {
      if (deleteThreadId) onDeleteThread(deleteThreadId);
      deleteThreadId = null;
    }}
    onCancel={() => (deleteThreadId = null)}
  />
{/if}
