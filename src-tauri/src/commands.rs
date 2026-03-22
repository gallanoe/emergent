use std::sync::Arc;
use tauri::State;

use crate::DaemonConnection;
use emergent_protocol::{AgentInfo, KnownAgent};

fn get_client(
    conn: &DaemonConnection,
) -> Result<&Arc<emergent_protocol::DaemonClient>, String> {
    conn.client
        .as_ref()
        .ok_or_else(|| "Daemon not connected".to_string())
}

#[tauri::command]
pub async fn detect_agents(
    conn: State<'_, Arc<DaemonConnection>>,
) -> Result<Vec<AgentInfo>, String> {
    get_client(&conn)?.detect_agents().await
}

#[tauri::command]
pub async fn known_agents(
    conn: State<'_, Arc<DaemonConnection>>,
) -> Result<Vec<KnownAgent>, String> {
    get_client(&conn)?.known_agents().await
}

#[tauri::command]
pub async fn spawn_agent(
    conn: State<'_, Arc<DaemonConnection>>,
    working_directory: String,
    agent_cli: String,
) -> Result<String, String> {
    get_client(&conn)?
        .spawn_agent(working_directory, agent_cli)
        .await
}

#[tauri::command]
pub async fn send_prompt(
    conn: State<'_, Arc<DaemonConnection>>,
    agent_id: String,
    text: String,
) -> Result<(), String> {
    get_client(&conn)?.send_prompt(&agent_id, text).await
}

#[tauri::command]
pub async fn cancel_prompt(
    conn: State<'_, Arc<DaemonConnection>>,
    agent_id: String,
) -> Result<(), String> {
    get_client(&conn)?.cancel_prompt(&agent_id).await
}

#[tauri::command]
pub async fn kill_agent(
    conn: State<'_, Arc<DaemonConnection>>,
    agent_id: String,
) -> Result<(), String> {
    get_client(&conn)?.kill_agent(&agent_id).await
}

#[tauri::command]
pub async fn get_daemon_status(
    conn: State<'_, Arc<DaemonConnection>>,
) -> Result<String, String> {
    Ok(conn.status.lock().await.clone())
}
