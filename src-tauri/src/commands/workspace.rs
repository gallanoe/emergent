use crate::error::AppError;
use crate::state::{read_lock, write_lock};
use crate::vcs::VcsService;
use crate::workspace::{TreeNode, WorkspaceMeta, WorkspaceService};
use std::sync::RwLock;
use tauri::State;

pub struct AppState {
    pub workspace: RwLock<WorkspaceService>,
    pub vcs: RwLock<VcsService>,
}

#[tauri::command]
pub fn create_workspace(state: State<'_, AppState>, name: String) -> Result<String, AppError> {
    write_lock(&state.workspace)?.create_workspace(&name)
}

#[tauri::command]
pub fn open_workspace(
    state: State<'_, AppState>,
    id: String,
) -> Result<WorkspaceMeta, AppError> {
    write_lock(&state.workspace)?.open_workspace(&id)
}

#[tauri::command]
pub fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<WorkspaceMeta>, AppError> {
    read_lock(&state.workspace)?.list_workspaces()
}

#[tauri::command]
pub fn delete_workspace(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    write_lock(&state.workspace)?.delete_workspace(&id)
}

#[tauri::command]
pub fn create_document(state: State<'_, AppState>, path: String) -> Result<(), AppError> {
    write_lock(&state.workspace)?.create_document(&path)
}

#[tauri::command]
pub fn read_document(state: State<'_, AppState>, path: String) -> Result<String, AppError> {
    read_lock(&state.workspace)?.read_document(&path)
}

#[tauri::command]
pub fn write_document(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), AppError> {
    write_lock(&state.workspace)?.write_document(&path, &content)
}

#[tauri::command]
pub fn delete_document(state: State<'_, AppState>, path: String) -> Result<(), AppError> {
    write_lock(&state.workspace)?.delete_document(&path)
}

#[tauri::command]
pub fn move_document(
    state: State<'_, AppState>,
    old_path: String,
    new_path: String,
) -> Result<(), AppError> {
    write_lock(&state.workspace)?.move_document(&old_path, &new_path)
}

#[tauri::command]
pub fn create_folder(state: State<'_, AppState>, path: String) -> Result<(), AppError> {
    write_lock(&state.workspace)?.create_folder(&path)
}

#[tauri::command]
pub fn delete_folder(state: State<'_, AppState>, path: String) -> Result<(), AppError> {
    write_lock(&state.workspace)?.delete_folder(&path)
}

#[tauri::command]
pub fn move_folder(
    state: State<'_, AppState>,
    old_path: String,
    new_path: String,
) -> Result<(), AppError> {
    write_lock(&state.workspace)?.move_folder(&old_path, &new_path)
}

#[tauri::command]
pub fn list_tree(state: State<'_, AppState>) -> Result<Vec<TreeNode>, AppError> {
    read_lock(&state.workspace)?.list_tree()
}
