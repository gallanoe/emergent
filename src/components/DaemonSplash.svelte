<script lang="ts">
  import { XCircle } from "@lucide/svelte";

  interface Props {
    status: "starting" | "launch_error";
    error: string | null;
    retrying: boolean;
    onRetry: () => void;
  }

  let { status, error, retrying, onRetry }: Props = $props();
</script>

<div class="fixed inset-0 z-[100] flex items-center justify-center bg-bg-base">
  {#if status === "starting" || retrying}
    <div class="flex flex-col items-center gap-3.5">
      <div class="text-[22px] font-semibold text-fg-heading tracking-tight">
        Emergent
      </div>
      <div class="flex items-center gap-1.5">
        <svg
          class="animate-spin"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-warning)"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span class="text-[12px] text-fg-muted">
          {retrying ? "Retrying…" : "Starting…"}
        </span>
      </div>
    </div>
  {:else}
    <div class="flex flex-col items-center gap-3 max-w-[280px] text-center">
      <div
        class="w-8 h-8 rounded-full flex items-center justify-center bg-[rgba(200,60,60,0.08)] text-error"
      >
        <XCircle size={16} />
      </div>
      <div class="text-[13px] font-medium text-fg-heading">
        Couldn't start daemon
      </div>
      {#if error}
        <div class="text-[12px] text-fg-muted leading-relaxed">
          {error}
        </div>
      {/if}
      <button
        class="mt-1 text-[12px] font-medium text-accent-text bg-accent-soft
          border border-[rgba(124,106,78,0.15)] rounded-md px-4 py-1.5
          transition-colors duration-150 hover:bg-[rgba(124,106,78,0.14)]
          disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={retrying}
        onclick={() => onRetry()}
      >
        Retry
      </button>
    </div>
  {/if}
</div>
