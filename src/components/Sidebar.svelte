<!-- src/components/Sidebar.svelte -->
<script lang="ts">
  import { ChevronRight, ChevronDown, Plus } from "@lucide/svelte";
  import type { Swarm } from "../stores/mock-data.svelte";

  interface Props {
    swarms: Swarm[];
    selectedAgentId: string;
    onSelectAgent: (id: string) => void;
    onToggleSwarm: (id: string) => void;
  }

  let { swarms, selectedAgentId, onSelectAgent, onToggleSwarm }: Props =
    $props();
</script>

<aside
  class="flex flex-col h-full bg-bg-sidebar border-r border-border-default"
>
  <!-- App title (padded for macOS traffic lights) -->
  <div
    class="px-4 pt-7 pb-3 border-b border-border-default"
    style="-webkit-app-region: drag"
  >
    <span
      class="text-[13px] font-semibold text-fg-heading font-[family-name:var(--font-ui)]"
      >emergent</span
    >
  </div>

  <!-- Swarm list -->
  <div class="flex-1 overflow-y-auto py-1">
    {#each swarms as swarm (swarm.id)}
      <div class="py-1">
        <!-- Swarm header -->
        <button
          class="interactive flex items-center gap-1 w-full px-4 py-1 text-[11px] font-semibold text-fg-muted"
          onclick={() => onToggleSwarm(swarm.id)}
        >
          {#if swarm.collapsed}
            <ChevronRight size={12} />
          {:else}
            <ChevronDown size={12} />
          {/if}
          {swarm.name}
        </button>

        <!-- Agent list (when expanded) -->
        {#if !swarm.collapsed}
          {#each swarm.agents as agent (agent.id)}
            {@const isSelected = agent.id === selectedAgentId}
            <button
              class="interactive flex flex-col gap-0.5 w-full py-1.5 pl-7 pr-4 text-left
                {isSelected
                ? 'bg-bg-selected border-l-2 border-accent'
                : 'border-l-2 border-transparent'}"
              onclick={() => onSelectAgent(agent.id)}
            >
              <div class="flex items-center gap-1.5 w-full">
                <span
                  class="w-1.5 h-1.5 rounded-full shrink-0
                    {agent.status === 'error' ? 'bg-error' : 'bg-success'}"
                ></span>
                <span
                  class="text-[12px] font-medium {isSelected
                    ? 'text-fg-heading'
                    : 'text-fg-default'}"
                >
                  {agent.status === "working"
                    ? "Working"
                    : agent.status === "completed"
                      ? "Completed"
                      : "Error"}
                </span>
                <span class="text-[11px] text-fg-muted ml-auto shrink-0"
                  >{agent.updatedAt}</span
                >
              </div>
              <div class="text-[11px] text-fg-muted truncate pl-3">
                {agent.preview}
              </div>
            </button>
          {/each}
        {/if}
      </div>
    {/each}
  </div>

  <!-- New swarm button -->
  <button
    class="interactive flex items-center gap-1.5 px-4 py-3 border-t border-border-default text-[11px] text-fg-muted"
  >
    <Plus size={12} />
    New swarm
  </button>
</aside>
