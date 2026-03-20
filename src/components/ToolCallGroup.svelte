<!-- src/components/ToolCallGroup.svelte -->
<script lang="ts">
  import ToolCallRow from "./ToolCallRow.svelte";
  import type { DisplayToolCall } from "../stores/types";

  interface Props {
    toolCalls: DisplayToolCall[];
  }

  let { toolCalls }: Props = $props();
</script>

<div class="border border-border-default rounded-[6px] overflow-hidden">
  {#each toolCalls as toolCall, i (toolCall.id)}
    {#if i > 0}
      <div class="border-t border-border-default"></div>
    {/if}
    <ToolCallRow {toolCall} />
  {/each}
</div>
