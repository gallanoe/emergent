import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
}

const instances = new Map<string, TerminalInstance>();

const THEME = {
  background: "#09090b",
  foreground: "#d4d4d8",
  cursor: "#fafafa",
  cursorAccent: "#09090b",
  selectionBackground: "rgba(255, 255, 255, 0.15)",
  black: "#09090b",
  green: "#22c55e",
  blue: "#60a5fa",
  yellow: "#c48a1a",
  red: "#c83c3c",
};

export function getOrCreate(workspaceId: string): TerminalInstance {
  const existing = instances.get(workspaceId);
  if (existing) return existing;

  const terminal = new Terminal({
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    theme: THEME,
    cursorBlink: true,
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  const instance = { terminal, fitAddon };
  instances.set(workspaceId, instance);
  return instance;
}

export function dispose(workspaceId: string): void {
  const instance = instances.get(workspaceId);
  if (instance) {
    instance.terminal.dispose();
    instances.delete(workspaceId);
  }
}

export function get(workspaceId: string): TerminalInstance | undefined {
  return instances.get(workspaceId);
}
