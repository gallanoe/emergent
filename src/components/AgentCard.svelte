<script lang="ts">
  import type { DisplayAgent } from "../stores/types";

  interface Props {
    agent: DisplayAgent;
    connections: string[];
    allAgents: DisplayAgent[];
    isCurrent: boolean;
  }

  let { agent, connections, allAgents, isCurrent }: Props = $props();
  let connectionsExpanded = $state(false);
  // Only count connections that resolve to known agents
  let resolvedConnections = $derived(
    connections.filter((id) => allAgents.some((a) => a.id === id)),
  );
</script>

<div
  class="border rounded-[6px] px-2.5 py-2 cursor-default {isCurrent
    ? 'border-accent bg-bg-selected'
    : 'border-border-default'} {connections.length === 0 ? 'opacity-60' : ''}"
>
  <div class="flex items-center gap-1.5 mb-1">
    <span
      class="w-1.5 h-1.5 rounded-full shrink-0 {agent.status === 'working'
        ? 'bg-success'
        : agent.status === 'initializing'
          ? 'bg-warning animate-pulse'
          : agent.status === 'error'
            ? 'bg-error'
            : 'bg-fg-muted'}"
    ></span>
    <span class="text-[11px] font-semibold text-fg-heading">{agent.name}</span>
    <span
      class="text-[10px] ml-auto px-1.5 rounded-[3px] {agent.status ===
      'working'
        ? 'bg-[rgba(45,140,80,0.1)] text-success'
        : 'bg-bg-elevated text-fg-muted'}">{agent.status}</span
    >
  </div>
  <div class="text-[10px] text-fg-muted mb-1.5 truncate">
    {agent.preview || "Idle"}
  </div>

  <!-- Connection count + collapsible list -->
  <div class="flex items-center gap-1.5 text-[10px]">
    {#if resolvedConnections.length > 0}
      <span
        class="px-[7px] py-0.5 rounded-[3px] bg-[rgba(45,140,80,0.08)] text-success font-semibold"
        >{resolvedConnections.length}</span
      >
      <button
        class="text-fg-muted flex items-center gap-0.5 cursor-default hover:text-fg-default"
        onclick={() => (connectionsExpanded = !connectionsExpanded)}
      >
        connections
        <svg
          class="w-2.5 h-2.5 transition-transform {connectionsExpanded
            ? 'rotate-180'
            : ''}"
          viewBox="0 0 16 16"
          fill="currentColor"><path d="M4 6l4 4 4-4" /></svg
        >
      </button>
    {:else}
      <span
        class="px-[7px] py-0.5 rounded-[3px] bg-bg-elevated text-fg-disabled font-semibold"
        >0</span
      >
      <span class="text-fg-disabled">connections</span>
    {/if}
  </div>

  {#if connectionsExpanded}
    <div class="mt-1.5 flex flex-col gap-0.5 pl-0.5">
      {#each resolvedConnections as connId}
        {@const peer = allAgents.find((a) => a.id === connId)}
        {#if peer}
          <div
            class="flex items-center gap-1.5 text-[10px] px-1 py-0.5 rounded-[3px] hover:bg-bg-hover"
          >
            <span
              class="w-[5px] h-[5px] rounded-full {peer.status === 'working'
                ? 'bg-success'
                : 'bg-fg-muted'}"
            ></span>
            <span class="text-fg-default font-medium">{peer.name}</span>
            <span class="text-fg-disabled ml-auto text-[9px]"
              >{peer.status}</span
            >
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>
