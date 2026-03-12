import { useState, useCallback, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { StatusBar } from "./StatusBar";
import { ToastContainer } from "./Toast";
import { Editor } from "./Editor";
import { useEditorStore } from "../stores/editor";
import {
  listTree,
  readDocument,
  writeDocument,
  createDocument,
  createFolder,
  onTreeChanged,
  onDocumentChanged,
} from "../lib/tauri";
import { useFileTreeStore } from "../stores/file-tree";
import { sortTree } from "../lib/sort-tree";
import { useToastStore } from "./Toast";

export function AppShell() {
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const activeTab = useEditorStore((s) => s.activeTab);
  const tree = useFileTreeStore((s) => s.tree);
  const loading = useFileTreeStore((s) => s.loading);
  const [editorContent, setEditorContent] = useState("");

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => !c);
  }, []);

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
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "b") {
        e.preventDefault();
        handleToggleSidebar();
      }

      // Cmd+W: close active tab
      if (mod && e.key === "w") {
        e.preventDefault();
        const { activeTab: tab, dirtyTabs, closeTab } = useEditorStore.getState();
        if (tab) {
          if (dirtyTabs.has(tab)) {
            const confirmed = window.confirm("This document has unsaved changes. Close anyway?");
            if (!confirmed) return;
          }
          closeTab(tab);
        }
      }

      // Cmd+N: create new document
      if (mod && !e.shiftKey && e.key === "n") {
        e.preventDefault();
        const name = window.prompt("New document name:", "untitled.md");
        if (name) {
          createDocument(name).then(() => {
            useEditorStore.getState().openTab(name);
          });
        }
      }

      // Cmd+Shift+N: create new folder
      if (mod && e.shiftKey && e.key === "N") {
        e.preventDefault();
        const name = window.prompt("New folder name:");
        if (name) {
          createFolder(name);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleToggleSidebar]);

  return (
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
    </div>
  );
}
