import { create } from "zustand";
import type { FocusRegion } from "./focus-context";

export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  context?: FocusRegion;
  when?: () => boolean;
  execute: () => void | Promise<void>;
}

interface CommandState {
  commands: Map<string, Command>;
  paletteOpen: boolean;
  registerCommand: (cmd: Command) => void;
  unregisterCommand: (id: string) => void;
  executeCommand: (id: string) => void;
  getCommands: () => Command[];
  getCommandsByShortcut: (shortcut: string) => Command[];
  openPalette: () => void;
  closePalette: () => void;
}

export const useCommandStore = create<CommandState>((set, get) => ({
  commands: new Map(),
  paletteOpen: false,

  registerCommand: (cmd) =>
    set((state) => {
      const next = new Map(state.commands);
      next.set(cmd.id, cmd);
      return { commands: next };
    }),

  unregisterCommand: (id) =>
    set((state) => {
      const next = new Map(state.commands);
      next.delete(id);
      return { commands: next };
    }),

  executeCommand: (id) => {
    const cmd = get().commands.get(id);
    if (!cmd) return;
    const result = cmd.execute();
    if (result instanceof Promise) {
      result.catch((err) => console.error(`Command "${id}" failed:`, err));
    }
  },

  getCommands: () => Array.from(get().commands.values()),

  getCommandsByShortcut: (shortcut) =>
    Array.from(get().commands.values()).filter((cmd) => cmd.shortcut === shortcut),

  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
}));
