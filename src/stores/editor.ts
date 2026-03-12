import { create } from "zustand";

export type Tab = {
  path: string;
  name: string;
};

type EditorState = {
  openTabs: Tab[];
  activeTab: string | null;
  dirtyTabs: Set<string>;
  openTab: (path: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  markDirty: (path: string) => void;
  markClean: (path: string) => void;
  updateTabPath: (oldPath: string, newPath: string) => void;
};

export const useEditorStore = create<EditorState>((set, get) => ({
  openTabs: [],
  activeTab: null,
  dirtyTabs: new Set(),

  openTab: (path: string) => {
    const { openTabs } = get();
    const exists = openTabs.some((t) => t.path === path);
    if (!exists) {
      const name = path.split("/").pop() ?? path;
      set({ openTabs: [...openTabs, { path, name }] });
    }
    set({ activeTab: path });
  },

  closeTab: (path: string) => {
    const { openTabs, activeTab, dirtyTabs } = get();
    const filtered = openTabs.filter((t) => t.path !== path);
    const newDirty = new Set(dirtyTabs);
    newDirty.delete(path);

    let newActive = activeTab;
    if (activeTab === path) {
      const idx = openTabs.findIndex((t) => t.path === path);
      newActive =
        filtered.length === 0 ? null : (filtered[Math.min(idx, filtered.length - 1)]?.path ?? null);
    }

    set({ openTabs: filtered, activeTab: newActive, dirtyTabs: newDirty });
  },

  setActiveTab: (path: string) => set({ activeTab: path }),

  markDirty: (path: string) => {
    const newDirty = new Set(get().dirtyTabs);
    newDirty.add(path);
    set({ dirtyTabs: newDirty });
  },

  markClean: (path: string) => {
    const newDirty = new Set(get().dirtyTabs);
    newDirty.delete(path);
    set({ dirtyTabs: newDirty });
  },

  updateTabPath: (oldPath: string, newPath: string) => {
    const { openTabs, activeTab, dirtyTabs } = get();

    // Check if this is an exact file match or a folder prefix
    const isExactMatch = openTabs.some((t) => t.path === oldPath);
    const isFolderRename = !isExactMatch && openTabs.some((t) => t.path.startsWith(oldPath + "/"));

    if (!isExactMatch && !isFolderRename) return;

    const newDirty = new Set<string>();
    const newTabs = openTabs.map((t) => {
      let newTabPath: string;
      if (isExactMatch && t.path === oldPath) {
        newTabPath = newPath;
      } else if (isFolderRename && t.path.startsWith(oldPath + "/")) {
        newTabPath = newPath + t.path.slice(oldPath.length);
      } else {
        if (dirtyTabs.has(t.path)) newDirty.add(t.path);
        return t;
      }
      if (dirtyTabs.has(t.path)) newDirty.add(newTabPath);
      return { path: newTabPath, name: newTabPath.split("/").pop() ?? newTabPath };
    });

    let newActive = activeTab;
    if (activeTab) {
      if (isExactMatch && activeTab === oldPath) {
        newActive = newPath;
      } else if (isFolderRename && activeTab.startsWith(oldPath + "/")) {
        newActive = newPath + activeTab.slice(oldPath.length);
      }
    }

    set({ openTabs: newTabs, activeTab: newActive, dirtyTabs: newDirty });
  },
}));
