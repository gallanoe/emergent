import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ContextMenu from "./ContextMenu.svelte";
import type { MenuItem } from "../stores/types";

function renderMenu(
  overrides: Partial<{
    x: number;
    y: number;
    items: MenuItem[];
    onSelect: (id: string) => void;
    onClose: () => void;
  }> = {},
) {
  return render(ContextMenu, {
    props: {
      x: overrides.x ?? 100,
      y: overrides.y ?? 200,
      items: overrides.items ?? [
        { id: "rename", label: "Rename" },
        { id: "sep", label: "", separator: true },
        { id: "shutdown", label: "Shutdown", danger: true, shortcut: "⌫" },
      ],
      onSelect: overrides.onSelect ?? (() => {}),
      onClose: overrides.onClose ?? (() => {}),
    },
  });
}

describe("ContextMenu", () => {
  it("renders menu items", () => {
    renderMenu();
    expect(screen.getByText("Rename")).toBeTruthy();
    expect(screen.getByText("Shutdown")).toBeTruthy();
  });

  it("renders keyboard shortcut", () => {
    renderMenu();
    expect(screen.getByText("⌫")).toBeTruthy();
  });

  it("calls onSelect with item id when clicked", async () => {
    const onSelect = vi.fn();
    renderMenu({ onSelect });
    await fireEvent.click(screen.getByText("Shutdown"));
    expect(onSelect).toHaveBeenCalledWith("shutdown");
  });

  it("does not call onSelect for disabled items", async () => {
    const onSelect = vi.fn();
    renderMenu({
      onSelect,
      items: [{ id: "rename", label: "Rename", disabled: true }],
    });
    await fireEvent.click(screen.getByText("Rename"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    renderMenu({ onClose });
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when clicking outside", async () => {
    const onClose = vi.fn();
    renderMenu({ onClose });
    await fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
