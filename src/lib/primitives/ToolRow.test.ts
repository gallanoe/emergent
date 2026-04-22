import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import ToolRow from "./ToolRow.svelte";

describe("ToolRow", () => {
  it("renders name, args, and status label", () => {
    render(ToolRow, {
      props: {
        name: "read_file",
        args: "src/quantize.rs",
        status: "completed",
        statusLabel: "2.1s",
      },
    });

    expect(screen.getByText("read_file")).toBeTruthy();
    expect(screen.getByText("(src/quantize.rs)")).toBeTruthy();
    expect(screen.getByText("2.1s")).toBeTruthy();
  });

  it("uses StatusDot for running and an svg check for completed", () => {
    const { container: runningC } = render(ToolRow, {
      props: { name: "grep", status: "running" },
    });
    expect(runningC.querySelector(".em-dot-pulse")).toBeTruthy();
    expect(runningC.querySelector('svg[viewBox="0 0 16 16"]')).toBeFalsy();

    const { container: doneC } = render(ToolRow, {
      props: { name: "grep", status: "completed" },
    });
    const svg = doneC.querySelector('svg[viewBox="0 0 16 16"]');
    expect(svg).toBeTruthy();
    expect(svg?.querySelector("path")?.getAttribute("d")).toContain("M3 8");
  });

  it("applies status-specific icon colors", () => {
    const { container: ok } = render(ToolRow, {
      props: { name: "x", status: "completed" },
    });
    const okSvg = ok.querySelector("svg");
    expect(okSvg?.getAttribute("class") ?? "").toContain("text-fg-muted");

    const { container: err } = render(ToolRow, {
      props: { name: "x", status: "error" },
    });
    const errSvg = err.querySelector("svg");
    expect(errSvg?.getAttribute("class") ?? "").toContain("color-error");
  });
});
