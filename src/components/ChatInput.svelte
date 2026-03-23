<script lang="ts">
  import {
    Sparkles,
    Lightbulb,
    Wand,
    ChevronDown,
    ArrowUp,
    Square,
  } from "@lucide/svelte";
  import ConfigPopover from "./ConfigPopover.svelte";
  import type { ConfigOption, DisplayAgent } from "../stores/types";

  interface Props {
    agent: DisplayAgent | undefined;
    demoMode: boolean;
    onSend: (text: string) => void;
    onInterrupt?: () => void;
    onSetConfig?: (configId: string, value: string) => void;
    externalContent?: { text: string; seq: number } | null;
  }

  let {
    agent,
    demoMode,
    onSend,
    onInterrupt,
    onSetConfig,
    externalContent = null,
  }: Props = $props();
  let message = $state("");
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  // When external content is pushed (edit queue / error dump), set it.
  // Uses a seq counter so identical content can be pushed multiple times.
  let consumedSeq = $state(-1);
  $effect(() => {
    if (externalContent && externalContent.seq !== consumedSeq) {
      consumedSeq = externalContent.seq;
      message = externalContent.text;
      requestAnimationFrame(() => textareaEl?.focus());
    }
  });

  let isWorking = $derived(agent?.status === "working");
  let hasText = $derived(message.trim().length > 0);
  let openConfigId = $state<string | null>(null);

  const CATEGORY_ICONS: Record<string, typeof Sparkles> = {
    model: Sparkles,
    thought_level: Lightbulb,
    mode: Wand,
  };

  const CATEGORY_COLORS: Record<string, string> = {
    model: "bg-[rgba(124,106,78,0.12)] text-[#7c6a4e]",
    thought_level: "bg-[rgba(45,140,80,0.1)] text-[#2d6e46]",
    mode: "bg-[rgba(196,138,26,0.1)] text-[#9a6e10]",
  };

  function flatOptions(opt: ConfigOption): { value: string; name: string }[] {
    if (opt.options.length === 0) return [];
    if (opt.options[0] && "label" in opt.options[0]) {
      return (
        opt.options as {
          label: string;
          options: { value: string; name: string }[];
        }[]
      ).flatMap((g) => g.options);
    }
    return opt.options as { value: string; name: string }[];
  }

  function currentValueName(opt: ConfigOption): string {
    const all = flatOptions(opt);
    return (
      all.find((o) => o.value === opt.current_value)?.name ?? opt.current_value
    );
  }

  function handleSend() {
    const text = message.trim();
    if (!text || demoMode || !agent) return;
    onSend(text);
    message = "";
  }

  function handleInterrupt() {
    if (onInterrupt) onInterrupt();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }
</script>

<div class="px-5 py-3 border-t border-border-default">
  <div
    class="border border-border-strong rounded-lg transition-colors duration-150 focus-within:border-border-focus"
  >
    <textarea
      bind:this={textareaEl}
      class="w-full px-3 py-2.5 text-[12px] text-fg-default bg-transparent resize-none leading-relaxed placeholder:text-fg-disabled outline-none"
      placeholder={demoMode
        ? "Demo mode — input disabled"
        : "Message this agent..."}
      rows="1"
      disabled={demoMode || !agent}
      bind:value={message}
      onkeydown={handleKeydown}
    ></textarea>
    <div class="flex items-center px-3 py-2 border-t border-border-default">
      <div class="flex items-center gap-1.5">
        {#each agent?.configOptions ?? [] as opt, i}
          {#if i > 0}
            <div class="w-px h-3.5 bg-border-default"></div>
          {/if}
          <div class="relative">
            <button
              class="interactive flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border border-transparent hover:border-border-default
                {opt.category && CATEGORY_COLORS[opt.category]
                ? CATEGORY_COLORS[opt.category]
                : 'bg-accent-soft text-fg-muted'}
                {openConfigId === opt.id ? '!border-accent' : ''}"
              onclick={() => {
                openConfigId = openConfigId === opt.id ? null : opt.id;
              }}
              disabled={demoMode || !agent}
            >
              {#if opt.category && CATEGORY_ICONS[opt.category]}
                {@const Icon = CATEGORY_ICONS[opt.category]}
                <Icon size={12} />
              {/if}
              {currentValueName(opt)}
              <ChevronDown
                size={10}
                class="opacity-50 transition-transform duration-150 {openConfigId ===
                opt.id
                  ? ''
                  : 'rotate-180'}"
              />
            </button>
            {#if openConfigId === opt.id}
              <ConfigPopover
                configOption={opt}
                onSelect={(value) => {
                  onSetConfig?.(opt.id, value);
                  openConfigId = null;
                }}
                onClose={() => {
                  openConfigId = null;
                }}
              />
            {/if}
          </div>
        {/each}
      </div>
      <div class="ml-auto flex items-center gap-1.5">
        {#if isWorking && !demoMode}
          <button
            class="interactive w-6 h-6 flex items-center justify-center bg-error text-white rounded-md"
            onclick={handleInterrupt}
          >
            <Square size={12} />
          </button>
        {/if}
        {#if !isWorking || hasText}
          <button
            class="interactive w-6 h-6 flex items-center justify-center rounded-md {hasText &&
            !demoMode &&
            agent
              ? 'bg-accent text-white'
              : 'bg-fg-disabled text-white'}"
            onclick={handleSend}
            disabled={demoMode || !agent || !hasText}
          >
            <ArrowUp size={12} />
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>
