<script lang="ts">
  import type { DisplayAgent } from "../stores/types";

  interface Props {
    agent: DisplayAgent;
    connections: string[];
    allAgents: DisplayAgent[];
    onConnect: (agentId: string) => void;
    onDisconnect: (agentId: string) => void;
    onSetPermissions: (enabled: boolean) => void;
    onClose: () => void;
  }

  let {
    agent,
    connections,
    allAgents,
    onConnect,
    onDisconnect,
    onSetPermissions,
    onClose,
  }: Props = $props();

  let managementEnabled = $derived(agent.hasManagementPermissions);
  let showConnectDropdown = $state(false);

  let unconnectedAgents = $derived(
    allAgents.filter((a) => a.id !== agent.id && !connections.includes(a.id)),
  );

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest("[data-settings-popover]")) {
      onClose();
    }
  }
</script>

<svelte:document onclick={handleClickOutside} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  data-settings-popover
  class="absolute top-8 right-0 z-10 w-[280px] bg-bg-base border border-border-strong rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.1),0_1px_4px_rgba(0,0,0,0.06)] py-3"
  onclick={(e) => e.stopPropagation()}
>
  <!-- Permissions -->
  <div class="px-3.5">
    <div
      class="text-[10px] font-semibold text-fg-muted uppercase tracking-[0.03em] mb-2"
    >
      Permissions
    </div>
    <div class="flex items-center justify-between py-1">
      <div class="flex flex-col">
        <span class="text-[11px] text-fg-default">Management permissions</span>
        <span class="text-[10px] text-fg-muted"
          >Spawn, kill, and connect agents</span
        >
      </div>
      <button
        aria-label="Toggle management permissions"
        class="w-8 h-[18px] rounded-[9px] relative cursor-default transition-colors {managementEnabled
          ? 'bg-success'
          : 'bg-bg-active'}"
        onclick={() => {
          onSetPermissions(!managementEnabled);
        }}
      >
        <div
          class="w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.15)] transition-[left] {managementEnabled
            ? 'left-4'
            : 'left-0.5'}"
        ></div>
      </button>
    </div>
  </div>

  <!-- Connections -->
  <div class="px-3.5 mt-2.5 pt-2.5 border-t border-border-default">
    <div
      class="text-[10px] font-semibold text-fg-muted uppercase tracking-[0.03em] mb-2"
    >
      Connections
    </div>
    {#each connections as connId}
      {@const connAgent = allAgents.find((a) => a.id === connId)}
      {#if connAgent}
        <div class="flex items-center gap-1.5 py-1 text-[11px]">
          <span
            class="w-1.5 h-1.5 rounded-full shrink-0 {connAgent.status ===
            'working'
              ? 'bg-success'
              : 'bg-fg-muted'}"
          ></span>
          <span class="font-medium text-fg-default">{connAgent.name}</span>
          <button
            class="ml-auto text-[10px] text-fg-disabled hover:text-error hover:bg-[rgba(200,60,60,0.06)] px-1 rounded cursor-default"
            onclick={() => onDisconnect(connId)}
          >
            ✕
          </button>
        </div>
      {/if}
    {/each}

    {#if showConnectDropdown && unconnectedAgents.length > 0}
      <div class="mt-1 border border-border-default rounded bg-bg-base">
        {#each unconnectedAgents as ua}
          <button
            class="w-full text-left px-2 py-1 text-[11px] text-fg-default hover:bg-bg-hover cursor-default"
            onclick={() => {
              onConnect(ua.id);
              showConnectDropdown = false;
            }}
          >
            {ua.name}
          </button>
        {/each}
      </div>
    {/if}

    <button
      class="text-[10px] text-accent mt-0.5 cursor-default hover:bg-accent-soft rounded px-0 py-0.5"
      onclick={() => (showConnectDropdown = !showConnectDropdown)}
    >
      + Connect agent
    </button>
  </div>

  <!-- Info -->
  <div class="px-3.5 mt-2.5 pt-2.5 border-t border-border-default">
    <div
      class="text-[10px] font-semibold text-fg-muted uppercase tracking-[0.03em] mb-2"
    >
      Agent
    </div>
    <div class="flex items-center justify-between py-1">
      <span class="text-[11px] text-fg-default">Binary</span>
      <span
        class="text-[11px] text-fg-muted font-[family-name:var(--font-mono)]"
        >{agent.cli}</span
      >
    </div>
  </div>
</div>
