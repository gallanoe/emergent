use crate::commands::workspace::AppState;
use crate::error::AppError;
use crate::vcs::{BranchInfo, CommitInfo, FileStatus, MergeResult};
use tauri::State;

#[tauri::command]
pub fn vcs_commit(state: State<'_, AppState>, message: String) -> Result<String, AppError> {
    let ws = state.workspace.lock().unwrap();
    let repo = ws.repo().ok_or(AppError::WorkspaceNotOpen)?;
    let worktree = ws.worktree_path().ok_or(AppError::WorkspaceNotOpen)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.commit(repo, worktree, &message)
}

#[tauri::command]
pub fn vcs_get_log(
    state: State<'_, AppState>,
    limit: usize,
) -> Result<Vec<CommitInfo>, AppError> {
    let ws = state.workspace.lock().unwrap();
    let repo = ws.repo().ok_or(AppError::WorkspaceNotOpen)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.get_log(repo, limit)
}

#[tauri::command]
pub fn vcs_get_status(state: State<'_, AppState>) -> Result<Vec<FileStatus>, AppError> {
    let ws = state.workspace.lock().unwrap();
    let repo = ws.repo().ok_or(AppError::WorkspaceNotOpen)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.get_status(repo)
}

#[tauri::command]
pub fn vcs_create_branch(state: State<'_, AppState>, name: String) -> Result<(), AppError> {
    let ws = state.workspace.lock().unwrap();
    let repo = ws.repo().ok_or(AppError::WorkspaceNotOpen)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.create_branch(repo, &name)
}

#[tauri::command]
pub fn vcs_list_branches(state: State<'_, AppState>) -> Result<Vec<BranchInfo>, AppError> {
    let ws = state.workspace.lock().unwrap();
    let repo = ws.repo().ok_or(AppError::WorkspaceNotOpen)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.list_branches(repo)
}

#[tauri::command]
pub fn vcs_delete_branch(state: State<'_, AppState>, name: String) -> Result<(), AppError> {
    let ws = state.workspace.lock().unwrap();
    let repo = ws.repo().ok_or(AppError::WorkspaceNotOpen)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.delete_branch(repo, &name)
}

#[tauri::command]
pub fn vcs_merge_branch(
    state: State<'_, AppState>,
    source_branch: String,
) -> Result<MergeResult, AppError> {
    let ws = state.workspace.lock().unwrap();
    let repo = ws.repo().ok_or(AppError::WorkspaceNotOpen)?;
    let worktree = ws.worktree_path().ok_or(AppError::WorkspaceNotOpen)?;
    let vcs = state.vcs.lock().unwrap();
    vcs.merge_branch(repo, worktree, &source_branch)
}
