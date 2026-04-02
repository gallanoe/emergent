use std::sync::Arc;
use tauri::State;

use emergent_core::agent::AgentManager;
use emergent_core::detect;
use emergent_core::workspace::WorkspaceManager;
use emergent_protocol::{
    AgentSummary, ConfigOption, DockerStatus, KnownAgent, Notification, WorkspaceInfo,
    WorkspaceSummary,
};

#[tauri::command]
pub async fn known_agents(
    workspace_manager: State<'_, Arc<WorkspaceManager>>,
    workspace_id: String,
) -> Result<Vec<KnownAgent>, String> {
    let ws_id = emergent_protocol::WorkspaceId::from(workspace_id.as_str());
    let info = workspace_manager.get_workspace(&ws_id).await?;

    match (workspace_manager.docker(), info.container_id.as_deref()) {
        (Some(docker), Some(container_id))
            if info.container_status == emergent_protocol::ContainerStatus::Running =>
        {
            Ok(detect::known_agents_in_container(docker, container_id).await)
        }
        _ => Ok(detect::known_agents_unavailable()),
    }
}

#[tauri::command]
pub async fn spawn_agent(
    manager: State<'_, Arc<AgentManager>>,
    workspace_id: String,
    agent_cli: String,
    role: Option<String>,
) -> Result<String, String> {
    let ws_id = emergent_protocol::WorkspaceId::from(workspace_id.as_str());
    manager.spawn_agent(ws_id, agent_cli, role).await
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
    manager.connect_agents(&agent_id_a, &agent_id_b).await
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

// ── Workspace commands ─────────────────────────────────────

#[tauri::command]
pub async fn create_workspace(
    workspace_manager: State<'_, Arc<WorkspaceManager>>,
    name: String,
) -> Result<String, String> {
    let id = workspace_manager.create_workspace(name).await?;
    Ok(id.to_string())
}

#[tauri::command]
pub async fn delete_workspace(
    workspace_manager: State<'_, Arc<WorkspaceManager>>,
    agent_manager: State<'_, Arc<AgentManager>>,
    workspace_id: String,
) -> Result<(), String> {
    let id = emergent_protocol::WorkspaceId::from(workspace_id.as_str());
    agent_manager.kill_agents_in_workspace(&id).await?;
    workspace_manager.delete_workspace(&id).await
}

#[tauri::command]
pub async fn list_workspaces(
    workspace_manager: State<'_, Arc<WorkspaceManager>>,
    agent_manager: State<'_, Arc<AgentManager>>,
) -> Result<Vec<WorkspaceSummary>, String> {
    let entries = workspace_manager.list_workspaces().await;
    let agents = agent_manager.list_agents().await;
    let summaries = entries
        .into_iter()
        .map(|entry| {
            let agent_count = agents.iter().filter(|a| a.workspace_id == entry.id).count();
            WorkspaceSummary {
                id: entry.id,
                name: entry.name,
                container_status: entry.container_status,
                agent_count,
            }
        })
        .collect();
    Ok(summaries)
}

#[tauri::command]
pub async fn get_workspace(
    workspace_manager: State<'_, Arc<WorkspaceManager>>,
    workspace_id: String,
) -> Result<WorkspaceInfo, String> {
    let id = emergent_protocol::WorkspaceId::from(workspace_id.as_str());
    workspace_manager.get_workspace(&id).await
}

#[tauri::command]
pub async fn update_workspace(
    workspace_manager: State<'_, Arc<WorkspaceManager>>,
    workspace_id: String,
    name: String,
) -> Result<(), String> {
    let id = emergent_protocol::WorkspaceId::from(workspace_id.as_str());
    workspace_manager.update_workspace(&id, name).await
}

#[tauri::command]
pub async fn get_dockerfile(
    workspace_manager: State<'_, Arc<WorkspaceManager>>,
    workspace_id: String,
) -> Result<String, String> {
    let id = emergent_protocol::WorkspaceId::from(workspace_id.as_str());
    workspace_manager.get_dockerfile(&id).await
}

#[tauri::command]
pub async fn open_dockerfile_editor(
    workspace_manager: State<'_, Arc<WorkspaceManager>>,
    workspace_id: String,
) -> Result<(), String> {
    let id = emergent_protocol::WorkspaceId::from(workspace_id.as_str());
    let info = workspace_manager.get_workspace(&id).await?;
    let dockerfile_path = format!("{}/Dockerfile", info.path);

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dockerfile_path)
            .spawn()
            .map_err(|e| format!("Failed to open editor: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dockerfile_path)
            .spawn()
            .map_err(|e| format!("Failed to open editor: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn start_container(
    workspace_manager: State<'_, Arc<WorkspaceManager>>,
    workspace_id: String,
) -> Result<(), String> {
    let id = emergent_protocol::WorkspaceId::from(workspace_id.as_str());
    workspace_manager.start_container(&id).await
}

#[tauri::command]
pub async fn stop_container(
    workspace_manager: State<'_, Arc<WorkspaceManager>>,
    agent_manager: State<'_, Arc<AgentManager>>,
    workspace_id: String,
) -> Result<(), String> {
    let id = emergent_protocol::WorkspaceId::from(workspace_id.as_str());
    agent_manager.kill_agents_in_workspace(&id).await?;
    workspace_manager.stop_container(&id).await
}

#[tauri::command]
pub async fn rebuild_container(
    workspace_manager: State<'_, Arc<WorkspaceManager>>,
    agent_manager: State<'_, Arc<AgentManager>>,
    workspace_id: String,
) -> Result<(), String> {
    let id = emergent_protocol::WorkspaceId::from(workspace_id.as_str());
    agent_manager.kill_agents_in_workspace(&id).await?;
    workspace_manager.rebuild_container(&id).await
}

#[tauri::command]
pub async fn detect_docker(
    workspace_manager: State<'_, Arc<WorkspaceManager>>,
) -> Result<DockerStatus, String> {
    Ok(workspace_manager.detect_docker())
}
