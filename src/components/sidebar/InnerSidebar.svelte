<script lang="ts">
  import {
    Cog,
    ListChecks,
    Orbit,
    Plus,
    Search,
    SquareTerminal,
  } from "@lucide/svelte";
  import type { ActiveView, DisplayWorkspace } from "../../stores/types";
  import { AgentAvatar, Kbd, SLabel } from "../../lib/primitives";
  import WorkspaceSwitcher from "./WorkspaceSwitcher.svelte";

  interface Props {
    swarm: DisplayWorkspace | undefined;
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
    onOpenSwarm: () => void;
    onOpenTasks: () => void;
    onOpenTerminal: () => void;
    onOpenAppSettings: () => void;
    onOpenWorkspaceSettings: () => void;
  }

  let {
    swarm,
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
    onOpenSwarm,
    onOpenTasks,
    onOpenTerminal,
    onOpenAppSettings,
    onOpenWorkspaceSettings,
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
  <!-- 1. Window chrome strip -->
  <div
    class="flex h-[34px] items-center gap-[6px] pr-[10px]"
    class:pl-[72px]={isMacOS}
    class:pl-[10px]={!isMacOS}
    data-tauri-drag-region
  >
    <div class="flex-1"></div>
    <button
      type="button"
      title="Hide sidebar (coming soon)"
      class="inline-flex h-[26px] w-[26px] items-center justify-center rounded-[6px] text-fg-muted transition-colors hover:bg-bg-hover"
      data-tauri-drag-region="false"
    >
      <svg
        class="h-[13px] w-[13px]"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        ><rect
          x="1.5"
          y="2.5"
          width="13"
          height="11"
          rx="1.5"
          stroke="currentColor"
          stroke-width="1.3"
        /><path d="M5.5 2.5v11" stroke="currentColor" stroke-width="1.3" />
      </svg>
    </button>
    <button
      type="button"
      title="Search · ⌘K"
      class="inline-flex h-[26px] w-[26px] items-center justify-center rounded-[6px] text-fg-muted transition-colors hover:bg-bg-hover"
      data-tauri-drag-region="false"
      onclick={() => {
        // TODO(search)
      }}
    >
      <Search size={12} />
    </button>
  </div>

  <!-- 2. Workspace switcher -->
  <div class="px-[8px] pt-[2px] pb-[10px]">
    <WorkspaceSwitcher
      {workspaces}
      selectedId={selectedWorkspaceId}
      onSelect={onSelectWorkspace}
      {onOpenWorkspaceSettings}
      {onCreateWorkspace}
    />
  </div>

  <!-- 3. Primary actions -->
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
      onclick={onOpenSwarm}
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
    <button
      type="button"
      class="flex h-7 w-full items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left text-[12.5px] transition-colors
        {activeView === 'terminal'
        ? 'bg-bg-selected text-fg-heading hover:brightness-[0.99]'
        : 'text-fg-default hover:bg-bg-hover'}"
      onclick={onOpenTerminal}
    >
      <span
        class="inline-flex w-[18px] justify-center {activeView === 'terminal'
          ? 'text-fg-heading'
          : 'text-fg-muted'}"><SquareTerminal size={13} /></span
      >
      <span class="flex-1">Terminal</span>
    </button>
  </div>

  <!-- 4. Agents list -->
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
      {#each swarm?.agentDefinitions ?? [] as def (def.id)}
        {@const active =
          activeView.startsWith("agent") && selectedAgentId === def.id}
        <button
          type="button"
          class="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left text-[12.5px] transition-colors {active
            ? 'bg-bg-selected text-fg-heading hover:brightness-[0.99]'
            : 'text-fg-default hover:bg-bg-hover'}"
          onclick={() => onSelectAgent(def.id)}
        >
          <AgentAvatar cli={def.cli} size={18} />
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

  <!-- 5. Footer -->
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
