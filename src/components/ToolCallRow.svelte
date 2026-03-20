<!-- src/components/ToolCallRow.svelte -->
<script lang="ts">
  import { ChevronRight, ChevronDown } from "@lucide/svelte";
  import type { DisplayToolCall, ToolKind } from "../stores/types";

  interface Props {
    toolCall: DisplayToolCall;
  }

  let { toolCall }: Props = $props();
  let expanded = $state(false);

  function toggle() {
    if (!hasPreview) return;
    expanded = !expanded;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  }

  const statusColor: Record<DisplayToolCall["status"], string> = {
    completed: "bg-success",
    failed: "bg-error",
    in_progress: "bg-warning",
    pending: "bg-fg-disabled",
  };

  const kindVerb: Record<ToolKind, string> = {
    read: "Read",
    edit: "Edit",
    delete: "Delete",
    move: "Move",
    search: "Search",
    execute: "Bash",
    think: "Think",
    fetch: "Fetch",
    other: "Tool",
  };

  /** Strip markdown code fences (```lang\n...\n```) from text content. */
  function stripCodeFence(text: string): string {
    return text.replace(/^```\w*\n?/, "").replace(/\n?```\s*$/, "");
  }

  let verb = $derived(kindVerb[toolCall.kind] ?? "Tool");
  let target = $derived(
    toolCall.locations[0] ??
      toolCall.name.replace(/^(Read|Write|Edit|Bash|Search)\s*/i, "") ??
      "",
  );

  let statusLabel = $derived.by(() => {
    if (toolCall.status === "failed") {
      const termContent = toolCall.content.find((c) => c.type === "terminal");
      if (termContent?.type === "terminal" && termContent.exitCode != null) {
        return `exit ${termContent.exitCode}`;
      }
      return "failed";
    }
    if (toolCall.status === "in_progress") return "running";
    if (toolCall.status === "pending") return "pending";
    return null;
  });

  let statusLabelColor = $derived(
    toolCall.status === "failed"
      ? "text-error"
      : toolCall.status === "in_progress"
        ? "text-warning"
        : "text-fg-disabled",
  );

  let hasPreview = $derived(
    toolCall.content.length > 0 &&
      toolCall.kind !== "read" &&
      toolCall.status !== "pending" &&
      toolCall.status !== "in_progress",
  );
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class={hasPreview ? "interactive rounded" : ""}
  onclick={toggle}
  role={hasPreview ? "button" : undefined}
  tabindex={hasPreview ? 0 : undefined}
  onkeydown={hasPreview ? onKeydown : undefined}
>
  <div class="flex items-center gap-2 px-2.5 py-[5px]">
    <span
      class="w-1.5 h-1.5 rounded-full {statusColor[toolCall.status]} shrink-0"
    ></span>
    <span
      class="text-[12px] font-[family-name:var(--font-mono)] font-medium text-fg-default min-w-[44px]"
    >
      {verb}
    </span>
    <span
      class="text-[11px] font-[family-name:var(--font-mono)] text-fg-muted truncate"
    >
      {target}
    </span>
    {#if statusLabel}
      <span class="text-[10px] {statusLabelColor} ml-auto whitespace-nowrap"
        >{statusLabel}</span
      >
    {/if}
    {#if hasPreview}
      <span class="text-fg-disabled" class:ml-auto={!statusLabel}>
        {#if expanded}
          <ChevronDown size={10} />
        {:else}
          <ChevronRight size={10} />
        {/if}
      </span>
    {/if}
  </div>

  {#if expanded}
    {#each toolCall.content as item}
      {#if item.type === "text"}
        <div
          class="mx-2.5 mb-1.5 ml-[30px] rounded bg-[rgba(0,0,0,0.03)] px-2 py-1.5 font-[family-name:var(--font-mono)] text-[10.5px] leading-normal text-fg-muted whitespace-pre-wrap"
        >
          {stripCodeFence(item.text)}
        </div>
      {:else if item.type === "diff"}
        <div
          class="mx-2.5 mb-1.5 ml-[30px] rounded bg-[rgba(0,0,0,0.03)] px-2 py-1.5 font-[family-name:var(--font-mono)] text-[10.5px] leading-normal"
        >
          {#if item.oldText != null}
            {#each item.oldText.split("\n") as line}
              <div class="rounded-sm bg-removed-bg text-removed-fg px-1 -mx-1">
                {`- ${line}`}
              </div>
            {/each}
          {/if}
          {#each item.newText.split("\n") as line}
            <div class="rounded-sm bg-added-bg text-added-fg px-1 -mx-1">
              {`+ ${line}`}
            </div>
          {/each}
        </div>
      {:else if item.type === "terminal" && item.output}
        {@const isFailed = toolCall.status === "failed"}
        <div
          class="mx-2.5 mb-1.5 ml-[30px] rounded px-2 py-1.5 font-[family-name:var(--font-mono)] text-[10.5px] leading-normal whitespace-pre-wrap
          {isFailed
            ? 'bg-[rgba(200,60,60,0.04)] text-removed-fg'
            : 'bg-[rgba(0,0,0,0.03)] text-fg-muted'}"
        >
          {item.output}
        </div>
      {/if}
    {/each}
  {/if}
</div>
