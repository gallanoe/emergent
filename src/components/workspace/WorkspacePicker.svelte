<script lang="ts">
  import { onMount } from "svelte";
  import { workspaceStore } from "../../stores/workspace.svelte";
  import { toastStore } from "../../stores/toast.svelte";
  import { commandStore } from "../../stores/commands.svelte";
  import { focusContextStore } from "../../stores/focus-context.svelte";
  import {
    openWorkspace,
    createWorkspace,
    deleteWorkspace,
  } from "../../lib/tauri";
  import type { WorkspaceMeta } from "../../lib/tauri";

  function relativeTime(iso: string): string {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 60) return diffMin <= 1 ? "just now" : `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}mo ago`;
  }

  let selectedIndex = $state(0);
  let creatingNew = $state(false);
  let newName = $state("");
  let inputEl: HTMLInputElement | undefined = $state();

  const sorted = $derived(
    [...workspaceStore.workspaces].sort(
      (a, b) =>
        new Date(b.last_opened).getTime() - new Date(a.last_opened).getTime(),
    ),
  );

  onMount(() => {
    focusContextStore.setActiveRegion("workspace-picker");

    commandStore.registerCommand({
      id: "workspace.create",
      label: "New Workspace",
      shortcut: "Mod+N",
      context: "workspace-picker" as const,
      execute: () => {
        creatingNew = true;
      },
    });

    return () => {
      commandStore.unregisterCommand("workspace.create");
    };
  });

  $effect(() => {
    if (creatingNew) {
      // Need a tick for the DOM to render before focusing
      setTimeout(() => inputEl?.focus(), 0);
    }
  });

  async function handleOpen(ws: WorkspaceMeta) {
    try {
      const meta = await openWorkspace(ws.id);
      workspaceStore.setActiveWorkspace(meta);
    } catch (err) {
      toastStore.addToast(
        `Failed to open workspace: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  }

  async function handleCreate(name: string) {
    try {
      const id = await createWorkspace(name);
      const meta = await openWorkspace(id);
      workspaceStore.setActiveWorkspace(meta);
    } catch (err) {
      toastStore.addToast(
        `Failed to create workspace: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  }

  function handleInputKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      creatingNew = false;
      newName = "";
    } else if (e.key === "Enter" && newName.trim()) {
      handleCreate(newName.trim());
    }
  }

  function handleWindowKeyDown(e: KeyboardEvent) {
    if (creatingNew) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (sorted.length > 0)
        selectedIndex = (selectedIndex + 1) % sorted.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (sorted.length > 0)
        selectedIndex = (selectedIndex - 1 + sorted.length) % sorted.length;
    } else if (e.key === "Enter") {
      if (sorted[selectedIndex]) handleOpen(sorted[selectedIndex]!);
    } else if (
      (e.key === "Delete" || e.key === "Backspace") &&
      sorted.length > 0
    ) {
      e.preventDefault();
      const ws = sorted[selectedIndex];
      if (ws) {
        deleteWorkspace(ws.id)
          .then(() => {
            const remaining = workspaceStore.workspaces.filter(
              (w) => w.id !== ws.id,
            );
            workspaceStore.setWorkspaces(remaining);
            selectedIndex =
              remaining.length === 0
                ? 0
                : Math.min(selectedIndex, remaining.length - 1);
            toastStore.addToast(`Deleted "${ws.name}"`, "info");
          })
          .catch((err) => {
            toastStore.addToast(
              `Failed to delete workspace: ${err instanceof Error ? err.message : String(err)}`,
              "error",
            );
          });
      }
    }
  }
</script>

<svelte:window onkeydown={handleWindowKeyDown} />

<div
  style="display: flex; align-items: center; justify-content: center; height: 100vh; width: 100%;"
>
  <div style="width: 320px; display: flex; flex-direction: column; gap: 12px;">
    <div>
      <div
        style="font-size: 18px; font-weight: 600; color: var(--color-fg-heading); font-family: var(--font-content);"
      >
        Open a workspace
      </div>
      <div
        style="font-size: 12px; color: var(--color-fg-muted); margin-top: 4px;"
      >
        Or create a new one to get started
      </div>
    </div>

    <div
      role="listbox"
      style="border: 1.5px solid var(--color-border-default); border-radius: 8px; overflow: hidden;"
    >
      {#if creatingNew}
        <input
          bind:this={inputEl}
          type="text"
          bind:value={newName}
          onkeydown={handleInputKeyDown}
          placeholder="Workspace name..."
          style="width: 100%; padding: 8px 12px; background: var(--color-bg-sidebar); border: none; border-bottom: 1px solid var(--color-border-default); color: var(--color-fg-heading); font-size: 13px; outline: none; box-sizing: border-box; font-family: var(--font-ui);"
        />
      {/if}
      {#if sorted.length === 0}
        <div
          style="padding: 8px 12px; font-size: 13px; color: var(--color-fg-muted);"
        >
          No workspaces yet
        </div>
      {:else}
        {#each sorted as ws, i (ws.id)}
          <div
            role="option"
            tabindex={-1}
            aria-selected={i === selectedIndex}
            onclick={() => {
              selectedIndex = i;
            }}
            onkeydown={(e) => {
              if (e.key === "Enter") handleOpen(ws);
            }}
            ondblclick={() => handleOpen(ws)}
            style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; cursor: default; border-bottom: {i <
            sorted.length - 1
              ? '1px solid var(--color-border-default)'
              : 'none'}; background: {i === selectedIndex
              ? 'var(--color-bg-hover)'
              : 'transparent'}; color: {i === selectedIndex
              ? 'var(--color-fg-heading)'
              : 'var(--color-fg-default)'}; min-height: 34px; border-radius: 6px;"
          >
            <span style="font-size: 13px;">{ws.name}</span>
            <span style="font-size: 11px; color: var(--color-fg-disabled);">
              {relativeTime(ws.last_opened)}
            </span>
          </div>
        {/each}
      {/if}
    </div>

    <div
      style="display: flex; align-items: center; justify-content: space-between;"
    >
      <button
        type="button"
        onclick={() => {
          creatingNew = true;
        }}
        style="font-size: 12px; color: var(--color-accent-text); background: none; border: none; padding: 0; cursor: pointer; font-family: inherit;"
      >
        New workspace
      </button>
      <div style="display: flex; gap: 12px;">
        <span
          style="color: var(--color-fg-disabled); font-size: 10px; font-family: var(--font-mono);"
        >
          <span
            style="background: var(--color-bg-hover); padding: 1px 4px; border-radius: 2px;"
          >
            {"\u2191\u2193"}
          </span>
          {" navigate"}
        </span>
        <span
          style="color: var(--color-fg-disabled); font-size: 10px; font-family: var(--font-mono);"
        >
          <span
            style="background: var(--color-bg-hover); padding: 1px 4px; border-radius: 2px;"
          >
            {"\u21B5"}
          </span>
          {" open"}
        </span>
        <span
          style="color: var(--color-fg-disabled); font-size: 10px; font-family: var(--font-mono);"
        >
          <span
            style="background: var(--color-bg-hover); padding: 1px 4px; border-radius: 2px;"
          >
            {"\u2318N"}
          </span>
          {" new"}
        </span>
      </div>
    </div>
  </div>
</div>
