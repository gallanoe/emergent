<script lang="ts">
  import { Mono } from "../../lib/primitives";

  interface Props {
    label: string;
    value: string;
    series: number[];
  }

  let { label, value, series }: Props = $props();

  const max = $derived(Math.max(...series, 1));
</script>

<div class="grid grid-cols-[56px_1fr_auto] items-center gap-[10px]">
  <Mono size={10.5} color="var(--color-fg-muted)">{label}</Mono>
  <div class="flex h-[18px] items-end gap-0.5" data-testid="mini-metric-bars">
    {#each series as v, i (i)}
      <div
        class="mini-bar min-h-[2px] flex-1 rounded-[1px] bg-fg-muted/45"
        style:height="{(v / max) * 100}%"
      ></div>
    {/each}
  </div>
  <Mono size={10.5} color="var(--color-fg)">{value}</Mono>
</div>
