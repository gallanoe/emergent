import { useEffect } from "react";
import { useCommandStore } from "../stores/commands";
import { useFocusContextStore } from "../stores/focus-context";
import { normalizeShortcut, resolveCommand } from "../lib/keybindings";

export function KeybindingProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      const shortcut = normalizeShortcut(e);
      if (!shortcut) return;

      const activeRegion = useFocusContextStore.getState().activeRegion;
      const commands = useCommandStore.getState().getCommands();
      const command = resolveCommand(shortcut, activeRegion, commands);

      if (command) {
        e.preventDefault();
        useCommandStore.getState().executeCommand(command.id);
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return <>{children}</>;
}
