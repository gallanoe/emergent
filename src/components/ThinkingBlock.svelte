<!-- src/components/ThinkingBlock.svelte -->
<script lang="ts">
  import { ChevronRight, ChevronDown, Brain } from "@lucide/svelte";
  import { slide } from "svelte/transition";

  interface Props {
    content: string;
  }

  let { content }: Props = $props();
  let expanded = $state(false);

  function toggle() {
    expanded = !expanded;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  }
</script>

<div class="my-1">
  <div
    class="interactive flex items-center gap-2 rounded px-2.5 py-[5px]"
    onclick={toggle}
    role="button"
    tabindex={0}
    onkeydown={onKeydown}
  >
    <Brain size={13} class="text-fg-muted shrink-0" />
    <span
      class="text-[12px] font-[family-name:var(--font-mono)] font-medium text-fg-muted"
    >
      Thinking
    </span>
    <span class="text-fg-disabled ml-auto">
      {#if expanded}
        <ChevronDown size={10} />
      {:else}
        <ChevronRight size={10} />
      {/if}
    </span>
  </div>
  {#if expanded}
    <div
      transition:slide={{ duration: 150 }}
      class="mt-0.5 border-l-2 border-[rgba(124,106,78,0.3)] pl-2.5 text-[12px] text-fg-muted leading-normal whitespace-pre-wrap"
    >
      {content}
    </div>
  {/if}
</div>
