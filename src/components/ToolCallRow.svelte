<!-- src/components/ToolCallRow.svelte -->
<script lang="ts">
  import { ChevronRight, ChevronDown } from "@lucide/svelte";
  import type {
    DisplayToolCall,
    MailboxMessage,
    ToolKind,
  } from "../stores/types";
  import MailboxToolRender from "./MailboxToolRender.svelte";
  import PeersToolRender from "./PeersToolRender.svelte";
  import SendToolRender from "./SendToolRender.svelte";

  interface Props {
    toolCall: DisplayToolCall;
  }

  let { toolCall }: Props = $props();
  let userToggled = $state<boolean | null>(null);
  let expanded = $derived(userToggled ?? toolCall.kind === "edit");

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

  const statusColor: Record<DisplayToolCall["status"], string> = {
    completed: "bg-success",
    failed: "bg-error",
    in_progress: "bg-warning",
    pending: "bg-fg-disabled",
  };

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

  /** Strip markdown code fences (```lang\n...\n```) from text content. */
  function stripCodeFence(text: string): string {
    return text.replace(/^```\w*\n?/, "").replace(/\n?```\s*$/, "");
  }

  let isMailboxTool = $derived(toolCall.name.endsWith("read_mailbox"));
  let isSendTool = $derived(toolCall.name.endsWith("send_message"));
  let isPeersTool = $derived(toolCall.name.endsWith("list_peers"));
  let isSpawnTool = $derived(toolCall.name.endsWith("spawn_agent"));
  let isKillTool = $derived(toolCall.name.endsWith("kill_agent"));
  let isConnectTool = $derived(toolCall.name.endsWith("connect_agents"));
  let isDisconnectTool = $derived(toolCall.name.endsWith("disconnect_agents"));
  let isSwarmTool = $derived(
    isMailboxTool ||
      isSendTool ||
      isPeersTool ||
      isSpawnTool ||
      isKillTool ||
      isConnectTool ||
      isDisconnectTool,
  );

  /** Try to parse JSON from the first text content item. */
  function parseTextContent(): unknown {
    try {
      const text = toolCall.content.find((c) => c.type === "text");
      if (text?.type === "text") return JSON.parse(text.text);
    } catch {
      /* */
    }
    return null;
  }

  let verb = $derived(
    isMailboxTool
      ? "Inbox"
      : isSendTool
        ? "Send"
        : isPeersTool
          ? "Peers"
          : isSpawnTool
            ? "Spawn"
            : isKillTool
              ? "Kill"
              : isConnectTool
                ? "Connect"
                : isDisconnectTool
                  ? "Disconnect"
                  : (kindVerb[toolCall.kind] ?? "Tool"),
  );

  let target = $derived.by(() => {
    if (isMailboxTool) {
      const parsed = parseTextContent();
      const msgs: MailboxMessage[] = Array.isArray(parsed)
        ? parsed
        : (((parsed as Record<string, unknown>)
            ?.messages as MailboxMessage[]) ?? []);
      return `${msgs.length} message${msgs.length === 1 ? "" : "s"}`;
    }
    if (isSendTool) {
      const parsed = parseTextContent() as Record<string, string> | null;
      return parsed?.target ?? toolCall.locations[0] ?? "";
    }
    if (isPeersTool) {
      const parsed = parseTextContent();
      const peers = Array.isArray(parsed) ? parsed : [];
      return `${peers.length} agent${peers.length === 1 ? "" : "s"}`;
    }
    if (isSpawnTool) {
      const parsed = parseTextContent() as Record<string, string> | null;
      return parsed?.agent_id ?? "";
    }
    if (isKillTool) {
      const parsed = parseTextContent() as Record<string, string> | null;
      return parsed?.status === "killed" ? "terminated" : "";
    }
    if (isConnectTool || isDisconnectTool) {
      const parsed = parseTextContent() as Record<string, string> | null;
      return parsed?.status ?? "";
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
    // Mockup shows "completed" for Inbox, "delivered" for Send
    if (isSendTool && toolCall.status === "completed") return "delivered";
    if (isMailboxTool && toolCall.status === "completed") return "completed";
    return null;
  });

  let statusLabelColor = $derived(
    toolCall.status === "failed"
      ? "text-error"
      : toolCall.status === "in_progress"
        ? "text-warning"
        : "text-fg-disabled",
  );

  let hasPreview = $derived(
    isMailboxTool ||
      isSendTool ||
      isPeersTool ||
      (toolCall.content.length > 0 &&
        toolCall.kind !== "read" &&
        toolCall.status !== "pending" &&
        toolCall.status !== "in_progress"),
  );
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
    <span
      class="w-1.5 h-1.5 rounded-full {statusColor[toolCall.status]} shrink-0"
    ></span>
    <span
      class="text-[12px] font-[family-name:var(--font-mono)] font-medium text-fg-default min-w-[44px]"
    >
      {verb}
    </span>
    <span
      class="text-[11px] font-[family-name:var(--font-mono)] text-fg-muted truncate"
    >
      {target}
    </span>
    {#if statusLabel}
      <span class="text-[10px] {statusLabelColor} ml-auto whitespace-nowrap"
        >{statusLabel}</span
      >
    {/if}
    {#if hasPreview}
      <span class="text-fg-disabled" class:ml-auto={!statusLabel}>
        {#if expanded}
          <ChevronDown size={10} />
        {:else}
          <ChevronRight size={10} />
        {/if}
      </span>
    {/if}
  </div>

  {#if expanded && isMailboxTool}
    {@const mailboxMessages = (() => {
      try {
        const text = toolCall.content.find((c) => c.type === "text");
        if (text?.type === "text") {
          const parsed = JSON.parse(text.text);
          return Array.isArray(parsed) ? parsed : (parsed.messages ?? []);
        }
      } catch {
        /* */
      }
      return [] as MailboxMessage[];
    })()}
    <MailboxToolRender messages={mailboxMessages} />
  {:else if expanded && isSendTool}
    {@const sendBody = (() => {
      const text = toolCall.content.find((c) => c.type === "text");
      if (text?.type === "text") {
        try {
          const parsed = JSON.parse(text.text);
          if (parsed.body) return parsed.body;
        } catch {
          /* */
        }
        return text.text;
      }
      return "";
    })()}
    <SendToolRender body={sendBody} />
  {:else if expanded && isPeersTool}
    {@const peers = (() => {
      const parsed = parseTextContent();
      return Array.isArray(parsed) ? parsed : [];
    })()}
    <PeersToolRender {peers} />
  {:else if expanded}
    <div class="flex flex-col gap-1.5 pb-1.5">
      {#each toolCall.content as item}
        {#if item.type === "text"}
          <div
            class="mx-2.5 ml-[30px] rounded bg-[rgba(0,0,0,0.03)] px-2 py-1.5 font-[family-name:var(--font-mono)] text-[10.5px] leading-normal text-fg-muted whitespace-pre-wrap"
          >
            {stripCodeFence(item.text)}
          </div>
        {:else if item.type === "diff"}
          <div
            class="mx-2.5 ml-[30px] rounded bg-[rgba(0,0,0,0.03)] px-2 py-1.5 font-[family-name:var(--font-mono)] text-[10.5px] leading-normal"
          >
            {#if item.oldText != null}
              {#each item.oldText.split("\n") as line}
                <div
                  class="rounded-sm bg-removed-bg text-removed-fg px-1 -mx-1"
                >
                  {`- ${line}`}
                </div>
              {/each}
            {/if}
            {#each item.newText.split("\n") as line}
              <div class="rounded-sm bg-added-bg text-added-fg px-1 -mx-1">
                {`+ ${line}`}
              </div>
            {/each}
          </div>
        {:else if item.type === "terminal" && item.output}
          {@const isFailed = toolCall.status === "failed"}
          <div
            class="mx-2.5 ml-[30px] rounded px-2 py-1.5 font-[family-name:var(--font-mono)] text-[10.5px] leading-normal whitespace-pre-wrap
            {isFailed
              ? 'bg-[rgba(200,60,60,0.04)] text-removed-fg'
              : 'bg-[rgba(0,0,0,0.03)] text-fg-muted'}"
          >
            {item.output}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>
