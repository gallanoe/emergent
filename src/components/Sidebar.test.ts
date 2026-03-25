import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import Sidebar from "./Sidebar.svelte";
import type { DisplaySwarm } from "../stores/types";

function makeSwarm(overrides?: Partial<DisplaySwarm>): DisplaySwarm {
  return {
    id: "swarm-1",
    name: "test-swarm",
    collapsed: false,
    agents: [
      {
        id: "agent-1",
        swarmId: "swarm-1",
        cli: "claude-agent-acp",
        name: "Fix navigation bug",
        status: "working",
        preview: "Fixing the nav...",
        updatedAt: "2m ago",
        messages: [],
        activeToolCalls: [],
        queuedMessage: null,
        configOptions: [],
        hasManagementPermissions: false,
      },
      {
        id: "agent-2",
        swarmId: "swarm-1",
        cli: "codex-acp",
        name: "Update tests",
        status: "idle",
        preview: "Tests updated...",
        updatedAt: "5m ago",
        messages: [],
        activeToolCalls: [],
        queuedMessage: null,
        configOptions: [],
        hasManagementPermissions: false,
      },
    ],
    ...overrides,
  };
}

const noop = () => {};

interface SidebarOverrides {
  swarms?: DisplaySwarm[];
  selectedAgentId?: string | null;
  demoMode?: boolean;
  daemonStatus?: "disconnected" | "connecting" | "connected" | "reconnecting";
  knownAgents?: { name: string; command: string; available: boolean }[];
  onSelectAgent?: (id: string) => void;
  onToggleSwarm?: (id: string) => void;
  onNewSwarm?: () => void;
  onAddAgent?: (swarmId: string, agentCommand: string) => void;
  onKillAgent?: (id: string) => void;
}

function renderSidebar(overrides: SidebarOverrides = {}) {
  return render(Sidebar, {
    props: {
      swarms: overrides.swarms ?? [makeSwarm()],
      selectedAgentId: overrides.selectedAgentId ?? null,
      demoMode: overrides.demoMode ?? true,
      daemonStatus: overrides.daemonStatus ?? "connected",
      knownAgents: overrides.knownAgents ?? [
        { name: "Claude Code", command: "claude-agent-acp", available: true },
        { name: "Codex", command: "codex-acp", available: true },
      ],
      onSelectAgent: overrides.onSelectAgent ?? noop,
      onToggleSwarm: overrides.onToggleSwarm ?? noop,
      onNewSwarm: overrides.onNewSwarm ?? noop,
      onAddAgent: overrides.onAddAgent ?? noop,
      onKillAgent: overrides.onKillAgent ?? noop,
    },
  });
}

describe("Sidebar", () => {
  it("renders swarm name", () => {
    renderSidebar();
    expect(screen.getByText("test-swarm")).toBeTruthy();
  });

  it("renders agent names", () => {
    renderSidebar();
    expect(screen.getByText("Fix navigation bug")).toBeTruthy();
    expect(screen.getByText("Update tests")).toBeTruthy();
  });

  it("renders agent timestamps", () => {
    renderSidebar();
    expect(screen.getByText("2m ago")).toBeTruthy();
    expect(screen.getByText("5m ago")).toBeTruthy();
  });

  it("hides agents when swarm is collapsed", () => {
    renderSidebar({ swarms: [makeSwarm({ collapsed: true })] });
    expect(screen.queryByText("Fix navigation bug")).toBeNull();
  });

  it("calls onSelectAgent when clicking an agent", async () => {
    const onSelectAgent = vi.fn();
    renderSidebar({ onSelectAgent });
    await fireEvent.click(screen.getByText("Fix navigation bug"));
    expect(onSelectAgent).toHaveBeenCalledWith("agent-1");
  });

  it("hides new-swarm button in demo mode", () => {
    renderSidebar({ demoMode: true });
    expect(screen.queryByText("New swarm")).toBeNull();
  });

  it("shows new-swarm button when not in demo mode", () => {
    renderSidebar({ demoMode: false });
    expect(screen.getByText("New swarm")).toBeTruthy();
  });

  it("renders app title", () => {
    renderSidebar({ swarms: [] });
    expect(screen.getByText("emergent")).toBeTruthy();
  });

  it("renders pulsing amber dot for initializing agent", () => {
    const swarm = makeSwarm({
      agents: [
        {
          id: "agent-init",
          swarmId: "swarm-1",
          cli: "claude-agent-acp",
          name: "Claude",
          status: "initializing",
          preview: "",
          updatedAt: "just now",
          messages: [],
          activeToolCalls: [],
          queuedMessage: null,
          configOptions: [],
          hasManagementPermissions: false,
        },
      ],
    });
    renderSidebar({ swarms: [swarm] });
    const dot = document.querySelector(".bg-warning.animate-pulse");
    expect(dot).toBeTruthy();
  });

  it("shows agent picker popover when clicking add button", async () => {
    renderSidebar({ demoMode: false });
    const addButton = screen.getByTitle("Add agent");
    await fireEvent.click(addButton);
    expect(screen.getByText("Add agent")).toBeTruthy();
    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
  });

  it("shows context menu on right-click of agent row", async () => {
    renderSidebar({ onKillAgent: vi.fn() });
    const agentRow = screen.getByText("Fix navigation bug").closest("button")!;
    await fireEvent.contextMenu(agentRow);
    expect(screen.getByText("Shutdown")).toBeTruthy();
  });

  it("calls onKillAgent when Shutdown is selected from context menu", async () => {
    const onKillAgent = vi.fn();
    renderSidebar({ onKillAgent });
    const agentRow = screen.getByText("Fix navigation bug").closest("button")!;
    await fireEvent.contextMenu(agentRow);
    await fireEvent.click(screen.getByText("Shutdown"));
    expect(onKillAgent).toHaveBeenCalledWith("agent-1");
  });
});
