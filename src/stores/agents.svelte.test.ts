/**
 * Vitest tests for chat-interrupt + send-while-busy bug fixes.
 * Tasks: B1, B2, B3 (a/b/c), B3d, B4, B5, B6, B7
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { agentStore } from "./agents.svelte";

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

// ── B2: sendPrompt queues to pendingQueue during "cancelling"/"working" ───────

describe("B2: sendPrompt while cancelling", () => {
  it("pushes item to pendingQueue, leaves messages unchanged, does not invoke", async () => {
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
    expect(thread.pendingQueue).toHaveLength(1);
    expect(thread.pendingQueue[0]!.content).toBe("hello world");

    // No bubble pushed to messages
    expect(thread.messages).toHaveLength(0);

    expect(invokeSend).not.toHaveBeenCalled();
  });

  it("also queues during 'working' status", async () => {
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
    expect(thread.pendingQueue).toHaveLength(1);
    expect(thread.pendingQueue[0]!.content).toBe("queued msg");
    expect(thread.messages).toHaveLength(0);
    expect(invokeSend).not.toHaveBeenCalled();
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

  it("B3c: with pending queue items — drainQueueOnIdle set; sendPrompt not called (status stays unchanged)", () => {
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

    // Drain flag set
    expect(thread.drainQueueOnIdle).toBe(true);
    // sendPrompt not called (no invoke to send_prompt)
    expect(sendCalled).not.toHaveBeenCalled();
    // pendingQueue preserved for later drain
    expect(thread.pendingQueue).toHaveLength(2);
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

  it("B3d: when idle and drainQueueOnIdle=true with pendingQueue items, drains and calls send_prompt", async () => {
    makeThread("t-b3d", "cancelling");
    const thread = agentStore.threads["t-b3d"]!;
    thread.drainQueueOnIdle = true;
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

    expect(thread.drainQueueOnIdle).toBe(false);
    expect(thread.pendingQueue).toHaveLength(0);

    // One sending bubble added for the drained content
    const sendingBubble = thread.messages.find((m) => m.sending === true);
    expect(sendingBubble).toBeDefined();
    expect(sendingBubble?.content).toBe("queued message");

    // sendPrompt is called async via void — wait a tick
    await Promise.resolve();
    expect(sendCalled).toHaveBeenCalled();
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
  it("removes the item with the matching id", () => {
    makeThread("t-remove", "working");
    const thread = agentStore.threads["t-remove"]!;
    thread.pendingQueue.push(
      { id: "q1", content: "first", submittedAt: Date.now() },
      { id: "q2", content: "second", submittedAt: Date.now() },
    );

    agentStore.removeQueueItem("t-remove", "q1");
    flushSync();

    expect(thread.pendingQueue).toHaveLength(1);
    expect(thread.pendingQueue[0]!.id).toBe("q2");
  });

  it("is a no-op when the id is not found", () => {
    makeThread("t-remove-noop", "working");
    const thread = agentStore.threads["t-remove-noop"]!;
    thread.pendingQueue.push({ id: "q1", content: "msg", submittedAt: Date.now() });

    agentStore.removeQueueItem("t-remove-noop", "does-not-exist");
    flushSync();

    expect(thread.pendingQueue).toHaveLength(1);
  });

  it("is a no-op when the thread is not found", () => {
    expect(() => agentStore.removeQueueItem("nonexistent", "q1")).not.toThrow();
  });
});

describe("updateQueueItem", () => {
  it("replaces content in place, preserving id and submittedAt", () => {
    makeThread("t-update", "working");
    const thread = agentStore.threads["t-update"]!;
    const ts = Date.now();
    thread.pendingQueue.push({ id: "q1", content: "original", submittedAt: ts });

    agentStore.updateQueueItem("t-update", "q1", "updated content");
    flushSync();

    expect(thread.pendingQueue[0]!.content).toBe("updated content");
    expect(thread.pendingQueue[0]!.id).toBe("q1");
    expect(thread.pendingQueue[0]!.submittedAt).toBe(ts);
  });

  it("is a no-op when the id is not found", () => {
    makeThread("t-update-noop", "working");
    const thread = agentStore.threads["t-update-noop"]!;
    thread.pendingQueue.push({ id: "q1", content: "original", submittedAt: Date.now() });

    agentStore.updateQueueItem("t-update-noop", "does-not-exist", "new content");
    flushSync();

    expect(thread.pendingQueue[0]!.content).toBe("original");
  });

  it("is a no-op when the thread is not found", () => {
    expect(() => agentStore.updateQueueItem("nonexistent", "q1", "x")).not.toThrow();
  });
});

describe("clearQueue", () => {
  it("empties the pendingQueue", () => {
    makeThread("t-clear", "working");
    const thread = agentStore.threads["t-clear"]!;
    thread.pendingQueue.push(
      { id: "q1", content: "a", submittedAt: Date.now() },
      { id: "q2", content: "b", submittedAt: Date.now() },
    );

    agentStore.clearQueue("t-clear");
    flushSync();

    expect(thread.pendingQueue).toHaveLength(0);
  });

  it("is a no-op when the thread is not found", () => {
    expect(() => agentStore.clearQueue("nonexistent")).not.toThrow();
  });
});

// ── B7: handleUserMessage uses is_echo for dedup ─────────────────────────────

describe("B7: handleUserMessage echo dedup via is_echo", () => {
  it("is_echo=true with a sending bubble: flips sending=false, no duplicate pushed", () => {
    makeThread("t-b7", "working");
    const thread = agentStore.threads["t-b7"]!;
    thread.messages.push({
      id: "send-1",
      role: "user",
      content: "echoed content",
      timestamp: "1:00 PM",
      sending: true,
    });
    const msgCountBefore = thread.messages.length;

    agentStore._test.handleUserMessage({
      thread_id: "t-b7",
      content: "echoed content",
      is_echo: true,
    });
    flushSync();

    // No new message pushed
    expect(thread.messages.length).toBe(msgCountBefore);
    // sending bubble confirmed (sending=false)
    const bubble = thread.messages.find((m) => m.id === "send-1");
    expect(bubble?.sending).toBeFalsy();
  });

  it("is_echo=false pushes message normally", () => {
    makeThread("t-b7-normal", "working");
    const thread = agentStore.threads["t-b7-normal"]!;
    const msgCountBefore = thread.messages.length;

    agentStore._test.handleUserMessage({
      thread_id: "t-b7-normal",
      content: "normal message",
      is_echo: false,
    });
    flushSync();

    expect(thread.messages.length).toBe(msgCountBefore + 1);
    expect(thread.messages.at(-1)?.content).toBe("normal message");
  });

  it("is_echo=true with no sending bubble: falls through to normal push", () => {
    makeThread("t-b7-fallthrough", "working");
    const thread = agentStore.threads["t-b7-fallthrough"]!;
    const msgCountBefore = thread.messages.length;

    agentStore._test.handleUserMessage({
      thread_id: "t-b7-fallthrough",
      content: "sub-agent message",
      is_echo: true,
    });
    flushSync();

    // No sending bubble, so it falls through to a normal push
    expect(thread.messages.length).toBe(msgCountBefore + 1);
    expect(thread.messages.at(-1)?.content).toBe("sub-agent message");
  });
});
