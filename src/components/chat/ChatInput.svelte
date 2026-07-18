<script lang="ts">
  import { Plus, Mic, ArrowUp, Square, Loader } from "@lucide/svelte";
  import ConfigPill from "./ConfigPill.svelte";
  import QueuedMessages from "./QueuedMessages.svelte";
  import type { DisplayThread, QueueItem } from "../../stores/types";

  interface Props {
    thread: DisplayThread | undefined;
    demoMode: boolean;
    pendingQueue?: QueueItem[];
    pushToComposer?: { text: string; seq: number };
    onSend: (text: string) => void;
    onInterrupt?: () => void;
    onSetConfig?: (configId: string, value: string) => void;
    onRemoveQueueItem?: (id: string) => void;
    onEditQueueItem?: (id: string, content: string) => void;
    onClearQueue?: () => void;
  }

  let {
    thread,
    demoMode,
    pendingQueue = [],
    pushToComposer,
    onSend,
    onInterrupt,
    onSetConfig,
    onRemoveQueueItem,
    onEditQueueItem,
    onClearQueue,
  }: Props = $props();

  let message = $state("");
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  // Which config pill's popup is open, if any. Owned here (not per-pill) so that
  // opening one pill — by mouse or keyboard — closes the others.
  let openConfigId = $state<string | null>(null);

  const isWorking = $derived(
    thread?.processStatus === "working" ||
      thread?.processStatus === "cancelling",
  );
  const isCancelling = $derived(thread?.processStatus === "cancelling");
  const hasText = $derived(message.trim().length > 0);
  const isDisabled = $derived(
    demoMode ||
      !thread ||
      thread.processStatus === "initializing" ||
      thread.processStatus === "error" ||
      thread.processStatus === "dead",
  );

  const placeholderText = $derived.by(() => {
    if (demoMode) return "Demo mode — input disabled";
    if (!thread) return "Select a thread";
    if (thread.processStatus === "initializing") return "Connecting to agent…";
    if (thread.processStatus === "error") return "Agent unavailable";
    if (thread.processStatus === "dead") return "Thread stopped";
    return `Message ${thread.name}…`;
  });

  // Reset the open pill when switching threads: config ids (e.g. "model") are
  // shared across threads, so a stale openConfigId would otherwise render a
  // pill pre-opened on the newly-selected thread.
  $effect(() => {
    void thread?.id;
    openConfigId = null;
  });

  // ── Push-to-composer channel ───────────────────────────────────────────────
  let lastAppliedSeq = $state(-1);

  $effect(() => {
    if (!pushToComposer) return;
    const { seq, text } = pushToComposer;
    if (seq === lastAppliedSeq) return;
    lastAppliedSeq = seq;
    message = text;
    textareaEl?.focus();
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
</script>

<div
  class="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center px-10 pb-[22px] pt-[10px]"
>
  <div
    class="pointer-events-auto flex w-full max-w-[760px] flex-col rounded-[18px] shadow-[var(--shadow-sm)]"
  >
    {#if pendingQueue.length > 0}
      <QueuedMessages
        items={pendingQueue}
        working={isWorking}
        attached
        onRemove={(id) => onRemoveQueueItem?.(id)}
        onEdit={(id, content) => onEditQueueItem?.(id, content)}
        onClearAll={() => onClearQueue?.()}
      />
    {/if}

    <div
      class="relative flex w-full flex-col gap-[10px] border border-border-default bg-bg-elevated px-[14px] pb-[10px] pt-[14px] {pendingQueue.length >
      0
        ? 'rounded-t-none rounded-b-[18px]'
        : 'rounded-[18px]'}"
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
          {#each thread.configOptions as config (config.id)}
            <ConfigPill
              {config}
              open={openConfigId === config.id}
              onOpenChange={(next) => (openConfigId = next ? config.id : null)}
              onSetConfig={(id, v) => onSetConfig?.(id, v)}
            />
          {/each}
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
</div>
