import { describe, it, expect, vi } from "vitest";
import { tick } from "svelte";
import { render, fireEvent } from "@testing-library/svelte";
import CreateTaskSidebar from "./CreateTaskSidebar.svelte";
import type { DisplayTask, AgentDefinition } from "../../stores/types";

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

const agentDefinitions: AgentDefinition[] = [
  { id: "agent-1", workspace_id: "ws-1", name: "Agent One", cli: "claude" },
  { id: "agent-2", workspace_id: "ws-1", name: "Agent Two", cli: "codex" },
];

const existingTasks: DisplayTask[] = [
  task({ id: "TSK-1", title: "First" }),
  task({ id: "TSK-2", title: "Second" }),
];

function setup(overrides: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  const onCreate = vi.fn();
  const utils = render(CreateTaskSidebar, {
    props: { agentDefinitions, existingTasks, onClose, onCreate, ...overrides },
  });
  return { ...utils, onClose, onCreate };
}

/** Fill title/description/agent so the form becomes submittable. */
async function fillValidForm(container: HTMLElement) {
  const titleInput = container.querySelector<HTMLInputElement>('input[placeholder="Task title"]')!;
  const desc = container.querySelector<HTMLTextAreaElement>("#task-desc")!;
  const agentSelect = container.querySelector<HTMLSelectElement>("#task-agent")!;
  await fireEvent.input(titleInput, { target: { value: "  Ship it  " } });
  await fireEvent.input(desc, { target: { value: "  Do the thing  " } });
  await fireEvent.change(agentSelect, { target: { value: "agent-2" } });
  return { titleInput, desc, agentSelect };
}

describe("CreateTaskSidebar", () => {
  it("renders the form fields and agent options", () => {
    const { container, getByText } = setup();
    expect(getByText("New Task")).toBeTruthy();
    expect(getByText("Title")).toBeTruthy();
    expect(getByText("Description")).toBeTruthy();

    const agentSelect = container.querySelector<HTMLSelectElement>("#task-agent")!;
    const optionLabels = [...agentSelect.options].map((o) => o.textContent?.trim());
    expect(optionLabels).toEqual(["Select agent...", "Agent One", "Agent Two"]);

    const blockerSelect = container.querySelector<HTMLSelectElement>("#task-blockers")!;
    expect([...blockerSelect.options].map((o) => o.value)).toEqual(["", "TSK-1", "TSK-2"]);
  });

  it("disables Create until title, description and agent are all set", async () => {
    const { container, getByRole } = setup();
    const create = getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    const titleInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Task title"]',
    )!;
    await fireEvent.input(titleInput, { target: { value: "Ship it" } });
    await tick();
    expect(create.disabled).toBe(true);

    const desc = container.querySelector<HTMLTextAreaElement>("#task-desc")!;
    await fireEvent.input(desc, { target: { value: "Details" } });
    await tick();
    // Still no agent selected.
    expect(create.disabled).toBe(true);

    const agentSelect = container.querySelector<HTMLSelectElement>("#task-agent")!;
    await fireEvent.change(agentSelect, { target: { value: "agent-1" } });
    await tick();
    expect(create.disabled).toBe(false);
  });

  it("treats whitespace-only title as invalid", async () => {
    const { container, getByRole } = setup();
    const titleInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Task title"]',
    )!;
    const desc = container.querySelector<HTMLTextAreaElement>("#task-desc")!;
    const agentSelect = container.querySelector<HTMLSelectElement>("#task-agent")!;
    await fireEvent.input(titleInput, { target: { value: "   " } });
    await fireEvent.input(desc, { target: { value: "Details" } });
    await fireEvent.change(agentSelect, { target: { value: "agent-1" } });
    await tick();
    expect((getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("submits trimmed values with the selected agent and blockers", async () => {
    const { container, getByRole, onCreate } = setup();
    await fillValidForm(container);

    const blockerSelect = container.querySelector<HTMLSelectElement>("#task-blockers")!;
    await fireEvent.change(blockerSelect, { target: { value: "TSK-1" } });
    await tick();

    await fireEvent.click(getByRole("button", { name: "Create" }));
    expect(onCreate).toHaveBeenCalledWith("Ship it", "Do the thing", "agent-2", ["TSK-1"]);
  });

  it("adds a blocker chip and removes duplicates from the blocker select", async () => {
    const { container, getByText } = setup();
    const blockerSelect = container.querySelector<HTMLSelectElement>("#task-blockers")!;

    await fireEvent.change(blockerSelect, { target: { value: "TSK-2" } });
    await tick();

    // Chip shows the blocker's title and truncated id.
    expect(getByText("Second", { exact: false })).toBeTruthy();
    // Selected blocker is no longer offered in the dropdown, and the select resets.
    expect([...blockerSelect.options].map((o) => o.value)).toEqual(["", "TSK-1"]);
    expect(blockerSelect.value).toBe("");
  });

  it("ignores selecting an already-added blocker", async () => {
    const { container } = setup();
    const blockerSelect = container.querySelector<HTMLSelectElement>("#task-blockers")!;
    await fireEvent.change(blockerSelect, { target: { value: "TSK-1" } });
    await tick();
    // Re-adding the same id via a synthetic change must not duplicate the chip.
    blockerSelect.innerHTML = '<option value="TSK-1">dup</option>';
    await fireEvent.change(blockerSelect, { target: { value: "TSK-1" } });
    await tick();

    const chips = container.querySelectorAll("span.inline-flex.items-center.gap-1");
    const chipTexts = [...chips].map((c) => c.textContent?.trim());
    expect(chipTexts.filter((t) => t?.includes("First")).length).toBe(1);
  });

  it("removes a blocker chip when its X is clicked", async () => {
    const { container, queryByText } = setup();
    const blockerSelect = container.querySelector<HTMLSelectElement>("#task-blockers")!;
    await fireEvent.change(blockerSelect, { target: { value: "TSK-1" } });
    await tick();
    expect(queryByText("First", { exact: false })).toBeTruthy();

    // The chip's remove button is the only bare <button> inside the chip row.
    const removeBtn = container.querySelector<HTMLButtonElement>("button.ml-0\\.5")!;
    await fireEvent.click(removeBtn);
    await tick();

    expect([...blockerSelect.options].map((o) => o.value)).toEqual(["", "TSK-1", "TSK-2"]);
  });

  it("truncates the blocker id shown on the chip to 8 characters", async () => {
    const { container } = setup({
      existingTasks: [task({ id: "0123456789abcdef", title: "Long id task" })],
    });
    const blockerSelect = container.querySelector<HTMLSelectElement>("#task-blockers")!;
    await fireEvent.change(blockerSelect, { target: { value: "0123456789abcdef" } });
    await tick();

    const chip = container.querySelector("span.inline-flex.items-center.gap-1") as HTMLElement;
    expect(chip.textContent).toContain("Long id task");
    expect(chip.textContent).toContain("01234567");
    expect(chip.textContent).not.toContain("89abcdef");
  });

  it("shows a pending label and blocks re-submit while onCreate is in flight", async () => {
    let resolve!: () => void;
    const onCreate = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const { container, getByRole } = setup({ onCreate });
    await fillValidForm(container);
    await tick();

    await fireEvent.click(getByRole("button", { name: "Create" }));
    await tick();

    const pending = getByRole("button", { name: "Creating…" }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);

    // A second click while submitting must not re-invoke onCreate.
    await fireEvent.click(pending);
    expect(onCreate).toHaveBeenCalledTimes(1);

    resolve();
    await tick();
    await tick();
    expect((getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls onClose from both the header X and the Cancel button", async () => {
    const { getByRole, getByTitle, onClose } = setup();
    await fireEvent.click(getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await fireEvent.click(getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  describe("when onCreate rejects", () => {
    /** The parent leaves the sidebar mounted on failure, so the form persists. */
    async function submitFailing(rejection: unknown) {
      const onCreate = vi.fn(() => Promise.reject(rejection));
      const utils = setup({ onCreate });
      await fillValidForm(utils.container);
      await fireEvent.click(utils.getByRole("button", { name: "Create" }));
      await tick();
      await tick();
      return { ...utils, onCreate };
    }

    it("surfaces the failure instead of silently doing nothing", async () => {
      const { getByRole } = await submitFailing(new Error("workspace is gone"));
      const alert = getByRole("alert");
      expect(alert.textContent).toContain("Could not create the task");
      expect(alert.textContent).toContain("workspace is gone");
    });

    it("stringifies a non-Error rejection", async () => {
      const { getByRole } = await submitFailing("create_task failed");
      expect(getByRole("alert").textContent).toContain("create_task failed");
    });

    it("re-enables Create and keeps the entered values so the user can retry", async () => {
      const { getByRole, container } = await submitFailing(new Error("boom"));
      expect((getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(false);
      expect(
        container.querySelector<HTMLInputElement>('input[placeholder="Task title"]')!.value,
      ).toBe("  Ship it  ");
    });

    it("clears a previous error when the next attempt succeeds", async () => {
      const onCreate = vi
        .fn()
        .mockImplementationOnce(() => Promise.reject(new Error("transient")))
        .mockImplementationOnce(() => Promise.resolve());
      const { container, getByRole, queryByRole } = setup({ onCreate });
      await fillValidForm(container);

      await fireEvent.click(getByRole("button", { name: "Create" }));
      await tick();
      await tick();
      expect(queryByRole("alert")).not.toBeNull();

      await fireEvent.click(getByRole("button", { name: "Create" }));
      await tick();
      await tick();
      expect(queryByRole("alert")).toBeNull();
      expect(onCreate).toHaveBeenCalledTimes(2);
    });
  });
});
