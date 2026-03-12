import { describe, it, expect, beforeEach, vi } from "vitest";
import { useCommandStore } from "../../stores/commands";
import type { Command } from "../../stores/commands";

const makeCommand = (overrides: Partial<Command> = {}): Command => ({
  id: "test.command",
  label: "Test Command",
  execute: vi.fn(),
  ...overrides,
});

describe("CommandStore", () => {
  beforeEach(() => {
    useCommandStore.setState({ commands: new Map(), paletteOpen: false });
  });

  describe("registerCommand", () => {
    it("adds a command to the registry", () => {
      useCommandStore.getState().registerCommand(makeCommand());
      const cmds = useCommandStore.getState().getCommands();
      expect(cmds).toHaveLength(1);
      expect(cmds[0]!.id).toBe("test.command");
    });

    it("overwrites command with same id", () => {
      useCommandStore.getState().registerCommand(makeCommand({ label: "First" }));
      useCommandStore.getState().registerCommand(makeCommand({ label: "Second" }));
      const cmds = useCommandStore.getState().getCommands();
      expect(cmds).toHaveLength(1);
      expect(cmds[0]!.label).toBe("Second");
    });
  });

  describe("unregisterCommand", () => {
    it("removes a command", () => {
      useCommandStore.getState().registerCommand(makeCommand());
      useCommandStore.getState().unregisterCommand("test.command");
      expect(useCommandStore.getState().getCommands()).toHaveLength(0);
    });

    it("no-ops for unknown id", () => {
      useCommandStore.getState().registerCommand(makeCommand());
      useCommandStore.getState().unregisterCommand("unknown");
      expect(useCommandStore.getState().getCommands()).toHaveLength(1);
    });
  });

  describe("executeCommand", () => {
    it("calls the execute function", () => {
      const execute = vi.fn();
      useCommandStore.getState().registerCommand(makeCommand({ execute }));
      useCommandStore.getState().executeCommand("test.command");
      expect(execute).toHaveBeenCalledOnce();
    });

    it("no-ops for unknown id", () => {
      // Should not throw
      useCommandStore.getState().executeCommand("nonexistent");
    });

    it("catches rejected promises from async execute", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const execute = vi.fn().mockRejectedValue(new Error("fail"));
      useCommandStore.getState().registerCommand(makeCommand({ execute }));
      useCommandStore.getState().executeCommand("test.command");
      await new Promise((r) => setTimeout(r, 0));
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("getCommandsByShortcut", () => {
    it("returns commands matching shortcut", () => {
      useCommandStore.getState().registerCommand(makeCommand({ id: "a", shortcut: "Mod+N" }));
      useCommandStore.getState().registerCommand(makeCommand({ id: "b", shortcut: "Mod+S" }));
      const result = useCommandStore.getState().getCommandsByShortcut("Mod+N");
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("a");
    });

    it("returns multiple commands with same shortcut different contexts", () => {
      useCommandStore
        .getState()
        .registerCommand(makeCommand({ id: "a", shortcut: "Mod+N", context: "global" }));
      useCommandStore
        .getState()
        .registerCommand(makeCommand({ id: "b", shortcut: "Mod+N", context: "workspace-picker" }));
      expect(useCommandStore.getState().getCommandsByShortcut("Mod+N")).toHaveLength(2);
    });

    it("returns empty array when no match", () => {
      expect(useCommandStore.getState().getCommandsByShortcut("Mod+X")).toHaveLength(0);
    });
  });

  describe("palette", () => {
    it("opens palette", () => {
      useCommandStore.getState().openPalette();
      expect(useCommandStore.getState().paletteOpen).toBe(true);
    });

    it("closes palette", () => {
      useCommandStore.setState({ paletteOpen: true });
      useCommandStore.getState().closePalette();
      expect(useCommandStore.getState().paletteOpen).toBe(false);
    });
  });
});
