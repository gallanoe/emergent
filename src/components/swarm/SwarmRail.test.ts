import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import SwarmRail from "./SwarmRail.svelte";
import type { DisplaySwarm } from "../../stores/types";

function makeSwarm(overrides?: Partial<DisplaySwarm>): DisplaySwarm {
  return {
    id: "swarm-1",
    name: "Research",
    collapsed: false,
    agents: [],
    ...overrides,
  };
}

function renderRail(overrides: Record<string, unknown> = {}) {
  return render(SwarmRail, {
    props: {
      swarms: [makeSwarm(), makeSwarm({ id: "swarm-2", name: "Dev" })],
      selectedSwarmId: "swarm-1",
      demoMode: false,
      onSelectSwarm: (overrides.onSelectSwarm as (id: string) => void) ?? (() => {}),
      onNewSwarm: (overrides.onNewSwarm as () => void) ?? (() => {}),
    },
  });
}

describe("SwarmRail", () => {
  it("renders swarm icons with first letter", () => {
    renderRail();
    expect(screen.getByText("R")).toBeTruthy();
    expect(screen.getByText("D")).toBeTruthy();
  });

  it("renders new swarm button", () => {
    renderRail();
    expect(screen.getByTitle("New swarm")).toBeTruthy();
  });

  it("calls onSelectSwarm when icon clicked", async () => {
    const onSelectSwarm = vi.fn();
    renderRail({ onSelectSwarm });
    await fireEvent.click(screen.getByText("D"));
    expect(onSelectSwarm).toHaveBeenCalledWith("swarm-2");
  });

  it("calls onNewSwarm when plus clicked", async () => {
    const onNewSwarm = vi.fn();
    renderRail({ onNewSwarm });
    await fireEvent.click(screen.getByTitle("New swarm"));
    expect(onNewSwarm).toHaveBeenCalledOnce();
  });

  it("renders theme toggle", () => {
    renderRail();
    expect(screen.getByTitle("Toggle theme")).toBeTruthy();
  });
});
