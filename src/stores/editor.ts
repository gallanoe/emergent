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
        filtered.length === 0
          ? null
          : filtered[Math.min(idx, filtered.length - 1)]?.path ?? null;
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
}));
