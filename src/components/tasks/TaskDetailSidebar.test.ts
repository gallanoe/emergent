import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import TaskDetailSidebar from "./TaskDetailSidebar.svelte";
import type { DisplayTask } from "../../stores/types";

function task(overrides: Partial<DisplayTask> = {}): DisplayTask {
  return {
    id: "TSK-1",
    title: "Default title",
    description: "Default description",
    status: "pending",
    parent_id: null,
    blocker_ids: [],
    agent_id: "agent-1",
    session_id: null,
    workspace_id: "ws-1",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function setup(
  overrides: {
    task?: DisplayTask;
    allTasks?: Record<string, DisplayTask>;
    agentNames?: Record<string, string>;
  } = {},
) {
  const target = overrides.task ?? task();
  const onClose = vi.fn();
  const onSelectTask = vi.fn();
  const onNavigateToSession = vi.fn();
  const utils = render(TaskDetailSidebar, {
    props: {
      task: target,
      allTasks: overrides.allTasks ?? { [target.id]: target },
      agentNames: overrides.agentNames ?? { "agent-1": "Agent One" },
      onClose,
      onSelectTask,
      onNavigateToSession,
    },
  });
  return { ...utils, onClose, onSelectTask, onNavigateToSession };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("TaskDetailSidebar", () => {
  it("renders id, title, description, status and agent name", () => {
    const { getByText, getByTestId } = setup({
      task: task({ id: "TSK-42", title: "Fix lint", description: "Run oxlint" }),
    });
    expect(getByTestId("task-detail-sidebar")).toBeTruthy();
    expect(getByText("TSK-42")).toBeTruthy();
    expect(getByText("Fix lint")).toBeTruthy();
    expect(getByText("Run oxlint")).toBeTruthy();
    expect(getByText("Agent One")).toBeTruthy();
  });

  it("falls back to the raw agent id when no display name is known", () => {
    const { getByText } = setup({
      task: task({ agent_id: "agent-unknown" }),
      agentNames: {},
    });
    expect(getByText("agent-unknown")).toBeTruthy();
  });

  it("calls onClose when the header close button is clicked", async () => {
    const { getByTitle, onClose } = setup();
    await fireEvent.click(getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows 'Not started' when there is no session", () => {
    const { getByText } = setup();
    expect(getByText("Not started")).toBeTruthy();
  });

  it("renders the session id as a button that navigates to the session", async () => {
    const { getByRole, onNavigateToSession } = setup({
      task: task({ session_id: "thread-9" }),
    });
    await fireEvent.click(getByRole("button", { name: "thread-9" }));
    expect(onNavigateToSession).toHaveBeenCalledWith("thread-9");
  });

  it("shows a Blocked badge only while a blocker is incomplete", () => {
    const blocker = task({ id: "B-1", title: "Blocker", status: "working" });
    const target = task({ id: "T-1", blocker_ids: ["B-1"] });
    const { getByText, unmount } = setup({
      task: target,
      allTasks: { "T-1": target, "B-1": blocker },
    });
    expect(getByText("Blocked")).toBeTruthy();
    unmount();

    const done = { ...blocker, status: "completed" as const };
    const { queryByText } = setup({
      task: target,
      allTasks: { "T-1": target, "B-1": done },
    });
    expect(queryByText("Blocked")).toBeNull();
  });

  it("lists blocker tasks and selects one on click", async () => {
    const blocker = task({ id: "B-1", title: "Upstream work", status: "failed" });
    const target = task({ id: "T-1", blocker_ids: ["B-1", "MISSING"] });
    const { getByText, onSelectTask } = setup({
      task: target,
      allTasks: { "T-1": target, "B-1": blocker },
    });

    expect(getByText("Blocked by")).toBeTruthy();
    expect(getByText("Upstream work")).toBeTruthy();
    // Unresolvable blocker ids are filtered out rather than rendered.
    expect(getByText("failed")).toBeTruthy();

    await fireEvent.click(getByText("Upstream work"));
    expect(onSelectTask).toHaveBeenCalledWith("B-1");
  });

  it("lists child tasks and selects one on click", async () => {
    const target = task({ id: "P-1" });
    const child = task({ id: "C-1", title: "Subtask", parent_id: "P-1" });
    const unrelated = task({ id: "X-1", title: "Unrelated", parent_id: null });
    const { getByText, queryByText, onSelectTask } = setup({
      task: target,
      allTasks: { "P-1": target, "C-1": child, "X-1": unrelated },
    });

    expect(getByText("Child tasks")).toBeTruthy();
    expect(getByText("Subtask")).toBeTruthy();
    expect(queryByText("Unrelated")).toBeNull();

    await fireEvent.click(getByText("Subtask"));
    expect(onSelectTask).toHaveBeenCalledWith("C-1");
  });

  it("renders a parent row that selects the parent task", async () => {
    const parent = task({ id: "P-1", title: "Parent task" });
    const target = task({ id: "C-1", parent_id: "P-1" });
    const { getByText, onSelectTask } = setup({
      task: target,
      allTasks: { "C-1": target, "P-1": parent },
    });
    expect(getByText("Parent")).toBeTruthy();
    await fireEvent.click(getByText("Parent task"));
    expect(onSelectTask).toHaveBeenCalledWith("P-1");
  });

  it("falls back to the parent id when the parent task is not loaded", () => {
    const target = task({ id: "C-1", parent_id: "P-missing" });
    const { getAllByText } = setup({
      task: target,
      allTasks: { "C-1": target },
    });
    // Rendered twice: as the fallback label and as the mono id.
    expect(getAllByText("P-missing").length).toBe(2);
  });

  it("omits the blockers and children sections when there are none", () => {
    const { queryByText } = setup();
    expect(queryByText("Blocked by")).toBeNull();
    expect(queryByText("Child tasks")).toBeNull();
  });

  it.each([
    [30 * 1000, "just now"],
    [5 * 60 * 1000, "5m ago"],
    [3 * 60 * 60 * 1000, "3h ago"],
    [4 * 24 * 60 * 60 * 1000, "4d ago"],
  ])("formats an age of %ims as %s", (ageMs, expected) => {
    const now = new Date("2024-06-01T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const created = new Date(now.getTime() - (ageMs as number)).toISOString();
    const { getByText } = setup({ task: task({ created_at: created }) });
    expect(getByText(expected as string)).toBeTruthy();
  });

  it.each(["working", "pending", "completed", "failed"] as const)(
    "renders the %s status class on a blocker pill",
    (status) => {
      const blocker = task({ id: "B-1", title: "Blocker", status });
      const target = task({ id: "T-1", blocker_ids: ["B-1"] });
      const { getByText } = setup({
        task: target,
        allTasks: { "T-1": target, "B-1": blocker },
      });
      const pill = getByText(status, { selector: "span" });
      const cls = pill.getAttribute("class") ?? "";
      if (status === "working") expect(cls).toContain("text-success");
      else if (status === "failed") expect(cls).toContain("text-error");
      else expect(cls).toContain("text-fg-muted");
    },
  );
});
