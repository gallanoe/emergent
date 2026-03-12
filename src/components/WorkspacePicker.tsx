import { useState } from "react";
import { useWorkspaceStore } from "../stores/workspace";

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return diffMin <= 1 ? "just now" : `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

export function WorkspacePicker() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const sorted = workspaces.toSorted(
    (a, b) => new Date(b.last_opened).getTime() - new Date(a.last_opened).getTime(),
  );
  const [selectedIndex, setSelectedIndex] = useState(0);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        width: "100%",
      }}
    >
      <div style={{ width: 320, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--color-fg-heading)",
            }}
          >
            Open a workspace
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--color-fg-muted)",
              marginTop: 4,
            }}
          >
            Or create a new one to get started
          </div>
        </div>

        <div
          role="listbox"
          style={{
            border: "1px solid var(--color-border-default)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          {sorted.length === 0 ? (
            <div
              style={{
                padding: "8px 12px",
                fontSize: 13,
                color: "var(--color-fg-muted)",
              }}
            >
              No workspaces yet
            </div>
          ) : (
            sorted.map((ws, i) => (
              <div
                key={ws.id}
                role="option"
                aria-selected={i === selectedIndex}
                onClick={() => setSelectedIndex(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  cursor: "default",
                  borderBottom:
                    i < sorted.length - 1 ? "1px solid var(--color-border-default)" : "none",
                  background: i === selectedIndex ? "var(--color-bg-selected)" : undefined,
                  color:
                    i === selectedIndex ? "var(--color-fg-heading)" : "var(--color-fg-default)",
                  minHeight: 34,
                }}
              >
                <span style={{ fontSize: 13 }}>{ws.name}</span>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--color-fg-disabled)",
                  }}
                >
                  {relativeTime(ws.last_opened)}
                </span>
              </div>
            ))
          )}
        </div>

        <div>
          <span
            style={{
              fontSize: 12,
              color: "var(--color-accent-text)",
            }}
          >
            New workspace
          </span>
        </div>
      </div>
    </div>
  );
}
