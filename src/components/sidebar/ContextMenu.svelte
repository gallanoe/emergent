<!-- src/components/ContextMenu.svelte -->
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
  class="fixed bg-bg-elevated border border-border-strong rounded-md shadow-[0_4px_16px_rgba(0,0,0,0.1),0_1px_4px_rgba(0,0,0,0.06)] py-1 min-w-[150px] z-[200]"
  style="left: {adjustedX}px; top: {adjustedY}px;"
  data-testid="context-menu"
>
  {#each items as item (item.id)}
    {#if item.separator}
      <div class="h-px bg-border-default my-[3px]"></div>
    {:else}
      <button
        class="flex items-center gap-2 w-full px-3 py-[5px] text-[11px] text-left
          {item.danger ? 'text-error' : 'text-fg-default'}
          {item.disabled ? 'opacity-45 pointer-events-none' : ''}
          {item.danger && !item.disabled
          ? 'hover:bg-error/5'
          : 'hover:bg-bg-hover'}"
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
