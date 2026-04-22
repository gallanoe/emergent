<script lang="ts">
  import type { ThreadProcessStatus } from "../../stores/types";

  type DotStatus = ThreadProcessStatus | "dead" | "stopped" | "building";

  interface Props {
    status?: DotStatus;
    size?: number;
    ring?: boolean;
  }

  const STATUS_COLORS: Record<DotStatus, string> = {
    idle: "var(--color-success)",
    working: "var(--color-success)",
    initializing: "var(--color-warning)",
    building: "var(--color-warning)",
    error: "var(--color-error)",
    dead: "var(--color-fg-disabled)",
    stopped: "var(--color-fg-disabled)",
  };

  let { status = "idle", size = 8, ring = false }: Props = $props();

  const pulsing = $derived(
    status === "working" || status === "initializing" || status === "building",
  );

  const color = $derived(STATUS_COLORS[status] ?? STATUS_COLORS.idle);
</script>

<span
  class="relative inline-block rounded-full {pulsing ? 'em-dot-pulse' : ''}"
  style:width="{size}px"
  style:height="{size}px"
  style:background={color}
  style:color
  style:border={ring ? "2px solid var(--color-bg-sidebar)" : "none"}
></span>
