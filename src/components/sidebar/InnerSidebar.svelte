<script lang="ts">
  import type { DisplayWorkspace } from "../../stores/types";
  import {
    LayoutGrid,
    Settings,
    Sparkles,
    ListChecks,
    Plus,
    SquareTerminal,
    Ellipsis,
  } from "@lucide/svelte";
  import type { Component } from "svelte";

  interface Props {
    swarm: DisplayWorkspace | undefined;
    activeView: string;
    selectedAgentId: string | null;
    demoMode: boolean;
    containerRunning: boolean;
    activeTaskCount?: number;
    onSelectView: (view: "swarm" | "settings" | "terminal" | "tasks") => void;
    onSelectAgent: (id: string) => void;
    onOverflowMenu?: (x: number, y: number) => void;
    onCreateAgent: () => void;
  }

  let {
    swarm,
    activeView,
    selectedAgentId,
    demoMode,
    containerRunning,
    activeTaskCount = 0,
    onSelectView,
    onSelectAgent,
    onOverflowMenu,
    onCreateAgent,
  }: Props = $props();

  const navItems = $derived<
    {
      id: string;
      label: string;
      icon: Component;
      enabled: boolean;
      badge?: number;
    }[]
  >([
    { id: "swarm", label: "Swarm", icon: LayoutGrid, enabled: true },
    { id: "settings", label: "Settings", icon: Settings, enabled: true },
    {
      id: "terminal",
      label: "Terminal",
      icon: SquareTerminal,
      enabled: containerRunning,
    },
    { id: "skills", label: "Skills", icon: Sparkles, enabled: false },
    activeTaskCount > 0
      ? {
          id: "tasks",
          label: "Tasks",
          icon: ListChecks,
          enabled: true,
          badge: activeTaskCount,
        }
      : { id: "tasks", label: "Tasks", icon: ListChecks, enabled: true },
  ]);

  function aggregateStatus(threads: { processStatus: string }[]): string {
    if (threads.length === 0) return "idle";
    if (threads.some((t) => t.processStatus === "error")) return "error";
    if (threads.some((t) => t.processStatus === "working")) return "working";
    if (threads.some((t) => t.processStatus === "initializing"))
      return "initializing";
    return "idle";
  }

  function statusColor(status: string): string {
    switch (status) {
      case "working":
        return "bg-success";
      case "error":
        return "bg-error";
      case "initializing":
        return "bg-warning animate-pulse";
      default:
        return "bg-fg-muted";
    }
  }
</script>

<aside
  class="flex flex-col w-[200px] border-r border-border-default bg-bg-sidebar pt-3"
>
  {#if swarm}
    <div class="px-4 pb-2 flex items-center justify-between">
      <span class="text-[13px] font-semibold text-fg-heading truncate">
        {swarm.name}
      </span>
      <button
        class="interactive flex items-center justify-center w-[22px] h-[22px] rounded-[5px] text-fg-muted"
        title="Workspace actions"
        onclick={(e: MouseEvent) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onOverflowMenu?.(rect.left, rect.bottom + 4);
        }}
      >
        <Ellipsis size={14} />
      </button>
    </div>

    <div class="px-2 flex flex-col gap-0.5">
      {#each navItems as item (item.id)}
        <button
          class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-[12px]
                 {item.enabled
            ? (item.id === 'settings' && activeView === 'settings') ||
              (item.id === 'swarm' &&
                (activeView === 'swarm' || activeView.startsWith('agent'))) ||
              (item.id === 'terminal' && activeView === 'terminal') ||
              (item.id === 'tasks' && activeView === 'tasks')
              ? 'bg-bg-hover text-fg-heading'
              : 'text-fg-muted hover:bg-bg-hover'
            : 'text-fg-disabled cursor-default'}"
          disabled={!item.enabled}
          onclick={() => {
            if (item.enabled) {
              if (item.id === "swarm") onSelectView("swarm");
              else if (item.id === "settings") onSelectView("settings");
              else if (item.id === "terminal") onSelectView("terminal");
              else if (item.id === "tasks") onSelectView("tasks");
            }
          }}
        >
          <item.icon
            size={14}
            class={item.enabled ? "opacity-70" : "opacity-40"}
          />
          <span class="flex-1 text-left">{item.label}</span>
          {#if item.badge !== undefined}
            <span
              class="text-[10px] font-medium text-fg-muted bg-bg-elevated border border-border-default rounded-full px-1.5 min-w-[18px] text-center"
            >
              {item.badge}
            </span>
          {/if}
        </button>
      {/each}
    </div>

    <div
      class="px-4 pt-3 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-muted"
    >
      Agents
    </div>

    <div class="px-2 flex-1 overflow-y-auto min-h-0">
      {#each swarm.agentDefinitions as agentDef (agentDef.id)}
        {@const aggStatus = aggregateStatus(agentDef.threads)}
        <button
          class="flex items-center gap-2 w-full px-2.5 py-[7px] rounded-md text-[12px] mt-0.5 truncate
                 {activeView.startsWith('agent') &&
          selectedAgentId === agentDef.id
            ? 'bg-bg-hover text-fg-heading'
            : 'text-fg-muted hover:bg-bg-hover'}"
          onclick={() => onSelectAgent(agentDef.id)}
        >
          <span
            class="w-[7px] h-[7px] rounded-full flex-shrink-0 {statusColor(
              aggStatus,
            )}"
          ></span>
          <span class="truncate">
            {agentDef.name}{#if agentDef.role}<span class="text-fg-disabled">
                — {agentDef.role}</span
              >{/if}
          </span>
        </button>
      {/each}
      {#if !demoMode && swarm}
        <button
          class="interactive flex items-center gap-1.5 w-full px-2.5 py-[7px] rounded-md text-[11px] text-fg-muted mt-1"
          onclick={onCreateAgent}
        >
          <Plus size={12} />
          Add agent
        </button>
      {/if}
      {#if !containerRunning}
        <div class="px-2.5 pt-2 text-[10px] text-fg-disabled italic">
          Container stopped — start it to spawn threads.
        </div>
      {/if}
    </div>
  {:else}
    <div
      class="flex items-center justify-center flex-1 text-fg-disabled text-[12px]"
    >
      No swarm selected
    </div>
  {/if}
</aside>
