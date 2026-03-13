import { describe, it, expect, vi, beforeEach } from "vitest";
import { normalizeShortcut, resolveCommand } from "./keybindings";
import type { Command } from "../stores/commands.svelte";

function makeKeyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "a",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("normalizeShortcut", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
  });

  it("returns Mod+key for metaKey on macOS", () => {
    expect(normalizeShortcut(makeKeyEvent({ metaKey: true, key: "n" }))).toBe("Mod+N");
  });

  it("returns Mod+Shift+key for metaKey+shiftKey", () => {
    expect(normalizeShortcut(makeKeyEvent({ metaKey: true, shiftKey: true, key: "N" }))).toBe(
      "Mod+Shift+N",
    );
  });

  it("returns empty string for modifier-only press", () => {
    expect(normalizeShortcut(makeKeyEvent({ key: "Meta" }))).toBe("");
    expect(normalizeShortcut(makeKeyEvent({ key: "Shift" }))).toBe("");
    expect(normalizeShortcut(makeKeyEvent({ key: "Control" }))).toBe("");
    expect(normalizeShortcut(makeKeyEvent({ key: "Alt" }))).toBe("");
  });

  it("normalizes single char keys to uppercase", () => {
    expect(normalizeShortcut(makeKeyEvent({ key: "s", metaKey: true }))).toBe("Mod+S");
  });

  it("preserves special key names", () => {
    expect(normalizeShortcut(makeKeyEvent({ key: "F2" }))).toBe("F2");
    expect(normalizeShortcut(makeKeyEvent({ key: "Delete" }))).toBe("Delete");
    expect(normalizeShortcut(makeKeyEvent({ key: "Backspace" }))).toBe("Backspace");
    expect(normalizeShortcut(makeKeyEvent({ key: "ArrowUp" }))).toBe("ArrowUp");
  });

  it("returns Mod+key for ctrlKey on non-macOS", () => {
    Object.defineProperty(navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    expect(normalizeShortcut(makeKeyEvent({ ctrlKey: true, key: "n" }))).toBe("Mod+N");
  });

  it("includes Alt modifier", () => {
    expect(normalizeShortcut(makeKeyEvent({ metaKey: true, altKey: true, key: "n" }))).toBe(
      "Mod+Alt+N",
    );
  });

  it("returns plain key when no modifiers", () => {
    expect(normalizeShortcut(makeKeyEvent({ key: "a" }))).toBe("A");
  });
});

describe("resolveCommand", () => {
  const makeCmd = (overrides: Partial<Command> = {}): Command => ({
    id: "test",
    label: "Test",
    execute: vi.fn(),
    ...overrides,
  });

  it("matches context-specific command first", () => {
    const sidebarCmd = makeCmd({ id: "sidebar", shortcut: "F2", context: "sidebar" });
    const globalCmd = makeCmd({ id: "global", shortcut: "F2", context: "global" });
    const result = resolveCommand("F2", "sidebar", [sidebarCmd, globalCmd]);
    expect(result?.id).toBe("sidebar");
  });

  it("falls back to global when no context match", () => {
    const globalCmd = makeCmd({ id: "global", shortcut: "Mod+B", context: "global" });
    const result = resolveCommand("Mod+B", "editor", [globalCmd]);
    expect(result?.id).toBe("global");
  });

  it("returns undefined when no match", () => {
    const cmd = makeCmd({ shortcut: "Mod+N", context: "global" });
    expect(resolveCommand("Mod+X", "global", [cmd])).toBeUndefined();
  });

  it("skips command when predicate returns false", () => {
    const cmd = makeCmd({ shortcut: "Mod+N", context: "global", when: () => false });
    expect(resolveCommand("Mod+N", "global", [cmd])).toBeUndefined();
  });

  it("matches command when predicate returns true", () => {
    const cmd = makeCmd({ shortcut: "Mod+N", context: "global", when: () => true });
    expect(resolveCommand("Mod+N", "global", [cmd])?.id).toBe("test");
  });

  it("skips context match with false predicate, falls back to global", () => {
    const sidebarCmd = makeCmd({
      id: "sidebar",
      shortcut: "F2",
      context: "sidebar",
      when: () => false,
    });
    const globalCmd = makeCmd({ id: "global", shortcut: "F2", context: "global" });
    const result = resolveCommand("F2", "sidebar", [sidebarCmd, globalCmd]);
    expect(result?.id).toBe("global");
  });
});
