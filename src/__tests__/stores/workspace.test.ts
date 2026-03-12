import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore } from "../../stores/workspace";

describe("workspaceStore", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      activeWorkspace: null,
      workspaces: [],
      currentBranch: "main",
      mergeState: null,
    });
  });

  it("sets active workspace", () => {
    const ws = { id: "abc", name: "Test", created_at: "", last_opened: "" };
    useWorkspaceStore.getState().setActiveWorkspace(ws);
    expect(useWorkspaceStore.getState().activeWorkspace).toEqual(ws);
  });

  it("sets workspaces list", () => {
    const list = [
      { id: "a", name: "A", created_at: "", last_opened: "" },
      { id: "b", name: "B", created_at: "", last_opened: "" },
    ];
    useWorkspaceStore.getState().setWorkspaces(list);
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
  });

  it("sets current branch", () => {
    useWorkspaceStore.getState().setCurrentBranch("feature");
    expect(useWorkspaceStore.getState().currentBranch).toBe("feature");
  });

  it("sets merge state", () => {
    useWorkspaceStore.getState().setMergeState({
      conflicts: [{ path: "a.md", ours: "x", theirs: "y" }],
    });
    expect(useWorkspaceStore.getState().mergeState?.conflicts).toHaveLength(1);
  });

  it("clears merge state", () => {
    useWorkspaceStore.getState().setMergeState({
      conflicts: [{ path: "a.md", ours: "x", theirs: "y" }],
    });
    useWorkspaceStore.getState().setMergeState(null);
    expect(useWorkspaceStore.getState().mergeState).toBeNull();
  });
});
