import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import CreateWorkspaceDialog from "./CreateWorkspaceDialog.svelte";

describe("CreateWorkspaceDialog", () => {
  it("renders title and workspace name field", () => {
    render(CreateWorkspaceDialog, {
      props: { onConfirm: vi.fn(), onCancel: vi.fn() },
    });
    expect(screen.getByText("Create Workspace")).toBeTruthy();
    expect(screen.getByPlaceholderText("my-project")).toBeTruthy();
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    render(CreateWorkspaceDialog, {
      props: { onConfirm: vi.fn(), onCancel },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onConfirm with trimmed name when Create is clicked", async () => {
    const onConfirm = vi.fn();
    render(CreateWorkspaceDialog, {
      props: { onConfirm, onCancel: vi.fn() },
    });
    const input = screen.getByPlaceholderText("my-project");
    await fireEvent.input(input, { target: { value: "  my-space  " } });
    await fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onConfirm).toHaveBeenCalledWith("my-space");
  });

  it("disables Create when name is empty", () => {
    render(CreateWorkspaceDialog, {
      props: { onConfirm: vi.fn(), onCancel: vi.fn() },
    });
    const create = screen.getByRole("button", {
      name: "Create",
    }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
  });
});
