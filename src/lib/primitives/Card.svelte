<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    padding?: number;
    class?: string;
    children: Snippet;
  }

  let { padding = 14, class: className = "", children }: Props = $props();
</script>

<div
  class="rounded-lg border border-border-default bg-bg-elevated {className}"
  style:padding="{padding}px"
>
  {@render children()}
</div>
