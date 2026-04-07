import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import SwarmView from "./SwarmView.svelte";
import type { DisplayWorkspace } from "../../stores/types";

function makeSwarm(overrides?: Partial<DisplayWorkspace>): DisplayWorkspace {
  return {
    id: "swarm-1",
    name: "Research Swarm",
    collapsed: false,
    containerStatus: { state: "running" },
    agentDefinitions: [],
    ...overrides,
  };
}

function renderSwarmView(overrides: Record<string, unknown> = {}) {
  return render(SwarmView, {
    props: {
      swarm: (overrides.swarm as DisplayWorkspace) ?? makeSwarm(),
      agentConnections: (overrides.agentConnections as Record<string, string[]>) ?? {},
      demoMode: false,
      onSelectAgent: (overrides.onSelectAgent as (id: string) => void) ?? (() => {}),
    },
  });
}

describe("SwarmView", () => {
  it("renders without crashing", () => {
    const { container } = renderSwarmView();
    expect(container).toBeTruthy();
  });
});
