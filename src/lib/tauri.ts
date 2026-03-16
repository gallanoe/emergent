import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Types matching Rust structs
export type TreeNode = {
  name: string;
  path: string;
  kind: "file" | "folder";
  children?: TreeNode[];
};

export type WorkspaceMeta = {
  id: string;
  name: string;
  created_at: string;
  last_opened: string;
};

// Workspace commands
export const createWorkspace = (name: string) => invoke<string>("create_workspace", { name });

export const openWorkspace = (id: string) => invoke<WorkspaceMeta>("open_workspace", { id });

export const listWorkspaces = () => invoke<WorkspaceMeta[]>("list_workspaces");

export const deleteWorkspace = (id: string) => invoke<void>("delete_workspace", { id });

export const createDocument = (path: string) => invoke<void>("create_document", { path });

export const readDocument = (path: string) => invoke<string>("read_document", { path });

export const writeDocument = (path: string, content: string) =>
  invoke<void>("write_document", { path, content });

export const deleteDocument = (path: string) => invoke<void>("delete_document", { path });

export const moveDocument = (oldPath: string, newPath: string) =>
  invoke<void>("move_document", { oldPath, newPath });

export const createFolder = (path: string) => invoke<void>("create_folder", { path });

export const deleteFolder = (path: string) => invoke<void>("delete_folder", { path });

export const moveFolder = (oldPath: string, newPath: string) =>
  invoke<void>("move_folder", { oldPath, newPath });

export const listTree = () => invoke<TreeNode[]>("list_tree");

// Event listeners
export type EventCallback<T> = (payload: T) => void;

export const onDocumentChanged = (cb: EventCallback<{ path: string }>): Promise<UnlistenFn> =>
  listen("document:changed", (e) => cb(e.payload as { path: string }));

export const onTreeChanged = (cb: EventCallback<Record<string, never>>): Promise<UnlistenFn> =>
  listen("tree:changed", (e) => cb(e.payload as Record<string, never>));

export const onBranchSwitched = (
  cb: EventCallback<{ name: string; head_oid: string }>,
): Promise<UnlistenFn> =>
  listen("branch:switched", (e) => cb(e.payload as { name: string; head_oid: string }));

export const onWorkspaceOpened = (
  cb: EventCallback<{ id: string; name: string; branch: string }>,
): Promise<UnlistenFn> =>
  listen("workspace:opened", (e) => cb(e.payload as { id: string; name: string; branch: string }));

export const onMergeConflict = (cb: EventCallback<{ conflicts: string[] }>): Promise<UnlistenFn> =>
  listen("merge:conflict", (e) => cb(e.payload as { conflicts: string[] }));

export const onCommitCreated = (
  cb: EventCallback<{ oid: string; message: string }>,
): Promise<UnlistenFn> =>
  listen("commit:created", (e) => cb(e.payload as { oid: string; message: string }));

export const onVcsStatusChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen("vcs:status-changed", () => cb());

// VCS types
export type CommitInfo = {
  oid: string;
  message: string;
  time: number;
};

export type FileStatus = {
  path: string;
  status: "new" | "modified" | "deleted" | "unknown";
  staged: boolean;
};

export type BranchInfo = {
  name: string;
  head_oid: string;
};

export type MergeResult = { type: "Clean" } | { type: "Conflict"; paths: string[] };

export type DiffLine = {
  kind: "add" | "remove" | "context";
  content: string;
  old_lineno: number | null;
  new_lineno: number | null;
};

export type DiffHunk = {
  header: string;
  lines: DiffLine[];
};

export type DiffResult = {
  hunks: DiffHunk[];
};

export type HeadInfo = {
  oid: string;
  message: string;
  time: number;
  is_detached: boolean;
  branch_name: string | null;
  commits_behind: number;
  commits_ahead: number;
};

// VCS commands
export const vcsCommit = (message: string, branchName?: string) =>
  invoke<string>("vcs_commit", { message, branchName: branchName ?? null });

export const vcsGetLog = (limit: number) => invoke<CommitInfo[]>("vcs_get_log", { limit });

export const vcsGetStatus = () => invoke<FileStatus[]>("vcs_get_status");

export const vcsCreateBranch = (name: string) => invoke<void>("vcs_create_branch", { name });

export const vcsListBranches = () => invoke<BranchInfo[]>("vcs_list_branches");

export const vcsDeleteBranch = (name: string) => invoke<void>("vcs_delete_branch", { name });

export const vcsMergeBranch = (sourceBranch: string) =>
  invoke<MergeResult>("vcs_merge_branch", { sourceBranch });

export const vcsStage = (paths: string[]) => invoke<void>("vcs_stage", { paths });

export const vcsUnstage = (paths: string[]) => invoke<void>("vcs_unstage", { paths });

export const vcsDiff = (path: string) => invoke<DiffResult>("vcs_diff", { path });

export const vcsCheckoutCommit = (oid: string) =>
  invoke<CommitInfo>("vcs_checkout_commit", { oid });

export const vcsGetHeadInfo = (originBranch?: string) =>
  invoke<HeadInfo>("vcs_get_head_info", { originBranch: originBranch ?? null });
