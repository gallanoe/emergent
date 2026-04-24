<script lang="ts">
  import { AgentAvatar, StatusDot, Kbd } from "../lib/primitives";

  export type ThreadHit = {
    id: string;
    name: string;
    agentId: string;
    agentName: string;
    agentProvider: string;
    status: "idle" | "working" | "initializing" | "error" | "dead";
  };

  interface Props {
    threads: ThreadHit[];
    onSelect: (threadId: string) => void;
    onClose: () => void;
  }

  let { threads, onSelect, onClose }: Props = $props();

  let query = $state("");
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();

  let filtered = $derived.by<ThreadHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => t.name.toLowerCase().includes(q));
  });

  $effect(() => {
    // Clamp selection when results shrink.
    if (selectedIndex >= filtered.length) {
      selectedIndex = Math.max(0, filtered.length - 1);
    }
  });

  $effect(() => {
    // Autofocus on mount.
    inputEl?.focus();
  });

  function handleKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length > 0) {
        selectedIndex = (selectedIndex + 1) % filtered.length;
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length > 0) {
        selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = filtered[selectedIndex];
      if (hit) onSelect(hit.id);
      return;
    }
  }

  $effect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 backdrop-blur-[2px] pt-[18vh]"
  data-testid="search-overlay"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
>
  <div
    class="w-[520px] max-w-[90vw] rounded-[10px] border border-border-strong bg-bg-elevated shadow-[var(--shadow-lg)] overflow-hidden"
    role="dialog"
    aria-modal="true"
    aria-label="Thread search"
  >
    <div
      class="flex items-center gap-2 px-3 py-2.5 border-b border-border-default"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        class="text-fg-muted shrink-0"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" stroke-linecap="round" />
      </svg>
      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        placeholder="Search threads..."
        class="flex-1 bg-transparent text-[13px] text-fg-default placeholder:text-fg-disabled outline-none"
      />
      <Kbd keys={["Esc"]} />
    </div>

    <div class="max-h-[320px] overflow-y-auto">
      {#if filtered.length === 0}
        <div class="px-3 py-6 text-center text-[12px] text-fg-disabled">
          No results
        </div>
      {:else}
        {#each filtered as hit, i (hit.id)}
          <button
            type="button"
            class="w-full flex items-center gap-2.5 px-3 py-[7px] text-left transition-colors
              {i === selectedIndex ? 'bg-bg-selected' : 'hover:bg-bg-hover'}"
            onmouseenter={() => (selectedIndex = i)}
            onclick={() => onSelect(hit.id)}
          >
            <AgentAvatar
              provider={hit.agentProvider}
              name={hit.agentName}
              size={16}
            />
            <StatusDot status={hit.status} size={6} />
            <span class="text-[12.5px] text-fg-heading truncate"
              >{hit.name}</span
            >
            <span class="text-[11px] text-fg-muted truncate ml-auto"
              >{hit.agentName}</span
            >
          </button>
        {/each}
      {/if}
    </div>
  </div>
</div>
