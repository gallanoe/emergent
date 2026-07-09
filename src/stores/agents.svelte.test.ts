/**
 * Vitest tests for chat-interrupt + send-while-busy bug fixes.
 * Tasks: B1, B2, B3 (a/b/c), B3d, B4, B5, B6, B7
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { agentStore } from "./agents.svelte";
import type { TurnDispatchedPayload } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeThread(
  threadId: string,
  status: "idle" | "working" | "cancelling" | "error" | "dead" | "initializing" = "idle",
) {
  agentStore._test.injectThread(threadId, { id: threadId, agentDefinitionId: "agent-1", status });
}

afterEach(() => {
  clearMocks();
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
      { id: "m2", role: "assistant", content: "partial reply...", timestamp: "1:00 PM" },
    );

    agentStore._test.handlePromptComplete({ thread_id: "t-b3b", stop_reason: "Cancelled" });
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

    agentStore._test.handlePromptComplete({ thread_id: "t-b3c", stop_reason: "EndTurn" });
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
    agentStore._test.chunkBuffers["t-b3a"] = { content: "some chunk", kind: "message" };

    agentStore._test.handlePromptComplete({ thread_id: "t-b3a", stop_reason: "EndTurn" });
    flushSync();

    expect(agentStore._test.chunkBuffers["t-b3a"]).toBeUndefined();
  });
});

// ── B3d / B5: handleStatusChange ─────────────────────────────────────────────

describe("B3d + B5: handleStatusChange", () => {
  it("B5: does not overwrite 'cancelling' with 'working'", () => {
    makeThread("t-b5", "cancelling");

    agentStore._test.handleStatusChange({ thread_id: "t-b5", status: "working" });
    flushSync();

    expect(agentStore.threads["t-b5"]?.status).toBe("cancelling");
  });

  it("B3d: idle transition just sets status — no frontend drain, no send_prompt", async () => {
    makeThread("t-b3d", "cancelling");
    const thread = agentStore.threads["t-b3d"]!;
    thread.pendingQueue.push({ id: "q1", content: "queued message", submittedAt: Date.now() });

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
    agentStore._test.chunkBuffers["t-b4"] = { content: "chunk data", kind: "message" };

    // handlePromptComplete triggers flushChunkBuffers internally
    agentStore._test.handlePromptComplete({ thread_id: "t-b4", stop_reason: "EndTurn" });
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

    agentStore._test.handleError({ thread_id: "t-b6", message: "network error" });
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
    thread.pendingQueue.push({ id: "q1", content: "queued", submittedAt: Date.now() });

    const sendCalled = vi.fn().mockResolvedValue(null);
    mockIPC((cmd) => {
      if (cmd === "send_prompt") {
        sendCalled();
        return Promise.resolve(null);
      }
    });

    // Error arrives
    agentStore._test.handleError({ thread_id: "t-fix2", message: "connection lost" });
    flushSync();

    // drainQueueOnIdle must be cleared by handleError
    expect(thread.drainQueueOnIdle).toBe(false);

    // Stale idle event arrives (e.g. from a delayed notification)
    agentStore._test.handleStatusChange({ thread_id: "t-fix2", status: "idle" });
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
        { id: "m1", source: "user", content: "hi", created_at: new Date().toISOString() },
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
    thread.pendingQueue.push({ id: "old", content: "x", submittedAt: Date.now() });

    agentStore._test.handleQueueChanged({ thread_id: "t-qc-empty", items: [] });
    flushSync();

    expect(thread.pendingQueue).toHaveLength(0);
  });

  it("is a no-op when the thread is not found", () => {
    expect(() =>
      agentStore._test.handleQueueChanged({ thread_id: "no-such-thread", items: [] }),
    ).not.toThrow();
  });
});

// ── Store interface: removed legacy exports ────────────────────────────────────

describe("removed legacy exports", () => {
  it("editQueue is not exported from agentStore", () => {
    expect((agentStore as Record<string, unknown>)["editQueue"]).toBeUndefined();
  });

  it("registerQueueDumpHandler is not exported from agentStore", () => {
    expect((agentStore as Record<string, unknown>)["registerQueueDumpHandler"]).toBeUndefined();
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
          { id: "q2", source: "user", content: "second", created_at: new Date().toISOString() },
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
    thread.pendingQueue.push({ id: "q1", content: "original", submittedAt: Date.now() });

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
