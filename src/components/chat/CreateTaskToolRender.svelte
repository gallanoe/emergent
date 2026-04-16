<script lang="ts">
  import type {
    CreateTaskToolInput,
    CreateTaskToolResult,
  } from "../../lib/emergent-tool-calls";

  interface Props {
    input: CreateTaskToolInput | null;
    result: CreateTaskToolResult | null;
  }

  let { input, result }: Props = $props();
</script>

<div class="px-2.5 py-1.5">
  <div class="rounded bg-[rgba(0,0,0,0.03)] px-2 py-1.5">
    <div class="text-[10px] uppercase tracking-[0.08em] text-fg-disabled">
      Create Task
    </div>
    <div class="mt-1 text-[11px] font-medium text-fg-default">
      {input?.title ?? "Untitled task"}
    </div>
    {#if input?.description}
      <div
        class="mt-1 text-[10.5px] leading-normal text-fg-muted whitespace-pre-wrap"
      >
        {input.description}
      </div>
    {/if}
    <div
      class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[9px] text-fg-disabled"
    >
      <span
        class="rounded bg-bg-selected px-1.5 py-0.5 font-[family-name:var(--font-mono)]"
      >
        {input?.agent_id ?? "unknown-agent"}
      </span>
      {#if input && input.blocker_ids && input.blocker_ids.length > 0}
        <span
          >{input.blocker_ids.length} blocker{input.blocker_ids.length === 1
            ? ""
            : "s"}</span
        >
      {/if}
    </div>
    {#if result?.task_id}
      <div
        class="mt-1.5 text-[10px] font-[family-name:var(--font-mono)] text-fg-disabled"
      >
        Created {result.task_id}
      </div>
    {/if}
  </div>
</div>
