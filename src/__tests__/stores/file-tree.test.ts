import { describe, it, expect, beforeEach } from "vitest";
import { useFileTreeStore } from "../../stores/file-tree";

describe("fileTreeStore", () => {
  beforeEach(() => {
    useFileTreeStore.setState({
      tree: [],
      expandedPaths: new Set(),
      selectedPath: null,
      loading: false,
      pendingCreation: null,
      pendingRename: null,
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

  it("setLoading toggles loading flag", () => {
    useFileTreeStore.getState().setLoading(true);
    expect(useFileTreeStore.getState().loading).toBe(true);
    useFileTreeStore.getState().setLoading(false);
    expect(useFileTreeStore.getState().loading).toBe(false);
  });

  it("snapshotTree returns a deep copy", () => {
    const tree = [
      {
        name: "notes",
        path: "notes",
        kind: "folder" as const,
        children: [{ name: "a.md", path: "notes/a.md", kind: "file" as const }],
      },
    ];
    useFileTreeStore.getState().setTree(tree);
    const snapshot = useFileTreeStore.getState().snapshotTree();

    // Mutate the store
    useFileTreeStore.getState().setTree([]);
    expect(useFileTreeStore.getState().tree).toEqual([]);

    // Snapshot is unaffected
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]!.children).toHaveLength(1);
  });

  it("rollbackTree restores previous state", () => {
    const tree = [{ name: "a.md", path: "a.md", kind: "file" as const }];
    useFileTreeStore.getState().setTree(tree);
    const snapshot = useFileTreeStore.getState().snapshotTree();

    useFileTreeStore.getState().setTree([]);
    useFileTreeStore.getState().rollbackTree(snapshot);
    expect(useFileTreeStore.getState().tree).toEqual(tree);
  });

  describe("pendingCreation", () => {
    it("defaults to null", () => {
      expect(useFileTreeStore.getState().pendingCreation).toBeNull();
    });

    it("sets pending creation", () => {
      useFileTreeStore.getState().setPendingCreation({ type: "file", parentPath: "" });
      expect(useFileTreeStore.getState().pendingCreation).toEqual({
        type: "file",
        parentPath: "",
      });
    });

    it("clears pending creation", () => {
      useFileTreeStore.getState().setPendingCreation({ type: "file", parentPath: "" });
      useFileTreeStore.getState().clearPendingCreation();
      expect(useFileTreeStore.getState().pendingCreation).toBeNull();
    });
  });

  describe("pendingRename", () => {
    it("defaults to null", () => {
      expect(useFileTreeStore.getState().pendingRename).toBeNull();
    });

    it("sets pending rename path", () => {
      useFileTreeStore.getState().setPendingRename("docs/readme.md");
      expect(useFileTreeStore.getState().pendingRename).toBe("docs/readme.md");
    });

    it("clears pending rename", () => {
      useFileTreeStore.getState().setPendingRename("docs/readme.md");
      useFileTreeStore.getState().clearPendingRename();
      expect(useFileTreeStore.getState().pendingRename).toBeNull();
    });
  });
});
