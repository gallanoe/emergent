<script lang="ts">
  import type { DisplaySwarm } from "../stores/types";
  import ThemeToggle from "./ThemeToggle.svelte";

  interface Props {
    swarms: DisplaySwarm[];
    selectedSwarmId: string | null;
    demoMode: boolean;
    onSelectSwarm: (id: string) => void;
    onNewSwarm: () => void;
  }

  let { swarms, selectedSwarmId, demoMode, onSelectSwarm, onNewSwarm }: Props =
    $props();
</script>

<nav
  class="flex flex-col items-center w-[56px] border-r border-border-default
         bg-bg-sidebar py-3 gap-2 pt-[50px]"
>
  {#each swarms as swarm (swarm.id)}
    <button
      class="flex items-center justify-center w-[36px] h-[36px] rounded-[10px]
             font-semibold text-[13px] transition-colors duration-150
             {swarm.id === selectedSwarmId
        ? 'bg-accent text-white shadow-[0_0_0_2px_rgba(167,139,250,0.27)]'
        : 'bg-bg-elevated text-fg-muted border border-border-default hover:bg-bg-hover'}"
      title={swarm.name}
      onclick={() => onSelectSwarm(swarm.id)}
    >
      {swarm.name.charAt(0).toUpperCase()}
    </button>
  {/each}

  <div class="flex-1"></div>

  {#if !demoMode}
    <button
      class="interactive flex items-center justify-center w-[36px] h-[36px] rounded-[10px]
             bg-bg-elevated text-fg-muted border border-border-default text-[16px]"
      title="New swarm"
      onclick={onNewSwarm}
    >
      +
    </button>
  {/if}

  <div class="w-6 h-px bg-border-default"></div>

  <ThemeToggle />
</nav>
