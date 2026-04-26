<script lang="ts">
  import { Mono } from "../../lib/primitives";

  interface Props {
    label: string;
    count: number;
    /** CSS color, e.g. var(--color-success) */
    color: string;
    dim?: boolean;
  }

  let { label, count, color, dim = false }: Props = $props();
</script>

<div class="flex items-center gap-[10px]">
  <span
    class="h-[6px] w-[6px] shrink-0 rounded-full"
    style:background={color}
    style:opacity={dim ? 0.55 : 1}
  ></span>
  <span
    class="flex-1 text-[12px]"
    class:text-fg-muted={dim}
    class:text-fg={!dim}>{label}</span
  >
  <Mono
    size={11}
    color={dim ? "var(--color-fg-disabled)" : "var(--color-fg-heading)"}
    >{count}</Mono
  >
</div>
