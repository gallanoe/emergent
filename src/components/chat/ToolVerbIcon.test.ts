import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import ToolVerbIcon from "./ToolVerbIcon.svelte";
import type { ToolKind } from "../../stores/types";

const ALL_KINDS: ToolKind[] = [
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "other",
];

describe("ToolVerbIcon", () => {
  it("renders an <svg> for every supported kind", () => {
    for (const kind of ALL_KINDS) {
      const { container, unmount } = render(ToolVerbIcon, { props: { kind } });
      const svg = container.querySelector("svg");
      expect(svg, `no svg for kind=${kind}`).toBeTruthy();
      unmount();
    }
  });

  it("uses a distinct icon shape per kind (pair sample)", () => {
    const r1 = render(ToolVerbIcon, { props: { kind: "read" as ToolKind } });
    const r2 = render(ToolVerbIcon, { props: { kind: "execute" as ToolKind } });
    const s1 = r1.container.querySelector("svg")!.innerHTML;
    const s2 = r2.container.querySelector("svg")!.innerHTML;
    expect(s1).not.toEqual(s2);
  });

  it("applies the provided size to width/height", () => {
    const { container } = render(ToolVerbIcon, {
      props: { kind: "read" as ToolKind, size: 16 },
    });
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("16");
  });
});
