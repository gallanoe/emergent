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
    expect(state.openTabs[0].path).toBe("notes/hello.md");
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
});
