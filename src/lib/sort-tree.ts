import type { TreeNode } from "./tauri";

export function sortTree(tree: TreeNode[]): TreeNode[] {
  return tree
    .map((node) => {
      const copy: TreeNode = { name: node.name, path: node.path, kind: node.kind };
      if (node.children) copy.children = sortTree(node.children);
      return copy;
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
}
