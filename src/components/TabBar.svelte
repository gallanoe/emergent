<script lang="ts">
  import { editorStore } from "../stores/editor.svelte";
</script>

{#if editorStore.openTabs.length > 0}
  <div
    class="flex overflow-x-auto"
    style="height: 32px; border-bottom: 1px solid var(--color-border-default);"
  >
    {#each editorStore.openTabs as tab (tab.path)}
      {@const isActive = tab.path === editorStore.activeTab}
      {@const isDirty = editorStore.dirtyTabs.has(tab.path)}
      <div
        onclick={() => editorStore.setActiveTab(tab.path)}
        class="interactive group flex items-center gap-2 px-3"
        style="font-size: 13px; color: {isActive ? 'var(--color-fg-heading)' : 'var(--color-fg-muted)'}; border-bottom: {isActive ? '1px solid var(--color-accent)' : '1px solid transparent'}; white-space: nowrap;"
      >
        <span>{tab.name}</span>
        {#if isDirty}
          <span
            style="width: 6px; height: 6px; border-radius: 50%; background: var(--color-warning); flex-shrink: 0;"
          ></span>
        {/if}
        <span
          role="button"
          tabindex="0"
          onclick={(e) => { e.stopPropagation(); editorStore.closeTab(tab.path); }}
          onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); editorStore.closeTab(tab.path); } }}
          class="interactive opacity-0 group-hover:opacity-100"
          style="font-size: 10px; color: var(--color-fg-muted); transition: opacity 100ms ease-out;"
        >
          &times;
        </span>
      </div>
    {/each}
  </div>
{/if}
