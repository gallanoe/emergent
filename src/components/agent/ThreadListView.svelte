<script lang="ts">
  import type { DisplayAgentDefinition, DisplayThread, AgentStatus } from "../../stores/types";
  import { Settings, Plus } from "@lucide/svelte";

  interface Props {
    agentDefinition: DisplayAgentDefinition;
    onSelectThread: (threadId: string) => void;
    onNewThread: () => void;
    onOpenSettings: () => void;
  }

  let { agentDefinition, onSelectThread, onNewThread, onOpenSettings }: Props =
    $props();

  function statusColor(status: AgentStatus | "dead"): string {
    switch (status) {
      case "working":
        return "bg-success";
      case "error":
        return "bg-error";
      case "initializing":
        return "bg-warning animate-pulse";
      case "dead":
        return "bg-fg-disabled opacity-40";
      default:
        return "bg-fg-disabled";
    }
  }

  function relativeTime(timestamp: string): string {
    if (!timestamp || timestamp === "just now") return "just now";
    return timestamp;
  }
</script>

<div class="flex flex-col min-h-0 flex-1">
  <!-- Top bar -->
  <div
    class="flex items-center h-[38px] px-5 border-b border-border-default flex-shrink-0 relative z-[60]"
  >
    <span class="text-[13px] font-semibold text-fg-heading flex-1 truncate"
      >{agentDefinition.name}</span
    >
    <button
      class="interactive flex items-center justify-center w-[26px] h-[26px] rounded-[5px] text-fg-muted"
      title="Agent settings"
      onclick={onOpenSettings}
    >
      <Settings size={14} />
    </button>
  </div>

  <!-- Thread list -->
  <div class="flex-1 overflow-y-auto p-3">
    <div class="flex items-center justify-between px-2.5 pb-2">
      <span class="text-[11px] text-fg-disabled">
        {agentDefinition.threads.length} thread{agentDefinition.threads.length !== 1 ? "s" : ""}
      </span>
      <button
        class="text-[11px] text-fg-muted border border-border-default rounded-md px-3 py-1 hover:bg-bg-hover transition-colors"
        onclick={onNewThread}
      >
        <span class="flex items-center gap-1.5">
          <Plus size={12} />
          New thread
        </span>
      </button>
    </div>

    <div class="text-[10px] font-medium uppercase tracking-wider text-fg-disabled px-2.5 pt-3 pb-1">
      Conversations
    </div>

    {#if agentDefinition.threads.length === 0}
      <div class="px-2.5 py-4 text-[11px] text-fg-disabled text-center">
        No threads yet. Create one to start a conversation.
      </div>
    {:else}
      <div class="max-h-[280px] overflow-y-auto relative">
        {#each agentDefinition.threads as thread (thread.id)}
          <button
            class="flex items-center gap-2 w-full px-2.5 py-[7px] rounded-md text-[12px] text-fg-muted hover:bg-bg-hover hover:text-fg-heading transition-colors mt-0.5"
            onclick={() => onSelectThread(thread.id)}
          >
            <span
              class="w-[6px] h-[6px] rounded-full flex-shrink-0 {statusColor(thread.processStatus)}"
            ></span>
            <span class="text-[12px] flex-shrink-0 opacity-70 w-4 text-center"
              >💬</span
            >
            <span class="flex-1 truncate text-left">{thread.name}</span>
            <span class="text-[11px] text-fg-disabled flex-shrink-0"
              >{relativeTime(thread.updatedAt)}</span
            >
          </button>
        {/each}
        <!-- Fade hint for overflow -->
        {#if agentDefinition.threads.length > 5}
          <div
            class="absolute bottom-0 left-0 right-1.5 h-6 bg-gradient-to-t from-bg-base to-transparent pointer-events-none"
          ></div>
        {/if}
      </div>
    {/if}
  </div>
</div>
