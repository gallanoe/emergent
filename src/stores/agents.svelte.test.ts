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

// ── B2: sendPrompt queues during "cancelling" and pushes pending bubble ───────

describe("B2: sendPrompt while cancelling", () => {
  it("pushes a pending bubble, sets queuedContent, sets suppressNextUserEcho, does not invoke", async () => {
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

    const thread = agentStore.threads["t-b2"];
    expect(thread?.queuedContent).toBe("hello world");

    const pendingMsg = thread?.messages.find((m) => m.pending === true);
    expect(pendingMsg).toBeDefined();
    expect(pendingMsg?.content).toBe("hello world");

    expect(thread?.suppressNextUserEcho).toBe(true);
    expect(invokeSend).not.toHaveBeenCalled();
  });

  it("also queues during 'working' status with pending bubble", async () => {
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

    const thread = agentStore.threads["t-b2-working"];
    expect(thread?.queuedContent).toBe("queued msg");

    const pendingMsg = thread?.messages.find((m) => m.pending === true);
    expect(pendingMsg).toBeDefined();
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

  it("B3c: two pending messages — both cleared; drainQueueOnIdle set; sendPrompt not called (status stays unchanged)", () => {
    makeThread("t-b3c", "cancelling");
    const thread = agentStore.threads["t-b3c"]!;
    thread.queuedContent = "msg1\n\nmsg2";
    thread.messages.push(
      { id: "p1", role: "user", content: "msg1", timestamp: "1:00 PM", pending: true },
      { id: "p2", role: "user", content: "msg2", timestamp: "1:00 PM", pending: true },
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

    // Both pending bubbles cleared
    expect(thread.messages.every((m) => !m.pending)).toBe(true);
    // Drain flag set
    expect(thread.drainQueueOnIdle).toBe(true);
    // sendPrompt not called (no invoke to send_prompt)
    expect(sendCalled).not.toHaveBeenCalled();
    // queuedContent preserved for later drain
    expect(thread.queuedContent).toBe("msg1\n\nmsg2");
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

  it("B3d: when idle and drainQueueOnIdle=true, calls sendPrompt and resets flag", async () => {
    makeThread("t-b3d", "cancelling");
    const thread = agentStore.threads["t-b3d"]!;
    thread.drainQueueOnIdle = true;
    thread.queuedContent = "queued message";

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
    expect(thread.queuedContent).toBe("");
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

// ── B6: handleError restores pending bubbles to composer ─────────────────────

describe("B6: handleError restores pending bubbles", () => {
  it("removes pending message from thread.messages and passes content to onQueueDump", () => {
    makeThread("t-b6", "cancelling");
    const thread = agentStore.threads["t-b6"]!;
    thread.messages.push({
      id: "p1",
      role: "user",
      content: "pending text",
      timestamp: "1:00 PM",
      pending: true,
    });

    let dumpedContent = "";
    agentStore.registerQueueDumpHandler((_threadId, content) => {
      dumpedContent = content;
    });

    agentStore._test.handleError({ thread_id: "t-b6", message: "cancelled" });
    flushSync();

    // Pending message removed from transcript
    expect(thread.messages.find((m) => m.id === "p1")).toBeUndefined();
    // Content surfaced to composer via onQueueDump
    expect(dumpedContent).toBe("pending text");
    // Thread is in error state
    expect(thread.status).toBe("error");
  });
});

// ── B7: handleUserMessage swallows echo when suppressNextUserEcho=true ────────

describe("B7: handleUserMessage echo suppression", () => {
  it("does not push message when suppressNextUserEcho=true, resets flag", () => {
    makeThread("t-b7", "working");
    const thread = agentStore.threads["t-b7"]!;
    thread.suppressNextUserEcho = true;
    const msgCountBefore = thread.messages.length;

    agentStore._test.handleUserMessage({ thread_id: "t-b7", content: "echoed content" });
    flushSync();

    expect(thread.messages.length).toBe(msgCountBefore);
    expect(thread.suppressNextUserEcho).toBe(false);
  });

  it("pushes message normally when suppressNextUserEcho=false", () => {
    makeThread("t-b7-normal", "working");
    const thread = agentStore.threads["t-b7-normal"]!;
    const msgCountBefore = thread.messages.length;

    agentStore._test.handleUserMessage({ thread_id: "t-b7-normal", content: "normal message" });
    flushSync();

    expect(thread.messages.length).toBe(msgCountBefore + 1);
    expect(thread.messages.at(-1)?.content).toBe("normal message");
  });
});
