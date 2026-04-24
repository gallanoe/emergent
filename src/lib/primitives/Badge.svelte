<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    children?: Snippet;
    /** Semantic tint. Defaults to neutral (muted fg + hover-bg). */
    tone?: "neutral" | "success" | "warning" | "error" | "info";
  }

  let { children, tone = "neutral" }: Props = $props();

  // Tones tint the background (~10% opacity) and use the tone color for text.
  // Neutral uses the existing hover surface + muted foreground, matching
  // docs/design/v2/project/em-primitives.jsx:245-255.
  const toneStyle = $derived.by(() => {
    switch (tone) {
      case "success":
        return {
          bg: "color-mix(in srgb, var(--color-success) 10%, transparent)",
          color: "var(--color-success)",
          border: "color-mix(in srgb, var(--color-success) 24%, transparent)",
        };
      case "warning":
        return {
          bg: "color-mix(in srgb, var(--color-warning) 10%, transparent)",
          color: "var(--color-warning)",
          border: "color-mix(in srgb, var(--color-warning) 24%, transparent)",
        };
      case "error":
        return {
          bg: "color-mix(in srgb, var(--color-error) 10%, transparent)",
          color: "var(--color-error)",
          border: "color-mix(in srgb, var(--color-error) 24%, transparent)",
        };
      case "info":
        return {
          bg: "color-mix(in srgb, var(--color-accent-text) 10%, transparent)",
          color: "var(--color-accent-text)",
          border:
            "color-mix(in srgb, var(--color-accent-text) 24%, transparent)",
        };
      default:
        return {
          bg: "var(--color-background-hover)",
          color: "var(--color-foreground-muted)",
          border: "var(--color-border)",
        };
    }
  });
</script>

<span
  class="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border px-2 text-[10px] font-semibold tracking-wide uppercase leading-none"
  style:background={toneStyle.bg}
  style:color={toneStyle.color}
  style:border-color={toneStyle.border}
>
  {#if children}{@render children()}{/if}
</span>
