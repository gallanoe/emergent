<script lang="ts">
  import { getCliLogo } from "../agent-logos";

  interface Props {
    cli: string;
    size?: number;
    class?: string;
  }

  let { cli, size = 28, class: className = "" }: Props = $props();

  const logoUrl = $derived(getCliLogo(cli));
  const monogram = $derived(
    cli.trim() ? cli.trim().charAt(0).toUpperCase() : "?",
  );
</script>

{#if logoUrl}
  <img
    src={logoUrl}
    width={size}
    height={size}
    alt=""
    class="object-contain {className}"
  />
{:else}
  <span
    class="inline-flex items-center justify-center rounded-[5px] border border-border-default bg-bg-elevated text-[11px] font-medium text-fg-heading {className}"
    style:width="{size}px"
    style:height="{size}px">{monogram}</span
  >
{/if}
