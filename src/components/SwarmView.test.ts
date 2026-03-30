import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import SwarmView from "./SwarmView.svelte";
import type { DisplaySwarm, DisplayAgent, SwarmMessageLogEntry } from "../stores/types";

function makeAgent(overrides?: Partial<DisplayAgent>): DisplayAgent {
  return {
    id: "agent-1",
    swarmId: "swarm-1",
    cli: "claude-agent-acp",
    name: "Claude",
    status: "working",
    preview: "Researching papers...",
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

function makeSwarm(overrides?: Partial<DisplaySwarm>): DisplaySwarm {
  return {
    id: "swarm-1",
    name: "Research Swarm",
    collapsed: false,
    agents: [
      makeAgent(),
      makeAgent({ id: "agent-2", name: "Gemini", role: "Analyst", status: "idle" }),
    ],
    ...overrides,
  };
}

function renderSwarmView(overrides: Record<string, unknown> = {}) {
  return render(SwarmView, {
    props: {
      swarm: (overrides.swarm as DisplaySwarm) ?? makeSwarm(),
      messageLog: (overrides.messageLog as SwarmMessageLogEntry[]) ?? [],
      agentConnections: (overrides.agentConnections as Record<string, string[]>) ?? {},
      demoMode: false,
      knownAgents: [],
      onSelectAgent: (overrides.onSelectAgent as (id: string) => void) ?? (() => {}),
      onAddAgent: (overrides.onAddAgent as (s: string, c: string, n: string) => void) ?? (() => {}),
    },
  });
}

describe("SwarmView", () => {
  it("renders swarm name in top bar", () => {
    renderSwarmView();
    expect(screen.getByText("Research Swarm")).toBeTruthy();
  });

  it("renders agent count badge", () => {
    renderSwarmView();
    expect(screen.getByText("2 agents")).toBeTruthy();
  });

  it("renders agent cards with names", () => {
    renderSwarmView();
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByText("Gemini")).toBeTruthy();
  });

  it("renders agent roles", () => {
    renderSwarmView();
    expect(screen.getByText("Researcher")).toBeTruthy();
    expect(screen.getByText("Analyst")).toBeTruthy();
  });

  it("calls onSelectAgent when card clicked", async () => {
    const onSelectAgent = vi.fn();
    renderSwarmView({ onSelectAgent });
    await fireEvent.click(screen.getByText("Gemini"));
    expect(onSelectAgent).toHaveBeenCalledWith("agent-2");
  });

  it("renders activity feed", () => {
    renderSwarmView();
    expect(screen.getByText("Activity")).toBeTruthy();
  });
});
