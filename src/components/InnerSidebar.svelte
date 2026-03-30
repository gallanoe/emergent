<script lang="ts">
  import type { DisplaySwarm } from "../stores/types";

  interface Props {
    swarm: DisplaySwarm | undefined;
    activeView: "swarm" | "agent";
    selectedAgentId: string | null;
    onSelectView: (view: "swarm" | "agent") => void;
    onSelectAgent: (id: string) => void;
  }

  let {
    swarm,
    activeView,
    selectedAgentId,
    onSelectView,
    onSelectAgent,
  }: Props = $props();

  const navItems = [
    { id: "swarm", label: "Swarm", icon: "◻", enabled: true },
    { id: "settings", label: "Settings", icon: "⚙", enabled: false },
    { id: "skills", label: "Skills", icon: "✦", enabled: false },
    { id: "tasks", label: "Tasks", icon: "☐", enabled: false },
  ] as const;

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
  class="flex flex-col w-[200px] border-r border-border-default bg-bg-sidebar pt-[50px]"
>
  {#if swarm}
    <div class="px-4 pb-2 text-[13px] font-semibold text-fg-heading truncate">
      {swarm.name}
    </div>

    <div class="px-2">
      {#each navItems as item (item.id)}
        <button
          class="flex items-center gap-2 w-full px-2.5 py-[7px] rounded-md text-[12px] mt-0.5
                 {item.enabled
            ? activeView === 'swarm' && item.id === 'swarm'
              ? 'bg-bg-hover text-fg-heading'
              : 'text-fg-muted hover:bg-bg-hover'
            : 'text-fg-disabled cursor-default'}"
          disabled={!item.enabled}
          onclick={() => {
            if (item.enabled && item.id === "swarm") onSelectView("swarm");
          }}
        >
          <span class={item.enabled ? "opacity-70" : "opacity-40"}
            >{item.icon}</span
          >
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
    </div>
  {:else}
    <div
      class="flex items-center justify-center flex-1 text-fg-disabled text-[12px]"
    >
      No swarm selected
    </div>
  {/if}
</aside>
