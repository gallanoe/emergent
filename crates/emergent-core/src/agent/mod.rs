mod acp_bridge;
mod lifecycle;
mod prompt_loop;
pub mod registry;
pub mod spawner;
pub mod thread_manager;

pub use registry::AgentRegistry;
pub use spawner::{AgentProcess, DockerCliSpawner, ProcessSpawner};
pub use thread_manager::ThreadManager;

use std::collections::HashMap;
use std::sync::Arc;

use emergent_protocol::{
    AgentCreatedPayload, AgentDefinition, AgentDeletedPayload, AgentSummary, ConfigOption,
    Notification, ThreadSummary, WorkspaceId,
};
use tokio::sync::{broadcast, mpsc, oneshot, RwLock};

use crate::swarm::Mailbox;

// ---------------------------------------------------------------------------
// Commands sent to the dedicated ACP thread
// ---------------------------------------------------------------------------

pub(crate) enum AgentCommand {
    Prompt {
        text: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Cancel {
        reply: oneshot::Sender<Result<(), String>>,
    },
    SetConfig {
        config_id: String,
        value: String,
        reply: oneshot::Sender<Result<Vec<ConfigOption>, String>>,
    },
    Shutdown,
}

// ---------------------------------------------------------------------------
// ThreadHandle — the Send-safe handle stored in the manager map
// ---------------------------------------------------------------------------

pub(crate) struct ThreadHandle {
    /// Parent agent definition ID.
    pub(crate) agent_id: String,
    /// ACP session ID returned by the agent CLI during init handshake.
    #[allow(dead_code)] // Used for future session resumption
    pub(crate) acp_session_id: Option<String>,
    pub(crate) status: emergent_protocol::AgentStatus,
    pub(crate) cli: String,
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) command_tx: mpsc::UnboundedSender<AgentCommand>,
    /// Handle to the agent process (for kill).
    pub(crate) process: crate::agent::spawner::DockerCliProcess,
    /// Handle to the dedicated ACP thread (kept for ownership; not joined).
    pub(crate) thread_handle: Option<std::thread::JoinHandle<()>>,
    pub(crate) config_options: Vec<ConfigOption>,
    pub(crate) has_management_permissions: bool,
    /// Whether the thread has received at least one prompt (gates first-turn injection).
    pub(crate) has_prompted: bool,
    /// Optional role for this thread. Read from parent AgentDefinition.
    pub(crate) role: Option<String>,
    /// Permission state at time of last prompt — used to detect changes.
    pub(crate) last_prompted_permissions: bool,
    /// Wakes the prompt loop when work is available.
    pub(crate) prompt_notify: Arc<tokio::sync::Notify>,
    /// Queued user prompt + reply channel. At most one pending at a time.
    pub(crate) pending_prompt: Option<(String, oneshot::Sender<Result<(), String>>)>,
    /// Handle to the prompt loop task (aborted on kill).
    pub(crate) prompt_loop_handle: Option<tokio::task::JoinHandle<()>>,
}

// ---------------------------------------------------------------------------
// AgentManager — coordinator that owns AgentRegistry + ThreadManager
// ---------------------------------------------------------------------------

pub struct AgentManager {
    registry: Arc<RwLock<AgentRegistry>>,
    pub(crate) threads: ThreadManager,
    topology: Arc<RwLock<crate::swarm::Topology>>,
    #[allow(dead_code)] // Kept for future mailbox reconnection
    mailboxes: Arc<RwLock<HashMap<String, Mailbox>>>,
    workspace_state: crate::workspace::SharedWorkspaceState,
    event_tx: broadcast::Sender<Notification>,
}

impl AgentManager {
    pub fn new(
        workspace_state: crate::workspace::SharedWorkspaceState,
        event_tx: broadcast::Sender<Notification>,
        token_registry: Arc<crate::mcp::TokenRegistry>,
    ) -> Self {
        enrich_path();

        let threads = ThreadManager::new(event_tx.clone(), token_registry);

        Self {
            registry: Arc::new(RwLock::new(AgentRegistry::new())),
            threads,
            topology: Arc::new(RwLock::new(crate::swarm::Topology::new())),
            mailboxes: Arc::new(RwLock::new(HashMap::new())),
            workspace_state,
            event_tx: event_tx.clone(),
        }
    }

    // -----------------------------------------------------------------------
    // Agent definition CRUD (coordinator → registry)
    // -----------------------------------------------------------------------

    pub async fn create_agent(
        &self,
        workspace_id: WorkspaceId,
        name: String,
        role: String,
        cli: String,
    ) -> String {
        let id = {
            let mut reg = self.registry.write().await;
            reg.create_agent(workspace_id, name, role, cli)
        };
        let _ = self
            .event_tx
            .send(Notification::AgentCreated(AgentCreatedPayload {
                definition_id: id.clone(),
            }));
        id
    }

    pub async fn update_agent(
        &self,
        agent_id: &str,
        name: Option<String>,
        role: Option<String>,
    ) -> Result<(), String> {
        let mut reg = self.registry.write().await;
        reg.update_agent(agent_id, name, role)
    }

    pub async fn delete_agent(&self, agent_id: &str) -> Result<(), String> {
        // Kill all threads for this agent first
        self.threads.kill_threads_for_agent(agent_id).await?;

        // Remove from registry
        let mut reg = self.registry.write().await;
        reg.delete_agent(agent_id)?;
        drop(reg);

        let _ = self
            .event_tx
            .send(Notification::AgentDeleted(AgentDeletedPayload {
                definition_id: agent_id.to_string(),
            }));
        Ok(())
    }

    pub async fn get_agent(&self, agent_id: &str) -> Option<AgentDefinition> {
        let reg = self.registry.read().await;
        reg.get_agent(agent_id).cloned()
    }

    pub async fn list_agent_definitions(&self, workspace_id: &WorkspaceId) -> Vec<AgentDefinition> {
        let reg = self.registry.read().await;
        reg.list_agents(workspace_id)
            .into_iter()
            .cloned()
            .collect()
    }

    // -----------------------------------------------------------------------
    // Thread lifecycle (coordinator → thread manager)
    // -----------------------------------------------------------------------

    /// Spawn a new thread under an agent definition.
    /// Reads CLI and workspace from the definition, validates the container,
    /// then delegates to ThreadManager.
    pub async fn spawn_thread(&self, agent_id: &str) -> Result<String, String> {
        // Read agent definition
        let definition = {
            let reg = self.registry.read().await;
            reg.get_agent(agent_id)
                .cloned()
                .ok_or_else(|| format!("Agent definition '{}' not found", agent_id))?
        };

        // Validate workspace container is running and get container_id
        let container_id = {
            let state = self.workspace_state.read().await;
            let ws = state
                .workspaces
                .get(&definition.workspace_id)
                .ok_or_else(|| {
                    format!("Workspace '{}' not found", definition.workspace_id)
                })?;
            match &ws.container_status {
                emergent_protocol::ContainerStatus::Running => {}
                other => {
                    return Err(format!(
                        "Workspace '{}' container is not running (status: {})",
                        definition.workspace_id, other
                    ));
                }
            }
            ws.container_id
                .clone()
                .ok_or_else(|| {
                    format!(
                        "Workspace '{}' has no container_id",
                        definition.workspace_id
                    )
                })?
        };

        self.threads
            .spawn_thread(
                agent_id.to_string(),
                definition.workspace_id,
                container_id,
                definition.cli,
                Some(definition.role),
            )
            .await
    }

    /// Spawn a thread the old way (without agent definition) — kept for backward
    /// compatibility during migration. Delegates directly to ThreadManager.
    pub async fn spawn_agent(
        &self,
        workspace_id: WorkspaceId,
        agent_binary: String,
        role: Option<String>,
    ) -> Result<String, String> {
        // Validate workspace container
        let container_id = {
            let state = self.workspace_state.read().await;
            let ws = state
                .workspaces
                .get(&workspace_id)
                .ok_or_else(|| format!("Workspace '{}' not found", workspace_id))?;
            match &ws.container_status {
                emergent_protocol::ContainerStatus::Running => {}
                other => {
                    return Err(format!(
                        "Workspace '{}' container is not running (status: {})",
                        workspace_id, other
                    ));
                }
            }
            ws.container_id
                .clone()
                .ok_or_else(|| format!("Workspace '{}' has no container_id", workspace_id))?
        };

        self.threads
            .spawn_thread(
                String::new(), // no agent definition
                workspace_id,
                container_id,
                agent_binary,
                role,
            )
            .await
    }

    // -----------------------------------------------------------------------
    // Thread operations (delegated to ThreadManager)
    // -----------------------------------------------------------------------

    pub async fn queue_prompt(
        &self,
        thread_id: &str,
        text: String,
        role: Option<String>,
    ) -> Result<oneshot::Receiver<Result<(), String>>, String> {
        self.threads.queue_prompt(thread_id, text, role).await
    }

    pub async fn notify_prompt_loop(&self, thread_id: &str) {
        self.threads.notify_prompt_loop(thread_id).await
    }

    pub async fn cancel_prompt(&self, thread_id: &str) -> Result<(), String> {
        self.threads.cancel_prompt(thread_id).await
    }

    /// Kill a thread and clean up topology.
    pub async fn kill_agent(&self, thread_id: &str) -> Result<(), String> {
        self.threads.kill_thread(thread_id).await?;
        self.topology.write().await.remove_agent(thread_id);
        Ok(())
    }

    /// Kill all threads in a workspace by deleting all agent definitions.
    pub async fn kill_agents_in_workspace(
        &self,
        workspace_id: &WorkspaceId,
    ) -> Result<(), String> {
        let agent_ids: Vec<String> = {
            let reg = self.registry.read().await;
            reg.list_agents(workspace_id)
                .iter()
                .map(|a| a.id.clone())
                .collect()
        };

        for id in agent_ids {
            self.delete_agent(&id).await?;
        }

        // Also kill any threads without agent definitions (legacy)
        let orphan_thread_ids: Vec<String> = {
            let threads = self.threads.threads.read().await;
            let mut ids = Vec::new();
            for (id, handle_arc) in threads.iter() {
                let handle = handle_arc.lock().await;
                if &handle.workspace_id == workspace_id {
                    ids.push(id.clone());
                }
            }
            ids
        };
        for id in orphan_thread_ids {
            self.kill_agent(&id).await?;
        }

        Ok(())
    }

    pub async fn list_agents(&self) -> Vec<AgentSummary> {
        self.threads.list_all_threads().await
    }

    pub async fn list_threads(&self, agent_id: &str) -> Vec<ThreadSummary> {
        self.threads.list_threads(agent_id).await
    }

    pub async fn get_config(&self, thread_id: &str) -> Result<Vec<ConfigOption>, String> {
        self.threads.get_config(thread_id).await
    }

    pub async fn set_config(
        &self,
        thread_id: &str,
        config_id: String,
        value: String,
    ) -> Result<Vec<ConfigOption>, String> {
        self.threads.set_config(thread_id, config_id, value).await
    }

    pub async fn get_history(&self, thread_id: &str) -> Result<Vec<Notification>, String> {
        self.threads.get_history(thread_id).await
    }

    pub async fn set_mcp_port(&self, port: u16) {
        self.threads.set_mcp_port(port);
    }

    pub async fn has_management_permissions(&self, thread_id: &str) -> bool {
        self.threads.has_management_permissions(thread_id).await
    }

    pub async fn set_management_permissions(
        &self,
        thread_id: &str,
        enabled: bool,
    ) -> Result<(), String> {
        self.threads
            .set_management_permissions(thread_id, enabled)
            .await
    }

    pub async fn is_agent_idle(&self, thread_id: &str) -> bool {
        self.threads.is_thread_idle(thread_id).await
    }

    // -----------------------------------------------------------------------
    // Swarm: topology (stays on coordinator)
    // -----------------------------------------------------------------------

    pub async fn connect_agents(&self, a: &str, b: &str) -> Result<(), String> {
        // Validate both threads are in the same workspace
        let threads = self.threads.threads.read().await;
        let handle_a = threads
            .get(a)
            .ok_or_else(|| format!("Thread '{}' not found", a))?;
        let handle_b = threads
            .get(b)
            .ok_or_else(|| format!("Thread '{}' not found", b))?;
        let ws_a = handle_a.lock().await.workspace_id.clone();
        let ws_b = handle_b.lock().await.workspace_id.clone();
        drop(threads);

        if ws_a != ws_b {
            return Err("Cannot connect threads in different workspaces".to_string());
        }

        self.topology.write().await.connect(a, b);
        let _ = self.event_tx.send(Notification::TopologyChanged(
            emergent_protocol::TopologyChangedPayload {
                agent_id_a: a.to_string(),
                agent_id_b: b.to_string(),
            },
        ));
        Ok(())
    }

    pub async fn disconnect_agents(&self, a: &str, b: &str) {
        self.topology.write().await.disconnect(a, b);
        let _ = self.event_tx.send(Notification::TopologyChanged(
            emergent_protocol::TopologyChangedPayload {
                agent_id_a: a.to_string(),
                agent_id_b: b.to_string(),
            },
        ));
    }

    pub async fn get_connections(&self, thread_id: &str) -> Vec<String> {
        self.topology.read().await.peers(thread_id)
    }

    // -----------------------------------------------------------------------
    // Agent name lookup (for MCP handler)
    // -----------------------------------------------------------------------

    pub async fn get_agent_name_for_thread(&self, thread_id: &str) -> Option<String> {
        let threads = self.threads.threads.read().await;
        let handle_arc = threads.get(thread_id)?;
        let handle = handle_arc.lock().await;
        let registry = self.registry.read().await;
        registry.get_agent(&handle.agent_id).map(|d| d.name.clone())
    }
}

/// Enrich PATH with common CLI install locations.
fn enrich_path() {
    let home = match std::env::var("HOME") {
        Ok(h) => std::path::PathBuf::from(h),
        Err(_) => return,
    };

    let extra_dirs: Vec<std::path::PathBuf> = vec![
        home.join(".local/bin"),
        home.join(".cargo/bin"),
        home.join(".bun/bin"),
        home.join(".nvm/current/bin"),
        home.join(".local/share/fnm/aliases/default/bin"),
        std::path::PathBuf::from("/usr/local/bin"),
        std::path::PathBuf::from("/opt/homebrew/bin"),
    ];

    let current_path = std::env::var("PATH").unwrap_or_default();
    let mut dirs: Vec<std::path::PathBuf> = std::env::split_paths(&current_path).collect();

    for dir in extra_dirs {
        if dir.is_dir() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }

    if let Ok(new_path) = std::env::join_paths(&dirs) {
        unsafe { std::env::set_var("PATH", &new_path) };
    }
}
