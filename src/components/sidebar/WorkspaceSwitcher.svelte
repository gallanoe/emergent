<script lang="ts">
  import { ChevronDown, Cog, Plus } from "@lucide/svelte";
  import type { ContainerStatus, DisplayWorkspace } from "../../stores/types";
  import { Mono } from "../../lib/primitives";

  interface Props {
    workspaces: DisplayWorkspace[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onOpenWorkspaceSettings: () => void;
    onCreateWorkspace: () => void;
    onOpenOverview: () => void;
    overviewActive?: boolean;
  }

  let {
    workspaces,
    selectedId,
    onSelect,
    onOpenWorkspaceSettings,
    onCreateWorkspace,
    onOpenOverview,
    overviewActive = false,
  }: Props = $props();

  let open = $state(false);
  let rootEl: HTMLDivElement | undefined = $state();

  const current = $derived(
    (workspaces.find((w) => w.id === selectedId) ?? workspaces[0]) as
      | DisplayWorkspace
      | undefined,
  );

  function statusDotClass(s: ContainerStatus) {
    if (s.state === "running") return "bg-success";
    if (s.state === "building") return "bg-warning";
    return "bg-fg-disabled";
  }

  function statusLabel(s: ContainerStatus) {
    if (s.state === "error") return "Error";
    return s.state.charAt(0).toUpperCase() + s.state.slice(1);
  }

  $effect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (rootEl && !rootEl.contains(t)) {
        open = false;
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") open = false;
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  });
</script>

{#if current}
  <div
    bind:this={rootEl}
    class="relative flex items-stretch gap-[2px] rounded-[7px] transition-colors"
    class:bg-bg-selected={open || overviewActive}
  >
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-2 rounded-[7px] px-[6px] py-[6px] text-left transition-colors
        {open || overviewActive ? '' : 'hover:bg-bg-hover'}"
      title="Workspace overview"
      onclick={onOpenOverview}
    >
      <span
        class="size-5 shrink-0 rounded-[5px] bg-fg-heading text-bg-base flex items-center justify-center text-[11px] font-bold tracking-tight"
      >
        {current.name.charAt(0).toUpperCase()}
      </span>
      <span class="flex flex-1 min-w-0 items-center gap-1.5">
        <span
          class="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg-heading"
          >{current.name}</span
        >
        <span
          class="size-1.5 shrink-0 rounded-full {statusDotClass(
            current.containerStatus,
          )}"
          title={statusLabel(current.containerStatus)}
        ></span>
      </span>
    </button>
    <button
      type="button"
      class="inline-flex shrink-0 items-center justify-center rounded-[7px] px-[6px] text-fg-disabled transition-colors
        {open || overviewActive ? '' : 'hover:bg-bg-hover'}"
      title="Switch workspace"
      aria-expanded={open}
      aria-haspopup="listbox"
      onclick={() => (open = !open)}
    >
      <ChevronDown size={10} />
    </button>
    {#if open}
      <div
        class="absolute top-[calc(100%+6px)] left-0 z-10 w-[260px] rounded-[10px] border border-border-strong bg-bg-elevated p-[6px] shadow-[var(--shadow-lg)]"
        role="presentation"
        onclick={(e) => e.stopPropagation()}
      >
        {#each workspaces as w (w.id)}
          {@const sel = w.id === selectedId}
          <button
            type="button"
            class="flex w-full items-center gap-2.5 rounded-[6px] px-2 py-[7px] text-left text-[12.5px] transition-colors
              {sel
              ? 'bg-bg-selected text-fg-heading hover:brightness-[0.99]'
              : 'text-fg-default hover:bg-bg-hover'}"
            onclick={() => {
              onSelect(w.id);
              open = false;
            }}
          >
            <span
              class="size-5 shrink-0 rounded-[5px] bg-fg-heading text-bg-base flex items-center justify-center text-[11px] font-bold"
              >{w.name.charAt(0).toUpperCase()}</span
            >
            <span class="min-w-0 flex-1 truncate">{w.name}</span>
            <Mono class="!font-normal !capitalize text-fg-disabled" size={10}
              >{statusLabel(w.containerStatus)}</Mono
            >
          </button>
        {/each}
        <div class="h-px bg-border-default my-[6px] mx-[2px]"></div>
        <button
          type="button"
          class="flex w-full items-center gap-2.5 rounded-[6px] px-2 py-[7px] text-left text-[12.5px] text-fg-muted transition-colors hover:bg-bg-hover"
          onclick={() => {
            onOpenWorkspaceSettings();
            open = false;
          }}
        >
          <Cog size={11} />
          <span>Workspace settings</span>
        </button>
        <button
          type="button"
          class="flex w-full items-center gap-2.5 rounded-[6px] px-2 py-[7px] text-left text-[12.5px] text-fg-muted transition-colors hover:bg-bg-hover"
          onclick={() => {
            onCreateWorkspace();
            open = false;
          }}
        >
          <Plus size={11} />
          <span>New workspace</span>
        </button>
      </div>
    {/if}
  </div>
{/if}
