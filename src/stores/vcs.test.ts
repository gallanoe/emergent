import { describe, it, expect, beforeEach } from "vitest";
import { vcsStore } from "./vcs.svelte";

describe("VcsStore", () => {
  beforeEach(() => {
    vcsStore.reset();
  });

  it("starts with empty state", () => {
    expect(vcsStore.changedFiles).toEqual([]);
    expect(vcsStore.stagedPaths.size).toBe(0);
    expect(vcsStore.selectedFile).toBeNull();
    expect(vcsStore.commits).toEqual([]);
  });

  it("tracks staged paths", () => {
    vcsStore.setStagedPaths(new Set(["a.txt", "b.txt"]));
    expect(vcsStore.stagedPaths.size).toBe(2);
    expect(vcsStore.stagedPaths.has("a.txt")).toBe(true);
  });

  it("sets selected file", () => {
    vcsStore.setSelectedFile("readme.md");
    expect(vcsStore.selectedFile).toBe("readme.md");
  });

  it("sets changed files", () => {
    const files = [{ path: "a.txt", status: "modified" as const, staged: false }];
    vcsStore.setChangedFiles(files);
    expect(vcsStore.changedFiles).toEqual(files);
  });

  it("sets commits", () => {
    const commits = [{ oid: "abc", message: "test", time: 1000 }];
    vcsStore.setCommits(commits);
    expect(vcsStore.commits).toEqual(commits);
  });

  it("computes staged count", () => {
    vcsStore.setStagedPaths(new Set(["a.txt", "b.txt"]));
    expect(vcsStore.stagedCount).toBe(2);
  });

  it("computes hasChanges", () => {
    expect(vcsStore.hasChanges).toBe(false);
    vcsStore.setChangedFiles([{ path: "a.txt", status: "modified" as const, staged: false }]);
    expect(vcsStore.hasChanges).toBe(true);
  });

  it("sets and resets commit message", () => {
    vcsStore.setCommitMessage("my commit");
    expect(vcsStore.commitMessage).toBe("my commit");
    vcsStore.reset();
    expect(vcsStore.commitMessage).toBe("");
  });

  it("reset clears all state", () => {
    vcsStore.setStagedPaths(new Set(["a.txt"]));
    vcsStore.setSelectedFile("a.txt");
    vcsStore.reset();
    expect(vcsStore.stagedPaths.size).toBe(0);
    expect(vcsStore.selectedFile).toBeNull();
  });
});
