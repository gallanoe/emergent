use std::sync::Arc;
use tauri::State;

use crate::DaemonConnection;
use emergent_protocol::{AgentInfo, AgentSummary, ConfigOption, KnownAgent, Notification};

async fn get_client(
    conn: &DaemonConnection,
) -> Result<Arc<emergent_protocol::DaemonClient>, String> {
    conn.client
        .lock()
        .await
        .clone()
        .ok_or_else(|| "Daemon not connected".to_string())
}

#[tauri::command]
pub async fn detect_agents(
    conn: State<'_, Arc<DaemonConnection>>,
) -> Result<Vec<AgentInfo>, String> {
    get_client(&conn).await?.detect_agents().await
}

#[tauri::command]
pub async fn known_agents(
    conn: State<'_, Arc<DaemonConnection>>,
) -> Result<Vec<KnownAgent>, String> {
    get_client(&conn).await?.known_agents().await
}

#[tauri::command]
pub async fn spawn_agent(
    conn: State<'_, Arc<DaemonConnection>>,
    working_directory: String,
    agent_cli: String,
) -> Result<String, String> {
    get_client(&conn)
        .await?
        .spawn_agent(working_directory, agent_cli)
        .await
}

#[tauri::command]
pub async fn send_prompt(
    conn: State<'_, Arc<DaemonConnection>>,
    agent_id: String,
    text: String,
) -> Result<(), String> {
    get_client(&conn).await?.send_prompt(&agent_id, text).await
}

#[tauri::command]
pub async fn cancel_prompt(
    conn: State<'_, Arc<DaemonConnection>>,
    agent_id: String,
) -> Result<(), String> {
    get_client(&conn).await?.cancel_prompt(&agent_id).await
}

#[tauri::command]
pub async fn kill_agent(
    conn: State<'_, Arc<DaemonConnection>>,
    agent_id: String,
) -> Result<(), String> {
    get_client(&conn).await?.kill_agent(&agent_id).await
}

#[tauri::command]
pub async fn get_daemon_status(
    conn: State<'_, Arc<DaemonConnection>>,
) -> Result<String, String> {
    Ok(conn.status.lock().await.clone())
}

#[tauri::command]
pub async fn get_daemon_launch_status(
    conn: State<'_, Arc<DaemonConnection>>,
) -> Result<serde_json::Value, String> {
    let status = conn.status.lock().await.clone();
    let error = conn.launch_error.lock().await.clone();
    Ok(serde_json::json!({
        "status": status,
        "error": error,
    }))
}

#[tauri::command]
pub async fn list_agents(
    conn: State<'_, Arc<DaemonConnection>>,
) -> Result<Vec<AgentSummary>, String> {
    get_client(&conn).await?.list_agents().await
}

#[tauri::command]
pub async fn get_history(
    conn: State<'_, Arc<DaemonConnection>>,
    agent_id: String,
) -> Result<Vec<Notification>, String> {
    get_client(&conn).await?.get_history(&agent_id).await
}

#[tauri::command]
pub async fn get_agent_config(
    conn: State<'_, Arc<DaemonConnection>>,
    agent_id: String,
) -> Result<Vec<ConfigOption>, String> {
    get_client(&conn).await?.get_agent_config(&agent_id).await
}

#[tauri::command]
pub async fn set_agent_config(
    conn: State<'_, Arc<DaemonConnection>>,
    agent_id: String,
    config_id: String,
    value: String,
) -> Result<Vec<ConfigOption>, String> {
    get_client(&conn)
        .await?
        .set_agent_config(&agent_id, &config_id, &value)
        .await
}

// ── Swarm management commands ──────────────────────────────

#[tauri::command]
pub async fn connect_agents(
    conn: State<'_, Arc<DaemonConnection>>,
    agent_id_a: String,
    agent_id_b: String,
) -> Result<(), String> {
    get_client(&conn)
        .await?
        .connect_agents(&agent_id_a, &agent_id_b)
        .await
}

#[tauri::command]
pub async fn disconnect_agents(
    conn: State<'_, Arc<DaemonConnection>>,
    agent_id_a: String,
    agent_id_b: String,
) -> Result<(), String> {
    get_client(&conn)
        .await?
        .disconnect_agents(&agent_id_a, &agent_id_b)
        .await
}

#[tauri::command]
pub async fn set_agent_permissions(
    conn: State<'_, Arc<DaemonConnection>>,
    agent_id: String,
    enabled: bool,
) -> Result<(), String> {
    get_client(&conn)
        .await?
        .set_agent_permissions(&agent_id, enabled)
        .await
}

#[tauri::command]
pub async fn get_agent_connections(
    conn: State<'_, Arc<DaemonConnection>>,
    agent_id: String,
) -> Result<Vec<String>, String> {
    get_client(&conn)
        .await?
        .get_agent_connections(&agent_id)
        .await
}

// ── Daemon lifecycle commands ──────────────────────────────

#[tauri::command]
pub async fn retry_daemon_launch(
    conn: State<'_, Arc<DaemonConnection>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Best-effort shutdown of partially started daemon
    let _ = crate::daemon_launcher::shutdown_daemon().await;

    // Reset state
    *conn.status.lock().await = "starting".into();
    *conn.launch_error.lock().await = None;
    *conn.client.lock().await = None;

    // Re-launch
    crate::launch_and_connect(app_handle, Arc::clone(&conn)).await;

    let status = conn.status.lock().await.clone();
    if status == "connected" {
        Ok(())
    } else {
        let error = conn.launch_error.lock().await.clone().unwrap_or_default();
        Err(error)
    }
}
