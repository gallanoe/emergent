<script lang="ts">
  import StatusDot from "./StatusDot.svelte";

  interface Props {
    name: string;
    args?: string;
    status: "running" | "completed" | "error" | "pending";
    statusLabel?: string;
  }

  let { name, args, status, statusLabel }: Props = $props();
</script>

<div
  class="flex items-center gap-[10px] py-[3px] font-[family-name:var(--font-mono)] text-[11.5px]"
>
  <span class="inline-flex shrink-0 items-center justify-center">
    {#if status === "running"}
      <StatusDot status="working" size={6} />
    {:else if status === "completed"}
      <svg
        width="10"
        height="10"
        viewBox="0 0 16 16"
        fill="none"
        class="text-fg-muted"
        aria-hidden="true"
      >
        <path
          d="M3 8l3.5 3.5L13 5"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        ></path>
      </svg>
    {:else if status === "error"}
      <svg
        width="10"
        height="10"
        viewBox="0 0 16 16"
        fill="none"
        class="text-[var(--color-error)]"
        aria-hidden="true"
      >
        <path
          d="M4 4l8 8M12 4l-8 8"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        ></path>
      </svg>
    {:else}
      <svg
        width="10"
        height="10"
        viewBox="0 0 16 16"
        fill="none"
        class="text-fg-muted"
        aria-hidden="true"
      >
        <path
          d="M3 8l3.5 3.5L13 5"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-dasharray="2.2 1.6"
        ></path>
      </svg>
    {/if}
  </span>
  <span class="font-medium text-fg-default">{name}</span>
  {#if args}
    <span class="text-fg-disabled">({args})</span>
  {/if}
  <span class="min-w-0 flex-1"></span>
  {#if statusLabel}
    <span class="shrink-0 text-[10.5px] text-fg-muted">{statusLabel}</span>
  {/if}
</div>
