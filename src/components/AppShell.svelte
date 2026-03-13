<script lang="ts">
  import Sidebar from "./Sidebar.svelte";
  import TabBar from "./TabBar.svelte";
  import StatusBar from "./StatusBar.svelte";
  import Toast from "./Toast.svelte";
  import Editor from "./Editor.svelte";
  import CommandPalette from "./CommandPalette.svelte";
  import { editorStore } from "../stores/editor.svelte";
  import { fileTreeStore } from "../stores/file-tree.svelte";
  import { uiStore } from "../stores/ui.svelte";
  import { commandStore } from "../stores/commands.svelte";
  import { focusContextStore } from "../stores/focus-context.svelte";
  import { toastStore } from "../stores/toast.svelte";
  import {
    listTree,
    readDocument,
    writeDocument,
    onTreeChanged,
    onDocumentChanged,
  } from "../lib/tauri";
  import { sortTree } from "../lib/sort-tree";
  import { normalizeShortcut, resolveCommand } from "../lib/keybindings";

  let sidebarWidth = $state(220);
  let editorContent = $state("");

  function keybindingHandler(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
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

  function handleSave(content: string) {
    const tab = editorStore.activeTab;
    if (tab) {
      writeDocument(tab, content);
    }
  }

  function loadTree() {
    listTree()
      .then((tree) => {
        fileTreeStore.setTree(sortTree(tree));
        fileTreeStore.setLoading(false);
      })
      .catch((err) => {
        fileTreeStore.setLoading(false);
        toastStore.addToast(
          `Failed to load files: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      });
  }

  // Load editor content when active tab changes
  $effect(() => {
    const tab = editorStore.activeTab;
    if (tab) {
      readDocument(tab)
        .then((c) => { editorContent = c; })
        .catch(() => { editorContent = ""; });
    }
  });

  // Load tree on mount + subscribe to Tauri events
  $effect(() => {
    fileTreeStore.setLoading(true);
    loadTree();

    let unlistenTree: (() => void) | null = null;
    let unlistenDoc: (() => void) | null = null;

    onTreeChanged(() => loadTree()).then((fn) => { unlistenTree = fn; });

    onDocumentChanged(({ path }) => {
      if (editorStore.activeTab === path) {
        readDocument(path)
          .then((c) => { editorContent = c; })
          .catch(() => {});
      }
    }).then((fn) => { unlistenDoc = fn; });

    return () => {
      unlistenTree?.();
      unlistenDoc?.();
    };
  });

  // Register global commands
  $effect(() => {
    const commands = [
      {
        id: "sidebar.toggle",
        label: "Toggle Sidebar",
        shortcut: "Mod+B",
        context: "global" as const,
        execute: () => uiStore.toggleSidebar(),
      },
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
          uiStore.setSidebarCollapsed(false);
          fileTreeStore.setPendingCreation({ type: "file", parentPath: "" });
        },
      },
      {
        id: "folder.create",
        label: "New Folder",
        shortcut: "Mod+Shift+N",
        context: "global" as const,
        execute: () => {
          uiStore.setSidebarCollapsed(false);
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
          document.querySelector<HTMLElement>(".cm-editor .cm-content")?.focus();
        },
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

<div class="flex h-screen flex-col">
  <div class="flex flex-1 overflow-hidden">
    {#if !uiStore.sidebarCollapsed}
      <Sidebar width={sidebarWidth} onwidthchange={(w) => { sidebarWidth = w; }} />
    {/if}
    <div class="flex flex-1 flex-col overflow-hidden">
      <TabBar />
      <div class="flex-1 overflow-auto p-6">
        {#if editorStore.activeTab}
          <Editor content={editorContent} path={editorStore.activeTab} onsave={handleSave} />
        {:else if fileTreeStore.tree.length === 0 && !fileTreeStore.loading}
          <div
            style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 4px;"
          >
            <span
              style="font-size: 16px; font-weight: 600; color: var(--color-fg-heading);"
            >
              Create your first document
            </span>
            <span style="font-size: 12px; color: var(--color-fg-muted);">
              {"Press \u2318N to get started"}
            </span>
          </div>
        {:else}
          <p style="color: var(--color-fg-muted);">No document open</p>
        {/if}
      </div>
    </div>
  </div>
  <StatusBar />
  <Toast />
  <CommandPalette />
</div>
