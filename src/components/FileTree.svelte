<script lang="ts">
  import type { TreeNode } from "../lib/tauri";
  import {
    moveDocument,
    moveFolder,
    createDocument,
    createFolder,
    readDocument,
    deleteDocument,
    deleteFolder,
    writeDocument,
  } from "../lib/tauri";
  import { sortTree } from "../lib/sort-tree";
  import {
    findNode,
    removeNodeFromTree,
    insertNodeInTree,
    renameNodeInTree,
    countFilesInSubtree,
    stashFolderContents,
  } from "../lib/file-tree-helpers";
  import { fileTreeStore } from "../stores/file-tree.svelte";
  import { editorStore } from "../stores/editor.svelte";
  import { commandStore } from "../stores/commands.svelte";
  import { focusContextStore } from "../stores/focus-context.svelte";
  import { toastStore } from "../stores/toast.svelte";
  import ContextMenu, { type MenuItem } from "./ContextMenu.svelte";
  import CreationInput from "./CreationInput.svelte";
  import FileTreeNode from "./FileTreeNode.svelte";

  let treeEl: HTMLDivElement | undefined = $state();
  let dragging: string | null = $state(null);
  let dropTarget: string | null = $state(null);
  let contextMenu: { x: number; y: number; target: TreeNode | null } | null = $state(null);

  function getMenuItems(target: TreeNode | null): MenuItem[] {
    if (target === null) {
      return [
        { label: "New File", action: "new-file" },
        { label: "New Folder", action: "new-folder" },
      ];
    }
    if (target.kind === "folder") {
      return [
        { label: "New File", action: "new-file" },
        { label: "New Folder", action: "new-folder" },
        { type: "separator" },
        { label: "Rename", action: "rename" },
        { label: "Delete", action: "delete" },
      ];
    }
    return [
      { label: "Rename", action: "rename" },
      { label: "Delete", action: "delete" },
    ];
  }

  function handleContextMenu(e: MouseEvent, target: TreeNode | null) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { x: e.clientX, y: e.clientY, target };
  }

  async function handleDrop(sourcePath: string, targetNode: TreeNode | null) {
    dragging = null;
    dropTarget = null;

    const currentTree = fileTreeStore.tree;
    const sourceNode = findNode(currentTree, sourcePath);
    if (!sourceNode) return;

    const targetPath = targetNode?.path ?? "";
    if (sourcePath === targetPath) return;

    const sourceParent = sourcePath.includes("/")
      ? sourcePath.substring(0, sourcePath.lastIndexOf("/"))
      : "";
    if (sourceParent === targetPath) return;

    if (targetPath.startsWith(sourcePath + "/")) return;

    const newPath = targetPath ? `${targetPath}/${sourceNode.name}` : sourceNode.name;

    const snapshot = fileTreeStore.snapshotTree();

    // Optimistic move
    const treeWithout = removeNodeFromTree(currentTree, sourcePath);
    const movedNode: TreeNode = {
      name: sourceNode.name,
      path: newPath,
      kind: sourceNode.kind,
    };
    if (sourceNode.children) movedNode.children = sourceNode.children;
    const treeWith = insertNodeInTree(treeWithout, targetPath, movedNode);
    fileTreeStore.setTree(sortTree(treeWith));
    editorStore.updateTabPath(sourcePath, newPath);

    try {
      const moveFn = sourceNode.kind === "folder" ? moveFolder : moveDocument;
      await moveFn(sourcePath, newPath);
    } catch (err) {
      fileTreeStore.rollbackTree(snapshot);
      toastStore.addToast(
        `Move failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  }

  async function handleDelete(node: TreeNode) {
    // Size guard: folders with >50 files get a confirmation toast
    if (node.kind === "folder") {
      const fileCount = countFilesInSubtree(node);
      if (fileCount > 50) {
        toastStore.addToast(
          `Delete ${node.name} (${fileCount} files)?`,
          "info",
          {
            label: "Confirm",
            onClick: async () => {
              const snapshot = fileTreeStore.snapshotTree();
              fileTreeStore.setTree(removeNodeFromTree(fileTreeStore.tree, node.path));
              for (const tab of editorStore.openTabs) {
                if (tab.path === node.path || tab.path.startsWith(node.path + "/")) {
                  editorStore.closeTab(tab.path);
                }
              }
              try {
                await deleteFolder(node.path);
              } catch (err) {
                fileTreeStore.rollbackTree(snapshot);
                toastStore.addToast(
                  `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
                  "error",
                );
              }
            },
          },
          5000,
        );
        return;
      }
    }

    // Stash content for undo
    try {
      let stash: Map<string, string>;
      if (node.kind === "file") {
        const content = await readDocument(node.path);
        stash = new Map([[node.path, content]]);
      } else {
        stash = await stashFolderContents(node, readDocument);
      }

      const snapshot = fileTreeStore.snapshotTree();

      // Optimistic removal
      fileTreeStore.setTree(removeNodeFromTree(fileTreeStore.tree, node.path));

      // Close affected tabs
      for (const tab of editorStore.openTabs) {
        if (tab.path === node.path || tab.path.startsWith(node.path + "/")) {
          editorStore.closeTab(tab.path);
        }
      }

      // Call backend
      try {
        if (node.kind === "file") {
          await deleteDocument(node.path);
        } else {
          await deleteFolder(node.path);
        }
      } catch (err) {
        fileTreeStore.rollbackTree(snapshot);
        toastStore.addToast(
          `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
        return;
      }

      // Show undo toast
      toastStore.addToast(
        `Deleted ${node.name}`,
        "info",
        {
          label: "Undo",
          onClick: async () => {
            try {
              if (node.kind === "file") {
                await createDocument(node.path);
                const content = stash.get(node.path) ?? "";
                await writeDocument(node.path, content);
              } else {
                await createFolder(node.path);
                for (const [path, content] of stash) {
                  await createDocument(path);
                  await writeDocument(path, content);
                }
              }
            } catch (err) {
              toastStore.addToast(
                `Undo failed: ${err instanceof Error ? err.message : String(err)}`,
                "error",
              );
            }
          },
        },
        5000,
      );
    } catch (err) {
      toastStore.addToast(
        `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  }

  function handleContextAction(action: string) {
    const target = contextMenu?.target ?? null;
    contextMenu = null;
    switch (action) {
      case "rename": {
        if (target) fileTreeStore.setPendingRename(target.path);
        break;
      }
      case "new-file": {
        const parentPath = target?.kind === "folder" ? target.path : "";
        if (target?.kind === "folder" && !fileTreeStore.expandedPaths.has(target.path)) {
          fileTreeStore.toggleExpanded(target.path);
        }
        fileTreeStore.setPendingCreation({ type: "file", parentPath });
        break;
      }
      case "new-folder": {
        const parentPath = target?.kind === "folder" ? target.path : "";
        if (target?.kind === "folder" && !fileTreeStore.expandedPaths.has(target.path)) {
          fileTreeStore.toggleExpanded(target.path);
        }
        fileTreeStore.setPendingCreation({ type: "folder", parentPath });
        break;
      }
      case "delete": {
        if (target) handleDelete(target);
        break;
      }
    }
  }

  async function handleRenameConfirm(newName: string) {
    const rPath = fileTreeStore.pendingRename;
    if (!rPath) return;
    const tree = fileTreeStore.tree;
    const node = findNode(tree, rPath);
    if (!node || !newName.trim() || newName === node.name) {
      fileTreeStore.clearPendingRename();
      return;
    }
    const parentPath = rPath.includes("/")
      ? rPath.substring(0, rPath.lastIndexOf("/"))
      : "";
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;
    const snapshot = fileTreeStore.snapshotTree();

    // Optimistic update
    fileTreeStore.setTree(renameNodeInTree(tree, rPath, newName, newPath));
    editorStore.updateTabPath(rPath, newPath);
    fileTreeStore.clearPendingRename();

    try {
      const moveFn = node.kind === "folder" ? moveFolder : moveDocument;
      await moveFn(rPath, newPath);
    } catch (err) {
      fileTreeStore.rollbackTree(snapshot);
      toastStore.addToast(
        `Rename failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  }

  function handleRenameCancel() {
    fileTreeStore.clearPendingRename();
  }

  async function handleCreateConfirm(name: string) {
    const pending = fileTreeStore.pendingCreation;
    if (!pending) return;
    const fullPath = pending.parentPath ? `${pending.parentPath}/${name}` : name;
    fileTreeStore.clearPendingCreation();

    try {
      if (pending.type === "file") {
        await createDocument(fullPath);
        editorStore.openTab(fullPath);
      } else {
        await createFolder(fullPath);
      }
    } catch (err) {
      toastStore.addToast(
        `Failed to create: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  }

  function handleSelect(path: string) {
    fileTreeStore.setSelected(path);
  }

  function flattenVisible(nodes: TreeNode[]): TreeNode[] {
    const result: TreeNode[] = [];
    for (const node of nodes) {
      result.push(node);
      if (node.kind === "folder" && fileTreeStore.expandedPaths.has(node.path) && node.children) {
        result.push(...flattenVisible(node.children));
      }
    }
    return result;
  }

  function handleKeyDown(e: KeyboardEvent) {
    const tree = fileTreeStore.tree;
    const selectedPath = fileTreeStore.selectedPath;
    const flat = flattenVisible(tree);
    const idx = flat.findIndex((n) => n.path === selectedPath);

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (idx < flat.length - 1) fileTreeStore.setSelected(flat[idx + 1]!.path);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (idx > 0) fileTreeStore.setSelected(flat[idx - 1]!.path);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (idx >= 0 && flat[idx]!.kind === "folder") {
          if (!fileTreeStore.expandedPaths.has(flat[idx]!.path)) {
            fileTreeStore.toggleExpanded(flat[idx]!.path);
          } else if (flat[idx + 1]) {
            fileTreeStore.setSelected(flat[idx + 1]!.path);
          }
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (idx >= 0) {
          const node = flat[idx]!;
          if (node.kind === "folder" && fileTreeStore.expandedPaths.has(node.path)) {
            fileTreeStore.toggleExpanded(node.path);
          } else {
            const parentPath = node.path.includes("/")
              ? node.path.substring(0, node.path.lastIndexOf("/"))
              : null;
            if (parentPath) fileTreeStore.setSelected(parentPath);
          }
        }
        break;
      case "Home":
        e.preventDefault();
        if (flat.length > 0) fileTreeStore.setSelected(flat[0]!.path);
        break;
      case "End":
        e.preventDefault();
        if (flat.length > 0) fileTreeStore.setSelected(flat[flat.length - 1]!.path);
        break;
      case "Enter":
        e.preventDefault();
        if (idx >= 0) {
          const node = flat[idx]!;
          if (node.kind === "folder") {
            fileTreeStore.toggleExpanded(node.path);
          } else {
            editorStore.openTab(node.path);
          }
        }
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
          const char = e.key.toLowerCase();
          const startIdx = idx >= 0 ? idx + 1 : 0;
          const match =
            flat.slice(startIdx).find((n) => n.name.toLowerCase().startsWith(char)) ??
            flat.slice(0, startIdx).find((n) => n.name.toLowerCase().startsWith(char));
          if (match) fileTreeStore.setSelected(match.path);
        }
        break;
    }
  }

  // Register sidebar commands
  $effect(() => {
    const executeDeleteSelected = () => {
      const selected = fileTreeStore.selectedPath;
      if (selected) {
        const node = findNode(fileTreeStore.tree, selected);
        if (node) handleDelete(node);
      }
    };

    const commands = [
      {
        id: "file.rename",
        label: "Rename",
        shortcut: "F2",
        context: "sidebar" as const,
        execute: () => {
          const selected = fileTreeStore.selectedPath;
          if (selected) {
            fileTreeStore.setPendingRename(selected);
          }
        },
      },
      {
        id: "file.delete",
        label: "Delete",
        shortcut: "Delete",
        context: "sidebar" as const,
        execute: executeDeleteSelected,
      },
      {
        id: "file.delete-backspace",
        label: "Delete",
        shortcut: "Backspace",
        context: "sidebar" as const,
        execute: executeDeleteSelected,
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

{#if fileTreeStore.tree.length === 0 && !fileTreeStore.pendingCreation}
  <div class="px-3 py-4" style="font-size: 11px; color: var(--color-fg-disabled);">
    No files yet
  </div>
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={treeEl}
    role="tree"
    tabindex={0}
    onkeydown={handleKeyDown}
    oncontextmenu={(e) => handleContextMenu(e, null)}
    onfocus={() => focusContextStore.setActiveRegion("sidebar")}
    ondragover={(e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      dropTarget = "__root__";
    }}
    ondragleave={() => { dropTarget = null; }}
    ondrop={(e) => {
      e.preventDefault();
      const sourcePath = e.dataTransfer?.getData("text/plain") ?? "";
      handleDrop(sourcePath, null);
    }}
    style="outline: none; background: {dropTarget === '__root__' ? 'var(--color-bg-selected)' : 'transparent'};"
  >
    {#if fileTreeStore.pendingCreation && fileTreeStore.pendingCreation.parentPath === ""}
      <CreationInput
        kind={fileTreeStore.pendingCreation.type}
        depth={0}
        onconfirm={handleCreateConfirm}
        oncancel={() => fileTreeStore.clearPendingCreation()}
      />
    {/if}
    {#each fileTreeStore.tree as node (node.path)}
      <FileTreeNode
        {node}
        depth={0}
        oncontextmenu={handleContextMenu}
        renamingPath={fileTreeStore.pendingRename}
        onrenameconfirm={handleRenameConfirm}
        onrenamecancel={handleRenameCancel}
        onrenamestart={(path) => fileTreeStore.setPendingRename(path)}
        onselect={handleSelect}
        creating={fileTreeStore.pendingCreation}
        oncreateconfirm={handleCreateConfirm}
        oncreatecancel={() => fileTreeStore.clearPendingCreation()}
        {dragging}
        {dropTarget}
        ondragstart={(n) => { dragging = n.path; }}
        ondragover={(n) => { dropTarget = n.path; }}
        ondragleave={() => { dropTarget = null; }}
        ondrop={(sourcePath, targetNode) => handleDrop(sourcePath, targetNode)}
      />
    {/each}
    {#if contextMenu}
      <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        items={getMenuItems(contextMenu.target)}
        onaction={handleContextAction}
        onclose={() => { contextMenu = null; }}
      />
    {/if}
  </div>
{/if}
