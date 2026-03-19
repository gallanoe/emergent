<!--
  Renders streaming text with per-word fade-in.
  Settled content is a plain text node; new words fade in with staggered delays.
-->
<script lang="ts">
  interface Props {
    content: string;
    streaming: boolean;
  }

  let { content, streaming }: Props = $props();

  // Characters up to this index render as plain text (no animation).
  let settledLength = $state(0);
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  // Schedule settling: promotes animated words to plain text after animations finish.
  // Does NOT reset when new chunks arrive — only schedules if not already pending.
  function scheduleSettle() {
    if (settleTimer) return;
    settleTimer = setTimeout(() => {
      settleTimer = null;
      settledLength = content.length;
      // If more content arrived while we were settling, schedule again
      if (settledLength < content.length) {
        scheduleSettle();
      }
    }, 250);
  }

  // When content grows, schedule a settle (but don't reset existing timer).
  $effect(() => {
    content.length; // track
    if (streaming && settledLength < content.length) {
      scheduleSettle();
    }
  });

  // When streaming stops, settle everything and clean up.
  $effect(() => {
    if (!streaming) {
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      settledLength = content.length;
    }
  });

  let settledText = $derived(content.slice(0, settledLength));

  // Split unsettled text into words with stagger index for animation delay.
  let newWords = $derived.by(() => {
    const text = content.slice(settledLength);
    if (!text) return [];

    const words: Array<{ text: string; offset: number; index: number }> = [];
    let pos = settledLength;
    let idx = 0;
    for (const match of text.matchAll(/(\S+|\s+)/g)) {
      words.push({ text: match[0], offset: pos, index: idx });
      pos += match[0].length;
      // Only count non-whitespace words for stagger timing
      if (match[0].trim()) idx++;
    }
    return words;
  });
</script>

<span class="streaming-text"
  >{settledText}{#each newWords as word (word.offset)}<span
      class="fade-word"
      style:animation-delay="{word.index * 30}ms">{word.text}</span
    >{/each}</span
>

<style>
  .streaming-text {
    display: inline;
  }

  .fade-word {
    animation: word-fade-in 150ms ease-out forwards;
    opacity: 0;
  }

  @keyframes word-fade-in {
    from {
      opacity: 0;
      filter: blur(2px);
    }
    to {
      opacity: 1;
      filter: blur(0);
    }
  }
</style>
