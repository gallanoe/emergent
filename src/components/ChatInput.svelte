<script lang="ts">
  import { Sparkles, SendHorizontal } from "@lucide/svelte";
</script>

<div class="px-5 py-3 border-t border-border-default">
  <div class="border border-border-strong rounded-lg overflow-hidden">
    <textarea
      class="w-full px-3 py-2.5 text-[12px] text-fg-default bg-transparent resize-none leading-relaxed placeholder:text-fg-disabled"
      placeholder="Message this agent..."
      rows="1"
    ></textarea>
    <div class="flex items-center px-3 py-2 border-t border-border-default">
      <div class="flex items-center gap-1.5 bg-accent-soft text-fg-muted text-[11px] px-2 py-0.5 rounded">
        <Sparkles size={12} />
        Claude Sonnet
      </div>
      <button class="interactive ml-auto w-6 h-6 flex items-center justify-center bg-accent text-white rounded-md">
        <SendHorizontal size={12} />
      </button>
    </div>
  </div>
</div>
