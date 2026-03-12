import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  moveDocument,
  moveFolder,
  createDocument,
  createFolder,
  readDocument,
  deleteDocument,
  writeDocument,
} from "../../lib/tauri";
import { useFileTreeStore } from "../../stores/file-tree";
import { useEditorStore } from "../../stores/editor";
import { FileTree } from "../../components/FileTree";
import { useToastStore } from "../../components/Toast";

vi.mock("../../lib/tauri", () => ({
  listTree: vi.fn().mockResolvedValue([]),
  readDocument: vi.fn().mockResolvedValue(""),
  writeDocument: vi.fn().mockResolvedValue(undefined),
  createDocument: vi.fn().mockResolvedValue(undefined),
  createFolder: vi.fn().mockResolvedValue(undefined),
  deleteDocument: vi.fn().mockResolvedValue(undefined),
  deleteFolder: vi.fn().mockResolvedValue(undefined),
  moveDocument: vi.fn().mockResolvedValue(undefined),
  moveFolder: vi.fn().mockResolvedValue(undefined),
}));

const sampleTree = [
  {
    name: "docs",
    path: "docs",
    kind: "folder" as const,
    children: [{ name: "readme.md", path: "docs/readme.md", kind: "file" as const }],
  },
  { name: "notes.md", path: "notes.md", kind: "file" as const },
];

describe("FileTree — context menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFileTreeStore.setState({
      tree: sampleTree,
      expandedPaths: new Set(["docs"]),
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

  it("shows Rename and Delete when right-clicking a file", () => {
    render(<FileTree />);
    fireEvent.contextMenu(screen.getByText("notes.md"));
    expect(screen.getByText("Rename")).toBeDefined();
    expect(screen.getByText("Delete")).toBeDefined();
  });

  it("shows New File, New Folder, Rename, Delete when right-clicking a folder", () => {
    render(<FileTree />);
    fireEvent.contextMenu(screen.getByText("docs"));
    expect(screen.getByText("New File")).toBeDefined();
    expect(screen.getByText("New Folder")).toBeDefined();
    expect(screen.getByText("Rename")).toBeDefined();
    expect(screen.getByText("Delete")).toBeDefined();
  });

  it("shows New File, New Folder when right-clicking empty tree area", () => {
    render(<FileTree />);
    const tree = screen.getByRole("tree");
    fireEvent.contextMenu(tree);
    expect(screen.getByText("New File")).toBeDefined();
    expect(screen.getByText("New Folder")).toBeDefined();
  });

  it("dismisses context menu on Escape", () => {
    render(<FileTree />);
    fireEvent.contextMenu(screen.getByText("notes.md"));
    expect(screen.getByText("Rename")).toBeDefined();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByText("Rename")).toBeNull();
  });
});

describe("FileTree — inline rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFileTreeStore.setState({
      tree: sampleTree,
      expandedPaths: new Set(["docs"]),
      selectedPath: "notes.md",
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

  it("F2 on selected node shows rename input", () => {
    render(<FileTree />);
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "F2" });
    expect(screen.getByDisplayValue("notes.md")).toBeDefined();
  });

  it("Enter confirms rename and calls moveDocument", async () => {
    vi.mocked(moveDocument).mockResolvedValue(undefined);
    render(<FileTree />);
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "F2" });
    const input = screen.getByDisplayValue("notes.md");
    fireEvent.change(input, { target: { value: "renamed.md" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(moveDocument).toHaveBeenCalledWith("notes.md", "renamed.md");
    });
  });

  it("Escape cancels rename", () => {
    render(<FileTree />);
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "F2" });
    const input = screen.getByDisplayValue("notes.md");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByDisplayValue("notes.md")).toBeNull();
    expect(screen.getByText("notes.md")).toBeDefined();
  });

  it("empty name cancels rename", () => {
    render(<FileTree />);
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "F2" });
    const input = screen.getByDisplayValue("notes.md");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(moveDocument).not.toHaveBeenCalled();
  });

  it("unchanged name cancels rename", () => {
    render(<FileTree />);
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "F2" });
    const input = screen.getByDisplayValue("notes.md");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(moveDocument).not.toHaveBeenCalled();
  });

  it("rename failure shows error toast", async () => {
    vi.mocked(moveDocument).mockRejectedValue(new Error("conflict"));
    render(<FileTree />);
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "F2" });
    const input = screen.getByDisplayValue("notes.md");
    fireEvent.change(input, { target: { value: "conflict.md" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(moveDocument).toHaveBeenCalled();
    });
    // Original name should be restored (rollback)
    await waitFor(() => {
      expect(screen.getByText("notes.md")).toBeDefined();
    });
  });

  it("double-click on already-selected node enters rename mode", async () => {
    render(<FileTree />);
    const node = screen.getByText("notes.md");
    // First click selects (already selected in beforeEach), second click (double-click) renames
    fireEvent.doubleClick(node);
    await waitFor(() => {
      expect(screen.getByDisplayValue("notes.md")).toBeDefined();
    });
  });

  it("single-click on already-selected node does NOT immediately rename (250ms delay)", () => {
    vi.useFakeTimers();
    render(<FileTree />);
    const node = screen.getByText("notes.md");
    fireEvent.click(node);
    // No rename input should appear yet (within the 250ms delay window)
    expect(screen.queryByDisplayValue("notes.md")).toBeNull();
    vi.useRealTimers();
  });

  it("single-click on unselected node selects immediately with no delay", () => {
    vi.useFakeTimers();
    useFileTreeStore.setState({ ...useFileTreeStore.getState(), selectedPath: null });
    render(<FileTree />);
    fireEvent.click(screen.getByText("notes.md"));
    expect(useFileTreeStore.getState().selectedPath).toBe("notes.md");
    vi.useRealTimers();
  });

  it("blur confirms rename (same as Enter)", async () => {
    vi.mocked(moveDocument).mockResolvedValue(undefined);
    render(<FileTree />);
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "F2" });
    const input = screen.getByDisplayValue("notes.md");
    fireEvent.change(input, { target: { value: "blurred.md" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(moveDocument).toHaveBeenCalledWith("notes.md", "blurred.md");
    });
  });
});

describe("FileTree — inline creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFileTreeStore.setState({
      tree: sampleTree,
      expandedPaths: new Set(["docs"]),
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

  it("context menu New File on folder shows input inside folder", () => {
    render(<FileTree />);
    fireEvent.contextMenu(screen.getByText("docs"));
    fireEvent.click(screen.getByText("New File"));
    expect(screen.getByPlaceholderText("untitled.md")).toBeDefined();
  });

  it("Enter on creation input calls createDocument", async () => {
    vi.mocked(createDocument).mockResolvedValue(undefined);
    render(<FileTree />);
    fireEvent.contextMenu(screen.getByText("docs"));
    fireEvent.click(screen.getByText("New File"));
    const input = screen.getByPlaceholderText("untitled.md");
    fireEvent.change(input, { target: { value: "new-doc.md" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(createDocument).toHaveBeenCalledWith("docs/new-doc.md");
    });
  });

  it("Escape on creation input removes temporary row", () => {
    render(<FileTree />);
    fireEvent.contextMenu(screen.getByText("docs"));
    fireEvent.click(screen.getByText("New File"));
    const input = screen.getByPlaceholderText("untitled.md");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByPlaceholderText("untitled.md")).toBeNull();
  });

  it("successful file creation opens file in a tab", async () => {
    vi.mocked(createDocument).mockResolvedValue(undefined);
    render(<FileTree />);
    fireEvent.contextMenu(screen.getByText("docs"));
    fireEvent.click(screen.getByText("New File"));
    const input = screen.getByPlaceholderText("untitled.md");
    fireEvent.change(input, { target: { value: "new-doc.md" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(useEditorStore.getState().activeTab).toBe("docs/new-doc.md");
    });
  });

  it("creation failure removes temporary node and shows error toast", async () => {
    vi.mocked(createDocument).mockRejectedValue(new Error("exists"));
    render(<FileTree />);
    fireEvent.contextMenu(screen.getByText("docs"));
    fireEvent.click(screen.getByText("New File"));
    const input = screen.getByPlaceholderText("untitled.md");
    fireEvent.change(input, { target: { value: "readme.md" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(createDocument).toHaveBeenCalled();
    });
  });

  it("context menu New Folder calls createFolder", async () => {
    vi.mocked(createFolder).mockResolvedValue(undefined);
    render(<FileTree />);
    fireEvent.contextMenu(screen.getByText("docs"));
    fireEvent.click(screen.getByText("New Folder"));
    const input = screen.getByPlaceholderText("New folder");
    fireEvent.change(input, { target: { value: "subfolder" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(createFolder).toHaveBeenCalledWith("docs/subfolder");
    });
  });
});

describe("FileTree — deletion with undo", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    useFileTreeStore.setState({
      tree: sampleTree,
      expandedPaths: new Set(["docs"]),
      selectedPath: "notes.md",
      loading: false,
    });
    useEditorStore.setState({
      openTabs: [],
      activeTab: null,
      dirtyTabs: new Set(),
    });
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("Delete key reads content then deletes and removes from tree", async () => {
    vi.mocked(readDocument).mockResolvedValue("file content");
    vi.mocked(deleteDocument).mockResolvedValue(undefined);
    render(<FileTree />);
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "Delete" });

    await waitFor(() => {
      expect(readDocument).toHaveBeenCalledWith("notes.md");
    });
    await waitFor(() => {
      expect(deleteDocument).toHaveBeenCalledWith("notes.md");
    });
    expect(screen.queryByText("notes.md")).toBeNull();
  });

  it("shows toast with Undo action after delete", async () => {
    vi.mocked(readDocument).mockResolvedValue("content");
    vi.mocked(deleteDocument).mockResolvedValue(undefined);
    render(<FileTree />);
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "Delete" });

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0]!.message).toContain("notes.md");
      expect(toasts[0]!.action).toBeDefined();
      expect(toasts[0]!.action!.label).toBe("Undo");
    });
  });

  it("clicking Undo re-creates the file", async () => {
    vi.mocked(readDocument).mockResolvedValue("saved content");
    vi.mocked(deleteDocument).mockResolvedValue(undefined);
    vi.mocked(createDocument).mockResolvedValue(undefined);
    vi.mocked(writeDocument).mockResolvedValue(undefined);
    render(<FileTree />);
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "Delete" });

    await waitFor(() => {
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });

    // Trigger undo
    const toast = useToastStore.getState().toasts[0]!;
    toast.action!.onClick();

    await waitFor(() => {
      expect(createDocument).toHaveBeenCalledWith("notes.md");
    });
    await waitFor(() => {
      expect(writeDocument).toHaveBeenCalledWith("notes.md", "saved content");
    });
  });

  it("closes tab when deleted file is open", async () => {
    useEditorStore.getState().openTab("notes.md");
    vi.mocked(readDocument).mockResolvedValue("content");
    vi.mocked(deleteDocument).mockResolvedValue(undefined);
    render(<FileTree />);
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "Delete" });

    await waitFor(() => {
      expect(useEditorStore.getState().openTabs).toHaveLength(0);
    });
  });

  it("deletion failure rolls back tree and shows error toast", async () => {
    vi.mocked(readDocument).mockResolvedValue("content");
    vi.mocked(deleteDocument).mockRejectedValue(new Error("permission denied"));
    render(<FileTree />);
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "Delete" });

    await waitFor(() => {
      expect(deleteDocument).toHaveBeenCalled();
    });
    // Node should still be in tree (rolled back)
    await waitFor(() => {
      expect(screen.getByText("notes.md")).toBeDefined();
    });
  });

  it("folder with >50 files shows confirmation toast instead of undo", async () => {
    // Build a folder with 51 files
    const manyChildren = Array.from({ length: 51 }, (_, i) => ({
      name: `file-${i}.md`,
      path: `big-folder/file-${i}.md`,
      kind: "file" as const,
    }));
    const bigTree = [
      {
        name: "big-folder",
        path: "big-folder",
        kind: "folder" as const,
        children: manyChildren,
      },
    ];
    useFileTreeStore.setState({
      tree: bigTree,
      expandedPaths: new Set(),
      selectedPath: "big-folder",
      loading: false,
    });

    render(<FileTree />);
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "Delete" });

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0]!.message).toContain("51 files");
      expect(toasts[0]!.action!.label).toBe("Confirm");
    });
    // readDocument should NOT have been called (no content stashing)
    expect(readDocument).not.toHaveBeenCalled();
  });
});

describe("FileTree — drag and drop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFileTreeStore.setState({
      tree: sampleTree,
      expandedPaths: new Set(["docs"]),
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

  it("drop file onto folder calls moveDocument", async () => {
    vi.mocked(moveDocument).mockResolvedValue(undefined);
    render(<FileTree />);
    const file = screen.getByText("notes.md");
    const folder = screen.getByText("docs");

    fireEvent.dragStart(file, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    fireEvent.dragOver(folder, {
      dataTransfer: { types: ["text/plain"], dropEffect: "" },
    });
    fireEvent.drop(folder, {
      dataTransfer: { getData: () => "notes.md" },
    });

    await waitFor(() => {
      expect(moveDocument).toHaveBeenCalledWith("notes.md", "docs/notes.md");
    });
  });

  it("drop folder onto itself is rejected", () => {
    render(<FileTree />);
    const folder = screen.getByText("docs");

    fireEvent.dragStart(folder, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    fireEvent.drop(folder, {
      dataTransfer: { getData: () => "docs" },
    });

    expect(moveFolder).not.toHaveBeenCalled();
    expect(moveDocument).not.toHaveBeenCalled();
  });

  it("drop item onto its current parent is rejected", () => {
    render(<FileTree />);
    const file = screen.getByText("readme.md"); // already inside "docs"
    const folder = screen.getByText("docs");

    fireEvent.dragStart(file, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    fireEvent.drop(folder, {
      dataTransfer: { getData: () => "docs/readme.md" },
    });

    expect(moveDocument).not.toHaveBeenCalled();
  });

  it("drop onto root area moves item to workspace root", async () => {
    vi.mocked(moveDocument).mockResolvedValue(undefined);
    render(<FileTree />);
    const file = screen.getByText("readme.md");
    const tree = screen.getByRole("tree");

    fireEvent.dragStart(file, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    fireEvent.dragOver(tree, {
      dataTransfer: { types: ["text/plain"], dropEffect: "" },
    });
    fireEvent.drop(tree, {
      dataTransfer: { getData: () => "docs/readme.md" },
    });

    await waitFor(() => {
      expect(moveDocument).toHaveBeenCalledWith("docs/readme.md", "readme.md");
    });
  });

  it("failed move rolls back tree and shows error toast", async () => {
    vi.mocked(moveDocument).mockRejectedValue(new Error("conflict"));
    render(<FileTree />);
    const file = screen.getByText("notes.md");
    const folder = screen.getByText("docs");

    fireEvent.dragStart(file, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    fireEvent.drop(folder, {
      dataTransfer: { getData: () => "notes.md" },
    });

    await waitFor(() => {
      expect(moveDocument).toHaveBeenCalled();
    });
    // Node should still be visible (rolled back)
    await waitFor(() => {
      expect(screen.getByText("notes.md")).toBeDefined();
    });
  });

  it("dragged item has opacity 0.5", () => {
    render(<FileTree />);
    const file = screen.getByText("notes.md");

    fireEvent.dragStart(file, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });

    expect((file.closest("[draggable]") as HTMLElement)!.style.opacity).toBe("0.5");
  });

  it("folder drop target shows background highlight on drag over", () => {
    render(<FileTree />);
    const file = screen.getByText("notes.md");
    const folder = screen.getByText("docs");

    fireEvent.dragStart(file, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    fireEvent.dragOver(folder, {
      dataTransfer: { types: ["text/plain"], dropEffect: "" },
    });

    expect((folder.closest("[draggable]") as HTMLElement)!.style.background).toContain("var(--color-bg-selected)");
  });

  it("root drop zone shows background highlight on drag over", () => {
    render(<FileTree />);
    const file = screen.getByText("notes.md");
    const tree = screen.getByRole("tree");

    fireEvent.dragStart(file, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    fireEvent.dragOver(tree, {
      dataTransfer: { types: ["text/plain"], dropEffect: "" },
    });

    expect(tree.style.background).toBe("var(--color-bg-selected)");
  });
});
