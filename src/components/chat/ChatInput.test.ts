import { describe, it, expect, vi } from "vitest";
import { tick } from "svelte";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ChatInput from "./ChatInput.svelte";
import type { DisplayThread } from "../../stores/types";

function makeThread(overrides?: Partial<DisplayThread>): DisplayThread {
  return {
    id: "t1",
    agentId: "d1",
    workspaceId: "w1",
    cli: "claude-agent-acp",
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

  it("toggles config popover when agent chip is clicked", async () => {
    render(ChatInput, {
      props: {
        thread: makeThread({
          configOptions: [
            {
              id: "opt1",
              name: "Model",
              current_value: "a",
              options: [{ value: "a", name: "A" }],
            },
          ],
        }),
        demoMode: false,
        onSend: () => {},
      },
    });
    const chip = screen.getByRole("button", { name: /Alpha/i });
    await fireEvent.click(chip);
    expect(screen.getByText("Model")).toBeTruthy();
    await fireEvent.click(chip);
    expect(screen.queryByText("Model")).toBeNull();
  });

  it("closes config popover on Escape", async () => {
    render(ChatInput, {
      props: {
        thread: makeThread({
          configOptions: [
            {
              id: "opt1",
              name: "Model",
              current_value: "a",
              options: [{ value: "a", name: "A" }],
            },
          ],
        }),
        demoMode: false,
        onSend: () => {},
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: /Alpha/i }));
    expect(screen.getByText("Model")).toBeTruthy();
    await fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Model")).toBeNull();
  });

  it("applies externalContent text on mount", async () => {
    render(ChatInput, {
      props: {
        thread: makeThread(),
        demoMode: false,
        externalContent: { text: "from queue", seq: 1 },
        onSend: () => {},
      },
    });
    await tick();
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("from queue");
  });
});
