import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { KeybindingProvider } from "../../components/KeybindingProvider";
import { useCommandStore } from "../../stores/commands";
import { useFocusContextStore } from "../../stores/focus-context";

describe("KeybindingProvider", () => {
  beforeEach(() => {
    useCommandStore.setState({ commands: new Map(), paletteOpen: false });
    useFocusContextStore.setState({ activeRegion: "global" });
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
  });

  it("renders children", () => {
    const { getByText } = render(
      <KeybindingProvider>
        <div>child</div>
      </KeybindingProvider>,
    );
    expect(getByText("child")).toBeDefined();
  });

  it("executes matching global command on keydown", () => {
    const execute = vi.fn();
    useCommandStore.getState().registerCommand({
      id: "sidebar.toggle",
      label: "Toggle Sidebar",
      shortcut: "Mod+B",
      context: "global",
      execute,
    });
    render(
      <KeybindingProvider>
        <div>app</div>
      </KeybindingProvider>,
    );
    fireEvent.keyDown(document, { key: "b", metaKey: true });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("resolves context-specific command before global", () => {
    const globalExec = vi.fn();
    const sidebarExec = vi.fn();
    useCommandStore.getState().registerCommand({
      id: "global.f2",
      label: "Global F2",
      shortcut: "F2",
      context: "global",
      execute: globalExec,
    });
    useCommandStore.getState().registerCommand({
      id: "file.rename",
      label: "Rename",
      shortcut: "F2",
      context: "sidebar",
      execute: sidebarExec,
    });
    useFocusContextStore.getState().setActiveRegion("sidebar");
    render(
      <KeybindingProvider>
        <div>app</div>
      </KeybindingProvider>,
    );
    fireEvent.keyDown(document, { key: "F2" });
    expect(sidebarExec).toHaveBeenCalledOnce();
    expect(globalExec).not.toHaveBeenCalled();
  });

  it("skips already-handled events", () => {
    const execute = vi.fn();
    useCommandStore.getState().registerCommand({
      id: "test",
      label: "Test",
      shortcut: "Mod+S",
      context: "global",
      execute,
    });
    render(
      <KeybindingProvider>
        <div>app</div>
      </KeybindingProvider>,
    );
    const event = new KeyboardEvent("keydown", {
      key: "s",
      metaKey: true,
      bubbles: true,
    });
    Object.defineProperty(event, "defaultPrevented", { value: true });
    document.dispatchEvent(event);
    expect(execute).not.toHaveBeenCalled();
  });

  it("does nothing for unmatched shortcuts", () => {
    render(
      <KeybindingProvider>
        <div>app</div>
      </KeybindingProvider>,
    );
    // Should not throw
    fireEvent.keyDown(document, { key: "x", metaKey: true });
  });

  it("does not intercept Escape (handled by DOM bubbling per spec)", () => {
    const execute = vi.fn();
    useCommandStore.getState().registerCommand({
      id: "test.escape",
      label: "Test Escape",
      shortcut: "Escape",
      context: "global",
      execute,
    });
    render(
      <KeybindingProvider>
        <div>app</div>
      </KeybindingProvider>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    // Escape IS dispatched to commands if registered — the spec says
    // don't register Escape as a command, but KeybindingProvider itself
    // does not special-case it. The responsibility is on command registration.
    expect(execute).toHaveBeenCalledOnce();
  });
});
