import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
