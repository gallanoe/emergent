<script lang="ts">
  import type { CompleteTaskToolResult } from "../../lib/emergent-tool-calls";

  interface Props {
    result: CompleteTaskToolResult | null;
  }

  let { result }: Props = $props();
</script>

<div class="px-2.5 py-1.5">
  <div class="rounded bg-[rgba(0,0,0,0.03)] px-2 py-1.5">
    <div class="flex items-center gap-2">
      <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success"></span>
      <span class="text-[10px] uppercase tracking-[0.08em] text-fg-disabled">Task Completed</span>
    </div>
    <div class="mt-1 text-[11px] font-[family-name:var(--font-mono)] text-fg-default">
      {result?.task_id ?? "Unknown task"}
    </div>
  </div>
</div>
