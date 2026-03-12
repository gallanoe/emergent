import { useWorkspaceStore } from "../stores/workspace";

export default function WorkspacePicker() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);

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
          style={{
            border: "1px solid var(--color-border-default)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          {workspaces.length === 0 ? (
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
            workspaces.map((ws) => (
              <div
                key={ws.id}
                style={{
                  padding: "8px 12px",
                  fontSize: 13,
                  color: "var(--color-fg-default)",
                }}
              >
                {ws.name}
              </div>
            ))
          )}
        </div>

        <div>
          <a
            href="#"
            style={{
              fontSize: 13,
              color: "var(--color-accent-text)",
              textDecoration: "none",
            }}
          >
            New workspace
          </a>
        </div>
      </div>
    </div>
  );
}
