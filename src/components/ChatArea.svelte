<!-- src/components/ChatArea.svelte -->
<script lang="ts">
  import { ChevronRight, ChevronDown } from "@lucide/svelte";
  import type { Agent } from "../stores/mock-data.svelte";

  interface Props {
    agent: Agent | undefined;
  }

  let { agent }: Props = $props();

  // Track which tool-group messages are expanded (by message id)
  let expandedToolGroups: Record<string, boolean> = $state({});

  function toggleToolGroup(messageId: string) {
    expandedToolGroups[messageId] = !expandedToolGroups[messageId];
  }
</script>

<div class="flex-1 overflow-y-auto px-5 py-4">
  {#if agent}
    {#each agent.messages as message (message.id)}
      {#if message.role === "assistant"}
        <!-- Assistant message -->
        <div class="mb-4">
          <div class="text-[11px] text-fg-muted mb-1">{message.timestamp}</div>
          <div class="text-[12px] text-fg-default leading-relaxed">{message.content}</div>
        </div>

      {:else if message.role === "user"}
        <!-- User message -->
        <div class="mb-4 bg-accent-soft rounded-lg px-3 py-2">
          <div class="text-[11px] text-fg-muted mb-1">{message.timestamp}</div>
          <div class="text-[12px] text-fg-default leading-relaxed">{message.content}</div>
        </div>

      {:else if message.role === "tool-group" && message.toolCalls}
        <!-- Tool group — inline collapsible -->
        <div class="mb-4">
          <button
            class="interactive flex items-center gap-1 py-1 text-[11px] text-fg-muted font-medium rounded"
            onclick={() => toggleToolGroup(message.id)}
          >
            {#if expandedToolGroups[message.id]}
              <ChevronDown size={12} />
            {:else}
              <ChevronRight size={12} />
            {/if}
            {message.toolCalls.length} tool call{message.toolCalls.length !== 1 ? "s" : ""}
          </button>

          {#if expandedToolGroups[message.id]}
            {#each message.toolCalls as toolCall (toolCall.id)}
              <div class="flex items-center gap-1.5 py-0.5 pl-4 text-[11px] font-[family-name:var(--font-mono)] text-fg-muted">
                <span class="w-1.5 h-1.5 rounded-full bg-accent shrink-0"></span>
                {toolCall.name}
                <span class="text-fg-default">{toolCall.argument}</span>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    {/each}

    <!-- Working indicator -->
    {#if agent.status === "working"}
      <div class="flex items-center gap-1.5 text-[12px] text-fg-muted">
        <span class="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span>
        <span class="tracking-widest">· · ·</span>
      </div>
    {/if}
  {:else}
    <div class="flex items-center justify-center h-full text-fg-muted text-[13px]">
      Select an agent to view its conversation
    </div>
  {/if}
</div>
