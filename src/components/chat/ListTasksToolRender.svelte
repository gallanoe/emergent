<script lang="ts">
  import { Mono } from "../../lib/primitives";
  import type { DisplayTask } from "../../stores/types";

  interface Props {
    tasks: DisplayTask[];
  }

  let { tasks }: Props = $props();

  // Minimal status glyphs per em-tool-calls.jsx:376-383.
  function statusGlyph(status: DisplayTask["status"]): string {
    switch (status) {
      case "completed":
        return "✓";
      case "failed":
        return "⊘";
      case "working":
        return "●";
      case "pending":
      default:
        return "○";
    }
  }

  function statusColor(status: DisplayTask["status"]): string {
    switch (status) {
      case "completed":
        return "var(--color-fg-disabled)";
      case "failed":
        return "var(--color-error)";
      case "working":
        return "var(--color-success)";
      case "pending":
      default:
        return "var(--color-fg-muted)";
    }
  }
</script>

<div class="flex flex-col gap-1" style:padding="8px 10px 10px 32px">
  {#if tasks.length === 0}
    <div class="text-[11px] text-fg-muted">No tasks in this workspace</div>
  {:else}
    {#each tasks as task (task.id)}
      <div
        class="grid items-center gap-2"
        style:grid-template-columns="14px 56px 1fr auto"
      >
        <span
          class="text-center select-none"
          style:color={statusColor(task.status)}
          style:font-size="11px"
        >
          {statusGlyph(task.status)}
        </span>
        <Mono size={10.5} color="var(--color-fg-disabled)">{task.id}</Mono>
        <span
          class="text-[12px] truncate"
          style:color={task.status === "completed"
            ? "var(--color-fg-muted)"
            : "var(--color-fg-default)"}
          style:text-decoration={task.status === "completed"
            ? "line-through"
            : "none"}
        >
          {task.title}
        </span>
        <Mono size={10.5} color="var(--color-fg-disabled)">
          {task.agent_id ? `agent ${task.agent_id}` : ""}
        </Mono>
      </div>
    {/each}
  {/if}
</div>
