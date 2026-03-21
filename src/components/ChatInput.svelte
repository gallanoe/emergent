<script lang="ts">
  import { Sparkles, ArrowUp, Square } from "@lucide/svelte";
  import type { DisplayAgent } from "../stores/types";

  interface Props {
    agent: DisplayAgent | undefined;
    demoMode: boolean;
    onSend: (text: string) => void;
    onInterrupt?: () => void;
    externalContent?: { text: string; seq: number } | null;
  }

  let {
    agent,
    demoMode,
    onSend,
    onInterrupt,
    externalContent = null,
  }: Props = $props();
  let message = $state("");
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  // When external content is pushed (edit queue / error dump), set it.
  // Uses a seq counter so identical content can be pushed multiple times.
  let consumedSeq = $state(-1);
  $effect(() => {
    if (externalContent && externalContent.seq !== consumedSeq) {
      consumedSeq = externalContent.seq;
      message = externalContent.text;
      requestAnimationFrame(() => textareaEl?.focus());
    }
  });

  let isWorking = $derived(agent?.status === "working");
  let hasText = $derived(message.trim().length > 0);

  function handleSend() {
    const text = message.trim();
    if (!text || demoMode || !agent) return;
    onSend(text);
    message = "";
  }

  function handleInterrupt() {
    if (onInterrupt) onInterrupt();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }
</script>

<div class="px-5 py-3 border-t border-border-default">
  <div class="border border-border-strong rounded-lg overflow-hidden">
    <textarea
      bind:this={textareaEl}
      class="w-full px-3 py-2.5 text-[12px] text-fg-default bg-transparent resize-none leading-relaxed placeholder:text-fg-disabled"
      placeholder={demoMode
        ? "Demo mode — input disabled"
        : "Message this agent..."}
      rows="1"
      disabled={demoMode || !agent}
      bind:value={message}
      onkeydown={handleKeydown}
    ></textarea>
    <div class="flex items-center px-3 py-2 border-t border-border-default">
      <div
        class="flex items-center gap-1.5 bg-accent-soft text-fg-muted text-[11px] px-2 py-0.5 rounded"
      >
        <Sparkles size={12} />
        Claude Sonnet
      </div>
      <div class="ml-auto flex items-center gap-1.5">
        {#if isWorking && !demoMode}
          <button
            class="interactive w-6 h-6 flex items-center justify-center bg-error text-white rounded-md"
            onclick={handleInterrupt}
          >
            <Square size={12} />
          </button>
        {/if}
        {#if !isWorking || hasText}
          <button
            class="interactive w-6 h-6 flex items-center justify-center rounded-md {hasText &&
            !demoMode &&
            agent
              ? 'bg-accent text-white'
              : 'bg-fg-disabled text-white'}"
            onclick={handleSend}
            disabled={demoMode || !agent || !hasText}
          >
            <ArrowUp size={12} />
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>
