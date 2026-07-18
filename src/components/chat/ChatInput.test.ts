import { describe, it, expect, vi } from "vitest";
import { tick, flushSync } from "svelte";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import ChatInput from "./ChatInput.svelte";
import type { DisplayThread, QueueItem } from "../../stores/types";

function makeThread(overrides?: Partial<DisplayThread>): DisplayThread {
  return {
    id: "t1",
    agentId: "d1",
    workspaceId: "w1",
    provider: "claude",
    name: "Alpha",
    processStatus: "idle",
    preview: "",
    updatedAt: "1m",
    messages: [],
    activeToolCalls: [],
    queuedMessage: null,
    configOptions: [],
    stopReason: null,
    taskId: null,
    tokenUsage: undefined,
    ...overrides,
  };
}

describe("ChatInput", () => {
  it("shows demo placeholder when demoMode", () => {
    render(ChatInput, {
      props: {
        thread: makeThread({ processStatus: "working" }),
        demoMode: true,
        onSend: () => {},
      },
    });
    expect(screen.getByPlaceholderText("Demo mode — input disabled")).toBeTruthy();
  });

  it("shows initializing placeholder", () => {
    render(ChatInput, {
      props: {
        thread: makeThread({ processStatus: "initializing" }),
        demoMode: false,
        onSend: () => {},
      },
    });
    expect(screen.getByPlaceholderText("Connecting to agent…")).toBeTruthy();
  });

  it("shows running placeholder when idle", () => {
    render(ChatInput, {
      props: {
        thread: makeThread({ processStatus: "idle" }),
        demoMode: false,
        onSend: () => {},
      },
    });
    expect(screen.getByPlaceholderText("Message Alpha…")).toBeTruthy();
  });

  it("submits on Enter without Shift", async () => {
    const onSend = vi.fn();
    render(ChatInput, {
      props: {
        thread: makeThread(),
        demoMode: false,
        onSend,
      },
    });
    const ta = screen.getByRole("textbox");
    await fireEvent.input(ta, { target: { value: "hello" } });
    await fireEvent.keyDown(ta, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("does not submit on Shift+Enter", async () => {
    const onSend = vi.fn();
    render(ChatInput, {
      props: {
        thread: makeThread(),
        demoMode: false,
        onSend,
      },
    });
    const ta = screen.getByRole("textbox");
    await fireEvent.input(ta, { target: { value: "hello" } });
    await fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows only the interrupt button when working", async () => {
    render(ChatInput, {
      props: {
        thread: makeThread({ processStatus: "working" }),
        demoMode: false,
        onSend: () => {},
      },
    });
    const ta = screen.getByRole("textbox");
    await fireEvent.input(ta, { target: { value: "queue me" } });
    await tick();
    expect(screen.getByTitle("Interrupt")).toBeTruthy();
    // Design calls for a single button at a time — no queue-send affordance.
    expect(screen.queryByTitle("Queue message")).toBeNull();
    expect(screen.queryByTitle("Send")).toBeNull();
  });

  it("renders one value-only config pill per dimension (no agent name/avatar)", () => {
    render(ChatInput, {
      props: {
        thread: makeThread({
          configOptions: [
            {
              id: "model",
              name: "Model",
              current_value: "sonnet",
              options: [
                { value: "sonnet", name: "Sonnet" },
                { value: "opus", name: "Opus" },
              ],
            },
            {
              id: "reasoning",
              name: "Reasoning",
              current_value: "high",
              options: [
                { value: "high", name: "High" },
                { value: "low", name: "Low" },
              ],
            },
          ],
        }),
        demoMode: false,
        onSend: () => {},
      },
    });
    // Each pill's face shows its current value…
    expect(screen.getByRole("button", { name: /Sonnet/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /High/i })).toBeTruthy();
    // …and the agent name is no longer part of the pill.
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("toggles a config pill's popup when the pill is clicked", async () => {
    render(ChatInput, {
      props: {
        thread: makeThread({
          configOptions: [
            {
              id: "model",
              name: "Model",
              current_value: "sonnet",
              options: [
                { value: "sonnet", name: "Sonnet" },
                { value: "opus", name: "Opus" },
              ],
            },
          ],
        }),
        demoMode: false,
        onSend: () => {},
      },
    });
    const pill = screen.getByRole("button", { name: /Sonnet/i });
    await fireEvent.click(pill);
    // Opening reveals the dimension header and the other option.
    expect(screen.getByText("Model")).toBeTruthy();
    expect(screen.getByText("Opus")).toBeTruthy();
    await fireEvent.click(pill);
    // The popup plays a close transition, so wait for it to be removed.
    await waitFor(() => expect(screen.queryByText("Opus")).toBeNull());
  });

  it("closes a config pill's popup on Escape", async () => {
    render(ChatInput, {
      props: {
        thread: makeThread({
          configOptions: [
            {
              id: "model",
              name: "Model",
              current_value: "sonnet",
              options: [
                { value: "sonnet", name: "Sonnet" },
                { value: "opus", name: "Opus" },
              ],
            },
          ],
        }),
        demoMode: false,
        onSend: () => {},
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: /Sonnet/i }));
    expect(screen.getByText("Opus")).toBeTruthy();
    await fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Opus")).toBeNull());
  });

  it("keeps only one config pill open at a time when another is activated", async () => {
    render(ChatInput, {
      props: {
        thread: makeThread({
          configOptions: [
            {
              id: "model",
              name: "Model",
              current_value: "sonnet",
              options: [
                { value: "sonnet", name: "Sonnet" },
                { value: "opus", name: "Opus" },
              ],
            },
            {
              id: "reasoning",
              name: "Reasoning",
              current_value: "high",
              options: [
                { value: "high", name: "High" },
                { value: "low", name: "Low" },
              ],
            },
          ],
        }),
        demoMode: false,
        onSend: () => {},
      },
    });
    // Open the Model pill.
    await fireEvent.click(screen.getByRole("button", { name: /Sonnet/i }));
    expect(screen.getByText("Opus")).toBeTruthy();

    // Activate the Reasoning pill. fireEvent.click dispatches only a click (no
    // preceding mousedown), matching keyboard (Enter/Space) activation — the
    // case the old per-pill mousedown listener missed. Shared open state must
    // still close the Model popup.
    await fireEvent.click(screen.getByRole("button", { name: /High/i }));
    expect(screen.getByText("Low")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Opus")).toBeNull());
  });

  it("shows context usage ring when tokenUsage is set", async () => {
    render(ChatInput, {
      props: {
        thread: makeThread({
          tokenUsage: { used: 23400, size: 200000 },
        }),
        demoMode: false,
        onSend: () => {},
      },
    });
    expect(screen.getByLabelText("Context usage")).toBeTruthy();
  });

  it("hides context usage ring when tokenUsage is undefined", () => {
    render(ChatInput, {
      props: {
        thread: makeThread({ tokenUsage: undefined }),
        demoMode: false,
        onSend: () => {},
      },
    });
    expect(screen.queryByLabelText("Context usage")).toBeNull();
  });

  describe("QueuedMessages visibility", () => {
    it("renders QueuedMessages when pendingQueue is non-empty", () => {
      const pendingQueue: QueueItem[] = [
        { id: "q1", content: "queued text", submittedAt: Date.now() },
      ];
      render(ChatInput, {
        props: {
          thread: makeThread({ processStatus: "working" }),
          demoMode: false,
          pendingQueue,
          onSend: () => {},
        },
      });
      // QueuedMessages renders a <ul> containing row buttons with aria-expanded
      const rowBtn = screen.getByRole("button", { name: /queued message 1/i });
      expect(rowBtn).toBeTruthy();
      expect(screen.getByText("queued text")).toBeTruthy();
    });

    it("does not render QueuedMessages when pendingQueue is empty", () => {
      render(ChatInput, {
        props: {
          thread: makeThread({ processStatus: "working" }),
          demoMode: false,
          pendingQueue: [],
          onSend: () => {},
        },
      });
      expect(screen.queryByRole("button", { name: /queued message/i })).toBeNull();
    });

    it("does not render QueuedMessages when pendingQueue is not provided", () => {
      render(ChatInput, {
        props: {
          thread: makeThread(),
          demoMode: false,
          onSend: () => {},
        },
      });
      expect(screen.queryByRole("button", { name: /queued message/i })).toBeNull();
    });
  });

  describe("pushToComposer seq guard", () => {
    it("updates textarea when seq is incremented", async () => {
      const { rerender } = render(ChatInput, {
        props: {
          thread: makeThread(),
          demoMode: false,
          onSend: () => {},
          pushToComposer: { text: "", seq: 0 },
        },
      });

      await rerender({
        thread: makeThread(),
        demoMode: false,
        onSend: () => {},
        pushToComposer: { text: "hello from queue", seq: 1 },
      });
      flushSync();
      await tick();

      const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
      expect(ta.value).toBe("hello from queue");
    });

    it("does NOT update textarea when seq is repeated with different text", async () => {
      const { rerender } = render(ChatInput, {
        props: {
          thread: makeThread(),
          demoMode: false,
          onSend: () => {},
          pushToComposer: { text: "", seq: 0 },
        },
      });

      // First bump: seq 0 → 1, text = "original"
      await rerender({
        thread: makeThread(),
        demoMode: false,
        onSend: () => {},
        pushToComposer: { text: "original", seq: 1 },
      });
      flushSync();
      await tick();

      const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
      expect(ta.value).toBe("original");

      // Second pass: same seq=1, different text — must NOT clobber
      await rerender({
        thread: makeThread(),
        demoMode: false,
        onSend: () => {},
        pushToComposer: { text: "should not appear", seq: 1 },
      });
      flushSync();
      await tick();

      expect(ta.value).toBe("original");
    });
  });
});
