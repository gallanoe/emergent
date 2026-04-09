<script lang="ts">
  import type { DisplayTask } from "../../stores/types";
  import { Lock, X } from "@lucide/svelte";

  interface Props {
    task: DisplayTask;
    allTasks: Record<string, DisplayTask>;
    agentNames: Record<string, string>;
    onClose: () => void;
    onSelectTask: (taskId: string) => void;
    onNavigateToSession: (threadId: string) => void;
  }

  let { task, allTasks, agentNames, onClose, onSelectTask, onNavigateToSession }: Props =
    $props();

  const blockerTasks = $derived(
    task.blocker_ids
      .map((id) => allTasks[id])
      .filter((t): t is DisplayTask => t != null),
  );

  const childTasks = $derived(
    Object.values(allTasks).filter((t) => t.parent_id === task.id),
  );

  function statusClasses(status: string): string {
    switch (status) {
      case "working":
        return "text-success bg-success/10 border-success/20";
      case "pending":
        return "text-fg-muted bg-bg-selected border-border-strong";
      case "completed":
        return "text-fg-muted bg-bg-selected border-border-strong";
      case "failed":
        return "text-error bg-error/10 border-error/20";
      default:
        return "text-fg-muted bg-bg-selected border-border-strong";
    }
  }

  function relativeTime(ts: string): string {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }
</script>

<div class="flex flex-col h-full bg-bg-sidebar">
  <!-- Header -->
  <div
    class="flex items-center justify-between px-4 py-3.5 border-b border-border-default"
  >
    <div class="flex items-center gap-2">
      <span class="text-[13px] font-semibold text-fg-heading">Task</span>
      <span class="text-[11px] font-mono text-fg-muted">{task.id}</span>
    </div>
    <button
      class="interactive flex items-center justify-center w-6 h-6 rounded-[5px] text-fg-muted"
      onclick={onClose}
    >
      <X size={14} />
    </button>
  </div>

  <!-- Body -->
  <div class="flex-1 overflow-y-auto p-4">
    <!-- Status badges -->
    <div class="flex items-center gap-2 mb-2.5">
      <span
        class="inline-flex items-center gap-1.5 text-[10px] font-medium border rounded-full px-2 py-0.5 {statusClasses(task.status)}"
      >
        {task.status.charAt(0).toUpperCase() + task.status.slice(1)}
      </span>
      {#if blockerTasks.some((b) => b.status !== "completed")}
        <span
          class="inline-flex items-center gap-1 text-[10px] text-warning bg-warning/10 border border-warning/20 rounded-full px-2 py-0.5"
        >
          <Lock size={10} />
          Blocked
        </span>
      {/if}
    </div>

    <!-- Title + description -->
    <h3 class="text-[14px] font-semibold text-fg-heading mb-1.5">
      {task.title}
    </h3>
    <p class="text-[12px] text-fg-muted leading-relaxed mb-5">
      {task.description}
    </p>

    <!-- Metadata -->
    <div
      class="grid gap-y-2.5 text-[12px] py-3.5 border-t border-border-default"
      style="grid-template-columns: 68px 1fr;"
    >
      <span class="text-fg-disabled">Agent</span>
      <span class="text-fg-muted">
        {agentNames[task.agent_id] ?? task.agent_id}
      </span>

      <span class="text-fg-disabled">Session</span>
      {#if task.session_id}
        <button
          class="text-fg-muted hover:text-fg-heading text-left"
          onclick={() => task.session_id && onNavigateToSession(task.session_id)}
        >
          {task.session_id}
        </button>
      {:else}
        <span class="text-fg-disabled italic">Not started</span>
      {/if}

      {#if task.parent_id}
        <span class="text-fg-disabled">Parent</span>
        <button
          class="text-fg-muted hover:text-fg-heading font-mono text-[11px] text-left"
          onclick={() => task.parent_id && onSelectTask(task.parent_id)}
        >
          {task.parent_id}
        </button>
      {/if}

      <span class="text-fg-disabled">Created</span>
      <span class="text-fg-muted">{relativeTime(task.created_at)}</span>
    </div>

    <!-- Blockers -->
    {#if task.blocker_ids.length > 0}
      <div class="py-3.5 border-t border-border-default">
        <div
          class="text-[10px] font-medium uppercase tracking-wider text-fg-disabled mb-2"
        >
          Blocked by
        </div>
        <div class="flex flex-col gap-1.5">
          {#each blockerTasks as blocker (blocker.id)}
            <button
              class="flex items-center gap-2 px-2.5 py-2 bg-bg-elevated border border-border-default rounded-md hover:bg-bg-hover text-left"
              onclick={() => onSelectTask(blocker.id)}
            >
              <div class="flex-1 min-w-0">
                <div class="text-[11px] text-fg-heading truncate">
                  {blocker.title}
                </div>
                <div class="text-[10px] font-mono text-fg-disabled mt-0.5">
                  {blocker.id}
                </div>
              </div>
              <span
                class="text-[9px] font-medium border rounded-full px-1.5 py-0.5 {statusClasses(blocker.status)}"
              >
                {blocker.status}
              </span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Child tasks -->
    {#if childTasks.length > 0}
      <div class="py-3.5 border-t border-border-default">
        <div
          class="text-[10px] font-medium uppercase tracking-wider text-fg-disabled mb-2"
        >
          Child tasks
        </div>
        <div class="flex flex-col gap-1.5">
          {#each childTasks as child (child.id)}
            <button
              class="flex items-center gap-2 px-2.5 py-2 bg-bg-elevated border border-border-default rounded-md hover:bg-bg-hover text-left"
              onclick={() => onSelectTask(child.id)}
            >
              <div class="flex-1 min-w-0">
                <div class="text-[11px] text-fg-heading truncate">
                  {child.title}
                </div>
                <div class="text-[10px] font-mono text-fg-disabled mt-0.5">
                  {child.id}
                </div>
              </div>
              <span
                class="text-[9px] font-medium border rounded-full px-1.5 py-0.5 {statusClasses(child.status)}"
              >
                {child.status}
              </span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>
