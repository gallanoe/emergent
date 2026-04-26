<script lang="ts">
  import type { Snippet } from "svelte";
  import { Mono } from "../../lib/primitives";

  interface Props {
    label: string;
    value?: string;
    readOnly?: boolean;
    last?: boolean;
    edit?: Snippet;
  }

  let { label, value, readOnly = false, last = false, edit }: Props = $props();
</script>

<div
  class="grid grid-cols-[120px_1fr_auto] items-center gap-3 px-[14px] py-[10px] text-[12.5px] {last
    ? ''
    : 'border-b border-border-default'}"
>
  <Mono size={11} color="var(--color-fg-muted)">{label}</Mono>
  {#if edit}
    {@render edit()}
  {:else}
    <span class="text-fg-default font-mono text-[11.5px] truncate"
      >{value ?? "—"}</span
    >
    {#if readOnly}
      <Mono size={10} color="var(--color-fg-disabled)">read-only</Mono>
    {:else}
      <button type="button" class="text-fg-disabled cursor-pointer text-[11]"
        >Edit</button
      >
    {/if}
  {/if}
</div>
