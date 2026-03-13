// src/stores/commands.svelte.ts
import { SvelteMap } from "svelte/reactivity";
import type { FocusRegion } from "./focus-context.svelte";

export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  context?: FocusRegion;
  when?: () => boolean;
  execute: () => void | Promise<void>;
}

class CommandStore {
  commands = new SvelteMap<string, Command>();
  paletteOpen = $state(false);

  registerCommand(cmd: Command) {
    this.commands.set(cmd.id, cmd);
  }

  unregisterCommand(id: string) {
    this.commands.delete(id);
  }

  executeCommand(id: string) {
    const cmd = this.commands.get(id);
    if (!cmd) return;
    const result = cmd.execute();
    if (result instanceof Promise) {
      result.catch((err) => console.error(`Command "${id}" failed:`, err));
    }
  }

  get commandList(): Command[] {
    return [...this.commands.values()];
  }

  getCommandsByShortcut(shortcut: string): Command[] {
    return this.commandList.filter((cmd) => cmd.shortcut === shortcut);
  }

  openPalette() {
    this.paletteOpen = true;
  }

  closePalette() {
    this.paletteOpen = false;
  }
}

export const commandStore = new CommandStore();
