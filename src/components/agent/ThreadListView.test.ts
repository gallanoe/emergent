import { describe, it, expect, vi } from "vitest";
import { tick } from "svelte";
import { render, screen, fireEvent, within } from "@testing-library/svelte";
import ThreadListView from "./ThreadListView.svelte";
import type { DisplayAgentDefinition, DisplayThread } from "../../stores/types";

function makeThread(overrides?: Partial<DisplayThread>): DisplayThread {
  return {
    id: "t1",
    agentId: "ad-1",
    workspaceId: "w1",
    cli: "claude-agent-acp",
    name: "Main thread",
    processStatus: "idle",
    preview: "",
    updatedAt: "2m",
    messages: [],
    activeToolCalls: [],
    queuedMessage: null,
    configOptions: [],
    stopReason: null,
    taskId: null,
    ...overrides,
  };
}

function makeAgentDef(overrides?: Partial<DisplayAgentDefinition>): DisplayAgentDefinition {
  return {
    id: "ad-1",
    name: "Architect",
    role: "Planner",
    cli: "claude",
    systemPrompt: "Be brief.",
    threads: [makeThread()],
    ...overrides,
  };
}

const noop = () => {};

const baseCallbacks = {
  onSelectThread: noop,
  onNewThread: noop,
  onUpdateName: noop,
  onUpdateRole: noop,
  onUpdateSystemPrompt: noop,
  onResumeThread: noop,
  onStopThread: noop,
  onDeleteThread: noop,
  onDeleteAgent: noop,
};

describe("ThreadListView", () => {
  it("renders hero identity and thread count", () => {
    render(ThreadListView, {
      props: {
        agentDefinition: makeAgentDef({
          threads: [makeThread(), makeThread({ id: "t2", name: "B" })],
        }),
        containerRunning: true,
        ...baseCallbacks,
      },
    });
    expect(screen.getByTitle("Click to rename").textContent).toContain("Architect");
    expect(screen.getByText(/2 threads/)).toBeTruthy();
    expect(screen.getByText(/cli: claude/)).toBeTruthy();
  });

  it("blur with a new name calls onUpdateName", async () => {
    const onUpdateName = vi.fn();
    render(ThreadListView, {
      props: {
        agentDefinition: makeAgentDef(),
        containerRunning: true,
        ...baseCallbacks,
        onUpdateName,
      },
    });
    await fireEvent.click(screen.getByTitle("Click to rename"));
    const input = screen.getByDisplayValue("Architect");
    await fireEvent.input(input, { target: { value: "Renamed" } });
    await fireEvent.blur(input);
    expect(onUpdateName).toHaveBeenCalledWith("Renamed");
  });

  it("Escape during name edit does not call onUpdateName", async () => {
    const onUpdateName = vi.fn();
    render(ThreadListView, {
      props: {
        agentDefinition: makeAgentDef(),
        containerRunning: true,
        ...baseCallbacks,
        onUpdateName,
      },
    });
    await fireEvent.click(screen.getByTitle("Click to rename"));
    const input = screen.getByDisplayValue("Architect");
    await fireEvent.input(input, { target: { value: "X" } });
    await fireEvent.keyDown(input, { key: "Escape" });
    expect(onUpdateName).not.toHaveBeenCalled();
  });

  it("blur on role field calls onUpdateRole", async () => {
    const onUpdateRole = vi.fn();
    render(ThreadListView, {
      props: {
        agentDefinition: makeAgentDef({ role: "Planner" }),
        containerRunning: true,
        ...baseCallbacks,
        onUpdateRole,
      },
    });
    await fireEvent.click(screen.getByTitle("Click to edit role"));
    const input = screen.getByDisplayValue("Planner");
    await fireEvent.input(input, { target: { value: "Reviewer" } });
    await fireEvent.blur(input);
    expect(onUpdateRole).toHaveBeenCalledWith("Reviewer");
  });

  it("hero kebab opens agent menu with Delete agent", async () => {
    render(ThreadListView, {
      props: {
        agentDefinition: makeAgentDef(),
        containerRunning: true,
        ...baseCallbacks,
      },
    });
    await fireEvent.click(screen.getByTitle("Agent actions"));
    await tick();
    const menu = screen.getByTestId("context-menu");
    expect(within(menu).getByText("Delete agent")).toBeTruthy();
  });

  it("renders system prompt card and conversations section", () => {
    render(ThreadListView, {
      props: {
        agentDefinition: makeAgentDef(),
        containerRunning: true,
        ...baseCallbacks,
      },
    });
    expect(screen.getByText("System prompt")).toBeTruthy();
    expect(screen.getAllByText("Conversations").length).toBeGreaterThan(0);
  });

  it("shows task sessions only when there are task threads", () => {
    const { rerender } = render(ThreadListView, {
      props: {
        agentDefinition: makeAgentDef({ threads: [makeThread()] }),
        containerRunning: true,
        ...baseCallbacks,
      },
    });
    expect(screen.queryByText("Task sessions")).toBeNull();

    rerender({
      agentDefinition: makeAgentDef({
        threads: [makeThread(), makeThread({ id: "ts1", name: "Task thread", taskId: "task-9" })],
      }),
      containerRunning: true,
      ...baseCallbacks,
    });
    expect(screen.getByText("Task sessions")).toBeTruthy();
  });

  it("thread kebab on alive thread lists Stop and Delete", async () => {
    render(ThreadListView, {
      props: {
        agentDefinition: makeAgentDef({ threads: [makeThread({ processStatus: "working" })] }),
        containerRunning: true,
        ...baseCallbacks,
      },
    });
    await fireEvent.click(screen.getByTitle("Thread actions"));
    await tick();
    const menu = screen.getByTestId("context-menu");
    expect(within(menu).getByText("Stop")).toBeTruthy();
    expect(within(menu).getByText("Delete")).toBeTruthy();
  });

  it("thread kebab on dead thread lists Start and Delete", async () => {
    render(ThreadListView, {
      props: {
        agentDefinition: makeAgentDef({ threads: [makeThread({ processStatus: "dead" })] }),
        containerRunning: true,
        ...baseCallbacks,
      },
    });
    await fireEvent.click(screen.getByTitle("Thread actions"));
    await tick();
    const menu = screen.getByTestId("context-menu");
    expect(within(menu).getByText("Start")).toBeTruthy();
    expect(within(menu).getByText("Delete")).toBeTruthy();
  });

  it("choosing Delete on a thread opens danger confirm", async () => {
    const onDeleteThread = vi.fn();
    render(ThreadListView, {
      props: {
        agentDefinition: makeAgentDef(),
        containerRunning: true,
        ...baseCallbacks,
        onDeleteThread,
      },
    });
    await fireEvent.click(screen.getByTitle("Thread actions"));
    await tick();
    const menu = screen.getByTestId("context-menu");
    await fireEvent.click(within(menu).getByText("Delete"));
    await tick();
    expect(screen.getByTestId("confirm-overlay")).toBeTruthy();
    expect(screen.getByText("Delete thread?")).toBeTruthy();
    const dialog = screen.getByRole("dialog");
    await fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(onDeleteThread).toHaveBeenCalledWith("t1");
  });
});
