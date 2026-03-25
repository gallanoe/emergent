<!-- src/components/Sidebar.svelte -->
<script lang="ts">
  import { ChevronRight, ChevronDown, Plus } from "@lucide/svelte";
  import AgentPickerPopover from "./AgentPickerPopover.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import claudeLogo from "../assets/claude.svg";
  import openaiLogo from "../assets/openai.svg";
  import geminiLogo from "../assets/gemini.svg";
  import kiroLogo from "../assets/kiro.svg";
  import opencodeLogo from "../assets/opencode.svg";
  import type { DisplaySwarm } from "../stores/types";

  const AGENT_LOGOS: Record<string, string> = {
    "claude-agent-acp": claudeLogo,
    "codex-acp": openaiLogo,
    "gemini --experimental-acp": geminiLogo,
    "kiro-cli acp": kiroLogo,
    "opencode acp": opencodeLogo,
  };

  type DaemonStatus =
    | "starting"
    | "launch_error"
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting";

  interface Props {
    swarms: DisplaySwarm[];
    selectedAgentId: string | null;
    demoMode: boolean;
    daemonStatus: DaemonStatus;
    knownAgents: { name: string; command: string; available: boolean }[];
    onSelectAgent: (id: string) => void;
    onToggleSwarm: (id: string) => void;
    onNewSwarm: () => void;
    onAddAgent: (swarmId: string, agentCommand: string) => void;
    onKillAgent?: (agentId: string) => void;
  }

  let {
    swarms,
    selectedAgentId,
    demoMode,
    daemonStatus,
    knownAgents,
    onSelectAgent,
    onToggleSwarm,
    onNewSwarm,
    onAddAgent,
    onKillAgent,
  }: Props = $props();

  let isDaemonConnected = $derived(daemonStatus === "connected");

  let pickerSwarmId = $state<string | null>(null);
  let contextMenu = $state<{
    x: number;
    y: number;
    agentId: string;
  } | null>(null);
</script>

<aside
  class="flex flex-col h-full bg-bg-sidebar border-r border-border-default"
>
  <!-- App title (inline with macOS traffic lights) -->
  <div
    class="flex items-center justify-end h-[38px] px-4 border-b border-border-default"
  >
    <span
      class="text-[13px] font-semibold text-fg-heading font-[family-name:var(--font-ui)]"
      >emergent</span
    >
  </div>

  <!-- Swarm list -->
  <div class="flex-1 overflow-y-auto">
    {#each swarms as swarm (swarm.id)}
      <div>
        <!-- Swarm header -->
        <div class="flex items-stretch">
          <button
            class="interactive flex items-center gap-1 flex-1 pl-4 py-1 text-[11px] font-semibold text-fg-muted"
            onclick={() => onToggleSwarm(swarm.id)}
          >
            {#if swarm.collapsed}
              <ChevronRight size={12} />
            {:else}
              <ChevronDown size={12} />
            {/if}
            {swarm.name}
          </button>
          {#if !demoMode && isDaemonConnected}
            <div class="relative flex">
              <button
                class="interactive flex items-center justify-center w-7 text-fg-muted hover:text-fg-default"
                onclick={() => {
                  pickerSwarmId = pickerSwarmId === swarm.id ? null : swarm.id;
                }}
                title="Add agent"
              >
                <Plus size={10} />
              </button>
              {#if pickerSwarmId === swarm.id}
                <AgentPickerPopover
                  agents={knownAgents}
                  onSelect={(command) => {
                    onAddAgent(swarm.id, command);
                    pickerSwarmId = null;
                  }}
                  onClose={() => {
                    pickerSwarmId = null;
                  }}
                />
              {/if}
            </div>
          {/if}
        </div>

        <!-- Agent list (when expanded) -->
        {#if !swarm.collapsed}
          {#each swarm.agents as agent (agent.id)}
            {@const isSelected = agent.id === selectedAgentId}
            <button
              class="interactive flex items-center w-full py-1.5 pl-5 pr-3 text-left
                {isSelected
                ? 'bg-bg-selected border-l-2 border-accent'
                : 'border-l-2 border-transparent'}"
              onclick={() => onSelectAgent(agent.id)}
              oncontextmenu={(e) => {
                e.preventDefault();
                contextMenu = {
                  x: e.clientX,
                  y: e.clientY,
                  agentId: agent.id,
                };
              }}
            >
              <div class="flex flex-col gap-0.5 flex-1 min-w-0">
                <div class="flex items-center gap-1.5 w-full">
                  <span
                    class="w-1.5 h-1.5 rounded-full shrink-0
                      {agent.status === 'error'
                      ? 'bg-error'
                      : agent.status === 'initializing'
                        ? 'bg-warning animate-pulse'
                        : agent.status === 'working'
                          ? 'bg-success'
                          : 'bg-fg-muted'}"
                  ></span>
                  <span
                    class="text-[12px] font-medium truncate {isSelected
                      ? 'text-fg-heading'
                      : 'text-fg-default'}"
                  >
                    {agent.name}
                  </span>
                  <span class="text-[11px] text-fg-muted ml-auto shrink-0"
                    >{agent.updatedAt}</span
                  >
                </div>
                <div class="text-[11px] text-fg-muted truncate pl-3">
                  {agent.preview}
                </div>
              </div>
              {#if AGENT_LOGOS[agent.cli]}
                <img
                  src={AGENT_LOGOS[agent.cli]}
                  alt=""
                  class="w-3.5 h-3.5 shrink-0 ml-2 opacity-50"
                />
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    {/each}

    {#if contextMenu}
      <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        items={[
          { id: "rename", label: "Rename", disabled: true },
          { id: "sep", label: "", separator: true },
          {
            id: "shutdown",
            label: "Shutdown",
            danger: true,
            shortcut: "⌫",
          },
        ]}
        onSelect={(id) => {
          if (id === "shutdown" && contextMenu) {
            onKillAgent?.(contextMenu.agentId);
          }
          contextMenu = null;
        }}
        onClose={() => {
          contextMenu = null;
        }}
      />
    {/if}
  </div>

  <!-- Footer: New swarm button + daemon status -->
  {#if !demoMode}
    <div class="border-t border-border-default flex flex-col">
      <button
        class="interactive flex items-center gap-1.5 px-4 py-2.5 text-[11px] text-fg-muted
          {isDaemonConnected ? '' : 'opacity-45 pointer-events-none'}"
        onclick={onNewSwarm}
        disabled={!isDaemonConnected}
      >
        <Plus size={12} />
        New swarm
      </button>
      <div
        class="flex items-center gap-1.5 px-4 py-2 border-t border-border-default text-[11px]"
      >
        <span
          class="w-[5px] h-[5px] rounded-full shrink-0
            {daemonStatus === 'connected'
            ? 'bg-success'
            : daemonStatus === 'disconnected'
              ? 'bg-error'
              : 'bg-warning animate-pulse'}"
        ></span>
        <span
          class={daemonStatus === "connected"
            ? "text-fg-muted"
            : daemonStatus === "disconnected"
              ? "text-error"
              : "text-warning"}
        >
          {#if daemonStatus === "connected"}
            Daemon connected
          {:else if daemonStatus === "disconnected"}
            Daemon offline
          {:else if daemonStatus === "connecting"}
            Connecting…
          {:else}
            Reconnecting…
          {/if}
        </span>
      </div>
    </div>
  {/if}
</aside>
