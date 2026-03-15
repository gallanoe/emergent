<script lang="ts">
  import { vcsStore } from "../../stores/vcs.svelte";
  import { vcsGetLog } from "../../lib/tauri";
  import { toastStore } from "../../stores/toast.svelte";

  let limit = $state(5);
  let totalLoaded = $derived(vcsStore.commits.length);

  export function refresh() {
    vcsGetLog(limit)
      .then((commits) => vcsStore.setCommits(commits))
      .catch((err) =>
        toastStore.addToast(
          `Failed to load history: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        ),
      );
  }

  function showMore() {
    limit += 10;
    refresh();
  }

  function formatTime(unixTime: number): string {
    const now = Date.now() / 1000;
    const diff = now - unixTime;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  $effect(() => {
    refresh();
  });
</script>

<div class="commit-history">
  <div class="history-header">
    <span class="section-label">History</span>
  </div>
  <div class="commit-list">
    {#each vcsStore.commits as commit (commit.oid)}
      <div class="commit-row">
        <span class="commit-message">{commit.message}</span>
        <span class="commit-meta">
          {commit.oid.slice(0, 7)} · {formatTime(commit.time)}
        </span>
      </div>
    {/each}
    {#if totalLoaded >= limit}
      <button class="show-more" onclick={showMore}>
        Show more
      </button>
    {/if}
  </div>
</div>

<style>
  .commit-history {
    border-bottom: 1px solid var(--color-border-default);
  }

  .history-header {
    padding: 6px 12px;
    border-bottom: 1px solid var(--color-border-default);
    background: var(--color-bg-elevated);
  }

  .section-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-fg-muted);
    font-weight: 600;
  }

  .commit-list {
    max-height: 200px;
    overflow-y: auto;
  }

  .commit-row {
    padding: 6px 12px;
    border-bottom: 1px solid var(--color-border-subtle, transparent);
  }

  .commit-message {
    display: block;
    font-size: 12px;
    color: var(--color-fg-default);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .commit-meta {
    display: block;
    font-size: 10px;
    color: var(--color-fg-muted);
    margin-top: 1px;
    font-family: ui-monospace, monospace;
  }

  .show-more {
    width: 100%;
    padding: 4px 12px;
    background: var(--color-bg-elevated);
    border: none;
    color: var(--color-accent, #7c3aed);
    font-size: 11px;
    cursor: pointer;
    text-align: center;
  }

  .show-more:hover {
    background: var(--color-bg-base);
  }
</style>
