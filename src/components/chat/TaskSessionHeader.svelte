<script lang="ts">
  import { ChevronRight, ListChecks } from "@lucide/svelte";
  import type { DisplayTask } from "../../stores/types";

  interface Props {
    task: DisplayTask;
    onOpen: () => void;
  }

  let { task, onOpen }: Props = $props();

  const statusClasses = $derived(
    task.status === "working"
      ? "text-success bg-success/10 border-success/20"
      : task.status === "failed"
        ? "text-error bg-error/10 border-error/20"
        : "text-fg-muted bg-bg-selected border-border-strong",
  );
</script>

<button
  type="button"
  class="interactive flex items-center w-full h-[34px] px-4 gap-2.5 border-b border-border-default bg-bg-sidebar shrink-0 text-left"
  onclick={onOpen}
  title="Open task details"
  aria-label="Open task details for {task.title}"
>
  <ListChecks size={13} class="text-fg-muted shrink-0" />
  <span
    class="text-[10px] font-medium uppercase tracking-[0.07em] text-fg-muted"
  >
    Task
  </span>
  <span
    class="inline-flex items-center text-[10px] font-medium border rounded-full px-2 py-0.5 shrink-0 {statusClasses}"
  >
    {task.status}
  </span>
  <span class="w-px h-3 bg-border-default shrink-0" aria-hidden="true"></span>
  <span class="text-[12px] text-fg-heading font-medium truncate flex-1 min-w-0">
    {task.title}
  </span>
  <span
    class="text-[10.5px] text-fg-disabled font-[family-name:var(--font-mono)] shrink-0"
  >
    {task.id}
  </span>
  <ChevronRight size={14} class="text-fg-disabled shrink-0" />
</button>
