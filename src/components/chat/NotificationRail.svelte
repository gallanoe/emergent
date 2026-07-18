<script lang="ts">
  interface Props {
    state: "pending" | "submitted";
    source: "task" | "thread";
    label: string;
    taskStatus?: "started" | "update" | "completed" | "failed" | "ready";
    content: string;
    onJump?: () => void;
  }

  let { state, source, label, taskStatus, content, onJump }: Props = $props();

  // Status glyph color for task rails only. started/update are neutral
  // (still in-progress, no verdict yet) — mirrors the muted/colored split in
  // ToolStatusGlyph.svelte and the QueuedMessages status dot.
  const STATUS_DOT_CLASS: Partial<
    Record<NonNullable<Props["taskStatus"]>, string>
  > = {
    completed: "bg-success",
    failed: "bg-error",
    ready: "bg-warning",
  };

  let jumpLabel = $derived(source === "thread" ? "View thread" : "Open task");
  let dotClass = $derived(
    (taskStatus && STATUS_DOT_CLASS[taskStatus]) || "bg-fg-disabled",
  );
</script>

<div
  data-testid="notification-rail"
  data-state={state}
  class="flex flex-col gap-[6px] border-l-2 border-l-border-strong pl-[14px] {state ===
  'pending'
    ? 'border-dashed opacity-[0.68]'
    : 'border-solid opacity-100'}"
>
  <div class="flex items-center gap-2">
    <span class="text-[12.5px] font-semibold text-fg-heading">{label}</span>
    {#if source === "task" && taskStatus}
      <span
        class="inline-block h-[6px] w-[6px] shrink-0 rounded-full {dotClass}"
        aria-label={taskStatus}
      ></span>
    {/if}
    <div class="min-w-0 flex-1"></div>
    {#if onJump}
      <button
        type="button"
        class="text-[11px] text-fg-muted transition-colors duration-[var(--duration-quick)] hover:text-fg-heading"
        onclick={onJump}>{jumpLabel}</button
      >
    {/if}
  </div>
  <div class="text-[12.5px] leading-[1.55] text-fg-default">{content}</div>
</div>
