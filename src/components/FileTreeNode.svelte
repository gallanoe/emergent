<script lang="ts">
  import type { TreeNode } from "../lib/tauri";
  import { fileTreeStore } from "../stores/file-tree.svelte";
  import { editorStore } from "../stores/editor.svelte";
  import RenameInput from "./RenameInput.svelte";
  import CreationInput from "./CreationInput.svelte";

  const INDENT = 16;
  const ITEM_HEIGHT = 28;

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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
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
  oncontextmenu={(e) => oncontextmenu(e, node)}
  class="interactive flex items-center px-2"
  style="height: {ITEM_HEIGHT}px; padding-left: {depth * INDENT +
    8}px; font-size: 13px; opacity: {dragging === node.path
    ? 0.5
    : 1}; color: {isSelected
    ? 'var(--color-fg-heading)'
    : 'var(--color-fg-default)'}; background: {dropTarget === node.path &&
  node.kind === 'folder'
    ? 'var(--color-bg-selected)'
    : isSelected
      ? 'var(--color-bg-hover)'
      : 'transparent'}; border-left: {isSelected
    ? '2px solid var(--color-accent)'
    : '2px solid transparent'}; transition: background 100ms ease-out;"
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
    <span
      style="font-size: 10px; color: var(--color-fg-muted); margin-right: 6px; display: inline-block; transform: {isExpanded
        ? 'rotate(90deg)'
        : 'rotate(0deg)'}; transition: transform 100ms ease-out;"
    >
      &#9654;
    </span>
  {/if}
  {#if renamingPath === node.path}
    <RenameInput
      defaultValue={node.name}
      isFile={node.kind === "file"}
      onconfirm={onrenameconfirm}
      oncancel={onrenamecancel}
    />
  {:else}
    <span class="truncate">{node.name}</span>
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
    <svelte:self
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
