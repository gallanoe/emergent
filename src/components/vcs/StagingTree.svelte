<script lang="ts">
  import { vcsStore } from "../../stores/vcs.svelte";
  import { vcsStage, vcsUnstage, vcsGetStatus } from "../../lib/tauri";
  import { toastStore } from "../../stores/toast.svelte";

  type TreeNode = {
    name: string;
    path: string;
    kind: "file" | "folder";
    status?: string;
    children?: TreeNode[];
  };

  let tree = $derived.by(() => buildTree(vcsStore.changedFiles));

  function buildTree(
    files: { path: string; status: string; staged: boolean }[],
  ): TreeNode[] {
    const root: TreeNode[] = [];

    // Deduplicate paths (a file can appear as both staged and unstaged)
    const uniquePaths = new Map<string, string>();
    for (const f of files) {
      if (!uniquePaths.has(f.path)) {
        uniquePaths.set(f.path, f.status);
      }
    }

    for (const [filePath, status] of uniquePaths) {
      const parts = filePath.split("/");
      let current = root;
      const accum: string[] = [];

      for (const part of parts) {
        accum.push(part);
        const isFile = accum.length === parts.length;
        const fullPath = accum.join("/");

        let existing = current.find((n) => n.name === part);
        if (!existing) {
          existing = isFile
            ? { name: part, path: fullPath, kind: "file" as const, status }
            : {
                name: part,
                path: fullPath,
                kind: "folder" as const,
                children: [],
              };
          current.push(existing);
        }
        if (!isFile && existing.children) {
          current = existing.children;
        }
      }
    }

    return sortTree(root);
  }

  function sortTree(nodes: TreeNode[]): TreeNode[] {
    return nodes
      .map((n): TreeNode => {
        if (n.kind === "file") return n;
        return { ...n, kind: "folder", children: sortTree(n.children ?? []) };
      })
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  function getDescendantFiles(node: TreeNode): string[] {
    if (node.kind === "file") return [node.path];
    return (node.children ?? []).flatMap(getDescendantFiles);
  }

  function getCheckState(
    node: TreeNode,
  ): "checked" | "unchecked" | "indeterminate" {
    const files = getDescendantFiles(node);
    const stagedCount = files.filter((f) => vcsStore.stagedPaths.has(f)).length;
    if (stagedCount === 0) return "unchecked";
    if (stagedCount === files.length) return "checked";
    return "indeterminate";
  }

  async function toggleNode(node: TreeNode) {
    const files = getDescendantFiles(node);
    const state = getCheckState(node);

    try {
      if (state === "checked") {
        await vcsUnstage(files);
        for (const f of files) vcsStore.stagedPaths.delete(f);
      } else {
        await vcsStage(files);
        for (const f of files) vcsStore.stagedPaths.add(f);
      }
    } catch (err) {
      toastStore.addToast(
        `Failed to update staging: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
      // Re-fetch status to ensure UI reflects actual state
      vcsGetStatus()
        .then((files) => {
          vcsStore.setChangedFiles(files);
          vcsStore.setStagedPaths(
            new Set(files.filter((f) => f.staged).map((f) => f.path)),
          );
        })
        .catch(() => {});
    }
  }

  function selectFile(path: string) {
    vcsStore.setSelectedFile(path);
  }

  function statusLabel(status: string): string {
    switch (status) {
      case "new":
        return "A";
      case "modified":
        return "M";
      case "deleted":
        return "D";
      default:
        return "?";
    }
  }

  function statusClass(status: string): string {
    switch (status) {
      case "new":
        return "status-added";
      case "modified":
        return "status-modified";
      case "deleted":
        return "status-deleted";
      default:
        return "";
    }
  }
</script>

{#snippet treeNode(node: TreeNode, depth: number)}
  {@const checkState = getCheckState(node)}
  <div
    class="tree-row"
    class:selected={vcsStore.selectedFile === node.path && node.kind === "file"}
    style="padding-left: {8 + depth * 16}px;"
    onclick={() => node.kind === "file" && selectFile(node.path)}
    onkeydown={(e) =>
      e.key === "Enter" && node.kind === "file" && selectFile(node.path)}
    role="treeitem"
    tabindex={0}
    aria-selected={vcsStore.selectedFile === node.path && node.kind === "file"}
  >
    <input
      type="checkbox"
      checked={checkState === "checked"}
      indeterminate={checkState === "indeterminate"}
      aria-checked={checkState === "indeterminate"
        ? "mixed"
        : checkState === "checked"}
      onclick={(e) => {
        e.stopPropagation();
        toggleNode(node);
      }}
      class="stage-checkbox"
    />
    {#if node.kind === "folder"}
      <span class="folder-icon">📁</span>
      <span class="node-name folder-name">{node.name}/</span>
    {:else}
      <span class="status-badge {statusClass(node.status ?? '')}"
        >{statusLabel(node.status ?? "")}</span
      >
      <span class="node-name" class:deleted-file={node.status === "deleted"}
        >{node.name}</span
      >
    {/if}
  </div>
  {#if node.children}
    {#each node.children as child}
      {@render treeNode(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

<div class="staging-tree" role="tree" aria-label="Changed files">
  <div class="staging-header">
    <span class="section-label">Changes</span>
    <span class="change-count">{vcsStore.changedFiles.length} files</span>
  </div>
  <div class="tree-content">
    {#each tree as node}
      {@render treeNode(node, 0)}
    {/each}
  </div>
</div>

<style>
  .staging-tree {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex: 1;
  }

  .staging-header {
    padding: 6px 10px;
    background: var(--color-bg-sidebar);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .section-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-fg-muted);
    font-weight: 600;
  }

  .change-count {
    font-size: 10px;
    color: var(--color-accent);
    background: var(--color-accent-soft);
    border-radius: 10px;
    padding: 1px 7px;
  }

  .tree-content {
    flex: 1;
    overflow-y: auto;
    padding: 2px 0;
  }

  .tree-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    cursor: pointer;
    font-size: 12px;
    color: var(--color-fg-default);
    border-radius: 4px;
    margin: 0 4px;
    transition: background-color 150ms ease;
  }

  .tree-row:hover {
    background: var(--color-bg-hover);
  }

  .tree-row.selected {
    background: var(--color-bg-selected);
  }

  .stage-checkbox {
    appearance: none;
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1.5px solid var(--color-fg-disabled);
    background: transparent;
    cursor: pointer;
    flex-shrink: 0;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 150ms ease, border-color 150ms ease;
  }

  .stage-checkbox:checked {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }

  .stage-checkbox:checked::after {
    content: "";
    display: block;
    width: 4px;
    height: 8px;
    border: solid white;
    border-width: 0 1.5px 1.5px 0;
    transform: rotate(45deg);
    margin-top: -1px;
  }

  .stage-checkbox:indeterminate {
    border-color: var(--color-fg-muted);
  }

  .stage-checkbox:indeterminate::after {
    content: "";
    display: block;
    width: 8px;
    height: 1.5px;
    background: var(--color-fg-muted);
  }

  .folder-icon {
    font-size: 12px;
    flex-shrink: 0;
  }

  .status-badge {
    font-size: 10px;
    font-weight: 600;
    font-family: var(--font-mono);
    padding: 0 4px;
    border-radius: 4px;
    text-align: center;
    flex-shrink: 0;
    line-height: 1.6;
  }

  .status-badge.status-added {
    color: var(--color-success);
    background: rgba(45, 140, 80, 0.1);
  }

  .status-badge.status-modified {
    color: var(--color-accent);
    background: var(--color-accent-soft);
  }

  .status-badge.status-deleted {
    color: var(--color-error);
    background: rgba(200, 60, 60, 0.1);
  }

  .node-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .node-name.deleted-file {
    text-decoration: line-through;
    text-decoration-color: var(--color-fg-disabled);
  }

  .folder-name {
    color: var(--color-accent);
  }
</style>
