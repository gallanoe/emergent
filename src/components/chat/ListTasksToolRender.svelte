<script lang="ts">
  import type { DisplayTask } from "../../stores/types";

  interface Props {
    tasks: DisplayTask[];
  }

  let { tasks }: Props = $props();

  function statusClasses(status: DisplayTask["status"]): string {
    switch (status) {
      case "working":
        return "text-success bg-success/10 border-success/20";
      case "pending":
        return "text-fg-muted bg-bg-selected border-border-strong";
      case "completed":
        return "text-fg-muted bg-bg-selected border-border-strong";
      case "failed":
        return "text-error bg-error/10 border-error/20";
    }
  }

  function statusLabel(status: DisplayTask["status"]): string {
    switch (status) {
      case "working":
        return "Working";
      case "pending":
        return "Pending";
      case "completed":
        return "Done";
      case "failed":
        return "Failed";
    }
  }
</script>

<div class="py-1.5 flex flex-col gap-1 px-2.5">
  {#if tasks.length === 0}
    <div class="rounded bg-[rgba(0,0,0,0.03)] px-2 py-1.5 text-[11px] text-fg-muted">
      No tasks in this workspace
    </div>
  {:else}
    {#each tasks as task}
      <div class="rounded bg-[rgba(0,0,0,0.03)] px-2 py-1.5">
        <div class="flex items-center gap-2">
          <span
            class="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium {statusClasses(
              task.status,
            )}"
          >
            {statusLabel(task.status)}
          </span>
          <span class="min-w-0 truncate text-[11px] font-medium text-fg-default">{task.title}</span>
        </div>
        <div class="mt-1 flex items-center gap-2 text-[9px] text-fg-disabled">
          <span class="font-[family-name:var(--font-mono)]">{task.id}</span>
          <span class="truncate">agent {task.agent_id}</span>
          {#if task.blocker_ids.length > 0}
            <span>{task.blocker_ids.length} blocker{task.blocker_ids.length === 1 ? "" : "s"}</span>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</div>
