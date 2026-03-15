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

  function statusColor(status: string): string {
    switch (status) {
      case "new":
        return "var(--color-info, #22d3ee)";
      case "modified":
        return "var(--color-success, #4ade80)";
      case "deleted":
        return "var(--color-error, #f87171)";
      default:
        return "var(--color-fg-muted)";
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
      <span class="status-badge" style="color: {statusColor(node.status ?? '')}"
        >{statusLabel(node.status ?? "")}</span
      >
      <span class="node-name">{node.name}</span>
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
  }

  .staging-header {
    padding: 6px 10px;
    background: var(--color-bg-elevated);
    border-bottom: 1px solid var(--color-border-default);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .section-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-fg-muted);
    font-weight: 600;
  }

  .change-count {
    font-size: 10px;
    color: var(--color-accent, #7c3aed);
  }

  .tree-content {
    flex: 1;
    overflow-y: auto;
  }

  .tree-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    cursor: pointer;
    font-size: 12px;
    color: var(--color-fg-default);
  }

  .tree-row:hover {
    background: var(--color-bg-elevated);
  }

  .tree-row.selected {
    background: var(--color-bg-selected, rgba(124, 58, 237, 0.15));
  }

  .stage-checkbox {
    accent-color: var(--color-accent, #7c3aed);
    cursor: pointer;
    flex-shrink: 0;
  }

  .folder-icon {
    font-size: 12px;
    flex-shrink: 0;
  }

  .status-badge {
    font-size: 10px;
    font-weight: 600;
    font-family: ui-monospace, monospace;
    width: 14px;
    text-align: center;
    flex-shrink: 0;
  }

  .node-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .folder-name {
    color: var(--color-accent, #7c3aed);
  }
</style>
