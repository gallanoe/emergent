import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import ListAgentsToolRender from "./ListAgentsToolRender.svelte";

describe("ListAgentsToolRender", () => {
  it("shows an empty-state message when no agents are available", () => {
    const { getByText, container } = render(ListAgentsToolRender, { props: { agents: [] } });
    expect(getByText("No agents available")).toBeTruthy();
    expect(container.querySelectorAll("div.grid")).toHaveLength(0);
  });

  it("renders one row per agent, each labelled with its name", () => {
    const { container, getByText } = render(ListAgentsToolRender, {
      props: {
        agents: [
          { id: "a-1", name: "Scout" },
          { id: "a-2", name: "Pilot" },
        ],
      },
    });
    expect(container.querySelectorAll("div.grid")).toHaveLength(2);
    expect(getByText("Scout")).toBeTruthy();
    expect(getByText("Pilot")).toBeTruthy();
  });

  it("marks every listed agent as ready", () => {
    const { getAllByText } = render(ListAgentsToolRender, {
      props: {
        agents: [
          { id: "a-1", name: "Scout" },
          { id: "a-2", name: "Pilot" },
        ],
      },
    });
    expect(getAllByText("ready")).toHaveLength(2);
  });
});
