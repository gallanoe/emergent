import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import TaskTableView from "./TaskTableView.svelte";
import type { DisplayTask } from "../../stores/types";

function task(overrides: Partial<DisplayTask> = {}): DisplayTask {
  return {
    id: "t-default",
    title: "Default title",
    description: "",
    status: "pending",
    parent_id: null,
    blocker_ids: [],
    agent_id: "agent-1",
    session_id: null,
    workspace_id: "ws-1",
    created_at: "2024-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("TaskTableView", () => {
  it("sorts by status group then id ascending", () => {
    const tasks: DisplayTask[] = [
      task({ id: "z-pend", status: "pending", title: "Z" }),
      task({ id: "a-pend", status: "pending", title: "A" }),
      task({ id: "m-work", status: "working", title: "M" }),
    ];
    const { container } = render(TaskTableView, {
      props: {
        tasks,
        selectedTaskId: null,
        agentNames: { "agent-1": "Agent One" },
        containerRunning: true,
        onSelectTask: vi.fn(),
        onCreateTask: vi.fn(),
      },
    });
    const rowButtons = container.querySelectorAll('button[aria-label^="Task "]');
    expect(rowButtons.length).toBe(3);
    const ids = [...rowButtons].map((btn) => {
      const m = btn.getAttribute("aria-label")?.match(/^Task ([^:]+):/);
      return m?.[1];
    });
    expect(ids).toEqual(["m-work", "a-pend", "z-pend"]);
  });

  it("filter chip click limits visible task rows", async () => {
    const tasks: DisplayTask[] = [
      task({ id: "w1", status: "working", title: "W" }),
      task({ id: "p1", status: "pending", title: "P" }),
    ];
    const { getByRole, container } = render(TaskTableView, {
      props: {
        tasks,
        selectedTaskId: null,
        agentNames: {},
        containerRunning: true,
        onSelectTask: vi.fn(),
        onCreateTask: vi.fn(),
      },
    });
    const workingChip = getByRole("button", { name: /working/i });
    await fireEvent.click(workingChip);
    const rows = container.querySelectorAll('button[aria-label^="Task "]');
    expect(rows.length).toBe(1);
    expect(rows[0]?.getAttribute("aria-label")).toContain("w1");
  });

  it("disables New task when container is not running", () => {
    const { getByRole } = render(TaskTableView, {
      props: {
        tasks: [task({ id: "t1" })],
        selectedTaskId: null,
        agentNames: {},
        containerRunning: false,
        onSelectTask: vi.fn(),
        onCreateTask: vi.fn(),
      },
    });
    const newTask = getByRole("button", { name: /new task/i });
    expect((newTask as HTMLButtonElement).disabled).toBe(true);
  });

  it("row button aria-label includes task id and title", () => {
    const { getByRole } = render(TaskTableView, {
      props: {
        tasks: [task({ id: "TSK-7", title: "Fix lint" })],
        selectedTaskId: null,
        agentNames: {},
        containerRunning: true,
        onSelectTask: vi.fn(),
        onCreateTask: vi.fn(),
      },
    });
    expect(getByRole("button", { name: "Task TSK-7: Fix lint" })).toBeTruthy();
  });
});
