import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import InnerSidebar from "./InnerSidebar.svelte";
import type { DisplayWorkspace, DisplayAgentDefinition } from "../../stores/types";

function makeAgentDef(overrides?: Partial<DisplayAgentDefinition>): DisplayAgentDefinition {
  return {
    id: "agent-1",
    name: "Claude",
    role: "Researcher",
    cli: "claude",
    threads: [],
    ...overrides,
  };
}

function makeSwarm(overrides?: Partial<DisplayWorkspace>): DisplayWorkspace {
  return {
    id: "swarm-1",
    name: "Research Swarm",
    collapsed: false,
    containerStatus: { state: "running" },
    agentDefinitions: [
      makeAgentDef(),
      makeAgentDef({
        id: "agent-2",
        name: "Gemini",
        role: "Analyst",
      }),
    ],
    ...overrides,
  };
}

function renderSidebar(overrides: Record<string, unknown> = {}) {
  return render(InnerSidebar, {
    props: {
      swarm: (overrides.swarm as DisplayWorkspace | undefined) ?? makeSwarm(),
      activeView: (overrides.activeView as string) ?? "swarm",
      selectedAgentId: (overrides.selectedAgentId as string | null) ?? null,
      demoMode: (overrides.demoMode as boolean) ?? false,
      containerRunning: (overrides.containerRunning as boolean) ?? false,
      onSelectView:
        (overrides.onSelectView as (view: "swarm" | "settings" | "terminal" | "tasks") => void) ??
        (() => {}),
      onSelectAgent: (overrides.onSelectAgent as (id: string) => void) ?? (() => {}),
      onCreateAgent: (overrides.onCreateAgent as () => void) ?? (() => {}),
    },
  });
}

describe("InnerSidebar", () => {
  it("renders nav items with Skills and Tasks greyed out", () => {
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

  it("renders the agent CLI icon for known CLIs", () => {
    const { container } = renderSidebar();
    const icons = container.querySelectorAll("img[src]");
    expect(icons.length).toBe(2);
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

  it("calls onSelectView when Settings nav clicked", async () => {
    const onSelectView = vi.fn();
    renderSidebar({ onSelectView });
    await fireEvent.click(screen.getByText("Settings"));
    expect(onSelectView).toHaveBeenCalledWith("settings");
  });

  it("does not fire onSelectView for disabled items", async () => {
    const onSelectView = vi.fn();
    renderSidebar({ onSelectView });
    await fireEvent.click(screen.getByText("Skills"));
    expect(onSelectView).not.toHaveBeenCalled();
  });

  it("does not render stopped container helper text", () => {
    renderSidebar({ containerRunning: false });
    expect(screen.queryByText("Container stopped — start it to spawn threads.")).toBeNull();
  });
});
