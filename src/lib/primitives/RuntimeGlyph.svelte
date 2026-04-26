<script lang="ts">
  interface Props {
    state: "running" | "stopped" | "building" | "error";
    size?: number;
  }

  let { state, size = 16 }: Props = $props();

  const colorClass = $derived.by(() => {
    switch (state) {
      case "running":
        return "text-success";
      case "building":
        return "text-warning";
      case "error":
        return "text-error";
      default:
        return "text-fg-muted";
    }
  });

  const svgSize = $derived(size * 0.72);
  const radius = $derived(size * 0.28);
</script>

<span
  class="inline-flex items-center justify-center bg-bg-hover {colorClass}"
  style:width="{size}px"
  style:height="{size}px"
  style:border-radius="{radius}px"
>
  <svg
    width={svgSize}
    height={svgSize}
    viewBox="0 0 16 16"
    fill="none"
    class="shrink-0"
    aria-hidden="true"
  >
    <rect
      x="2"
      y="4.5"
      width="12"
      height="7.5"
      rx="1.5"
      stroke="currentColor"
      stroke-width="1.6"
    />
    <path d="M2 7.5h12" stroke="currentColor" stroke-width="1.6" />
    {#if state === "running"}
      <circle cx="4.5" cy="6" r="0.8" fill="currentColor" />
    {:else if state === "building"}
      <path
        d="M5 9.5h6"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-dasharray="1.5 1.5"
      />
    {/if}
  </svg>
</span>
