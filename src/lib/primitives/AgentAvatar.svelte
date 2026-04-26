<script lang="ts">
  import { getLogoUrlForAgent } from "../agent-logos";
  import StatusDot from "./StatusDot.svelte";

  interface Props {
    /** Persisted id from the catalog / agent definition (e.g. claude, codex). */
    provider: string | null;
    /** Spawn command; used to pick a CLI logo when `provider` is missing. */
    cli?: string | null;
    /** Shown as monogram when no logo exists for `provider`. */
    name: string;
    size?: number;
    class?: string;
    /** When true, overlays a StatusDot at bottom-right. */
    showStatus?: boolean;
    status?: "idle" | "working" | "initializing";
  }

  let {
    provider,
    cli = null,
    name,
    size = 28,
    class: className = "",
    showStatus = false,
    status = "idle",
  }: Props = $props();

  const logoUrl = $derived(getLogoUrlForAgent(provider, cli));
  const monogram = $derived(
    name.trim() ? name.trim().charAt(0).toUpperCase() : "?",
  );
  // Proportional sizing per docs/design/v2/project/em-primitives.jsx:109,117.
  const radius = $derived(Math.max(5, size * 0.22));
  const monoFontSize = $derived(Math.max(9, size * 0.44));
  const dotSize = $derived(Math.max(6, Math.round(size * 0.26)));
</script>

{#if showStatus}
  <span
    class="relative inline-flex shrink-0 items-center justify-center {className}"
    style:width="{size}px"
    style:height="{size}px"
  >
    {#if logoUrl}
      <img
        src={logoUrl}
        width={size}
        height={size}
        alt=""
        class="object-contain"
      />
    {:else}
      <span
        class="inline-flex items-center justify-center border border-border-default bg-bg-elevated font-medium text-fg-heading"
        style:width="{size}px"
        style:height="{size}px"
        style:border-radius="{radius}px"
        style:font-size="{monoFontSize}px">{monogram}</span
      >
    {/if}
    <span
      class="absolute rounded-full"
      style:right="-1px"
      style:bottom="-1px"
      style:box-shadow="0 0 0 2px var(--color-bg-sidebar)"
    >
      <StatusDot {status} size={dotSize} />
    </span>
  </span>
{:else if logoUrl}
  <img
    src={logoUrl}
    width={size}
    height={size}
    alt=""
    class="object-contain {className}"
  />
{:else}
  <span
    class="inline-flex items-center justify-center border border-border-default bg-bg-elevated font-medium text-fg-heading {className}"
    style:width="{size}px"
    style:height="{size}px"
    style:border-radius="{radius}px"
    style:font-size="{monoFontSize}px">{monogram}</span
  >
{/if}
