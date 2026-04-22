<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    color?: string;
    class?: string;
    children: Snippet;
  }

  let {
    color = "var(--color-fg-muted)",
    class: className = "",
    children,
  }: Props = $props();
</script>

<div
  class="text-[10px] font-semibold uppercase tracking-[0.08em] font-[family-name:var(--font-ui)] {className}"
  style:color
>
  {@render children()}
</div>
