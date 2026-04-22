<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    value?: string;
    placeholder?: string;
    prefix?: Snippet;
    suffix?: Snippet;
    state?: "default" | "error";
    size?: "sm" | "md" | "lg";
    disabled?: boolean;
    type?: "text" | "search" | "password";
    class?: string;
    onchange?: (value: string) => void;
    oninput?: (value: string) => void;
  }

  let {
    value = $bindable(""),
    placeholder,
    prefix,
    suffix,
    state = "default",
    size = "md",
    disabled = false,
    type = "text",
    class: className = "",
    onchange,
    oninput,
  }: Props = $props();

  const boxHeight = $derived(
    size === "sm" ? "h-[26px]" : size === "lg" ? "h-[34px]" : "h-[30px]",
  );
  const fs = $derived(
    size === "sm"
      ? "text-[11px]"
      : size === "lg"
        ? "text-[13px]"
        : "text-[12px]",
  );

  const borderClass = $derived(
    state === "error" ? "border-error" : "border-border-default",
  );

  const ringClass = $derived(
    state === "error"
      ? "focus-within:border-error focus-within:ring-2 focus-within:ring-error/20"
      : "focus-within:border-border-focus focus-within:ring-2 focus-within:ring-border-focus/25",
  );

  function handleInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    oninput?.(el.value);
  }

  function handleChange(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    onchange?.(el.value);
  }
</script>

<div
  class="flex items-center gap-2 rounded-md border bg-bg-elevated px-2.5 {boxHeight} {borderClass} {ringClass} {className}"
>
  {#if prefix}
    <span class="inline-flex shrink-0 text-fg-muted">{@render prefix()}</span>
  {/if}
  <input
    {type}
    {placeholder}
    {disabled}
    class="min-w-0 flex-1 bg-transparent text-fg-default outline-none placeholder:text-fg-disabled {fs} focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    bind:value
    oninput={handleInput}
    onchange={handleChange}
  />
  {#if suffix}
    <span class="inline-flex shrink-0 text-fg-muted">{@render suffix()}</span>
  {/if}
</div>
