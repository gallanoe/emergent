<!-- src/components/ChatArea.svelte -->
<script lang="ts">
  import { ChevronRight, ChevronDown } from "@lucide/svelte";
  import StreamingText from "./StreamingText.svelte";
  import type { DisplayAgent } from "../stores/types";

  interface Props {
    agent: DisplayAgent | undefined;
  }

  let { agent }: Props = $props();

  // Track which tool-group messages are expanded (by message id)
  let expandedToolGroups: Record<string, boolean> = $state({});

  // Reset expansion state when switching agents
  let agentId = $derived(agent?.id);
  $effect(() => {
    agentId;
    expandedToolGroups = {};
  });

  function toggleToolGroup(messageId: string) {
    expandedToolGroups[messageId] = !expandedToolGroups[messageId];
  }
</script>

<div class="flex-1 overflow-y-auto px-5 py-4">
  {#if agent}
    <div class="flex flex-col gap-1.5">
      {#each agent.messages as message, i (message.id)}
        {#if message.role === "thinking"}
          <!-- Thinking block — collapsible, muted -->
          <div>
            <button
              class="interactive flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-fg-muted rounded"
              onclick={() => toggleToolGroup(message.id)}
            >
              {#if expandedToolGroups[message.id]}
                <ChevronDown size={10} />
              {:else}
                <ChevronRight size={10} />
              {/if}
              Thinking
            </button>
            {#if expandedToolGroups[message.id]}
              <div
                class="pl-4 text-[11px] text-fg-muted italic leading-relaxed whitespace-pre-wrap"
              >
                {message.content}
              </div>
            {/if}
          </div>
        {:else if message.role === "assistant"}
          <!-- Assistant message -->
          <div class="text-[12px] text-fg-default leading-relaxed">
            {#if agent.status === "working" && i === agent.messages.length - 1}
              <StreamingText content={message.content} streaming={true} />
            {:else}
              {message.content}
            {/if}
          </div>
        {:else if message.role === "user"}
          <!-- User message -->
          <div class="bg-accent-soft rounded-lg px-3 py-2">
            <div class="text-[12px] text-fg-default leading-relaxed">
              {message.content}
            </div>
          </div>
        {:else if message.role === "tool-group" && message.toolCalls}
          <!-- Tool group — compact inline collapsible -->
          <div>
            <button
              class="interactive flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-fg-muted rounded"
              onclick={() => toggleToolGroup(message.id)}
            >
              {#if expandedToolGroups[message.id]}
                <ChevronDown size={10} />
              {:else}
                <ChevronRight size={10} />
              {/if}
              {message.toolCalls.length} tool call{message.toolCalls.length !==
              1
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
        <div class="flex items-center gap-1.5 text-[12px] text-fg-muted">
          <span class="w-1.5 h-1.5 rounded-full bg-success animate-pulse"
          ></span>
          <span class="tracking-widest">· · ·</span>
        </div>
      {/if}
    </div>
  {:else}
    <div
      class="flex items-center justify-center h-full text-fg-muted text-[13px]"
    >
      Select an agent to view its conversation
    </div>
  {/if}
</div>
