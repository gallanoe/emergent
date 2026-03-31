<!-- src/components/AgentPickerPopover.svelte -->
<script lang="ts">
  import { AGENT_LOGOS } from "../../lib/agent-logos";

  interface KnownAgent {
    name: string;
    command: string;
    available: boolean;
  }

  interface Props {
    agents: KnownAgent[];
    onSelect: (command: string, name: string) => void;
    onClose: () => void;
  }

  let { agents, onSelect, onClose }: Props = $props();

  function handleClick(agent: KnownAgent) {
    if (!agent.available) return;
    onSelect(agent.command, agent.name);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop to catch outside clicks -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-40"
  onclick={onClose}
  onkeydown={handleKeydown}
></div>

<div
  class="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border border-border-strong bg-bg-base shadow-lg"
  role="menu"
>
  <div
    class="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted"
  >
    Add agent
  </div>
  {#each agents as agent (agent.command)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="flex items-center gap-2 mx-1.5 mb-1 px-2 py-1.5 rounded-md
        {agent.available
        ? 'cursor-default hover:bg-bg-hover'
        : 'opacity-40 cursor-not-allowed'}"
      role="menuitem"
      tabindex={agent.available ? 0 : -1}
      data-agent={agent.command}
      data-available={String(agent.available)}
      onclick={() => handleClick(agent)}
    >
      <img src={AGENT_LOGOS[agent.name]} alt="" class="w-5 h-5 shrink-0" />
      <div class="min-w-0">
        <div class="text-[12px] font-medium text-fg-heading truncate">
          {agent.name}
        </div>
        <div
          class="text-[10px] text-fg-muted font-[family-name:var(--font-mono)] truncate"
        >
          {agent.command}
        </div>
      </div>
    </div>
  {/each}
</div>
