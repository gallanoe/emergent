<script lang="ts">
  import type { SwarmMessageLogEntry } from "../stores/types";

  interface Props {
    entries: SwarmMessageLogEntry[];
  }

  let { entries }: Props = $props();
</script>

<div class="flex flex-col min-h-0">
  <div class="flex items-center gap-2.5 px-5 py-2">
    <span
      class="text-[10px] font-medium uppercase tracking-wider text-fg-muted whitespace-nowrap"
    >
      Activity
    </span>
    <div class="flex-1 h-px bg-border-default"></div>
  </div>

  <div class="flex-1 overflow-y-auto px-5 pb-4">
    {#if entries.length === 0}
      <div class="text-[11px] text-fg-disabled py-4">No activity yet</div>
    {:else}
      <div class="flex flex-col gap-1.5">
        {#each [...entries].reverse() as entry (entry.id)}
          <div class="flex items-start gap-2.5">
            <span
              class="text-[9px] text-fg-disabled min-w-[36px] pt-px text-right"
            >
              {entry.timestamp}
            </span>
            <div class="flex-1 min-w-0">
              <div class="text-[11px]">
                <span class="font-medium text-fg-heading">{entry.fromName}</span
                >
                <span class="text-fg-disabled"> → </span>
                <span class="font-medium text-fg-heading">{entry.toName}</span>
              </div>
              <div
                class="text-[11px] text-fg-muted leading-snug mt-0.5 break-words"
              >
                {entry.preview}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
