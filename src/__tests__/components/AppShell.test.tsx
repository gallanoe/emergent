import { render, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useWorkspaceStore } from "../../stores/workspace";
import { useEditorStore } from "../../stores/editor";
import { useFileTreeStore } from "../../stores/file-tree";
import { AppShell } from "../../components/AppShell";
import { listTree, readDocument, onTreeChanged, onDocumentChanged } from "../../lib/tauri";

const { mockUnlistenTree, mockUnlistenDoc } = vi.hoisted(() => ({
  mockUnlistenTree: vi.fn(),
  mockUnlistenDoc: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  listTree: vi.fn().mockResolvedValue([]),
  readDocument: vi.fn().mockResolvedValue("content"),
  writeDocument: vi.fn().mockResolvedValue(undefined),
  createDocument: vi.fn().mockResolvedValue(undefined),
  createFolder: vi.fn().mockResolvedValue(undefined),
  deleteDocument: vi.fn().mockResolvedValue(undefined),
  deleteFolder: vi.fn().mockResolvedValue(undefined),
  moveDocument: vi.fn().mockResolvedValue(undefined),
  moveFolder: vi.fn().mockResolvedValue(undefined),
  onTreeChanged: vi.fn().mockResolvedValue(mockUnlistenTree),
  onDocumentChanged: vi.fn().mockResolvedValue(mockUnlistenDoc),
}));

describe("AppShell — event wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      activeWorkspace: {
        id: "ws-1",
        name: "Test",
        created_at: "",
        last_opened: "",
      },
      workspaces: [],
      currentBranch: "main",
      mergeState: null,
    });
    useFileTreeStore.setState({
      tree: [],
      expandedPaths: new Set(),
      selectedPath: null,
      loading: false,
    });
    useEditorStore.setState({
      openTabs: [],
      activeTab: null,
      dirtyTabs: new Set(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("calls listTree on mount and populates fileTreeStore", async () => {
    const mockTree = [{ name: "hello.md", path: "hello.md", kind: "file" as const }];
    vi.mocked(listTree).mockResolvedValue(mockTree);
    render(<AppShell />);

    await waitFor(() => {
      expect(listTree).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(useFileTreeStore.getState().tree).toHaveLength(1);
    });
  });

  it("subscribes to onTreeChanged", async () => {
    render(<AppShell />);
    await waitFor(() => {
      expect(onTreeChanged).toHaveBeenCalled();
    });
  });

  it("subscribes to onDocumentChanged", async () => {
    render(<AppShell />);
    await waitFor(() => {
      expect(onDocumentChanged).toHaveBeenCalled();
    });
  });

  it("unsubscribes listeners on unmount", async () => {
    const { unmount } = render(<AppShell />);
    await waitFor(() => {
      expect(onTreeChanged).toHaveBeenCalled();
    });
    unmount();
    expect(mockUnlistenTree).toHaveBeenCalled();
    expect(mockUnlistenDoc).toHaveBeenCalled();
  });

  it("re-fetches tree when tree:changed fires", async () => {
    vi.mocked(listTree).mockResolvedValue([]);
    render(<AppShell />);

    await waitFor(() => {
      expect(onTreeChanged).toHaveBeenCalled();
    });

    // Get the callback that was passed to onTreeChanged and invoke it
    const treeCallback = vi.mocked(onTreeChanged).mock.calls[0]![0];
    const updatedTree = [{ name: "new.md", path: "new.md", kind: "file" as const }];
    vi.mocked(listTree).mockResolvedValue(updatedTree);
    treeCallback({});

    await waitFor(() => {
      expect(listTree).toHaveBeenCalledTimes(2);
    });
  });

  it("re-reads document when document:changed fires for open tab", async () => {
    useEditorStore.getState().openTab("hello.md");
    render(<AppShell />);

    await waitFor(() => {
      expect(onDocumentChanged).toHaveBeenCalled();
    });

    const docCallback = vi.mocked(onDocumentChanged).mock.calls[0]![0];
    docCallback({ path: "hello.md" });

    await waitFor(() => {
      expect(readDocument).toHaveBeenCalledWith("hello.md");
    });
  });
});
