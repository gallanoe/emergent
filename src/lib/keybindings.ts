import type { Command } from "../stores/commands.svelte";
import type { FocusRegion } from "../stores/focus-context.svelte";

const MODIFIER_KEYS = new Set(["Meta", "Control", "Shift", "Alt"]);

export function normalizeShortcut(e: KeyboardEvent): string {
  const parts: string[] = [];
  const isMac = navigator.platform.startsWith("Mac");

  if (isMac ? e.metaKey : e.ctrlKey) parts.push("Mod");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");

  if (MODIFIER_KEYS.has(e.key)) return "";

  const normalized = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(normalized);

  return parts.join("+");
}

export function resolveCommand(
  shortcut: string,
  activeRegion: FocusRegion,
  commands: Command[],
): Command | undefined {
  const contextMatch = commands.find(
    (cmd) =>
      cmd.shortcut === shortcut && cmd.context === activeRegion && (cmd.when ? cmd.when() : true),
  );
  if (contextMatch) return contextMatch;

  return commands.find(
    (cmd) =>
      cmd.shortcut === shortcut && cmd.context === "global" && (cmd.when ? cmd.when() : true),
  );
}
