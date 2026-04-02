import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import SwarmRail from "./SwarmRail.svelte";
import type { DisplayWorkspace } from "../../stores/types";

function makeSwarm(overrides?: Partial<DisplayWorkspace>): DisplayWorkspace {
  return {
    id: "swarm-1",
    name: "Research",
    collapsed: false,
    containerStatus: { state: "running" },
    agents: [],
    ...overrides,
  };
}

function renderRail(overrides: Record<string, unknown> = {}) {
  return render(SwarmRail, {
    props: {
      workspaces: [makeSwarm(), makeSwarm({ id: "swarm-2", name: "Dev" })],
      selectedWorkspaceId: "swarm-1",
      demoMode: false,
      onSelectWorkspace: (overrides.onSelectWorkspace as (id: string) => void) ?? (() => {}),
      onNewWorkspace: (overrides.onNewWorkspace as () => void) ?? (() => {}),
    },
  });
}

describe("SwarmRail", () => {
  it("renders workspace icons with first letter", () => {
    renderRail();
    expect(screen.getByText("R")).toBeTruthy();
    expect(screen.getByText("D")).toBeTruthy();
  });

  it("renders new workspace button", () => {
    renderRail();
    expect(screen.getByTitle("New workspace")).toBeTruthy();
  });

  it("calls onSelectWorkspace when icon clicked", async () => {
    const onSelectWorkspace = vi.fn();
    renderRail({ onSelectWorkspace });
    await fireEvent.click(screen.getByText("D"));
    expect(onSelectWorkspace).toHaveBeenCalledWith("swarm-2");
  });

  it("calls onNewWorkspace when plus clicked", async () => {
    const onNewWorkspace = vi.fn();
    renderRail({ onNewWorkspace });
    await fireEvent.click(screen.getByTitle("New workspace"));
    expect(onNewWorkspace).toHaveBeenCalledOnce();
  });

  it("renders theme toggle", () => {
    renderRail();
    expect(screen.getByTitle("Toggle theme")).toBeTruthy();
  });
});
