use crate::commands::workspace::AppState;
use crate::error::AppError;
use crate::vcs::{BranchInfo, CommitInfo, FileStatus, MergeResult};
use git2::Repository;
use tauri::State;

/// Open the worktree repo (not the bare repo) for operations that need a working directory.
fn open_worktree_repo(state: &AppState) -> Result<(Repository, std::path::PathBuf), AppError> {
    let ws = state.workspace.lock().unwrap();
    let worktree = ws.worktree_path().ok_or(AppError::WorkspaceNotOpen)?;
    let worktree_path = worktree.to_path_buf();
    let repo = Repository::open(&worktree_path)?;
    Ok((repo, worktree_path))
}

#[tauri::command]
pub fn vcs_stage(state: State<'_, AppState>, paths: Vec<String>) -> Result<(), AppError> {
    let (repo, worktree_path) = open_worktree_repo(&state)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.stage(&repo, &worktree_path, &paths)
}

#[tauri::command]
pub fn vcs_unstage(state: State<'_, AppState>, paths: Vec<String>) -> Result<(), AppError> {
    let (repo, worktree_path) = open_worktree_repo(&state)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.unstage(&repo, &worktree_path, &paths)
}

#[tauri::command]
pub fn vcs_diff(
    state: State<'_, AppState>,
    path: String,
) -> Result<crate::vcs::DiffResult, AppError> {
    let (repo, worktree_path) = open_worktree_repo(&state)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.diff(&repo, &worktree_path, &path)
}

#[tauri::command]
pub fn vcs_commit(state: State<'_, AppState>, message: String) -> Result<String, AppError> {
    let (repo, worktree_path) = open_worktree_repo(&state)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.commit(&repo, &worktree_path, &message)
}

#[tauri::command]
pub fn vcs_get_log(
    state: State<'_, AppState>,
    limit: usize,
) -> Result<Vec<CommitInfo>, AppError> {
    let (repo, _worktree_path) = open_worktree_repo(&state)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.get_log(&repo, limit)
}

#[tauri::command]
pub fn vcs_get_status(state: State<'_, AppState>) -> Result<Vec<FileStatus>, AppError> {
    let (repo, _worktree_path) = open_worktree_repo(&state)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.get_status(&repo)
}

#[tauri::command]
pub fn vcs_create_branch(state: State<'_, AppState>, name: String) -> Result<(), AppError> {
    let (repo, _) = open_worktree_repo(&state)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.create_branch(&repo, &name)
}

#[tauri::command]
pub fn vcs_list_branches(state: State<'_, AppState>) -> Result<Vec<BranchInfo>, AppError> {
    let (repo, _) = open_worktree_repo(&state)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.list_branches(&repo)
}

#[tauri::command]
pub fn vcs_delete_branch(state: State<'_, AppState>, name: String) -> Result<(), AppError> {
    let (repo, _) = open_worktree_repo(&state)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.delete_branch(&repo, &name)
}

#[tauri::command]
pub fn vcs_merge_branch(
    state: State<'_, AppState>,
    source_branch: String,
) -> Result<MergeResult, AppError> {
    let (repo, worktree_path) = open_worktree_repo(&state)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.merge_branch(&repo, &worktree_path, &source_branch)
}
