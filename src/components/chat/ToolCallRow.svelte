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
    parseUpdateTaskToolInput,
    parseUpdateTaskToolContent,
  } from "../../lib/emergent-tool-calls";
  import type { DisplayToolCall, ToolKind } from "../../stores/types";
  import CreateTaskToolRender from "./CreateTaskToolRender.svelte";
  import UpdateTaskToolRender from "./UpdateTaskToolRender.svelte";
  import ListAgentsToolRender from "./ListAgentsToolRender.svelte";
  import ListTasksToolRender from "./ListTasksToolRender.svelte";
  import ToolVerbIcon from "./ToolVerbIcon.svelte";
  import ToolStatusGlyph from "./ToolStatusGlyph.svelte";
  import DiffBody from "./DiffBody.svelte";
  import ShellBody from "./ShellBody.svelte";

  interface Props {
    toolCall: DisplayToolCall;
    /** Optional trailing mono meta (e.g. "L1–48", "12 matches", "2.3s"). */
    meta?: string;
  }

  let { toolCall, meta }: Props = $props();
  let emergentToolName = $derived(getEmergentToolName(toolCall.name));
  let isListAgentsTool = $derived(emergentToolName === "list_agents");
  let isListTasksTool = $derived(emergentToolName === "list_tasks");
  let isCreateTaskTool = $derived(emergentToolName === "create_task");
  let isCompleteTaskTool = $derived(emergentToolName === "complete_task");
  let isUpdateTaskTool = $derived(emergentToolName === "update_task");

  // ── Expansion state ────────────────────────────────────────────
  // Rule: auto-open while running, auto-collapse once resolved. As soon as
  // the user clicks the chevron we hand them the wheel and stop reacting
  // to status changes on this row.
  let userToggled = $state(false);
  let userExpanded = $state(false);
  let expanded = $derived(
    userToggled ? userExpanded : toolCall.status === "in_progress",
  );

  function toggle() {
    if (!hasPreview) return;
    userToggled = true;
    userExpanded = !expanded;
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
            : isUpdateTaskTool
              ? "Update Task"
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
    if (isUpdateTaskTool) {
      return parseUpdateTaskToolInput(toolCall)?.description ?? "";
    }
    return (
      toolCall.locations[0] ??
      toolCall.name.replace(/^(Read|Write|Edit|Bash|Search)\s*/i, "") ??
      ""
    );
  });

  // Allow `statusLabel` on any status — design shows `exit 0`, `cached`,
  // `streaming…` on success too (em-tool-calls.jsx:252-257).
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
      isUpdateTaskTool ||
      (toolCall.content.length > 0 &&
        toolCall.kind !== "read" &&
        toolCall.status !== "pending"),
  );
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="rounded-[8px] {expanded
    ? 'bg-bg-elevated border border-border-default'
    : 'border border-transparent'} {hasPreview ? 'interactive' : ''}"
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
      class="text-[12px] font-[family-name:var(--font-mono)] font-medium text-fg-default min-w-[44px] shrink-0 {toolCall.status ===
      'in_progress'
        ? 'em-shimmer-text'
        : ''}"
    >
      {verb}
    </span>
    <span
      class="text-[11px] font-[family-name:var(--font-mono)] text-fg-muted truncate min-w-0"
    >
      {target}
    </span>
    {#if hasPreview}
      <span class="text-fg-disabled shrink-0 inline-flex">
        {#if expanded}
          <ChevronDown size={10} />
        {:else}
          <ChevronRight size={10} />
        {/if}
      </span>
    {/if}
    <span class="flex-1 min-w-[4px]"></span>
    {#if meta}
      <span
        class="text-[11px] font-[family-name:var(--font-mono)] text-fg-muted tabular-nums truncate shrink-0 max-w-[40%]"
      >
        {meta}
      </span>
    {/if}
    <ToolStatusGlyph status={toolCall.status} size={10} />
    {#if statusLabel}
      <span class="text-[10px] {statusLabelColor} whitespace-nowrap shrink-0"
        >{statusLabel}</span
      >
    {/if}
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
      {:else if isUpdateTaskTool}
        <UpdateTaskToolRender
          input={parseUpdateTaskToolInput(toolCall)}
          result={parseUpdateTaskToolContent(toolCall)}
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
              rawInput={toolCall.rawInput}
              output={item.output ?? ""}
              exitCode={item.exitCode ?? null}
            />
          {/if}
        {/each}
      {/if}
    </div>
  {/if}
</div>
