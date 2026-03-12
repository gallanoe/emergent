import type { TreeNode } from "./tauri";

export function sortTree(tree: TreeNode[]): TreeNode[] {
  return tree
    .map((node) => ({
      ...node,
      children: node.children ? sortTree(node.children) : undefined,
    }))
    .sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
}
