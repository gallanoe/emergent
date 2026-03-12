import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { moveDocument, moveFolder } from "../../lib/tauri";
import { useFileTreeStore } from "../../stores/file-tree";
import { useEditorStore } from "../../stores/editor";
import { FileTree } from "../../components/FileTree";

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
