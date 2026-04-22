import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentDefinition,
  ConfigOption,
  DisplayMessage,
  DisplayThread,
  DisplayToolCall,
  NudgeDeliveredPayload,
  SystemMessagePayload,
  ToolCallContentItem,
  ToolKind,
} from "./types";

// ── Internal state per thread ────────────────────────────────────

interface ThreadState {
  id: string;
  agentDefinitionId: string;
  workspaceId: string;
  cli: string;
  agentName: string;
  status: "initializing" | "idle" | "working" | "error" | "dead";
  messages: DisplayMessage[];
  activeToolCalls: Record<string, DisplayToolCall>;
  stopReason: string | null;
  queuedContent: string;
  configOptions: ConfigOption[];
  errorMessage?: string;
  role?: string;
  hasPrompted?: boolean;
  acpSessionId?: string | null;
  taskId?: string | null;
}

// ── Event payloads from Rust ────────────────────────────────────

interface MessageChunkPayload {
  thread_id: string;
  content: string;
  kind: "message" | "thinking";
}

interface ToolCallContentPayload {
  type: string;
  text?: string;
  path?: string;
  old_text?: string | null;
  new_text?: string;
  terminal_id?: string;
  output?: string;
  exit_code?: number | null;
}

interface ToolCallEventPayload {
  thread_id: string;
  tool_call_id: string;
  title?: string;
  kind?: string;
  status?: string;
  locations?: string[];
  content?: ToolCallContentPayload[];
  raw_input?: unknown;
  raw_output?: unknown;
}

interface PromptCompletePayload {
  thread_id: string;
  stop_reason: string;
}

interface UserMessagePayload {
  thread_id: string;
  content: string;
}

interface ThreadErrorPayload {
  thread_id: string;
  message: string;
}

interface StatusChangePayload {
  thread_id: string;
  status: string;
}

interface SessionReadyPayload {
  thread_id: string;
  acp_session_id: string;
}

interface ConfigUpdatePayload {
  thread_id: string;
  config_options: ConfigOption[];
  changes: { option_name: string; new_value_name: string }[];
}

// ── Store ───────────────────────────────────────────────────────

interface ChunkBuffer {
  content: string;
  kind: "message" | "thinking";
}

function roleForKind(kind: "message" | "thinking"): "assistant" | "thinking" {
  return kind === "thinking" ? "thinking" : "assistant";
}

const EMERGENT_SYSTEM_RE = /<emergent-system>[\s\S]*?<\/emergent-system>\s*/g;

function stripSystemBlock(content: string): string {
  return content.replace(EMERGENT_SYSTEM_RE, "").trim();
}

function toDisplayThread(conn: ThreadState): DisplayThread {
  const lastMsg = conn.messages.at(-1);
  return {
    id: conn.id,
    agentId: conn.agentDefinitionId,
    workspaceId: conn.workspaceId,
    cli: conn.cli,
    name: conn.agentName,
    status: conn.status,
    processStatus: conn.status,
    preview: conn.role ?? (lastMsg?.content ? lastMsg.content.slice(0, 30) + "..." : ""),
    messages: conn.messages,
    activeToolCalls: Object.values(conn.activeToolCalls),
    queuedMessage: conn.queuedContent || null,
    configOptions: conn.configOptions,
    ...(conn.errorMessage !== undefined && { errorMessage: conn.errorMessage }),
    ...(conn.role !== undefined && { role: conn.role }),
    updatedAt: conn.messages.at(-1)?.timestamp ?? "just now",
    stopReason: conn.stopReason,
    taskId: conn.taskId ?? null,
  };
}

function createAgentStore() {
  // Plain object instead of Map — Svelte 5 reliably deep-proxies plain objects
  let threads: Record<string, ThreadState> = $state({});
  let listenerCleanup: UnlistenFn[] = [];
  let listenersReady = false;

  // Callback for dumping queued content to the input on error
  let onQueueDump: ((threadId: string, content: string) => void) | null = null;

  function registerQueueDumpHandler(handler: (threadId: string, content: string) => void) {
    onQueueDump = handler;
  }

  function getThread(threadId: string): ThreadState | undefined {
    return threads[threadId];
  }

  // ── Chunk buffering ─────────────────────────────────────────
  // Accumulate chunks in a plain (non-reactive) buffer and flush
  // once per animation frame to avoid per-chunk re-renders.

  const chunkBuffers: Record<string, ChunkBuffer> = {};
  let flushScheduled = false;

  function flushChunkBuffers() {
    for (const threadId of Object.keys(chunkBuffers)) {
      const buffer = chunkBuffers[threadId];
      const thread = threads[threadId];
      if (!thread || !buffer?.content) continue;

      const role = roleForKind(buffer.kind);
      const lastMsg = thread.messages.at(-1);

      // Append to the last message only if it matches the same role
      if (lastMsg && lastMsg.role === role && !lastMsg.toolCalls?.length) {
        lastMsg.content += buffer.content;
      } else {
        thread.messages.push({
          id: crypto.randomUUID(),
          role,
          content: buffer.content,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
        });
      }
    }

    // Reset buffer state
    for (const key of Object.keys(chunkBuffers)) {
      delete chunkBuffers[key];
    }
    flushScheduled = false;
  }

  // ── Message assembly ──────────────────────────────────────────

  function handleMessageChunk(payload: MessageChunkPayload) {
    const thread = threads[payload.thread_id];
    if (!thread) return;

    // During session resume (initializing), write immediately to preserve
    // message ordering. rAF buffering defers agent messages while user
    // messages are pushed synchronously, causing out-of-order rendering.
    if (thread.status === "initializing") {
      const role = roleForKind(payload.kind);
      const lastMsg = thread.messages.at(-1);
      if (lastMsg && lastMsg.role === role && !lastMsg.toolCalls?.length) {
        lastMsg.content += payload.content;
      } else {
        thread.messages.push({
          id: crypto.randomUUID(),
          role,
          content: payload.content,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
        });
      }
      return;
    }

    // Live streaming: buffer chunks and flush once per animation frame
    const existing = chunkBuffers[payload.thread_id];

    // If the kind changed mid-frame, flush first so thinking and message
    // don't merge into the same buffer.
    if (existing && existing.kind !== payload.kind) {
      flushChunkBuffers();
    }

    const buffer = chunkBuffers[payload.thread_id];
    if (buffer) {
      buffer.content += payload.content;
    } else {
      chunkBuffers[payload.thread_id] = {
        content: payload.content,
        kind: payload.kind,
      };
    }

    if (!flushScheduled) {
      flushScheduled = true;
      requestAnimationFrame(flushChunkBuffers);
    }
  }

  function mapToolCallContent(items: ToolCallContentPayload[]): ToolCallContentItem[] {
    return items.map((item): ToolCallContentItem => {
      if (item.type === "diff") {
        return {
          type: "diff",
          path: item.path ?? "",
          oldText: item.old_text ?? null,
          newText: item.new_text ?? "",
        };
      }
      if (item.type === "terminal") {
        const terminal: ToolCallContentItem = {
          type: "terminal",
          terminalId: item.terminal_id ?? "",
        };
        if (item.output != null) terminal.output = item.output;
        if (item.exit_code != null) terminal.exitCode = item.exit_code;
        return terminal;
      }
      return { type: "text", text: item.text ?? "" };
    });
  }

  function handleToolCallUpdate(payload: ToolCallEventPayload) {
    const thread = threads[payload.thread_id];
    if (!thread) return;

    const existing = thread.activeToolCalls[payload.tool_call_id];
    const tc: DisplayToolCall = {
      id: payload.tool_call_id,
      name: payload.title ?? existing?.name ?? "Tool call",
      kind: (payload.kind ?? existing?.kind ?? "other") as ToolKind,
      status: (payload.status ?? existing?.status ?? "pending") as DisplayToolCall["status"],
      locations: payload.locations ?? existing?.locations ?? [],
      content: payload.content ? mapToolCallContent(payload.content) : (existing?.content ?? []),
      rawInput: payload.raw_input ?? existing?.rawInput,
      rawOutput: payload.raw_output ?? existing?.rawOutput,
    };

    thread.activeToolCalls[payload.tool_call_id] = tc;

    if (payload.status === "completed" || payload.status === "failed") {
      const allDone = Object.values(thread.activeToolCalls).every(
        (t) => t.status === "completed" || t.status === "failed",
      );
      const count = Object.keys(thread.activeToolCalls).length;

      if (allDone && count > 0) {
        const toolCalls = Object.values(thread.activeToolCalls);
        thread.messages.push({
          id: crypto.randomUUID(),
          role: "tool-group",
          content: "",
          toolCalls,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
        });
        // Clear by replacing with empty object
        thread.activeToolCalls = {};
      }
    }
  }

  function handlePromptComplete(payload: PromptCompletePayload) {
    // Flush any buffered chunks before finalizing
    if (chunkBuffers[payload.thread_id]) {
      flushChunkBuffers();
    }

    const thread = threads[payload.thread_id];
    if (!thread) return;

    thread.stopReason = payload.stop_reason;

    // Flush queue: if content is queued, submit it as the next prompt.
    // Set status to "idle" first so sendPrompt takes the normal send path
    // (it checks status !== "working"). This is synchronous — no visible
    // flicker since Svelte batches reactive updates within the same microtask.
    if (thread.queuedContent) {
      const queued = thread.queuedContent;
      thread.queuedContent = "";
      thread.status = "idle";
      sendPrompt(thread.id, queued);
      return;
    }

    if (thread.status === "working") {
      thread.status = "idle";
    }
  }

  function handleError(payload: ThreadErrorPayload) {
    const thread = threads[payload.thread_id];
    if (!thread) return;

    if (thread.queuedContent && onQueueDump) {
      const queued = thread.queuedContent;
      thread.queuedContent = "";
      onQueueDump(payload.thread_id, queued);
    }

    thread.status = "error";
    thread.errorMessage = payload.message;
  }

  function handleUserMessage(payload: UserMessagePayload) {
    const thread = threads[payload.thread_id];
    if (!thread) return;

    thread.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: stripSystemBlock(payload.content),
      timestamp: new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    });
  }

  function handleSessionReady(payload: SessionReadyPayload) {
    const thread = threads[payload.thread_id];
    if (thread) {
      thread.acpSessionId = payload.acp_session_id;
    }
  }

  function handleStatusChange(payload: StatusChangePayload) {
    if (payload.status === "dead") {
      const thread = threads[payload.thread_id];
      if (thread?.acpSessionId) {
        // Persisted thread — keep as dead stub for future resumption
        thread.status = "dead";
      } else {
        delete threads[payload.thread_id];
      }
      return;
    }
    const thread = threads[payload.thread_id];
    if (!thread) {
      return;
    }
    thread.status = payload.status as ThreadState["status"];
  }

  function handleNudgeDelivered(payload: NudgeDeliveredPayload) {
    const thread = threads[payload.thread_id];
    if (!thread) return;

    // Check if the most recent message is a user message (coalesced case)
    const lastMsg = thread.messages.at(-1);
    if (lastMsg?.role === "user") {
      lastMsg.nudgeCount = payload.count;
    } else {
      // Standalone nudge — add as its own message
      thread.messages.push({
        id: crypto.randomUUID(),
        role: "nudge",
        content: "",
        nudgeCount: payload.count,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
      });
    }
  }

  function handleSystemMessage(payload: SystemMessagePayload) {
    const thread = threads[payload.thread_id];
    if (!thread) return;
    thread.messages.push({
      id: crypto.randomUUID(),
      role: "system",
      content: payload.content,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    });
  }

  function handleConfigUpdate(payload: ConfigUpdatePayload) {
    const thread = threads[payload.thread_id];
    if (!thread) return;

    thread.configOptions = payload.config_options;

    // Insert system message for agent-initiated changes (non-empty changes)
    if (payload.changes.length > 0) {
      const text = payload.changes
        .map((c) => `${c.option_name} changed to ${c.new_value_name}`)
        .join(", ");
      thread.messages.push({
        id: crypto.randomUUID(),
        role: "system",
        content: text,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
      });
    }
  }

  // ── Event listener setup ──────────────────────────────────────

  async function setupListeners() {
    if (listenersReady) return;

    listenerCleanup.push(
      await listen<MessageChunkPayload>("thread:message-chunk", (e) =>
        handleMessageChunk(e.payload),
      ),
    );
    listenerCleanup.push(
      await listen<ToolCallEventPayload>("thread:tool-call-update", (e) =>
        handleToolCallUpdate(e.payload),
      ),
    );
    listenerCleanup.push(
      await listen<PromptCompletePayload>("thread:prompt-complete", (e) =>
        handlePromptComplete(e.payload),
      ),
    );
    listenerCleanup.push(
      await listen<ThreadErrorPayload>("thread:error", (e) => handleError(e.payload)),
    );
    listenerCleanup.push(
      await listen<StatusChangePayload>("thread:status-change", (e) =>
        handleStatusChange(e.payload),
      ),
    );
    listenerCleanup.push(
      await listen<SessionReadyPayload>("thread:session-ready", (e) =>
        handleSessionReady(e.payload),
      ),
    );
    listenerCleanup.push(
      await listen<UserMessagePayload>("thread:user-message", (e) => handleUserMessage(e.payload)),
    );
    listenerCleanup.push(
      await listen<ConfigUpdatePayload>("thread:config-update", (e) =>
        handleConfigUpdate(e.payload),
      ),
    );
    listenerCleanup.push(
      await listen<NudgeDeliveredPayload>("thread:nudge-delivered", (e) =>
        handleNudgeDelivered(e.payload),
      ),
    );
    listenerCleanup.push(
      await listen<SystemMessagePayload>("thread:system-message", (e) =>
        handleSystemMessage(e.payload),
      ),
    );
    listenersReady = true;
  }

  // ── Public API ────────────────────────────────────────────────

  // Per-agent thread counter for naming
  const threadCounters: Record<string, number> = {};

  function registerPersistedThread(
    threadId: string,
    agentDefinitionId: string,
    agentDefinition: AgentDefinition,
    acpSessionId: string | null,
    taskId?: string | null,
  ) {
    if (threads[threadId]) return; // Already known (live thread)

    const count = (threadCounters[agentDefinitionId] ?? 0) + 1;
    threadCounters[agentDefinitionId] = count;

    threads[threadId] = {
      id: threadId,
      agentDefinitionId,
      workspaceId: agentDefinition.workspace_id,
      cli: agentDefinition.cli,
      agentName: `Thread ${count}`,
      status: "dead",
      messages: [],
      activeToolCalls: {},
      stopReason: null,
      queuedContent: "",
      configOptions: [],
      acpSessionId,
      taskId: taskId ?? null,
    };
  }

  async function spawnThread(
    agentDefinitionId: string,
    agentDefinition: AgentDefinition,
  ): Promise<string> {
    const threadId = await invoke<string>("spawn_thread", {
      agentId: agentDefinitionId,
    });

    const count = (threadCounters[agentDefinitionId] ?? 0) + 1;
    threadCounters[agentDefinitionId] = count;

    threads[threadId] = {
      id: threadId,
      agentDefinitionId,
      workspaceId: agentDefinition.workspace_id,
      cli: agentDefinition.cli,
      agentName: `Thread ${count}`,
      status: "initializing",
      messages: [],
      activeToolCalls: {},
      stopReason: null,
      queuedContent: "",
      configOptions: [],
    };

    return threadId;
  }

  async function sendPrompt(threadId: string, text: string): Promise<void> {
    const thread = threads[threadId];
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    // Queue path: thread is busy, accumulate content
    if (thread.status === "working") {
      thread.queuedContent = thread.queuedContent ? thread.queuedContent + "\n\n" + text : text;
      return;
    }

    thread.hasPrompted = true;

    thread.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    });

    thread.status = "working";

    invoke("send_prompt", { threadId, text }).catch((err) => {
      thread.status = "error";
      console.error("send_prompt failed:", err);
    });
  }

  async function cancelPrompt(threadId: string): Promise<void> {
    await invoke("cancel_prompt", { threadId });
  }

  function editQueue(threadId: string): string {
    const thread = threads[threadId];
    if (!thread) return "";
    const content = thread.queuedContent;
    thread.queuedContent = "";
    return content;
  }

  async function setConfig(threadId: string, configId: string, value: string): Promise<void> {
    const thread = threads[threadId];
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    // Optimistic update — use $state.snapshot to clone the reactive proxy
    const previousConfig = $state.snapshot(thread.configOptions);
    const opt = thread.configOptions.find((o) => o.id === configId);
    if (opt) opt.current_value = value;

    try {
      await invoke<ConfigOption[]>("set_thread_config", {
        threadId,
        configId,
        value,
      });
    } catch (err) {
      // Revert on error
      thread.configOptions = previousConfig;
      console.error("set_thread_config failed:", err);
    }
  }

  async function killThread(threadId: string): Promise<void> {
    try {
      await invoke("kill_thread", { threadId });
    } catch (err) {
      console.error("kill_thread RPC failed (cleaning up anyway):", err);
    }
    delete threads[threadId];
  }

  /** Reset a thread's chat state before resuming (avoids duplicate history on replay). */
  function resetThreadState(threadId: string): void {
    const thread = threads[threadId];
    if (!thread) return;
    thread.messages = [];
    thread.activeToolCalls = {};
    thread.queuedContent = "";
    thread.stopReason = null;
    delete thread.errorMessage;
  }

  /** Stop a thread — kills the process but keeps the dead stub for resumption. */
  async function stopThread(threadId: string): Promise<void> {
    const thread = threads[threadId];
    if (!thread || thread.status === "dead") return;
    try {
      await invoke("shutdown_thread", { threadId });
    } catch (err) {
      console.error("shutdown_thread RPC failed (marking dead anyway):", err);
    }
    // Keep the stub with dead status (handleStatusChange may have already done this)
    if (threads[threadId]) {
      threads[threadId].status = "dead";
    }
  }

  /** Delete a thread — kills and removes from the store entirely. */
  function deleteThread(threadId: string): void {
    delete threads[threadId];
  }

  function setRole(threadId: string, role: string): void {
    const thread = threads[threadId];
    if (!thread || thread.hasPrompted) return;
    if (role) {
      thread.role = role;
    } else {
      delete thread.role;
    }
  }

  function getThreadsForAgent(agentDefinitionId: string): ThreadState[] {
    return Object.values(threads).filter((t) => t.agentDefinitionId === agentDefinitionId);
  }

  type DaemonNotification =
    | ({ type: "thread:message-chunk" } & MessageChunkPayload)
    | ({ type: "thread:tool-call-update" } & ToolCallEventPayload)
    | ({ type: "thread:prompt-complete" } & PromptCompletePayload)
    | ({ type: "thread:status-change" } & StatusChangePayload)
    | ({ type: "thread:config-update" } & ConfigUpdatePayload)
    | ({ type: "thread:user-message" } & UserMessagePayload)
    | ({ type: "thread:error" } & ThreadErrorPayload)
    | ({ type: "thread:nudge-delivered" } & NudgeDeliveredPayload)
    | ({ type: "thread:system-message" } & SystemMessagePayload)
    | ({ type: "thread:session-ready" } & SessionReadyPayload);

  function replayNotifications(notifications: DaemonNotification[]) {
    // Local tool call accumulator — keeps live activeToolCalls clean
    const replayToolCalls: Record<string, Record<string, DisplayToolCall>> = {};

    for (const n of notifications) {
      const thread = threads[n.thread_id];
      if (!thread) continue;

      switch (n.type) {
        case "thread:message-chunk": {
          const role = roleForKind(n.kind);
          const lastMsg = thread.messages.at(-1);
          if (lastMsg && lastMsg.role === role && !lastMsg.toolCalls?.length) {
            lastMsg.content += n.content;
          } else {
            thread.messages.push({
              id: crypto.randomUUID(),
              role,
              content: n.content,
              timestamp: new Date().toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              }),
            });
          }
          break;
        }

        case "thread:user-message":
          thread.messages.push({
            id: crypto.randomUUID(),
            role: "user",
            content: stripSystemBlock(n.content),
            timestamp: new Date().toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            }),
          });
          break;

        case "thread:tool-call-update": {
          const threadTCs = (replayToolCalls[n.thread_id] ??= {});
          const existing = threadTCs[n.tool_call_id];
          threadTCs[n.tool_call_id] = {
            id: n.tool_call_id,
            name: n.title ?? existing?.name ?? "Tool call",
            kind: (n.kind ?? existing?.kind ?? "other") as ToolKind,
            status: (n.status ?? existing?.status ?? "pending") as DisplayToolCall["status"],
            locations: n.locations ?? existing?.locations ?? [],
            content: n.content ? mapToolCallContent(n.content) : (existing?.content ?? []),
            rawInput: n.raw_input ?? existing?.rawInput,
            rawOutput: n.raw_output ?? existing?.rawOutput,
          };

          if (n.status === "completed" || n.status === "failed") {
            const allDone = Object.values(threadTCs).every(
              (t) => t.status === "completed" || t.status === "failed",
            );
            if (allDone && Object.keys(threadTCs).length > 0) {
              thread.messages.push({
                id: crypto.randomUUID(),
                role: "tool-group",
                content: "",
                toolCalls: Object.values(threadTCs),
                timestamp: new Date().toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                }),
              });
              replayToolCalls[n.thread_id] = {};
            }
          }
          break;
        }

        case "thread:system-message":
          thread.messages.push({
            id: crypto.randomUUID(),
            role: "system",
            content: n.content,
            timestamp: new Date().toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            }),
          });
          break;

        case "thread:config-update":
          thread.configOptions = n.config_options;
          if (n.changes.length > 0) {
            const text = n.changes
              .map((c) => `${c.option_name} changed to ${c.new_value_name}`)
              .join(", ");
            thread.messages.push({
              id: crypto.randomUUID(),
              role: "system",
              content: text,
              timestamp: new Date().toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              }),
            });
          }
          break;

        case "thread:nudge-delivered": {
          const lastMsg = thread.messages.at(-1);
          if (lastMsg?.role === "user") {
            lastMsg.nudgeCount = n.count;
          } else {
            thread.messages.push({
              id: crypto.randomUUID(),
              role: "nudge",
              content: "",
              nudgeCount: n.count,
              timestamp: new Date().toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              }),
            });
          }
          break;
        }

        // No-ops: no side effects during replay
        case "thread:prompt-complete":
        case "thread:status-change":
        case "thread:error":
        case "thread:session-ready":
          break;
      }
    }

    // Flush any remaining in-progress tool calls so the user can see
    // what was running when the session ended
    for (const threadId of Object.keys(replayToolCalls)) {
      const threadTCs = replayToolCalls[threadId];
      const thread = threads[threadId];
      if (!thread || !threadTCs || Object.keys(threadTCs).length === 0) continue;
      thread.messages.push({
        id: crypto.randomUUID(),
        role: "tool-group",
        content: "",
        toolCalls: Object.values(threadTCs),
        timestamp: new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
      });
    }
  }

  function syncThreadSnapshot(
    threadId: string,
    snapshot: {
      status: ThreadState["status"];
      acpSessionId?: string | null;
      history: unknown[];
      configOptions: ConfigOption[];
    },
  ): void {
    const thread = threads[threadId];
    if (!thread) return;

    resetThreadState(threadId);
    replayNotifications(snapshot.history as DaemonNotification[]);
    thread.configOptions = snapshot.configOptions;
    thread.status = snapshot.status;
    thread.acpSessionId = snapshot.acpSessionId ?? thread.acpSessionId ?? null;
    delete thread.errorMessage;
  }

  return {
    get threads() {
      return threads;
    },
    getThread,
    toDisplayThread,
    getThreadsForAgent,
    setupListeners,
    registerPersistedThread,
    spawnThread,
    sendPrompt,
    cancelPrompt,
    killThread,
    resetThreadState,
    stopThread,
    deleteThread,
    setConfig,
    editQueue,
    registerQueueDumpHandler,
    replayNotifications,
    syncThreadSnapshot,
    setRole,
  };
}

export const agentStore = createAgentStore();
