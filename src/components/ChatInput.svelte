<script lang="ts">
  import { Sparkles, SendHorizontal } from "@lucide/svelte";
  import type { DisplayAgent } from "../stores/types";

  interface Props {
    agent: DisplayAgent | undefined;
    demoMode: boolean;
    onSend: (text: string) => void;
  }

  let { agent, demoMode, onSend }: Props = $props();
  let message = $state("");

  function handleSend() {
    const text = message.trim();
    if (!text || demoMode || !agent) return;
    onSend(text);
    message = "";
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
      class="w-full px-3 py-2.5 text-[12px] text-fg-default bg-transparent resize-none leading-relaxed placeholder:text-fg-disabled"
      placeholder={demoMode ? "Demo mode — input disabled" : "Message this agent..."}
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
      <button
        class="interactive ml-auto w-6 h-6 flex items-center justify-center bg-accent text-white rounded-md"
        onclick={handleSend}
        disabled={demoMode || !agent || !message.trim()}
      >
        <SendHorizontal size={12} />
      </button>
    </div>
  </div>
</div>
