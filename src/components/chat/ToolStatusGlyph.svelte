<script lang="ts">
  import type { Component } from "svelte";
  import {
    CircleDashed,
    LoaderCircle,
    Check,
    X,
    TriangleAlert,
  } from "@lucide/svelte";
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

  const ICONS: Record<ToolStatusGlyphStatus, Component> = {
    pending: CircleDashed,
    in_progress: LoaderCircle,
    completed: Check,
    failed: X,
    permission: TriangleAlert,
  };

  let color = $derived(COLORS[status]);
  let Icon = $derived(ICONS[status]);
</script>

<!-- Lucide icons stroke with `currentColor`, so setting `color` via inline
     style tints them without a per-icon `stroke` override. -->
<Icon
  {size}
  style="color: {color}"
  class={status === "in_progress" ? "em-tc-spin" : ""}
  aria-label={status}
/>
