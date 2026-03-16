<script lang="ts">
  import { vcsStore } from "../../stores/vcs.svelte";
  import { vcsCommit } from "../../lib/tauri";
  import { toastStore } from "../../stores/toast.svelte";
  import { workspaceStore } from "../../stores/workspace.svelte";

  interface Props {
    oncommit: () => void;
  }

  let { oncommit }: Props = $props();

  let committing = $state(false);
  let branchName = $state("");

  let canCommit = $derived(
    vcsStore.stagedCount > 0 &&
      vcsStore.commitMessage.trim().length > 0 &&
      (!workspaceStore.isDetached || branchName.trim().length > 0) &&
      !committing,
  );

  async function handleCommit() {
    if (!canCommit) return;
    committing = true;
    try {
      const bn = workspaceStore.isDetached ? branchName.trim() : undefined;
      await vcsCommit(vcsStore.commitMessage.trim(), bn);
      vcsStore.setCommitMessage("");
      branchName = "";
      oncommit();
    } catch (err) {
      toastStore.addToast(
        `Commit failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      committing = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canCommit) {
      e.preventDefault();
      handleCommit();
    }
  }
</script>

<div class="commit-bar" class:commit-bar-detached={workspaceStore.isDetached}>
  {#if workspaceStore.isDetached}
    <input
      type="text"
      class="branch-input"
      placeholder="Branch name..."
      bind:value={branchName}
      onkeydown={handleKeydown}
    />
  {/if}
  <div class="commit-row-inputs">
    <input
      type="text"
      class="commit-input"
      placeholder="Commit message..."
      bind:value={vcsStore.commitMessage}
      onkeydown={handleKeydown}
    />
    <span class="staged-count">{vcsStore.stagedCount} staged</span>
    <button class="commit-button" disabled={!canCommit} onclick={handleCommit}>
      {committing ? "Committing..." : "Commit"}
    </button>
  </div>
</div>

<style>
  .commit-bar {
    padding: 8px 12px;
    background: var(--color-bg-sidebar);
    display: flex;
    gap: 8px;
    align-items: center;
    flex-shrink: 0;
  }

  .commit-bar-detached {
    flex-direction: column;
  }

  .commit-row-inputs {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
  }

  .branch-input {
    width: 100%;
    background: var(--color-bg-base);
    border: 1.5px solid var(--color-border-default);
    color: var(--color-fg-default);
    padding: 5px 8px;
    border-radius: 8px;
    font-size: 12px;
    font-family: var(--font-ui);
    outline: none;
    transition: border-color 150ms ease;
  }

  .branch-input:focus {
    border-color: var(--color-border-strong);
  }

  .commit-input {
    flex: 1;
    background: var(--color-bg-base);
    border: 1.5px solid var(--color-border-default);
    color: var(--color-fg-default);
    padding: 5px 8px;
    border-radius: 8px;
    font-size: 12px;
    font-family: var(--font-ui);
    outline: none;
    transition: border-color 150ms ease;
  }

  .commit-input:focus {
    border-color: var(--color-border-strong);
  }

  .staged-count {
    font-size: 11px;
    color: var(--color-fg-muted);
    white-space: nowrap;
  }

  .commit-button {
    background: var(--color-accent);
    color: white;
    border: none;
    padding: 5px 14px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition:
      opacity 150ms ease,
      background-color 150ms ease;
  }

  .commit-button:hover:not(:disabled) {
    opacity: 0.9;
  }

  .commit-button:active:not(:disabled) {
    opacity: 0.8;
  }

  .commit-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
