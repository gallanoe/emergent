<script lang="ts">
  import { Cog, ListChecks, Orbit, Plus, Search } from "@lucide/svelte";
  import type { ActiveView, DisplayWorkspace } from "../../stores/types";
  import { AgentAvatar, Kbd, SLabel } from "../../lib/primitives";
  import WorkspaceSwitcher from "./WorkspaceSwitcher.svelte";

  interface Props {
    workspace: DisplayWorkspace | undefined;
    workspaces: DisplayWorkspace[];
    selectedWorkspaceId: string | null;
    activeView: ActiveView;
    selectedAgentId: string | null;
    demoMode: boolean;
    activeTaskCount: number;
    onSelectWorkspace: (id: string) => void;
    onCreateWorkspace: () => void;
    onSelectAgent: (id: string) => void;
    onCreateAgent: () => void;
    onNewThread: () => void;
    /** Opens the overview: used by both the nav entry and the workspace-name zone. */
    onOpenOverview: () => void;
    onOpenTasks: () => void;
    onOpenAppSettings: () => void;
    onOpenWorkspaceSettings: () => void;
    onOpenSearch: () => void;
    overviewActive?: boolean;
  }

  let {
    workspace,
    workspaces,
    selectedWorkspaceId,
    activeView,
    selectedAgentId,
    demoMode,
    activeTaskCount,
    onSelectWorkspace,
    onCreateWorkspace,
    onSelectAgent,
    onCreateAgent,
    onNewThread,
    onOpenOverview,
    onOpenTasks,
    onOpenAppSettings,
    onOpenWorkspaceSettings,
    onOpenSearch,
    overviewActive = false,
  }: Props = $props();

  const isMacOS = $derived(
    typeof navigator !== "undefined" &&
      (navigator.platform.toLowerCase().includes("mac") ||
        /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)),
  );
</script>

<aside
  class="flex h-full w-[240px] min-h-0 shrink-0 flex-col border-r border-border-default bg-bg-sidebar"
>
  <div
    class="flex h-[34px] items-center gap-[6px] pr-[10px]"
    class:pl-[72px]={isMacOS}
    class:pl-[10px]={!isMacOS}
    data-tauri-drag-region
  >
    <div class="flex-1"></div>
    <button
      type="button"
      title="Search · ⌘K"
      class="inline-flex h-[26px] w-[26px] items-center justify-center rounded-[6px] text-fg-muted transition-colors hover:bg-bg-hover"
      data-tauri-drag-region="false"
      onclick={onOpenSearch}
    >
      <Search size={12} />
    </button>
  </div>

  <div class="px-[8px] pt-[2px] pb-[10px]">
    <WorkspaceSwitcher
      {workspaces}
      selectedId={selectedWorkspaceId}
      onSelect={onSelectWorkspace}
      {onOpenWorkspaceSettings}
      {onCreateWorkspace}
      {onOpenOverview}
      {overviewActive}
    />
  </div>

  <div class="flex flex-col gap-px px-[8px] pb-[6px]">
    <button
      type="button"
      class="flex h-7 w-full items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left text-[12.5px] font-medium text-fg-heading transition-colors hover:bg-bg-hover"
      onclick={onNewThread}
    >
      <span class="inline-flex w-[18px] justify-center text-fg-heading"
        ><Plus size={14} /></span
      >
      <span class="flex-1">New thread</span>
      <Kbd keys={["⌘", "N"]} />
    </button>
    <button
      type="button"
      title="Swarm dashboard"
      class="flex h-7 w-full items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left text-[12.5px] transition-colors
        {activeView === 'overview'
        ? 'bg-bg-selected text-fg-heading hover:brightness-[0.99]'
        : 'text-fg-default hover:bg-bg-hover'}"
      onclick={onOpenOverview}
    >
      <span
        class="inline-flex w-[18px] justify-center {activeView === 'overview'
          ? 'text-fg-heading'
          : 'text-fg-muted'}"><Orbit size={14} /></span
      >
      <span class="flex-1">Swarm</span>
    </button>
    <button
      type="button"
      class="flex h-7 w-full items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left text-[12.5px] transition-colors
        {activeView === 'tasks'
        ? 'bg-bg-selected text-fg-heading hover:brightness-[0.99]'
        : 'text-fg-default hover:bg-bg-hover'}"
      onclick={onOpenTasks}
    >
      <span
        class="inline-flex w-[18px] justify-center {activeView === 'tasks'
          ? 'text-fg-heading'
          : 'text-fg-muted'}"><ListChecks size={13} /></span
      >
      <span class="flex-1">Tasks</span>
      {#if activeTaskCount > 0}
        <span
          class="text-[10px] text-fg-disabled font-mono tabular-nums"
          data-testid="task-count-badge">{activeTaskCount}</span
        >
      {/if}
    </button>
  </div>

  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex items-center gap-1.5 px-3 pt-3 pb-1.5 pl-[12px]">
      <SLabel>AGENTS</SLabel>
      <div class="flex-1"></div>
      {#if !demoMode}
        <button
          type="button"
          title="Add agent definition"
          class="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[4px] text-fg-disabled transition-colors hover:bg-bg-hover hover:text-fg-muted"
          data-tauri-drag-region="false"
          onclick={onCreateAgent}
        >
          <Plus size={10} />
        </button>
      {/if}
    </div>
    <div class="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2">
      {#each workspace?.agentDefinitions ?? [] as def (def.id)}
        {@const active =
          activeView.startsWith("agent") && selectedAgentId === def.id}
        <button
          type="button"
          data-testid={`sidebar-agent-${def.id}`}
          aria-label={def.name}
          class="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left text-[12.5px] transition-colors {active
            ? 'bg-bg-selected text-fg-heading hover:brightness-[0.99]'
            : 'text-fg-default hover:bg-bg-hover'}"
          onclick={() => onSelectAgent(def.id)}
        >
          <AgentAvatar
            provider={def.provider}
            cli={def.cli}
            name={def.name}
            size={18}
          />
          <span class="min-w-0 flex-1 truncate">{def.name}</span>
          {#if def.threads.length > 0}
            <span class="text-[10px] text-fg-disabled font-mono"
              >{def.threads.length}</span
            >
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <div
    class="flex gap-1 border-t border-border-default px-[10px] py-2 [gap:4px] [padding-top:8px] [padding-bottom:8px]"
  >
    <button
      type="button"
      title="Application settings"
      class="inline-flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors {activeView ===
      'app-settings'
        ? 'bg-bg-selected text-fg-heading hover:brightness-[0.99]'
        : 'text-fg-muted hover:bg-bg-hover'}"
      data-tauri-drag-region="false"
      onclick={onOpenAppSettings}
    >
      <Cog size={12} />
    </button>
  </div>
</aside>
