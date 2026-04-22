<script lang="ts">
  import type { DisplayTask } from "../../stores/types";
  import { Lock, X } from "@lucide/svelte";
  import { Button, Mono, SLabel, TaskStatusPill } from "../../lib/primitives";

  interface Props {
    task: DisplayTask;
    allTasks: Record<string, DisplayTask>;
    agentNames: Record<string, string>;
    onClose: () => void;
    onSelectTask: (taskId: string) => void;
    onNavigateToSession: (threadId: string) => void;
  }

  let {
    task,
    allTasks,
    agentNames,
    onClose,
    onSelectTask,
    onNavigateToSession,
  }: Props = $props();

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

<div
  class="flex h-full min-h-0 flex-col border-l border-border-default bg-bg-sidebar px-4 py-4"
>
  <div class="mb-3 flex items-start justify-between gap-2">
    <div class="flex min-w-0 flex-col gap-1">
      <div class="flex flex-wrap items-baseline gap-2">
        <span class="text-[13px] font-semibold text-fg-heading">Task</span>
        <Mono size={11} color="var(--color-fg-muted)">
          {#snippet children()}{task.id}{/snippet}
        </Mono>
      </div>
    </div>
    <Button variant="ghost" size="xs" onclick={onClose} title="Close">
      {#snippet icon()}<X size={14} />{/snippet}
      {#snippet children()}{/snippet}
    </Button>
  </div>

  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <div class="mb-2.5 flex flex-wrap items-center gap-2">
      <TaskStatusPill status={task.status} />
      {#if blockerTasks.some((b) => b.status !== "completed")}
        <span
          class="inline-flex items-center gap-1 rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[10px] text-warning"
        >
          <Lock size={10} />
          Blocked
        </span>
      {/if}
    </div>

    <h3 class="mb-1.5 text-[14px] font-semibold text-fg-heading">
      {task.title}
    </h3>
    <p class="mb-5 text-[12px] leading-relaxed text-fg-muted">
      {task.description}
    </p>

    <div
      class="grid gap-y-2.5 border-t border-border-default py-3.5 text-[12px] grid-cols-[120px_1fr] gap-x-3"
    >
      <Mono size={11} color="var(--color-fg-muted)">
        {#snippet children()}Agent{/snippet}
      </Mono>
      <span>{agentNames[task.agent_id] ?? task.agent_id}</span>

      <Mono size={11} color="var(--color-fg-muted)">
        {#snippet children()}Session{/snippet}
      </Mono>
      {#if task.session_id}
        <button
          type="button"
          class="text-left text-fg-muted hover:text-fg-heading"
          onclick={() =>
            task.session_id && onNavigateToSession(task.session_id)}
        >
          {task.session_id}
        </button>
      {:else}
        <span class="italic text-fg-disabled">Not started</span>
      {/if}

      {#if task.parent_id}
        {@const parentTask = allTasks[task.parent_id]}
        <Mono size={11} color="var(--color-fg-muted)">
          {#snippet children()}Parent{/snippet}
        </Mono>
        <button
          type="button"
          class="flex min-w-0 items-center gap-1.5 text-left text-fg-muted hover:text-fg-heading"
          onclick={() => task.parent_id && onSelectTask(task.parent_id)}
        >
          <span class="truncate">{parentTask?.title ?? task.parent_id}</span>
          <Mono size={10} color="var(--color-fg-disabled)" class="shrink-0">
            {#snippet children()}{task.parent_id}{/snippet}
          </Mono>
        </button>
      {/if}

      <Mono size={11} color="var(--color-fg-muted)">
        {#snippet children()}Created{/snippet}
      </Mono>
      <span>{relativeTime(task.created_at)}</span>
    </div>

    {#if task.blocker_ids.length > 0}
      <div class="border-t border-border-default py-3.5">
        <SLabel class="mb-2 block">Blocked by</SLabel>
        <div class="flex flex-col gap-1.5">
          {#each blockerTasks as blocker (blocker.id)}
            <button
              type="button"
              class="flex items-center gap-2 rounded-md border border-border-default bg-bg-elevated px-2.5 py-2 text-left hover:bg-bg-hover"
              onclick={() => onSelectTask(blocker.id)}
            >
              <div class="min-w-0 flex-1">
                <div class="truncate text-[11px] text-fg-heading">
                  {blocker.title}
                </div>
                <div class="mt-0.5 font-mono text-[10px] text-fg-disabled">
                  {blocker.id}
                </div>
              </div>
              <span
                class="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium {statusClasses(
                  blocker.status,
                )}"
              >
                {blocker.status}
              </span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if childTasks.length > 0}
      <div class="border-t border-border-default py-3.5">
        <SLabel class="mb-2 block">Child tasks</SLabel>
        <div class="flex flex-col gap-1.5">
          {#each childTasks as child (child.id)}
            <button
              type="button"
              class="flex items-center gap-2 rounded-md border border-border-default bg-bg-elevated px-2.5 py-2 text-left hover:bg-bg-hover"
              onclick={() => onSelectTask(child.id)}
            >
              <div class="min-w-0 flex-1">
                <div class="truncate text-[11px] text-fg-heading">
                  {child.title}
                </div>
                <div class="mt-0.5 font-mono text-[10px] text-fg-disabled">
                  {child.id}
                </div>
              </div>
              <span
                class="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium {statusClasses(
                  child.status,
                )}"
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
