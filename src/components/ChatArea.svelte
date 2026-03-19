<!-- src/components/ChatArea.svelte -->
<script lang="ts">
  import { ChevronRight, ChevronDown } from "@lucide/svelte";
  import type { DisplayAgent } from "../stores/types";

  interface Props {
    agent: DisplayAgent | undefined;
  }

  let { agent }: Props = $props();

  // Track which tool-group messages are expanded (by message id)
  let expandedToolGroups: Record<string, boolean> = $state({});

  // Reset expansion state when switching agents
  $effect(() => {
    agent;
    expandedToolGroups = {};
  });

  function toggleToolGroup(messageId: string) {
    expandedToolGroups[messageId] = !expandedToolGroups[messageId];
  }

  function shouldShowTimestamp(index: number): boolean {
    if (!agent) return true;
    const messages = agent.messages;
    if (index === 0) return true;
    const current = messages[index]!;
    const prev = messages[index - 1]!;
    if (current.role === "tool-group") return false;
    return current.timestamp !== prev.timestamp;
  }

  /** True when the speaker changes (user↔assistant), ignoring tool-groups */
  function isNewTurn(index: number): boolean {
    if (!agent || index === 0) return false;
    const messages = agent.messages;
    const current = messages[index]!;
    if (current.role === "tool-group") return false;
    // Walk back past tool-groups to find the previous speaker
    for (let j = index - 1; j >= 0; j--) {
      const prev = messages[j]!;
      if (prev.role !== "tool-group") {
        return prev.role !== current.role;
      }
    }
    return false;
  }
</script>

<div class="flex-1 overflow-y-auto px-5 py-4">
  {#if agent}
    {#each agent.messages as message, i (message.id)}
      {#if message.role === "assistant"}
        <!-- Assistant message -->
        <div class="mb-1.5 {isNewTurn(i) ? 'mt-4' : ''}">
          {#if shouldShowTimestamp(i)}
            <div class="text-[11px] text-fg-muted mb-0.5">
              {message.timestamp}
            </div>
          {/if}
          <div class="text-[12px] text-fg-default leading-relaxed">
            {message.content}
          </div>
        </div>
      {:else if message.role === "user"}
        <!-- User message -->
        <div
          class="mb-1.5 {isNewTurn(i)
            ? 'mt-4'
            : ''} bg-accent-soft rounded-lg px-3 py-2"
        >
          {#if shouldShowTimestamp(i)}
            <div class="text-[11px] text-fg-muted mb-0.5">
              {message.timestamp}
            </div>
          {/if}
          <div class="text-[12px] text-fg-default leading-relaxed">
            {message.content}
          </div>
        </div>
      {:else if message.role === "tool-group" && message.toolCalls}
        <!-- Tool group — compact inline collapsible -->
        <div class="mb-1 -mt-0.5">
          <button
            class="interactive flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-fg-muted rounded"
            onclick={() => toggleToolGroup(message.id)}
          >
            {#if expandedToolGroups[message.id]}
              <ChevronDown size={10} />
            {:else}
              <ChevronRight size={10} />
            {/if}
            {message.toolCalls.length} tool call{message.toolCalls.length !== 1
              ? "s"
              : ""}
          </button>

          {#if expandedToolGroups[message.id]}
            {#each message.toolCalls as toolCall (toolCall.id)}
              <div
                class="flex items-center gap-1.5 py-0.5 pl-4 text-[11px] font-[family-name:var(--font-mono)] text-fg-muted"
              >
                <span class="w-1 h-1 rounded-full bg-accent shrink-0"></span>
                {toolCall.name}
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    {/each}

    <!-- Working indicator -->
    {#if agent.status === "working"}
      <div class="flex items-center gap-1.5 text-[12px] text-fg-muted mt-1">
        <span class="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span>
        <span class="tracking-widest">· · ·</span>
      </div>
    {/if}
  {:else}
    <div
      class="flex items-center justify-center h-full text-fg-muted text-[13px]"
    >
      Select an agent to view its conversation
    </div>
  {/if}
</div>
