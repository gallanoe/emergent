<script lang="ts">
  import { ChevronDown, Check } from "@lucide/svelte";
  import { SLabel, Mono } from "../../lib/primitives";
  import type { ConfigOption, ConfigSelectGroup } from "../../stores/types";

  interface Props {
    configs: ConfigOption[];
    onSetConfig: (id: string, value: string) => void;
    onClose: () => void;
  }

  let { configs, onSetConfig, onClose }: Props = $props();

  let rootEl: HTMLDivElement | undefined = $state();
  let expandedId = $state<string | null>(null);

  function isGrouped(
    options: ConfigOption["options"],
  ): options is ConfigSelectGroup[] {
    return (
      options.length > 0 && options[0] !== undefined && "label" in options[0]
    );
  }

  function flatOptions(opt: ConfigOption): { value: string; name: string }[] {
    if (opt.options.length === 0) return [];
    if (isGrouped(opt.options)) {
      return opt.options.flatMap((g) => g.options);
    }
    return opt.options as { value: string; name: string }[];
  }

  function currentValueLabel(opt: ConfigOption): string {
    const all = flatOptions(opt);
    return (
      all.find((o) => o.value === opt.current_value)?.name ?? opt.current_value
    );
  }

  function selectValue(configId: string, value: string) {
    onSetConfig(configId, value);
    onClose();
  }

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  $effect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (rootEl && !rootEl.contains(t)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  });

  type ConfigGroup = { category: string | undefined; items: ConfigOption[] };

  const grouped = $derived.by((): ConfigGroup[] => {
    const out: ConfigGroup[] = [];
    for (const c of configs) {
      const last = out[out.length - 1];
      if (last && last.category === c.category) {
        last.items.push(c);
      } else {
        out.push({ category: c.category, items: [c] });
      }
    }
    return out;
  });
</script>

<div
  bind:this={rootEl}
  class="absolute bottom-[calc(100%+6px)] right-0 z-10 w-[280px] rounded-[10px] border border-border-strong bg-bg-elevated p-[6px] shadow-[var(--shadow-lg)]"
  role="presentation"
  onclick={(e) => e.stopPropagation()}
>
  <div class="max-h-[min(420px,70vh)] overflow-y-auto">
    {#each grouped as g, gi (`${g.category ?? "default"}-${g.items.map((x) => x.id).join("-")}-${gi}`)}
      {#if g.category}
        <div class="px-1 pb-1 pt-2 first:pt-0">
          <SLabel>{g.category}</SLabel>
        </div>
      {/if}
      {#each g.items as c (c.id)}
        <div class="rounded-[6px] px-1 py-0.5">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-[6px] px-2 py-[7px] text-left text-[12px] text-fg-default hover:bg-bg-hover"
            onclick={() => toggleExpand(c.id)}
          >
            <span class="min-w-0 flex-1 truncate font-medium">{c.name}</span>
            <Mono class="!font-normal shrink-0" size={10.5}
              >{currentValueLabel(c)}</Mono
            >
            <ChevronDown
              size={12}
              class="shrink-0 text-fg-disabled transition-transform {expandedId ===
              c.id
                ? 'rotate-180'
                : ''}"
            />
          </button>
          {#if expandedId === c.id}
            <div class="border-t border-border-default px-1 pb-1 pt-1">
              {#if isGrouped(c.options)}
                {#each c.options as group, gi (group.label)}
                  {#if gi > 0}
                    <div class="my-1 h-px bg-border-default"></div>
                  {/if}
                  <div
                    class="px-2 pb-1 pt-1 text-[10px] font-semibold text-fg-muted"
                  >
                    {group.label}
                  </div>
                  {#each group.options as opt (opt.value)}
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 rounded-[6px] px-2 py-[6px] text-left text-[11.5px] {opt.value ===
                      c.current_value
                        ? 'bg-bg-selected text-fg-heading'
                        : 'text-fg-default hover:bg-bg-hover'}"
                      onclick={() => selectValue(c.id, opt.value)}
                    >
                      <span class="w-4 shrink-0 text-center">
                        {#if opt.value === c.current_value}
                          <Check size={12} />
                        {/if}
                      </span>
                      <span class="min-w-0 flex-1">{opt.name}</span>
                    </button>
                  {/each}
                {/each}
              {:else}
                {#each c.options as opt (opt.value)}
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 rounded-[6px] px-2 py-[6px] text-left text-[11.5px] {opt.value ===
                    c.current_value
                      ? 'bg-bg-selected text-fg-heading'
                      : 'text-fg-default hover:bg-bg-hover'}"
                    onclick={() => selectValue(c.id, opt.value)}
                  >
                    <span class="w-4 shrink-0 text-center">
                      {#if opt.value === c.current_value}
                        <Check size={12} />
                      {/if}
                    </span>
                    <span class="min-w-0 flex-1">{opt.name}</span>
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/each}
  </div>
</div>
