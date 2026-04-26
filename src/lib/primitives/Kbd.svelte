<script lang="ts">
  interface Props {
    keys: string[];
  }

  let { keys }: Props = $props();
</script>

<span class="inline-flex items-center gap-[3px]">
  {#each keys as key (key)}
    <span
      class="inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded border border-border-default bg-bg-elevated px-[5px] font-mono text-[10px] font-medium text-fg-muted leading-none"
      >{key}</span
    >
  {/each}
</span>
