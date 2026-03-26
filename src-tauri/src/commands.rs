use std::sync::Arc;
use tauri::State;

use emergent_daemon::agent_manager::AgentManager;
use emergent_daemon::detect;
use emergent_protocol::{AgentInfo, AgentSummary, ConfigOption, KnownAgent, Notification};

#[tauri::command]
pub async fn detect_agents() -> Result<Vec<AgentInfo>, String> {
    Ok(detect::detect_agents())
}

#[tauri::command]
pub async fn known_agents() -> Result<Vec<KnownAgent>, String> {
    Ok(detect::known_agents())
}

#[tauri::command]
pub async fn spawn_agent(
    manager: State<'_, Arc<AgentManager>>,
    working_directory: String,
    agent_cli: String,
    role: Option<String>,
) -> Result<String, String> {
    manager
        .spawn_agent(working_directory.into(), agent_cli, role)
        .await
}

#[tauri::command]
pub async fn send_prompt(
    manager: State<'_, Arc<AgentManager>>,
    agent_id: String,
    text: String,
    role: Option<String>,
) -> Result<(), String> {
    let reply_rx = manager.queue_prompt(&agent_id, text, role).await?;
    reply_rx
        .await
        .map_err(|_| "Agent prompt loop terminated".to_string())?
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

#[tauri::command]
pub async fn get_daemon_status() -> Result<String, String> {
    Ok("connected".into())
}

#[tauri::command]
pub async fn list_agents(
    manager: State<'_, Arc<AgentManager>>,
) -> Result<Vec<AgentSummary>, String> {
    Ok(manager.list_agents().await)
}

#[tauri::command]
pub async fn get_history(
    manager: State<'_, Arc<AgentManager>>,
    agent_id: String,
) -> Result<Vec<Notification>, String> {
    manager.get_history(&agent_id).await
}

#[tauri::command]
pub async fn get_agent_config(
    manager: State<'_, Arc<AgentManager>>,
    agent_id: String,
) -> Result<Vec<ConfigOption>, String> {
    manager.get_config(&agent_id).await
}

#[tauri::command]
pub async fn set_agent_config(
    manager: State<'_, Arc<AgentManager>>,
    agent_id: String,
    config_id: String,
    value: String,
) -> Result<Vec<ConfigOption>, String> {
    manager.set_config(&agent_id, config_id, value).await
}

// ── Swarm management commands ──────────────────────────────

#[tauri::command]
pub async fn connect_agents(
    manager: State<'_, Arc<AgentManager>>,
    agent_id_a: String,
    agent_id_b: String,
) -> Result<(), String> {
    manager.connect_agents(&agent_id_a, &agent_id_b).await;
    Ok(())
}

#[tauri::command]
pub async fn disconnect_agents(
    manager: State<'_, Arc<AgentManager>>,
    agent_id_a: String,
    agent_id_b: String,
) -> Result<(), String> {
    manager.disconnect_agents(&agent_id_a, &agent_id_b).await;
    Ok(())
}

#[tauri::command]
pub async fn set_agent_permissions(
    manager: State<'_, Arc<AgentManager>>,
    agent_id: String,
    enabled: bool,
) -> Result<(), String> {
    manager
        .set_management_permissions(&agent_id, enabled)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_agent_connections(
    manager: State<'_, Arc<AgentManager>>,
    agent_id: String,
) -> Result<Vec<String>, String> {
    Ok(manager.get_connections(&agent_id).await)
}
