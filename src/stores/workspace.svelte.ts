// src/stores/workspace.svelte.ts
import type { WorkspaceMeta, CommitInfo } from "../lib/tauri";
import { vcsGetHeadInfo } from "../lib/tauri";

type MergeConflict = {
  path: string;
  ours: string;
  theirs: string;
};

class WorkspaceStore {
  activeWorkspace: WorkspaceMeta | null = $state(null);
  workspaces = $state.raw<WorkspaceMeta[]>([]);
  currentBranch = $state("main");
  mergeState: { conflicts: MergeConflict[] } | null = $state(null);
  headCommit: CommitInfo | null = $state(null);
  isDetached: boolean = $state(false);
  commitsBehind: number = $state(0);
  commitsAhead: number = $state(0);
  originBranch: string = $state("main");

  setActiveWorkspace(ws: WorkspaceMeta | null) {
    this.activeWorkspace = ws;
  }

  setWorkspaces(list: WorkspaceMeta[]) {
    this.workspaces = list;
  }

  setCurrentBranch(branch: string) {
    this.currentBranch = branch;
  }

  setMergeState(state: { conflicts: MergeConflict[] } | null) {
    this.mergeState = state;
  }

  async refreshHeadInfo() {
    try {
      const info = await vcsGetHeadInfo(this.originBranch);

      // Save origin branch when first detaching (before updating currentBranch)
      if (info.is_detached && !this.isDetached) {
        this.originBranch = this.currentBranch;
      }

      this.headCommit = { oid: info.oid, message: info.message, time: info.time };
      this.isDetached = info.is_detached;
      this.commitsBehind = info.commits_behind;
      this.commitsAhead = info.commits_ahead;
      this.currentBranch = info.branch_name ?? "detached";
    } catch {
      // Silently fail — head info is supplementary
    }
  }
}

export const workspaceStore = new WorkspaceStore();
