<script lang="ts">
  import type { DisplayTask } from "../../stores/types";
  import { Lock } from "@lucide/svelte";

  interface Props {
    tasks: DisplayTask[];
    selectedTaskId: string | null;
    agentScoped?: boolean;
    agentNames?: Record<string, string>;
    onSelectTask: (taskId: string) => void;
    onNavigateToSession?: (threadId: string) => void;
  }

  let {
    tasks,
    selectedTaskId,
    agentScoped = false,
    agentNames = {},
    onSelectTask,
    onNavigateToSession,
  }: Props = $props();

  function handleRowClick(task: DisplayTask) {
    // If the task has a session, navigate to the chat view; otherwise open detail sidebar
    if (task.session_id && onNavigateToSession) {
      onNavigateToSession(task.session_id);
    } else {
      onSelectTask(task.id);
    }
  }

  const statusOrder: Record<string, number> = {
    working: 0,
    pending: 1,
    completed: 2,
    failed: 3,
  };

  const sortedTasks = $derived(
    [...tasks].sort((a, b) => {
      const statusDiff =
        (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
      if (statusDiff !== 0) return statusDiff;
      // Oldest first within each group (natural creation order).
      return (
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    }),
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

  function statusLabel(status: string): string {
    switch (status) {
      case "working":
        return "Working";
      case "pending":
        return "Pending";
      case "completed":
        return "Done";
      case "failed":
        return "Failed";
      default:
        return status;
    }
  }

  function blockerCount(task: DisplayTask): number {
    return task.blocker_ids.length;
  }
</script>

<div class="border border-border-default rounded-lg overflow-hidden">
  <!-- Header -->
  <div
    class="grid items-center bg-bg-elevated border-b border-border-default text-[10px] font-medium text-fg-muted"
    style="grid-template-columns: 72px 62px 1fr 72px {agentScoped
      ? ''
      : '72px '}80px;"
  >
    <div class="px-2.5 py-2">Task</div>
    <div class="py-2 px-1">Status</div>
    <div class="px-2 py-2">Title</div>
    <div class="px-1.5 py-2">Parent</div>
    {#if !agentScoped}
      <div class="px-1.5 py-2">Agent</div>
    {/if}
    <div class="px-1.5 py-2">Blockers</div>
  </div>

  <!-- Rows -->
  {#each sortedTasks as task (task.id)}
    {@const isCompleted =
      task.status === "completed" || task.status === "failed"}
    <button
      class="grid items-center w-full border-b border-border-default last:border-b-0 cursor-pointer transition-colors
             {task.id === selectedTaskId
        ? 'bg-bg-selected'
        : 'hover:bg-bg-hover'}
             {isCompleted ? 'opacity-50' : ''}"
      style="grid-template-columns: 72px 62px 1fr 72px {agentScoped
        ? ''
        : '72px '}80px;"
      onclick={() => handleRowClick(task)}
    >
      <div class="px-2.5 py-2 text-[10px] font-mono text-fg-disabled truncate">
        {task.id}
      </div>
      <div class="py-2 px-1">
        <span
          class="inline-flex items-center gap-1 text-[9px] font-medium border rounded-full px-1.5 py-0.5 {statusClasses(
            task.status,
          )}"
        >
          {#if task.status === "working"}
            <span class="w-1 h-1 rounded-full bg-success animate-pulse"></span>
          {:else if task.status === "pending"}
            <span class="w-1 h-1 rounded-full bg-fg-disabled"></span>
          {:else if task.status === "completed"}
            <svg
              width="9"
              height="9"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              class="text-success"><polyline points="20 6 9 17 4 12" /></svg
            >
          {:else}
            <span class="w-1 h-1 rounded-full bg-error"></span>
          {/if}
          {statusLabel(task.status)}
        </span>
      </div>
      <div class="px-2 py-2 min-w-0">
        <div
          class="text-[11px] truncate {isCompleted
            ? 'text-fg-muted'
            : 'text-fg-heading'}"
        >
          {task.title}
        </div>
        {#if task.description}
          <div class="text-[10px] text-fg-disabled truncate">
            {task.description}
          </div>
        {/if}
      </div>
      <div class="px-1.5 py-2 text-[10px] font-mono text-fg-disabled truncate">
        {task.parent_id ?? "—"}
      </div>
      {#if !agentScoped}
        <div class="px-1.5 py-2 text-[10px] text-fg-muted truncate">
          {agentNames[task.agent_id] ?? task.agent_id}
        </div>
      {/if}
      <div class="px-1.5 py-2">
        {#if blockerCount(task) > 0}
          <span
            class="inline-flex items-center gap-1 text-[9px] text-warning bg-warning/10 border border-warning/20 rounded-full px-1.5 py-0.5"
          >
            <Lock size={9} />
            {blockerCount(task)}
          </span>
        {:else}
          <span class="text-[10px] text-fg-disabled">&mdash;</span>
        {/if}
      </div>
    </button>
  {/each}

  {#if sortedTasks.length === 0}
    <div class="px-4 py-8 text-center text-[11px] text-fg-disabled">
      No tasks yet
    </div>
  {/if}
</div>
