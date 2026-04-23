<script lang="ts">
  import { getLogoUrlForAgent } from "../agent-logos";

  interface Props {
    /** Persisted id from the catalog / agent definition (e.g. claude, codex). */
    provider: string | null;
    /** Spawn command; used to pick a CLI logo when `provider` is missing. */
    cli?: string | null;
    /** Shown as monogram when no logo exists for `provider`. */
    name: string;
    size?: number;
    class?: string;
  }

  let {
    provider,
    cli = null,
    name,
    size = 28,
    class: className = "",
  }: Props = $props();

  const logoUrl = $derived(getLogoUrlForAgent(provider, cli));
  const monogram = $derived(
    name.trim() ? name.trim().charAt(0).toUpperCase() : "?",
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
