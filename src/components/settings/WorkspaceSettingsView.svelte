<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import type {
    ContainerStatus,
    ContainerRuntimePreference,
    ContainerRuntimeStatus,
    ContainerRuntimeKind,
    WorkspaceInfo,
  } from "../../stores/types";
  import {
    ConfirmDialog,
    Button,
    Mono,
    SLabel,
    RuntimeGlyph,
  } from "../../lib/primitives";
  import ConfigRow from "./ConfigRow.svelte";
  import RuntimeSelector from "./RuntimeSelector.svelte";

  interface Props {
    workspaceId: string;
    containerStatus: ContainerStatus;
    runtimePreference: ContainerRuntimePreference;
    runtimeStatus: ContainerRuntimeStatus | null;
    onUpdateName: (name: string) => void;
    onRuntimeChange: (runtime: ContainerRuntimeKind) => void;
    onStart: () => void;
    onStop: () => void;
    onRebuild: () => void;
    onDelete: () => void;
  }

  let {
    workspaceId,
    containerStatus,
    runtimePreference,
    runtimeStatus,
    onUpdateName,
    onRuntimeChange,
    onStart,
    onStop,
    onRebuild,
    onDelete,
  }: Props = $props();

  let workspace = $state<WorkspaceInfo | null>(null);
  let editingName = $state(false);
  let nameDraft = $state("");
  let deleteConfirm = $state(false);

  async function loadWorkspace() {
    try {
      workspace = await invoke<WorkspaceInfo>("get_workspace", { workspaceId });
    } catch {
      workspace = null;
    }
  }

  $effect(() => {
    void workspaceId;
    void loadWorkspace();
  });

  const runtimeState = $derived(containerStatus.state);
  const runtimeLabel = $derived(
    runtimeState === "running"
      ? "Running"
      : runtimeState === "building"
        ? "Building"
        : runtimeState === "error"
          ? "Error"
          : "Stopped",
  );
  const runtimeMeta = $derived(
    String(
      runtimeStatus?.selected_runtime ?? runtimePreference.selected_runtime,
    ) +
      (containerStatus.state === "error"
        ? ` · ${containerStatus.message}`
        : ""),
  );
</script>

<div class="flex min-w-0 flex-1 flex-col">
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto flex max-w-[720px] flex-col gap-7 px-8 pb-10 pt-7">
      <!-- Hero -->
      <div class="flex items-start gap-4">
        <span
          class="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[10px] bg-fg-heading text-[20px] font-bold tracking-[-0.02em] text-bg-base"
        >
          {(workspace?.name ?? "?").charAt(0).toUpperCase()}
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-baseline gap-[10px]">
            <h1
              class="text-[22px] font-semibold tracking-[-0.01em] text-fg-heading"
            >
              {workspace?.name ?? "—"}
            </h1>
            <span class="text-[13px] text-fg-muted">workspace</span>
          </div>
          <Mono size={11} color="var(--color-fg-disabled)" class="mt-1"
            >{workspace?.path ?? ""}</Mono
          >
        </div>
      </div>

      <!-- Workspace -->
      <section class="flex flex-col gap-[10px]">
        <SLabel>Workspace</SLabel>
        <div class="rounded-[10px] border border-border-default bg-bg-elevated">
          <ConfigRow label="Name">
            {#snippet edit()}
              {#if editingName}
                <input
                  bind:value={nameDraft}
                  class="w-full border-b border-border-default bg-transparent text-[12.5px] outline-none"
                  onblur={() => {
                    if (nameDraft.trim() && nameDraft !== workspace?.name) {
                      onUpdateName(nameDraft.trim());
                    }
                    editingName = false;
                  }}
                  onkeydown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") editingName = false;
                  }}
                />
                <span></span>
              {:else}
                <span class="truncate font-mono text-[11.5px] text-fg-default"
                  >{workspace?.name ?? ""}</span
                >
                <button
                  type="button"
                  class="cursor-pointer text-[11px] text-fg-disabled"
                  onclick={() => {
                    nameDraft = workspace?.name ?? "";
                    editingName = true;
                  }}
                >
                  Edit
                </button>
              {/if}
            {/snippet}
          </ConfigRow>
          <ConfigRow label="Path" value={workspace?.path ?? "—"} readOnly />
          <ConfigRow label="Mounted as" value="/workspace" readOnly last />
        </div>
      </section>

      <!-- Container runtime -->
      <section class="flex flex-col gap-[10px]">
        <SLabel>Container runtime</SLabel>
        <div
          class="overflow-hidden rounded-[10px] border border-border-default bg-bg-elevated"
        >
          <div
            class="flex items-center gap-3 border-b border-border-default px-[14px] py-3"
          >
            <RuntimeGlyph state={runtimeState} size={22} />
            <div class="min-w-0 flex-1">
              <div class="text-[12.5px] font-medium text-fg-heading">
                {runtimeLabel}
              </div>
              <Mono size={10.5} color="var(--color-fg-muted)"
                >{runtimeMeta}</Mono
              >
            </div>
            {#if runtimeState === "running"}
              <Button variant="secondary" size="xs" onclick={onStop}
                >Stop</Button
              >
              <Button variant="ghost" size="xs" onclick={onRebuild}
                >Rebuild</Button
              >
            {:else if runtimeState === "stopped"}
              <Button variant="secondary" size="xs" onclick={onStart}
                >Start</Button
              >
            {:else if runtimeState === "error"}
              <Button variant="secondary" size="xs" onclick={onRebuild}
                >Rebuild</Button
              >
            {/if}
          </div>
          <ConfigRow label="Engine">
            {#snippet edit()}
              <RuntimeSelector
                preference={runtimePreference}
                status={runtimeStatus}
                onChange={onRuntimeChange}
                align="start"
              />
              <span></span>
            {/snippet}
          </ConfigRow>
          <ConfigRow
            label="Image"
            value={workspace?.name ? `${workspace.name}:latest` : "—"}
            readOnly
          />
          <!-- Deferred: surface last image build time once the workspace API exposes `last_built_at`. -->
          <ConfigRow label="Last build" value="—" readOnly last />
        </div>
      </section>

      <!-- Danger zone -->
      <section class="flex flex-col gap-[10px]">
        <SLabel color="var(--color-error)">Danger zone</SLabel>
        <div
          class="overflow-hidden rounded-[10px] border border-border-default bg-bg-elevated"
        >
          <div
            class="grid grid-cols-[120px_1fr_auto] items-center gap-3 px-[14px] py-3"
          >
            <Mono size={11} color="var(--color-fg-muted)">Delete</Mono>
            <span class="text-[12.5px] leading-[1.5] text-fg-default">
              Terminates all threads, removes the container, image, and
              workspace files. Permanent.
            </span>
            <Button
              variant="danger"
              size="xs"
              onclick={() => (deleteConfirm = true)}>Delete…</Button
            >
          </div>
        </div>
      </section>
    </div>
  </div>
</div>

{#if deleteConfirm}
  <ConfirmDialog
    title="Delete {workspace?.name}?"
    description="All agents will be terminated. The container, image, and workspace files will be permanently deleted."
    confirmLabel="Delete"
    confirmVariant="danger"
    onConfirm={() => {
      onDelete();
      deleteConfirm = false;
    }}
    onCancel={() => (deleteConfirm = false)}
  />
{/if}
