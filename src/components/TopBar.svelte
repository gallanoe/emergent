<script lang="ts">
  import type { Agent } from "../stores/mock-data.svelte";

  interface Props {
    agent: Agent | undefined;
  }

  let { agent }: Props = $props();
</script>

<header
  class="flex items-center h-[38px] px-5 border-b border-border-default bg-bg-base"
>
  <h1
    class="text-[13px] font-medium text-fg-heading truncate font-[family-name:var(--font-ui)]"
  >
    {agent?.name ?? "No agent selected"}
  </h1>
</header>
