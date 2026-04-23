import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import ToolCallRow from "./ToolCallRow.svelte";
import type { DisplayToolCall } from "../../stores/types";

function makeToolCall(overrides: Partial<DisplayToolCall> = {}): DisplayToolCall {
  return {
    id: "tc1",
    name: "Read file.txt",
    kind: "read",
    status: "completed",
    locations: ["file.txt"],
    content: [],
    ...overrides,
  };
}

describe("ToolCallRow", () => {
  it("renders the verb label for the tool kind", () => {
    const { getByTestId } = render(ToolCallRow, {
      props: { toolCall: makeToolCall() },
    });
    expect(getByTestId("tool-verb").textContent?.trim()).toBe("Read");
  });

  it("applies em-shimmer-text to the verb while in_progress", () => {
    const { getByTestId } = render(ToolCallRow, {
      props: { toolCall: makeToolCall({ status: "in_progress" }) },
    });
    const verb = getByTestId("tool-verb");
    expect(verb.className).toContain("em-shimmer-text");
  });

  it("does not shimmer the verb when completed", () => {
    const { getByTestId } = render(ToolCallRow, {
      props: { toolCall: makeToolCall({ status: "completed" }) },
    });
    const verb = getByTestId("tool-verb");
    expect(verb.className).not.toContain("em-shimmer-text");
  });

  it("renders a verb icon svg at the start of the row", () => {
    const { container } = render(ToolCallRow, {
      props: { toolCall: makeToolCall({ kind: "execute" }) },
    });
    // ToolVerbIcon renders an <svg>; assert one exists in the row header
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
  });

  it("renders the status glyph for failed calls", () => {
    const { container } = render(ToolCallRow, {
      props: { toolCall: makeToolCall({ status: "failed", kind: "execute" }) },
    });
    // The failed glyph has aria-label="failed"
    expect(container.querySelector("[aria-label='failed']")).toBeTruthy();
  });
});
