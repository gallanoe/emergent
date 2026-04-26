<script lang="ts">
  import type {
    UpdateTaskToolInput,
    UpdateTaskToolResult,
  } from "../../lib/emergent-tool-calls";

  interface Props {
    input: UpdateTaskToolInput | null;
    result: UpdateTaskToolResult | null;
  }

  let { input, result }: Props = $props();
</script>

<div class="px-2.5 py-1.5">
  <div class="rounded bg-[rgba(0,0,0,0.03)] px-2 py-1.5">
    <div class="text-[10px] uppercase tracking-[0.08em] text-fg-disabled">
      Update Task
    </div>
    <div
      class="mt-1 text-[11px] font-medium text-fg-default whitespace-pre-wrap"
    >
      {input?.description ?? "Sending update…"}
    </div>
    {#if result?.task_id}
      <div
        class="mt-1.5 text-[10px] font-[family-name:var(--font-mono)] text-fg-disabled"
      >
        {result.task_id}
      </div>
    {/if}
  </div>
</div>
