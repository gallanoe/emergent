<script lang="ts">
  import type {
    ContainerRuntimeKind,
    ContainerRuntimePreference,
    ContainerRuntimeStatus,
  } from "../../stores/types";

  interface Props {
    preference: ContainerRuntimePreference;
    status: ContainerRuntimeStatus | null;
    onChange: (runtime: ContainerRuntimeKind) => void;
    align?: "start" | "center";
  }

  let { preference, status, onChange, align = "start" }: Props = $props();

  const runtimeOptions: { value: ContainerRuntimeKind; label: string }[] = [
    { value: "docker", label: "Docker" },
    { value: "podman", label: "Podman" },
  ];

  function availabilityText(status: ContainerRuntimeStatus | null): string {
    if (!status) return "Checking runtime status…";
    if (status.available) {
      return status.version
        ? `${status.selected_runtime} ${status.version} available`
        : `${status.selected_runtime} available`;
    }
    return status.message ?? `${status.selected_runtime} is unavailable`;
  }
</script>

<div class="space-y-3 {align === 'center' ? 'text-center' : ''}">
  <div>
    <span
      class="block text-[10px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
      >Container Runtime</span
    >
    <div
      class="inline-flex rounded-md border border-border-default bg-bg-base p-1 {align ===
      'center'
        ? 'mx-auto'
        : ''}"
    >
      {#each runtimeOptions as option}
        <button
          class="px-3 py-1.5 rounded-[5px] text-[12px] transition-colors {preference.selected_runtime ===
          option.value
            ? 'bg-bg-hover text-fg-heading'
            : 'text-fg-muted hover:text-fg-default'}"
          onclick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="rounded-md border border-border-default bg-bg-base px-3 py-2">
    <div class="text-[12px] text-fg-default">{availabilityText(status)}</div>
    {#if status && !status.available}
      <div class="mt-1 text-[11px] text-fg-muted">
        Switch runtimes here or install/fix the selected runtime, then retry.
      </div>
    {/if}
  </div>
</div>
