<script lang="ts">
  interface Props {
    body: string;
  }

  let { body }: Props = $props();
</script>

<div class="ml-[30px] py-1.5 px-2.5">
  <div
    class="bg-[rgba(0,0,0,0.03)] rounded px-2 py-1.5 text-[11px] leading-[1.5] text-fg-muted"
  >
    {body}
  </div>
</div>
