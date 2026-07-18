//! Test-only seams into `ThreadManager`.
//!
//! These exist because the integration tests in `tests/` are separate crates
//! and cannot reach `#[cfg(test)]` internals. They are gated behind the
//! `test-support` feature so production builds never compile them; see the
//! feature comment in this crate's `Cargo.toml`.
//!
//! Nothing here should be called from production code — each method
//! deliberately bypasses an invariant the real code path maintains.

use std::sync::Arc;

use emergent_protocol::WorkspaceId;
use tokio::sync::Mutex;

use super::thread_manager::ThreadManager;

impl ThreadManager {
    /// Inject a usage delta for a workspace, bypassing the recorder task that
    /// populates the store in production.
    pub async fn apply_usage_delta_for_test(
        &self,
        workspace_id: &WorkspaceId,
        agent_id: &str,
        delta: &super::usage_store::TurnDelta,
        at: &str,
    ) {
        let mut stores = self.usage_stores.write().await;
        let store = stores.entry(workspace_id.clone()).or_default();
        super::usage_store::apply_turn_delta(store, agent_id, delta, at);
    }

    /// Register a workspace directly in the manager's shared state, bypassing
    /// `WorkspaceManager`.
    pub async fn register_workspace_for_test(
        &self,
        workspace_id: WorkspaceId,
        path: std::path::PathBuf,
    ) {
        use crate::workspace::Workspace;
        let mut state = self.workspace_state.write().await;
        state.workspaces.insert(
            workspace_id,
            Workspace {
                name: "test-ws".into(),
                path,
            },
        );
    }

    /// Register a fake live thread in the threads map. The handle carries a
    /// stub process and an mpsc channel that is never polled, which is enough
    /// for recorder-path tests that resolve `acp_session_id` from the live map
    /// without spawning a real agent.
    pub async fn register_live_thread_for_test(
        &self,
        thread_id: String,
        agent_definition_id: String,
        workspace_id: WorkspaceId,
        acp_session_id: Option<String>,
    ) {
        use crate::agent::spawner::LocalProcess;
        use tokio::sync::mpsc;

        let (command_tx, _command_rx) = mpsc::unbounded_channel();

        // A no-op child that exits immediately — the minimal valid `Child`.
        let child = tokio::process::Command::new("true")
            .spawn()
            .expect("failed to spawn 'true' for test stub");
        let process = LocalProcess::new_for_test(child);

        let handle = super::ThreadHandle {
            agent_id: agent_definition_id,
            acp_session_id,
            status: emergent_protocol::AgentStatus::Idle,
            workspace_id,
            command_tx,
            process,
            thread_handle: None,
            config_options: Vec::new(),
            has_management_permissions: false,
            has_prompted: false,
            task_id: None,
            completing: false,
            last_prompted_permissions: false,
            prompt_loop_handle: None,
        };

        let mut threads = self.threads.write().await;
        threads.insert(thread_id, Arc::new(Mutex::new(handle)));
    }

    /// Update `acp_session_id` on a live handle, simulating session renewal
    /// after a kill+respawn cycle.
    pub async fn set_acp_session_id_for_test(
        &self,
        thread_id: &str,
        acp_session_id: Option<String>,
    ) {
        let threads = self.threads.read().await;
        if let Some(h) = threads.get(thread_id) {
            h.lock().await.acp_session_id = acp_session_id;
        }
    }

    /// Drop the cumulative token snapshot for an `acp_session_id`, mirroring
    /// what `kill_thread` does.
    pub async fn clear_session_snapshot_for_test(&self, acp_session_id: &str) {
        self.last_session_snapshots
            .write()
            .await
            .remove(acp_session_id);
        self.last_cost_snapshots
            .write()
            .await
            .remove(acp_session_id);
    }
}
