import { useState, useCallback, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { StatusBar } from "./StatusBar";
import { ToastContainer } from "./Toast";
import { Editor } from "./Editor";
import { KeybindingProvider } from "./KeybindingProvider";
import { useEditorStore } from "../stores/editor";
import {
  listTree,
  readDocument,
  writeDocument,
  onTreeChanged,
  onDocumentChanged,
} from "../lib/tauri";
import { useFileTreeStore } from "../stores/file-tree";
import { useUIStore } from "../stores/ui";
import { useCommandStore } from "../stores/commands";
import { sortTree } from "../lib/sort-tree";
import { useToastStore } from "./Toast";
import { CommandPalette } from "./CommandPalette";

export function AppShell() {
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const activeTab = useEditorStore((s) => s.activeTab);
  const tree = useFileTreeStore((s) => s.tree);
  const loading = useFileTreeStore((s) => s.loading);
  const [editorContent, setEditorContent] = useState("");

  useEffect(() => {
    if (activeTab) {
      readDocument(activeTab)
        .then(setEditorContent)
        .catch(() => setEditorContent(""));
    }
  }, [activeTab]);

  const handleSave = useCallback(
    (content: string) => {
      if (activeTab) {
        writeDocument(activeTab, content);
      }
    },
    [activeTab],
  );

  // Load tree on mount, subscribe to events
  useEffect(() => {
    let unmountedTreeFn: (() => void) | null = null;
    let unmountedDocFn: (() => void) | null = null;

    const loadTree = () => {
      listTree()
        .then((tree) => {
          useFileTreeStore.getState().setTree(sortTree(tree));
          useFileTreeStore.getState().setLoading(false);
        })
        .catch((err) => {
          useFileTreeStore.getState().setLoading(false);
          useToastStore
            .getState()
            .addToast(
              `Failed to load files: ${err instanceof Error ? err.message : String(err)}`,
              "error",
            );
        });
    };

    useFileTreeStore.getState().setLoading(true);
    loadTree();

    onTreeChanged(() => {
      loadTree();
    }).then((fn) => {
      unmountedTreeFn = fn;
    });

    onDocumentChanged(({ path }) => {
      const activeTab = useEditorStore.getState().activeTab;
      if (activeTab === path) {
        readDocument(path)
          .then((content) => {
            setEditorContent(content);
          })
          .catch(() => {});
      }
    }).then((fn) => {
      unmountedDocFn = fn;
    });

    return () => {
      unmountedTreeFn?.();
      unmountedDocFn?.();
    };
  }, []);

  useEffect(() => {
    const commands = [
      {
        id: "sidebar.toggle",
        label: "Toggle Sidebar",
        shortcut: "Mod+B",
        context: "global" as const,
        execute: () => useUIStore.getState().toggleSidebar(),
      },
      {
        id: "tab.close",
        label: "Close Tab",
        shortcut: "Mod+W",
        context: "global" as const,
        execute: () => {
          const { activeTab: tab, closeTab } = useEditorStore.getState();
          if (tab) closeTab(tab);
        },
      },
      {
        id: "file.create",
        label: "New File",
        shortcut: "Mod+N",
        context: "global" as const,
        execute: () => {
          useUIStore.getState().setSidebarCollapsed(false);
          useFileTreeStore.getState().setPendingCreation({ type: "file", parentPath: "" });
        },
      },
      {
        id: "folder.create",
        label: "New Folder",
        shortcut: "Mod+Shift+N",
        context: "global" as const,
        execute: () => {
          useUIStore.getState().setSidebarCollapsed(false);
          useFileTreeStore.getState().setPendingCreation({ type: "folder", parentPath: "" });
        },
      },
      {
        id: "palette.open",
        label: "Command Palette",
        shortcut: "Mod+K",
        context: "global" as const,
        execute: () => useCommandStore.getState().openPalette(),
      },
    ];

    for (const cmd of commands) {
      useCommandStore.getState().registerCommand(cmd);
    }

    return () => {
      for (const cmd of commands) {
        useCommandStore.getState().unregisterCommand(cmd.id);
      }
    };
  }, []);

  return (
    <KeybindingProvider>
      <div className="flex h-screen flex-col">
        <div className="flex flex-1 overflow-hidden">
          {!sidebarCollapsed && <Sidebar width={sidebarWidth} onWidthChange={setSidebarWidth} />}
          <div className="flex flex-1 flex-col overflow-hidden">
            <TabBar />
            <div className="flex-1 overflow-auto p-6">
              {activeTab ? (
                <Editor content={editorContent} path={activeTab} onSave={handleSave} />
              ) : tree.length === 0 && !loading ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    gap: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: "var(--color-fg-heading)",
                    }}
                  >
                    Create your first document
                  </span>
                  <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
                    {"Press ⌘N to get started"}
                  </span>
                </div>
              ) : (
                <p style={{ color: "var(--color-fg-muted)" }}>No document open</p>
              )}
            </div>
          </div>
        </div>
        <StatusBar />
        <ToastContainer />
        <CommandPalette />
      </div>
    </KeybindingProvider>
  );
}
