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

#[tokio::test]
async fn kill_threads_for_agent_covers_dormant() {
    let tmp = TempDir::new().unwrap();
    let ws_id = WorkspaceId::from("ws-agent");

    let manager = test_manager().await;
    register_workspace(&manager, &ws_id, tmp.path().to_path_buf()).await;

    manager
        .hydrate_dormant_for_workspace(
            &ws_id,
            vec![
                mapping("t-a-1", "agent-a", None),
                mapping("t-a-2", "agent-a", Some("task-2")),
                mapping("t-b-1", "agent-b", None),
            ],
        )
        .await;
    manager.persist_threads_for_workspace(&ws_id).await;

    manager.kill_threads_for_agent("agent-a").await.unwrap();

    let remaining = manager.dormant_snapshot_for_workspace(&ws_id).await;
    assert_eq!(remaining.len(), 1);
    assert!(remaining.contains_key("t-b-1"));
}

#[tokio::test]
async fn kill_thread_purges_dormant_only_entry() {
    let tmp = TempDir::new().unwrap();
    let ws_id = WorkspaceId::from("ws-kill");

    let manager = test_manager().await;
    register_workspace(&manager, &ws_id, tmp.path().to_path_buf()).await;

    manager
        .hydrate_dormant_for_workspace(
            &ws_id,
            vec![mapping("dorm-kill", "agent-a", Some("task-x"))],
        )
        .await;
    manager.persist_threads_for_workspace(&ws_id).await;

    assert_eq!(
        ThreadManager::load_from_dir(tmp.path()).await.unwrap().len(),
        1
    );

    manager.kill_thread("dorm-kill").await.unwrap();

    assert!(
        manager
            .dormant_snapshot_for_workspace(&ws_id)
            .await
            .is_empty()
    );
    assert_eq!(
        ThreadManager::load_from_dir(tmp.path()).await.unwrap().len(),
        0
    );
}

#[tokio::test]
async fn persist_includes_dormant_entries() {
    let tmp = TempDir::new().unwrap();
    let ws_id = WorkspaceId::from("ws-persist");

    let manager = test_manager().await;
    register_workspace(&manager, &ws_id, tmp.path().to_path_buf()).await;

    manager
        .hydrate_dormant_for_workspace(
            &ws_id,
            vec![mapping("dormant-1", "agent-a", Some("task-1"))],
        )
        .await;

    manager.persist_threads_for_workspace(&ws_id).await;

    let on_disk = ThreadManager::load_from_dir(tmp.path()).await.unwrap();
    assert_eq!(on_disk.len(), 1);
    assert_eq!(on_disk[0].thread_id, "dormant-1");
}
