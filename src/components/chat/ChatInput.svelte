<script lang="ts">
  import { Plus, Mic, ArrowUp, Square, ChevronDown } from "@lucide/svelte";
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

  const isWorking = $derived(thread?.processStatus === "working");
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

  $effect(() => {
    if (!configOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") configOpen = false;
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
</script>

<div class="flex justify-center px-10 pb-[22px] pt-[10px]">
  <div
    class="relative flex w-full max-w-[760px] flex-col gap-[10px] rounded-[18px] border border-border-default bg-bg-bubble px-[14px] pb-[10px] pt-[14px] shadow-[var(--shadow-sm)]"
  >
    <textarea
      bind:this={textareaEl}
      bind:value={message}
      class="min-h-[48px] resize-none border-0 bg-transparent px-[6px] py-[4px] font-[family-name:var(--font-ui)] text-[14px] leading-[1.55] text-fg-default outline-none placeholder:text-fg-muted disabled:placeholder:text-fg-disabled"
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
            <AgentAvatar cli={thread.cli} size={13} />
            <span>{thread.name}</span>
            {#if configSummary}
              <span class="text-fg-disabled">·</span>
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

      <button
        type="button"
        title="Voice (coming soon)"
        disabled
        class="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full text-fg-muted disabled:opacity-40"
      >
        <Mic size={12} />
      </button>

      {#if isWorking}
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

      <button
        type="button"
        title={isWorking ? "Queue message" : "Send"}
        disabled={!hasText || isDisabled}
        class="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full disabled:opacity-40"
        style="background: var(--color-fg-heading); color: var(--color-background);"
        onclick={submit}
      >
        <ArrowUp size={13} />
      </button>
    </div>
  </div>
</div>
