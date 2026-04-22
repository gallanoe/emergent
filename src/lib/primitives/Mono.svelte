<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    size?: number;
    color?: string;
    class?: string;
    children: Snippet;
  }

  let {
    size = 11,
    color = "var(--color-fg-muted)",
    class: className = "",
    children,
  }: Props = $props();
</script>

<span
  class="font-mono {className}"
  style:font-size="{size}px"
  style:color
  style:font-variant-ligatures="none">{@render children()}</span
>
