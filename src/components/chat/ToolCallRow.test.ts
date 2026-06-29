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
  it("renders the canonical tool name from the title", () => {
    const { getByTestId } = render(ToolCallRow, {
      props: { toolCall: makeToolCall() },
    });
    expect(getByTestId("tool-name").textContent?.trim()).toBe("Read");
  });

  it("surfaces a canonical name distinct from the coarse kind", () => {
    // ACP reports Write under kind `edit`; the chip recovers "Write" from the
    // title rather than collapsing it to the kind label "Edit".
    const { getByTestId } = render(ToolCallRow, {
      props: { toolCall: makeToolCall({ name: "Write file", kind: "edit" }) },
    });
    expect(getByTestId("tool-name").textContent?.trim()).toBe("Write");
  });

  it("renders emergent MCP tools in Title Case", () => {
    const { getByTestId } = render(ToolCallRow, {
      props: { toolCall: makeToolCall({ name: "list_agents", kind: "other" }) },
    });
    expect(getByTestId("tool-name").textContent?.trim()).toBe("List Agents");
  });

  it("applies em-shimmer-text to the name while in_progress", () => {
    const { getByTestId } = render(ToolCallRow, {
      props: { toolCall: makeToolCall({ status: "in_progress" }) },
    });
    const nameEl = getByTestId("tool-name");
    expect(nameEl.className).toContain("em-shimmer-text");
  });

  it("does not shimmer the name when completed", () => {
    const { getByTestId } = render(ToolCallRow, {
      props: { toolCall: makeToolCall({ status: "completed" }) },
    });
    const nameEl = getByTestId("tool-name");
    expect(nameEl.className).not.toContain("em-shimmer-text");
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
