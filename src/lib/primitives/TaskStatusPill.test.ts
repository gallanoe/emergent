import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import TaskStatusPill from "./TaskStatusPill.svelte";

const statuses = ["working", "pending", "completed", "failed"] as const;

const expectedLabel: Record<(typeof statuses)[number], string> = {
  working: "Working",
  pending: "Pending",
  completed: "Done",
  failed: "Failed",
};

describe("TaskStatusPill", () => {
  it.each(statuses)("status %s shows the correct label", (status) => {
    const { getByText } = render(TaskStatusPill, { props: { status } });
    expect(getByText(expectedLabel[status])).toBeTruthy();
  });

  it("completed shows a check icon instead of StatusDot", () => {
    const { container } = render(TaskStatusPill, { props: { status: "completed" } });
    expect(container.querySelector("svg")).toBeTruthy();
    const dots = container.querySelectorAll("span.relative.inline-block.rounded-full");
    expect(dots.length).toBe(0);
  });

  it.each(["working", "pending", "failed"] as const)(
    "status %s renders StatusDot, not svg check",
    (status) => {
      const { container } = render(TaskStatusPill, { props: { status } });
      expect(container.querySelector("svg")).toBeNull();
      const dot = container.querySelector("span.relative.inline-block.rounded-full");
      expect(dot).toBeTruthy();
    },
  );
});
