<!-- src/components/AgentPickerPopover.svelte -->
<script lang="ts">
  interface KnownAgent {
    name: string;
    binary: string;
    available: boolean;
  }

  interface Props {
    agents: KnownAgent[];
    onSelect: (binary: string) => void;
    onClose: () => void;
  }

  let { agents, onSelect, onClose }: Props = $props();

  function handleClick(agent: KnownAgent) {
    if (!agent.available) return;
    onSelect(agent.binary);
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
  {#each agents as agent (agent.binary)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="flex items-center gap-2 mx-1.5 mb-1 px-2 py-1.5 rounded-md
        {agent.available
        ? 'cursor-default hover:bg-bg-hover'
        : 'opacity-40 cursor-not-allowed'}"
      role="menuitem"
      tabindex={agent.available ? 0 : -1}
      data-agent={agent.binary}
      data-available={String(agent.available)}
      onclick={() => handleClick(agent)}
    >
      <div
        class="flex items-center justify-center w-[22px] h-[22px] rounded-md text-[11px] font-semibold shrink-0
          {agent.binary === 'claude-agent-acp'
          ? 'bg-[#e8ddd0] text-accent'
          : 'bg-[#d4e4d9] text-[#2d6e46]'}"
      >
        {agent.binary === "claude-agent-acp" ? "C" : "X"}
      </div>
      <div class="min-w-0">
        <div class="text-[12px] font-medium text-fg-heading truncate">
          {agent.name}
        </div>
        <div
          class="text-[10px] text-fg-muted font-[family-name:var(--font-mono)] truncate"
        >
          {agent.binary}
        </div>
      </div>
    </div>
  {/each}
</div>
