import { useEffect, useRef, useState, useCallback } from "react";

export type MenuItem =
  | { label: string; action: string; type?: undefined }
  | { type: "separator"; label?: undefined; action?: undefined };

type ContextMenuProps = {
  x: number;
  y: number;
  items: MenuItem[];
  onAction: (action: string) => void;
  onClose: () => void;
};

export function ContextMenu({ x, y, items, onAction, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const actionItems = items.filter(
    (item): item is MenuItem & { action: string } => item.type !== "separator",
  );
  const [focusIndex, setFocusIndex] = useState(0);

  // Click outside to dismiss
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Auto-focus menu on mount
  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "ArrowDown":
          e.preventDefault();
          setFocusIndex((i) => (i + 1) % actionItems.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusIndex((i) => (i - 1 + actionItems.length) % actionItems.length);
          break;
        case "Enter":
          e.preventDefault();
          if (actionItems[focusIndex]) {
            onAction(actionItems[focusIndex].action);
            onClose();
          }
          break;
      }
    },
    [onClose, onAction, actionItems, focusIndex],
  );

  // Clamp position to viewport
  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - items.length * 28 - 16),
    background: "var(--color-bg-hover)",
    border: "1px solid var(--color-border-default)",
    borderRadius: 4,
    padding: "4px 0",
    minWidth: 160,
    zIndex: 1000,
    outline: "none",
  };

  let actionIndex = -1;

  return (
    <div ref={menuRef} role="menu" tabIndex={0} onKeyDown={handleKeyDown} style={style}>
      {items.map((item, i) => {
        if (item.type === "separator") {
          return (
            <div
              key={`sep-${i}`}
              style={{
                height: 1,
                background: "var(--color-border-default)",
                margin: "4px 0",
              }}
            />
          );
        }
        actionIndex++;
        const isFocused = actionIndex === focusIndex;
        return (
          <div
            key={item.action}
            role="menuitem"
            onClick={() => {
              onAction(item.action);
              onClose();
            }}
            className="interactive"
            style={{
              height: 28,
              display: "flex",
              alignItems: "center",
              padding: "0 12px",
              fontSize: 13,
              color: isFocused ? "var(--color-fg-heading)" : "var(--color-fg-default)",
              background: isFocused ? "var(--color-bg-active)" : "transparent",
            }}
          >
            {item.label}
          </div>
        );
      })}
    </div>
  );
}
