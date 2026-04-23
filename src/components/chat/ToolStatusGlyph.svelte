<script lang="ts">
  import type { DisplayToolCall } from "../../stores/types";

  interface Props {
    status: DisplayToolCall["status"];
    size?: number;
  }

  let { status, size = 10 }: Props = $props();

  // Colors key off our existing tokens. Pending is muted (disabled fg) because
  // it's "queued and waiting"; completed is intentionally silent (muted fg,
  // not bright success green) to avoid a wall of green on long traces.
  const COLORS = {
    pending: "var(--color-fg-disabled)",
    in_progress: "var(--color-fg-default)",
    completed: "var(--color-fg-muted)",
    failed: "var(--color-error)",
  } as const;

  let color = $derived(COLORS[status]);
</script>

{#if status === "pending"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 10 10"
    fill="none"
    style:color
    aria-label="pending"
  >
    <circle
      cx="5"
      cy="5"
      r="3.5"
      stroke="currentColor"
      stroke-width="1"
      stroke-dasharray="2 1.5"
    />
  </svg>
{:else if status === "in_progress"}
  <svg
    class="em-tc-spin"
    width={size}
    height={size}
    viewBox="0 0 10 10"
    fill="none"
    style:color
    aria-label="running"
  >
    <circle
      cx="5"
      cy="5"
      r="3.5"
      stroke="currentColor"
      stroke-width="1.2"
      stroke-linecap="round"
      stroke-dasharray="10 10"
    />
  </svg>
{:else if status === "completed"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 10 10"
    fill="none"
    style:color
    aria-label="completed"
  >
    <path
      d="M2 5.5l2 2 4-4"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
{:else if status === "failed"}
  <svg
    width={size}
    height={size}
    viewBox="0 0 10 10"
    fill="none"
    style:color
    aria-label="failed"
  >
    <path
      d="M3 3l4 4M7 3l-4 4"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
    />
  </svg>
{/if}
