<script lang="ts">
  import { Loader, Check, XCircle, Mail, Square } from "@lucide/svelte";
  import StreamingText from "./StreamingText.svelte";
  import ToolCallRow from "./ToolCallRow.svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";
  import type { DisplayThread, DisplayToolCall } from "../../stores/types";
  import { renderMarkdown } from "../../lib/render-markdown";
  import { highlightCodeBlocks } from "../../lib/highlight";
  import { getEmergentToolName } from "../../lib/emergent-tool-calls";
  import { ToolRow, Mono } from "../../lib/primitives";

  interface Props {
    thread: DisplayThread | undefined;
    hasTaskBanner?: boolean;
    onEditQueue?: () => void;
  }

  let { thread, hasTaskBanner = false, onEditQueue }: Props = $props();

  function isRichTool(tc: DisplayToolCall): boolean {
    return getEmergentToolName(tc.name) !== null;
  }

  function toRowStatus(
    s: DisplayToolCall["status"],
  ): "running" | "completed" | "error" | "pending" {
    return s === "in_progress" ? "running" : s === "failed" ? "error" : s;
  }

  function summarizeArgs(tc: DisplayToolCall): string | undefined {
    const ri = tc.rawInput as Record<string, unknown> | undefined;
    if (ri) {
      const firstString = Object.values(ri).find((v) => typeof v === "string");
      if (typeof firstString === "string") return firstString;
    }
    const loc = tc.locations?.[0];
    return loc ? String(loc) : undefined;
  }

  function onChatClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target?.classList.contains("md-copy")) return;
    const pre = target.closest(".md-pre-wrap")?.querySelector("pre");
    if (pre) void navigator.clipboard.writeText(pre.textContent ?? "");
  }

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

  // Reset scroll state when switching threads
  let scrollThreadId = $derived(thread?.id);
  $effect(() => {
    const _id = scrollThreadId;
    userScrolledAway = false;
    requestAnimationFrame(() => scrollToBottom());
  });

  // Auto-scroll on content changes (DOM manipulation — legitimate $effect use)
  $effect(() => {
    const messages = thread?.messages;
    const len = messages?.length ?? 0;
    const lastContent = len > 0 ? messages![len - 1]!.content : "";
    const lastRole = len > 0 ? messages![len - 1]!.role : "";
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _status = thread?.processStatus;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _queued = thread?.queuedMessage;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _activeTools = thread?.activeToolCalls.length;

    if (lastRole === "user") userScrolledAway = false;

    if (!scrollContainer || userScrolledAway) return;
    requestAnimationFrame(() => scrollToBottom());
  });

  $effect(() => {
    // Re-run whenever messages change. highlightCodeBlocks is idempotent:
    // already-highlighted <code> elements are marked with
    // data-shiki-highlighted and skipped on subsequent passes.
    if (!scrollContainer) return;
    // Track the message list length so this effect re-runs on new messages.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _msgCount = thread?.messages.length;
    void highlightCodeBlocks(scrollContainer);
  });
</script>

{#snippet nudgeBadge(count: number)}
  <span
    class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-default bg-bg-elevated text-fg-muted"
    ><Mail size={11} /></span
  >
  You have
  <span class="font-semibold text-success"
    >{count} unread {count === 1 ? "message" : "messages"}</span
  >
  in your mailbox
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={scrollContainer}
  onscroll={onScroll}
  onclick={onChatClick}
  class="flex min-w-0 flex-1 justify-center overflow-y-auto"
>
  {#if thread}
    {#if thread.processStatus === "initializing"}
      <div class="flex h-full w-full items-center justify-center">
        <div class="flex max-w-[280px] flex-col items-center gap-3 text-center">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-full bg-bg-hover text-warning"
          >
            <Loader size={16} />
          </div>
          <div class="text-[13px] font-medium text-fg-heading">
            Connecting to {thread.name}…
          </div>
          <div class="text-[12px] leading-relaxed text-fg-muted">
            Waiting for the agent to start up
          </div>
        </div>
      </div>
    {:else if thread.processStatus === "error" && thread.messages.length === 0}
      <div class="flex h-full w-full items-center justify-center">
        <div class="flex max-w-[280px] flex-col items-center gap-3 text-center">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-full bg-bg-hover text-error"
          >
            <XCircle size={16} />
          </div>
          <div class="text-[13px] font-medium text-fg-heading">
            Failed to connect
          </div>
          <div class="text-[12px] leading-relaxed text-fg-muted">
            Could not start the agent
          </div>
          {#if thread.errorMessage}
            <code
              class="break-all rounded bg-bg-hover px-2 py-1 font-[family-name:var(--font-mono)] text-[11px] text-fg-muted"
            >
              {thread.errorMessage}
            </code>
          {/if}
        </div>
      </div>
    {:else if thread.processStatus === "idle" && thread.messages.length === 0}
      <div class="flex h-full w-full items-center justify-center">
        <div class="flex max-w-[280px] flex-col items-center gap-3 text-center">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-full bg-bg-hover text-success"
          >
            <Check size={16} />
          </div>
          <div class="text-[13px] font-medium text-fg-heading">
            {thread.name}
          </div>
          <div class="text-[12px] leading-relaxed text-fg-muted">Ready</div>
        </div>
      </div>
    {:else}
      <div
        class="flex w-full max-w-[740px] flex-col gap-[22px] px-10 font-[family-name:var(--font-ui)] text-[12.5px] leading-[1.6] tracking-[-0.002em] text-fg-default"
        class:pt-[60px]={hasTaskBanner}
        class:pt-9={!hasTaskBanner}
      >
        {#each thread.messages as message, i (message.id)}
          {#if message.role === "thinking"}
            <ThinkingBlock content={message.content} />
          {:else if message.role === "assistant"}
            {#if thread.processStatus === "working" && i === thread.messages.length - 1}
              <div class="markdown">
                <StreamingText content={message.content} streaming={true} />
              </div>
            {:else}
              <div class="markdown">
                {@html renderMarkdown(message.content)}
              </div>
            {/if}
            {#if message.cancelled}
              <div
                class="flex items-center gap-[6px] text-[11px] text-fg-disabled mt-[4px]"
              >
                <Square size={10} />
                <span>Stopped</span>
              </div>
            {/if}
          {:else if message.role === "user"}
            <div class="flex justify-end">
              <div
                class="max-w-[78%] rounded-[14px] bg-bg-selected px-[14px] py-[10px] text-[12.5px] leading-[1.55] text-fg-default"
              >
                <div class="markdown">
                  {@html renderMarkdown(message.content)}
                </div>
                {#if message.nudgeCount}
                  <div class="my-1.5 h-px bg-border-default"></div>
                  <div
                    class="flex items-center gap-1.5 text-[11px] text-fg-muted"
                  >
                    {@render nudgeBadge(message.nudgeCount ?? 0)}
                  </div>
                {/if}
              </div>
            </div>
          {:else if message.role === "tool-group"}
            <div class="flex flex-col gap-0">
              {#each message.toolCalls ?? [] as tc (tc.id)}
                {#if isRichTool(tc)}
                  <ToolCallRow toolCall={tc} />
                {:else}
                  {@const rowArgs = summarizeArgs(tc)}
                  <ToolRow
                    name={tc.name}
                    status={toRowStatus(tc.status)}
                    {...rowArgs !== undefined ? { args: rowArgs } : {}}
                  />
                {/if}
              {/each}
            </div>
          {:else if message.role === "system"}
            <div class="flex items-center gap-[10px] py-[2px]">
              <div class="h-px flex-1 bg-border-default"></div>
              <Mono size={10} color="var(--color-fg-disabled)"
                >{message.content}</Mono
              >
              <div class="h-px flex-1 bg-border-default"></div>
            </div>
          {:else if message.role === "nudge"}
            <div
              class="flex items-center gap-1.5 py-1 text-[11px] text-fg-muted"
            >
              {@render nudgeBadge(message.nudgeCount ?? 0)}
            </div>
          {/if}
        {/each}

        {#if thread.activeToolCalls.length > 0}
          <div class="flex flex-col gap-0">
            {#each thread.activeToolCalls as tc (tc.id)}
              {#if isRichTool(tc)}
                <ToolCallRow toolCall={tc} />
              {:else}
                {@const activeArgs = summarizeArgs(tc)}
                <ToolRow
                  name={tc.name}
                  status="running"
                  {...activeArgs !== undefined ? { args: activeArgs } : {}}
                />
              {/if}
            {/each}
          </div>
        {/if}

        <!--
          Spacer reserves scroll height under the absolutely-positioned
          composer (ChatInput) so the last message can scroll above it
          instead of being hidden. A real element is used instead of
          `padding-bottom` because WebKit/Chromium collapse padding out of
          the scrollable region for flex children in an overflow-auto
          parent.

          Height = composer wrapper total (146px: pt-10 + pb-22 + bubble
          114). With the content wrapper's `gap-[22px]` adding another
          22px above the spacer, the last message ends 22px above the
          composer wrapper top — matching the inter-message gap.
        -->
        <div class="h-[146px] shrink-0" aria-hidden="true"></div>
      </div>
    {/if}
  {:else}
    <div
      class="flex h-full items-center justify-center text-[13px] text-fg-muted"
    >
      Select a thread to view its conversation
    </div>
  {/if}
</div>
