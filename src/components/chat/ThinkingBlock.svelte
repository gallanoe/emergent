<!-- src/components/chat/ThinkingBlock.svelte -->
<script lang="ts">
  import { ChevronRight, ChevronDown } from "@lucide/svelte";
  import { slide } from "svelte/transition";

  interface Props {
    content: string;
    // 'streaming' shimmers the label and labels the block "Thinking".
    // 'done' switches to "Thought" with a solid label color.
    status?: "streaming" | "done";
    // Display-formatted duration, e.g. "2.3s".
    duration?: string;
    // Controlled-optional expanded state; undefined means uncontrolled.
    expanded?: boolean;
    onToggle?: () => void;
  }

  let {
    content,
    status = "done",
    duration,
    expanded,
    onToggle,
  }: Props = $props();

  // Uncontrolled fallback when the caller doesn't pass `expanded`.
  let internalExpanded = $state(false);
  let isExpanded = $derived(expanded ?? internalExpanded);
  let isStreaming = $derived(status === "streaming");

  // Collapsed peek: first ~80 chars of the body on a single line.
  // We normalize whitespace so a block of newlines becomes one line.
  let peek = $derived.by(() => {
    const flat = content.replace(/\s+/g, " ").trim();
    if (flat.length <= 80) return flat;
    return flat.slice(0, 80).trimEnd() + "…";
  });

  function toggle() {
    if (onToggle) {
      onToggle();
    } else {
      internalExpanded = !internalExpanded;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  }
</script>

<div
  class="my-1 flex flex-col overflow-hidden rounded-[7px] border transition-colors"
  class:bg-bg-elevated={isExpanded}
  class:border-border-default={isExpanded}
  class:border-transparent={!isExpanded}
>
  <!-- Header: icon + label + peek + duration + chevron. Whole row toggles. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="interactive flex items-center gap-[9px] px-2.5 py-[5px] min-h-[26px]"
    onclick={toggle}
    role="button"
    tabindex={0}
    onkeydown={onKeydown}
  >
    <span class="inline-flex shrink-0 text-fg-muted">
      <!-- Bespoke 12px `think` SVG from em-tool-calls.jsx:132-139 -->
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
        <path
          d="M8 2.2c-1.7 0-3 1.2-3.1 2.7-.9.2-1.6 1-1.6 1.9 0 .6.3 1.1.7 1.4-.3.3-.5.7-.5 1.2 0 .8.6 1.5 1.3 1.6.1 1.2 1.1 2.2 2.4 2.2.7 0 1.3-.3 1.7-.8.4.5 1 .8 1.7.8 1.3 0 2.3-1 2.4-2.2.7-.1 1.3-.8 1.3-1.6 0-.5-.2-.9-.5-1.2.4-.3.7-.8.7-1.4 0-.9-.7-1.7-1.6-1.9C11 3.4 9.7 2.2 8 2.2z"
          stroke="currentColor"
          stroke-width="1.25"
          stroke-linejoin="round"
        />
        <path
          d="M8 2.2v11.2M5.5 6.8c.5.3 1.1.4 1.6.3M10.5 6.8c-.5.3-1.1.4-1.6.3M6 10c.6.2 1.3.2 1.9 0M10 10c-.6.2-1.3.2-1.9 0"
          stroke="currentColor"
          stroke-width="1.25"
          stroke-linecap="round"
        />
      </svg>
    </span>

    <span
      class="text-[12px] font-[family-name:var(--font-ui)] font-medium whitespace-nowrap shrink-0"
      class:em-shimmer-text={isStreaming}
      class:text-fg-default={!isStreaming}
    >
      {isStreaming ? "Thinking" : "Thought"}
    </span>

    <!-- Peek: collapsed-only italic serif preview of the body. -->
    {#if !isExpanded && peek}
      <span
        class="min-w-0 flex-1 truncate italic text-fg-muted text-[12px]"
        style:font-family="var(--font-content, ui-serif, Georgia, serif)"
      >
        {peek}
      </span>
    {:else}
      <span class="flex-1 min-w-[4px]"></span>
    {/if}

    {#if duration && !isStreaming}
      <span
        class="font-[family-name:var(--font-mono)] text-[10.5px] text-fg-disabled shrink-0"
      >
        {duration}
      </span>
    {/if}
    <span class="text-fg-disabled inline-flex shrink-0 ml-0.5">
      {#if isExpanded}
        <ChevronDown size={10} />
      {:else}
        <ChevronRight size={10} />
      {/if}
    </span>
  </div>

  {#if isExpanded && content}
    <div
      transition:slide={{ duration: 150 }}
      class="border-t border-border-default text-fg-muted text-[12px] whitespace-pre-wrap italic"
      style:padding="10px 14px 12px 32px"
      style:line-height="1.55"
      style:font-family="var(--font-content, ui-serif, Georgia, serif)"
    >
      {content}
    </div>
    {#if duration}
      <div
        class="font-[family-name:var(--font-mono)] text-[10.5px] text-fg-disabled"
        style:padding="0 14px 10px 32px"
      >
        {duration}
      </div>
    {/if}
  {/if}
</div>
