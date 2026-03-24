<script lang="ts">
  import type { DisplayAgent } from "../stores/types";
  import AgentCard from "./AgentCard.svelte";

  interface Props {
    agents: DisplayAgent[];
    selectedAgentId: string | null;
    agentConnections: Record<string, string[]>;
    onClose: () => void;
  }

  let { agents, selectedAgentId, agentConnections, onClose }: Props = $props();
</script>

<div
  class="border-l border-border-default flex flex-col min-h-0 overflow-hidden bg-bg-base"
>
  <div
    class="h-[38px] px-3 border-b border-border-default flex items-center justify-between text-[12px] font-semibold text-fg-heading shrink-0"
  >
    <span>Swarm</span>
    <button
      class="text-[11px] text-fg-muted px-1.5 py-1 rounded hover:bg-bg-hover cursor-default"
      onclick={onClose}>✕</button
    >
  </div>

  <div class="flex-1 overflow-y-auto p-2.5 flex flex-col gap-1.5 min-h-0">
    {#each agents as agent (agent.id)}
      <AgentCard
        {agent}
        connections={agentConnections[agent.id] ?? []}
        allAgents={agents}
        isCurrent={agent.id === selectedAgentId}
      />
    {/each}
  </div>
</div>
