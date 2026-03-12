import { describe, it, expect, beforeEach } from "vitest";
import { useFileTreeStore } from "../../stores/file-tree";

describe("fileTreeStore", () => {
  beforeEach(() => {
    useFileTreeStore.setState({
      tree: [],
      expandedPaths: new Set(),
      selectedPath: null,
    });
  });

  it("sets tree data", () => {
    const mockTree = [{ name: "notes", path: "notes", kind: "folder" as const, children: [] }];
    useFileTreeStore.getState().setTree(mockTree);
    expect(useFileTreeStore.getState().tree).toEqual(mockTree);
  });

  it("toggles expanded state", () => {
    useFileTreeStore.getState().toggleExpanded("notes");
    expect(useFileTreeStore.getState().expandedPaths.has("notes")).toBe(true);
    useFileTreeStore.getState().toggleExpanded("notes");
    expect(useFileTreeStore.getState().expandedPaths.has("notes")).toBe(false);
  });

  it("sets selected path", () => {
    useFileTreeStore.getState().setSelected("notes/hello.md");
    expect(useFileTreeStore.getState().selectedPath).toBe("notes/hello.md");
  });

  it("clears selected path", () => {
    useFileTreeStore.getState().setSelected("test.md");
    useFileTreeStore.getState().setSelected(null);
    expect(useFileTreeStore.getState().selectedPath).toBeNull();
  });
});
