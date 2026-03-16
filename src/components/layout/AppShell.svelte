<script lang="ts">
  import ActivityBar from "./ActivityBar.svelte";
  import WorkspaceView from "./WorkspaceView.svelte";
  import VcsView from "../vcs/VcsView.svelte";
  import Toast from "../shared/Toast.svelte";
  import CommandPalette from "../shared/CommandPalette.svelte";
  import { uiStore } from "../../stores/ui.svelte";
  import { commandStore } from "../../stores/commands.svelte";
  import { focusContextStore } from "../../stores/focus-context.svelte";
  import { editorStore } from "../../stores/editor.svelte";
  import { fileTreeStore } from "../../stores/file-tree.svelte";
  import { normalizeShortcut, resolveCommand } from "../../lib/keybindings";

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    )
      return true;
    if (target.isContentEditable) return true;
    return false;
  }

  function keybindingHandler(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    if (isEditableTarget(e.target)) return;
    const shortcut = normalizeShortcut(e);
    if (!shortcut) return;
    const activeRegion = focusContextStore.activeRegion;
    const commands = commandStore.commandList;
    const command = resolveCommand(shortcut, activeRegion, commands);
    if (command) {
      e.preventDefault();
      commandStore.executeCommand(command.id);
    }
  }

  function saveActiveEditor() {
    commandStore.executeCommand("document.save");
  }

  // Register global commands
  $effect(() => {
    const commands = [
      {
        id: "tab.close",
        label: "Close Tab",
        shortcut: "Mod+W",
        context: "global" as const,
        execute: () => {
          const tab = editorStore.activeTab;
          if (tab) editorStore.closeTab(tab);
        },
      },
      {
        id: "file.create",
        label: "New File",
        shortcut: "Mod+N",
        context: "global" as const,
        execute: () => {
          uiStore.setActiveView("workspace");
          fileTreeStore.setPendingCreation({ type: "file", parentPath: "" });
        },
      },
      {
        id: "folder.create",
        label: "New Folder",
        shortcut: "Mod+Shift+N",
        context: "global" as const,
        execute: () => {
          uiStore.setActiveView("workspace");
          fileTreeStore.setPendingCreation({ type: "folder", parentPath: "" });
        },
      },
      {
        id: "palette.open",
        label: "Command Palette",
        shortcut: "Mod+K",
        context: "global" as const,
        execute: () => commandStore.openPalette(),
      },
      {
        id: "focus.sidebar",
        label: "Focus Sidebar",
        shortcut: "Mod+1",
        context: "global" as const,
        execute: () => {
          focusContextStore.setActiveRegion("sidebar");
          document.querySelector<HTMLElement>("[role='tree']")?.focus();
        },
      },
      {
        id: "focus.editor",
        label: "Focus Editor",
        shortcut: "Mod+2",
        context: "global" as const,
        execute: () => {
          focusContextStore.setActiveRegion("editor");
          document
            .querySelector<HTMLElement>(".cm-editor .cm-content")
            ?.focus();
        },
      },
      {
        id: "view.vcs",
        label: "Toggle Source Control View",
        shortcut: "Mod+Shift+G",
        context: "global" as const,
        execute: () =>
          uiStore.setActiveView(
            uiStore.activeView === "vcs" ? "workspace" : "vcs",
          ),
      },
    ];

    for (const cmd of commands) {
      commandStore.registerCommand(cmd);
    }

    return () => {
      for (const cmd of commands) {
        commandStore.unregisterCommand(cmd.id);
      }
    };
  });
</script>

<svelte:document onkeydown={keybindingHandler} />

<div class="app-shell">
  <div class="main-layout">
    <ActivityBar />
    {#if uiStore.activeView === "workspace"}
      <WorkspaceView />
    {:else}
      <VcsView onsaveeditor={saveActiveEditor} />
    {/if}
  </div>
  <Toast />
  <CommandPalette />
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .main-layout {
    flex: 1;
    display: flex;
    overflow: hidden;
  }
</style>
