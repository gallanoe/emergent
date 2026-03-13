// src/stores/workspace.svelte.ts
import type { WorkspaceMeta } from "../lib/tauri";

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
}

export const workspaceStore = new WorkspaceStore();
