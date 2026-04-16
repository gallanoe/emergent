<script lang="ts">
  import type {
    WorkspaceInfo,
    ContainerStatus,
    ContainerRuntimePreference,
    ContainerRuntimeStatus,
    ContainerRuntimeKind,
  } from "../../stores/types";
  import GeneralTab from "./GeneralTab.svelte";
  import ContainerTab from "./ContainerTab.svelte";
  import { invoke } from "@tauri-apps/api/core";

  interface Props {
    workspaceId: string;
    containerStatus: ContainerStatus;
    runtimePreference: ContainerRuntimePreference;
    runtimeStatus: ContainerRuntimeStatus | null;
    onUpdateName: (name: string) => void;
    onRuntimeChange: (runtime: ContainerRuntimeKind) => void;
    onStart: () => void;
    onStop: () => void;
    onRebuild: () => void;
  }

  let {
    workspaceId,
    containerStatus,
    runtimePreference,
    runtimeStatus,
    onUpdateName,
    onRuntimeChange,
    onStart,
    onStop,
    onRebuild,
  }: Props = $props();

  let workspace = $state<WorkspaceInfo | null>(null);
  let dockerfile = $state("");

  async function loadWorkspace() {
    workspace = await invoke<WorkspaceInfo>("get_workspace", { workspaceId });
    dockerfile = await invoke<string>("get_dockerfile", { workspaceId });
  }

  $effect(() => {
    void workspaceId;
    loadWorkspace();
  });

  async function openEditor() {
    await invoke("open_dockerfile_editor", { workspaceId });
  }
</script>

<div class="flex flex-col h-full overflow-y-auto">
  <div class="flex-1 p-6">
    <div class="max-w-xl">
      {#if workspace}
        <div class="space-y-8">
          <GeneralTab {workspace} {onUpdateName} />
          <ContainerTab
            {containerStatus}
            {runtimePreference}
            {runtimeStatus}
            {dockerfile}
            {onRuntimeChange}
            {onStart}
            {onStop}
            {onRebuild}
            onOpenEditor={openEditor}
          />
        </div>
      {/if}
    </div>
  </div>
</div>
