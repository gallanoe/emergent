<script lang="ts">
  import Sidebar from "./Sidebar.svelte";
  import TabBar from "../editor/TabBar.svelte";
  import Editor from "../editor/Editor.svelte";
  import { editorStore } from "../../stores/editor.svelte";
  import { fileTreeStore } from "../../stores/file-tree.svelte";
  import { uiStore } from "../../stores/ui.svelte";
  import { toastStore } from "../../stores/toast.svelte";
  import {
    listTree,
    readDocument,
    writeDocument,
    onTreeChanged,
    onDocumentChanged,
  } from "../../lib/tauri";
  import { sortTree } from "../../lib/sort-tree";

  let editorContent = $state("");

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
        .then((c) => {
          editorContent = c;
        })
        .catch(() => {
          editorContent = "";
        });
    }
  });

  // Load tree on mount + subscribe to Tauri events
  $effect(() => {
    fileTreeStore.setLoading(true);
    loadTree();

    let unlistenTree: (() => void) | null = null;
    let unlistenDoc: (() => void) | null = null;

    onTreeChanged(() => loadTree()).then((fn) => {
      unlistenTree = fn;
    });

    onDocumentChanged(({ path }) => {
      if (editorStore.activeTab === path) {
        readDocument(path)
          .then((c) => {
            editorContent = c;
          })
          .catch(() => {});
      }
    }).then((fn) => {
      unlistenDoc = fn;
    });

    return () => {
      unlistenTree?.();
      unlistenDoc?.();
    };
  });
</script>

<div class="workspace-view">
  <div class="sidebar-container" class:hidden={uiStore.sidebarCollapsed}>
    <Sidebar />
  </div>
  <div class="editor-area">
    <TabBar />
    <div class="editor-content">
      {#if editorStore.activeTab}
        <Editor
          content={editorContent}
          path={editorStore.activeTab}
          onsave={handleSave}
        />
      {:else if fileTreeStore.tree.length === 0 && !fileTreeStore.loading}
        <div class="empty-state">
          <span class="empty-title">Create your first document</span>
          <span class="empty-subtitle">{"Press \u2318N to get started"}</span>
        </div>
      {:else}
        <p class="no-doc">No document open</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .workspace-view {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .editor-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-container.hidden {
    display: none;
  }

  .editor-content {
    flex: 1;
    overflow: auto;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 4px;
  }

  .empty-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--color-fg-heading);
  }

  .empty-subtitle {
    font-size: 12px;
    color: var(--color-fg-muted);
  }

  .no-doc {
    color: var(--color-fg-muted);
  }
</style>
