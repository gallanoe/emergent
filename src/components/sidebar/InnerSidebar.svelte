<script lang="ts">
  import type { DisplayWorkspace } from "../../stores/types";
  import {
    LayoutGrid,
    Settings,
    Sparkles,
    ListChecks,
    Plus,
  } from "@lucide/svelte";
  import type { Component } from "svelte";
  import AgentPickerPopover from "./AgentPickerPopover.svelte";

  interface Props {
    swarm: DisplayWorkspace | undefined;
    activeView: "swarm" | "agent" | "settings";
    selectedAgentId: string | null;
    demoMode: boolean;
    knownAgents: { name: string; command: string; available: boolean }[];
    onSelectView: (view: "swarm" | "settings") => void;
    onSelectAgent: (id: string) => void;
    onAddAgent: (
      swarmId: string,
      agentCommand: string,
      agentName: string,
    ) => void;
  }

  let {
    swarm,
    activeView,
    selectedAgentId,
    demoMode,
    knownAgents,
    onSelectView,
    onSelectAgent,
    onAddAgent,
  }: Props = $props();

  let pickerOpen = $state(false);

  const navItems: {
    id: string;
    label: string;
    icon: Component;
    enabled: boolean;
  }[] = [
    { id: "swarm", label: "Swarm", icon: LayoutGrid, enabled: true },
    { id: "settings", label: "Settings", icon: Settings, enabled: true },
    { id: "skills", label: "Skills", icon: Sparkles, enabled: false },
    { id: "tasks", label: "Tasks", icon: ListChecks, enabled: false },
  ];

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
    <div class="px-4 pb-2 text-[13px] font-semibold text-fg-heading truncate">
      {swarm.name}
    </div>

    <div class="px-2 flex flex-col gap-0.5">
      {#each navItems as item (item.id)}
        <button
          class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-[12px]
                 {item.enabled
            ? (item.id === 'settings' && activeView === 'settings') ||
              (item.id === 'swarm' &&
                (activeView === 'swarm' || activeView === 'agent'))
              ? 'bg-bg-hover text-fg-heading'
              : 'text-fg-muted hover:bg-bg-hover'
            : 'text-fg-disabled cursor-default'}"
          disabled={!item.enabled}
          onclick={() => {
            if (item.enabled) {
              if (item.id === "swarm") onSelectView("swarm");
              else if (item.id === "settings") onSelectView("settings");
            }
          }}
        >
          <item.icon
            size={14}
            class={item.enabled ? "opacity-70" : "opacity-40"}
          />
          {item.label}
        </button>
      {/each}
    </div>

    <div
      class="px-4 pt-3 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-muted"
    >
      Agents
    </div>

    <div class="px-2 flex-1 overflow-y-auto min-h-0">
      {#if swarm.containerStatus.state !== "running"}
        <div class="px-2.5 py-2 text-[11px] text-fg-disabled">
          Workspace isn't available
        </div>
      {:else}
        {#each swarm.agents as agent (agent.id)}
          <button
            class="flex items-center gap-2 w-full px-2.5 py-[7px] rounded-md text-[12px] mt-0.5 truncate
                   {activeView === 'agent' && selectedAgentId === agent.id
              ? 'bg-bg-hover text-fg-heading'
              : 'text-fg-muted hover:bg-bg-hover'}"
            onclick={() => onSelectAgent(agent.id)}
          >
            <span
              class="w-[7px] h-[7px] rounded-full flex-shrink-0 {statusColor(
                agent.status,
              )}"
            ></span>
            <span class="truncate">
              {agent.name}{#if agent.role}<span class="text-fg-disabled">
                  — {agent.role}</span
                >{/if}
            </span>
          </button>
        {/each}
        {#if !demoMode && swarm}
          <div class="relative mt-1">
            <button
              class="interactive flex items-center gap-1.5 w-full px-2.5 py-[7px] rounded-md text-[11px] text-fg-muted"
              onclick={() => (pickerOpen = !pickerOpen)}
            >
              <Plus size={12} />
              Add agent
            </button>
            {#if pickerOpen}
              <AgentPickerPopover
                agents={knownAgents}
                onSelect={(command, name) => {
                  onAddAgent(swarm.id, command, name);
                  pickerOpen = false;
                }}
                onClose={() => (pickerOpen = false)}
              />
            {/if}
          </div>
        {/if}
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
