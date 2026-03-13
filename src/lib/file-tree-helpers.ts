// src/lib/file-tree-helpers.ts
import type { TreeNode } from "./tauri";

export function findNode(tree: TreeNode[], path: string): TreeNode | null {
  for (const node of tree) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

export function updateChildPaths(
  children: TreeNode[],
  oldParentPath: string,
  newParentPath: string,
): TreeNode[] {
  return children.map((child) => {
    const childNewPath = newParentPath + child.path.substring(oldParentPath.length);
    const copy: TreeNode = { name: child.name, path: childNewPath, kind: child.kind };
    if (child.children)
      copy.children = updateChildPaths(child.children, oldParentPath, newParentPath);
    return copy;
  });
}

export function renameNodeInTree(
  tree: TreeNode[],
  oldPath: string,
  newName: string,
  newPath: string,
): TreeNode[] {
  return tree.map((node) => {
    if (node.path === oldPath) {
      const copy: TreeNode = { name: newName, path: newPath, kind: node.kind };
      if (node.children) copy.children = updateChildPaths(node.children, oldPath, newPath);
      return copy;
    }
    if (node.children) {
      const copy: TreeNode = { name: node.name, path: node.path, kind: node.kind };
      copy.children = renameNodeInTree(node.children, oldPath, newName, newPath);
      return copy;
    }
    return node;
  });
}

export function removeNodeFromTree(tree: TreeNode[], path: string): TreeNode[] {
  return tree
    .filter((node) => node.path !== path)
    .map((node) => {
      if (!node.children) return node;
      const copy: TreeNode = { name: node.name, path: node.path, kind: node.kind };
      copy.children = removeNodeFromTree(node.children, path);
      return copy;
    });
}

export function insertNodeInTree(tree: TreeNode[], parentPath: string, node: TreeNode): TreeNode[] {
  if (!parentPath) {
    return [...tree, node];
  }
  return tree.map((n) => {
    if (n.path === parentPath && n.kind === "folder") {
      const copy: TreeNode = { name: n.name, path: n.path, kind: n.kind };
      copy.children = [...(n.children ?? []), node];
      return copy;
    }
    if (n.children) {
      const copy: TreeNode = { name: n.name, path: n.path, kind: n.kind };
      copy.children = insertNodeInTree(n.children, parentPath, node);
      return copy;
    }
    return n;
  });
}

export function countFilesInSubtree(node: TreeNode): number {
  if (node.kind === "file") return 1;
  if (!node.children) return 0;
  return node.children.reduce((sum, child) => sum + countFilesInSubtree(child), 0);
}

export async function stashFolderContents(
  node: TreeNode,
  readDocument: (path: string) => Promise<string>,
): Promise<Map<string, string>> {
  const stash = new Map<string, string>();
  const collect = async (n: TreeNode) => {
    if (n.kind === "file") {
      const content = await readDocument(n.path);
      stash.set(n.path, content);
    } else if (n.children) {
      for (const child of n.children) {
        await collect(child);
      }
    }
  };
  if (node.children) {
    for (const child of node.children) {
      await collect(child);
    }
  }
  return stash;
}
