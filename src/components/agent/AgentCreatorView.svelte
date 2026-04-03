<script lang="ts">
  import { AGENT_LOGOS } from "../../lib/agent-logos";
  import { ChevronDown } from "@lucide/svelte";

  interface KnownAgent {
    name: string;
    command: string;
    available: boolean;
  }

  interface Props {
    knownAgents: KnownAgent[];
    onCreate: (cli: string, name: string, role: string | undefined) => void;
    onCancel: () => void;
  }

  let { knownAgents, onCreate, onCancel }: Props = $props();

  const initialCli = knownAgents.find((a) => a.available)?.command ?? "";
  let selectedCli = $state(initialCli);
  let name = $state("");
  let role = $state("");
  let dropdownOpen = $state(false);

  const selectedAgent = $derived(
    knownAgents.find((a) => a.command === selectedCli),
  );
  const canCreate = $derived(name.trim().length > 0 && selectedCli.length > 0);

  function handleCreate() {
    if (!canCreate) return;
    onCreate(selectedCli, name.trim(), role.trim() || undefined);
  }

  function selectCli(agent: KnownAgent) {
    if (!agent.available) return;
    selectedCli = agent.command;
    dropdownOpen = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      if (dropdownOpen) {
        dropdownOpen = false;
      } else {
        onCancel();
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex flex-col min-h-0 flex-1">
  <!-- Top bar -->
  <div
    class="flex items-center h-[38px] px-5 border-b border-border-default flex-shrink-0 relative z-[60]"
  >
    <span class="text-[13px] font-semibold text-fg-heading">New Agent</span>
  </div>

  <!-- Centered form -->
  <div class="flex-1 flex items-center justify-center overflow-y-auto p-8">
    <div class="w-full max-w-[420px] flex flex-col gap-5">
      <!-- CLI dropdown -->
      <div class="flex flex-col gap-1.5">
        <label class="text-[11px] font-medium text-fg-muted" for="agent-cli"
          >CLI</label
        >
        <div class="relative">
          <button
            id="agent-cli"
            class="flex items-center gap-2 w-full bg-bg-elevated border border-border-default rounded-md px-2.5 py-[7px] text-[12px] text-fg-default font-[var(--font-ui)] focus:outline-none focus:border-border-focus"
            onclick={() => (dropdownOpen = !dropdownOpen)}
          >
            {#if selectedAgent}
              {#if AGENT_LOGOS[selectedAgent.name]}
                <img
                  src={AGENT_LOGOS[selectedAgent.name]}
                  alt=""
                  class="w-[18px] h-[18px] rounded flex-shrink-0"
                />
              {:else}
                <span
                  class="w-[18px] h-[18px] rounded bg-bg-hover flex items-center justify-center text-[10px] font-semibold text-fg-muted flex-shrink-0"
                  >{selectedAgent.name.charAt(0)}</span
                >
              {/if}
              <span class="flex-1 text-left flex items-center gap-1.5">
                <span class="text-fg-heading">{selectedAgent.name}</span>
                <span
                  class="text-[10px] text-fg-disabled font-[family-name:var(--font-mono)]"
                  >{selectedAgent.command}</span
                >
              </span>
            {:else}
              <span class="flex-1 text-left text-fg-disabled"
                >No CLI available</span
              >
            {/if}
            <ChevronDown
              size={12}
              class="text-fg-disabled flex-shrink-0 transition-transform {dropdownOpen
                ? 'rotate-180'
                : ''}"
            />
          </button>

          {#if dropdownOpen}
            <!-- Backdrop -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="fixed inset-0 z-40"
              onclick={() => (dropdownOpen = false)}
              onkeydown={() => {}}
            ></div>
            <div
              class="absolute top-[calc(100%+4px)] left-0 right-0 z-50 bg-bg-elevated border border-border-strong rounded-lg p-1 shadow-lg"
            >
              {#each knownAgents as agent (agent.command)}
                <button
                  class="flex items-center gap-2 w-full px-2 py-[7px] rounded-md text-[12px]
                    {agent.available
                    ? agent.command === selectedCli
                      ? 'bg-bg-hover'
                      : 'hover:bg-bg-hover'
                    : 'opacity-35 cursor-not-allowed'}"
                  disabled={!agent.available}
                  onclick={() => selectCli(agent)}
                >
                  {#if AGENT_LOGOS[agent.name]}
                    <img
                      src={AGENT_LOGOS[agent.name]}
                      alt=""
                      class="w-[18px] h-[18px] rounded flex-shrink-0"
                    />
                  {:else}
                    <span
                      class="w-[18px] h-[18px] rounded bg-bg-hover flex items-center justify-center text-[10px] font-semibold text-fg-muted flex-shrink-0"
                      >{agent.name.charAt(0)}</span
                    >
                  {/if}
                  <div class="flex-1 text-left">
                    <div class="text-fg-heading font-medium">{agent.name}</div>
                    <div
                      class="text-[10px] text-fg-muted font-[family-name:var(--font-mono)]"
                    >
                      {agent.command}
                    </div>
                    {#if !agent.available}
                      <div class="text-[10px] text-fg-disabled italic">
                        not installed
                      </div>
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <!-- Name -->
      <div class="flex flex-col gap-1.5">
        <label class="text-[11px] font-medium text-fg-muted" for="agent-name"
          >Name</label
        >
        <input
          id="agent-name"
          type="text"
          class="bg-bg-elevated border border-border-default rounded-md px-2.5 py-[7px] text-[12px] text-fg-default font-[var(--font-ui)] w-full focus:outline-none focus:border-border-focus"
          placeholder="e.g. Code Reviewer, Test Writer"
          bind:value={name}
        />
      </div>

      <!-- Role -->
      <div class="flex flex-col gap-1.5">
        <label class="text-[11px] font-medium text-fg-muted" for="agent-role">
          Role
          <span class="font-normal text-fg-disabled">(optional)</span>
        </label>
        <textarea
          id="agent-role"
          class="bg-bg-elevated border border-border-default rounded-md px-2.5 py-[7px] text-[12px] text-fg-default font-[var(--font-ui)] w-full min-h-[80px] resize-y leading-relaxed focus:outline-none focus:border-border-focus"
          placeholder="Describe this agent's purpose."
          bind:value={role}
        ></textarea>
        <span class="text-[10px] text-fg-disabled leading-snug"
          >Injected into the system prompt on the first turn of each thread.</span
        >
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div
    class="border-t border-border-default px-5 py-3 flex justify-end gap-2 flex-shrink-0"
  >
    <button
      class="px-4 py-[6px] rounded-md text-[12px] font-medium text-fg-muted border border-border-default hover:bg-bg-hover transition-colors"
      onclick={onCancel}
    >
      Cancel
    </button>
    <button
      class="px-4 py-[6px] rounded-md text-[12px] font-medium transition-colors
        {canCreate
        ? 'bg-accent text-bg-base hover:opacity-90'
        : 'bg-bg-elevated text-fg-disabled cursor-not-allowed'}"
      disabled={!canCreate}
      onclick={handleCreate}
    >
      Create
    </button>
  </div>
</div>
