<script lang="ts">
  import type { DisplayToolCall } from "../../stores/types";

  // Accept the normal `DisplayToolCall["status"]` plus a forward-looking
  // `"permission"` state. The backend doesn't emit permission yet; the
  // glyph is ready so the UI can wire it up the moment the state lands.
  export type ToolStatusGlyphStatus = DisplayToolCall["status"] | "permission";

  interface Props {
    status: ToolStatusGlyphStatus;
    size?: number;
  }

  let { status, size = 10 }: Props = $props();

  // Colors key off our existing tokens. Pending is muted (disabled fg) because
  // it's "queued and waiting"; completed is intentionally silent (muted fg,
  // not bright success green) to avoid a wall of green on long traces.
  const COLORS: Record<ToolStatusGlyphStatus, string> = {
    pending: "var(--color-fg-disabled)",
    in_progress: "var(--color-fg-default)",
    completed: "var(--color-fg-muted)",
    failed: "var(--color-error)",
    permission: "var(--color-warning)",
  };

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
{:else if status === "permission"}
  <!-- Amber triangle from em-tool-calls.jsx:155-162. Reserved for the
       backend's future `permission` status; unused today. -->
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    style:color
    aria-label="permission"
  >
    <path
      d="M8 2l6.5 11.5h-13z"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linejoin="round"
    />
    <path
      d="M8 6.5v3M8 11.2v.3"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
    />
  </svg>
{/if}
