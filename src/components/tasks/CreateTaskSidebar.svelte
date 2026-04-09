<script lang="ts">
  import type { DisplayTask, AgentDefinition } from "../../stores/types";
  import { X } from "@lucide/svelte";

  interface Props {
    agentDefinitions: AgentDefinition[];
    existingTasks: DisplayTask[];
    onClose: () => void;
    onCreate: (
      title: string,
      description: string,
      agentId: string,
      blockerIds: string[],
    ) => void;
  }

  let { agentDefinitions, existingTasks, onClose, onCreate }: Props = $props();

  let title = $state("");
  let description = $state("");
  let selectedAgentId = $state<string | null>(null);
  let selectedBlockerIds = $state<string[]>([]);

  const canSubmit = $derived(
    title.trim().length > 0 &&
      description.trim().length > 0 &&
      selectedAgentId != null,
  );

  function addBlocker(taskId: string) {
    if (!selectedBlockerIds.includes(taskId)) {
      selectedBlockerIds = [...selectedBlockerIds, taskId];
    }
  }

  function removeBlocker(taskId: string) {
    selectedBlockerIds = selectedBlockerIds.filter((id) => id !== taskId);
  }

  function handleSubmit() {
    if (!canSubmit || !selectedAgentId) return;
    onCreate(title.trim(), description.trim(), selectedAgentId, selectedBlockerIds);
  }
</script>

<div class="flex flex-col h-full bg-bg-sidebar">
  <!-- Header -->
  <div
    class="flex items-center justify-between px-4 py-3.5 border-b border-border-default"
  >
    <span class="text-[13px] font-semibold text-fg-heading">New Task</span>
    <button
      class="interactive flex items-center justify-center w-6 h-6 rounded-[5px] text-fg-muted"
      onclick={onClose}
    >
      <X size={14} />
    </button>
  </div>

  <!-- Form -->
  <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-3.5">
    <!-- Title -->
    <div>
      <label
        for="task-title"
        class="block text-[11px] font-medium text-fg-muted mb-1.5">Title</label
      >
      <input
        id="task-title"
        type="text"
        bind:value={title}
        placeholder="Task title"
        class="w-full bg-bg-base border border-border-strong rounded-md px-2.5 py-[7px] text-[12px] text-fg-heading placeholder:text-fg-disabled focus:outline-none focus:border-border-focus"
      />
    </div>

    <!-- Description -->
    <div>
      <label
        for="task-desc"
        class="block text-[11px] font-medium text-fg-muted mb-1.5"
        >Description</label
      >
      <textarea
        id="task-desc"
        bind:value={description}
        placeholder="Task description (becomes the agent's prompt)"
        rows="4"
        class="w-full bg-bg-base border border-border-strong rounded-md px-2.5 py-[7px] text-[12px] text-fg-heading placeholder:text-fg-disabled focus:outline-none focus:border-border-focus resize-none leading-relaxed"
      ></textarea>
    </div>

    <!-- Agent -->
    <div>
      <label
        for="task-agent"
        class="block text-[11px] font-medium text-fg-muted mb-1.5"
        >Assign to</label
      >
      <select
        id="task-agent"
        bind:value={selectedAgentId}
        class="w-full bg-bg-base border border-border-strong rounded-md px-2.5 py-[7px] text-[12px] text-fg-heading focus:outline-none focus:border-border-focus"
      >
        <option value={null} disabled selected>Select agent...</option>
        {#each agentDefinitions as def (def.id)}
          <option value={def.id}>{def.name}</option>
        {/each}
      </select>
    </div>

    <!-- Blockers -->
    <div>
      <label class="block text-[11px] font-medium text-fg-muted mb-1.5">
        Blocked by
        <span class="text-fg-disabled font-normal">(optional)</span>
      </label>
      {#if selectedBlockerIds.length > 0}
        <div class="flex flex-wrap gap-1.5 mb-1.5">
          {#each selectedBlockerIds as bid (bid)}
            {@const blockerTask = existingTasks.find((t) => t.id === bid)}
            <span
              class="inline-flex items-center gap-1 text-[10px] text-fg-muted bg-bg-elevated border border-border-default rounded-[5px] px-2 py-1"
            >
              {blockerTask?.title ?? bid}
              <span class="font-mono text-fg-disabled text-[9px]">{bid.slice(0, 8)}</span>
              <button
                class="text-fg-disabled hover:text-fg-muted ml-0.5"
                onclick={() => removeBlocker(bid)}
              >
                <X size={10} />
              </button>
            </span>
          {/each}
        </div>
      {/if}
      <select
        class="w-full bg-bg-base border border-border-strong rounded-md px-2.5 py-[7px] text-[12px] text-fg-disabled focus:outline-none focus:border-border-focus"
        onchange={(e) => {
          const val = (e.target as HTMLSelectElement).value;
          if (val) {
            addBlocker(val);
            (e.target as HTMLSelectElement).value = "";
          }
        }}
      >
        <option value="">Add blocker...</option>
        {#each existingTasks.filter((t) => !selectedBlockerIds.includes(t.id)) as task (task.id)}
          <option value={task.id}>{task.title} ({task.id})</option>
        {/each}
      </select>
    </div>

    <!-- Spacer -->
    <div class="flex-1"></div>

    <!-- Actions -->
    <div class="flex justify-end gap-2 pt-1">
      <button
        class="px-3.5 py-1.5 rounded-md text-[12px] font-medium text-fg-muted border border-border-default hover:bg-bg-hover"
        onclick={onClose}
      >
        Cancel
      </button>
      <button
        class="px-3.5 py-1.5 rounded-md text-[12px] font-medium bg-accent text-bg-base hover:bg-accent-hover disabled:opacity-40 disabled:cursor-default"
        disabled={!canSubmit}
        onclick={handleSubmit}
      >
        Create
      </button>
    </div>
  </div>
</div>
