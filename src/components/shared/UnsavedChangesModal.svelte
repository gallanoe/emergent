<script lang="ts">
  interface Props {
    dirtyPaths: string[];
    oncancel: () => void;
    onsave: () => void;
    ondiscard: () => void;
  }

  let { dirtyPaths, oncancel, onsave, ondiscard }: Props = $props();

  let previousFocusEl: Element | null = null;

  $effect(() => {
    previousFocusEl = document.activeElement;
    return () => {
      if (previousFocusEl instanceof HTMLElement) {
        previousFocusEl.focus();
      }
    };
  });

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      oncancel();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div
  class="modal-backdrop"
  onclick={oncancel}
  role="presentation"
></div>
<div
  class="modal"
  role="dialog"
  aria-modal="true"
  aria-label="Unsaved Changes"
>
  <h3 class="modal-title">Unsaved Changes</h3>
  <p class="modal-subtitle">The following files have unsaved changes:</p>

  <div class="file-list">
    {#each dirtyPaths as filePath}
      <div class="file-item">{filePath}</div>
    {/each}
  </div>

  <div class="modal-actions">
    <button class="btn btn-cancel" onclick={oncancel}>Cancel</button>
    <button class="btn btn-discard" onclick={ondiscard}>Discard & Switch</button>
    <button class="btn btn-save" onclick={onsave}>Save All & Switch</button>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 100;
  }

  .modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 360px;
    max-width: calc(100vw - 32px);
    background: var(--color-bg-sidebar);
    border: 1px solid var(--color-border-default);
    border-radius: 12px;
    padding: 20px 24px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    z-index: 101;
    font-family: var(--font-ui);
  }

  .modal-title {
    margin: 0 0 4px 0;
    font-size: 14px;
    color: var(--color-fg-heading);
    font-weight: 600;
  }

  .modal-subtitle {
    margin: 0 0 16px 0;
    font-size: 12px;
    color: var(--color-fg-muted);
  }

  .file-list {
    background: var(--color-bg-base);
    border-radius: 8px;
    padding: 8px 12px;
    margin-bottom: 16px;
  }

  .file-item {
    padding: 4px 0;
    font-size: 12px;
    color: var(--color-fg-default);
  }

  .modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .btn {
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 12px;
    cursor: pointer;
    transition: opacity 150ms ease;
  }

  .btn:hover {
    opacity: 0.9;
  }

  .btn:active {
    opacity: 0.8;
  }

  .btn-cancel {
    background: none;
    border: 1px solid var(--color-border-default);
    color: var(--color-fg-muted);
  }

  .btn-discard {
    background: none;
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: #ef4444;
  }

  .btn-save {
    background: var(--color-accent);
    border: none;
    color: white;
    font-weight: 500;
  }
</style>
