import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import StatTile from "./StatTile.svelte";
import MiniMetric from "./MiniMetric.svelte";
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

  it("MiniMetric renders label and value", () => {
    render(MiniMetric, {
      props: {
        label: "CPU",
        value: "14%",
        series: [2, 4, 6, 8],
      },
    });
    expect(screen.getByText("CPU")).toBeTruthy();
    expect(screen.getByText("14%")).toBeTruthy();
  });

  it("MiniMetric scales bar heights to the max in series", () => {
    const { container } = render(MiniMetric, {
      props: {
        label: "Net",
        value: "1x",
        series: [1, 2, 3, 4],
      },
    });
    const bars = container.querySelectorAll("[data-testid='mini-metric-bars'] .mini-bar");
    expect(bars.length).toBe(4);
    const h0 = (bars[0] as HTMLElement).style.height;
    const h3 = (bars[3] as HTMLElement).style.height;
    expect(parseFloat(h0)).toBeLessThan(parseFloat(h3));
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
