import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import TopBar from "./TopBar.svelte";
import type { DisplayThread } from "../../stores/types";

function makeAgent(overrides?: Partial<DisplayThread>): DisplayThread {
  return {
    id: "agent-1",
    agentId: "def-1",
    workspaceId: "swarm-1",
    cli: "claude-agent-acp",
    name: "Claude Code #2",
    status: "idle",
    processStatus: "idle",
    preview: "",
    updatedAt: "5m ago",
    messages: [],
    activeToolCalls: [],
    queuedMessage: null,
    configOptions: [],
    stopReason: null,
    taskId: null,
    ...overrides,
  };
}

const noop = () => {};

function renderTopBar(
  overrides: Partial<{
    agent: DisplayThread | undefined;
    onShutdown: () => void;
  }> = {},
) {
  return render(TopBar, {
    props: {
      agent: "agent" in overrides ? overrides.agent : makeAgent(),
      onShutdown: overrides.onShutdown ?? noop,
    },
  });
}

describe("TopBar", () => {
  it("renders agent name", () => {
    renderTopBar();
    expect(screen.getByText("Claude Code #2")).toBeTruthy();
  });

  it("shows 'No agent selected' when no agent", () => {
    renderTopBar({ agent: undefined });
    expect(screen.getByText("No agent selected")).toBeTruthy();
  });

  it("renders Shutdown button when agent exists", () => {
    renderTopBar();
    expect(screen.getByText("Shutdown")).toBeTruthy();
  });

  it("calls onShutdown when Shutdown is clicked", async () => {
    const onShutdown = vi.fn();
    renderTopBar({ onShutdown });
    await fireEvent.click(screen.getByText("Shutdown"));
    expect(onShutdown).toHaveBeenCalledOnce();
  });

  it("hides action buttons when no agent selected", () => {
    renderTopBar({ agent: undefined });
    expect(screen.queryByText("Shutdown")).toBeNull();
  });
});
