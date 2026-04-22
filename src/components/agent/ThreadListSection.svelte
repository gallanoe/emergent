<script lang="ts">
  import { EllipsisVertical, Plus } from "@lucide/svelte";
  import { Button, Mono, SLabel, StatusDot } from "../../lib/primitives";
  import type { DisplayThread } from "../../stores/types";

  interface Props {
    label: string;
    threads: DisplayThread[];
    isTask?: boolean;
    emptyHint?: string;
    onNewThread?: () => void;
    onSelectThread: (id: string) => void;
    onMenu: (thread: DisplayThread, x: number, y: number) => void;
  }

  let {
    label,
    threads,
    isTask = false,
    emptyHint,
    onNewThread,
    onSelectThread,
    onMenu,
  }: Props = $props();
</script>

<section class="flex flex-col gap-[10px]">
  <div class="flex items-baseline gap-[10px]">
    <SLabel>{label}</SLabel>
    <Mono size={10} color="var(--color-fg-disabled)">
      {#snippet children()}{threads.length}{/snippet}
    </Mono>
    <div class="flex-1"></div>
    {#if onNewThread}
      <Button variant="ghost" size="xs" onclick={onNewThread}>
        {#snippet icon()}<Plus size={11} />{/snippet}
        {#snippet children()}New{/snippet}
      </Button>
    {/if}
  </div>
  <div
    class="border border-border-default rounded-[8px] overflow-hidden bg-bg-base"
  >
    <div
      class="grid grid-cols-[20px_1fr_80px_28px] items-center gap-[10px] px-3 py-[6px] bg-bg-elevated border-b border-border-default text-[10px] font-medium text-fg-muted uppercase tracking-[0.06em]"
    >
      <span></span>
      <span>{isTask ? "Session" : "Thread"}</span>
      <span>{isTask ? "Task" : "Updated"}</span>
      <span></span>
    </div>
    {#if threads.length === 0}
      <div class="px-3 py-3 text-[12px] text-fg-disabled">
        {emptyHint ?? "No threads yet."}
      </div>
    {:else}
      <div class="relative">
        <div class="max-h-[240px] overflow-auto">
          {#each threads as thread, i (thread.id)}
            {@const dim = thread.processStatus === "dead"}
            <div
              class="grid grid-cols-[20px_1fr_80px_28px] items-center gap-[10px] px-3 py-[9px] {i ===
              threads.length - 1
                ? ''
                : 'border-b border-border-default'} {dim
                ? 'opacity-[0.55]'
                : ''} text-[12.5px]"
            >
              <StatusDot status={thread.processStatus} size={6} />
              <button
                type="button"
                class="min-w-0 truncate text-left {dim
                  ? 'text-fg-muted'
                  : 'text-fg-heading'}"
                onclick={() => onSelectThread(thread.id)}
              >
                {thread.name}
              </button>
              <Mono size={10} color="var(--color-fg-disabled)">
                {#snippet children()}
                  {isTask ? (thread.taskId ?? "—") : thread.updatedAt}
                {/snippet}
              </Mono>
              <button
                type="button"
                class="text-fg-disabled p-1 rounded justify-self-end"
                title="Thread actions"
                onclick={(e) => {
                  const r = (
                    e.currentTarget as HTMLElement
                  ).getBoundingClientRect();
                  onMenu(thread, r.right, r.bottom + 4);
                }}
              >
                <EllipsisVertical size={12} />
              </button>
            </div>
          {/each}
        </div>
        {#if threads.length > 7}
          <div
            class="absolute inset-x-0 bottom-0 h-7 pointer-events-none"
            style="background: linear-gradient(to bottom, transparent 0%, var(--color-background) 100%);"
          ></div>
        {/if}
      </div>
    {/if}
  </div>
</section>
