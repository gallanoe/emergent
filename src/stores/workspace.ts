import { create } from "zustand";
import type { WorkspaceMeta } from "../lib/tauri";

type MergeConflict = {
  path: string;
  ours: string;
  theirs: string;
};

type WorkspaceState = {
  activeWorkspace: WorkspaceMeta | null;
  workspaces: WorkspaceMeta[];
  currentBranch: string;
  mergeState: { conflicts: MergeConflict[] } | null;
  setActiveWorkspace: (ws: WorkspaceMeta | null) => void;
  setWorkspaces: (list: WorkspaceMeta[]) => void;
  setCurrentBranch: (branch: string) => void;
  setMergeState: (state: { conflicts: MergeConflict[] } | null) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeWorkspace: null,
  workspaces: [],
  currentBranch: "main",
  mergeState: null,
  setActiveWorkspace: (ws) => set({ activeWorkspace: ws }),
  setWorkspaces: (list) => set({ workspaces: list }),
  setCurrentBranch: (branch) => set({ currentBranch: branch }),
  setMergeState: (state) => set({ mergeState: state }),
}));
