import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import CreateTaskToolRender from "./CreateTaskToolRender.svelte";
import type { CreateTaskToolInput, CreateTaskToolResult } from "../../lib/emergent-tool-calls";

function makeInput(overrides: Partial<CreateTaskToolInput> = {}): CreateTaskToolInput {
  return {
    title: "Wire the MCP handler",
    description: "Add the create_task branch and persist it.",
    agent_id: "agent-scout",
    ...overrides,
  };
}

function setup(input: CreateTaskToolInput | null, result: CreateTaskToolResult | null = null) {
  return render(CreateTaskToolRender, { props: { input, result } });
}

describe("CreateTaskToolRender", () => {
  it("renders the title, description, and agent id from the input", () => {
    const { getByText } = setup(makeInput());
    expect(getByText("Create Task")).toBeTruthy();
    expect(getByText("Wire the MCP handler")).toBeTruthy();
    expect(getByText("Add the create_task branch and persist it.")).toBeTruthy();
    expect(getByText("agent-scout")).toBeTruthy();
  });

  it("falls back to placeholders when the input has not arrived yet", () => {
    const { getByText } = setup(null);
    expect(getByText("Untitled task")).toBeTruthy();
    expect(getByText("unknown-agent")).toBeTruthy();
  });

  it("omits the description block when the description is empty", () => {
    const { container } = setup(makeInput({ description: "" }));
    expect(container.textContent).not.toContain("Add the create_task branch");
    // The title still renders, so the component is not blank.
    expect(container.textContent).toContain("Wire the MCP handler");
  });

  it("uses the singular noun for exactly one blocker", () => {
    const { getByText } = setup(makeInput({ blocker_ids: ["T-1"] }));
    expect(getByText("1 blocker")).toBeTruthy();
  });

  it("uses the plural noun for more than one blocker", () => {
    const { getByText } = setup(makeInput({ blocker_ids: ["T-1", "T-2", "T-3"] }));
    expect(getByText("3 blockers")).toBeTruthy();
  });

  it("hides the blocker count when blocker_ids is empty or absent", () => {
    expect(setup(makeInput({ blocker_ids: [] })).container.textContent).not.toContain("blocker");
    expect(setup(makeInput()).container.textContent).not.toContain("blocker");
  });

  it("shows the created task id once the result lands", () => {
    const { getByText } = setup(makeInput(), { task_id: "T-4242" });
    expect(getByText(/Created\s+T-4242/)).toBeTruthy();
  });

  it("shows no created-id line while the result is still pending", () => {
    const { container } = setup(makeInput(), null);
    expect(container.textContent).not.toContain("Created");
  });
});
