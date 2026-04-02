<script lang="ts">
  import type { WorkspaceInfo, ContainerStatus } from "../../stores/types";
  import GeneralTab from "./GeneralTab.svelte";
  import ContainerTab from "./ContainerTab.svelte";
  import { invoke } from "@tauri-apps/api/core";

  interface Props {
    workspaceId: string;
    containerStatus: ContainerStatus;
    onUpdateName: (name: string) => void;
    onStart: () => void;
    onStop: () => void;
    onRebuild: () => void;
  }

  let { workspaceId, containerStatus, onUpdateName, onStart, onStop, onRebuild }: Props = $props();

  let activeTab = $state<"general" | "container">("general");
  let workspace = $state<WorkspaceInfo | null>(null);
  let dockerfile = $state("");

  async function loadWorkspace() {
    workspace = await invoke<WorkspaceInfo>("get_workspace", { workspaceId });
    dockerfile = await invoke<string>("get_dockerfile", { workspaceId });
  }

  $effect(() => {
    workspaceId;
    loadWorkspace();
  });

  async function openEditor() {
    await invoke("open_dockerfile_editor", { workspaceId });
  }
</script>

<div class="flex flex-col h-full">
  <div class="flex border-b border-border-default bg-bg-sidebar px-4">
    <button
      class="px-4 py-2.5 text-[12px] font-medium border-b-2 transition-colors
             {activeTab === 'general'
        ? 'text-fg-heading border-accent'
        : 'text-fg-muted border-transparent hover:text-fg-default'}"
      onclick={() => (activeTab = "general")}
    >
      General
    </button>
    <button
      class="px-4 py-2.5 text-[12px] font-medium border-b-2 transition-colors
             {activeTab === 'container'
        ? 'text-fg-heading border-accent'
        : 'text-fg-muted border-transparent hover:text-fg-default'}"
      onclick={() => (activeTab = "container")}
    >
      Container
    </button>
  </div>

  <div class="flex-1 overflow-y-auto p-6 max-w-xl">
    {#if workspace}
      {#if activeTab === "general"}
        <GeneralTab {workspace} {onUpdateName} />
      {:else}
        <ContainerTab
          {containerStatus}
          {dockerfile}
          {onStart}
          {onStop}
          {onRebuild}
          onOpenEditor={openEditor}
        />
      {/if}
    {/if}
  </div>
</div>
