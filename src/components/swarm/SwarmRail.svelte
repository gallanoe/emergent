<script lang="ts">
  import type { DisplayWorkspace, ContainerStatus } from "../../stores/types";
  import ThemeToggle from "./ThemeToggle.svelte";
  import { Plus } from "@lucide/svelte";

  interface Props {
    workspaces: DisplayWorkspace[];
    selectedWorkspaceId: string | null;
    demoMode: boolean;
    onSelectWorkspace: (id: string) => void;
    onNewWorkspace: () => void;
  }

  let {
    workspaces,
    selectedWorkspaceId,
    demoMode,
    onSelectWorkspace,
    onNewWorkspace,
  }: Props = $props();

  function statusDotColor(status: ContainerStatus): string {
    switch (status.state) {
      case "running":
        return "bg-success";
      case "building":
        return "bg-warning animate-pulse";
      case "error":
        return "bg-error";
      case "stopped":
      default:
        return "bg-fg-disabled";
    }
  }
</script>

<nav
  class="flex flex-col items-center w-[56px] border-r border-border-default bg-bg-sidebar py-3 gap-2"
>
  {#each workspaces as workspace (workspace.id)}
    <div class="relative">
      <button
        class="flex items-center justify-center w-[36px] h-[36px] rounded-[10px]
               font-semibold text-[13px] transition-colors duration-150
               {workspace.id === selectedWorkspaceId
          ? 'bg-accent text-bg-base shadow-[0_0_0_2px_rgba(255,255,255,0.1)]'
          : 'bg-bg-elevated text-fg-muted border border-border-default hover:bg-bg-hover'}"
        title={workspace.name}
        onclick={() => onSelectWorkspace(workspace.id)}
      >
        {workspace.name.charAt(0).toUpperCase()}
      </button>
      <span
        class="absolute -bottom-0.5 -right-0.5 w-[9px] h-[9px] rounded-full border-2 border-bg-sidebar
               {statusDotColor(workspace.containerStatus)}"
      ></span>
    </div>
  {/each}

  <div class="flex-1"></div>

  {#if !demoMode}
    <button
      class="interactive flex items-center justify-center w-[36px] h-[36px] rounded-[10px]
             bg-bg-elevated text-fg-muted border border-border-default"
      title="New workspace"
      onclick={onNewWorkspace}
    >
      <Plus size={16} />
    </button>
  {/if}

  <div class="w-6 h-px bg-border-default"></div>
  <ThemeToggle />
</nav>
