import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import InnerSidebar from "./InnerSidebar.svelte";
import type { DisplayWorkspace, DisplayAgent } from "../../stores/types";

function makeAgent(overrides?: Partial<DisplayAgent>): DisplayAgent {
  return {
    id: "agent-1",
    workspaceId: "swarm-1",
    cli: "claude-agent-acp",
    name: "Claude",
    status: "working",
    preview: "Researching...",
    updatedAt: "2m ago",
    messages: [],
    activeToolCalls: [],
    queuedMessage: null,
    configOptions: [],
    hasManagementPermissions: false,
    role: "Researcher",
    ...overrides,
  };
}

function makeSwarm(overrides?: Partial<DisplayWorkspace>): DisplayWorkspace {
  return {
    id: "swarm-1",
    name: "Research Swarm",
    collapsed: false,
    containerStatus: { state: "running" },
    agents: [
      makeAgent(),
      makeAgent({
        id: "agent-2",
        name: "Gemini",
        role: "Analyst",
        status: "idle",
      }),
    ],
    ...overrides,
  };
}

function renderSidebar(overrides: Record<string, unknown> = {}) {
  return render(InnerSidebar, {
    props: {
      swarm: (overrides.swarm as DisplayWorkspace | undefined) ?? makeSwarm(),
      activeView: (overrides.activeView as "swarm" | "agent") ?? "swarm",
      selectedAgentId: (overrides.selectedAgentId as string | null) ?? null,
      demoMode: (overrides.demoMode as boolean) ?? false,
      knownAgents:
        (overrides.knownAgents as { name: string; command: string; available: boolean }[]) ?? [],
      onSelectView: (overrides.onSelectView as (view: "swarm" | "agent") => void) ?? (() => {}),
      onSelectAgent: (overrides.onSelectAgent as (id: string) => void) ?? (() => {}),
      onAddAgent:
        (overrides.onAddAgent as (swarmId: string, cmd: string, name: string) => void) ??
        (() => {}),
    },
  });
}

describe("InnerSidebar", () => {
  it("renders swarm name as header", () => {
    renderSidebar();
    expect(screen.getByText("Research Swarm")).toBeTruthy();
  });

  it("renders nav items with Settings, Skills, Tasks greyed out", () => {
    renderSidebar();
    expect(screen.getByText("Swarm")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Skills")).toBeTruthy();
    expect(screen.getByText("Tasks")).toBeTruthy();
  });

  it("renders agents with names", () => {
    renderSidebar();
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByText("Gemini")).toBeTruthy();
  });

  it("calls onSelectView when Swarm nav clicked", async () => {
    const onSelectView = vi.fn();
    renderSidebar({ onSelectView, activeView: "agent" });
    await fireEvent.click(screen.getByText("Swarm"));
    expect(onSelectView).toHaveBeenCalledWith("swarm");
  });

  it("calls onSelectAgent when agent clicked", async () => {
    const onSelectAgent = vi.fn();
    renderSidebar({ onSelectAgent });
    await fireEvent.click(screen.getByText("Gemini"));
    expect(onSelectAgent).toHaveBeenCalledWith("agent-2");
  });

  it("does not fire onSelectView for disabled items", async () => {
    const onSelectView = vi.fn();
    renderSidebar({ onSelectView });
    await fireEvent.click(screen.getByText("Settings"));
    expect(onSelectView).not.toHaveBeenCalled();
  });
});
