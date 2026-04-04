<script lang="ts">
  import type { DisplayAgentDefinition } from "../../stores/types";
  import { ChevronLeft, Trash2 } from "@lucide/svelte";
  import ConfirmDialog from "../ConfirmDialog.svelte";

  interface Props {
    agentDefinition: DisplayAgentDefinition;
    onBack: () => void;
    onUpdate: (name?: string, role?: string) => void;
    onDelete: () => void;
  }

  let { agentDefinition, onBack, onUpdate, onDelete }: Props = $props();

  let name = $derived(agentDefinition.name);
  let role = $derived(agentDefinition.role ?? "");
  let editName = $state("");
  let editRole = $state("");
  let showDeleteConfirm = $state(false);

  // Sync edits when prop changes
  $effect(() => {
    editName = name;
  });
  $effect(() => {
    editRole = role;
  });

  function handleNameBlur() {
    if (editName !== name) {
      onUpdate(editName, undefined);
    }
  }

  function handleRoleBlur() {
    const newRole = editRole.trim() || undefined;
    const currentRole = role || undefined;
    if (newRole !== currentRole) {
      onUpdate(undefined, newRole);
    }
  }
</script>

<div class="flex flex-col min-h-0 flex-1">
  <!-- Top bar with back button -->
  <div
    class="flex items-center h-[38px] px-4 border-b border-border-default flex-shrink-0 relative z-[60] gap-2"
  >
    <button
      class="interactive flex items-center justify-center w-[24px] h-[24px] rounded-[5px] text-fg-muted"
      title="Back to threads"
      onclick={onBack}
    >
      <ChevronLeft size={16} />
    </button>
    <span class="text-[13px] font-semibold text-fg-heading"
      >{agentDefinition.name}</span
    >
    <span class="text-[12px] text-fg-disabled">/</span>
    <span class="text-[12px] text-fg-muted">Settings</span>
  </div>

  <!-- Settings form -->
  <div class="flex-1 overflow-y-auto p-6">
    <div class="flex flex-col gap-5 max-w-lg">
      <!-- Name -->
      <div class="flex flex-col gap-1.5">
        <label class="text-[11px] font-medium text-fg-muted" for="agent-name"
          >Name</label
        >
        <input
          id="agent-name"
          type="text"
          class="bg-bg-elevated border border-border-default rounded-md px-2.5 py-[7px] text-[12px] text-fg-default font-[var(--font-ui)] w-full focus:outline-none focus:border-border-focus"
          bind:value={editName}
          onblur={handleNameBlur}
        />
      </div>

      <!-- Role -->
      <div class="flex flex-col gap-1.5">
        <label class="text-[11px] font-medium text-fg-muted" for="agent-role"
          >Role</label
        >
        <textarea
          id="agent-role"
          class="bg-bg-elevated border border-border-default rounded-md px-2.5 py-[7px] text-[12px] text-fg-default font-[var(--font-ui)] w-full min-h-[80px] resize-y leading-relaxed focus:outline-none focus:border-border-focus"
          bind:value={editRole}
          onblur={handleRoleBlur}
        ></textarea>
        <span class="text-[10px] text-fg-disabled leading-snug"
          >Injected into the system prompt on the first turn of each thread.</span
        >
      </div>

      <!-- CLI (read-only) -->
      <div class="flex flex-col gap-1.5">
        <label class="text-[11px] font-medium text-fg-muted" for="agent-cli"
          >CLI</label
        >
        <input
          id="agent-cli"
          type="text"
          class="bg-bg-elevated border border-border-default rounded-md px-2.5 py-[7px] text-[12px] text-fg-disabled font-[var(--font-ui)] w-full cursor-not-allowed"
          value={agentDefinition.cli}
          readonly
        />
        <span class="text-[10px] text-fg-disabled leading-snug"
          >CLI is set at creation and cannot be changed. Delete and re-create
          the agent to use a different CLI.</span
        >
      </div>

      <!-- Danger zone -->
      <div class="border-t border-border-default mt-2 pt-5">
        <div
          class="flex items-center justify-between px-3 py-2.5 rounded-md border border-error/20"
        >
          <div>
            <div class="text-[12px] text-fg-muted">Delete agent</div>
            <div class="text-[10px] text-fg-disabled mt-0.5">
              Kills all threads and removes the definition.
            </div>
          </div>
          <button
            class="text-[11px] text-error border border-error/30 rounded-md px-3 py-1 hover:bg-error/10 transition-colors"
            onclick={() => (showDeleteConfirm = true)}
          >
            <span class="flex items-center gap-1.5">
              <Trash2 size={12} />
              Delete
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</div>

{#if showDeleteConfirm}
  <ConfirmDialog
    title="Delete {agentDefinition.name}?"
    description="All threads will be terminated and the agent definition will be permanently removed."
    confirmLabel="Delete"
    onConfirm={() => {
      showDeleteConfirm = false;
      onDelete();
    }}
    onCancel={() => (showDeleteConfirm = false)}
  />
{/if}
