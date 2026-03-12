import { useEditorStore } from "../stores/editor";
import { useWorkspaceStore } from "../stores/workspace";

export function StatusBar() {
  const activeTab = useEditorStore((s) => s.activeTab);
  const currentBranch = useWorkspaceStore((s) => s.currentBranch);

  return (
    <div
      className="flex items-center justify-between px-4"
      style={{
        height: 24,
        fontSize: 11,
        color: "var(--color-fg-muted)",
        borderTop: "1px solid var(--color-border-default)",
      }}
    >
      <div>{activeTab ? "Ln 1, Col 1" : ""}</div>
      <div className="flex gap-4">
        {activeTab && <span>Markdown</span>}
        <span>UTF-8</span>
        <span style={{ color: "var(--color-success)" }}>Saved</span>
        <span>{currentBranch}</span>
      </div>
    </div>
  );
}
