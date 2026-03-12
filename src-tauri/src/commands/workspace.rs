use crate::error::AppError;
use crate::vcs::VcsService;
use crate::workspace::{TreeNode, WorkspaceMeta, WorkspaceService};
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub workspace: Mutex<WorkspaceService>,
    pub vcs: Mutex<VcsService>,
}

#[tauri::command]
pub fn create_workspace(state: State<'_, AppState>, name: String) -> Result<String, AppError> {
    state.workspace.lock().unwrap().create_workspace(&name)
}

#[tauri::command]
pub fn open_workspace(
    state: State<'_, AppState>,
    id: String,
) -> Result<WorkspaceMeta, AppError> {
    state.workspace.lock().unwrap().open_workspace(&id)
}

#[tauri::command]
pub fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<WorkspaceMeta>, AppError> {
    state.workspace.lock().unwrap().list_workspaces()
}

#[tauri::command]
pub fn delete_workspace(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    state.workspace.lock().unwrap().delete_workspace(&id)
}

#[tauri::command]
pub fn create_document(state: State<'_, AppState>, path: String) -> Result<(), AppError> {
    state.workspace.lock().unwrap().create_document(&path)
}

#[tauri::command]
pub fn read_document(state: State<'_, AppState>, path: String) -> Result<String, AppError> {
    state.workspace.lock().unwrap().read_document(&path)
}

#[tauri::command]
pub fn write_document(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), AppError> {
    state
        .workspace
        .lock()
        .unwrap()
        .write_document(&path, &content)
}

#[tauri::command]
pub fn delete_document(state: State<'_, AppState>, path: String) -> Result<(), AppError> {
    state.workspace.lock().unwrap().delete_document(&path)
}

#[tauri::command]
pub fn move_document(
    state: State<'_, AppState>,
    old_path: String,
    new_path: String,
) -> Result<(), AppError> {
    state
        .workspace
        .lock()
        .unwrap()
        .move_document(&old_path, &new_path)
}

#[tauri::command]
pub fn create_folder(state: State<'_, AppState>, path: String) -> Result<(), AppError> {
    state.workspace.lock().unwrap().create_folder(&path)
}

#[tauri::command]
pub fn delete_folder(state: State<'_, AppState>, path: String) -> Result<(), AppError> {
    state.workspace.lock().unwrap().delete_folder(&path)
}

#[tauri::command]
pub fn move_folder(
    state: State<'_, AppState>,
    old_path: String,
    new_path: String,
) -> Result<(), AppError> {
    state
        .workspace
        .lock()
        .unwrap()
        .move_folder(&old_path, &new_path)
}

#[tauri::command]
pub fn list_tree(state: State<'_, AppState>) -> Result<Vec<TreeNode>, AppError> {
    state.workspace.lock().unwrap().list_tree()
}
