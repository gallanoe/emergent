<script lang="ts">
  import type { Snippet } from "svelte";
  import Kbd from "./Kbd.svelte";

  interface Props {
    variant?: "primary" | "secondary" | "ghost" | "danger" | "link";
    size?: "xs" | "sm" | "md" | "lg";
    icon?: Snippet;
    iconRight?: Snippet;
    kbd?: string[];
    disabled?: boolean;
    fullWidth?: boolean;
    type?: "button" | "submit" | "reset";
    title?: string;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  }

  let {
    variant = "secondary",
    size = "md",
    icon,
    iconRight,
    kbd,
    disabled = false,
    fullWidth = false,
    type = "button",
    title,
    class: className = "",
    onclick,
    children,
  }: Props = $props();

  const sz = $derived.by(() => {
    switch (size) {
      case "xs":
        return {
          h: "h-[22px]",
          px: "px-2",
          fs: "text-[11px]",
          gap: "gap-1.5",
          icon: 11,
          r: "rounded-[5px]",
        };
      case "sm":
        return {
          h: "h-[26px]",
          px: "px-2.5",
          fs: "text-[12px]",
          gap: "gap-1.5",
          icon: 12,
          r: "rounded-md",
        };
      case "lg":
        return {
          h: "h-9",
          px: "px-4",
          fs: "text-[13px]",
          gap: "gap-2",
          icon: 14,
          r: "rounded-lg",
        };
      default:
        return {
          h: "h-[30px]",
          px: "px-3",
          fs: "text-[12px]",
          gap: "gap-[7px]",
          icon: 13,
          r: "rounded-[7px]",
        };
    }
  });

  const variantClass = $derived.by(() => {
    switch (variant) {
      case "primary":
        return "border border-transparent bg-accent text-accent-fg";
      case "ghost":
        return "border border-transparent bg-transparent text-fg-muted";
      case "danger":
        return "border border-border-default bg-transparent text-error";
      case "link":
        return "h-auto border-0 bg-transparent px-0 py-0 text-fg-heading underline decoration-border-strong underline-offset-2";
      default:
        return "border border-border-default bg-bg-elevated text-fg-heading";
    }
  });

  const focusClass =
    "focus-visible:outline-none focus-visible:border-border-focus focus-visible:shadow-[0_0_0_3px_var(--accent-ring)]";

  const layoutClass = $derived(
    variant === "link"
      ? `inline-flex cursor-default items-center gap-1 font-medium tracking-[-0.005em] font-[family-name:var(--font-ui)] transition-[background,color,border-color,box-shadow] duration-150 ease-out select-none ${focusClass}`
      : `inline-flex cursor-default items-center justify-center font-medium tracking-[-0.005em] font-[family-name:var(--font-ui)] transition-[background,color,border-color,box-shadow] duration-150 ease-out select-none ${sz.h} ${sz.px} ${sz.fs} ${sz.gap} ${sz.r} ${focusClass}`,
  );
</script>

<button
  {type}
  {title}
  {disabled}
  class="{layoutClass} {variantClass} {fullWidth
    ? 'w-full'
    : ''} disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 {className}"
  onclick={disabled ? undefined : onclick}
>
  {#if icon}
    <span
      class="inline-flex shrink-0 items-center justify-center opacity-90"
      style:width="{sz.icon}px"
      style:height="{sz.icon}px">{@render icon()}</span
    >
  {/if}
  {@render children()}
  {#if iconRight}
    <span
      class="inline-flex shrink-0 items-center justify-center opacity-70"
      style:width="{sz.icon}px"
      style:height="{sz.icon}px">{@render iconRight()}</span
    >
  {/if}
  {#if kbd && kbd.length > 0}
    <span class="ml-1 inline-flex shrink-0"><Kbd keys={kbd} /></span>
  {/if}
</button>
