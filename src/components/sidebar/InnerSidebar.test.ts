import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import InnerSidebar from "./InnerSidebar.svelte";
import type { DisplayAgentDefinition, DisplayWorkspace } from "../../stores/types";

function makeAgentDef(overrides?: Partial<DisplayAgentDefinition>): DisplayAgentDefinition {
  return {
    id: "agent-1",
    name: "Claude",
    cli: "claude",
    provider: "claude",
    systemPrompt: "",
    threads: [],
    ...overrides,
  };
}

function makeWorkspace(overrides?: Partial<DisplayWorkspace>): DisplayWorkspace {
  return {
    id: "ws-1",
    name: "Research Swarm",
    collapsed: false,
    agentDefinitions: [
      makeAgentDef(),
      makeAgentDef({ id: "agent-2", name: "Gemini", provider: "gemini" }),
    ],
    ...overrides,
  };
}

const baseProps = (overrides: Record<string, unknown> = {}) => ({
  workspace: (overrides.workspace as DisplayWorkspace | undefined) ?? makeWorkspace(),
  workspaces: (overrides.workspaces as DisplayWorkspace[]) ?? [makeWorkspace()],
  selectedWorkspaceId: (overrides.selectedWorkspaceId as string | null) ?? "ws-1",
  activeView:
    (overrides.activeView as "overview" | "agent-threads" | "tasks" | "app-settings") ??
    "agent-threads",
  selectedAgentId: (overrides.selectedAgentId as string | null) ?? "agent-1",
  demoMode: (overrides.demoMode as boolean) ?? false,
  activeTaskCount: (overrides.activeTaskCount as number) ?? 0,
  onSelectWorkspace: (overrides.onSelectWorkspace as (id: string) => void) ?? (() => {}),
  onCreateWorkspace: (overrides.onCreateWorkspace as () => void) ?? (() => {}),
  onSelectAgent: (overrides.onSelectAgent as (id: string) => void) ?? (() => {}),
  onCreateAgent: (overrides.onCreateAgent as () => void) ?? (() => {}),
  onNewThread: (overrides.onNewThread as () => void) ?? (() => {}),
  onOpenTasks: (overrides.onOpenTasks as () => void) ?? (() => {}),
  onOpenAppSettings: (overrides.onOpenAppSettings as () => void) ?? (() => {}),
  onOpenWorkspaceSettings: (overrides.onOpenWorkspaceSettings as () => void) ?? (() => {}),
  onOpenOverview: (overrides.onOpenOverview as () => void) ?? (() => {}),
  onOpenSearch: (overrides.onOpenSearch as () => void) ?? (() => {}),
});

function renderSidebar(overrides: Record<string, unknown> = {}) {
  return render(InnerSidebar, { props: baseProps(overrides) });
}

describe("InnerSidebar", () => {
  it("renders the five shell regions when a workspace is present", () => {
    renderSidebar();
    expect(screen.getByText("AGENTS")).toBeTruthy();
    expect(screen.getByText("New thread")).toBeTruthy();
    expect(screen.getByText("Swarm")).toBeTruthy();
    expect(screen.getByText("Tasks")).toBeTruthy();
    expect(screen.getByTitle("Application settings")).toBeTruthy();
    expect(screen.getByText("Research Swarm")).toBeTruthy();
  });

  it("fires primary action callbacks for New thread, Swarm, and Tasks", async () => {
    const onNewThread = vi.fn();
    const onOpenOverview = vi.fn();
    const onOpenTasks = vi.fn();
    renderSidebar({ onNewThread, onOpenOverview, onOpenTasks });
    await fireEvent.click(screen.getByText("New thread"));
    expect(onNewThread).toHaveBeenCalled();
    await fireEvent.click(screen.getByText("Swarm"));
    expect(onOpenOverview).toHaveBeenCalled();
    await fireEvent.click(screen.getByText("Tasks"));
    expect(onOpenTasks).toHaveBeenCalled();
  });

  it("calls onSelectAgent when an agent row is clicked", async () => {
    const onSelectAgent = vi.fn();
    renderSidebar({ onSelectAgent, activeView: "agent-threads" });
    await fireEvent.click(screen.getByText("Gemini"));
    expect(onSelectAgent).toHaveBeenCalledWith("agent-2");
  });

  it("applies the selected style to the active agent row", () => {
    const { container } = renderSidebar({
      selectedAgentId: "agent-2",
      activeView: "agent-threads",
    });
    const btn = screen.getByText("Gemini").closest("button");
    expect(btn?.className).toMatch(/bg-bg-selected/);
    expect(container.querySelectorAll("button.bg-bg-selected").length).toBeGreaterThan(0);
  });

  it("calls onCreateAgent when the AGENTS + button is used", async () => {
    const onCreateAgent = vi.fn();
    renderSidebar({ onCreateAgent, demoMode: false });
    await fireEvent.click(screen.getByTitle("Add agent definition"));
    expect(onCreateAgent).toHaveBeenCalled();
  });

  it("calls onOpenAppSettings when the footer gear is used", async () => {
    const onOpenAppSettings = vi.fn();
    renderSidebar({ onOpenAppSettings });
    await fireEvent.click(screen.getByTitle("Application settings"));
    expect(onOpenAppSettings).toHaveBeenCalled();
  });

  it("shows a task count badge when activeTaskCount is greater than zero", () => {
    renderSidebar({ activeTaskCount: 4 });
    expect(screen.getByTestId("task-count-badge").textContent).toBe("4");
  });
});
