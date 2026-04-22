<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    active?: boolean;
    tone?: "default" | "mono";
    icon?: Snippet;
    iconRight?: Snippet;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  }

  let {
    active = false,
    tone = "default",
    icon,
    iconRight,
    class: className = "",
    onclick,
    children,
  }: Props = $props();

  const bgClass = $derived(
    tone === "mono"
      ? "bg-transparent"
      : active
        ? "bg-bg-hover"
        : "bg-bg-elevated",
  );
  const fgClass = $derived(active ? "text-fg-heading" : "text-fg-muted");
  const borderClass = $derived(
    active ? "border-border-strong" : "border-border-default",
  );
  const shellClass = $derived(
    [
      "inline-flex h-[22px] items-center gap-[5px] rounded-[5px] border px-2 text-[11px] font-medium tracking-[-0.005em]",
      bgClass,
      fgClass,
      borderClass,
      className,
    ].join(" "),
  );
</script>

{#if onclick}
  <button
    type="button"
    class="{shellClass} m-0 cursor-pointer font-inherit text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus"
    {onclick}
  >
    {#if icon}
      <span class="inline-flex shrink-0 text-fg-muted">{@render icon()}</span>
    {/if}
    {@render children()}
    {#if iconRight}
      <span class="inline-flex shrink-0 text-fg-muted"
        >{@render iconRight()}</span
      >
    {/if}
  </button>
{:else}
  <span class="{shellClass} cursor-default">
    {#if icon}
      <span class="inline-flex shrink-0 text-fg-muted">{@render icon()}</span>
    {/if}
    {@render children()}
    {#if iconRight}
      <span class="inline-flex shrink-0 text-fg-muted"
        >{@render iconRight()}</span
      >
    {/if}
  </span>
{/if}
