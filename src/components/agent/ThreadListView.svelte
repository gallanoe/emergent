<script lang="ts">
  import { EllipsisVertical, Play, Square, Trash2 } from "@lucide/svelte";
  import {
    AgentAvatar,
    ConfirmDialog,
    Mono,
    SLabel,
  } from "../../lib/primitives";
  import ContextMenu from "../sidebar/ContextMenu.svelte";
  import SystemPromptCard from "./SystemPromptCard.svelte";
  import ThreadListSection from "./ThreadListSection.svelte";
  import { getFriendlyNameForAgent } from "../../lib/agent-logos";
  import type {
    DisplayAgentDefinition,
    DisplayThread,
    MenuItem,
  } from "../../stores/types";

  interface Props {
    agentDefinition: DisplayAgentDefinition;
    containerRunning: boolean;
    onSelectThread: (id: string) => void;
    onNewThread: () => void;
    onUpdateName: (name: string) => void;
    onUpdateSystemPrompt: (next: string) => void;
    onResumeThread: (id: string) => void;
    onStopThread: (id: string) => void;
    onDeleteThread: (id: string) => void;
    onDeleteAgent: () => void;
  }

  let {
    agentDefinition: agentDef,
    containerRunning,
    onSelectThread,
    onNewThread,
    onUpdateName,
    onUpdateSystemPrompt,
    onResumeThread,
    onStopThread,
    onDeleteThread,
    onDeleteAgent,
  }: Props = $props();

  let editingName = $state(false);
  let nameDraft = $state("");

  const conversationThreads = $derived(
    agentDef.threads.filter((t) => !t.taskId),
  );
  const taskSessionThreads = $derived(agentDef.threads.filter((t) => t.taskId));

  let agentMenu = $state<{ x: number; y: number } | null>(null);
  let threadMenu = $state<{
    thread: DisplayThread;
    x: number;
    y: number;
  } | null>(null);
  let deleteThreadTarget = $state<DisplayThread | null>(null);
  let deleteAgentConfirm = $state(false);

  const agentMenuItems: MenuItem[] = [
    { id: "delete", label: "Delete agent", icon: Trash2, danger: true },
  ];

  function threadMenuItems(t: DisplayThread): MenuItem[] {
    const alive =
      t.processStatus === "idle" ||
      t.processStatus === "working" ||
      t.processStatus === "initializing";
    if (alive) {
      return [
        { id: "stop", label: "Stop", icon: Square },
        { id: "sep", label: "", separator: true },
        { id: "delete", label: "Delete", icon: Trash2, danger: true },
      ];
    }
    return [
      { id: "start", label: "Start", icon: Play, disabled: !containerRunning },
      { id: "sep", label: "", separator: true },
      { id: "delete", label: "Delete", icon: Trash2, danger: true },
    ];
  }

  function handleThreadAction(id: string) {
    if (!threadMenu) return;
    const t = threadMenu.thread;
    threadMenu = null;
    if (id === "stop") onStopThread(t.id);
    else if (id === "start") onResumeThread(t.id);
    else if (id === "delete") deleteThreadTarget = t;
  }

  function handleAgentAction(id: string) {
    agentMenu = null;
    if (id === "delete") deleteAgentConfirm = true;
  }
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
  <div class="flex-1 overflow-y-auto">
    <div class="mx-auto flex max-w-[720px] flex-col gap-7 px-8 pb-10 pt-7">
      <div class="flex items-start gap-4">
        <AgentAvatar
          provider={agentDef.provider}
          cli={agentDef.cli}
          name={agentDef.name}
          size={44}
        />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-baseline gap-[10px]">
            {#if editingName}
              <input
                bind:value={nameDraft}
                class="border-b border-border-default bg-transparent text-[22px] font-semibold tracking-[-0.01em] text-fg-heading outline-none"
                onblur={() => {
                  if (nameDraft.trim() && nameDraft !== agentDef.name) {
                    onUpdateName(nameDraft.trim());
                  }
                  editingName = false;
                }}
                onkeydown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    editingName = false;
                  }
                }}
              />
            {:else}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <h1
                class="cursor-text text-[22px] font-semibold tracking-[-0.01em] text-fg-heading"
                onclick={() => {
                  nameDraft = agentDef.name;
                  editingName = true;
                }}
                title="Click to rename"
              >
                {agentDef.name}
              </h1>
            {/if}
          </div>
          <Mono size={11} color="var(--color-fg-disabled)" class="mt-1">
            {#snippet children()}
              {agentDef.threads.length} thread{agentDef.threads.length === 1
                ? ""
                : "s"} · {getFriendlyNameForAgent(
                agentDef.provider,
                agentDef.cli,
              )}
            {/snippet}
          </Mono>
        </div>
        <button
          type="button"
          title="Agent actions"
          class="rounded p-1 text-fg-muted"
          onclick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            agentMenu = { x: r.right, y: r.bottom + 4 };
          }}
        >
          <EllipsisVertical size={14} />
        </button>
      </div>

      <SystemPromptCard
        prompt={agentDef.systemPrompt}
        onSave={(next) => onUpdateSystemPrompt(next)}
      />

      <section class="flex flex-col gap-[10px]">
        <SLabel>MCP servers</SLabel>
        <div
          class="flex items-center gap-3 rounded-[10px] border border-dashed border-border-strong px-4 py-[14px]"
        >
          <Mono
            size={10}
            color="var(--color-fg-muted)"
            class="uppercase tracking-[0.06em]"
          >
            {#snippet children()}To design{/snippet}
          </Mono>
          <span class="text-[12px] leading-[1.5] text-fg-muted">
            Per-agent MCP server bindings (swarm, filesystem, github…). Shape
            not yet settled.
          </span>
        </div>
      </section>

      <ThreadListSection
        label="Conversations"
        threads={conversationThreads}
        emptyHint="No conversations yet."
        {onSelectThread}
        onMenu={(t, x, y) => (threadMenu = { thread: t, x, y })}
        {...containerRunning ? { onNewThread } : {}}
      />

      {#if taskSessionThreads.length > 0}
        <ThreadListSection
          label="Task sessions"
          threads={taskSessionThreads}
          isTask
          {onSelectThread}
          onMenu={(t, x, y) => (threadMenu = { thread: t, x, y })}
        />
      {/if}
    </div>
  </div>
</div>

{#if agentMenu}
  <ContextMenu
    x={agentMenu.x}
    y={agentMenu.y}
    items={agentMenuItems}
    onSelect={handleAgentAction}
    onClose={() => (agentMenu = null)}
  />
{/if}

{#if threadMenu}
  <ContextMenu
    x={threadMenu.x}
    y={threadMenu.y}
    items={threadMenuItems(threadMenu.thread)}
    onSelect={handleThreadAction}
    onClose={() => (threadMenu = null)}
  />
{/if}

{#if deleteThreadTarget}
  <ConfirmDialog
    title="Delete thread?"
    description="This thread and its session mapping will be permanently removed."
    confirmLabel="Delete"
    confirmVariant="danger"
    onConfirm={() => {
      onDeleteThread(deleteThreadTarget!.id);
      deleteThreadTarget = null;
    }}
    onCancel={() => (deleteThreadTarget = null)}
  />
{/if}

{#if deleteAgentConfirm}
  <ConfirmDialog
    title="Delete {agentDef.name}?"
    description="This agent definition and all its threads will be removed."
    confirmLabel="Delete"
    confirmVariant="danger"
    onConfirm={() => {
      onDeleteAgent();
      deleteAgentConfirm = false;
    }}
    onCancel={() => (deleteAgentConfirm = false)}
  />
{/if}
