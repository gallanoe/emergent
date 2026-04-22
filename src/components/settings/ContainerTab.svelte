<script lang="ts">
  import type {
    ContainerStatus,
    ContainerRuntimeKind,
    ContainerRuntimePreference,
    ContainerRuntimeStatus,
  } from "../../stores/types";
  import { ConfirmDialog } from "../../lib/primitives";
  import RuntimeSelector from "./RuntimeSelector.svelte";
  import { Play, Square, RefreshCw } from "@lucide/svelte";

  interface Props {
    containerStatus: ContainerStatus;
    runtimePreference: ContainerRuntimePreference;
    runtimeStatus: ContainerRuntimeStatus | null;
    dockerfile: string;
    onRuntimeChange: (runtime: ContainerRuntimeKind) => void;
    onStart: () => void;
    onStop: () => void;
    onRebuild: () => void;
    onOpenEditor: () => void;
  }

  let {
    containerStatus,
    runtimePreference,
    runtimeStatus,
    dockerfile,
    onRuntimeChange,
    onStart,
    onStop,
    onRebuild,
    onOpenEditor,
  }: Props = $props();

  let showRebuildConfirm = $state(false);

  const isBuilding = $derived(containerStatus.state === "building");
  const isRunning = $derived(containerStatus.state === "running");

  function statusLabel(status: ContainerStatus): string {
    switch (status.state) {
      case "running":
        return "Running";
      case "stopped":
        return "Stopped";
      case "building":
        return "Building...";
      case "error":
        return `Error: ${status.message}`;
    }
  }

  function statusDotColor(status: ContainerStatus): string {
    switch (status.state) {
      case "running":
        return "bg-success";
      case "building":
        return "bg-warning animate-pulse";
      case "error":
        return "bg-error";
      default:
        return "bg-fg-disabled";
    }
  }
</script>

<div class="space-y-6">
  <RuntimeSelector
    preference={runtimePreference}
    status={runtimeStatus}
    onChange={onRuntimeChange}
  />

  <div>
    <span
      class="block text-[10px] font-medium uppercase tracking-wider text-fg-muted mb-1.5"
      >Status</span
    >
    <div class="flex items-center gap-2">
      <span
        class="w-[7px] h-[7px] rounded-full {statusDotColor(containerStatus)}"
      ></span>
      <span class="text-[13px] text-fg-default"
        >{statusLabel(containerStatus)}</span
      >
    </div>
  </div>

  <div>
    <div class="flex items-center justify-between mb-1.5">
      <span
        class="text-[10px] font-medium uppercase tracking-wider text-fg-muted"
        >Dockerfile</span
      >
      <button
        class="interactive text-[11px] text-fg-muted px-2 py-0.5 rounded"
        onclick={onOpenEditor}
      >
        Open in editor
      </button>
    </div>
    <pre
      class="bg-bg-base border border-border-default rounded-md p-3 text-[12px] text-fg-muted font-mono leading-relaxed overflow-x-auto max-h-[300px] overflow-y-auto">{dockerfile}</pre>
  </div>

  <div class="flex gap-2">
    {#if !isRunning && !isBuilding}
      <button
        class="interactive flex items-center gap-1.5 h-7 px-3.5 rounded-[5px] text-[12px] font-medium text-fg-default bg-bg-elevated border border-border-strong"
        onclick={onStart}
      >
        <Play size={12} />
        Start
      </button>
    {/if}
    {#if isRunning}
      <button
        class="interactive flex items-center gap-1.5 h-7 px-3.5 rounded-[5px] text-[12px] font-medium text-fg-default bg-bg-elevated border border-border-strong"
        onclick={onStop}
      >
        <Square size={12} />
        Stop
      </button>
    {/if}
    <button
      class="interactive flex items-center gap-1.5 h-7 px-3.5 rounded-[5px] text-[12px] font-medium text-fg-default bg-bg-elevated border border-border-strong {isBuilding
        ? 'opacity-50 pointer-events-none'
        : ''}"
      disabled={isBuilding}
      onclick={() => (showRebuildConfirm = true)}
    >
      <RefreshCw size={12} />
      Rebuild
    </button>
  </div>
</div>

{#if showRebuildConfirm}
  <ConfirmDialog
    title="Rebuild Container"
    description="All running agents in this workspace will be shut down. The container will be rebuilt from the Dockerfile."
    confirmLabel="Rebuild"
    onConfirm={() => {
      showRebuildConfirm = false;
      onRebuild();
    }}
    onCancel={() => (showRebuildConfirm = false)}
  />
{/if}
