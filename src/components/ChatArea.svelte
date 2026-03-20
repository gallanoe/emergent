<!-- src/components/ChatArea.svelte -->
<script lang="ts">
  import StreamingText from "./StreamingText.svelte";
  import ToolCallGroup from "./ToolCallGroup.svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";
  import type { DisplayAgent } from "../stores/types";
  import { isNewTurn } from "../lib/chat-utils";
  import { renderMarkdown } from "../lib/render-markdown";

  interface Props {
    agent: DisplayAgent | undefined;
  }

  let { agent }: Props = $props();

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

  // Reset scroll state when switching agents
  let agentId = $derived(agent?.id);
  $effect(() => {
    agentId;
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

  function spacingClass(index: number): string {
    if (index === 0) return "";
    if (!agent) return "mt-[6px]";
    // 14px gap only before user messages that start a new turn
    const msg = agent.messages[index]!;
    if (msg.role === "user" && isNewTurn(agent.messages, index))
      return "mt-[14px]";
    return "mt-[6px]";
  }
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
          <div class={spacingClass(i)}>
            <ThinkingBlock content={message.content} />
          </div>
        {:else if message.role === "assistant"}
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
          <div class="{spacingClass(i)} bg-accent-soft rounded-lg px-3 py-2">
            <div class="markdown">
              {@html renderMarkdown(message.content)}
            </div>
          </div>
        {:else if message.role === "tool-group" && message.toolCalls}
          <div class={spacingClass(i)}>
            <ToolCallGroup toolCalls={message.toolCalls} />
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
