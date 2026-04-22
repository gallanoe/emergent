import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ChatTaskBanner from "./ChatTaskBanner.svelte";
import type { DisplayTask } from "../../stores/types";

function makeTask(overrides?: Partial<DisplayTask>): DisplayTask {
  return {
    id: "TSK-041",
    title: "Fix quantization pipeline",
    description: "",
    status: "working",
    parent_id: null,
    blocker_ids: [],
    agent_id: "a1",
    session_id: "t1",
    workspace_id: "ws-1",
    created_at: "2026-04-21T16:20Z",
    ...overrides,
  };
}

describe("ChatTaskBanner", () => {
  it("renders task session label, id, and title", () => {
    const task = makeTask();
    render(ChatTaskBanner, { props: { task } });

    expect(screen.getByText("task session")).toBeTruthy();
    expect(screen.getByText("TSK-041")).toBeTruthy();
    expect(screen.getByText("Fix quantization pipeline")).toBeTruthy();
  });

  it("calls onOpen with task id when the banner is clicked", async () => {
    const task = makeTask();
    const onOpen = vi.fn();
    render(ChatTaskBanner, { props: { task, onOpen } });

    const btn = screen.getByRole("button", { name: /TSK-041/i });
    await fireEvent.click(btn);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("TSK-041");
  });
});
