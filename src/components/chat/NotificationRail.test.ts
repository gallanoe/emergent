import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/svelte";
import NotificationRail from "./NotificationRail.svelte";

afterEach(() => cleanup());

describe("NotificationRail", () => {
  it("renders a pending task rail dashed + dimmed with the status and label", () => {
    render(NotificationRail, {
      props: {
        state: "pending",
        source: "task",
        label: "TSK-1",
        taskStatus: "completed",
        content: "done",
      },
    });
    const rail = screen.getByTestId("notification-rail");
    expect(rail.className).toContain("border-dashed");
    expect(rail.getAttribute("data-state")).toBe("pending");
    expect(screen.getByText("TSK-1")).toBeTruthy();
    expect(screen.getByText("done")).toBeTruthy();
  });

  it("renders a submitted thread rail solid with the sender name", () => {
    render(NotificationRail, {
      props: {
        state: "submitted",
        source: "thread",
        label: "Agent B",
        content: "ping",
      },
    });
    const rail = screen.getByTestId("notification-rail");
    expect(rail.className).toContain("border-solid");
    expect(rail.getAttribute("data-state")).toBe("submitted");
    expect(screen.getByText("Agent B")).toBeTruthy();
  });
});
