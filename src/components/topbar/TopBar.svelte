<script lang="ts">
  import { Pencil, Power } from "@lucide/svelte";
  import type { DisplayThread } from "../../stores/types";

  interface Props {
    agent: DisplayThread | undefined;
    onShutdown?: () => void;
  }

  let { agent, onShutdown }: Props = $props();
</script>

<header
  class="relative flex h-[38px] items-center gap-3 border-b border-border-default bg-bg-base px-4"
>
  <div class="flex min-w-0 flex-1 items-center gap-1.5">
    <h1
      class="truncate text-[13px] font-medium text-fg-heading font-[family-name:var(--font-ui)]"
    >
      {agent?.name ?? "No agent selected"}
    </h1>
    {#if agent}
      <button
        class="pointer-events-none flex h-[22px] w-[22px] items-center justify-center rounded text-fg-disabled opacity-50"
        title="Rename (coming soon)"
        type="button"
      >
        <Pencil size={12} />
      </button>
    {/if}
  </div>
  {#if agent}
    <!-- z-[101] to sit above the drag region overlay (z-[100]) -->
    <div class="relative z-[101] flex shrink-0 items-center gap-0.5">
      <button
        class="flex h-6 items-center gap-[5px] rounded bg-error px-2 text-[11px] font-medium text-white transition-colors duration-100 hover:bg-[#b33535]"
        type="button"
        onclick={() => onShutdown?.()}
      >
        <Power size={13} />
        Shutdown
      </button>
    </div>
  {/if}
</header>
