<script lang="ts">
  import { uiStore } from "../../stores/ui.svelte";

  const items = [
    { id: "workspace" as const, label: "Files", icon: "files" },
    { id: "vcs" as const, label: "Source Control", icon: "vcs" },
  ];
</script>

<div
  class="activity-bar"
  role="tablist"
  aria-label="Views"
>
  {#each items as item}
    <button
      role="tab"
      aria-selected={uiStore.activeView === item.id}
      aria-label={item.label}
      title={item.label}
      class="activity-item"
      class:active={uiStore.activeView === item.id}
      onclick={() => uiStore.setActiveView(item.id)}
    >
      {#if item.icon === "files"}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
          <polyline points="13 2 13 9 20 9"/>
        </svg>
      {:else}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="18" cy="18" r="3"/>
          <circle cx="6" cy="6" r="3"/>
          <path d="M6 21V9a9 9 0 0 0 9 9"/>
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
    border-right: 1px solid var(--color-border-default);
    background: var(--color-bg-base);
    flex-shrink: 0;
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
    transition: color 0.1s, background-color 0.1s;
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
