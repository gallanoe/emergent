<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { MenuItem } from "../../stores/types";

  interface Props {
    x: number;
    y: number;
    items: MenuItem[];
    onSelect: (id: string) => void;
    onClose: () => void;
  }

  let { x, y, items, onSelect, onClose }: Props = $props();

  let menuEl: HTMLDivElement | undefined = $state();
  let offsetX = $state(0);
  let offsetY = $state(0);
  let adjustedX = $derived(x + offsetX);
  let adjustedY = $derived(y + offsetY);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  function handleMousedown(e: MouseEvent) {
    if (menuEl && !menuEl.contains(e.target as Node)) {
      onClose();
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeydown);
    document.addEventListener("mousedown", handleMousedown);

    // Viewport-aware positioning: flip if menu overflows
    if (menuEl) {
      const rect = menuEl.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        offsetX = -rect.width;
      }
      if (rect.bottom > window.innerHeight) {
        offsetY = -rect.height;
      }
    }
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeydown);
    document.removeEventListener("mousedown", handleMousedown);
  });
</script>

<div
  bind:this={menuEl}
  class="fixed z-[200] min-w-[180px] rounded-[8px] border border-border-strong bg-bg-elevated p-1 shadow-[var(--shadow-md)]"
  style="left: {adjustedX}px; top: {adjustedY}px;"
  data-testid="context-menu"
>
  {#each items as item (item.id)}
    {#if item.separator}
      <div class="mx-[6px] my-1 h-px bg-border-default"></div>
    {:else}
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-[5px] px-[10px] py-[6px] text-left text-[12px]
          {item.disabled
          ? 'cursor-not-allowed text-fg-disabled hover:bg-transparent'
          : item.danger
            ? 'cursor-default text-error hover:bg-error/10'
            : 'cursor-default text-fg-default hover:bg-bg-hover'}"
        onclick={() => {
          if (!item.disabled) onSelect(item.id);
        }}
        disabled={item.disabled}
      >
        {#if item.icon}
          <item.icon size={13} class="opacity-70 shrink-0" />
        {/if}
        {item.label}
        {#if item.shortcut}
          <span
            class="ml-auto text-[10px] text-fg-disabled font-[family-name:var(--font-mono)]"
            >{item.shortcut}</span
          >
        {/if}
      </button>
    {/if}
  {/each}
</div>
