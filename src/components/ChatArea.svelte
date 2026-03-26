<!-- src/components/ChatArea.svelte -->
<script lang="ts">
  import { Pencil, Loader, Check, XCircle, Mail } from "@lucide/svelte";
  import StreamingText from "./StreamingText.svelte";
  import ToolCallGroup from "./ToolCallGroup.svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";
  import type { DisplayAgent } from "../stores/types";
  import { isNewTurn } from "../lib/chat-utils";
  import { renderMarkdown } from "../lib/render-markdown";

  interface Props {
    agent: DisplayAgent | undefined;
    onEditQueue?: () => void;
    onRoleChange?: (role: string) => void;
  }

  let { agent, onEditQueue, onRoleChange }: Props = $props();

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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _queued = agent?.queuedMessage;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _activeTools = agent?.activeToolCalls.length;

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

{#snippet nudgeBadge(count: number)}
  <span
    class="w-5 h-5 rounded-full bg-[rgba(45,140,80,0.1)] flex items-center justify-center text-success shrink-0"
    ><Mail size={11} /></span
  >
  You have
  <span class="font-semibold text-success"
    >{count} unread {count === 1 ? "message" : "messages"}</span
  >
  in your mailbox
{/snippet}

<div
  bind:this={scrollContainer}
  onscroll={onScroll}
  class="flex-1 overflow-y-auto min-w-0 px-5 py-4"
>
  {#if agent}
    {#if agent.status === "initializing"}
      <!-- Initializing banner -->
      <div class="flex items-center justify-center h-full">
        <div class="flex flex-col items-center gap-3 max-w-[280px] text-center">
          <div
            class="w-8 h-8 rounded-full flex items-center justify-center bg-[rgba(196,138,26,0.08)] text-warning"
          >
            <Loader size={16} />
          </div>
          <div class="text-[13px] font-medium text-fg-heading">
            Connecting to {agent.name}…
          </div>
          <div class="text-[12px] text-fg-muted leading-relaxed">
            Waiting for the agent to start up
          </div>
        </div>
      </div>
    {:else if agent.status === "error" && agent.messages.length === 0}
      <!-- Error banner (init errors with no messages) -->
      <div class="flex items-center justify-center h-full">
        <div class="flex flex-col items-center gap-3 max-w-[280px] text-center">
          <div
            class="w-8 h-8 rounded-full flex items-center justify-center bg-[rgba(200,60,60,0.08)] text-error"
          >
            <XCircle size={16} />
          </div>
          <div class="text-[13px] font-medium text-fg-heading">
            Failed to connect
          </div>
          <div class="text-[12px] text-fg-muted leading-relaxed">
            Could not start the agent
          </div>
          {#if agent.errorMessage}
            <code
              class="text-[11px] text-fg-muted bg-bg-hover px-2 py-1 rounded font-[family-name:var(--font-mono)] break-all"
            >
              {agent.errorMessage}
            </code>
          {/if}
        </div>
      </div>
    {:else if agent.status === "idle" && agent.messages.length === 0}
      <!-- Ready banner (idle, no messages) -->
      <div class="flex items-center justify-center h-full">
        <div class="flex flex-col items-center gap-3 max-w-[280px] text-center">
          <div
            class="w-8 h-8 rounded-full flex items-center justify-center bg-[rgba(45,140,80,0.08)] text-success"
          >
            <Check size={16} />
          </div>
          <div class="text-[13px] font-medium text-fg-heading">
            {agent.name}
          </div>
          <div class="text-[12px] text-fg-muted leading-relaxed">Ready</div>
          <!-- Role pill (editable) -->
          <div
            class="inline-flex items-center gap-1.5 px-3 py-1 bg-accent-soft border border-[rgba(124,106,78,0.12)] rounded-full cursor-text"
          >
            <Pencil size={11} class="text-fg-disabled shrink-0" />
            <input
              type="text"
              value={agent.role ?? ""}
              placeholder="Role..."
              class="bg-transparent border-none outline-none text-[11px] text-center w-32
                {agent.role ? 'text-accent-text' : 'text-fg-disabled italic'}"
              oninput={(e) => onRoleChange?.(e.currentTarget.value)}
            />
          </div>
        </div>
      </div>
    {:else}
      <!-- Normal chat flow -->
      <div class="flex flex-col">
        <!-- Locked role pill -->
        {#if agent.role}
          <div class="flex justify-center mb-3.5">
            <div
              class="inline-flex items-center px-3 py-1 bg-accent-soft border border-[rgba(124,106,78,0.12)] rounded-full text-[11px] text-accent-text"
            >
              {agent.role}
            </div>
          </div>
        {/if}
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
              {#if message.nudgeCount}
                <div class="h-px bg-[rgba(124,106,78,0.15)] my-1.5"></div>
                <div
                  class="flex items-center gap-1.5 text-[11px] text-fg-muted"
                >
                  {@render nudgeBadge(message.nudgeCount ?? 0)}
                </div>
              {/if}
            </div>
          {:else if message.role === "nudge"}
            <div
              class="{spacingClass(
                i,
              )} flex items-center gap-1.5 text-[11px] text-fg-muted py-1"
            >
              {@render nudgeBadge(message.nudgeCount ?? 0)}
            </div>
          {:else if message.role === "tool-group" && message.toolCalls}
            <div class={spacingClass(i)}>
              <ToolCallGroup toolCalls={message.toolCalls} />
            </div>
          {:else if message.role === "system"}
            <div class="{spacingClass(i)} flex items-center gap-2 py-1">
              <div class="flex-1 h-px bg-border-default"></div>
              <span
                class="text-[10px] text-fg-muted whitespace-nowrap shrink-0"
              >
                {message.content}
              </span>
              <div class="flex-1 h-px bg-border-default"></div>
            </div>
          {/if}
        {/each}

        <!-- Active (in-progress) tool calls -->
        {#if agent.activeToolCalls.length > 0}
          <div class="mt-[6px]">
            <ToolCallGroup toolCalls={agent.activeToolCalls} />
          </div>
        {/if}

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

        <!-- Queued message bubble -->
        {#if agent.queuedMessage}
          <div class="mt-[14px] relative group">
            <div class="bg-accent-soft rounded-lg px-3 py-2 opacity-55">
              <div
                class="text-[12px] leading-[1.55] text-fg-default whitespace-pre-wrap"
              >
                {agent.queuedMessage}
              </div>
            </div>
            <button
              class="interactive absolute top-2 right-2 flex items-center gap-1 text-[10px] text-fg-disabled opacity-0 group-hover:opacity-100 transition-opacity duration-150 rounded px-1"
              onclick={() => onEditQueue?.()}
            >
              <Pencil size={10} />
              Edit
            </button>
            <div class="flex items-center gap-1 mt-1">
              <span class="w-1 h-1 rounded-full bg-warning"></span>
              <span class="text-[10px] text-warning font-mono">Queued</span>
            </div>
          </div>
        {/if}
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
