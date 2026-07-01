<!--
  Renders a streaming assistant message block-by-block.

  Instead of revealing text word-by-word, we split the accumulated markdown into
  complete top-level blocks (paragraphs, headings, lists, code fences, $$-math)
  and render each as fully-formatted markdown, fading it in as a unit the moment
  it is complete. The still-generating trailing block stays hidden behind a
  pulsing cursor until it, too, is complete.

  Blocks are rendered independently, so cross-block markdown references
  (footnote definitions, reference-style links defined in a later block) do not
  resolve — a deliberate, accepted trade for smooth block-level streaming.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { renderMarkdown, segmentStream } from "../../lib/render-markdown";

  interface Props {
    content: string;
    streaming: boolean;
  }

  let { content, streaming }: Props = $props();

  // Blocks already present at first mount are pre-existing (a resumed or
  // already-settled message) and must not animate. Only blocks that arrive
  // afterwards — during live streaming — fade in. `untrack` captures the count
  // once at init without subscribing to later prop changes.
  const initialCount = untrack(
    () => segmentStream(content, !streaming).committed.length,
  );

  // Committed blocks are immutable once emitted (only the tail grows), so we can
  // memoize each block's rendered HTML by its raw source and re-render only the
  // newly-arrived block per frame instead of the whole message.
  const htmlCache = new Map<string, string>();
  function renderCached(raw: string): string {
    let html = htmlCache.get(raw);
    if (html === undefined) {
      html = renderMarkdown(raw);
      htmlCache.set(raw, html);
    }
    return html;
  }

  let blocks = $derived(
    segmentStream(content, !streaming).committed.map((raw, i) => ({
      html: renderCached(raw),
      animate: i >= initialCount,
    })),
  );
</script>

<div class="markdown">
  {#each blocks as block, i (i)}
    <div class="md-block" class:block-in={block.animate}>
      {@html block.html}
    </div>
  {/each}
  {#if streaming}
    <span class="stream-cursor" aria-hidden="true"></span>
  {/if}
</div>

<style>
  /* Each block appears as a unit: fade + slight rise + de-blur. filter/transform
     don't establish a block formatting context, so adjacent block margins still
     collapse normally and no sibling reflows while this plays. */
  .block-in {
    animation: block-in 260ms ease-out;
  }

  @keyframes block-in {
    from {
      opacity: 0;
      transform: translateY(6px);
      filter: blur(3px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
      filter: blur(0);
    }
  }

  /* "Generating" affordance shown while the trailing block is still streaming. */
  .stream-cursor {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: var(--color-fg-muted);
    vertical-align: middle;
    animation: cursor-pulse 1.1s ease-in-out infinite;
  }

  @keyframes cursor-pulse {
    0%,
    100% {
      opacity: 0.25;
      transform: scale(0.85);
    }
    50% {
      opacity: 0.9;
      transform: scale(1);
    }
  }
</style>
