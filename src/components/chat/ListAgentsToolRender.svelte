<script lang="ts">
  import type { EmergentAgentSummary } from "../../lib/emergent-tool-calls";

  interface Props {
    agents: EmergentAgentSummary[];
  }

  let { agents }: Props = $props();
</script>

<div class="py-1.5 flex flex-col gap-1 px-2.5">
  {#if agents.length === 0}
    <div
      class="rounded bg-[rgba(0,0,0,0.03)] px-2 py-1.5 text-[11px] text-fg-muted"
    >
      No agents available
    </div>
  {:else}
    {#each agents as agent}
      <div
        class="flex items-center gap-2 rounded bg-[rgba(0,0,0,0.03)] px-2 py-1.5"
      >
        <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success"></span>
        <span class="min-w-0 truncate text-[11px] font-medium text-fg-default"
          >{agent.name}</span
        >
        <span
          class="ml-auto text-[9px] font-[family-name:var(--font-mono)] text-fg-disabled"
        >
          {agent.id}
        </span>
      </div>
    {/each}
  {/if}
</div>
