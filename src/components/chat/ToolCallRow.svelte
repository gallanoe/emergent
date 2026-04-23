<!-- src/components/ToolCallRow.svelte -->
<script lang="ts">
  import { ChevronRight, ChevronDown } from "@lucide/svelte";
  import { slide } from "svelte/transition";
  import {
    getEmergentToolName,
    parseAgentsToolContent,
    parseCreateTaskToolInput,
    parseCreateTaskToolContent,
    parseTasksToolContent,
  } from "../../lib/emergent-tool-calls";
  import type { DisplayToolCall, ToolKind } from "../../stores/types";
  import CreateTaskToolRender from "./CreateTaskToolRender.svelte";
  import ListAgentsToolRender from "./ListAgentsToolRender.svelte";
  import ListTasksToolRender from "./ListTasksToolRender.svelte";
  import ToolVerbIcon from "./ToolVerbIcon.svelte";
  import ToolStatusGlyph from "./ToolStatusGlyph.svelte";
  import DiffBody from "./DiffBody.svelte";
  import ShellBody from "./ShellBody.svelte";

  interface Props {
    toolCall: DisplayToolCall;
  }

  let { toolCall }: Props = $props();
  let emergentToolName = $derived(getEmergentToolName(toolCall.name));
  let isListAgentsTool = $derived(emergentToolName === "list_agents");
  let isListTasksTool = $derived(emergentToolName === "list_tasks");
  let isCreateTaskTool = $derived(emergentToolName === "create_task");
  let isCompleteTaskTool = $derived(emergentToolName === "complete_task");
  let userToggled = $state<boolean | null>(null);
  let expanded = $derived(
    userToggled ??
      (toolCall.kind === "edit" ||
        (emergentToolName !== null && !isCompleteTaskTool)),
  );

  function toggle() {
    if (!hasPreview) return;
    userToggled = !expanded;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  }

  const kindVerb: Record<ToolKind, string> = {
    read: "Read",
    edit: "Edit",
    delete: "Delete",
    move: "Move",
    search: "Search",
    execute: "Bash",
    think: "Think",
    fetch: "Fetch",
    other: "Tool",
  };

  function stripCodeFence(text: string): string {
    return text.replace(/^```\w*\n?/, "").replace(/\n?```\s*$/, "");
  }

  // ── Derived display values ─────────────────────────────────────
  let verb = $derived(
    isListAgentsTool
      ? "Agents"
      : isListTasksTool
        ? "Tasks"
        : isCreateTaskTool
          ? "Create Task"
          : isCompleteTaskTool
            ? "Task Completed"
            : (kindVerb[toolCall.kind] ?? "Tool"),
  );

  let target = $derived.by(() => {
    if (isListAgentsTool) {
      const agents = parseAgentsToolContent(toolCall);
      return `${agents.length} agent${agents.length === 1 ? "" : "s"}`;
    }
    if (isListTasksTool) {
      const tasks = parseTasksToolContent(toolCall);
      return `${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
    }
    if (isCreateTaskTool) {
      return (
        parseCreateTaskToolInput(toolCall)?.title ??
        parseCreateTaskToolContent(toolCall)?.task_id ??
        ""
      );
    }
    if (isCompleteTaskTool) {
      return "";
    }
    return (
      toolCall.locations[0] ??
      toolCall.name.replace(/^(Read|Write|Edit|Bash|Search)\s*/i, "") ??
      ""
    );
  });

  let statusLabel = $derived.by(() => {
    if (toolCall.status === "failed") {
      const termContent = toolCall.content.find((c) => c.type === "terminal");
      if (termContent?.type === "terminal" && termContent.exitCode != null) {
        return `exit ${termContent.exitCode}`;
      }
      return "failed";
    }
    if (toolCall.status === "in_progress") return "running";
    if (toolCall.status === "pending") return "pending";
    return null;
  });

  let statusLabelColor = $derived(
    toolCall.status === "failed"
      ? "text-error"
      : toolCall.status === "in_progress"
        ? "text-fg-muted"
        : "text-fg-disabled",
  );

  let hasPreview = $derived(
    isListAgentsTool ||
      isListTasksTool ||
      isCreateTaskTool ||
      (toolCall.content.length > 0 &&
        toolCall.kind !== "read" &&
        toolCall.status !== "pending" &&
        toolCall.status !== "in_progress"),
  );

  // Commands from execute-kind calls live under either `command` or `cmd`
  // depending on the agent. rawInput is unknown per the ACP spec, so we
  // fall back across both shapes without typing it further.
  function extractCommand(rawInput: unknown): string {
    if (rawInput && typeof rawInput === "object") {
      const obj = rawInput as Record<string, unknown>;
      if (typeof obj.command === "string") return obj.command;
      if (typeof obj.cmd === "string") return obj.cmd;
    }
    return "";
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class={hasPreview ? "interactive rounded" : ""}
  onclick={toggle}
  role={hasPreview ? "button" : undefined}
  tabindex={hasPreview ? 0 : undefined}
  onkeydown={hasPreview ? onKeydown : undefined}
>
  <div class="flex items-center gap-2 px-2.5 py-[5px]">
    <ToolVerbIcon
      kind={toolCall.kind}
      size={12}
      class="text-fg-muted shrink-0"
    />
    <span
      data-testid="tool-verb"
      class="text-[12px] font-[family-name:var(--font-mono)] font-medium text-fg-default min-w-[44px] {toolCall.status ===
      'in_progress'
        ? 'em-shimmer-text'
        : ''}"
    >
      {verb}
    </span>
    <span
      class="text-[11px] font-[family-name:var(--font-mono)] text-fg-muted truncate"
    >
      {target}
    </span>
    <span class="ml-auto flex items-center gap-1.5 shrink-0">
      {#if statusLabel}
        <span class="text-[10px] {statusLabelColor} whitespace-nowrap"
          >{statusLabel}</span
        >
      {/if}
      <ToolStatusGlyph status={toolCall.status} size={10} />
      {#if hasPreview}
        <span class="text-fg-disabled">
          {#if expanded}
            <ChevronDown size={10} />
          {:else}
            <ChevronRight size={10} />
          {/if}
        </span>
      {/if}
    </span>
  </div>

  {#if expanded}
    <div
      transition:slide={{ duration: 150 }}
      class="border-t border-border-default"
    >
      {#if isListAgentsTool}
        <ListAgentsToolRender agents={parseAgentsToolContent(toolCall)} />
      {:else if isListTasksTool}
        <ListTasksToolRender tasks={parseTasksToolContent(toolCall)} />
      {:else if isCreateTaskTool}
        <CreateTaskToolRender
          input={parseCreateTaskToolInput(toolCall)}
          result={parseCreateTaskToolContent(toolCall)}
        />
      {:else}
        {#each toolCall.content as item, i (i)}
          {#if item.type === "text"}
            <div
              class="font-[family-name:var(--font-mono)] text-[11.5px] leading-[1.55] text-fg-muted whitespace-pre-wrap"
              style:padding="8px 10px 10px 32px"
            >
              {stripCodeFence(item.text)}
            </div>
          {:else if item.type === "diff"}
            <DiffBody oldText={item.oldText} newText={item.newText} />
          {:else if item.type === "terminal"}
            <ShellBody
              command={extractCommand(toolCall.rawInput)}
              output={item.output ?? ""}
              exitCode={item.exitCode ?? null}
            />
          {/if}
        {/each}
      {/if}
    </div>
  {/if}
</div>
