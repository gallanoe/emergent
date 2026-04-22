<script lang="ts">
  import { Mono, SLabel } from "../../lib/primitives";

  interface Props {
    label: string;
    value: string | number;
    sub?: string;
  }

  let { label, value, sub }: Props = $props();
</script>

<div
  class="flex flex-col gap-1 rounded-[10px] border border-border-default bg-bg-elevated px-4 py-[14px]"
>
  <SLabel>{label}</SLabel>
  <div
    class="text-[24px] font-semibold leading-[1.1] tracking-[-0.02em] text-fg-heading"
  >
    {value}
  </div>
  {#if sub}
    <Mono size={10.5} color="var(--color-fg-disabled)">{sub}</Mono>
  {/if}
</div>
