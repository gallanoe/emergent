<script lang="ts">
  import { commandStore } from "../stores/commands.svelte";

  function formatShortcut(shortcut: string): string {
    const isMac = navigator.platform.startsWith("Mac");
    return shortcut
      .replace("Mod+", isMac ? "\u2318" : "Ctrl+")
      .replace("Shift+", isMac ? "\u21E7" : "Shift+")
      .replace("Alt+", isMac ? "\u2325" : "Alt+");
  }

  let query = $state("");
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();
  let previousFocusEl: Element | null = null;

  const commands = $derived(commandStore.commandList);
  const filtered = $derived.by(() => {
    if (!query) return commands;
    const lower = query.toLowerCase();
    return commands.filter((cmd) => cmd.label.toLowerCase().includes(lower));
  });

  $effect(() => {
    if (commandStore.paletteOpen) {
      previousFocusEl = document.activeElement;
      query = "";
      selectedIndex = 0;
      // Need a tick for the DOM to render before focusing
      setTimeout(() => inputEl?.focus(), 0);
    } else if (previousFocusEl instanceof HTMLElement) {
      previousFocusEl.focus();
      previousFocusEl = null;
    }
  });

  $effect(() => {
    // Reset selection when query changes
    query;
    selectedIndex = 0;
  });

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      commandStore.closePalette();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length > 0)
        selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length > 0) selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[selectedIndex];
      if (cmd) {
        commandStore.closePalette();
        commandStore.executeCommand(cmd.id);
      }
    }
  }
</script>

{#if commandStore.paletteOpen}
  <div
    data-testid="palette-backdrop"
    onclick={() => commandStore.closePalette()}
    style="position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100;"
    role="presentation"
  ></div>
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Command Palette"
    style="position: fixed; top: 20%; left: 50%; transform: translateX(-50%); width: 480px; max-width: calc(100vw - 32px); background: #1e1f22; border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); z-index: 101; overflow: hidden; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;"
  >
    <div
      style="padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; gap: 8px;"
    >
      <span style="color: #6b6d7b; font-size: 13px;">{"\u2318"}</span>
      <input
        bind:this={inputEl}
        type="text"
        placeholder="Type a command..."
        bind:value={query}
        onkeydown={handleKeyDown}
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-results"
        aria-activedescendant={filtered[selectedIndex]
          ? `palette-item-${filtered[selectedIndex]!.id}`
          : ""}
        style="flex: 1; background: transparent; border: none; outline: none; color: #e0e0e3; font-size: 13px; font-family: inherit;"
      />
    </div>
    <div
      id="palette-results"
      role="listbox"
      style="padding: 4px 0; max-height: 320px; overflow-y: auto;"
    >
      {#each filtered as cmd, i (cmd.id)}
        <div
          id="palette-item-{cmd.id}"
          role="option"
          aria-selected={i === selectedIndex}
          data-selected={i === selectedIndex}
          onclick={() => {
            commandStore.closePalette();
            commandStore.executeCommand(cmd.id);
          }}
          style="height: 28px; display: flex; align-items: center; padding: 0 14px; font-size: 13px; color: {i ===
          selectedIndex
            ? '#e0e0e3'
            : '#ababae'}; background: {i === selectedIndex
            ? 'rgba(255,255,255,0.04)'
            : 'transparent'}; justify-content: space-between; cursor: default;"
        >
          <span>{cmd.label}</span>
          {#if cmd.shortcut}
            <span
              style="font-size: 11px; color: #6b6d7b; font-family: ui-monospace, monospace;"
            >
              {formatShortcut(cmd.shortcut)}
            </span>
          {/if}
        </div>
      {/each}
      {#if filtered.length === 0}
        <div style="padding: 8px 14px; font-size: 13px; color: #6b6d7b;">
          No matching commands
        </div>
      {/if}
    </div>
  </div>
{/if}
