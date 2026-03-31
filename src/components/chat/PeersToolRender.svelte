<script lang="ts">
  interface Peer {
    id: string;
    name: string;
    status: string;
  }

  interface Props {
    peers: Peer[];
  }

  let { peers }: Props = $props();
</script>

<div class="py-1.5 flex flex-col gap-0.5 px-2.5">
  {#each peers as peer}
    <div
      class="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded bg-[rgba(0,0,0,0.03)]"
    >
      <span
        class="w-1.5 h-1.5 rounded-full shrink-0 {peer.status === 'working'
          ? 'bg-success'
          : peer.status === 'error'
            ? 'bg-error'
            : 'bg-fg-muted'}"
      ></span>
      <span class="font-medium text-fg-default">{peer.name}</span>
      <span class="text-fg-disabled text-[10px] ml-auto">{peer.status}</span>
      <span
        class="text-fg-disabled text-[9px] font-[family-name:var(--font-mono)]"
        >{peer.id}</span
      >
    </div>
  {/each}
</div>
