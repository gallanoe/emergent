<script lang="ts">
  import type { TreeNode } from "../../lib/tauri";
  import { fileTreeStore } from "../../stores/file-tree.svelte";
  import { editorStore } from "../../stores/editor.svelte";
  import {
    File,
    Folder,
    FolderOpen,
    ChevronRight,
    ChevronDown,
  } from "lucide-svelte";
  import RenameInput from "./RenameInput.svelte";
  import CreationInput from "./CreationInput.svelte";
  import FileTreeNode from "./FileTreeNode.svelte";

  const INDENT = 28;

  interface Props {
    node: TreeNode;
    depth: number;
    dragging: string | null;
    dropTarget: string | null;
    ondragstart: (node: TreeNode) => void;
    ondragover: (node: TreeNode) => void;
    ondragleave: () => void;
    ondrop: (sourcePath: string, targetNode: TreeNode) => void;
    oncontextmenu: (e: MouseEvent, node: TreeNode) => void;
    onselect: (path: string) => void;
    onrenamestart: (path: string) => void;
    renamingPath: string | null;
    onrenameconfirm: (newName: string) => void;
    onrenamecancel: () => void;
    creating: { parentPath: string; type: "file" | "folder" } | null;
    oncreateconfirm: (name: string) => void;
    oncreatecancel: () => void;
  }

  let {
    node,
    depth,
    dragging,
    dropTarget,
    ondragstart,
    ondragover,
    ondragleave,
    ondrop,
    oncontextmenu,
    onselect,
    onrenamestart,
    renamingPath,
    onrenameconfirm,
    onrenamecancel,
    creating,
    oncreateconfirm,
    oncreatecancel,
  }: Props = $props();

  let isExpanded = $derived(fileTreeStore.expandedPaths.has(node.path));
  let isSelected = $derived(fileTreeStore.selectedPath === node.path);
  let isFolder = $derived(node.kind === "folder");

  function handleClick() {
    if (isSelected) {
      // Already selected: do nothing on single click
      return;
    }
    // Not selected: select immediately and open/toggle
    onselect(node.path);
    if (isFolder) {
      fileTreeStore.toggleExpanded(node.path);
    } else {
      editorStore.openTab(node.path);
    }
  }

  function handleDoubleClick() {
    if (isSelected) {
      onrenamestart(node.path);
    } else {
      onselect(node.path);
      if (isFolder) {
        fileTreeStore.toggleExpanded(node.path);
      } else {
        editorStore.openTab(node.path);
      }
    }
  }
</script>

<div
  role="treeitem"
  tabindex={isSelected ? 0 : -1}
  aria-selected={isSelected}
  aria-expanded={isFolder ? isExpanded : undefined}
  draggable="true"
  ondragstart={(e) => {
    if (e.dataTransfer) {
      e.dataTransfer.setData("text/plain", node.path);
      e.dataTransfer.effectAllowed = "move";
    }
    ondragstart(node);
  }}
  ondragend={() => {
    ondragleave();
  }}
  ondragover={(e) => {
    if (node.kind === "folder") {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      ondragover(node);
    }
  }}
  ondragleave={(e) => {
    e.stopPropagation();
    ondragleave();
  }}
  ondrop={(e) => {
    e.preventDefault();
    e.stopPropagation();
    const sourcePath = e.dataTransfer?.getData("text/plain") ?? "";
    ondrop(sourcePath, node);
  }}
  onclick={handleClick}
  ondblclick={handleDoubleClick}
  onkeydown={(e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleClick();
    } else if (e.key === "F2") {
      e.preventDefault();
      onrenamestart(node.path);
    }
  }}
  oncontextmenu={(e) => oncontextmenu(e, node)}
  class="tree-item"
  class:selected={isSelected}
  class:drop-target={dropTarget === node.path && node.kind === "folder"}
  class:dragging={dragging === node.path}
  style="padding-left: {depth * INDENT + 8}px;"
  onmouseenter={(e) => {
    if (!isSelected && dropTarget !== node.path) {
      e.currentTarget.style.background = "var(--color-bg-hover)";
    }
  }}
  onmouseleave={(e) => {
    if (!isSelected && dropTarget !== node.path) {
      e.currentTarget.style.background = "transparent";
    }
  }}
>
  {#if isFolder}
    <span class="chevron-icon">
      {#if isExpanded}
        <ChevronDown size={14} />
      {:else}
        <ChevronRight size={14} />
      {/if}
    </span>
  {/if}
  <span class="node-icon" class:selected-icon={isSelected}>
    {#if isFolder}
      {#if isExpanded}
        <FolderOpen size={14} />
      {:else}
        <Folder size={14} />
      {/if}
    {:else}
      <File size={14} />
    {/if}
  </span>
  {#if renamingPath === node.path}
    <RenameInput
      defaultValue={node.name}
      isFile={node.kind === "file"}
      onconfirm={onrenameconfirm}
      oncancel={onrenamecancel}
    />
  {:else}
    <span class="truncate node-name">{node.name}</span>
  {/if}
</div>
{#if isFolder && isExpanded && node.children}
  {#if creating?.parentPath === node.path}
    <CreationInput
      kind={creating.type}
      depth={depth + 1}
      onconfirm={oncreateconfirm}
      oncancel={oncreatecancel}
    />
  {/if}
  {#each node.children as child (child.path)}
    <FileTreeNode
      node={child}
      depth={depth + 1}
      {dragging}
      {dropTarget}
      {ondragstart}
      {ondragover}
      {ondragleave}
      {ondrop}
      {oncontextmenu}
      {onselect}
      {onrenamestart}
      {renamingPath}
      {onrenameconfirm}
      {onrenamecancel}
      {creating}
      {oncreateconfirm}
      {oncreatecancel}
    />
  {/each}
{/if}

<style>
  .tree-item {
    display: flex;
    align-items: center;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--color-fg-default);
    background: transparent;
    transition: background 100ms ease-out;
    cursor: default;
    user-select: none;
  }

  .tree-item.selected {
    background: var(--color-accent-soft);
    color: var(--color-fg-heading);
    font-weight: 500;
  }

  .tree-item.drop-target {
    background: var(--color-bg-selected);
  }

  .tree-item.dragging {
    opacity: 0.5;
  }

  .chevron-icon {
    display: inline-flex;
    align-items: center;
    color: var(--color-fg-disabled);
    margin-right: 2px;
    flex-shrink: 0;
  }

  .node-icon {
    display: inline-flex;
    align-items: center;
    color: var(--color-fg-disabled);
    margin-right: 6px;
    flex-shrink: 0;
  }

  .node-icon.selected-icon {
    color: var(--color-accent);
  }

  .node-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
