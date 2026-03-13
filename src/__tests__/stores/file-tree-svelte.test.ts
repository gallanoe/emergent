// src/__tests__/stores/file-tree-svelte.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { fileTreeStore } from "../../stores/file-tree.svelte";

describe("FileTreeStore (Svelte)", () => {
  beforeEach(() => {
    fileTreeStore.tree = [];
    fileTreeStore.expandedPaths.clear();
    fileTreeStore.selectedPath = null;
    fileTreeStore.loading = false;
    fileTreeStore.pendingCreation = null;
    fileTreeStore.pendingRename = null;
  });

  it("sets tree data", () => {
    const mockTree = [{ name: "notes", path: "notes", kind: "folder" as const, children: [] }];
    fileTreeStore.setTree(mockTree);
    expect(fileTreeStore.tree).toEqual(mockTree);
  });

  it("toggles expanded state", () => {
    fileTreeStore.toggleExpanded("notes");
    expect(fileTreeStore.expandedPaths.has("notes")).toBe(true);
    fileTreeStore.toggleExpanded("notes");
    expect(fileTreeStore.expandedPaths.has("notes")).toBe(false);
  });

  it("sets selected path", () => {
    fileTreeStore.setSelected("notes/hello.md");
    expect(fileTreeStore.selectedPath).toBe("notes/hello.md");
  });

  it("clears selected path", () => {
    fileTreeStore.setSelected("test.md");
    fileTreeStore.setSelected(null);
    expect(fileTreeStore.selectedPath).toBeNull();
  });

  it("setLoading toggles loading flag", () => {
    fileTreeStore.setLoading(true);
    expect(fileTreeStore.loading).toBe(true);
    fileTreeStore.setLoading(false);
    expect(fileTreeStore.loading).toBe(false);
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
    fileTreeStore.setTree(tree);
    const snapshot = fileTreeStore.snapshotTree();

    fileTreeStore.setTree([]);
    expect(fileTreeStore.tree).toEqual([]);

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]!.children).toHaveLength(1);
  });

  it("rollbackTree restores previous state", () => {
    const tree = [{ name: "a.md", path: "a.md", kind: "file" as const }];
    fileTreeStore.setTree(tree);
    const snapshot = fileTreeStore.snapshotTree();

    fileTreeStore.setTree([]);
    fileTreeStore.rollbackTree(snapshot);
    expect(fileTreeStore.tree).toEqual(tree);
  });

  describe("pendingCreation", () => {
    it("defaults to null", () => {
      expect(fileTreeStore.pendingCreation).toBeNull();
    });

    it("sets pending creation", () => {
      fileTreeStore.setPendingCreation({ type: "file", parentPath: "" });
      expect(fileTreeStore.pendingCreation).toEqual({ type: "file", parentPath: "" });
    });

    it("clears pending creation", () => {
      fileTreeStore.setPendingCreation({ type: "file", parentPath: "" });
      fileTreeStore.clearPendingCreation();
      expect(fileTreeStore.pendingCreation).toBeNull();
    });
  });

  describe("pendingRename", () => {
    it("defaults to null", () => {
      expect(fileTreeStore.pendingRename).toBeNull();
    });

    it("sets pending rename path", () => {
      fileTreeStore.setPendingRename("docs/readme.md");
      expect(fileTreeStore.pendingRename).toBe("docs/readme.md");
    });

    it("clears pending rename", () => {
      fileTreeStore.setPendingRename("docs/readme.md");
      fileTreeStore.clearPendingRename();
      expect(fileTreeStore.pendingRename).toBeNull();
    });
  });
});
