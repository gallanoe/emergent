import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  /** Session whose output is currently piped into `terminal`, or null. */
  sessionId: string | null;
  /** True once the attached session's shell has exited. */
  exited: boolean;
  /** Notified (if set) when `exited` flips, so a mounted view can refresh. */
  onExited?: (() => void) | undefined;
  unlistenOutput?: UnlistenFn | undefined;
  unlistenExited?: UnlistenFn | undefined;
  dataDisposable?: { dispose: () => void } | undefined;
  /** Bumped on every attach/dispose so a slow in-flight attach can detect it
   *  was superseded and discard its listeners instead of leaking them. */
  attachGen: number;
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

  const instance: TerminalInstance = {
    terminal,
    fitAddon,
    sessionId: null,
    exited: false,
    attachGen: 0,
  };
  instances.set(workspaceId, instance);
  return instance;
}

/**
 * Pipe a backend session's output into this workspace's terminal, persistently.
 *
 * The listeners live on the cached instance, NOT on the `TerminalView`
 * component, so output keeps appending to the scrollback buffer even while the
 * Terminal view is unmounted (the user navigated away). Re-mounting the view
 * just re-attaches the existing DOM; nothing is lost.
 *
 * Idempotent: re-attaching the same session is a no-op; attaching a new session
 * tears down the previous session's listeners first.
 */
export async function attachSession(workspaceId: string, sessionId: string): Promise<void> {
  const instance = getOrCreate(workspaceId);

  // Already fully attached to this session (e.g. the view just re-mounted).
  if (instance.sessionId === sessionId && instance.unlistenOutput) return;

  // Supersede any previous or still-in-flight attach. `attachGen` is bumped
  // synchronously here (and in `dispose`), so a slower concurrent attach whose
  // `await listen(...)` resolves later detects it lost the race and discards its
  // listeners instead of registering a duplicate set and leaking an UnlistenFn.
  const gen = ++instance.attachGen;
  detachListeners(instance);
  instance.sessionId = sessionId;
  instance.exited = false;

  const { terminal } = instance;

  const unlistenOutput = await listen<{ session_id: string; data: string }>(
    "terminal:output",
    (e) => {
      if (instance.attachGen !== gen || e.payload.session_id !== sessionId) return;
      const bytes = Uint8Array.from(atob(e.payload.data), (c) => c.charCodeAt(0));
      terminal.write(bytes);
    },
  );

  const unlistenExited = await listen<{ session_id: string }>("terminal:exited", (e) => {
    if (instance.attachGen !== gen || e.payload.session_id !== sessionId) return;
    instance.exited = true;
    instance.onExited?.();
  });

  // A newer attach() or a dispose() ran while we awaited — drop ours so we
  // neither leak these UnlistenFns nor write into a superseded/disposed terminal.
  if (instance.attachGen !== gen) {
    unlistenOutput();
    unlistenExited();
    return;
  }

  instance.unlistenOutput = unlistenOutput;
  instance.unlistenExited = unlistenExited;
  instance.dataDisposable = terminal.onData((data: string) => {
    if (instance.attachGen !== gen || instance.exited || instance.sessionId !== sessionId) {
      return;
    }
    const bytes = Array.from(new TextEncoder().encode(data));
    invoke("write_terminal", { sessionId, data: bytes });
  });
}

function detachListeners(instance: TerminalInstance): void {
  instance.unlistenOutput?.();
  instance.unlistenOutput = undefined;
  instance.unlistenExited?.();
  instance.unlistenExited = undefined;
  instance.dataDisposable?.dispose();
  instance.dataDisposable = undefined;
}

export function dispose(workspaceId: string): void {
  const instance = instances.get(workspaceId);
  if (instance) {
    instance.attachGen++; // supersede any in-flight attach on this instance
    detachListeners(instance);
    instance.terminal.dispose();
    instances.delete(workspaceId);
  }
}

export function get(workspaceId: string): TerminalInstance | undefined {
  return instances.get(workspaceId);
}
