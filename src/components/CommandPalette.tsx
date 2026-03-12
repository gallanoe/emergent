import { useState, useEffect, useRef, useMemo } from "react";
import { useCommandStore } from "../stores/commands";

function formatShortcut(shortcut: string): string {
  const isMac = navigator.platform.startsWith("Mac");
  return shortcut
    .replace("Mod+", isMac ? "⌘" : "Ctrl+")
    .replace("Shift+", isMac ? "⇧" : "Shift+")
    .replace("Alt+", isMac ? "⌥" : "Alt+");
}

export function CommandPalette() {
  const paletteOpen = useCommandStore((s) => s.paletteOpen);
  const commandsMap = useCommandStore((s) => s.commands);
  const commands = useMemo(() => Array.from(commandsMap.values()), [commandsMap]);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  const filtered = useMemo(() => {
    if (!query) return commands;
    const lower = query.toLowerCase();
    return commands.filter((cmd) => cmd.label.toLowerCase().includes(lower));
  }, [commands, query]);

  useEffect(() => {
    if (paletteOpen) {
      previousFocusRef.current = document.activeElement;
      setQuery("");
      setSelectedIndex(0);
      inputRef.current?.focus();
    } else if (previousFocusRef.current instanceof HTMLElement) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [paletteOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!paletteOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      useCommandStore.getState().closePalette();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[selectedIndex];
      if (cmd) {
        useCommandStore.getState().closePalette();
        useCommandStore.getState().executeCommand(cmd.id);
      }
    }
  };

  return (
    <>
      <div
        data-testid="palette-backdrop"
        onClick={() => useCommandStore.getState().closePalette()}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 100,
        }}
      />
      <div
        style={{
          position: "fixed",
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 480,
          maxWidth: "calc(100vw - 32px)",
          background: "#1e1f22",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 4,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          zIndex: 101,
          overflow: "hidden",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ color: "#6b6d7b", fontSize: 13 }}>⌘</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#e0e0e3",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          />
        </div>
        <div style={{ padding: "4px 0", maxHeight: 320, overflowY: "auto" }}>
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              data-selected={i === selectedIndex}
              onClick={() => {
                useCommandStore.getState().closePalette();
                useCommandStore.getState().executeCommand(cmd.id);
              }}
              style={{
                height: 28,
                display: "flex",
                alignItems: "center",
                padding: "0 14px",
                fontSize: 13,
                color: i === selectedIndex ? "#e0e0e3" : "#ababae",
                background: i === selectedIndex ? "rgba(255,255,255,0.04)" : "transparent",
                justifyContent: "space-between",
                cursor: "default",
              }}
            >
              <span>{cmd.label}</span>
              {cmd.shortcut ? (
                <span
                  style={{
                    fontSize: 11,
                    color: "#6b6d7b",
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  {formatShortcut(cmd.shortcut)}
                </span>
              ) : null}
            </div>
          ))}
          {filtered.length === 0 && (
            <div
              style={{
                padding: "8px 14px",
                fontSize: 13,
                color: "#6b6d7b",
              }}
            >
              No matching commands
            </div>
          )}
        </div>
      </div>
    </>
  );
}
