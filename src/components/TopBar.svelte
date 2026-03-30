<script lang="ts">
  import { Pencil, Settings, Power } from "@lucide/svelte";
  import type { DisplayAgent } from "../stores/types";
  import SettingsPopover from "./SettingsPopover.svelte";

  interface Props {
    agent: DisplayAgent | undefined;
    allAgents: DisplayAgent[];
    connections: string[];
    onShutdown?: () => void;
    onConnect?: (agentId: string) => void;
    onDisconnect?: (agentId: string) => void;
    onSetPermissions?: (enabled: boolean) => void;
  }

  let {
    agent,
    allAgents = [],
    connections = [],
    onShutdown,
    onConnect,
    onDisconnect,
    onSetPermissions,
  }: Props = $props();

  let settingsOpen = $state(false);
</script>

<header
  class="flex items-center h-[38px] px-4 border-b border-border-default bg-bg-base gap-3 relative z-[60]"
>
  <div class="flex items-center gap-1.5 flex-1 min-w-0">
    <h1
      class="text-[13px] font-medium text-fg-heading truncate font-[family-name:var(--font-ui)]"
    >
      {agent?.name ?? "No agent selected"}
    </h1>
    {#if agent}
      <button
        class="flex items-center justify-center w-[22px] h-[22px] rounded text-fg-disabled opacity-50 pointer-events-none"
        title="Rename (coming soon)"
      >
        <Pencil size={12} />
      </button>
    {/if}
  </div>
  {#if agent}
    <div class="relative z-[60] flex items-center gap-0.5 shrink-0">
      <div class="relative">
        <button
          class="interactive flex items-center gap-[5px] h-[26px] px-2 rounded text-[11px] font-medium text-fg-muted"
          onclick={(e) => {
            e.stopPropagation();
            settingsOpen = !settingsOpen;
          }}
        >
          <Settings size={13} />
          Settings
        </button>
        {#if settingsOpen && agent}
          <SettingsPopover
            {agent}
            {connections}
            {allAgents}
            onConnect={(id) => onConnect?.(id)}
            onDisconnect={(id) => onDisconnect?.(id)}
            onSetPermissions={(enabled) => onSetPermissions?.(enabled)}
            onClose={() => (settingsOpen = false)}
          />
        {/if}
      </div>
      <div class="w-px h-3.5 bg-border-default mx-1"></div>
      <button
        class="flex items-center gap-[5px] h-6 px-2 rounded text-[11px] font-medium text-white bg-error hover:bg-[#b33535] transition-colors duration-100"
        onclick={() => onShutdown?.()}
      >
        <Power size={13} />
        Shutdown
      </button>
    </div>
  {/if}
</header>
