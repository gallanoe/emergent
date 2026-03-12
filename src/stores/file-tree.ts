import { create } from "zustand";
import type { TreeNode } from "../lib/tauri";

function deepCopyTree(tree: TreeNode[]): TreeNode[] {
  return tree.map((node) => {
    const copy: TreeNode = { name: node.name, path: node.path, kind: node.kind };
    if (node.children) copy.children = deepCopyTree(node.children);
    return copy;
  });
}

type FileTreeState = {
  tree: TreeNode[];
  expandedPaths: Set<string>;
  selectedPath: string | null;
  loading: boolean;
  pendingCreation: { type: "file" | "folder"; parentPath: string } | null;
  pendingRename: string | null;
  setTree: (tree: TreeNode[]) => void;
  toggleExpanded: (path: string) => void;
  setSelected: (path: string | null) => void;
  setLoading: (loading: boolean) => void;
  snapshotTree: () => TreeNode[];
  rollbackTree: (snapshot: TreeNode[]) => void;
  setPendingCreation: (pending: { type: "file" | "folder"; parentPath: string }) => void;
  clearPendingCreation: () => void;
  setPendingRename: (path: string) => void;
  clearPendingRename: () => void;
};

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
  tree: [],
  expandedPaths: new Set(),
  selectedPath: null,
  loading: false,
  pendingCreation: null,
  pendingRename: null,
  setTree: (tree) => set({ tree }),
  toggleExpanded: (path) => {
    const expanded = new Set(get().expandedPaths);
    if (expanded.has(path)) {
      expanded.delete(path);
    } else {
      expanded.add(path);
    }
    set({ expandedPaths: expanded });
  },
  setSelected: (path) => set({ selectedPath: path }),
  setLoading: (loading) => set({ loading }),
  snapshotTree: () => deepCopyTree(get().tree),
  rollbackTree: (snapshot) => set({ tree: snapshot }),
  setPendingCreation: (pending) => set({ pendingCreation: pending }),
  clearPendingCreation: () => set({ pendingCreation: null }),
  setPendingRename: (path) => set({ pendingRename: path }),
  clearPendingRename: () => set({ pendingRename: null }),
}));
