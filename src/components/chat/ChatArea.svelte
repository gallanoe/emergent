<script lang="ts">
  import { Loader, Check, XCircle, Mail, Square } from "@lucide/svelte";
  import StreamingMarkdown from "./StreamingMarkdown.svelte";
  import ToolCallRow from "./ToolCallRow.svelte";
  import ThinkingBlock from "./ThinkingBlock.svelte";
  import NotificationRail from "./NotificationRail.svelte";
  import type {
    DisplayThread,
    DisplayMessage,
    DisplayToolCall,
    QueueItem,
  } from "../../stores/types";
  import { renderMarkdown } from "../../lib/render-markdown";
  import { highlightCodeBlocks } from "../../lib/highlight";
  import { Mono } from "../../lib/primitives";

  interface Props {
    thread: DisplayThread | undefined;
    hasTaskBanner?: boolean;
    onEditQueue?: () => void;
    notificationQueue?: QueueItem[];
  }

  let {
    thread,
    hasTaskBanner = false,
    onEditQueue,
    notificationQueue = [],
  }: Props = $props();

  // ── Render blocks ──────────────────────────────────────────────
  // Consecutive tool-group messages (plus any live active tool calls) collapse
  // into one `tools` block so a run of tool calls renders as a single dense
  // wrapper. The outer gap then only breathes at text↔tool boundaries — never
  // between adjacent tool calls.
  type RenderBlock =
    | { kind: "msg"; id: string; message: DisplayMessage; index: number }
    | { kind: "tools"; id: string; toolCalls: DisplayToolCall[] };

  let blocks = $derived.by<RenderBlock[]>(() => {
    const out: RenderBlock[] = [];
    const messages = thread?.messages ?? [];
    messages.forEach((message, index) => {
      if (message.role === "tool-group") {
        const last = out[out.length - 1];
        if (last?.kind === "tools") {
          last.toolCalls.push(...(message.toolCalls ?? []));
        } else {
          out.push({
            kind: "tools",
            id: message.id,
            toolCalls: [...(message.toolCalls ?? [])],
          });
        }
      } else {
        out.push({ kind: "msg", id: message.id, message, index });
      }
    });

    const active = thread?.activeToolCalls ?? [];
    if (active.length > 0) {
      const last = out[out.length - 1];
      if (last?.kind === "tools") {
        last.toolCalls.push(...active);
      } else {
        out.push({ kind: "tools", id: "active-tools", toolCalls: [...active] });
      }
    }
    return out;
  });

  let lastMessageIndex = $derived((thread?.messages.length ?? 0) - 1);

  function onChatClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target?.classList.contains("md-copy")) return;
    const pre = target.closest(".md-pre-wrap")?.querySelector("pre");
    if (pre) void navigator.clipboard.writeText(pre.textContent ?? "");
  }

  // ── Auto-scroll ────────────────────────────────────────────────
  let scrollContainer: HTMLDivElement | undefined = $state();
  // Plain lets — never affect the template, and keeping them non-reactive
  // avoids re-triggering the auto-scroll effect on scroll.
  let userScrolledAway = false;
  // Last observed scrollTop, used to tell a user's upward drag (detach) apart
  // from our own downward programmatic scroll (which must not detach).
  let lastScrollTop = 0;
  // Last height we scrolled to. Skip redundant scrolls when height is
  // unchanged so a smooth animation isn't restarted every streamed frame.
  let lastScrollHeight = 0;

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function isNearBottom(el: HTMLElement): boolean {
    const threshold = 80;
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }

  function onScroll() {
    if (!scrollContainer) return;
    const top = scrollContainer.scrollTop;
    // A decrease means the user scrolled up (our auto-scroll only moves down),
    // so detach and stop following. Otherwise re-attach once near the bottom.
    if (top < lastScrollTop - 2) {
      userScrolledAway = true;
    } else if (isNearBottom(scrollContainer)) {
      userScrolledAway = false;
    }
    lastScrollTop = top;
  }

  function scrollToBottom(smooth = false) {
    if (!scrollContainer) return;
    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior: smooth && !prefersReducedMotion ? "smooth" : "auto",
    });
    lastScrollHeight = scrollContainer.scrollHeight;
  }

  // Reset scroll state when switching threads. Jump instantly — smooth-scrolling
  // to the bottom of an already-rendered history would animate a long scroll.
  let scrollThreadId = $derived(thread?.id);
  $effect(() => {
    const _id = scrollThreadId;
    userScrolledAway = false;
    lastScrollHeight = 0;
    requestAnimationFrame(() => scrollToBottom(false));
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
    requestAnimationFrame(() => {
      if (!scrollContainer || userScrolledAway) return;
      // Height only changes when a block commits (the still-generating block
      // is hidden), so skip frames where nothing grew to avoid restarting the
      // smooth animation mid-flight.
      if (scrollContainer.scrollHeight === lastScrollHeight) return;
      scrollToBottom(true);
    });
  });

  $effect(() => {
    // Re-run whenever messages change. highlightCodeBlocks is idempotent:
    // already-highlighted <code> elements are marked with
    // data-shiki-highlighted and skipped on subsequent passes.
    if (!scrollContainer) return;
    // Track the message list length so this effect re-runs on new messages.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _msgCount = thread?.messages.length;
    // Also track the last message's content and the process status: streamed
    // code blocks commit into new DOM nodes while the message count is
    // unchanged, and the working→idle flush reveals the final block. Without
    // these, freshly-committed <pre><code> would stay unhighlighted.
    const _msgs = thread?.messages;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _lastContent =
      _msgs && _msgs.length > 0 ? _msgs[_msgs.length - 1]!.content : "";
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _status = thread?.processStatus;
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
        {#each blocks as block (block.id)}
          {#if block.kind === "tools"}
            <!-- One wrapper per run of consecutive tool calls; grows until the
                 next text block. Tight inner spacing, outer gap handles the
                 text↔tool boundary. -->
            <div class="flex flex-col gap-0">
              {#each block.toolCalls as tc (tc.id)}
                <ToolCallRow toolCall={tc} />
              {/each}
            </div>
          {:else if block.message.role === "thinking"}
            <ThinkingBlock content={block.message.content} />
          {:else if block.message.role === "assistant"}
            <StreamingMarkdown
              content={block.message.content}
              streaming={thread.processStatus === "working" &&
                block.index === lastMessageIndex}
            />
            {#if block.message.cancelled}
              <div
                class="flex items-center gap-[6px] text-[11px] text-fg-disabled mt-[4px]"
              >
                <Square size={10} />
                <span>Stopped</span>
              </div>
            {/if}
          {:else if block.message.role === "user"}
            <div class="flex justify-end">
              <div
                class="max-w-[78%] rounded-[14px] bg-bg-selected px-[14px] py-[10px] text-[12.5px] leading-[1.55] text-fg-default"
              >
                <div class="markdown">
                  {@html renderMarkdown(block.message.content)}
                </div>
                {#if block.message.nudgeCount}
                  <div class="my-1.5 h-px bg-border-default"></div>
                  <div
                    class="flex items-center gap-1.5 text-[11px] text-fg-muted"
                  >
                    {@render nudgeBadge(block.message.nudgeCount ?? 0)}
                  </div>
                {/if}
              </div>
            </div>
          {:else if block.message.role === "system"}
            <div class="flex items-center gap-[10px] py-[2px]">
              <div class="h-px flex-1 bg-border-default"></div>
              <Mono size={10} color="var(--color-fg-disabled)"
                >{block.message.content}</Mono
              >
              <div class="h-px flex-1 bg-border-default"></div>
            </div>
          {:else if block.message.role === "nudge"}
            <div
              class="flex items-center gap-1.5 py-1 text-[11px] text-fg-muted"
            >
              {@render nudgeBadge(block.message.nudgeCount ?? 0)}
            </div>
          {:else if block.message.role === "notification"}
            <NotificationRail
              state="submitted"
              source={block.message.source ?? "task"}
              label={block.message.source === "thread"
                ? (block.message.from ?? "agent")
                : (block.message.taskId ?? "task")}
              content={block.message.content}
              {...block.message.taskStatus
                ? { taskStatus: block.message.taskStatus }
                : {}}
            />
          {/if}
        {/each}

        {#each notificationQueue as item (item.id)}
          <NotificationRail
            state="pending"
            source={item.source === "thread" ? "thread" : "task"}
            label={item.source === "thread" ? (item.from ?? "agent") : item.id}
            content={item.content}
          />
        {/each}

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
