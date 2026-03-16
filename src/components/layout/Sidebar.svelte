<script lang="ts">
  import FileTree from "../file-tree/FileTree.svelte";
  import { workspaceStore } from "../../stores/workspace.svelte";
  import { GitBranch, Circle } from "@lucide/svelte";

  let shortOid = $derived(
    workspaceStore.headCommit?.oid.slice(0, 7) ?? ""
  );

  let behindAheadText = $derived.by(() => {
    if (workspaceStore.commitsBehind > 0) {
      return `${workspaceStore.commitsBehind} behind HEAD`;
    }
    if (workspaceStore.commitsAhead > 0) {
      return `${workspaceStore.commitsAhead} ahead`;
    }
    return "";
  });
</script>

<div class="sidebar" data-testid="sidebar">
  <div class="sidebar-header">
    <span class="section-label">Workspace</span>
  </div>

  <div class="tree-area">
    <FileTree />
  </div>

  <div class="sidebar-footer">
    {#if workspaceStore.isDetached}
      <Circle
        size={14}
        style="color: var(--color-fg-muted); flex-shrink: 0;"
      />
      <span class="branch-name">{shortOid}</span>
      {#if behindAheadText}
        <span class="behind-ahead">· {behindAheadText}</span>
      {/if}
    {:else}
      <GitBranch
        size={14}
        style="color: var(--color-fg-muted); flex-shrink: 0;"
      />
      <span class="branch-name">{workspaceStore.currentBranch}</span>
      {#if shortOid}
        <span class="commit-oid">· {shortOid}</span>
      {/if}
      {#if behindAheadText}
        <span class="behind-ahead">· {behindAheadText}</span>
      {/if}
    {/if}
  </div>
</div>

<style>
  .sidebar {
    width: 220px;
    height: 100%;
    background: var(--color-bg-base);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid var(--color-border-default);
  }

  .sidebar-header {
    padding: 6px 12px;
    background: var(--color-bg-sidebar);
  }

  .section-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-fg-muted);
    font-weight: 600;
  }

  .tree-area {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px;
  }

  .sidebar-footer {
    padding: 8px 12px;
    display: flex;
    align-items: center;
  }

  .branch-name {
    font-size: 12px;
    color: var(--color-fg-muted);
    margin-left: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .commit-oid {
    font-size: 11px;
    color: var(--color-fg-muted);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .behind-ahead {
    font-size: 11px;
    color: var(--color-fg-muted);
    white-space: nowrap;
  }
</style>
