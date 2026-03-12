import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommandPalette } from "../../components/CommandPalette";
import { useCommandStore } from "../../stores/commands";

describe("CommandPalette", () => {
  beforeEach(() => {
    useCommandStore.setState({ commands: new Map(), paletteOpen: false });
  });

  afterEach(() => {
    cleanup();
  });

  it("does not render when paletteOpen is false", () => {
    render(<CommandPalette />);
    expect(screen.queryByPlaceholderText("Type a command...")).toBeNull();
  });

  it("renders when paletteOpen is true", () => {
    useCommandStore.setState({ paletteOpen: true });
    render(<CommandPalette />);
    expect(screen.getByPlaceholderText("Type a command...")).toBeDefined();
  });

  it("shows registered commands", () => {
    useCommandStore.getState().registerCommand({
      id: "test.cmd",
      label: "Test Command",
      execute: vi.fn(),
    });
    useCommandStore.setState({ paletteOpen: true });
    render(<CommandPalette />);
    expect(screen.getByText("Test Command")).toBeDefined();
  });

  it("filters commands by search input", () => {
    useCommandStore.getState().registerCommand({
      id: "file.create",
      label: "New File",
      execute: vi.fn(),
    });
    useCommandStore.getState().registerCommand({
      id: "sidebar.toggle",
      label: "Toggle Sidebar",
      execute: vi.fn(),
    });
    useCommandStore.setState({ paletteOpen: true });
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "toggle" } });
    expect(screen.getByText("Toggle Sidebar")).toBeDefined();
    expect(screen.queryByText("New File")).toBeNull();
  });

  it("executes command on Enter", () => {
    const execute = vi.fn();
    useCommandStore.getState().registerCommand({
      id: "test.cmd",
      label: "Test Command",
      execute,
    });
    useCommandStore.setState({ paletteOpen: true });
    render(<CommandPalette />);
    fireEvent.keyDown(screen.getByPlaceholderText("Type a command..."), { key: "Enter" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("closes on Escape", () => {
    useCommandStore.setState({ paletteOpen: true });
    render(<CommandPalette />);
    fireEvent.keyDown(screen.getByPlaceholderText("Type a command..."), { key: "Escape" });
    expect(useCommandStore.getState().paletteOpen).toBe(false);
  });

  it("closes on backdrop click", () => {
    useCommandStore.setState({ paletteOpen: true });
    render(<CommandPalette />);
    fireEvent.click(screen.getByTestId("palette-backdrop"));
    expect(useCommandStore.getState().paletteOpen).toBe(false);
  });

  it("navigates with arrow keys", () => {
    useCommandStore.getState().registerCommand({
      id: "a",
      label: "Alpha",
      execute: vi.fn(),
    });
    useCommandStore.getState().registerCommand({
      id: "b",
      label: "Beta",
      execute: vi.fn(),
    });
    useCommandStore.setState({ paletteOpen: true });
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText("Type a command...");

    // First item selected by default
    const firstItem = screen.getByText("Alpha").closest("[data-selected]");
    expect(firstItem?.getAttribute("data-selected")).toBe("true");

    // Arrow down selects second
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const secondItem = screen.getByText("Beta").closest("[data-selected]");
    expect(secondItem?.getAttribute("data-selected")).toBe("true");
  });

  it("shows shortcut hints", () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
    try {
      useCommandStore.getState().registerCommand({
        id: "sidebar.toggle",
        label: "Toggle Sidebar",
        shortcut: "Mod+B",
        execute: vi.fn(),
      });
      useCommandStore.setState({ paletteOpen: true });
      render(<CommandPalette />);
      expect(screen.getByText("⌘B")).toBeDefined();
    } finally {
      Object.defineProperty(navigator, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("executes command on row click", () => {
    const execute = vi.fn();
    useCommandStore.getState().registerCommand({
      id: "test.cmd",
      label: "Click Me",
      execute,
    });
    useCommandStore.setState({ paletteOpen: true });
    render(<CommandPalette />);
    fireEvent.click(screen.getByText("Click Me"));
    expect(execute).toHaveBeenCalledOnce();
    expect(useCommandStore.getState().paletteOpen).toBe(false);
  });

  it("shows empty state when no commands match", () => {
    useCommandStore.getState().registerCommand({
      id: "test.cmd",
      label: "Test Command",
      execute: vi.fn(),
    });
    useCommandStore.setState({ paletteOpen: true });
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "zzzzzzz" } });
    expect(screen.getByText("No matching commands")).toBeDefined();
  });

  it("restores focus to previously active element on close", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    useCommandStore.setState({ paletteOpen: true });
    render(<CommandPalette />);
    // Input should be focused
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Type a command..."));

    fireEvent.keyDown(screen.getByPlaceholderText("Type a command..."), { key: "Escape" });
    // Focus should return to the button
    expect(document.activeElement).toBe(button);
    document.body.removeChild(button);
  });
});
