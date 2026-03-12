import { useState, useCallback, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { StatusBar } from "./StatusBar";
import { ToastContainer } from "./Toast";
import { Editor } from "./Editor";
import { useEditorStore } from "../stores/editor";
import { readDocument, writeDocument, createDocument, createFolder } from "../lib/tauri";

export function AppShell() {
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const activeTab = useEditorStore((s) => s.activeTab);
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
