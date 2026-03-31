<script lang="ts">
  import type { DisplaySwarm, SwarmMessageLogEntry } from "../../stores/types";
  import ActivityFeed from "./ActivityFeed.svelte";
  interface Props {
    swarm: DisplaySwarm;
    messageLog: SwarmMessageLogEntry[];
    agentConnections: Record<string, string[]>;
    demoMode: boolean;
    knownAgents: { name: string; command: string; available: boolean }[];
    onSelectAgent: (id: string) => void;
    onAddAgent: (
      swarmId: string,
      agentCommand: string,
      agentName: string,
    ) => void;
  }

  let {
    swarm,
    messageLog,
    agentConnections,
    demoMode,
    knownAgents,
    onSelectAgent,
    onAddAgent,
  }: Props = $props();

  function statusBadgeClass(status: string): string {
    switch (status) {
      case "working":
        return "text-success bg-success/10";
      case "error":
        return "text-error bg-error/10";
      case "initializing":
        return "text-warning bg-warning/10";
      default:
        return "text-fg-muted bg-bg-hover";
    }
  }

  function statusDotClass(status: string): string {
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

<div class="flex flex-col h-full min-h-0">
  <!-- Top bar -->
  <div
    class="flex items-center justify-between h-[38px] px-5 border-b border-border-default flex-shrink-0 relative z-[60]"
  >
    <div class="flex items-center gap-2">
      <span class="text-[13px] font-semibold text-fg-heading">{swarm.name}</span
      >
      <span
        class="text-[10px] text-fg-muted bg-bg-elevated px-2 py-0.5 rounded-full border border-border-default"
      >
        {swarm.agents.length} agent{swarm.agents.length !== 1 ? "s" : ""}
      </span>
    </div>
  </div>

  <!-- Agent cards grid -->
  <div
    class="px-5 py-4 grid gap-2.5 flex-shrink-0"
    style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));"
  >
    {#each swarm.agents as agent (agent.id)}
      <button
        class="text-left bg-bg-elevated border border-border-default rounded-lg p-3.5 hover:border-border-strong transition-colors duration-150"
        onclick={() => onSelectAgent(agent.id)}
      >
        <div class="flex items-center gap-2 mb-2.5">
          <div
            class="w-7 h-7 bg-bg-hover rounded-md flex items-center justify-center text-fg-muted font-semibold text-[11px]"
          >
            {agent.name.charAt(0).toUpperCase()}
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-[12px] font-medium text-fg-heading truncate">
              {agent.name}
            </div>
            {#if agent.role}
              <div class="text-[10px] text-fg-muted truncate">
                {agent.role}
              </div>
            {/if}
          </div>
          <span
            class="w-[7px] h-[7px] rounded-full flex-shrink-0 {statusDotClass(
              agent.status,
            )}"
          ></span>
        </div>
        <div class="text-[10px] text-fg-muted leading-snug mb-2.5 line-clamp-2">
          {agent.preview || "Idle"}
        </div>
        <div class="flex gap-1 flex-wrap">
          <span
            class="text-[9px] px-1.5 py-0.5 rounded {statusBadgeClass(
              agent.status,
            )}">{agent.status}</span
          >
          {#if agentConnections[agent.id]?.length}
            {@const conns = agentConnections[agent.id]!}
            <span
              class="text-[9px] text-fg-muted bg-bg-hover px-1.5 py-0.5 rounded"
            >
              {conns.length} connection{conns.length !== 1 ? "s" : ""}
            </span>
          {/if}
        </div>
      </button>
    {/each}
  </div>

  <!-- Activity feed -->
  <ActivityFeed entries={messageLog} />
</div>
