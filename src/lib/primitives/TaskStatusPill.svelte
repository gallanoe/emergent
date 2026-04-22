<script lang="ts">
  import { Check } from "@lucide/svelte";
  import StatusDot from "./StatusDot.svelte";

  type TaskStatus = "working" | "pending" | "completed" | "failed";

  interface Props {
    status: TaskStatus;
  }

  let { status }: Props = $props();

  const LABEL: Record<TaskStatus, string> = {
    working: "Working",
    pending: "Pending",
    completed: "Done",
    failed: "Failed",
  };

  const surface = $derived.by(() => {
    switch (status) {
      case "working":
        return "text-success bg-success/10 border-success/25";
      case "pending":
        return "text-fg-muted bg-bg-selected border-border-strong";
      case "completed":
        return "text-fg-muted bg-bg-selected border-border-strong";
      case "failed":
        return "text-error bg-error/10 border-error/25";
    }
  });
</script>

<span
  class="inline-flex items-center gap-1 rounded-full border px-[7px] py-0.5 text-[10px] font-medium {surface}"
>
  {#if status === "completed"}
    <Check
      class="size-[10px] shrink-0 text-success"
      strokeWidth={2}
      aria-hidden="true"
    />
  {:else if status === "working"}
    <StatusDot status="working" size={5} />
  {:else if status === "pending"}
    <StatusDot status="dead" size={5} />
  {:else}
    <StatusDot status="error" size={5} />
  {/if}
  {LABEL[status]}
</span>
