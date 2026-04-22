<script lang="ts">
  import type { DisplayTask, AgentDefinition } from "../../stores/types";
  import { X } from "@lucide/svelte";
  import { Button, Input, Mono, SLabel } from "../../lib/primitives";

  interface Props {
    agentDefinitions: AgentDefinition[];
    existingTasks: DisplayTask[];
    onClose: () => void;
    onCreate: (
      title: string,
      description: string,
      agentId: string,
      blockerIds: string[],
    ) => void | Promise<void>;
  }

  let { agentDefinitions, existingTasks, onClose, onCreate }: Props = $props();

  let title = $state("");
  let description = $state("");
  let selectedAgentId = $state<string>("");
  let selectedBlockerIds = $state<string[]>([]);
  let submitting = $state(false);

  const canSubmit = $derived(
    title.trim().length > 0 &&
      description.trim().length > 0 &&
      selectedAgentId.length > 0 &&
      !submitting,
  );

  function addBlocker(taskId: string) {
    if (!selectedBlockerIds.includes(taskId)) {
      selectedBlockerIds = [...selectedBlockerIds, taskId];
    }
  }

  function removeBlocker(taskId: string) {
    selectedBlockerIds = selectedBlockerIds.filter((id) => id !== taskId);
  }

  async function handleSubmit() {
    if (!canSubmit || selectedAgentId.length === 0 || submitting) return;
    submitting = true;
    try {
      await onCreate(
        title.trim(),
        description.trim(),
        selectedAgentId,
        selectedBlockerIds,
      );
    } finally {
      submitting = false;
    }
  }
</script>

<div
  class="flex h-full min-h-0 flex-col border-l border-border-default bg-bg-sidebar px-4 py-4"
>
  <div class="mb-3 flex items-center justify-between gap-2">
    <span class="text-[13px] font-semibold text-fg-heading">New Task</span>
    <Button variant="ghost" size="xs" onclick={onClose} title="Close">
      {#snippet icon()}<X size={14} />{/snippet}
      {#snippet children()}{/snippet}
    </Button>
  </div>

  <div class="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto">
    <div>
      <SLabel class="mb-1.5 block">Title</SLabel>
      <Input bind:value={title} placeholder="Task title" size="md" />
    </div>

    <div>
      <SLabel class="mb-1.5 block">Description</SLabel>
      <textarea
        id="task-desc"
        bind:value={description}
        placeholder="Task description (becomes the agent's prompt)"
        rows="4"
        class="w-full resize-none rounded-md border border-border-default bg-bg-elevated px-2.5 py-[7px] text-[12px] leading-relaxed text-fg-heading placeholder:text-fg-disabled focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/25"
      ></textarea>
    </div>

    <div>
      <SLabel class="mb-1.5 block">Assign to</SLabel>
      <select
        id="task-agent"
        bind:value={selectedAgentId}
        class="h-[30px] w-full rounded-md border border-border-default bg-bg-elevated px-2.5 text-[12px] text-fg-heading focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/25"
      >
        <option value="" disabled selected>Select agent...</option>
        {#each agentDefinitions as def (def.id)}
          <option value={def.id}>{def.name}</option>
        {/each}
      </select>
    </div>

    <div>
      <div class="mb-1.5 flex items-baseline gap-1">
        <SLabel>Blocked by</SLabel>
        <span
          class="text-[10px] font-normal normal-case tracking-normal text-fg-disabled"
        >
          (optional)
        </span>
      </div>
      {#if selectedBlockerIds.length > 0}
        <div class="mb-1.5 flex flex-wrap gap-1.5">
          {#each selectedBlockerIds as bid (bid)}
            {@const blockerTask = existingTasks.find((t) => t.id === bid)}
            <span
              class="inline-flex items-center gap-1 rounded-[5px] border border-border-default bg-bg-elevated px-2 py-1 text-[10px] text-fg-muted"
            >
              {blockerTask?.title ?? bid}
              <Mono size={9} color="var(--color-fg-disabled)">
                {#snippet children()}{bid.slice(0, 8)}{/snippet}
              </Mono>
              <button
                type="button"
                class="ml-0.5 text-fg-disabled hover:text-fg-muted"
                onclick={() => removeBlocker(bid)}
              >
                <X size={10} />
              </button>
            </span>
          {/each}
        </div>
      {/if}
      <select
        id="task-blockers"
        class="h-[30px] w-full rounded-md border border-border-default bg-bg-elevated px-2.5 text-[12px] text-fg-heading focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/25"
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

    <div class="flex-1"></div>

    <div class="flex justify-end gap-2 pt-1">
      <Button variant="ghost" size="sm" onclick={onClose}>
        {#snippet children()}Cancel{/snippet}
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={!canSubmit}
        onclick={handleSubmit}
      >
        {#snippet children()}
          {submitting ? "Creating…" : "Create"}
        {/snippet}
      </Button>
    </div>
  </div>
</div>
