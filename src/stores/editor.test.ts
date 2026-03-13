// src/__tests__/stores/editor.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { editorStore } from "./editor.svelte";

describe("EditorStore (Svelte)", () => {
  beforeEach(() => {
    editorStore.openTabs = [];
    editorStore.activeTab = null;
    editorStore.dirtyTabs.clear();
  });

  it("opens a tab", () => {
    editorStore.openTab("notes/hello.md");
    expect(editorStore.openTabs).toHaveLength(1);
    expect(editorStore.openTabs[0]!.path).toBe("notes/hello.md");
    expect(editorStore.activeTab).toBe("notes/hello.md");
  });

  it("does not duplicate tabs", () => {
    editorStore.openTab("hello.md");
    editorStore.openTab("hello.md");
    expect(editorStore.openTabs).toHaveLength(1);
  });

  it("closes a tab", () => {
    editorStore.openTab("a.md");
    editorStore.openTab("b.md");
    editorStore.closeTab("a.md");
    expect(editorStore.openTabs).toHaveLength(1);
    expect(editorStore.activeTab).toBe("b.md");
  });

  it("marks tab as dirty", () => {
    editorStore.openTab("a.md");
    editorStore.markDirty("a.md");
    expect(editorStore.dirtyTabs.has("a.md")).toBe(true);
  });

  it("marks tab as clean", () => {
    editorStore.openTab("a.md");
    editorStore.markDirty("a.md");
    editorStore.markClean("a.md");
    expect(editorStore.dirtyTabs.has("a.md")).toBe(false);
  });

  it("closing last tab sets activeTab to null", () => {
    editorStore.openTab("a.md");
    editorStore.closeTab("a.md");
    expect(editorStore.activeTab).toBeNull();
  });

  describe("updateTabPath", () => {
    it("updates path and name of matching tab", () => {
      editorStore.openTab("notes/old.md");
      editorStore.updateTabPath("notes/old.md", "notes/new.md");
      expect(editorStore.openTabs[0]!.path).toBe("notes/new.md");
      expect(editorStore.openTabs[0]!.name).toBe("new.md");
    });

    it("updates activeTab if it matches old path", () => {
      editorStore.openTab("notes/old.md");
      editorStore.updateTabPath("notes/old.md", "notes/new.md");
      expect(editorStore.activeTab).toBe("notes/new.md");
    });

    it("moves dirty flag from old path to new path", () => {
      editorStore.openTab("notes/old.md");
      editorStore.markDirty("notes/old.md");
      editorStore.updateTabPath("notes/old.md", "notes/new.md");
      expect(editorStore.dirtyTabs.has("notes/old.md")).toBe(false);
      expect(editorStore.dirtyTabs.has("notes/new.md")).toBe(true);
    });

    it("no-ops if old path is not in openTabs", () => {
      editorStore.openTab("a.md");
      editorStore.updateTabPath("nonexistent.md", "new.md");
      expect(editorStore.openTabs).toHaveLength(1);
      expect(editorStore.openTabs[0]!.path).toBe("a.md");
    });

    it("handles folder rename — updates all tabs with matching prefix", () => {
      editorStore.openTab("notes/a.md");
      editorStore.openTab("notes/sub/b.md");
      editorStore.openTab("other.md");
      editorStore.setActiveTab("notes/a.md");
      editorStore.updateTabPath("notes", "archive");
      expect(editorStore.openTabs[0]!.path).toBe("archive/a.md");
      expect(editorStore.openTabs[1]!.path).toBe("archive/sub/b.md");
      expect(editorStore.openTabs[2]!.path).toBe("other.md");
      expect(editorStore.activeTab).toBe("archive/a.md");
    });
  });
});
