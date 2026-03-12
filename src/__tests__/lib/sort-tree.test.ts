import { describe, it, expect } from "vitest";
import { sortTree } from "../../lib/sort-tree";
import type { TreeNode } from "../../lib/tauri";

describe("sortTree", () => {
  it("sorts folders before files", () => {
    const tree: TreeNode[] = [
      { name: "readme.md", path: "readme.md", kind: "file" },
      { name: "docs", path: "docs", kind: "folder", children: [] },
    ];
    const sorted = sortTree(tree);
    expect(sorted[0]!.name).toBe("docs");
    expect(sorted[1]!.name).toBe("readme.md");
  });

  it("sorts alphabetically within folders and files", () => {
    const tree: TreeNode[] = [
      { name: "zebra.md", path: "zebra.md", kind: "file" },
      { name: "alpha.md", path: "alpha.md", kind: "file" },
      { name: "notes", path: "notes", kind: "folder", children: [] },
      { name: "archive", path: "archive", kind: "folder", children: [] },
    ];
    const sorted = sortTree(tree);
    expect(sorted.map((n) => n.name)).toEqual(["archive", "notes", "alpha.md", "zebra.md"]);
  });

  it("sorts recursively", () => {
    const tree: TreeNode[] = [
      {
        name: "docs",
        path: "docs",
        kind: "folder",
        children: [
          { name: "z.md", path: "docs/z.md", kind: "file" },
          { name: "a.md", path: "docs/a.md", kind: "file" },
          {
            name: "sub",
            path: "docs/sub",
            kind: "folder",
            children: [
              { name: "b.md", path: "docs/sub/b.md", kind: "file" },
              { name: "a.md", path: "docs/sub/a.md", kind: "file" },
            ],
          },
        ],
      },
    ];
    const sorted = sortTree(tree);
    const docs = sorted[0]!;
    expect(docs.children![0]!.name).toBe("sub");
    expect(docs.children![1]!.name).toBe("a.md");
    expect(docs.children![2]!.name).toBe("z.md");
    expect(docs.children![0]!.children![0]!.name).toBe("a.md");
    expect(docs.children![0]!.children![1]!.name).toBe("b.md");
  });

  it("handles empty array", () => {
    expect(sortTree([])).toEqual([]);
  });

  it("sorts case-insensitively", () => {
    const tree: TreeNode[] = [
      { name: "Banana.md", path: "Banana.md", kind: "file" },
      { name: "apple.md", path: "apple.md", kind: "file" },
    ];
    const sorted = sortTree(tree);
    expect(sorted[0]!.name).toBe("apple.md");
    expect(sorted[1]!.name).toBe("Banana.md");
  });
});
