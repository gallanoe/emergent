// src/stores/file-tree.svelte.ts
import { SvelteSet } from "svelte/reactivity";
import type { TreeNode } from "../lib/tauri";

function deepCopyTree(tree: TreeNode[]): TreeNode[] {
  return tree.map((node) => {
    const copy: TreeNode = { name: node.name, path: node.path, kind: node.kind };
    if (node.children) copy.children = deepCopyTree(node.children);
    return copy;
  });
}

class FileTreeStore {
  tree = $state.raw<TreeNode[]>([]);
  expandedPaths = new SvelteSet<string>();
  selectedPath: string | null = $state(null);
  loading = $state(false);
  pendingCreation: { type: "file" | "folder"; parentPath: string } | null = $state(null);
  pendingRename: string | null = $state(null);

  setTree(tree: TreeNode[]) {
    this.tree = tree;
  }

  toggleExpanded(path: string) {
    if (this.expandedPaths.has(path)) {
      this.expandedPaths.delete(path);
    } else {
      this.expandedPaths.add(path);
    }
  }

  setSelected(path: string | null) {
    this.selectedPath = path;
  }

  setLoading(loading: boolean) {
    this.loading = loading;
  }

  snapshotTree(): TreeNode[] {
    return deepCopyTree(this.tree);
  }

  rollbackTree(snapshot: TreeNode[]) {
    this.tree = snapshot;
  }

  setPendingCreation(pending: { type: "file" | "folder"; parentPath: string }) {
    this.pendingCreation = pending;
  }

  clearPendingCreation() {
    this.pendingCreation = null;
  }

  setPendingRename(path: string) {
    this.pendingRename = path;
  }

  clearPendingRename() {
    this.pendingRename = null;
  }
}

export const fileTreeStore = new FileTreeStore();
