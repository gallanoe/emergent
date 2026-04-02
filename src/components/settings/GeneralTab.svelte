<script lang="ts">
  import type { WorkspaceInfo } from "../../stores/types";

  interface Props {
    workspace: WorkspaceInfo;
    onUpdateName: (name: string) => void;
  }

  let { workspace, onUpdateName }: Props = $props();

  let editingName = $state(false);
  let nameInput = $state("");

  function saveName() {
    if (nameInput.trim() && nameInput !== workspace.name) {
      onUpdateName(nameInput.trim());
    }
    editingName = false;
  }
</script>

<div class="space-y-6">
  <div>
    <label
      for="workspace-name"
      class="block text-[10px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
      >Workspace Name</label
    >
    {#if editingName}
      <input
        id="workspace-name"
        class="w-full bg-bg-base border border-border-strong rounded-md px-3 py-1.5 text-[13px] text-fg-default focus:outline-none focus:border-border-focus"
        bind:value={nameInput}
        onblur={saveName}
        onkeydown={(e) => {
          if (e.key === "Enter") saveName();
          if (e.key === "Escape") editingName = false;
        }}
      />
    {:else}
      <button
        class="text-[13px] text-fg-heading hover:text-accent-text cursor-text"
        onclick={() => {
          editingName = true;
          nameInput = workspace.name;
        }}
      >
        {workspace.name}
      </button>
    {/if}
  </div>

  <div>
    <span
      class="block text-[10px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
      >Workspace ID</span
    >
    <span class="text-[13px] text-fg-muted font-mono">{workspace.id}</span>
  </div>

  <div>
    <span
      class="block text-[10px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
      >Storage Path</span
    >
    <span class="text-[13px] text-fg-muted font-mono">{workspace.path}</span>
  </div>
</div>
