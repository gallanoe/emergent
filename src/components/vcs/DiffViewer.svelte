<script lang="ts">
  import { vcsStore } from "../../stores/vcs.svelte";
  import { vcsDiff } from "../../lib/tauri";
  import type { DiffResult } from "../../lib/tauri";

  interface Props {
    refreshKey?: number;
  }

  let { refreshKey = 0 }: Props = $props();

  let diffResult: DiffResult | null = $state(null);
  let error: string | null = $state(null);
  let loading = $state(false);
  let viewMode: "unified" | "split" = $state("unified");

  // Re-fetch diff when selectedFile changes OR when refreshKey changes
  // (refreshKey is bumped by VcsView when vcs:status-changed fires)
  $effect(() => {
    const _key = refreshKey; // track reactively
    const file = vcsStore.selectedFile;
    if (!file) {
      diffResult = null;
      error = null;
      return;
    }

    loading = true;
    error = null;
    vcsDiff(file)
      .then((result) => {
        diffResult = result;
        loading = false;
      })
      .catch((err) => {
        error = err instanceof Error ? err.message : String(err);
        diffResult = null;
        loading = false;
      });
  });
</script>

<div class="diff-viewer">
  {#if !vcsStore.selectedFile}
    <div class="empty-state">
      <span>Select a file to view its diff</span>
    </div>
  {:else}
    <div class="diff-header">
      <span class="diff-filename">{vcsStore.selectedFile}</span>
      <div class="view-toggle">
        <button
          class:active={viewMode === "unified"}
          onclick={() => (viewMode = "unified")}>unified</button
        >
        <button
          class:active={viewMode === "split"}
          onclick={() => (viewMode = "split")}>split</button
        >
      </div>
    </div>
    <div class="diff-content">
      {#if loading}
        <div class="empty-state">Loading...</div>
      {:else if error}
        <div class="error-state">Failed to load diff: {error}</div>
      {:else if diffResult && diffResult.hunks.length === 0}
        <div class="empty-state">No changes</div>
      {:else if diffResult}
        {#if viewMode === "unified"}
          {#each diffResult.hunks as hunk, i (i)}
            {#if i > 0}
              <div class="collapsed-divider">· · ·</div>
            {/if}
            <div class="hunk">
              <div class="hunk-header">{hunk.header}</div>
              {#each hunk.lines as line, j (j)}
                <div class="diff-line {line.kind}">
                  <span class="line-no old">{line.old_lineno ?? ""}</span>
                  <span class="line-no new">{line.new_lineno ?? ""}</span>
                  <span class="line-origin"
                    >{line.kind === "add"
                      ? "+"
                      : line.kind === "remove"
                        ? "-"
                        : " "}</span
                  >
                  <span class="line-content">{line.content}</span>
                </div>
              {/each}
            </div>
          {/each}
        {:else}
          {#each diffResult.hunks as hunk, i (i)}
            {#if i > 0}
              <div class="collapsed-divider">· · ·</div>
            {/if}
            <div class="hunk">
              <div class="hunk-header">{hunk.header}</div>
              <div class="split-view">
                <div class="split-side old-side">
                  {#each hunk.lines as line, j (j)}
                    {#if line.kind === "remove" || line.kind === "context"}
                      <div class="diff-line {line.kind}">
                        <span class="line-no">{line.old_lineno ?? ""}</span>
                        <span class="line-content">{line.content}</span>
                      </div>
                    {:else}
                      <div class="diff-line spacer">
                        <span class="line-no"></span>
                        <span class="line-content"></span>
                      </div>
                    {/if}
                  {/each}
                </div>
                <div class="split-side new-side">
                  {#each hunk.lines as line, j (j)}
                    {#if line.kind === "add" || line.kind === "context"}
                      <div class="diff-line {line.kind}">
                        <span class="line-no">{line.new_lineno ?? ""}</span>
                        <span class="line-content">{line.content}</span>
                      </div>
                    {:else}
                      <div class="diff-line spacer">
                        <span class="line-no"></span>
                        <span class="line-content"></span>
                      </div>
                    {/if}
                  {/each}
                </div>
              </div>
            </div>
          {/each}
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .diff-viewer {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .diff-header {
    padding: 6px 12px;
    background: var(--color-bg-base);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .diff-filename {
    font-weight: 600;
    color: var(--color-fg-heading);
    font-size: 12px;
  }

  .view-toggle {
    display: flex;
    align-items: center;
    gap: 0;
    background: var(--color-bg-base);
    border: 1px solid var(--color-border-default);
    border-radius: 6px;
    overflow: hidden;
  }

  .view-toggle button {
    background: none;
    border: none;
    color: var(--color-fg-muted);
    cursor: pointer;
    font-size: 11px;
    padding: 3px 10px;
    font-family: var(--font-ui);
  }

  .view-toggle button.active {
    background: var(--color-bg-hover);
    color: var(--color-fg-default);
  }

  .diff-content {
    flex: 1;
    overflow: auto;
    padding: 4px 0;
  }

  .empty-state,
  .error-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--color-fg-muted);
    font-size: 12px;
    font-family: var(--font-ui);
  }

  .error-state {
    color: var(--color-error);
  }

  .hunk-header {
    padding: 2px 12px;
    color: var(--color-fg-muted);
    font-size: 11px;
    font-family: var(--font-mono);
    background: var(--color-accent-soft);
    border-radius: 4px;
    margin: 2px 4px;
  }

  .collapsed-divider {
    padding: 4px 12px;
    color: var(--color-fg-disabled);
    font-size: 10px;
    text-align: center;
    background: var(--color-bg-base);
  }

  .diff-line {
    display: flex;
    line-height: 1.6;
    white-space: pre;
    font-family: var(--font-mono);
  }

  .diff-line.add {
    background: var(--color-added-bg);
    color: var(--color-added-fg);
  }

  .diff-line.remove {
    background: var(--color-removed-bg);
    color: var(--color-removed-fg);
  }

  .diff-line.context {
    color: var(--color-fg-default);
  }

  .diff-line.spacer {
    visibility: hidden;
  }

  .line-no {
    width: 40px;
    text-align: right;
    padding-right: 8px;
    color: var(--color-fg-disabled);
    flex-shrink: 0;
    user-select: none;
  }

  .line-no.old {
    width: 35px;
  }

  .line-no.new {
    width: 35px;
  }

  .line-origin {
    width: 16px;
    text-align: center;
    flex-shrink: 0;
    user-select: none;
    font-weight: 500;
  }

  .line-content {
    flex: 1;
    padding-right: 12px;
    font-family: var(--font-mono);
  }

  .split-view {
    display: flex;
  }

  .split-side {
    flex: 1;
    overflow-x: auto;
  }

  .split-side.old-side {
    border-right: 1px solid var(--color-border-default);
  }
</style>
