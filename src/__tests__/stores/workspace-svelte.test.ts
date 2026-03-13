// src/__tests__/stores/workspace-svelte.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { workspaceStore } from "../../stores/workspace.svelte";

describe("WorkspaceStore (Svelte)", () => {
  beforeEach(() => {
    workspaceStore.activeWorkspace = null;
    workspaceStore.workspaces = [];
    workspaceStore.currentBranch = "main";
    workspaceStore.mergeState = null;
  });

  it("sets active workspace", () => {
    const ws = { id: "abc", name: "Test", created_at: "", last_opened: "" };
    workspaceStore.setActiveWorkspace(ws);
    expect(workspaceStore.activeWorkspace).toEqual(ws);
  });

  it("sets workspaces list", () => {
    const list = [
      { id: "a", name: "A", created_at: "", last_opened: "" },
      { id: "b", name: "B", created_at: "", last_opened: "" },
    ];
    workspaceStore.setWorkspaces(list);
    expect(workspaceStore.workspaces).toHaveLength(2);
  });

  it("sets current branch", () => {
    workspaceStore.setCurrentBranch("feature");
    expect(workspaceStore.currentBranch).toBe("feature");
  });

  it("sets merge state", () => {
    workspaceStore.setMergeState({
      conflicts: [{ path: "a.md", ours: "x", theirs: "y" }],
    });
    expect(workspaceStore.mergeState?.conflicts).toHaveLength(1);
  });

  it("clears merge state", () => {
    workspaceStore.setMergeState({
      conflicts: [{ path: "a.md", ours: "x", theirs: "y" }],
    });
    workspaceStore.setMergeState(null);
    expect(workspaceStore.mergeState).toBeNull();
  });
});
