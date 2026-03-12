import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../../stores/editor";

describe("editorStore", () => {
  beforeEach(() => {
    useEditorStore.setState({
      openTabs: [],
      activeTab: null,
      dirtyTabs: new Set(),
    });
  });

  it("opens a tab", () => {
    useEditorStore.getState().openTab("notes/hello.md");
    const state = useEditorStore.getState();
    expect(state.openTabs).toHaveLength(1);
    expect(state.openTabs[0]!.path).toBe("notes/hello.md");
    expect(state.activeTab).toBe("notes/hello.md");
  });

  it("does not duplicate tabs", () => {
    useEditorStore.getState().openTab("hello.md");
    useEditorStore.getState().openTab("hello.md");
    expect(useEditorStore.getState().openTabs).toHaveLength(1);
  });

  it("closes a tab", () => {
    useEditorStore.getState().openTab("a.md");
    useEditorStore.getState().openTab("b.md");
    useEditorStore.getState().closeTab("a.md");
    const state = useEditorStore.getState();
    expect(state.openTabs).toHaveLength(1);
    expect(state.activeTab).toBe("b.md");
  });

  it("marks tab as dirty", () => {
    useEditorStore.getState().openTab("a.md");
    useEditorStore.getState().markDirty("a.md");
    expect(useEditorStore.getState().dirtyTabs.has("a.md")).toBe(true);
  });

  it("marks tab as clean", () => {
    useEditorStore.getState().openTab("a.md");
    useEditorStore.getState().markDirty("a.md");
    useEditorStore.getState().markClean("a.md");
    expect(useEditorStore.getState().dirtyTabs.has("a.md")).toBe(false);
  });

  it("closing last tab sets activeTab to null", () => {
    useEditorStore.getState().openTab("a.md");
    useEditorStore.getState().closeTab("a.md");
    expect(useEditorStore.getState().activeTab).toBeNull();
  });

  describe("updateTabPath", () => {
    it("updates path and name of matching tab", () => {
      useEditorStore.getState().openTab("notes/old.md");
      useEditorStore.getState().updateTabPath("notes/old.md", "notes/new.md");
      const state = useEditorStore.getState();
      expect(state.openTabs[0]!.path).toBe("notes/new.md");
      expect(state.openTabs[0]!.name).toBe("new.md");
    });

    it("updates activeTab if it matches old path", () => {
      useEditorStore.getState().openTab("notes/old.md");
      useEditorStore.getState().updateTabPath("notes/old.md", "notes/new.md");
      expect(useEditorStore.getState().activeTab).toBe("notes/new.md");
    });

    it("moves dirty flag from old path to new path", () => {
      useEditorStore.getState().openTab("notes/old.md");
      useEditorStore.getState().markDirty("notes/old.md");
      useEditorStore.getState().updateTabPath("notes/old.md", "notes/new.md");
      const state = useEditorStore.getState();
      expect(state.dirtyTabs.has("notes/old.md")).toBe(false);
      expect(state.dirtyTabs.has("notes/new.md")).toBe(true);
    });

    it("no-ops if old path is not in openTabs", () => {
      useEditorStore.getState().openTab("a.md");
      useEditorStore.getState().updateTabPath("nonexistent.md", "new.md");
      const state = useEditorStore.getState();
      expect(state.openTabs).toHaveLength(1);
      expect(state.openTabs[0]!.path).toBe("a.md");
    });

    it("handles folder rename — updates all tabs with matching prefix", () => {
      useEditorStore.getState().openTab("notes/a.md");
      useEditorStore.getState().openTab("notes/sub/b.md");
      useEditorStore.getState().openTab("other.md");
      useEditorStore.getState().setActiveTab("notes/a.md");
      useEditorStore.getState().updateTabPath("notes", "archive");
      const state = useEditorStore.getState();
      expect(state.openTabs[0]!.path).toBe("archive/a.md");
      expect(state.openTabs[1]!.path).toBe("archive/sub/b.md");
      expect(state.openTabs[2]!.path).toBe("other.md");
      expect(state.activeTab).toBe("archive/a.md");
    });
  });
});
