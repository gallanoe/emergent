/**
 * Vitest tests for chat-interrupt + send-while-busy bug fixes.
 * Tasks: B1, B2, B3 (a/b/c), B3d, B4, B5, B6, B7
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { flushSync } from "svelte";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { agentStore } from "./agents.svelte";
import type { AgentDefinition, ConfigOption, TurnDispatchedPayload } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeThread(
  threadId: string,
  status: "idle" | "working" | "cancelling" | "error" | "dead" | "initializing" = "idle",
) {
  agentStore._test.injectThread(threadId, {
    id: threadId,
    agentDefinitionId: "agent-1",
    status,
  });
}

afterEach(() => {
  // Teardown first: unlisten() round-trips through the IPC mock, so clearing the
  // mocks before detaching would leave the store holding dead subscriptions.
  agentStore.teardown();
  clearMocks();
  vi.restoreAllMocks();
  // Clean up any threads injected during the test
  for (const id of Object.keys(agentStore.threads)) {
    agentStore._test.removeThread(id);
  }
});

// ── B1: cancelPrompt sets "cancelling" synchronously ─────────────────────────

describe("B1: cancelPrompt", () => {
  it("sets thread.status to 'cancelling' before invoke resolves", async () => {
    makeThread("t-b1", "working");

    let capturedStatus: string | undefined;

    mockIPC((cmd) => {
      if (cmd === "cancel_prompt") {
        // Capture status synchronously — at the time invoke is called, status
        // should already be "cancelling"
        capturedStatus = agentStore.threads["t-b1"]?.status;
        return Promise.resolve(null);
      }
    });

    await agentStore.cancelPrompt("t-b1");
    flushSync();

    expect(capturedStatus).toBe("cancelling");
  });

  it("does nothing if thread is not in 'working' status", async () => {
    makeThread("t-b1-idle", "idle");

    const cancelCalled = vi.fn();
    mockIPC((cmd) => {
      if (cmd === "cancel_prompt") {
        cancelCalled();
        return Promise.resolve(null);
      }
    });

    await agentStore.cancelPrompt("t-b1-idle");
    flushSync();

    expect(cancelCalled).not.toHaveBeenCalled();
    expect(agentStore.threads["t-b1-idle"]?.status).toBe("idle");
  });
});

// ── B2: sendPrompt while busy enqueues backend-side ──────────────────────────

describe("B2: sendPrompt while busy enqueues backend-side", () => {
  it("invokes send_prompt and pushes no local bubble/chip (chip arrives via QueueChanged)", async () => {
    makeThread("t-b2", "cancelling");

    const invokeSend = vi.fn().mockResolvedValue(null);
    mockIPC((cmd) => {
      if (cmd === "send_prompt") {
        invokeSend();
        return Promise.resolve(null);
      }
    });

    await agentStore.sendPrompt("t-b2", "hello world");
    flushSync();

    const thread = agentStore.threads["t-b2"]!;
    // Queue mirror is backend-driven; no optimistic local push here.
    expect(thread.pendingQueue).toHaveLength(0);
    expect(thread.messages).toHaveLength(0);

    await Promise.resolve();
    expect(invokeSend).toHaveBeenCalled();
  });

  it("also enqueues during 'working' status", async () => {
    makeThread("t-b2-working", "working");

    const invokeSend = vi.fn().mockResolvedValue(null);
    mockIPC((cmd) => {
      if (cmd === "send_prompt") {
        invokeSend();
        return Promise.resolve(null);
      }
    });

    await agentStore.sendPrompt("t-b2-working", "queued msg");
    flushSync();

    const thread = agentStore.threads["t-b2-working"]!;
    expect(thread.messages).toHaveLength(0);
    await Promise.resolve();
    expect(invokeSend).toHaveBeenCalled();
  });
});

// ── B3: handlePromptComplete ──────────────────────────────────────────────────

describe("B3: handlePromptComplete", () => {
  it("B3b: sets cancelled=true on last assistant message when stop_reason includes 'Cancelled'", () => {
    makeThread("t-b3b", "working");
    const thread = agentStore.threads["t-b3b"]!;
    thread.messages.push(
      { id: "m1", role: "user", content: "hello", timestamp: "1:00 PM" },
      {
        id: "m2",
        role: "assistant",
        content: "partial reply...",
        timestamp: "1:00 PM",
      },
    );

    agentStore._test.handlePromptComplete({
      thread_id: "t-b3b",
      stop_reason: "Cancelled",
    });
    flushSync();

    const assistantMsg = thread.messages.find((m) => m.id === "m2");
    expect(assistantMsg?.cancelled).toBe(true);
  });

  it("B3c: does not drain or invoke send_prompt — backend owns draining", () => {
    makeThread("t-b3c", "cancelling");
    const thread = agentStore.threads["t-b3c"]!;
    thread.pendingQueue.push(
      { id: "q1", content: "msg1", submittedAt: Date.now() },
      { id: "q2", content: "msg2", submittedAt: Date.now() },
    );

    const sendCalled = vi.fn().mockResolvedValue(null);
    mockIPC((cmd) => {
      if (cmd === "send_prompt") {
        sendCalled();
        return Promise.resolve(null);
      }
    });

    agentStore._test.handlePromptComplete({
      thread_id: "t-b3c",
      stop_reason: "EndTurn",
    });
    flushSync();

    // No frontend drain: the backend coalesces and emits QueueChanged instead.
    expect(sendCalled).not.toHaveBeenCalled();
    // Mirror left untouched here (backend clears it via QueueChanged on drain).
    expect(thread.pendingQueue).toHaveLength(2);
    // cancelling → idle once the turn completes.
    expect(thread.status).toBe("idle");
  });

  it("B3a: chunk buffer for the thread is deleted after flush", () => {
    makeThread("t-b3a", "working");
    // Manually inject a buffer entry to simulate a pending chunk
    agentStore._test.chunkBuffers["t-b3a"] = {
      content: "some chunk",
      kind: "message",
    };

    agentStore._test.handlePromptComplete({
      thread_id: "t-b3a",
      stop_reason: "EndTurn",
    });
    flushSync();

    expect(agentStore._test.chunkBuffers["t-b3a"]).toBeUndefined();
  });
});

// ── B3d / B5: handleStatusChange ─────────────────────────────────────────────

describe("B3d + B5: handleStatusChange", () => {
  it("B5: does not overwrite 'cancelling' with 'working'", () => {
    makeThread("t-b5", "cancelling");

    agentStore._test.handleStatusChange({
      thread_id: "t-b5",
      status: "working",
    });
    flushSync();

    expect(agentStore.threads["t-b5"]?.status).toBe("cancelling");
  });

  it("B3d: idle transition just sets status — no frontend drain, no send_prompt", async () => {
    makeThread("t-b3d", "cancelling");
    const thread = agentStore.threads["t-b3d"]!;
    thread.pendingQueue.push({
      id: "q1",
      content: "queued message",
      submittedAt: Date.now(),
    });

    const sendCalled = vi.fn().mockResolvedValue(null);
    mockIPC((cmd) => {
      if (cmd === "send_prompt") {
        sendCalled();
        return Promise.resolve(null);
      }
    });

    agentStore._test.handleStatusChange({ thread_id: "t-b3d", status: "idle" });
    flushSync();

    expect(thread.status).toBe("idle");
    // Draining is the backend's job; the mirror is untouched until QueueChanged.
    expect(thread.pendingQueue).toHaveLength(1);
    await Promise.resolve();
    expect(sendCalled).not.toHaveBeenCalled();
  });
});

// ── B4: flushChunkBuffers skips "cancelling" threads ─────────────────────────

describe("B4: flushChunkBuffers skips cancelling threads", () => {
  it("buffer for a cancelling thread is deleted, no messages pushed", () => {
    makeThread("t-b4", "cancelling");
    const thread = agentStore.threads["t-b4"]!;
    const msgCountBefore = thread.messages.length;

    // Inject a buffer that would normally be flushed
    agentStore._test.chunkBuffers["t-b4"] = {
      content: "chunk data",
      kind: "message",
    };

    // handlePromptComplete triggers flushChunkBuffers internally
    agentStore._test.handlePromptComplete({
      thread_id: "t-b4",
      stop_reason: "EndTurn",
    });
    flushSync();

    // No message added
    expect(thread.messages.length).toBe(msgCountBefore);
    // Buffer deleted
    expect(agentStore._test.chunkBuffers["t-b4"]).toBeUndefined();
  });
});

// ── B6: handleError clears sending bubbles; pendingQueue items marked failed ───

describe("B6: handleError clears sending bubbles and marks queue items failed", () => {
  it("clears sending flag on in-flight bubble; pendingQueue items remain with failed=true", () => {
    makeThread("t-b6", "working");
    const thread = agentStore.threads["t-b6"]!;

    // An in-flight sending bubble
    thread.messages.push({
      id: "p1",
      role: "user",
      content: "sending text",
      timestamp: "1:00 PM",
      sending: true,
    });

    // Two queued items in pendingQueue
    thread.pendingQueue.push(
      { id: "q1", content: "pending text 1", submittedAt: Date.now() },
      { id: "q2", content: "pending text 2", submittedAt: Date.now() },
    );

    agentStore._test.handleError({
      thread_id: "t-b6",
      message: "network error",
    });
    flushSync();

    // sending bubble still exists but sending flag cleared
    const bubble = thread.messages.find((m) => m.id === "p1");
    expect(bubble).toBeDefined();
    expect(bubble?.sending).toBeFalsy();

    // pendingQueue items remain (not removed) with failed=true
    expect(thread.pendingQueue).toHaveLength(2);
    expect(thread.pendingQueue[0]!.failed).toBe(true);
    expect(thread.pendingQueue[1]!.failed).toBe(true);

    // Messages array unchanged (no items removed from thread.messages)
    expect(thread.messages).toHaveLength(1);

    // Thread is in error state
    expect(thread.status).toBe("error");
  });

  it("is a no-op on pendingQueue when queue is empty", () => {
    makeThread("t-b6-empty", "working");
    const thread = agentStore.threads["t-b6-empty"]!;

    agentStore._test.handleError({ thread_id: "t-b6-empty", message: "oops" });
    flushSync();

    expect(thread.pendingQueue).toHaveLength(0);
    expect(thread.status).toBe("error");
  });
});

// ── Fixup 2: handleError clears drainQueueOnIdle ─────────────────────────────

describe("Fixup 2: handleError clears drainQueueOnIdle", () => {
  it("a stale idle event after thread:error does NOT trigger drain or invoke send_prompt", async () => {
    makeThread("t-fix2", "working");
    const thread = agentStore.threads["t-fix2"]!;

    // Arm drain flag — simulates state set by handlePromptComplete with a queue
    thread.drainQueueOnIdle = true;
    thread.pendingQueue.push({
      id: "q1",
      content: "queued",
      submittedAt: Date.now(),
    });

    const sendCalled = vi.fn().mockResolvedValue(null);
    mockIPC((cmd) => {
      if (cmd === "send_prompt") {
        sendCalled();
        return Promise.resolve(null);
      }
    });

    // Error arrives
    agentStore._test.handleError({
      thread_id: "t-fix2",
      message: "connection lost",
    });
    flushSync();

    // drainQueueOnIdle must be cleared by handleError
    expect(thread.drainQueueOnIdle).toBe(false);

    // Stale idle event arrives (e.g. from a delayed notification)
    agentStore._test.handleStatusChange({
      thread_id: "t-fix2",
      status: "idle",
    });
    flushSync();

    // invoke("send_prompt") must NOT have been called
    await Promise.resolve();
    expect(sendCalled).not.toHaveBeenCalled();
  });
});

// ── Fixup 3: cancelPrompt IPC failure clears sending bubble ──────────────────

describe("Fixup 3: cancelPrompt IPC failure clears sending bubble", () => {
  it("clears sending=true bubble and sets status=error when cancel_prompt rejects", async () => {
    makeThread("t-fix3", "working");
    const thread = agentStore.threads["t-fix3"]!;

    // Simulate an in-flight sending bubble
    thread.messages.push({
      id: "bubble-1",
      role: "user",
      content: "sending text",
      timestamp: "1:00 PM",
      sending: true,
    });

    mockIPC((cmd) => {
      if (cmd === "cancel_prompt") {
        return Promise.reject(new Error("IPC error: cancel failed"));
      }
    });

    await agentStore.cancelPrompt("t-fix3");
    flushSync();

    // Sending bubble must be cleared
    const bubble = thread.messages.find((m) => m.id === "bubble-1");
    expect(bubble?.sending).toBeFalsy();

    // Thread must be in error state, not stuck in cancelling
    expect(thread.status).toBe("error");
  });
});

// ── thread:queue-changed handler (backend queue mirror) ──────────────────────

describe("handleQueueChanged", () => {
  it("mirrors backend queue items into pendingQueue, mapping source → kind/from", () => {
    makeThread("t-qc", "working");
    const thread = agentStore.threads["t-qc"]!;

    agentStore._test.handleQueueChanged({
      thread_id: "t-qc",
      items: [
        {
          id: "m1",
          source: "user",
          content: "hi",
          created_at: new Date().toISOString(),
        },
        {
          id: "m2",
          source: "thread",
          from: "Agent B",
          content: "ping",
          created_at: new Date().toISOString(),
        },
        {
          id: "m3",
          source: "task",
          content: "update: halfway",
          created_at: new Date().toISOString(),
        },
      ],
    });
    flushSync();

    expect(thread.pendingQueue).toHaveLength(3);
    expect(thread.pendingQueue[0]!.kind).toBe("user");
    expect(thread.pendingQueue[1]!.kind).toBe("task-notification");
    expect(thread.pendingQueue[1]!.from).toBe("Agent B");
    expect(thread.pendingQueue[2]!.source).toBe("task");
  });

  it("empty items clears the mirror (drain at turn start)", () => {
    makeThread("t-qc-empty", "working");
    const thread = agentStore.threads["t-qc-empty"]!;
    thread.pendingQueue.push({
      id: "old",
      content: "x",
      submittedAt: Date.now(),
    });

    agentStore._test.handleQueueChanged({ thread_id: "t-qc-empty", items: [] });
    flushSync();

    expect(thread.pendingQueue).toHaveLength(0);
  });

  it("is a no-op when the thread is not found", () => {
    expect(() =>
      agentStore._test.handleQueueChanged({
        thread_id: "no-such-thread",
        items: [],
      }),
    ).not.toThrow();
  });
});

// ── Per-item queue operations ─────────────────────────────────────────────────

describe("removeQueueItem", () => {
  it("calls remove_queued and mirrors the returned snapshot", async () => {
    makeThread("t-remove", "working");
    const thread = agentStore.threads["t-remove"]!;
    thread.pendingQueue.push(
      { id: "q1", content: "first", submittedAt: Date.now() },
      { id: "q2", content: "second", submittedAt: Date.now() },
    );

    mockIPC((cmd) => {
      if (cmd === "remove_queued") {
        return Promise.resolve([
          {
            id: "q2",
            source: "user",
            content: "second",
            created_at: new Date().toISOString(),
          },
        ]);
      }
    });

    await agentStore.removeQueueItem("t-remove", "q1");
    flushSync();

    expect(thread.pendingQueue).toHaveLength(1);
    expect(thread.pendingQueue[0]!.id).toBe("q2");
  });

  it("is a no-op when the thread is not found", async () => {
    await expect(agentStore.removeQueueItem("nonexistent", "q1")).resolves.toBeUndefined();
  });
});

describe("updateQueueItem", () => {
  it("calls edit_queued and mirrors the returned snapshot", async () => {
    makeThread("t-update", "working");
    const thread = agentStore.threads["t-update"]!;
    thread.pendingQueue.push({
      id: "q1",
      content: "original",
      submittedAt: Date.now(),
    });

    mockIPC((cmd) => {
      if (cmd === "edit_queued") {
        return Promise.resolve([
          {
            id: "q1",
            source: "user",
            content: "updated content",
            created_at: new Date().toISOString(),
          },
        ]);
      }
    });

    await agentStore.updateQueueItem("t-update", "q1", "updated content");
    flushSync();

    expect(thread.pendingQueue[0]!.content).toBe("updated content");
    expect(thread.pendingQueue[0]!.id).toBe("q1");
  });

  it("is a no-op when the thread is not found", async () => {
    await expect(agentStore.updateQueueItem("nonexistent", "q1", "x")).resolves.toBeUndefined();
  });
});

describe("clearQueue", () => {
  it("calls clear_queue and empties the mirror", async () => {
    makeThread("t-clear", "working");
    const thread = agentStore.threads["t-clear"]!;
    thread.pendingQueue.push(
      { id: "q1", content: "a", submittedAt: Date.now() },
      { id: "q2", content: "b", submittedAt: Date.now() },
    );

    const cleared = vi.fn();
    mockIPC((cmd) => {
      if (cmd === "clear_queue") {
        cleared();
        return Promise.resolve(null);
      }
    });

    await agentStore.clearQueue("t-clear");
    flushSync();

    expect(cleared).toHaveBeenCalled();
    expect(thread.pendingQueue).toHaveLength(0);
  });

  it("is a no-op when the thread is not found", async () => {
    await expect(agentStore.clearQueue("nonexistent")).resolves.toBeUndefined();
  });
});

// ── handleTurnDispatched: settles notifications + reconciles the optimistic bubble ─

describe("handleTurnDispatched", () => {
  it("appends settled notification blocks then a user bubble (busy path)", () => {
    makeThread("t-td", "working");
    const thread = agentStore.threads["t-td"]!;

    agentStore._test.handleTurnDispatched({
      thread_id: "t-td",
      user_text: "do the thing",
      notifications: [
        {
          id: "n1",
          source: "thread",
          from: "Agent B",
          content: "ping",
          created_at: new Date().toISOString(),
        },
        {
          id: "n2",
          source: "task",
          task_id: "TSK-1",
          task_status: "completed",
          content: "done",
          created_at: new Date().toISOString(),
        },
      ],
    });
    flushSync();

    const roles = thread.messages.map((m) => m.role);
    expect(roles).toEqual(["notification", "notification", "user"]);
    expect(thread.messages[0]!.id).toBe("n1");
    expect(thread.messages[0]!.from).toBe("Agent B");
    expect(thread.messages[1]!.taskId).toBe("TSK-1");
    expect(thread.messages[2]!.content).toBe("do the thing");
  });

  it("is idempotent — a repeated notification id is not duplicated", () => {
    makeThread("t-td2", "working");
    const thread = agentStore.threads["t-td2"]!;
    const payload: TurnDispatchedPayload = {
      thread_id: "t-td2",
      notifications: [
        {
          id: "n1",
          source: "task",
          task_id: "TSK-9",
          task_status: "update",
          content: "half",
          created_at: new Date().toISOString(),
        },
      ],
    };
    agentStore._test.handleTurnDispatched(payload);
    agentStore._test.handleTurnDispatched(payload);
    flushSync();
    expect(thread.messages.filter((m) => m.role === "notification")).toHaveLength(1);
  });

  it("re-anchors an idle optimistic bubble below the notifications", () => {
    makeThread("t-td3", "working");
    const thread = agentStore.threads["t-td3"]!;
    thread.messages.push({
      id: "opt",
      role: "user",
      content: "do the thing",
      timestamp: "12:00",
      sending: true,
    });

    agentStore._test.handleTurnDispatched({
      thread_id: "t-td3",
      user_text: "do the thing",
      notifications: [
        {
          id: "n1",
          source: "thread",
          from: "Agent B",
          content: "ping",
          created_at: new Date().toISOString(),
        },
      ],
    });
    flushSync();

    const roles = thread.messages.map((m) => m.role);
    expect(roles).toEqual(["notification", "user"]);
    const bubble = thread.messages[1]!;
    expect(bubble.id).toBe("opt");
    expect(bubble.sending).toBeFalsy();
  });
});

describe("handleUserMessage echo drop", () => {
  it("ignores is_echo=true and pushes is_echo=false", () => {
    makeThread("t-echo", "working");
    const thread = agentStore.threads["t-echo"]!;

    agentStore._test.handleUserMessage({
      thread_id: "t-echo",
      content: "[task completed] x",
      is_echo: true,
    });
    flushSync();
    expect(thread.messages).toHaveLength(0);

    agentStore._test.handleUserMessage({
      thread_id: "t-echo",
      content: "spontaneous",
      is_echo: false,
    });
    flushSync();
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.role).toBe("user");
  });
});

describe("replayNotifications with turn-dispatched", () => {
  it("rebuilds settled rails and skips the paired is_echo user-message", () => {
    makeThread("t-replay", "idle");
    const thread = agentStore.threads["t-replay"]!;

    agentStore._test.replayNotifications([
      {
        type: "thread:turn-dispatched",
        thread_id: "t-replay",
        user_text: "do the thing",
        notifications: [
          {
            id: "n1",
            source: "task",
            task_id: "TSK-1",
            task_status: "completed",
            content: "done",
            created_at: new Date().toISOString(),
          },
        ],
      },
      // The recorded echo of the same turn — must be ignored (no duplicate bubble).
      {
        type: "thread:user-message",
        thread_id: "t-replay",
        content: "[task completed] done\n\ndo the thing",
        is_echo: true,
      },
    ]);
    flushSync();

    const roles = thread.messages.map((m) => m.role);
    expect(roles).toEqual(["notification", "user"]);
    expect(thread.messages[0]!.taskId).toBe("TSK-1");
    expect(thread.messages[1]!.content).toBe("do the thing");
  });
});

// ── Live event plumbing ───────────────────────────────────────────────────────
//
// The handlers below are only reachable through the real Tauri listener wiring
// (they are not on the `_test` seam), so these specs drive them end-to-end:
// `setupListeners()` subscribes through the mocked event plugin, and `emit()`
// dispatches back through it — exercising the same closure the app runs.

/** Install an IPC mock with the event plugin emulated, so `emit()` reaches listeners. */
function mockEvents(handler: (cmd: string, args?: unknown) => unknown = () => null) {
  mockIPC((cmd, args) => handler(cmd, args), { shouldMockEvents: true });
}

describe("listener wiring: message chunks", () => {
  beforeEach(() => mockEvents());

  it("buffers streamed chunks and flushes them into one assistant message", async () => {
    await agentStore.setupListeners();
    makeThread("t-chunk", "working");
    const thread = agentStore.threads["t-chunk"]!;

    await emit("thread:message-chunk", {
      thread_id: "t-chunk",
      content: "Hel",
      kind: "message",
    });
    await emit("thread:message-chunk", {
      thread_id: "t-chunk",
      content: "lo!",
      kind: "message",
    });
    flushSync();

    // Still buffered — nothing is rendered until the frame flushes.
    expect(thread.messages).toHaveLength(0);

    agentStore._test.handlePromptComplete({
      thread_id: "t-chunk",
      stop_reason: "EndTurn",
    });
    flushSync();

    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.role).toBe("assistant");
    expect(thread.messages[0]!.content).toBe("Hello!");
  });

  it("flushes on a kind switch so thinking and message never merge", async () => {
    await agentStore.setupListeners();
    makeThread("t-kind", "working");
    const thread = agentStore.threads["t-kind"]!;

    await emit("thread:message-chunk", {
      thread_id: "t-kind",
      content: "reasoning",
      kind: "thinking",
    });
    await emit("thread:message-chunk", {
      thread_id: "t-kind",
      content: "answer",
      kind: "message",
    });
    flushSync();

    // The kind change forced the thinking buffer out immediately.
    expect(thread.messages.map((m) => [m.role, m.content])).toEqual([["thinking", "reasoning"]]);

    agentStore._test.handlePromptComplete({
      thread_id: "t-kind",
      stop_reason: "EndTurn",
    });
    flushSync();

    expect(thread.messages.map((m) => [m.role, m.content])).toEqual([
      ["thinking", "reasoning"],
      ["assistant", "answer"],
    ]);
  });

  it("appends to the trailing assistant bubble instead of starting a new one", async () => {
    await agentStore.setupListeners();
    makeThread("t-append", "working");
    const thread = agentStore.threads["t-append"]!;

    await emit("thread:message-chunk", {
      thread_id: "t-append",
      content: "first ",
      kind: "message",
    });
    agentStore._test.handlePromptComplete({
      thread_id: "t-append",
      stop_reason: "EndTurn",
    });
    await emit("thread:message-chunk", {
      thread_id: "t-append",
      content: "second",
      kind: "message",
    });
    agentStore._test.handlePromptComplete({
      thread_id: "t-append",
      stop_reason: "EndTurn",
    });
    flushSync();

    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.content).toBe("first second");
  });

  it("writes chunks straight through while initializing, preserving replay order", async () => {
    await agentStore.setupListeners();
    makeThread("t-init", "initializing");
    const thread = agentStore.threads["t-init"]!;

    await emit("thread:message-chunk", {
      thread_id: "t-init",
      content: "resumed ",
      kind: "message",
    });
    flushSync();
    // No buffering during resume — the message is already visible.
    expect(thread.messages).toHaveLength(1);
    expect(agentStore._test.chunkBuffers["t-init"]).toBeUndefined();

    await emit("thread:message-chunk", {
      thread_id: "t-init",
      content: "history",
      kind: "message",
    });
    flushSync();
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.content).toBe("resumed history");

    await emit("thread:message-chunk", {
      thread_id: "t-init",
      content: "why",
      kind: "thinking",
    });
    flushSync();
    expect(thread.messages.map((m) => m.role)).toEqual(["assistant", "thinking"]);
  });

  it("drops chunks for a thread it does not know", async () => {
    await agentStore.setupListeners();
    await emit("thread:message-chunk", {
      thread_id: "ghost",
      content: "x",
      kind: "message",
    });
    flushSync();
    expect(agentStore._test.chunkBuffers["ghost"]).toBeUndefined();
  });

  it("flushes buffered chunks on the animation frame without any prompt-complete", async () => {
    await agentStore.setupListeners();
    makeThread("t-raf", "working");
    const thread = agentStore.threads["t-raf"]!;

    await emit("thread:message-chunk", {
      thread_id: "t-raf",
      content: "framed",
      kind: "message",
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    flushSync();

    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.content).toBe("framed");
  });
});

describe("listener wiring: tool calls", () => {
  beforeEach(() => mockEvents());

  it("merges partial updates and emits a tool-group once every call settles", async () => {
    await agentStore.setupListeners();
    makeThread("t-tc", "working");
    const thread = agentStore.threads["t-tc"]!;

    await emit("thread:tool-call-update", {
      thread_id: "t-tc",
      tool_call_id: "tc1",
      title: "Edit file",
      kind: "edit",
      status: "in_progress",
      locations: ["src/a.ts"],
      raw_input: { path: "src/a.ts" },
    });
    flushSync();

    // In-flight calls live in activeToolCalls, not in the transcript.
    expect(thread.messages).toHaveLength(0);
    expect(agentStore.toDisplayThread(thread).activeToolCalls[0]!.name).toBe("Edit file");

    // A status-only update must inherit title/kind/locations from the existing entry.
    await emit("thread:tool-call-update", {
      thread_id: "t-tc",
      tool_call_id: "tc1",
      status: "completed",
      content: [
        { type: "diff", path: "src/a.ts", old_text: "a", new_text: "b" },
        { type: "terminal", terminal_id: "term-1", output: "ok", exit_code: 0 },
        { type: "text", text: "done" },
        { type: "unknown-kind" },
      ],
      raw_output: { ok: true },
    });
    flushSync();

    expect(thread.messages).toHaveLength(1);
    const group = thread.messages[0]!;
    expect(group.role).toBe("tool-group");
    const call = group.toolCalls![0]!;
    expect(call.name).toBe("Edit file");
    expect(call.kind).toBe("edit");
    expect(call.locations).toEqual(["src/a.ts"]);
    expect(call.rawInput).toEqual({ path: "src/a.ts" });
    expect(call.rawOutput).toEqual({ ok: true });
    expect(call.content).toEqual([
      { type: "diff", path: "src/a.ts", oldText: "a", newText: "b" },
      { type: "terminal", terminalId: "term-1", output: "ok", exitCode: 0 },
      { type: "text", text: "done" },
      { type: "text", text: "" },
    ]);
    // Settled calls are cleared out of the active map.
    expect(Object.keys(thread.activeToolCalls)).toHaveLength(0);
  });

  it("holds the group back until the last outstanding call finishes", async () => {
    await agentStore.setupListeners();
    makeThread("t-tc2", "working");
    const thread = agentStore.threads["t-tc2"]!;

    await emit("thread:tool-call-update", {
      thread_id: "t-tc2",
      tool_call_id: "a",
      status: "in_progress",
    });
    await emit("thread:tool-call-update", {
      thread_id: "t-tc2",
      tool_call_id: "b",
      status: "in_progress",
    });
    await emit("thread:tool-call-update", {
      thread_id: "t-tc2",
      tool_call_id: "a",
      status: "failed",
    });
    flushSync();
    // "b" is still running, so nothing is grouped yet.
    expect(thread.messages).toHaveLength(0);

    await emit("thread:tool-call-update", {
      thread_id: "t-tc2",
      tool_call_id: "b",
      status: "completed",
    });
    flushSync();
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.toolCalls).toHaveLength(2);
  });

  it("falls back to defaults when the payload carries no metadata", async () => {
    await agentStore.setupListeners();
    makeThread("t-tc3", "working");
    const thread = agentStore.threads["t-tc3"]!;

    await emit("thread:tool-call-update", {
      thread_id: "t-tc3",
      tool_call_id: "bare",
    });
    flushSync();

    const call = thread.activeToolCalls["bare"]!;
    expect(call.name).toBe("Tool call");
    expect(call.kind).toBe("other");
    expect(call.status).toBe("pending");
    expect(call.content).toEqual([]);
  });

  it("ignores updates for an unknown thread", async () => {
    await agentStore.setupListeners();
    await expect(
      emit("thread:tool-call-update", {
        thread_id: "ghost",
        tool_call_id: "x",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("listener wiring: thread metadata events", () => {
  beforeEach(() => mockEvents());

  it("records the ACP session id from thread:session-ready", async () => {
    await agentStore.setupListeners();
    makeThread("t-sr", "initializing");

    await emit("thread:session-ready", {
      thread_id: "t-sr",
      acp_session_id: "acp-42",
    });
    flushSync();

    expect(agentStore.threads["t-sr"]!.acpSessionId).toBe("acp-42");
    // Unknown threads are ignored rather than resurrected.
    await expect(
      emit("thread:session-ready", { thread_id: "ghost", acp_session_id: "x" }),
    ).resolves.toBeUndefined();
  });

  it("stores token usage from thread:token-usage", async () => {
    await agentStore.setupListeners();
    makeThread("t-tok", "working");

    await emit("thread:token-usage", {
      thread_id: "t-tok",
      used_tokens: 1200,
      context_size: 200000,
    });
    flushSync();

    expect(agentStore.threads["t-tok"]!.tokenUsage).toEqual({
      used: 1200,
      size: 200000,
    });
    await emit("thread:token-usage", {
      thread_id: "ghost",
      used_tokens: 1,
      context_size: 2,
    });
  });

  it("appends system messages", async () => {
    await agentStore.setupListeners();
    makeThread("t-sys", "idle");

    await emit("thread:system-message", {
      thread_id: "t-sys",
      content: "agent restarted",
    });
    flushSync();

    const msg = agentStore.threads["t-sys"]!.messages[0]!;
    expect(msg.role).toBe("system");
    expect(msg.content).toBe("agent restarted");
    await emit("thread:system-message", { thread_id: "ghost", content: "x" });
  });

  it("replaces config options and narrates agent-initiated changes", async () => {
    await agentStore.setupListeners();
    makeThread("t-cfg", "idle");
    const thread = agentStore.threads["t-cfg"]!;

    const options: ConfigOption[] = [
      { id: "model", name: "Model", current_value: "opus", options: [] },
    ];

    // No changes → options swap silently, no transcript noise.
    await emit("thread:config-update", {
      thread_id: "t-cfg",
      config_options: options,
      changes: [],
    });
    flushSync();
    expect(thread.configOptions).toEqual(options);
    expect(thread.messages).toHaveLength(0);

    await emit("thread:config-update", {
      thread_id: "t-cfg",
      config_options: options,
      changes: [
        { option_name: "Model", new_value_name: "Sonnet" },
        { option_name: "Mode", new_value_name: "Plan" },
      ],
    });
    flushSync();
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.role).toBe("system");
    expect(thread.messages[0]!.content).toBe("Model changed to Sonnet, Mode changed to Plan");
    await emit("thread:config-update", {
      thread_id: "ghost",
      config_options: [],
      changes: [],
    });
  });

  it("coalesces a nudge onto a trailing user bubble, else adds a standalone row", async () => {
    await agentStore.setupListeners();
    makeThread("t-nudge", "working");
    const thread = agentStore.threads["t-nudge"]!;

    // No trailing user message → standalone nudge row.
    await emit("thread:nudge-delivered", { thread_id: "t-nudge", count: 1 });
    flushSync();
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.role).toBe("nudge");
    expect(thread.messages[0]!.nudgeCount).toBe(1);

    thread.messages.push({
      id: "u1",
      role: "user",
      content: "hi",
      timestamp: "1:00 PM",
    });
    await emit("thread:nudge-delivered", { thread_id: "t-nudge", count: 3 });
    flushSync();
    // Coalesced onto the existing bubble rather than appended.
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1]!.nudgeCount).toBe(3);
    await emit("thread:nudge-delivered", { thread_id: "ghost", count: 1 });
  });

  it("routes queue-changed, turn-dispatched, user-message, error and status events", async () => {
    await agentStore.setupListeners();
    makeThread("t-route", "working");
    const thread = agentStore.threads["t-route"]!;

    await emit("thread:queue-changed", {
      thread_id: "t-route",
      items: [
        {
          id: "q1",
          source: "user",
          content: "queued",
          created_at: "not-a-date",
        },
      ],
    });
    flushSync();
    expect(thread.pendingQueue).toHaveLength(1);
    // An unparseable timestamp falls back to "now" rather than NaN.
    expect(Number.isFinite(thread.pendingQueue[0]!.submittedAt)).toBe(true);

    await emit("thread:user-message", {
      thread_id: "t-route",
      content: "<emergent-system>secret</emergent-system>visible text",
      is_echo: false,
    });
    flushSync();
    // The injected system block is stripped before display.
    expect(thread.messages.at(-1)!.content).toBe("visible text");

    await emit("thread:turn-dispatched", {
      thread_id: "t-route",
      user_text: "go",
      notifications: [],
    });
    flushSync();
    expect(thread.messages.at(-1)!.content).toBe("go");

    await emit("thread:prompt-complete", {
      thread_id: "t-route",
      stop_reason: "EndTurn",
    });
    flushSync();
    expect(thread.status).toBe("idle");
    expect(thread.stopReason).toBe("EndTurn");

    await emit("thread:status-change", {
      thread_id: "t-route",
      status: "working",
    });
    flushSync();
    expect(thread.status).toBe("working");

    await emit("thread:error", { thread_id: "t-route", message: "boom" });
    flushSync();
    expect(thread.status).toBe("error");
    expect(thread.errorMessage).toBe("boom");
  });
});

// ── handleStatusChange: dead + unknown-status handling ───────────────────────

describe("handleStatusChange: dead threads", () => {
  it("keeps a persisted thread as a dead stub", () => {
    makeThread("t-dead-persisted", "working");
    agentStore.threads["t-dead-persisted"]!.acpSessionId = "acp-1";

    agentStore._test.handleStatusChange({
      thread_id: "t-dead-persisted",
      status: "dead",
    });
    flushSync();

    expect(agentStore.threads["t-dead-persisted"]?.status).toBe("dead");
  });

  it("drops a thread that was never persisted", () => {
    makeThread("t-dead-ephemeral", "working");

    agentStore._test.handleStatusChange({
      thread_id: "t-dead-ephemeral",
      status: "dead",
    });
    flushSync();

    expect(agentStore.threads["t-dead-ephemeral"]).toBeUndefined();
  });

  it("is a no-op for an unknown thread", () => {
    expect(() =>
      agentStore._test.handleStatusChange({
        thread_id: "ghost",
        status: "idle",
      }),
    ).not.toThrow();
  });

  it("normalizes an unrecognized backend status to dead", () => {
    makeThread("t-weird", "idle");
    agentStore._test.handleStatusChange({
      thread_id: "t-weird",
      status: "banana",
    });
    flushSync();
    expect(agentStore.threads["t-weird"]!.status).toBe("dead");
  });
});

// ── Handlers guarding against unknown threads ────────────────────────────────

describe("handlers ignore unknown threads", () => {
  it("prompt-complete, error, user-message and turn-dispatched are all no-ops", () => {
    expect(() => {
      agentStore._test.handlePromptComplete({
        thread_id: "ghost",
        stop_reason: "EndTurn",
      });
      agentStore._test.handleError({ thread_id: "ghost", message: "x" });
      agentStore._test.handleUserMessage({
        thread_id: "ghost",
        content: "x",
        is_echo: false,
      });
      agentStore._test.handleTurnDispatched({
        thread_id: "ghost",
        notifications: [],
      });
    }).not.toThrow();
    expect(agentStore.threads["ghost"]).toBeUndefined();
  });
});

// ── Thread registry: spawn / register / delete / query ───────────────────────

const AGENT_DEF: AgentDefinition = {
  id: "agent-1",
  workspace_id: "ws-1",
  name: "Builder",
  cli: "claude",
  provider: "anthropic",
};

describe("thread registry", () => {
  it("spawnThread records the backend id with a numbered display name", async () => {
    let spawnArgs: unknown;
    mockIPC((cmd, args) => {
      if (cmd === "spawn_thread") {
        spawnArgs = args;
        return Promise.resolve("thread-spawned");
      }
      return null;
    });

    const id = await agentStore.spawnThread("agent-1", AGENT_DEF);
    flushSync();

    expect(id).toBe("thread-spawned");
    expect(spawnArgs).toEqual({ agentId: "agent-1" });
    const thread = agentStore.threads["thread-spawned"]!;
    expect(thread.status).toBe("initializing");
    expect(thread.workspaceId).toBe("ws-1");
    expect(thread.cli).toBe("claude");
    expect(thread.provider).toBe("anthropic");
    expect(thread.agentName).toMatch(/^Thread \d+$/);
  });

  it("registerPersistedThread creates a dead stub and never clobbers a live thread", () => {
    agentStore.registerPersistedThread("t-persisted", "agent-9", AGENT_DEF, "acp-7", "TSK-3");
    flushSync();

    const thread = agentStore.threads["t-persisted"]!;
    expect(thread.status).toBe("dead");
    expect(thread.acpSessionId).toBe("acp-7");
    expect(thread.taskId).toBe("TSK-3");

    thread.status = "idle";
    agentStore.registerPersistedThread("t-persisted", "agent-9", AGENT_DEF, "acp-other");
    flushSync();
    // Already known → left alone.
    expect(agentStore.threads["t-persisted"]!.status).toBe("idle");
    expect(agentStore.threads["t-persisted"]!.acpSessionId).toBe("acp-7");
  });

  it("registerPersistedThread defaults a missing provider and task id to null", () => {
    const noProvider: AgentDefinition = {
      id: "a",
      workspace_id: "ws",
      name: "n",
      cli: "codex",
    };
    agentStore.registerPersistedThread("t-null", "agent-x", noProvider, null);
    flushSync();

    expect(agentStore.threads["t-null"]!.provider).toBeNull();
    expect(agentStore.threads["t-null"]!.taskId).toBeNull();
  });

  it("getThread / getThreadsForAgent / deleteThread operate on the live map", () => {
    agentStore._test.injectThread("t-a", {
      id: "t-a",
      agentDefinitionId: "agent-A",
    });
    agentStore._test.injectThread("t-b", {
      id: "t-b",
      agentDefinitionId: "agent-A",
    });
    agentStore._test.injectThread("t-c", {
      id: "t-c",
      agentDefinitionId: "agent-B",
    });

    expect(agentStore.getThread("t-a")?.id).toBe("t-a");
    expect(agentStore.getThread("nope")).toBeUndefined();
    expect(agentStore.getThreadsForAgent("agent-A").map((t) => t.id)).toEqual(["t-a", "t-b"]);

    agentStore.deleteThread("t-a");
    expect(agentStore.getThreadsForAgent("agent-A").map((t) => t.id)).toEqual(["t-b"]);
  });
});

// ── toDisplayThread projection ───────────────────────────────────────────────

describe("toDisplayThread", () => {
  it("projects preview, queued message, timestamp and error into the display shape", () => {
    makeThread("t-disp", "working");
    const thread = agentStore.threads["t-disp"]!;
    thread.errorMessage = "kaput";
    thread.taskId = "TSK-5";
    thread.tokenUsage = { used: 5, size: 10 };
    thread.messages.push(
      { id: "m1", role: "user", content: "hi", timestamp: "1:00 PM" },
      {
        id: "m2",
        role: "assistant",
        content: "x".repeat(50),
        timestamp: "1:05 PM",
      },
    );
    thread.pendingQueue.push(
      { id: "q1", content: "older", submittedAt: 1 },
      { id: "q2", content: "newest", submittedAt: 2 },
    );
    thread.activeToolCalls["tc"] = {
      id: "tc",
      name: "Read",
      kind: "read",
      status: "pending",
      locations: [],
      content: [],
    };

    const view = agentStore.toDisplayThread(thread);

    expect(view.id).toBe("t-disp");
    expect(view.agentId).toBe("agent-1");
    expect(view.processStatus).toBe("working");
    // Preview is the truncated tail message.
    expect(view.preview).toBe("x".repeat(30) + "...");
    expect(view.updatedAt).toBe("1:05 PM");
    // The chip shows the most recently queued item.
    expect(view.queuedMessage).toBe("newest");
    expect(view.activeToolCalls).toHaveLength(1);
    expect(view.errorMessage).toBe("kaput");
    expect(view.taskId).toBe("TSK-5");
    expect(view.tokenUsage).toEqual({ used: 5, size: 10 });
  });

  it("degrades gracefully for an empty thread", () => {
    makeThread("t-empty", "idle");
    const view = agentStore.toDisplayThread(agentStore.threads["t-empty"]!);

    expect(view.preview).toBe("");
    expect(view.updatedAt).toBe("just now");
    expect(view.queuedMessage).toBeNull();
    expect(view.taskId).toBeNull();
    expect("errorMessage" in view).toBe(false);
  });
});

// ── sendPrompt: idle path ────────────────────────────────────────────────────

describe("sendPrompt (idle path)", () => {
  it("pushes an optimistic sending bubble and flips the thread to working", async () => {
    makeThread("t-send", "idle");
    const thread = agentStore.threads["t-send"]!;

    let sendArgs: unknown;
    mockIPC((cmd, args) => {
      if (cmd === "send_prompt") {
        sendArgs = args;
        return Promise.resolve(null);
      }
      return null;
    });

    await agentStore.sendPrompt("t-send", "build it");
    flushSync();

    expect(sendArgs).toEqual({ threadId: "t-send", text: "build it" });
    expect(thread.status).toBe("working");
    expect(thread.hasPrompted).toBe(true);
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.role).toBe("user");
    expect(thread.messages[0]!.content).toBe("build it");
    expect(thread.messages[0]!.sending).toBe(true);
  });

  it("clears the sending bubble and errors the thread when send_prompt rejects", async () => {
    makeThread("t-send-err", "idle");
    const thread = agentStore.threads["t-send-err"]!;
    vi.spyOn(console, "error").mockImplementation(() => {});

    mockIPC((cmd) => {
      if (cmd === "send_prompt") return Promise.reject(new Error("no backend"));
      return null;
    });

    await agentStore.sendPrompt("t-send-err", "oops");
    // Let the rejection handler run.
    await new Promise((r) => setTimeout(r, 0));
    flushSync();

    expect(thread.status).toBe("error");
    expect(thread.messages[0]!.sending).toBe(false);
  });

  it("swallows an enqueue failure without disturbing the busy thread", async () => {
    makeThread("t-send-busy-err", "working");
    const thread = agentStore.threads["t-send-busy-err"]!;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    mockIPC((cmd) => {
      if (cmd === "send_prompt") return Promise.reject(new Error("enqueue failed"));
      return null;
    });

    await agentStore.sendPrompt("t-send-busy-err", "queued");
    await new Promise((r) => setTimeout(r, 0));
    flushSync();

    // The queue path must not error the thread — the backend owns the queue.
    expect(thread.status).toBe("working");
    expect(logged).toHaveBeenCalled();
  });

  it("throws for an unknown thread", async () => {
    await expect(agentStore.sendPrompt("ghost", "x")).rejects.toThrow("Thread ghost not found");
  });
});

// ── cancelPrompt: buffer flush ───────────────────────────────────────────────

describe("cancelPrompt", () => {
  it("flushes buffered chunks before the cancel lands so partial output survives", async () => {
    mockEvents();
    await agentStore.setupListeners();
    makeThread("t-cancel-flush", "working");
    const thread = agentStore.threads["t-cancel-flush"]!;

    await emit("thread:message-chunk", {
      thread_id: "t-cancel-flush",
      content: "half an ans",
      kind: "message",
    });
    flushSync();
    expect(thread.messages).toHaveLength(0);

    await agentStore.cancelPrompt("t-cancel-flush");
    flushSync();

    expect(thread.status).toBe("cancelling");
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.content).toBe("half an ans");
  });

  it("is a no-op for an unknown thread", async () => {
    await expect(agentStore.cancelPrompt("ghost")).resolves.toBeUndefined();
  });
});

// ── Queue commands: failure paths + refreshQueue ─────────────────────────────

describe("queue commands", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("refreshQueue seeds the mirror from list_queue", async () => {
    makeThread("t-refresh", "idle");
    const thread = agentStore.threads["t-refresh"]!;

    mockIPC((cmd) => {
      if (cmd === "list_queue") {
        return Promise.resolve([
          {
            id: "q1",
            source: "thread",
            from: "Agent B",
            content: "ping",
            created_at: new Date().toISOString(),
          },
          {
            id: "q2",
            source: "task",
            task_id: "TSK-2",
            task_status: "completed",
            content: "done",
            created_at: new Date().toISOString(),
          },
        ]);
      }
      return null;
    });

    await agentStore.refreshQueue("t-refresh");
    flushSync();

    expect(thread.pendingQueue).toHaveLength(2);
    expect(thread.pendingQueue[0]!.from).toBe("Agent B");
    expect(thread.pendingQueue[0]!.kind).toBe("task-notification");
    expect(thread.pendingQueue[1]!.taskId).toBe("TSK-2");
    expect(thread.pendingQueue[1]!.taskStatus).toBe("completed");
  });

  it("refreshQueue is a no-op for an unknown thread and survives a rejection", async () => {
    await expect(agentStore.refreshQueue("ghost")).resolves.toBeUndefined();

    makeThread("t-refresh-err", "idle");
    const thread = agentStore.threads["t-refresh-err"]!;
    thread.pendingQueue.push({ id: "keep", content: "keep", submittedAt: 1 });

    mockIPC((cmd) => {
      if (cmd === "list_queue") return Promise.reject(new Error("nope"));
      return null;
    });

    await agentStore.refreshQueue("t-refresh-err");
    flushSync();
    // A failed refresh leaves the existing mirror intact.
    expect(thread.pendingQueue).toHaveLength(1);
  });

  it("leaves the mirror untouched when remove/edit/clear reject", async () => {
    makeThread("t-q-err", "working");
    const thread = agentStore.threads["t-q-err"]!;
    thread.pendingQueue.push({
      id: "q1",
      content: "still here",
      submittedAt: 1,
    });

    mockIPC(() => Promise.reject(new Error("backend down")));

    await agentStore.removeQueueItem("t-q-err", "q1");
    await agentStore.updateQueueItem("t-q-err", "q1", "edited");
    await agentStore.clearQueue("t-q-err");
    flushSync();

    expect(thread.pendingQueue).toHaveLength(1);
    expect(thread.pendingQueue[0]!.content).toBe("still here");
  });
});

// ── setConfig ────────────────────────────────────────────────────────────────

const modelConfigFixture = (): ConfigOption[] => [
  { id: "model", name: "Model", current_value: "opus", options: [] },
];

describe("setConfig", () => {
  it("applies the value optimistically and keeps it once the command succeeds", async () => {
    makeThread("t-cfg-ok", "idle");
    const thread = agentStore.threads["t-cfg-ok"]!;
    thread.configOptions = modelConfigFixture();

    let seen: string | undefined;
    let args: unknown;
    mockIPC((cmd, a) => {
      if (cmd === "set_thread_config") {
        args = a;
        // The optimistic write must already be visible when the IPC fires.
        seen = agentStore.threads["t-cfg-ok"]!.configOptions[0]!.current_value;
        return Promise.resolve([]);
      }
      return null;
    });

    await agentStore.setConfig("t-cfg-ok", "model", "sonnet");
    flushSync();

    expect(seen).toBe("sonnet");
    expect(args).toEqual({
      threadId: "t-cfg-ok",
      configId: "model",
      value: "sonnet",
    });
    expect(thread.configOptions[0]!.current_value).toBe("sonnet");
  });

  it("reverts to the previous options when the command rejects", async () => {
    makeThread("t-cfg-err", "idle");
    const thread = agentStore.threads["t-cfg-err"]!;
    thread.configOptions = modelConfigFixture();
    vi.spyOn(console, "error").mockImplementation(() => {});

    mockIPC((cmd) => {
      if (cmd === "set_thread_config") return Promise.reject(new Error("rejected"));
      return null;
    });

    await agentStore.setConfig("t-cfg-err", "model", "sonnet");
    flushSync();

    expect(thread.configOptions[0]!.current_value).toBe("opus");
  });

  it("tolerates an unknown config id and throws for an unknown thread", async () => {
    makeThread("t-cfg-missing", "idle");
    agentStore.threads["t-cfg-missing"]!.configOptions = modelConfigFixture();
    mockIPC(() => Promise.resolve([]));

    await agentStore.setConfig("t-cfg-missing", "no-such-option", "x");
    flushSync();
    expect(agentStore.threads["t-cfg-missing"]!.configOptions[0]!.current_value).toBe("opus");

    await expect(agentStore.setConfig("ghost", "model", "x")).rejects.toThrow(
      "Thread ghost not found",
    );
  });
});

// ── resetThreadState / stopThread ────────────────────────────────────────────

describe("resetThreadState", () => {
  it("clears transcript, tool calls, queue and error before a resume", () => {
    makeThread("t-reset", "error");
    const thread = agentStore.threads["t-reset"]!;
    thread.errorMessage = "old failure";
    thread.stopReason = "Cancelled";
    thread.drainQueueOnIdle = true;
    thread.messages.push({
      id: "m1",
      role: "user",
      content: "x",
      timestamp: "1:00 PM",
      sending: true,
    });
    thread.pendingQueue.push({ id: "q1", content: "x", submittedAt: 1 });
    thread.activeToolCalls["tc"] = {
      id: "tc",
      name: "Read",
      kind: "read",
      status: "pending",
      locations: [],
      content: [],
    };

    agentStore.resetThreadState("t-reset");
    flushSync();

    expect(thread.messages).toHaveLength(0);
    expect(thread.pendingQueue).toHaveLength(0);
    expect(Object.keys(thread.activeToolCalls)).toHaveLength(0);
    expect(thread.stopReason).toBeNull();
    expect(thread.drainQueueOnIdle).toBe(false);
    expect(thread.errorMessage).toBeUndefined();
  });

  it("is a no-op for an unknown thread", () => {
    expect(() => agentStore.resetThreadState("ghost")).not.toThrow();
  });
});

describe("stopThread", () => {
  it("invokes shutdown_thread and marks the thread dead", async () => {
    makeThread("t-stop", "working");
    let args: unknown;
    mockIPC((cmd, a) => {
      if (cmd === "shutdown_thread") {
        args = a;
        return Promise.resolve(null);
      }
      return null;
    });

    await agentStore.stopThread("t-stop");
    flushSync();

    expect(args).toEqual({ threadId: "t-stop" });
    expect(agentStore.threads["t-stop"]!.status).toBe("dead");
  });

  it("still marks the thread dead when the RPC fails", async () => {
    makeThread("t-stop-err", "working");
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockIPC(() => Promise.reject(new Error("process already gone")));

    await agentStore.stopThread("t-stop-err");
    flushSync();

    expect(agentStore.threads["t-stop-err"]!.status).toBe("dead");
  });

  it("skips threads that are unknown or already dead", async () => {
    makeThread("t-stop-dead", "dead");
    const called = vi.fn();
    mockIPC((cmd) => {
      if (cmd === "shutdown_thread") called();
      return null;
    });

    await agentStore.stopThread("ghost");
    await agentStore.stopThread("t-stop-dead");
    flushSync();

    expect(called).not.toHaveBeenCalled();
  });
});

// ── replayNotifications: full history rebuild ────────────────────────────────

describe("replayNotifications", () => {
  it("rebuilds an entire transcript from recorded history", () => {
    makeThread("t-full-replay", "idle");
    const thread = agentStore.threads["t-full-replay"]!;

    agentStore._test.replayNotifications([
      {
        type: "thread:message-chunk",
        thread_id: "t-full-replay",
        content: "Hel",
        kind: "message",
      },
      {
        type: "thread:message-chunk",
        thread_id: "t-full-replay",
        content: "lo",
        kind: "message",
      },
      {
        type: "thread:message-chunk",
        thread_id: "t-full-replay",
        content: "hmm",
        kind: "thinking",
      },
      {
        type: "thread:user-message",
        thread_id: "t-full-replay",
        content: "<emergent-system>x</emergent-system>real question",
        is_echo: false,
      },
      { type: "thread:nudge-delivered", thread_id: "t-full-replay", count: 2 },
      {
        type: "thread:tool-call-update",
        thread_id: "t-full-replay",
        tool_call_id: "tc1",
        title: "Read",
        kind: "read",
        status: "in_progress",
      },
      {
        type: "thread:tool-call-update",
        thread_id: "t-full-replay",
        tool_call_id: "tc1",
        status: "completed",
        content: [{ type: "text", text: "file body" }],
      },
      {
        type: "thread:system-message",
        thread_id: "t-full-replay",
        content: "resumed",
      },
      {
        type: "thread:config-update",
        thread_id: "t-full-replay",
        config_options: [{ id: "model", name: "Model", current_value: "opus", options: [] }],
        changes: [{ option_name: "Model", new_value_name: "Opus" }],
      },
      // No-op kinds must leave the transcript alone.
      {
        type: "thread:prompt-complete",
        thread_id: "t-full-replay",
        stop_reason: "EndTurn",
      },
      {
        type: "thread:status-change",
        thread_id: "t-full-replay",
        status: "idle",
      },
      {
        type: "thread:error",
        thread_id: "t-full-replay",
        message: "ignored on replay",
      },
      {
        type: "thread:session-ready",
        thread_id: "t-full-replay",
        acp_session_id: "acp-1",
      },
      // Events for other threads are skipped entirely.
      { type: "thread:system-message", thread_id: "ghost", content: "nope" },
    ]);
    flushSync();

    expect(thread.messages.map((m) => m.role)).toEqual([
      "assistant",
      "thinking",
      "user",
      "tool-group",
      "system",
      "system",
    ]);
    expect(thread.messages[0]!.content).toBe("Hello");
    expect(thread.messages[2]!.content).toBe("real question");
    // The nudge coalesced onto the user bubble that preceded it.
    expect(thread.messages[2]!.nudgeCount).toBe(2);
    expect(thread.messages[3]!.toolCalls![0]!.name).toBe("Read");
    expect(thread.messages[3]!.toolCalls![0]!.content).toEqual([
      { type: "text", text: "file body" },
    ]);
    expect(thread.messages[4]!.content).toBe("resumed");
    expect(thread.messages[5]!.content).toBe("Model changed to Opus");
    // The error/status no-ops must not have leaked into thread state.
    expect(thread.status).toBe("idle");
    expect(thread.errorMessage).toBeUndefined();
    expect(thread.configOptions).toHaveLength(1);
  });

  it("adds a standalone nudge row when no user bubble precedes it", () => {
    makeThread("t-replay-nudge", "idle");
    const thread = agentStore.threads["t-replay-nudge"]!;

    agentStore._test.replayNotifications([
      { type: "thread:nudge-delivered", thread_id: "t-replay-nudge", count: 4 },
    ]);
    flushSync();

    expect(thread.messages[0]!.role).toBe("nudge");
    expect(thread.messages[0]!.nudgeCount).toBe(4);
  });

  it("flushes tool calls that were still running when the session ended", () => {
    makeThread("t-replay-open", "idle");
    const thread = agentStore.threads["t-replay-open"]!;

    agentStore._test.replayNotifications([
      {
        type: "thread:tool-call-update",
        thread_id: "t-replay-open",
        tool_call_id: "tc-open",
        title: "Bash",
        status: "in_progress",
      },
    ]);
    flushSync();

    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.role).toBe("tool-group");
    expect(thread.messages[0]!.toolCalls![0]!.status).toBe("in_progress");
  });

  it("leaves config options alone when a replayed update carries no changes", () => {
    makeThread("t-replay-cfg", "idle");
    const thread = agentStore.threads["t-replay-cfg"]!;

    agentStore._test.replayNotifications([
      {
        type: "thread:config-update",
        thread_id: "t-replay-cfg",
        config_options: [{ id: "mode", name: "Mode", current_value: "plan", options: [] }],
        changes: [],
      },
    ]);
    flushSync();

    expect(thread.messages).toHaveLength(0);
    expect(thread.configOptions[0]!.id).toBe("mode");
  });

  it("does not append a user bubble for a turn-dispatched with no user text", () => {
    makeThread("t-replay-notext", "idle");
    const thread = agentStore.threads["t-replay-notext"]!;

    agentStore._test.replayNotifications([
      {
        type: "thread:turn-dispatched",
        thread_id: "t-replay-notext",
        user_text: "",
        notifications: [
          {
            id: "n1",
            source: "thread",
            from: "Agent B",
            content: "ping",
            created_at: new Date().toISOString(),
          },
        ],
      },
    ]);
    flushSync();

    expect(thread.messages.map((m) => m.role)).toEqual(["notification"]);
  });
});

// ── syncThreadSnapshot ───────────────────────────────────────────────────────

describe("syncThreadSnapshot", () => {
  it("replaces the thread's chat state with the backend snapshot", () => {
    makeThread("t-sync", "error");
    const thread = agentStore.threads["t-sync"]!;
    thread.errorMessage = "stale error";
    thread.messages.push({
      id: "old",
      role: "user",
      content: "stale",
      timestamp: "1:00 PM",
    });

    agentStore.syncThreadSnapshot("t-sync", {
      status: "idle",
      acpSessionId: "acp-sync",
      history: [
        {
          type: "thread:system-message",
          thread_id: "t-sync",
          content: "restored",
        },
      ],
      configOptions: [{ id: "model", name: "Model", current_value: "opus", options: [] }],
    });
    flushSync();

    // The stale transcript is discarded, not merged with.
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.content).toBe("restored");
    expect(thread.status).toBe("idle");
    expect(thread.acpSessionId).toBe("acp-sync");
    expect(thread.configOptions).toHaveLength(1);
    expect(thread.errorMessage).toBeUndefined();
  });

  it("keeps the existing session id when the snapshot omits one", () => {
    makeThread("t-sync-keep", "dead");
    const thread = agentStore.threads["t-sync-keep"]!;
    thread.acpSessionId = "acp-existing";

    agentStore.syncThreadSnapshot("t-sync-keep", {
      status: "idle",
      history: [],
      configOptions: [],
    });
    flushSync();

    expect(thread.acpSessionId).toBe("acp-existing");
  });

  it("falls back to null when neither the snapshot nor the thread has a session id", () => {
    makeThread("t-sync-null", "dead");

    agentStore.syncThreadSnapshot("t-sync-null", {
      status: "idle",
      history: [],
      configOptions: [],
    });
    flushSync();

    expect(agentStore.threads["t-sync-null"]!.acpSessionId).toBeNull();
  });

  it("is a no-op for an unknown thread", () => {
    expect(() =>
      agentStore.syncThreadSnapshot("ghost", {
        status: "idle",
        history: [],
        configOptions: [],
      }),
    ).not.toThrow();
  });
});
