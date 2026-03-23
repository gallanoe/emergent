<script lang="ts">
  import { Check } from "@lucide/svelte";
  import type { ConfigOption, ConfigSelectGroup } from "../stores/types";

  interface Props {
    configOption: ConfigOption;
    onSelect: (value: string) => void;
    onClose: () => void;
  }

  let { configOption, onSelect, onClose }: Props = $props();

  let popoverEl: HTMLDivElement | undefined = $state();

  function isGrouped(
    options: ConfigOption["options"],
  ): options is ConfigSelectGroup[] {
    return (
      options.length > 0 && options[0] !== undefined && "label" in options[0]
    );
  }

  function handleSelect(value: string) {
    onSelect(value);
    onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  function handleClickOutside(e: MouseEvent) {
    if (popoverEl && !popoverEl.contains(e.target as Node)) {
      onClose();
    }
  }

  $effect(() => {
    document.addEventListener("keydown", handleKeydown);
    // Delay to avoid catching the badge click that opened us
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 0);
    return () => {
      document.removeEventListener("keydown", handleKeydown);
      clearTimeout(timer);
      document.removeEventListener("click", handleClickOutside);
    };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
  bind:this={popoverEl}
  onclick={(e) => e.stopPropagation()}
  class="absolute bottom-full mb-1.5 left-0 bg-bg-base border border-border-strong rounded-md shadow-sm py-1 min-w-[140px] z-10"
>
  <div
    class="text-[9px] font-semibold text-fg-muted px-2 py-1 uppercase tracking-wider"
  >
    {configOption.name}
  </div>

  {#if isGrouped(configOption.options)}
    {#each configOption.options as group, gi}
      {#if gi > 0}
        <div class="h-px bg-border-default my-1"></div>
      {/if}
      <div class="text-[10px] font-semibold text-fg-muted px-2 py-1">
        {group.label}
      </div>
      {#each group.options as opt}
        <button
          class="interactive flex items-start gap-1.5 w-full px-2 py-1 text-[11px] text-left
            {opt.value === configOption.current_value
            ? 'text-accent-text font-medium bg-accent-soft'
            : 'text-fg-default'}"
          onclick={() => handleSelect(opt.value)}
        >
          <span class="w-3.5 text-center shrink-0 mt-px">
            {#if opt.value === configOption.current_value}
              <Check size={11} />
            {/if}
          </span>
          {opt.name}
        </button>
      {/each}
    {/each}
  {:else}
    {#each configOption.options as opt}
      <button
        class="interactive flex items-start gap-1.5 w-full px-2 py-1 text-[11px] text-left
          {opt.value === configOption.current_value
          ? 'text-accent-text font-medium bg-accent-soft'
          : 'text-fg-default'}"
        onclick={() => handleSelect(opt.value)}
      >
        <span class="w-3.5 text-center shrink-0">
          {#if opt.value === configOption.current_value}
            <Check size={11} />
          {/if}
        </span>
        {opt.name}
      </button>
    {/each}
  {/if}
</div>
