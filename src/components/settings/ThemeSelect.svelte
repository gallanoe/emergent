<script lang="ts">
  type ThemeValue = "system" | "dark" | "light";

  interface Props {
    value: ThemeValue;
    onchange: (next: ThemeValue) => void;
  }

  let { value, onchange }: Props = $props();

  const options = ["system", "dark", "light"] as const;
</script>

<div
  class="inline-flex rounded-lg border border-border-default bg-bg-elevated p-[3px]"
>
  {#each options as v (v)}
    <button
      type="button"
      class="rounded-md px-[14px] py-[5px] text-[11px] font-medium capitalize {value ===
      v
        ? 'bg-bg-hover text-fg-heading shadow-[var(--shadow-sm)]'
        : 'text-fg-disabled'}"
      onclick={() => onchange(v)}
    >
      {v}
    </button>
  {/each}
</div>
