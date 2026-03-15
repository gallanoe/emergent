<script lang="ts">
  import { X } from "@lucide/svelte";
  import { editorStore } from "../../stores/editor.svelte";
</script>

{#if editorStore.openTabs.length > 0}
  <div
    class="flex items-center overflow-x-auto"
    style="height: 40px; padding: 0 16px; gap: 2px;"
  >
    {#each editorStore.openTabs as tab (tab.path)}
      {@const isActive = tab.path === editorStore.activeTab}
      {@const isDirty = editorStore.dirtyTabs.has(tab.path)}
      <div
        role="tab"
        tabindex={0}
        onclick={() => editorStore.setActiveTab(tab.path)}
        onkeydown={(e) => {
          if (e.key === "Enter") editorStore.setActiveTab(tab.path);
        }}
        class="interactive group flex items-center gap-2"
        style="font-size: 13px; padding: 6px 12px; border-radius: 6px; white-space: nowrap; {isActive
          ? 'background: var(--color-bg-hover); color: var(--color-fg-heading); font-weight: 500;'
          : 'color: var(--color-fg-muted);'}"
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
          onclick={(e) => {
            e.stopPropagation();
            editorStore.closeTab(tab.path);
          }}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation();
              editorStore.closeTab(tab.path);
            }
          }}
          class="interactive"
          style="opacity: 0.4; color: var(--color-fg-muted); transition: opacity 100ms ease-out;"
          onmouseenter={(e) => {
            (e.currentTarget as HTMLElement).style.opacity = "1";
          }}
          onmouseleave={(e) => {
            (e.currentTarget as HTMLElement).style.opacity = "0.4";
          }}
        >
          <X size={12} />
        </span>
      </div>
    {/each}
  </div>
  <div
    style="height: 1px; background: var(--color-border-default); margin: 0 16px;"
  ></div>
{/if}
