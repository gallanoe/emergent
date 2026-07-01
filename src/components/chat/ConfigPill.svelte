<script lang="ts">
  import { ChevronDown, Check } from "@lucide/svelte";
  import { scale } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { SLabel } from "../../lib/primitives";
  import type {
    ConfigOption,
    ConfigSelectGroup,
    ConfigSelectOption,
  } from "../../stores/types";

  interface Props {
    config: ConfigOption;
    /**
     * Controlled open state. The parent (ChatInput) owns which pill is open so
     * that opening any pill — by mouse OR keyboard — reactively closes the
     * others. One-at-a-time behaviour therefore does not depend on the
     * outside-pointer listener below.
     */
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSetConfig: (id: string, value: string) => void;
  }

  let { config, open, onOpenChange, onSetConfig }: Props = $props();

  let rootEl: HTMLDivElement | undefined = $state();

  function isGrouped(
    options: ConfigOption["options"],
  ): options is ConfigSelectGroup[] {
    return (
      options.length > 0 && options[0] !== undefined && "label" in options[0]
    );
  }

  function flatOptions(opt: ConfigOption): ConfigSelectOption[] {
    if (opt.options.length === 0) return [];
    if (isGrouped(opt.options)) return opt.options.flatMap((g) => g.options);
    return opt.options as ConfigSelectOption[];
  }

  // The pill face is value-only: it shows the label of the current selection,
  // falling back to the raw value when no option matches.
  const currentLabel = $derived.by(() => {
    const all = flatOptions(config);
    return (
      all.find((o) => o.value === config.current_value)?.name ??
      config.current_value
    );
  });

  function selectValue(value: string) {
    onSetConfig(config.id, value);
    onOpenChange(false);
  }

  // Dismiss on an outside pointer-down or Escape while open. Only the currently
  // open pill runs this, so at most one document listener is ever attached.
  $effect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (rootEl && !rootEl.contains(t)) onOpenChange(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  });
</script>

{#snippet optionRow(opt: ConfigSelectOption)}
  <button
    type="button"
    role="menuitemradio"
    aria-checked={opt.value === config.current_value}
    class="flex w-full items-center gap-2 rounded-[6px] px-2 py-[6px] text-left text-[11.5px] {opt.value ===
    config.current_value
      ? 'bg-bg-selected text-fg-heading'
      : 'text-fg-default hover:bg-bg-hover'}"
    onclick={() => selectValue(opt.value)}
  >
    <span class="w-4 shrink-0 text-center">
      {#if opt.value === config.current_value}
        <Check size={12} />
      {/if}
    </span>
    <span class="min-w-0 flex-1 truncate" title={opt.name}>{opt.name}</span>
  </button>
{/snippet}

<div bind:this={rootEl} class="relative">
  <button
    type="button"
    class="group inline-flex h-[28px] items-center gap-[5px] rounded-full px-[10px] text-[11.5px] font-medium transition-all duration-100 ease-out active:scale-[0.94] {open
      ? 'bg-bg-active text-fg-heading'
      : 'bg-bg-hover text-fg-default hover:bg-bg-active hover:text-fg-heading'}"
    title={config.name}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => onOpenChange(!open)}
  >
    <span class="max-w-[140px] truncate">{currentLabel}</span>
    <ChevronDown
      size={10}
      class="transition-all duration-150 ease-out {open
        ? 'rotate-180 text-fg-muted'
        : 'text-fg-disabled group-hover:text-fg-muted'}"
    />
  </button>

  {#if open}
    <!-- Left-anchored above the pill; the composer button row lives at the
         bottom of the screen so the menu opens upward. It grows/shrinks from
         its bottom-left corner (nearest the pill). -->
    <div
      role="menu"
      aria-label={config.name}
      transition:scale={{
        duration: 130,
        start: 0.95,
        opacity: 0,
        easing: cubicOut,
      }}
      style="transform-origin: bottom left;"
      class="absolute bottom-[calc(100%+6px)] left-0 z-10 min-w-[200px] max-w-[300px] rounded-[10px] border border-border-strong bg-bg-elevated p-[6px] shadow-[var(--shadow-lg)]"
    >
      <div class="px-2 pb-1 pt-0.5">
        <SLabel>{config.name}</SLabel>
      </div>
      <div class="max-h-[min(360px,60vh)] overflow-y-auto">
        {#if isGrouped(config.options)}
          {#each config.options as group, gi (group.label)}
            {#if gi > 0}
              <div class="my-1 h-px bg-border-default"></div>
            {/if}
            <div class="px-2 pb-1 pt-1 text-[10px] font-semibold text-fg-muted">
              {group.label}
            </div>
            {#each group.options as opt (opt.value)}
              {@render optionRow(opt)}
            {/each}
          {/each}
        {:else}
          {#each config.options as opt (opt.value)}
            {@render optionRow(opt)}
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>
