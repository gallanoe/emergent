use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::agent_manager::AgentManager;
use crate::detect;

#[tauri::command]
pub async fn detect_agents() -> Result<Vec<detect::AgentInfo>, String> {
    Ok(detect::detect_agents())
}

#[tauri::command]
pub async fn spawn_agent(
    app: AppHandle,
    manager: State<'_, Arc<AgentManager>>,
    working_directory: String,
    agent_cli: String,
) -> Result<String, String> {
    manager.spawn_agent(app, working_directory.into(), agent_cli).await
}

#[tauri::command]
pub async fn send_prompt(
    app: AppHandle,
    manager: State<'_, Arc<AgentManager>>,
    agent_id: String,
    text: String,
) -> Result<(), String> {
    manager.send_prompt(app, &agent_id, text).await
}

#[tauri::command]
pub async fn cancel_prompt(
    manager: State<'_, Arc<AgentManager>>,
    agent_id: String,
) -> Result<(), String> {
    manager.cancel_prompt(&agent_id).await
}

#[tauri::command]
pub async fn kill_agent(
    manager: State<'_, Arc<AgentManager>>,
    agent_id: String,
) -> Result<(), String> {
    manager.kill_agent(&agent_id).await
}
