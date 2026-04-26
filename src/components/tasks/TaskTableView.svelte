<script lang="ts">
  import { Plus, Lock } from "@lucide/svelte";
  import { Button, Mono, TaskStatusPill } from "../../lib/primitives";
  import type { DisplayTask } from "../../stores/types";

  interface Props {
    tasks: DisplayTask[];
    selectedTaskId: string | null;
    agentNames: Record<string, string>;
    containerRunning: boolean;
    onSelectTask: (id: string) => void;
    onNavigateToSession?: (threadId: string) => void;
    onCreateTask: () => void;
  }

  let {
    tasks,
    selectedTaskId,
    agentNames,
    containerRunning,
    onSelectTask,
    onNavigateToSession,
    onCreateTask,
  }: Props = $props();

  type Filter = "all" | "working" | "pending" | "completed" | "failed";
  let filter = $state<Filter>("all");

  const FILTERS: Filter[] = [
    "all",
    "working",
    "pending",
    "completed",
    "failed",
  ];

  const statusOrder: Record<string, number> = {
    working: 0,
    pending: 1,
    completed: 2,
    failed: 3,
  };

  const filteredAndSorted = $derived.by(() => {
    const base =
      filter === "all" ? tasks : tasks.filter((t) => t.status === filter);
    return base.toSorted((a, b) => {
      const s = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
      return s !== 0 ? s : a.id.localeCompare(b.id);
    });
  });

  function countFor(f: Filter): number {
    return f === "all"
      ? tasks.length
      : tasks.filter((t) => t.status === f).length;
  }

  function handleRowClick(task: DisplayTask) {
    if (task.session_id && onNavigateToSession) {
      onNavigateToSession(task.session_id);
    } else {
      onSelectTask(task.id);
    }
  }
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
  <div class="flex items-baseline gap-[10px] px-5 pt-5">
    <h1 class="text-[20px] font-semibold tracking-[-0.01em] text-fg-heading">
      Tasks
    </h1>
    <Mono size={11} color="var(--color-fg-disabled)">
      {#snippet children()}
        {filteredAndSorted.length} shown · {tasks.length} total
      {/snippet}
    </Mono>
  </div>

  <div
    class="flex flex-1 flex-col gap-[10px] overflow-hidden px-5 pb-[14px] pt-3 min-h-0"
  >
    <div class="flex items-center gap-[6px]">
      {#each FILTERS as f (f)}
        {@const active = filter === f}
        <button
          type="button"
          class="inline-flex items-center gap-[6px] rounded-md border px-[10px] py-[4px] text-[11px] font-medium capitalize
                 {active
            ? 'border-border-strong bg-bg-selected text-fg-heading'
            : 'border-border-default text-fg-muted hover:bg-bg-hover'}"
          onclick={() => (filter = f)}
        >
          <span>{f}</span>
          <span
            class="font-mono text-[10px] {active
              ? 'text-fg-muted'
              : 'text-fg-disabled'}"
          >
            {countFor(f)}
          </span>
        </button>
      {/each}

      <div class="flex-1"></div>

      <Button
        variant="secondary"
        size="xs"
        disabled={!containerRunning}
        title={containerRunning
          ? "Create a new task"
          : "Start the workspace container to create tasks"}
        onclick={onCreateTask}
      >
        {#snippet icon()}<Plus size={11} />{/snippet}
        {#snippet children()}New task{/snippet}
      </Button>
    </div>

    <div
      class="min-h-0 flex-1 overflow-hidden overflow-y-auto rounded-[8px] border border-border-default"
    >
      <div
        class="sticky top-0 z-[1] grid grid-cols-[80px_80px_1fr_80px_120px_72px] border-b border-border-default bg-bg-elevated text-[10px] font-medium uppercase tracking-[0.06em] text-fg-muted"
      >
        <div class="px-[10px] py-2">Task</div>
        <div class="px-1 py-2">Status</div>
        <div class="px-2 py-2">Title</div>
        <div class="px-[6px] py-2">Parent</div>
        <div class="px-[6px] py-2">Agent</div>
        <div class="px-[6px] py-2">Blockers</div>
      </div>

      {#each filteredAndSorted as t, i (t.id)}
        {@const dim = t.status === "completed" || t.status === "failed"}
        {@const selected = selectedTaskId === t.id}
        <button
          type="button"
          aria-label={`Task ${t.id}: ${t.title}`}
          class="grid w-full grid-cols-[80px_80px_1fr_80px_120px_72px] items-center text-left
                 {i === filteredAndSorted.length - 1
            ? ''
            : 'border-b border-border-default'}
                 {selected ? 'bg-bg-selected' : 'hover:bg-bg-hover'}
                 {dim ? 'opacity-[0.55]' : ''}"
          onclick={() => handleRowClick(t)}
        >
          <div
            class="px-[10px] py-[10px] font-mono text-[10px] text-fg-disabled"
          >
            {t.id}
          </div>
          <div class="px-1 py-[10px]">
            <TaskStatusPill status={t.status} />
          </div>
          <div
            class="truncate px-2 py-[10px] text-[12px] {dim
              ? 'text-fg-muted'
              : 'text-fg-heading'}"
          >
            {t.title}
          </div>
          <div
            class="px-[6px] py-[10px] font-mono text-[10px] text-fg-disabled"
          >
            {t.parent_id ?? "—"}
          </div>
          <div class="truncate px-[6px] py-[10px] text-[11px] text-fg-muted">
            {agentNames[t.agent_id] ?? t.agent_id}
          </div>
          <div class="px-[6px] py-[10px]">
            {#if t.blocker_ids.length > 0}
              <span
                class="inline-flex items-center gap-1 rounded-full border border-warning/25 bg-warning/10 px-[7px] py-0.5 text-[10px] text-warning"
              >
                <Lock size={9} />
                {t.blocker_ids.length}
              </span>
            {:else}
              <span class="text-[10px] text-fg-disabled">—</span>
            {/if}
          </div>
        </button>
      {/each}

      {#if filteredAndSorted.length === 0}
        <div class="px-4 py-6 text-center text-[12px] text-fg-disabled">
          No tasks match "{filter}".
        </div>
      {/if}
    </div>
  </div>
</div>
