<script lang="ts">
  import type { MailboxMessage } from "../../stores/types";

  interface Props {
    messages: MailboxMessage[];
  }

  let { messages }: Props = $props();
</script>

<div class="py-1.5 flex flex-col gap-1 px-2.5">
  {#each messages as msg}
    <div
      class="bg-[rgba(0,0,0,0.03)] rounded px-2 py-1.5 text-[11px] leading-[1.5]"
    >
      <div class="flex items-center gap-1.5 mb-0.5 text-[10px]">
        <span class="font-semibold text-success">{msg.sender}</span>
        <span class="text-fg-disabled ml-auto">{msg.timestamp}</span>
      </div>
      <div class="text-fg-default">{msg.body}</div>
    </div>
  {/each}
</div>
