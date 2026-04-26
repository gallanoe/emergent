import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import ToolStatusGlyph from "./ToolStatusGlyph.svelte";
import type { DisplayToolCall } from "../../stores/types";

type Status = DisplayToolCall["status"];
const STATUSES: Status[] = ["pending", "in_progress", "completed", "failed"];

describe("ToolStatusGlyph", () => {
  it("renders an svg for every status", () => {
    for (const status of STATUSES) {
      const { container, unmount } = render(ToolStatusGlyph, {
        props: { status },
      });
      expect(container.querySelector("svg"), `missing svg for ${status}`).toBeTruthy();
      unmount();
    }
  });

  it("applies em-tc-spin class to the running variant", () => {
    const { container } = render(ToolStatusGlyph, {
      props: { status: "in_progress" as Status },
    });
    expect(container.querySelector(".em-tc-spin")).toBeTruthy();
  });

  it("does NOT apply em-tc-spin to other states", () => {
    const { container } = render(ToolStatusGlyph, {
      props: { status: "completed" as Status },
    });
    expect(container.querySelector(".em-tc-spin")).toBeFalsy();
  });

  it("uses different colors per status", () => {
    const errRender = render(ToolStatusGlyph, {
      props: { status: "failed" as Status },
    });
    const okRender = render(ToolStatusGlyph, {
      props: { status: "completed" as Status },
    });
    const errColor = errRender.container.querySelector("svg")!.getAttribute("style") ?? "";
    const okColor = okRender.container.querySelector("svg")!.getAttribute("style") ?? "";
    expect(errColor).not.toEqual(okColor);
  });
});
