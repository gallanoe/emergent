use std::path::PathBuf;
use std::sync::Arc;

use emergent_core::agent::thread_manager::{ThreadManager, ThreadMapping};
use emergent_core::mcp::TokenRegistry;
use emergent_core::workspace;
use emergent_protocol::{ContainerStatus, WorkspaceId};
use tempfile::TempDir;

/// Build a ThreadManager suitable for tests that don't need to spawn real
/// agent processes.
pub(crate) async fn test_manager() -> ThreadManager {
    let (event_tx, _rx) = tokio::sync::broadcast::channel(16);
    let token_registry = Arc::new(TokenRegistry::new());
    let workspace_state = workspace::new_shared_state();
    let runtime = emergent_core::runtime::load_shared_runtime().await;
    ThreadManager::new(event_tx, token_registry, workspace_state, runtime)
}

/// Register a workspace in the manager's shared state so persist paths can
/// resolve its on-disk location.
pub(crate) async fn register_workspace(
    manager: &ThreadManager,
    workspace_id: &WorkspaceId,
    path: PathBuf,
) {
    manager
        .register_workspace_for_test(workspace_id.clone(), path, ContainerStatus::Stopped)
        .await;
}

pub(crate) fn mapping(id: &str, agent: &str, task: Option<&str>) -> ThreadMapping {
    ThreadMapping {
        thread_id: id.to_string(),
        agent_definition_id: agent.to_string(),
        acp_session_id: Some(format!("acp-{}", id)),
        task_id: task.map(|s| s.to_string()),
    }
}

#[tokio::test]
async fn hydrate_dormant_for_workspace_inserts_mappings() {
    let manager = test_manager().await;
    let ws_id = WorkspaceId::from("ws-1");
    let mappings = vec![
        mapping("t1", "agent-a", Some("task-1")),
        mapping("t2", "agent-b", None),
    ];

    manager
        .hydrate_dormant_for_workspace(&ws_id, mappings)
        .await;

    let dormant = manager.dormant_snapshot_for_workspace(&ws_id).await;
    assert_eq!(dormant.len(), 2);
    assert_eq!(dormant.get("t1").unwrap().agent_definition_id, "agent-a");
    assert_eq!(dormant.get("t2").unwrap().task_id, None);
}
