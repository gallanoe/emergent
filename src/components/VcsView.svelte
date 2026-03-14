<script lang="ts">
  import CommitHistory from "./CommitHistory.svelte";
  import StagingTree from "./StagingTree.svelte";
  import DiffViewer from "./DiffViewer.svelte";
  import CommitBar from "./CommitBar.svelte";
  import { vcsStore } from "../stores/vcs.svelte";
  import { vcsGetStatus, onVcsStatusChanged } from "../lib/tauri";
  import { toastStore } from "../stores/toast.svelte";

  let historyRef: ReturnType<typeof CommitHistory> | undefined = $state();
  let diffRefreshKey = $state(0);
  let statusError = $state(false);

  function refreshStatus() {
    statusError = false;
    vcsGetStatus()
      .then((files) => {
        vcsStore.setChangedFiles(files);
        const staged = new Set(
          files.filter((f) => f.staged).map((f) => f.path),
        );
        vcsStore.setStagedPaths(staged);
        // Bump key so DiffViewer re-fetches if a file changed on disk
        diffRefreshKey++;
      })
      .catch((err) => {
        statusError = true;
        toastStore.addToast(
          `Failed to load status: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      });
  }

  function handleCommit() {
    refreshStatus();
    historyRef?.refresh();
  }

  $effect(() => {
    refreshStatus();

    let unlisten: (() => void) | null = null;
    onVcsStatusChanged(() => {
      refreshStatus();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
      vcsStore.reset();
    };
  });
</script>

<div class="vcs-view">
  <CommitHistory bind:this={historyRef} />

  {#if statusError}
    <div class="empty-state">
      <div class="empty-title">Failed to load status</div>
      <button class="retry-button" onclick={refreshStatus}>Retry</button>
    </div>
  {:else if vcsStore.hasChanges}
    <div class="staging-area">
      <div class="staging-tree-panel">
        <StagingTree />
      </div>
      <div class="diff-panel">
        <DiffViewer refreshKey={diffRefreshKey} />
      </div>
    </div>
    <CommitBar oncommit={handleCommit} />
  {:else}
    <div class="empty-state">
      <div class="empty-icon">✓</div>
      <div class="empty-title">No uncommitted changes</div>
      <div class="empty-subtitle">
        Changes will appear here as you edit documents
      </div>
    </div>
  {/if}
</div>

<style>
  .vcs-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .staging-area {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .staging-tree-panel {
    width: 220px;
    min-width: 160px;
    max-width: 360px;
    border-right: 1px solid var(--color-border-default);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .diff-panel {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: var(--color-fg-muted);
  }

  .empty-icon {
    font-size: 24px;
    opacity: 0.3;
    margin-bottom: 8px;
  }

  .empty-title {
    font-size: 13px;
    color: var(--color-fg-default);
  }

  .empty-subtitle {
    font-size: 11px;
    color: var(--color-fg-muted);
  }

  .retry-button {
    margin-top: 8px;
    background: var(--color-accent, #7c3aed);
    color: white;
    border: none;
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }

  .retry-button:hover {
    opacity: 0.9;
  }

  .retry-button:active {
    opacity: 0.8;
  }
</style>
