<!-- src/components/ChatArea.svelte -->
<script lang="ts">
  import { ChevronRight, ChevronDown } from "@lucide/svelte";
  import StreamingText from "./StreamingText.svelte";
  import type { DisplayAgent, DisplayToolCall } from "../stores/types";
  import { isNewTurn } from "../lib/chat-utils";
  import { renderMarkdown } from "../lib/render-markdown";

  interface Props {
    agent: DisplayAgent | undefined;
  }

  let { agent }: Props = $props();

  // Track which process blocks are expanded (by message id)
  let expandedBlocks: Record<string, boolean> = $state({});

  // ── Auto-scroll ────────────────────────────────────────────────
  let scrollContainer: HTMLDivElement | undefined = $state();
  // Plain let — not $state. Never affects template, and keeping it
  // non-reactive avoids re-triggering the auto-scroll effect on scroll.
  let userScrolledAway = false;

  function isNearBottom(el: HTMLElement): boolean {
    const threshold = 80;
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }

  function onScroll() {
    if (!scrollContainer) return;
    userScrolledAway = !isNearBottom(scrollContainer);
  }

  function scrollToBottom() {
    if (!scrollContainer) return;
    scrollContainer.scrollTo({ top: scrollContainer.scrollHeight });
  }

  // Reset expansion + scroll state when switching agents
  let agentId = $derived(agent?.id);
  $effect(() => {
    agentId;
    expandedBlocks = {};
    userScrolledAway = false;
    requestAnimationFrame(() => scrollToBottom());
  });

  // Auto-scroll on content changes (DOM manipulation — legitimate $effect use)
  $effect(() => {
    const messages = agent?.messages;
    const len = messages?.length ?? 0;
    const lastContent = len > 0 ? messages![len - 1]!.content : "";
    const lastRole = len > 0 ? messages![len - 1]!.role : "";
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _status = agent?.status;

    if (lastRole === "user") userScrolledAway = false;

    if (!scrollContainer || userScrolledAway) return;
    requestAnimationFrame(() => scrollToBottom());
  });

  function toggleBlock(messageId: string) {
    expandedBlocks[messageId] = !expandedBlocks[messageId];
  }

  function spacingClass(index: number): string {
    if (index === 0) return "";
    if (!agent) return "mt-[6px]";
    // 14px gap only before user messages that start a new turn
    const msg = agent.messages[index]!;
    if (msg.role === "user" && isNewTurn(agent.messages, index))
      return "mt-[14px]";
    return "mt-[6px]";
  }

  const toolStatusColor: Record<DisplayToolCall["status"], string> = {
    completed: "bg-success",
    failed: "bg-error",
    in_progress: "bg-warning",
    pending: "bg-fg-disabled",
  };
</script>

<div
  bind:this={scrollContainer}
  onscroll={onScroll}
  class="flex-1 overflow-y-auto px-5 py-4"
>
  {#if agent}
    <div class="flex flex-col">
      {#each agent.messages as message, i (message.id)}
        {#if message.role === "thinking"}
          <!-- Thinking block -->
          <div class={spacingClass(i)}>
            <div
              class="interactive bg-bg-elevated rounded px-2 py-1"
              onclick={() => toggleBlock(message.id)}
              role="button"
              tabindex="0"
              onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleBlock(message.id);
                }
              }}
            >
              <div class="flex items-center gap-1 text-[11px] text-fg-muted">
                {#if expandedBlocks[message.id]}
                  <ChevronDown size={10} />
                {:else}
                  <ChevronRight size={10} />
                {/if}
                Thinking
              </div>
              {#if expandedBlocks[message.id]}
                <div
                  class="pl-3.5 text-[11px] text-fg-muted italic leading-relaxed whitespace-pre-wrap"
                >
                  {message.content}
                </div>
              {/if}
            </div>
          </div>
        {:else if message.role === "assistant"}
          <!-- Assistant message -->
          <div class={spacingClass(i)}>
            {#if agent.status === "working" && i === agent.messages.length - 1}
              <div class="text-[12px] text-fg-default leading-relaxed">
                <StreamingText content={message.content} streaming={true} />
              </div>
            {:else}
              <div class="markdown">
                {@html renderMarkdown(message.content)}
              </div>
            {/if}
          </div>
        {:else if message.role === "user"}
          <!-- User message -->
          <div class="{spacingClass(i)} bg-accent-soft rounded-lg px-3 py-2">
            <div class="markdown">
              {@html renderMarkdown(message.content)}
            </div>
          </div>
        {:else if message.role === "tool-group" && message.toolCalls}
          <!-- Tool call group -->
          <div class={spacingClass(i)}>
            <div
              class="interactive bg-bg-elevated rounded px-2 py-1"
              onclick={() => toggleBlock(message.id)}
              role="button"
              tabindex="0"
              onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleBlock(message.id);
                }
              }}
            >
              <div class="flex items-center gap-1 text-[11px] text-fg-muted">
                {#if expandedBlocks[message.id]}
                  <ChevronDown size={10} />
                {:else}
                  <ChevronRight size={10} />
                {/if}
                {message.toolCalls.length} tool call{message.toolCalls
                  .length !== 1
                  ? "s"
                  : ""}
              </div>
              {#if expandedBlocks[message.id]}
                {#each message.toolCalls as toolCall (toolCall.id)}
                  <div
                    class="flex items-center gap-1.5 py-0.5 pl-3.5 text-[11px] font-[family-name:var(--font-mono)] text-fg-muted"
                  >
                    <span
                      class="w-1 h-1 rounded-full {toolStatusColor[
                        toolCall.status
                      ]} shrink-0"
                    ></span>
                    {toolCall.name}
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        {/if}
      {/each}

      <!-- Working indicator -->
      {#if agent.status === "working"}
        <div
          class="mt-[6px] flex items-center gap-1.5 text-[12px] text-fg-muted"
        >
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
