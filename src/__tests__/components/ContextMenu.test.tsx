import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ContextMenu, type MenuItem } from "../../components/ContextMenu";

describe("ContextMenu", () => {
  const onClose = vi.fn();
  const onAction = vi.fn();

  const items: MenuItem[] = [
    { label: "New File", action: "new-file" },
    { label: "New Folder", action: "new-folder" },
    { type: "separator" },
    { label: "Rename", action: "rename" },
    { label: "Delete", action: "delete" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders menu items", () => {
    render(<ContextMenu x={100} y={100} items={items} onAction={onAction} onClose={onClose} />);
    expect(screen.getByText("New File")).toBeDefined();
    expect(screen.getByText("Rename")).toBeDefined();
    expect(screen.getByText("Delete")).toBeDefined();
  });

  it("calls onAction and onClose when item is clicked", () => {
    render(<ContextMenu x={100} y={100} items={items} onAction={onAction} onClose={onClose} />);
    fireEvent.click(screen.getByText("Rename"));
    expect(onAction).toHaveBeenCalledWith("rename");
    expect(onClose).toHaveBeenCalled();
  });

  it("dismisses on Escape", () => {
    render(<ContextMenu x={100} y={100} items={items} onAction={onAction} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("navigates items with arrow keys", () => {
    render(<ContextMenu x={100} y={100} items={items} onAction={onAction} onClose={onClose} />);
    const menu = screen.getByRole("menu");

    // First actionable item is focused by default
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(onAction).toHaveBeenCalledWith("new-folder");
  });

  it("activates item with Enter", () => {
    render(<ContextMenu x={100} y={100} items={items} onAction={onAction} onClose={onClose} />);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(onAction).toHaveBeenCalledWith("new-file");
    expect(onClose).toHaveBeenCalled();
  });

  it("dismisses on click outside", () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <ContextMenu x={100} y={100} items={items} onAction={onAction} onClose={onClose} />
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalled();
  });
});
