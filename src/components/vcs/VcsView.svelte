<script lang="ts">
  import CommitHistory from "./CommitHistory.svelte";
  import StagingTree from "./StagingTree.svelte";
  import DiffViewer from "./DiffViewer.svelte";
  import CommitBar from "./CommitBar.svelte";
  import UnsavedChangesModal from "../shared/UnsavedChangesModal.svelte";
  import { vcsStore } from "../../stores/vcs.svelte";
  import { editorStore } from "../../stores/editor.svelte";
  import { workspaceStore } from "../../stores/workspace.svelte";
  import { vcsGetStatus, onVcsStatusChanged, vcsCheckoutCommit } from "../../lib/tauri";
  import { toastStore } from "../../stores/toast.svelte";

  interface Props {
    onsaveeditor?: () => void;
  }
  let { onsaveeditor }: Props = $props();

  let historyRef: ReturnType<typeof CommitHistory> | undefined = $state();
  let diffRefreshKey = $state(0);
  let statusError = $state(false);
  let showUnsavedModal = $state(false);
  let pendingCheckoutOid: string | null = $state(null);

  function handleLoadCommit(oid: string) {
    if (editorStore.dirtyTabs.size > 0) {
      pendingCheckoutOid = oid;
      showUnsavedModal = true;
    } else {
      performCheckout(oid);
    }
  }

  async function performCheckout(oid: string) {
    try {
      await vcsCheckoutCommit(oid);
      editorStore.closeAllTabs();
      await workspaceStore.refreshHeadInfo();
      refreshStatus();
      historyRef?.refresh();
    } catch (err) {
      toastStore.addToast(
        `Failed to load commit: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  }

  function handleModalSave() {
    showUnsavedModal = false;
    const oid = pendingCheckoutOid;
    pendingCheckoutOid = null;
    if (!oid) return;
    onsaveeditor?.();
    performCheckout(oid);
  }

  function handleModalDiscard() {
    showUnsavedModal = false;
    const oid = pendingCheckoutOid;
    pendingCheckoutOid = null;
    if (oid) performCheckout(oid);
  }

  function handleModalCancel() {
    showUnsavedModal = false;
    pendingCheckoutOid = null;
  }

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
    workspaceStore.refreshHeadInfo();
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

<div class="vcs-view" data-testid="vcs-view">
  <CommitHistory bind:this={historyRef} onloadcommit={handleLoadCommit} />
  <div class="gradient-separator"></div>

  {#if statusError}
    <div class="empty-state">
      <div class="empty-title">Failed to load status</div>
      <button class="retry-button" onclick={refreshStatus}>Retry</button>
    </div>
  {:else if vcsStore.hasChanges}
    <div class="staging-area">
      <div class="staging-tree-panel">
        <StagingTree />
        <div class="vertical-separator"></div>
      </div>
      <div class="diff-panel">
        <DiffViewer refreshKey={diffRefreshKey} />
      </div>
    </div>
    <div class="gradient-separator"></div>
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

  {#if showUnsavedModal}
    <UnsavedChangesModal
      dirtyPaths={[...editorStore.dirtyTabs]}
      oncancel={handleModalCancel}
      onsave={handleModalSave}
      ondiscard={handleModalDiscard}
    />
  {/if}
</div>

<style>
  .vcs-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--color-bg-base);
  }

  .gradient-separator {
    height: 1px;
    background: var(--color-border-default);
    flex-shrink: 0;
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
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .vertical-separator {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 1px;
    background: var(--color-border-default);
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
    color: var(--color-fg-disabled);
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
    background: var(--color-accent);
    color: white;
    border: none;
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    transition: opacity 150ms ease;
  }

  .retry-button:hover {
    opacity: 0.9;
  }

  .retry-button:active {
    opacity: 0.8;
  }
</style>
