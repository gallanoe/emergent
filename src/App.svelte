<script lang="ts">
  import { onMount } from "svelte";
  import AppShell from "./components/AppShell.svelte";
  import WorkspacePicker from "./components/WorkspacePicker.svelte";
  import { workspaceStore } from "./stores/workspace.svelte";
  import { listWorkspaces } from "./lib/tauri";
  import { toastStore } from "./stores/toast.svelte";

  onMount(() => {
    listWorkspaces()
      .then((list) => {
        workspaceStore.setWorkspaces(list);
      })
      .catch((err) => {
        toastStore.addToast(
          `Failed to load workspaces: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      });
  });
</script>

<div class="view-fade-in">
  {#if workspaceStore.activeWorkspace}
    <AppShell />
  {:else}
    <WorkspacePicker />
  {/if}
</div>
