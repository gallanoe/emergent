import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import TopBar from "./TopBar.svelte";
import type { DisplayAgent } from "../../stores/types";

function makeAgent(overrides?: Partial<DisplayAgent>): DisplayAgent {
  return {
    id: "agent-1",
    swarmId: "swarm-1",
    cli: "claude-agent-acp",
    name: "Claude Code #2",
    status: "idle",
    preview: "",
    updatedAt: "5m ago",
    messages: [],
    activeToolCalls: [],
    queuedMessage: null,
    configOptions: [],
    hasManagementPermissions: false,
    ...overrides,
  };
}

const noop = () => {};

function renderTopBar(
  overrides: Partial<{
    agent: DisplayAgent | undefined;
    onShutdown: () => void;
  }> = {},
) {
  return render(TopBar, {
    props: {
      agent: "agent" in overrides ? overrides.agent : makeAgent(),
      allAgents: [],
      connections: [],
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

  it("renders Settings button", () => {
    renderTopBar();
    expect(screen.getByText("Settings")).toBeTruthy();
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
