import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import UpdateTaskToolRender from "./UpdateTaskToolRender.svelte";

describe("UpdateTaskToolRender", () => {
  it("renders the update description under a Update Task heading", () => {
    const { getByText } = render(UpdateTaskToolRender, {
      props: { input: { description: "Halfway through the migration." }, result: null },
    });
    expect(getByText("Update Task")).toBeTruthy();
    expect(getByText("Halfway through the migration.")).toBeTruthy();
  });

  it("shows a pending placeholder when the input has not arrived yet", () => {
    const { getByText } = render(UpdateTaskToolRender, {
      props: { input: null, result: null },
    });
    expect(getByText("Sending update…")).toBeTruthy();
  });

  it("preserves newlines in a multi-line description", () => {
    const { getByText } = render(UpdateTaskToolRender, {
      props: { input: { description: "line one\nline two" }, result: null },
    });
    const el = getByText(/line one/);
    expect(el.className).toContain("whitespace-pre-wrap");
    expect(el.textContent).toBe("line one\nline two");
  });

  it("appends the task id once the result lands", () => {
    const { getByText } = render(UpdateTaskToolRender, {
      props: {
        input: { description: "Done with step 2." },
        result: { task_id: "T-77", status: "working" },
      },
    });
    expect(getByText("T-77")).toBeTruthy();
  });

  it("shows no task id while the result is still pending", () => {
    const { container } = render(UpdateTaskToolRender, {
      props: { input: { description: "In progress." }, result: null },
    });
    expect(container.textContent).not.toContain("T-");
  });
});
