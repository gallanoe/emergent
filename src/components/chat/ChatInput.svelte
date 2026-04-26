<script lang="ts">
  import {
    Plus,
    Mic,
    ArrowUp,
    Square,
    ChevronDown,
    Loader,
  } from "@lucide/svelte";
  import ConfigPopover from "./ConfigPopover.svelte";
  import { AgentAvatar } from "../../lib/primitives";
  import type { DisplayThread } from "../../stores/types";

  interface Props {
    thread: DisplayThread | undefined;
    demoMode: boolean;
    containerRunning?: boolean;
    externalContent?: { text: string; seq: number } | null;
    onSend: (text: string) => void;
    onInterrupt?: () => void;
    onSetConfig?: (configId: string, value: string) => void;
  }

  let {
    thread,
    demoMode,
    containerRunning = true,
    externalContent = null,
    onSend,
    onInterrupt,
    onSetConfig,
  }: Props = $props();

  let message = $state("");
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let configOpen = $state(false);

  let consumedSeq = $state(-1);
  $effect(() => {
    if (externalContent && externalContent.seq !== consumedSeq) {
      consumedSeq = externalContent.seq;
      message = externalContent.text;
      requestAnimationFrame(() => textareaEl?.focus());
    }
  });

  const isWorking = $derived(
    thread?.processStatus === "working" ||
      thread?.processStatus === "cancelling",
  );
  const isCancelling = $derived(thread?.processStatus === "cancelling");
  const hasText = $derived(message.trim().length > 0);
  const isDisabled = $derived(
    demoMode ||
      !thread ||
      !containerRunning ||
      thread.processStatus === "initializing" ||
      thread.processStatus === "error" ||
      thread.processStatus === "dead",
  );

  const placeholderText = $derived.by(() => {
    if (demoMode) return "Demo mode — input disabled";
    if (!thread) return "Select a thread";
    if (!containerRunning) return "Start the container to send messages";
    if (thread.processStatus === "initializing") return "Connecting to agent…";
    if (thread.processStatus === "error") return "Agent unavailable";
    if (thread.processStatus === "dead") return "Thread stopped";
    return `Message ${thread.name}…`;
  });

  const configSummary = $derived.by(() => {
    const opts = thread?.configOptions ?? [];
    if (opts.length === 0) return thread?.cli ?? "";
    return opts
      .filter((o) => o.current_value)
      .map((o) => o.current_value)
      .slice(0, 3)
      .join(" · ");
  });

  function submit() {
    const text = message.trim();
    if (!text || isDisabled) return;
    onSend(text);
    message = "";
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function fmtK(n: number): string {
    return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
  }

  $effect(() => {
    if (!configOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") configOpen = false;
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
</script>

<!--
  Composer floats absolutely at the bottom of its relative parent so the
  chat transcript scrolls UNDERNEATH it (iMessage-style). Keep this in sync
  with ChatArea's bottom padding (~160px) so messages aren't hidden when
  scrolled to the end.

  - Outer wrapper: `pointer-events-none` so clicks in the px-10 gutters
    pass through to the transcript.
  - Bubble: `pointer-events-auto` to restore interactivity on the composer
    itself.
  - `bg-bg-elevated` (opaque) rather than the design spec's `bg-bg-bubble`
    (4% white overlay) so scrolled-under content is cleanly occluded. The
    bubble token blends with the near-black main pane and reads as a
    dark rim, not a floating surface.
-->
<div
  class="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-10 pb-[22px] pt-[10px]"
>
  <div
    class="pointer-events-auto relative flex w-full max-w-[760px] flex-col gap-[10px] rounded-[18px] border border-border-default bg-bg-elevated px-[14px] pb-[10px] pt-[14px] shadow-[var(--shadow-sm)]"
  >
    <textarea
      bind:this={textareaEl}
      bind:value={message}
      class="min-h-[48px] resize-none border-0 bg-transparent px-[6px] py-[4px] font-[family-name:var(--font-ui)] text-[12.5px] leading-[1.55] text-fg-default outline-none placeholder:text-fg-muted disabled:placeholder:text-fg-disabled"
      placeholder={placeholderText}
      disabled={isDisabled}
      onkeydown={handleKeyDown}
    ></textarea>

    <div class="flex items-center gap-[6px]">
      <button
        type="button"
        title="Attach (coming soon)"
        disabled
        class="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full text-fg-muted disabled:opacity-40"
      >
        <Plus size={13} />
      </button>

      {#if thread}
        <div class="relative">
          <button
            type="button"
            class="inline-flex h-[28px] items-center gap-[6px] rounded-full bg-bg-hover px-[10px] text-[11.5px] font-medium text-fg-default"
            onclick={() => (configOpen = !configOpen)}
          >
            <AgentAvatar
              provider={thread.provider}
              cli={thread.cli}
              name={thread.name}
              size={13}
            />
            <span>{thread.name}</span>
            {#if configSummary}
              <span class="px-[2px] text-fg-disabled">@</span>
              <span class="text-fg-muted">{configSummary}</span>
            {/if}
            <ChevronDown size={10} />
          </button>
          {#if configOpen && thread}
            <ConfigPopover
              configs={thread.configOptions}
              onSetConfig={(id, v) => onSetConfig?.(id, v)}
              onClose={() => (configOpen = false)}
            />
          {/if}
        </div>
      {/if}

      <div class="min-w-0 flex-1"></div>

      {#if thread?.tokenUsage && thread.tokenUsage.size > 0}
        {@const fill = Math.min(
          thread.tokenUsage.used / thread.tokenUsage.size,
          1,
        )}
        {@const C = 2 * Math.PI * 5.5}
        <span
          class="inline-flex h-[30px] w-[30px] items-center justify-center text-fg-muted"
          title="{fmtK(thread.tokenUsage.used)} / {fmtK(
            thread.tokenUsage.size,
          )} ({Math.round(fill * 100)}%)"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            aria-label="Context usage"
          >
            <circle
              cx="7"
              cy="7"
              r="5.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              opacity="0.2"
            />
            <circle
              cx="7"
              cy="7"
              r="5.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-dasharray={C}
              stroke-dashoffset={C * (1 - fill)}
              stroke-linecap="round"
              transform="rotate(-90 7 7)"
            />
          </svg>
        </span>
      {/if}

      <button
        type="button"
        title="Voice (coming soon)"
        disabled
        class="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full text-fg-muted disabled:opacity-40"
      >
        <Mic size={12} />
      </button>

      {#if isWorking}
        {#if isCancelling}
          <button
            type="button"
            title="Stopping…"
            disabled
            class="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full disabled:opacity-60"
            style="background: var(--color-fg-heading); color: var(--color-background);"
          >
            <Loader size={10} />
          </button>
        {:else}
          <button
            type="button"
            title="Interrupt"
            class="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full"
            style="background: var(--color-fg-heading); color: var(--color-background);"
            onclick={() => onInterrupt?.()}
          >
            <Square size={10} fill="currentColor" />
          </button>
        {/if}
      {:else}
        <button
          type="button"
          title="Send"
          disabled={!hasText || isDisabled}
          class="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full disabled:opacity-40"
          style="background: var(--color-fg-heading); color: var(--color-background);"
          onclick={submit}
        >
          <ArrowUp size={13} />
        </button>
      {/if}
    </div>
  </div>
</div>
