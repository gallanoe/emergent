<script lang="ts">
  import { AgentAvatar, Chip, StatusDot } from "../../lib/primitives";
  import type { EmergentAgentSummary } from "../../lib/emergent-tool-calls";

  interface Props {
    agents: EmergentAgentSummary[];
  }

  let { agents }: Props = $props();

  // EmergentAgentSummary carries only {id, name}; provider and live
  // status aren't in this payload. We render with provider=null (falls
  // back to monogram via AgentAvatar) and status="idle" as neutral
  // defaults. Wiring richer data would require backend changes; tracked
  // separately.
</script>

<div class="flex flex-col gap-1" style:padding="8px 10px 10px 32px">
  {#if agents.length === 0}
    <div class="text-[11px] text-fg-muted">No agents available</div>
  {:else}
    {#each agents as agent (agent.id)}
      <div
        class="grid items-center gap-2"
        style:grid-template-columns="auto 1fr auto"
      >
        <AgentAvatar provider={null} name={agent.name} size={20} />
        <span class="text-[12px] text-fg-default truncate">{agent.name}</span>
        <Chip tone="mono">
          {#snippet icon()}
            <StatusDot status="idle" size={5} />
          {/snippet}
          ready
        </Chip>
      </div>
    {/each}
  {/if}
</div>
