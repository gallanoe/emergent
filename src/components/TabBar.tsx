import { useEditorStore } from "../stores/editor";

export function TabBar() {
  const { openTabs, activeTab, dirtyTabs, setActiveTab, closeTab } =
    useEditorStore();

  if (openTabs.length === 0) return null;

  return (
    <div
      className="flex overflow-x-auto"
      style={{
        height: 32,
        borderBottom: "1px solid var(--color-border-default)",
      }}
    >
      {openTabs.map((tab) => {
        const isActive = tab.path === activeTab;
        const isDirty = dirtyTabs.has(tab.path);

        return (
          <div
            key={tab.path}
            onClick={() => setActiveTab(tab.path)}
            className="group flex cursor-default items-center gap-2 px-3"
            style={{
              fontSize: 13,
              color: isActive
                ? "var(--color-fg-heading)"
                : "var(--color-fg-muted)",
              borderBottom: isActive
                ? "1px solid var(--color-accent)"
                : "1px solid transparent",
              whiteSpace: "nowrap",
            }}
          >
            <span>{tab.name}</span>
            {isDirty && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--color-warning)",
                  flexShrink: 0,
                }}
              />
            )}
            <span
              onClick={(e) => {
                e.stopPropagation();
                if (isDirty) {
                  const confirmed = window.confirm(
                    "This document has unsaved changes. Close anyway?",
                  );
                  if (!confirmed) return;
                }
                closeTab(tab.path);
              }}
              className="opacity-0 group-hover:opacity-100"
              style={{
                fontSize: 10,
                color: "var(--color-fg-muted)",
                transition: "opacity 100ms ease-out",
              }}
            >
              ×
            </span>
          </div>
        );
      })}
    </div>
  );
}
