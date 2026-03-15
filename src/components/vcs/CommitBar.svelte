<script lang="ts">
  import { vcsStore } from "../../stores/vcs.svelte";
  import { vcsCommit } from "../../lib/tauri";
  import { toastStore } from "../../stores/toast.svelte";

  interface Props {
    oncommit: () => void;
  }

  let { oncommit }: Props = $props();

  let committing = $state(false);

  let canCommit = $derived(
    vcsStore.stagedCount > 0 &&
      vcsStore.commitMessage.trim().length > 0 &&
      !committing,
  );

  async function handleCommit() {
    if (!canCommit) return;
    committing = true;
    try {
      await vcsCommit(vcsStore.commitMessage.trim());
      vcsStore.setCommitMessage("");
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

<div class="commit-bar">
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

<style>
  .commit-bar {
    padding: 8px 12px;
    background: var(--color-bg-elevated);
    border-top: 1px solid var(--color-border-default);
    display: flex;
    gap: 8px;
    align-items: center;
    flex-shrink: 0;
  }

  .commit-input {
    flex: 1;
    background: var(--color-bg-base);
    border: 1px solid var(--color-border-default);
    color: var(--color-fg-default);
    padding: 5px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-family: ui-monospace, monospace;
    outline: none;
  }

  .commit-input:focus {
    border-color: var(--color-accent, #7c3aed);
  }

  .staged-count {
    font-size: 11px;
    color: var(--color-fg-muted);
    white-space: nowrap;
  }

  .commit-button {
    background: var(--color-accent, #7c3aed);
    color: white;
    border: none;
    padding: 5px 14px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.1s;
  }

  .commit-button:hover:not(:disabled) {
    opacity: 0.9;
  }

  .commit-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
