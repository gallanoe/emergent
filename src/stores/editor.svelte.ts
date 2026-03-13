// src/stores/editor.svelte.ts
import { SvelteSet } from "svelte/reactivity";

export type Tab = {
  path: string;
  name: string;
};

class EditorStore {
  openTabs: Tab[] = $state([]);
  activeTab: string | null = $state(null);
  dirtyTabs = new SvelteSet<string>();

  openTab(path: string) {
    const exists = this.openTabs.some((t) => t.path === path);
    if (!exists) {
      const name = path.split("/").pop() ?? path;
      this.openTabs = [...this.openTabs, { path, name }];
    }
    this.activeTab = path;
  }

  closeTab(path: string) {
    const idx = this.openTabs.findIndex((t) => t.path === path);
    const filtered = this.openTabs.filter((t) => t.path !== path);
    this.dirtyTabs.delete(path);

    if (this.activeTab === path) {
      this.activeTab =
        filtered.length === 0
          ? null
          : (filtered[Math.min(idx, filtered.length - 1)]?.path ?? null);
    }
    this.openTabs = filtered;
  }

  setActiveTab(path: string) {
    this.activeTab = path;
  }

  markDirty(path: string) {
    this.dirtyTabs.add(path);
  }

  markClean(path: string) {
    this.dirtyTabs.delete(path);
  }

  updateTabPath(oldPath: string, newPath: string) {
    const isExactMatch = this.openTabs.some((t) => t.path === oldPath);
    const isFolderRename =
      !isExactMatch && this.openTabs.some((t) => t.path.startsWith(oldPath + "/"));

    if (!isExactMatch && !isFolderRename) return;

    const newDirty = new SvelteSet<string>();
    const newTabs = this.openTabs.map((t) => {
      let newTabPath: string;
      if (isExactMatch && t.path === oldPath) {
        newTabPath = newPath;
      } else if (isFolderRename && t.path.startsWith(oldPath + "/")) {
        newTabPath = newPath + t.path.slice(oldPath.length);
      } else {
        if (this.dirtyTabs.has(t.path)) newDirty.add(t.path);
        return t;
      }
      if (this.dirtyTabs.has(t.path)) newDirty.add(newTabPath);
      return { path: newTabPath, name: newTabPath.split("/").pop() ?? newTabPath };
    });

    let newActive = this.activeTab;
    if (this.activeTab) {
      if (isExactMatch && this.activeTab === oldPath) {
        newActive = newPath;
      } else if (isFolderRename && this.activeTab.startsWith(oldPath + "/")) {
        newActive = newPath + this.activeTab.slice(oldPath.length);
      }
    }

    this.openTabs = newTabs;
    this.activeTab = newActive;
    this.dirtyTabs.clear();
    for (const p of newDirty) this.dirtyTabs.add(p);
  }
}

export const editorStore = new EditorStore();
