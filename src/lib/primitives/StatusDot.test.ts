import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import StatusDot from "./StatusDot.svelte";

const dotStatuses = [
  "idle",
  "working",
  "initializing",
  "building",
  "cancelling",
  "error",
  "dead",
  "stopped",
] as const;

const expectedVar: Record<(typeof dotStatuses)[number], string> = {
  idle: "var(--color-success)",
  working: "var(--color-success)",
  initializing: "var(--color-warning)",
  building: "var(--color-warning)",
  cancelling: "var(--color-warning)",
  error: "var(--color-error)",
  dead: "var(--color-fg-disabled)",
  stopped: "var(--color-fg-disabled)",
};

describe("StatusDot", () => {
  it.each(dotStatuses)("status %s uses expected color var", (status) => {
    const { container } = render(StatusDot, { props: { status } });
    const el = container.querySelector("span") as HTMLElement;
    expect(el.style.background).toBe(expectedVar[status]);
  });

  it("adds em-dot-pulse only for working, initializing, and building", () => {
    const { container: w } = render(StatusDot, { props: { status: "working" } });
    expect(w.querySelector("span")?.className).toContain("em-dot-pulse");

    const { container: i } = render(StatusDot, {
      props: { status: "initializing" },
    });
    expect(i.querySelector("span")?.className).toContain("em-dot-pulse");

    const { container: b } = render(StatusDot, { props: { status: "building" } });
    expect(b.querySelector("span")?.className).toContain("em-dot-pulse");

    const { container: idle } = render(StatusDot, { props: { status: "idle" } });
    expect(idle.querySelector("span")?.className).not.toContain("em-dot-pulse");

    const { container: cancelling } = render(StatusDot, {
      props: { status: "cancelling" },
    });
    expect(cancelling.querySelector("span")?.className).not.toContain("em-dot-pulse");
  });

  it("forwards size to width and height", () => {
    const { container } = render(StatusDot, { props: { size: 12 } });
    const el = container.querySelector("span") as HTMLElement;
    expect(el.style.width).toBe("12px");
    expect(el.style.height).toBe("12px");
  });
});
