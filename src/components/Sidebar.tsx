import { useCallback } from "react";
import { FileTree } from "./FileTree";

type SidebarProps = {
  width: number;
  onWidthChange: (width: number) => void;
};

export function Sidebar({ width, onWidthChange }: SidebarProps) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const rawWidth = startWidth + moveEvent.clientX - startX;
        if (rawWidth < 120) {
          onWidthChange(0);
        } else {
          onWidthChange(Math.max(180, Math.min(400, rawWidth)));
        }
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [width, onWidthChange],
  );

  return (
    <div
      className="relative flex flex-col overflow-hidden"
      style={{
        width,
        minWidth: 180,
        maxWidth: 400,
        borderRight: "1px solid var(--color-border-default)",
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{
          fontSize: 11,
          borderBottom: "1px solid var(--color-border-default)",
        }}
      >
        <span
          style={{
            color: "var(--color-fg-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontWeight: 600,
          }}
        >
          Files
        </span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        <FileTree />
      </div>
      <div
        onMouseDown={handleMouseDown}
        onDoubleClick={() => onWidthChange(220)}
        style={{
          position: "absolute",
          top: 0,
          right: -4,
          bottom: 0,
          width: 8,
          cursor: "col-resize",
          zIndex: 10,
        }}
      />
    </div>
  );
}
