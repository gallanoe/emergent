<script lang="ts">
  import type { DisplayAgent, SwarmMessageLogEntry } from "../stores/types";
  import AgentCard from "./AgentCard.svelte";

  interface Props {
    agents: DisplayAgent[];
    selectedAgentId: string | null;
    agentConnections: Record<string, string[]>;
    messageLog: SwarmMessageLogEntry[];
    onClose: () => void;
  }

  let {
    agents,
    selectedAgentId,
    agentConnections,
    messageLog,
    onClose,
  }: Props = $props();
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

  <!-- Recent Messages log -->
  {#if messageLog.length > 0}
    <div
      class="border-t border-border-default h-[160px] shrink-0 overflow-y-auto px-3 py-2"
    >
      <div
        class="text-[10px] font-semibold text-fg-muted uppercase tracking-[0.03em] mb-1.5"
      >
        Recent Messages
      </div>
      {#each messageLog.toReversed() as entry (entry.id)}
        <div
          class="flex items-baseline gap-[5px] text-[10px] py-0.5 leading-[1.4]"
        >
          <span
            class="text-fg-disabled text-[9px] shrink-0 font-[family-name:var(--font-mono)]"
            >{entry.timestamp}</span
          >
          <span class="text-success font-semibold shrink-0"
            >{entry.fromName}</span
          >
          <span class="text-fg-disabled shrink-0">→</span>
          <span class="text-fg-muted font-medium shrink-0">{entry.toName}</span>
          <span class="text-fg-muted truncate">{entry.preview}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>
