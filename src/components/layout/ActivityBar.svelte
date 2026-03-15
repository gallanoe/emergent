<script lang="ts">
  import { uiStore } from "../../stores/ui.svelte";

  const items: { id: "workspace" | "vcs"; label: string }[] = [
    { id: "workspace", label: "Files" },
    { id: "vcs", label: "Source Control" },
  ];
</script>

<div
  class="activity-bar"
  data-testid="activity-bar"
  role="tablist"
  aria-label="Views"
>
  {#each items as item (item.id)}
    <button
      role="tab"
      aria-selected={uiStore.activeView === item.id}
      aria-label={item.label}
      title={item.label}
      class="activity-item"
      class:active={uiStore.activeView === item.id}
      onclick={() => uiStore.setActiveView(item.id)}
    >
      {#if item.id === "workspace"}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"
          />
          <polyline points="13 2 13 9 20 9" />
        </svg>
      {:else}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="18" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <path d="M6 21V9a9 9 0 0 0 9 9" />
        </svg>
      {/if}
    </button>
  {/each}
</div>

<style>
  .activity-bar {
    width: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 8px;
    gap: 4px;
    background: var(--color-bg-sidebar);
    flex-shrink: 0;
    position: relative;
  }

  /* Right edge separator */
  .activity-bar::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 1px;
    background: var(--color-border-default);
  }

  .activity-item {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--color-fg-muted);
    border-radius: 6px;
    cursor: pointer;
    transition:
      color 150ms ease,
      background-color 150ms ease;
  }

  .activity-item:hover {
    color: var(--color-fg-default);
    background: var(--color-bg-elevated);
  }

  .activity-item:active {
    opacity: 0.8;
  }

  .activity-item.active {
    color: var(--color-fg-heading);
    background: var(--color-bg-elevated);
  }
</style>
