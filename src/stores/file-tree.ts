import { create } from "zustand";
import type { TreeNode } from "../lib/tauri";

function deepCopyTree(tree: TreeNode[]): TreeNode[] {
  return tree.map((node) => ({
    ...node,
    children: node.children ? deepCopyTree(node.children) : undefined,
  }));
}

type FileTreeState = {
  tree: TreeNode[];
  expandedPaths: Set<string>;
  selectedPath: string | null;
  loading: boolean;
  setTree: (tree: TreeNode[]) => void;
  toggleExpanded: (path: string) => void;
  setSelected: (path: string | null) => void;
  setLoading: (loading: boolean) => void;
  snapshotTree: () => TreeNode[];
  rollbackTree: (snapshot: TreeNode[]) => void;
};

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
  tree: [],
  expandedPaths: new Set(),
  selectedPath: null,
  loading: false,
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
}));
