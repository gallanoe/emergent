<!-- src/components/ContextMenu.svelte -->
<script module lang="ts">
  export type MenuItem =
    | { label: string; action: string; type?: undefined }
    | { type: "separator"; label?: undefined; action?: undefined };
</script>

<script lang="ts">
  import { onMount } from "svelte";

  interface Props {
    x: number;
    y: number;
    items: MenuItem[];
    onaction: (action: string) => void;
    onclose: () => void;
  }

  let { x, y, items, onaction, onclose }: Props = $props();

  let menuEl: HTMLDivElement | undefined = $state();
  let focusIndex = $state(0);

  const actionItems = $derived(
    items.filter(
      (item): item is MenuItem & { action: string } =>
        item.type !== "separator",
    ),
  );

  onMount(() => {
    menuEl?.focus();

    const handler = (e: MouseEvent) => {
      if (menuEl && !menuEl.contains(e.target as Node)) {
        onclose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  });

  function handleKeyDown(e: KeyboardEvent) {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        onclose();
        break;
      case "ArrowDown":
        e.preventDefault();
        focusIndex = (focusIndex + 1) % actionItems.length;
        break;
      case "ArrowUp":
        e.preventDefault();
        focusIndex = (focusIndex - 1 + actionItems.length) % actionItems.length;
        break;
      case "Enter":
        e.preventDefault();
        if (actionItems[focusIndex]) {
          onaction(actionItems[focusIndex]!.action);
          onclose();
        }
        break;
    }
  }
</script>

<div
  bind:this={menuEl}
  role="menu"
  tabindex={0}
  onkeydown={handleKeyDown}
  style="position: fixed; left: {Math.min(
    x,
    globalThis.innerWidth - 200,
  )}px; top: {Math.min(
    y,
    globalThis.innerHeight - items.length * 28 - 16,
  )}px; background: var(--color-bg-hover); border: 1px solid var(--color-border-default); border-radius: 4px; padding: 4px 0; min-width: 160px; z-index: 1000; outline: none;"
>
  {#each items as item, i}
    {#if item.type === "separator"}
      <div
        style="height: 1px; background: var(--color-border-default); margin: 4px 0;"
      ></div>
    {:else}
      {@const aIdx = items
        .slice(0, i)
        .filter((it) => it.type !== "separator").length}
      <div
        role="menuitem"
        onclick={() => {
          onaction(item.action);
          onclose();
        }}
        class="interactive"
        style="height: 28px; display: flex; align-items: center; padding: 0 12px; font-size: 13px; color: {aIdx ===
        focusIndex
          ? 'var(--color-fg-heading)'
          : 'var(--color-fg-default)'}; background: {aIdx === focusIndex
          ? 'var(--color-bg-active)'
          : 'transparent'};"
      >
        {item.label}
      </div>
    {/if}
  {/each}
</div>
