import { create } from "zustand";
import type { TreeNode } from "../lib/tauri";

type FileTreeState = {
  tree: TreeNode[];
  expandedPaths: Set<string>;
  selectedPath: string | null;
  setTree: (tree: TreeNode[]) => void;
  toggleExpanded: (path: string) => void;
  setSelected: (path: string | null) => void;
};

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
  tree: [],
  expandedPaths: new Set(),
  selectedPath: null,
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
}));
