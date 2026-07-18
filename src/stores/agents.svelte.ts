import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  normalizeThreadSummaryStatus,
  type AgentDefinition,
  type AgentProvider,
  type ConfigOption,
  type DisplayMessage,
  type DisplayThread,
  type DisplayToolCall,
  type NudgeDeliveredPayload,
  type QueueChangedPayload,
  type QueueItem,
  type QueuedMessageView,
  type SystemMessagePayload,
  type ToolCallContentItem,
  type ToolKind,
  type TurnDispatchedPayload,
} from "./types";

// ── Internal state per thread ────────────────────────────────────

interface ThreadState {
  id: string;
  agentDefinitionId: string;
  workspaceId: string;
  provider: AgentProvider;
  agentName: string;
  status: "initializing" | "idle" | "working" | "cancelling" | "error" | "dead";
  messages: DisplayMessage[];
  activeToolCalls: Record<string, DisplayToolCall>;
  stopReason: string | null;
  /** Pre-submission queue: items waiting to be drained on the next idle transition. */
  pendingQueue: QueueItem[];
  configOptions: ConfigOption[];
  errorMessage?: string;
  hasPrompted?: boolean;
  acpSessionId?: string | null;
  taskId?: string | null;
  tokenUsage?: { used: number; size: number } | undefined;
  drainQueueOnIdle?: boolean;
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
  is_echo: boolean;
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

interface ThreadTokenUsagePayload {
  thread_id: string;
  used_tokens: number;
  context_size: number;
  cost_amount?: number;
  cost_currency?: string;
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
    provider: conn.provider,
    name: conn.agentName,
    processStatus: conn.status,
    preview: lastMsg?.content ? lastMsg.content.slice(0, 30) + "..." : "",
    messages: conn.messages,
    activeToolCalls: Object.values(conn.activeToolCalls),
    queuedMessage: conn.pendingQueue.at(-1)?.content ?? null,
    configOptions: conn.configOptions,
    ...(conn.errorMessage !== undefined && { errorMessage: conn.errorMessage }),
    updatedAt: conn.messages.at(-1)?.timestamp ?? "just now",
    stopReason: conn.stopReason,
    taskId: conn.taskId ?? null,
    tokenUsage: conn.tokenUsage,
  };
}

/** The replayable subset of thread-scoped notifications. */
type DaemonNotification =
  | ({ type: "thread:message-chunk" } & MessageChunkPayload)
  | ({ type: "thread:tool-call-update" } & ToolCallEventPayload)
  | ({ type: "thread:prompt-complete" } & PromptCompletePayload)
  | ({ type: "thread:status-change" } & StatusChangePayload)
  | ({ type: "thread:config-update" } & ConfigUpdatePayload)
  | ({ type: "thread:user-message" } & UserMessagePayload)
  | ({ type: "thread:turn-dispatched" } & TurnDispatchedPayload)
  | ({ type: "thread:error" } & ThreadErrorPayload)
  | ({ type: "thread:nudge-delivered" } & NudgeDeliveredPayload)
  | ({ type: "thread:system-message" } & SystemMessagePayload)
  | ({ type: "thread:session-ready" } & SessionReadyPayload);

/** Shape of the unit-test-only seam on `agentStore`. See `_test` below. */
interface AgentStoreTestApi {
  handlePromptComplete: (payload: PromptCompletePayload) => void;
  handleStatusChange: (payload: StatusChangePayload) => void;
  handleError: (payload: ThreadErrorPayload) => void;
  handleUserMessage: (payload: UserMessagePayload) => void;
  handleQueueChanged: (payload: QueueChangedPayload) => void;
  handleTurnDispatched: (payload: TurnDispatchedPayload) => void;
  replayNotifications: (notifications: DaemonNotification[]) => void;
  readonly chunkBuffers: Record<string, ChunkBuffer>;
  injectThread: (
    threadId: string,
    partial: Partial<ThreadState> & { id: string; agentDefinitionId: string },
  ) => void;
  removeThread: (threadId: string) => void;
}

function createAgentStore() {
  // Plain object instead of Map — Svelte 5 reliably deep-proxies plain objects
  let threads: Record<string, ThreadState> = $state({});
  let listenerCleanup: UnlistenFn[] = [];
  let listenersReady = false;
  /** Bumped by teardown so an in-flight setupListeners knows to abandon. */
  let setupEpoch = 0;

  function getThread(threadId: string): ThreadState | undefined {
    return threads[threadId];
  }

  // ── Chunk buffering ─────────────────────────────────────────
  // Accumulate chunks in a plain (non-reactive) buffer and flush
  // once per animation frame to avoid per-chunk re-renders.

  const chunkBuffers: Record<string, ChunkBuffer> = {};
  let flushScheduled = false;
  let flushHandle: number | null = null;

  function flushChunkBuffers() {
    for (const threadId of Object.keys(chunkBuffers)) {
      const buffer = chunkBuffers[threadId];
      const thread = threads[threadId];
      if (!thread || !buffer?.content) continue;

      if (thread.status === "cancelling") {
        delete chunkBuffers[threadId];
        continue;
      }

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
    // This runs both as the rAF callback and as a direct synchronous flush. In
    // the synchronous case a frame is still queued, and simply nulling the
    // handle would strand it: the stale callback would later clear whatever
    // handle had been scheduled in the meantime, so teardown would have nothing
    // left to cancel. Cancelling first keeps "flushHandle is the only live
    // frame" true. Cancelling the frame we are currently running is a no-op.
    if (flushHandle !== null) {
      cancelAnimationFrame(flushHandle);
      flushHandle = null;
    }
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
      flushHandle = requestAnimationFrame(flushChunkBuffers);
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
    // Flush any buffered chunks before finalizing (B3a)
    if (chunkBuffers[payload.thread_id]) {
      flushChunkBuffers();
    }
    // B3a: explicitly delete the buffer entry after flushing
    delete chunkBuffers[payload.thread_id];

    const thread = threads[payload.thread_id];
    if (!thread) return;

    thread.stopReason = payload.stop_reason;

    // B3b: mark the last assistant message as cancelled when stop reason indicates so.
    // Also clear any in-flight sending bubble when the prompt was cancelled.
    if (payload.stop_reason.includes("Cancelled")) {
      const lastAssistant = thread.messages.toReversed().find((m) => m.role === "assistant");
      if (lastAssistant) {
        lastAssistant.cancelled = true;
      }
      // Clear sending flag on any in-flight bubble (step 5: prompt-cancelled transition)
      for (const msg of thread.messages) {
        if (msg.sending) {
          msg.sending = false;
        }
      }
    }

    // Draining is the backend's job now: it coalesces the queue into the next
    // turn and emits `QueueChanged`. Nothing to arm here.
    if (thread.status === "working" || thread.status === "cancelling") {
      thread.status = "idle";
    }
  }

  function handleError(payload: ThreadErrorPayload) {
    const thread = threads[payload.thread_id];
    if (!thread) return;

    // Step 5 (IPC async error transition): clear sending flag on any in-flight bubble.
    for (const msg of thread.messages) {
      if (msg.sending) {
        msg.sending = false;
      }
    }

    for (const item of thread.pendingQueue) {
      item.failed = true;
    }

    // Fixup 2: clear drainQueueOnIdle so a stale idle event cannot trigger a
    // drain against an erroring thread.
    thread.drainQueueOnIdle = false;
    thread.status = "error";
    thread.errorMessage = payload.message;
  }

  function handleUserMessage(payload: UserMessagePayload) {
    const thread = threads[payload.thread_id];
    if (!thread) return;

    // The drained-turn echo is now owned by handleTurnDispatched — drop it.
    // Only spontaneous (non-echo) user messages are pushed here.
    if (payload.is_echo) return;

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

    const next = normalizeThreadSummaryStatus(payload.status);

    // B5: do not overwrite "cancelling" with "working" — the cancel is in flight
    if (thread.status === "cancelling" && next === "working") {
      return;
    }

    thread.status = next;
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

  function handleTokenUsage(payload: ThreadTokenUsagePayload) {
    const thread = threads[payload.thread_id];
    if (!thread) return;
    thread.tokenUsage = { used: payload.used_tokens, size: payload.context_size };
  }

  /**
   * Map a backend queue item (wire format) to the frontend `QueueItem`.
   * `source` drives the read-only badge: user items are editable, task/thread
   * items are inbound and rendered read-only (reusing the "task-notification"
   * kind the queue component already understands).
   */
  function viewToQueueItem(v: QueuedMessageView): QueueItem {
    const item: QueueItem = {
      id: v.id,
      content: v.content,
      submittedAt: Date.parse(v.created_at) || Date.now(),
      kind: v.source === "user" ? "user" : "task-notification",
      source: v.source,
    };
    if (v.from !== undefined) item.from = v.from;
    if (v.task_id !== undefined) item.taskId = v.task_id;
    if (v.task_status !== undefined) item.taskStatus = v.task_status;
    return item;
  }

  /**
   * The backend queue is the source of truth. `QueueChanged` is emitted only for
   * mutations the frontend did NOT initiate (an inbound inter-thread/task
   * message landed, or the prompt loop drained at turn start). Self-initiated
   * edits update the mirror from their command's return value instead.
   */
  function handleQueueChanged(payload: QueueChangedPayload) {
    const thread = threads[payload.thread_id];
    if (!thread) return;
    thread.pendingQueue = payload.items.map(viewToQueueItem);
  }

  /** Map a backend queue item (wire format) to a read-only notification transcript block. */
  function viewToNotification(v: QueuedMessageView): DisplayMessage {
    const m: DisplayMessage = {
      id: v.id,
      role: "notification",
      content: v.content,
      timestamp: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      source: v.source === "thread" ? "thread" : "task",
    };
    if (v.from !== undefined) m.from = v.from;
    if (v.task_id !== undefined) m.taskId = v.task_id;
    if (v.task_status !== undefined)
      m.taskStatus = v.task_status as NonNullable<DisplayMessage["taskStatus"]>;
    return m;
  }

  /**
   * Settle a turn's notifications as read-only transcript blocks, deduped by id.
   * Shared by the live `handleTurnDispatched` path and history replay — both
   * append the same notification rails, they only differ in how the paired user
   * bubble is rendered (live re-anchors an optimistic bubble; replay does not).
   */
  function appendNotificationBlocks(thread: ThreadState, notifications: QueuedMessageView[]) {
    for (const v of notifications) {
      if (thread.messages.some((m) => m.role === "notification" && m.id === v.id)) continue;
      thread.messages.push(viewToNotification(v));
    }
  }

  /**
   * A drained turn was accepted by the command loop. Settle its notifications as
   * read-only transcript blocks (dedupe-by-id), then render the user bubble from
   * `user_text` only — notifications-first canonical order. Owns the reconciliation
   * of the idle optimistic bubble (handleUserMessage no longer does).
   */
  function handleTurnDispatched(payload: TurnDispatchedPayload) {
    const thread = threads[payload.thread_id];
    if (!thread) return;

    appendNotificationBlocks(thread, payload.notifications);

    if (payload.user_text != null && payload.user_text !== "") {
      const ts = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const optimistic = thread.messages.find((m) => m.sending === true);
      if (optimistic) {
        // Re-anchor below the notifications + normalize the timestamp so it does
        // not read earlier than the rails now above it.
        const idx = thread.messages.indexOf(optimistic);
        thread.messages.splice(idx, 1);
        optimistic.sending = false;
        optimistic.timestamp = ts;
        thread.messages.push(optimistic);
      } else {
        thread.messages.push({
          id: crypto.randomUUID(),
          role: "user",
          content: payload.user_text,
          timestamp: ts,
        });
      }
    }
  }

  // ── Event listener setup ──────────────────────────────────────

  async function setupListeners() {
    if (listenersReady) return;

    // Collect into a local array and commit only at the end. `listen()` is
    // async, so a teardown can land mid-setup; without the epoch check below
    // the remaining listeners would still register and the store would be left
    // with a *partial* subscription that `listenersReady` then hides.
    const myEpoch = setupEpoch;
    const pending: UnlistenFn[] = [];

    pending.push(
      await listen<MessageChunkPayload>("thread:message-chunk", (e) =>
        handleMessageChunk(e.payload),
      ),
    );
    pending.push(
      await listen<ToolCallEventPayload>("thread:tool-call-update", (e) =>
        handleToolCallUpdate(e.payload),
      ),
    );
    pending.push(
      await listen<PromptCompletePayload>("thread:prompt-complete", (e) =>
        handlePromptComplete(e.payload),
      ),
    );
    pending.push(await listen<ThreadErrorPayload>("thread:error", (e) => handleError(e.payload)));
    pending.push(
      await listen<StatusChangePayload>("thread:status-change", (e) =>
        handleStatusChange(e.payload),
      ),
    );
    pending.push(
      await listen<SessionReadyPayload>("thread:session-ready", (e) =>
        handleSessionReady(e.payload),
      ),
    );
    pending.push(
      await listen<UserMessagePayload>("thread:user-message", (e) => handleUserMessage(e.payload)),
    );
    pending.push(
      await listen<ConfigUpdatePayload>("thread:config-update", (e) =>
        handleConfigUpdate(e.payload),
      ),
    );
    pending.push(
      await listen<NudgeDeliveredPayload>("thread:nudge-delivered", (e) =>
        handleNudgeDelivered(e.payload),
      ),
    );
    pending.push(
      await listen<SystemMessagePayload>("thread:system-message", (e) =>
        handleSystemMessage(e.payload),
      ),
    );
    pending.push(
      await listen<ThreadTokenUsagePayload>("thread:token-usage", (e) =>
        handleTokenUsage(e.payload),
      ),
    );
    pending.push(
      await listen<QueueChangedPayload>("thread:queue-changed", (e) =>
        handleQueueChanged(e.payload),
      ),
    );
    pending.push(
      await listen<TurnDispatchedPayload>("thread:turn-dispatched", (e) =>
        handleTurnDispatched(e.payload),
      ),
    );
    if (myEpoch !== setupEpoch) {
      // Torn down while we were awaiting — drop what we registered.
      for (const unlisten of pending) unlisten();
      return;
    }

    listenerCleanup = pending;
    listenersReady = true;
  }

  /**
   * Detach every Tauri listener and cancel any pending chunk flush.
   *
   * Resets `listenersReady` so a later `setupListeners()` re-subscribes — without
   * this, an HMR reload or a remounting test would stack a second set of
   * listeners on the same events and double-apply every notification.
   */
  function teardown() {
    setupEpoch += 1;
    for (const unlisten of listenerCleanup) unlisten();
    listenerCleanup = [];
    listenersReady = false;

    if (flushHandle !== null) {
      cancelAnimationFrame(flushHandle);
      flushHandle = null;
    }
    flushScheduled = false;
    for (const key of Object.keys(chunkBuffers)) delete chunkBuffers[key];
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
      provider: agentDefinition.provider,
      agentName: `Thread ${count}`,
      status: "dead",
      messages: [],
      activeToolCalls: {},
      stopReason: null,
      pendingQueue: [],
      configOptions: [],
      acpSessionId,
      taskId: taskId ?? null,
      tokenUsage: undefined,
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
      provider: agentDefinition.provider,
      agentName: `Thread ${count}`,
      status: "initializing",
      messages: [],
      activeToolCalls: {},
      stopReason: null,
      pendingQueue: [],
      configOptions: [],
      tokenUsage: undefined,
      drainQueueOnIdle: false,
    };

    return threadId;
  }

  async function sendPrompt(threadId: string, text: string): Promise<void> {
    const thread = threads[threadId];
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    // Queue path: thread is busy or cancelling — enqueue backend-side. The
    // backend holds it and the chip appears via the `QueueChanged` event. Do NOT
    // push to thread.messages here; the chip stack renders pendingQueue.
    if (thread.status === "working" || thread.status === "cancelling") {
      invoke("send_prompt", { threadId, text }).catch((err) => {
        console.error("send_prompt (enqueue) failed:", err);
      });
      return;
    }

    thread.hasPrompted = true;

    // Push a sending bubble that will be confirmed (sending=false) when the
    // agent echoes back a UserMessageChunk with is_echo=true.
    thread.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
      sending: true,
    });

    thread.status = "working";

    invoke("send_prompt", { threadId, text }).catch((err) => {
      // Step 5: IPC sync error transition — clear sending flag, set error status
      for (const msg of thread.messages) {
        if (msg.sending) {
          msg.sending = false;
        }
      }
      thread.status = "error";
      console.error("send_prompt failed:", err);
    });
  }

  async function cancelPrompt(threadId: string): Promise<void> {
    const thread = threads[threadId];
    if (!thread || thread.status !== "working") return;
    flushChunkBuffers();
    thread.status = "cancelling";
    // Fixup 3: catch IPC rejection so a failed cancel_prompt doesn't leave a
    // stuck sending=true bubble in the thread.
    try {
      await invoke("cancel_prompt", { threadId });
    } catch (err) {
      // Clear any in-flight sending bubble and put the thread in error state.
      for (const msg of thread.messages) {
        if (msg.sending) {
          msg.sending = false;
        }
      }
      thread.status = "error";
      console.error("cancel_prompt failed:", err);
    }
  }

  /**
   * Remove one queued message via the backend. The mirror is updated from the
   * command's returned snapshot (self-initiated → no `QueueChanged` event).
   */
  async function removeQueueItem(threadId: string, itemId: string): Promise<void> {
    const thread = threads[threadId];
    if (!thread) return;
    try {
      const items = await invoke<QueuedMessageView[]>("remove_queued", {
        threadId,
        msgId: itemId,
      });
      thread.pendingQueue = items.map(viewToQueueItem);
    } catch (err) {
      // Likely already drained — the next QueueChanged/list_queue reconciles.
      console.error("remove_queued failed:", err);
    }
  }

  /** Replace the content of one queued message via the backend. */
  async function updateQueueItem(threadId: string, itemId: string, content: string): Promise<void> {
    const thread = threads[threadId];
    if (!thread) return;
    try {
      const items = await invoke<QueuedMessageView[]>("edit_queued", {
        threadId,
        msgId: itemId,
        text: content,
      });
      thread.pendingQueue = items.map(viewToQueueItem);
    } catch (err) {
      console.error("edit_queued failed:", err);
    }
  }

  /** Clear all queued messages for a thread via the backend. */
  async function clearQueue(threadId: string): Promise<void> {
    const thread = threads[threadId];
    if (!thread) return;
    try {
      await invoke("clear_queue", { threadId });
      thread.pendingQueue = [];
    } catch (err) {
      console.error("clear_queue failed:", err);
    }
  }

  /** Seed the queue mirror from the backend (e.g. when a thread view opens). */
  async function refreshQueue(threadId: string): Promise<void> {
    const thread = threads[threadId];
    if (!thread) return;
    try {
      const items = await invoke<QueuedMessageView[]>("list_queue", { threadId });
      thread.pendingQueue = items.map(viewToQueueItem);
    } catch (err) {
      console.error("list_queue failed:", err);
    }
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

  /** Reset a thread's chat state before resuming (avoids duplicate history on replay). */
  function resetThreadState(threadId: string): void {
    const thread = threads[threadId];
    if (!thread) return;
    // Step 5: thread/app shutdown transition — clear sending on all messages before clearing array
    for (const msg of thread.messages) {
      if (msg.sending) {
        msg.sending = false;
      }
    }
    thread.messages = [];
    thread.activeToolCalls = {};
    thread.pendingQueue = [];
    thread.stopReason = null;
    thread.drainQueueOnIdle = false;
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

  function getThreadsForAgent(agentDefinitionId: string): ThreadState[] {
    return Object.values(threads).filter((t) => t.agentDefinitionId === agentDefinitionId);
  }

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
          // Drained-turn echoes are owned by thread:turn-dispatched — skip them.
          if (n.is_echo) break;
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

        case "thread:turn-dispatched": {
          appendNotificationBlocks(thread, n.notifications);
          if (n.user_text != null && n.user_text !== "") {
            thread.messages.push({
              id: crypto.randomUUID(),
              role: "user",
              content: n.user_text,
              timestamp: new Date().toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              }),
            });
          }
          break;
        }

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
    teardown,
    registerPersistedThread,
    spawnThread,
    sendPrompt,
    cancelPrompt,
    resetThreadState,
    stopThread,
    deleteThread,
    setConfig,
    removeQueueItem,
    updateQueueItem,
    clearQueue,
    refreshQueue,
    replayNotifications,
    syncThreadSnapshot,
    // Internal seams for unit tests: the notification handlers and direct
    // thread-map manipulation. These are closures over `threads`/`chunkBuffers`
    // and so cannot live outside this factory.
    //
    // Vite inlines `import.meta.env.MODE` as a string literal at build time, so
    // in dev and production this folds to `false` and the object literal below
    // is dropped by dead-code elimination — the seam exists only under Vitest.
    // The cast keeps the property's type non-optional so tests need no `!`.
    _test:
      import.meta.env.MODE === "test"
        ? {
            handlePromptComplete,
            handleStatusChange,
            handleError,
            handleUserMessage,
            handleQueueChanged,
            handleTurnDispatched,
            replayNotifications,
            get chunkBuffers() {
              return chunkBuffers;
            },
            injectThread(
              threadId: string,
              partial: Partial<ThreadState> & {
                id: string;
                agentDefinitionId: string;
              },
            ) {
              threads[threadId] = {
                workspaceId: "ws-test",
                provider: "claude",
                agentName: "Test Thread",
                status: "idle",
                messages: [],
                activeToolCalls: {},
                stopReason: null,
                pendingQueue: [],
                configOptions: [],
                drainQueueOnIdle: false,
                ...partial,
              } as ThreadState;
            },
            removeThread(threadId: string) {
              delete threads[threadId];
            },
          }
        : (undefined as unknown as AgentStoreTestApi),
  };
}

export const agentStore = createAgentStore();
