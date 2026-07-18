import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import ListTasksToolRender from "./ListTasksToolRender.svelte";
import type { DisplayTask } from "../../stores/types";

function makeTask(overrides: Partial<DisplayTask> = {}): DisplayTask {
  return {
    id: "T-1000",
    title: "Wire the MCP handler",
    description: "",
    status: "pending",
    parent_id: null,
    blocker_ids: [],
    agent_id: "agent-1",
    session_id: null,
    workspace_id: "ws-1",
    created_at: "2026-04-25T10:00:00Z",
    ...overrides,
  };
}

/** The glyph is the sole child of the first grid cell in a task row. */
function glyphFor(container: HTMLElement, index = 0): HTMLElement {
  const rows = container.querySelectorAll("div.grid");
  return rows[index]!.firstElementChild as HTMLElement;
}

describe("ListTasksToolRender", () => {
  it("shows an empty-state message when there are no tasks", () => {
    const { getByText, container } = render(ListTasksToolRender, { props: { tasks: [] } });
    expect(getByText("No tasks in this workspace")).toBeTruthy();
    expect(container.querySelectorAll("div.grid")).toHaveLength(0);
  });

  it("renders one row per task with its id and title", () => {
    const { container, getByText } = render(ListTasksToolRender, {
      props: {
        tasks: [makeTask({ id: "T-1", title: "First" }), makeTask({ id: "T-2", title: "Second" })],
      },
    });
    expect(container.querySelectorAll("div.grid")).toHaveLength(2);
    expect(getByText("First")).toBeTruthy();
    expect(getByText("Second")).toBeTruthy();
    expect(getByText("T-1")).toBeTruthy();
    expect(getByText("T-2")).toBeTruthy();
  });

  it("renders a hollow circle in fg-muted for a pending task", () => {
    const { container } = render(ListTasksToolRender, {
      props: { tasks: [makeTask({ status: "pending" })] },
    });
    const glyph = glyphFor(container);
    expect(glyph.textContent!.trim()).toBe("○");
    expect(glyph.getAttribute("style")).toContain("--color-fg-muted");
  });

  it("renders a filled circle in the success color for a working task", () => {
    const { container } = render(ListTasksToolRender, {
      props: { tasks: [makeTask({ status: "working" })] },
    });
    const glyph = glyphFor(container);
    expect(glyph.textContent!.trim()).toBe("●");
    expect(glyph.getAttribute("style")).toContain("--color-success");
  });

  it("renders a check in fg-disabled for a completed task", () => {
    const { container } = render(ListTasksToolRender, {
      props: { tasks: [makeTask({ status: "completed" })] },
    });
    const glyph = glyphFor(container);
    expect(glyph.textContent!.trim()).toBe("✓");
    expect(glyph.getAttribute("style")).toContain("--color-fg-disabled");
  });

  it("renders a slashed circle in the error color for a failed task", () => {
    const { container } = render(ListTasksToolRender, {
      props: { tasks: [makeTask({ status: "failed" })] },
    });
    const glyph = glyphFor(container);
    expect(glyph.textContent!.trim()).toBe("⊘");
    expect(glyph.getAttribute("style")).toContain("--color-error");
  });

  it("strikes through and mutes the title of a completed task only", () => {
    const { getByText } = render(ListTasksToolRender, {
      props: {
        tasks: [
          makeTask({ id: "T-done", title: "Done thing", status: "completed" }),
          makeTask({ id: "T-open", title: "Open thing", status: "working" }),
        ],
      },
    });
    const doneStyle = getByText("Done thing").getAttribute("style")!;
    expect(doneStyle).toContain("line-through");
    expect(doneStyle).toContain("--color-fg-muted");

    const openStyle = getByText("Open thing").getAttribute("style")!;
    expect(openStyle).toContain("none");
    expect(openStyle).toContain("--color-fg-default");
  });

  it("labels the assigned agent when a task has one", () => {
    const { getByText } = render(ListTasksToolRender, {
      props: { tasks: [makeTask({ agent_id: "scout-7" })] },
    });
    expect(getByText("agent scout-7")).toBeTruthy();
  });

  it("leaves the agent cell blank when the task has no agent", () => {
    const { container } = render(ListTasksToolRender, {
      props: { tasks: [makeTask({ agent_id: "" })] },
    });
    const row = container.querySelector("div.grid")!;
    expect(row.lastElementChild!.textContent!.trim()).toBe("");
    expect(container.textContent).not.toContain("agent ");
  });
});
