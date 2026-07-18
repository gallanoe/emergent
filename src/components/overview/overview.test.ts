import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import StatTile from "./StatTile.svelte";
import PipelineRow from "./PipelineRow.svelte";

describe("overview primitives", () => {
  it("StatTile renders label, value, and optional sub", () => {
    render(StatTile, {
      props: { label: "Active agents", value: 3, sub: "of 5 defined" },
    });
    expect(screen.getByText("Active agents")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("of 5 defined")).toBeTruthy();
  });

  it("PipelineRow renders label and count", () => {
    render(PipelineRow, {
      props: {
        label: "Working",
        count: 2,
        color: "var(--color-success)",
      },
    });
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });
});
