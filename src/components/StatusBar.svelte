<!-- src/components/StatusBar.svelte -->
<script lang="ts">
  import { editorStore } from "../stores/editor.svelte";
  import { workspaceStore } from "../stores/workspace.svelte";
</script>

<div
  class="flex items-center justify-between px-4"
  style="height: 24px; font-size: 11px; color: var(--color-fg-muted); border-top: 1px solid var(--color-border-default);"
>
  <div>{editorStore.activeTab ? "Ln 1, Col 1" : ""}</div>
  <div class="flex gap-4">
    {#if editorStore.activeTab}
      <span>Markdown</span>
    {/if}
    <span>UTF-8</span>
    <span style="color: var(--color-success);">Saved</span>
    <span>{workspaceStore.currentBranch}</span>
  </div>
</div>
