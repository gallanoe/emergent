import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ConfirmDialog from "./ConfirmDialog.svelte";

function renderDialog(
  overrides: Partial<{
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    confirmVariant: "primary" | "danger";
    onConfirm: () => void;
    onCancel: () => void;
  }> = {},
) {
  return render(ConfirmDialog, {
    props: {
      title: overrides.title ?? "Delete item?",
      description: overrides.description ?? "This cannot be undone.",
      confirmLabel: overrides.confirmLabel ?? "Delete",
      cancelLabel: overrides.cancelLabel ?? "Cancel",
      confirmVariant: overrides.confirmVariant ?? "primary",
      onConfirm: overrides.onConfirm ?? (() => {}),
      onCancel: overrides.onCancel ?? (() => {}),
    },
  });
}

describe("ConfirmDialog", () => {
  it("renders title and description", () => {
    renderDialog();
    expect(screen.getByText("Delete item?")).toBeTruthy();
    expect(screen.getByText("This cannot be undone.")).toBeTruthy();
  });

  it("renders custom confirm label", () => {
    renderDialog({ confirmLabel: "Remove" });
    expect(screen.getByText("Remove")).toBeTruthy();
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });
    await fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onConfirm when confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });
    await fireEvent.click(screen.getByText("Delete"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when Escape is pressed", async () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onConfirm when Enter is pressed", async () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });
    await fireEvent.keyDown(window, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when overlay is clicked", async () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });
    const overlay = document.querySelector("[data-testid='confirm-overlay']");
    expect(overlay).toBeTruthy();
    await fireEvent.click(overlay!);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders danger confirm button when confirmVariant is danger", () => {
    renderDialog({ confirmVariant: "danger", confirmLabel: "Delete" });
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn.className).toContain("text-error");
  });
});
