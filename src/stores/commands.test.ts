// src/__tests__/stores/commands.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { commandStore } from "./commands.svelte";
import type { Command } from "./commands.svelte";

const makeCommand = (overrides: Partial<Command> = {}): Command => ({
  id: "test.command",
  label: "Test Command",
  execute: vi.fn(),
  ...overrides,
});

describe("CommandStore (Svelte)", () => {
  beforeEach(() => {
    commandStore.commands.clear();
    commandStore.paletteOpen = false;
  });

  describe("registerCommand", () => {
    it("adds a command to the registry", () => {
      commandStore.registerCommand(makeCommand());
      expect(commandStore.commandList).toHaveLength(1);
      expect(commandStore.commandList[0]!.id).toBe("test.command");
    });

    it("overwrites command with same id", () => {
      commandStore.registerCommand(makeCommand({ label: "First" }));
      commandStore.registerCommand(makeCommand({ label: "Second" }));
      expect(commandStore.commandList).toHaveLength(1);
      expect(commandStore.commandList[0]!.label).toBe("Second");
    });
  });

  describe("unregisterCommand", () => {
    it("removes a command", () => {
      commandStore.registerCommand(makeCommand());
      commandStore.unregisterCommand("test.command");
      expect(commandStore.commandList).toHaveLength(0);
    });

    it("no-ops for unknown id", () => {
      commandStore.registerCommand(makeCommand());
      commandStore.unregisterCommand("unknown");
      expect(commandStore.commandList).toHaveLength(1);
    });
  });

  describe("executeCommand", () => {
    it("calls the execute function", () => {
      const execute = vi.fn();
      commandStore.registerCommand(makeCommand({ execute }));
      commandStore.executeCommand("test.command");
      expect(execute).toHaveBeenCalledOnce();
    });

    it("no-ops for unknown id", () => {
      commandStore.executeCommand("nonexistent");
    });

    it("catches rejected promises from async execute", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const execute = vi.fn().mockRejectedValue(new Error("fail"));
      commandStore.registerCommand(makeCommand({ execute }));
      commandStore.executeCommand("test.command");
      await new Promise((r) => setTimeout(r, 0));
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("getCommandsByShortcut", () => {
    it("returns commands matching shortcut", () => {
      commandStore.registerCommand(makeCommand({ id: "a", shortcut: "Mod+N" }));
      commandStore.registerCommand(makeCommand({ id: "b", shortcut: "Mod+S" }));
      const result = commandStore.getCommandsByShortcut("Mod+N");
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("a");
    });

    it("returns multiple commands with same shortcut different contexts", () => {
      commandStore.registerCommand(makeCommand({ id: "a", shortcut: "Mod+N", context: "global" }));
      commandStore.registerCommand(
        makeCommand({ id: "b", shortcut: "Mod+N", context: "workspace-picker" }),
      );
      expect(commandStore.getCommandsByShortcut("Mod+N")).toHaveLength(2);
    });

    it("returns empty array when no match", () => {
      expect(commandStore.getCommandsByShortcut("Mod+X")).toHaveLength(0);
    });
  });

  describe("palette", () => {
    it("opens palette", () => {
      commandStore.openPalette();
      expect(commandStore.paletteOpen).toBe(true);
    });

    it("closes palette", () => {
      commandStore.paletteOpen = true;
      commandStore.closePalette();
      expect(commandStore.paletteOpen).toBe(false);
    });
  });
});
