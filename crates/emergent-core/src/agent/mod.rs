mod acp_bridge;
mod lifecycle;
mod prompt_loop;
pub mod queue;
pub mod registry;
pub mod spawner;
pub mod thread_manager;
pub mod usage_store;

pub use registry::AgentRegistry;
pub use spawner::{AgentProcess, LocalProcess, LocalProcessSpawner, ProcessSpawner};
pub use thread_manager::{ThreadInWorkspace, ThreadManager, ThreadMapping};

/// A conversation (thread) summary surfaced to MCP callers. Enriches
/// [`ThreadInWorkspace`] with the human-readable agent name.
#[derive(Clone, Debug, serde::Serialize)]
pub struct ConversationSummary {
    pub id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
}

use std::sync::Arc;

use emergent_protocol::{
    AgentCreatedPayload, AgentDefinition, AgentDeletedPayload, ConfigOption, Notification,
    ThreadSummary, WorkspaceId,
};
use tokio::sync::{broadcast, mpsc, oneshot, RwLock};

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
    pub(crate) workspace_id: WorkspaceId,
    pub(crate) command_tx: mpsc::UnboundedSender<AgentCommand>,
    /// Handle to the agent process (for kill).
    pub(crate) process: crate::agent::spawner::LocalProcess,
    /// Handle to the dedicated ACP thread (kept for ownership; not joined).
    pub(crate) thread_handle: Option<std::thread::JoinHandle<()>>,
    pub(crate) config_options: Vec<ConfigOption>,
    pub(crate) has_management_permissions: bool,
    /// Whether the thread has received at least one prompt (gates first-turn injection).
    pub(crate) has_prompted: bool,
    /// Optional task ID linking this thread to a task.
    pub(crate) task_id: Option<String>,
    /// Set once the agent has signalled task completion. Blocks new prompts so
    /// the final turn can drain and the session can be torn down cleanly.
    pub(crate) completing: bool,
    /// Permission state at time of last prompt — used to detect changes.
    pub(crate) last_prompted_permissions: bool,
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
    workspace_state: crate::workspace::SharedWorkspaceState,
    event_tx: broadcast::Sender<Notification>,
}

impl AgentManager {
    pub fn new(
        workspace_state: crate::workspace::SharedWorkspaceState,
        event_tx: broadcast::Sender<Notification>,
        token_registry: Arc<crate::mcp::TokenRegistry>,
    ) -> Self {
        let threads =
            ThreadManager::new(event_tx.clone(), token_registry, workspace_state.clone());

        Self {
            registry: Arc::new(RwLock::new(AgentRegistry::new())),
            threads,
            topology: Arc::new(RwLock::new(crate::swarm::Topology::new())),
            workspace_state,
            event_tx: event_tx.clone(),
        }
    }

    // -----------------------------------------------------------------------
    // Agent definition CRUD (coordinator → registry)
    // -----------------------------------------------------------------------

    /// Look up the on-disk path for a workspace (for persisting agents.json / tasks.json).
    pub async fn workspace_path(&self, workspace_id: &WorkspaceId) -> Option<std::path::PathBuf> {
        let state = self.workspace_state.read().await;
        state.workspaces.get(workspace_id).map(|ws| ws.path.clone())
    }

    /// Persist agent definitions for a workspace after a mutation.
    async fn persist_agents(&self, workspace_id: &WorkspaceId) {
        if let Some(path) = self.workspace_path(workspace_id).await {
            let reg = self.registry.read().await;
            if let Err(e) = reg.save_to_dir(workspace_id, &path).await {
                log::error!("Failed to persist agent definitions: {}", e);
            }
        }
    }

    /// Load persisted agent definitions for a workspace.
    pub async fn load_agents_for_workspace(
        &self,
        workspace_id: &WorkspaceId,
    ) -> Result<(), String> {
        let path = self
            .workspace_path(workspace_id)
            .await
            .ok_or_else(|| format!("Workspace '{}' not found", workspace_id))?;
        let mut reg = self.registry.write().await;
        reg.load_from_dir(&path).await
    }

    /// Load persisted thread mappings for a workspace.
    pub async fn load_thread_mappings(
        &self,
        workspace_id: &WorkspaceId,
    ) -> Result<Vec<ThreadMapping>, String> {
        let path = self
            .workspace_path(workspace_id)
            .await
            .ok_or_else(|| format!("Workspace '{}' not found", workspace_id))?;
        ThreadManager::load_from_dir(&path).await
    }

    pub async fn create_agent(
        &self,
        workspace_id: WorkspaceId,
        name: String,
        cli: String,
        provider: Option<String>,
    ) -> Result<String, String> {
        // Validate the workspace exists before registering the agent, so a bad
        // workspace_id can't create a half-orphaned agent definition.
        let ws_path = self
            .workspace_path(&workspace_id)
            .await
            .ok_or_else(|| format!("Workspace '{}' not found", workspace_id))?;

        let id = {
            let mut reg = self.registry.write().await;
            reg.create_agent(workspace_id.clone(), name, cli, provider)
        };
        self.persist_agents(&workspace_id).await;

        // Create the agent's host-side directory. This doubles as the agent's
        // $HOME and working directory when it runs as a local host process, so
        // its per-agent config (.claude, .codex, …) stays isolated.
        let agent_dir = crate::workspace::paths::WorkspacePaths::from_dir(ws_path).agent_dir(&id);
        if let Err(e) = tokio::fs::create_dir_all(&agent_dir).await {
            log::error!("Failed to create agent directory: {}", e);
        }

        let _ = self
            .event_tx
            .send(Notification::AgentCreated(AgentCreatedPayload {
                definition_id: id.clone(),
            }));
        Ok(id)
    }

    pub async fn update_agent(
        &self,
        agent_id: &str,
        name: Option<String>,
        provider: Option<String>,
    ) -> Result<(), String> {
        let workspace_id = {
            let mut reg = self.registry.write().await;
            reg.update_agent(agent_id, name, provider)?;
            reg.get_agent(agent_id).map(|d| d.workspace_id.clone())
        };
        if let Some(ws_id) = workspace_id {
            self.persist_agents(&ws_id).await;
        }
        Ok(())
    }

    pub async fn delete_agent(&self, agent_id: &str) -> Result<(), String> {
        // Kill all threads for this agent first
        self.threads.kill_threads_for_agent(agent_id).await?;

        // Remove from registry and get workspace_id for persistence
        let workspace_id = {
            let mut reg = self.registry.write().await;
            let def = reg.delete_agent(agent_id)?;
            def.workspace_id
        };
        self.persist_agents(&workspace_id).await;

        // Remove the agent's host-side directory
        if let Some(ws_path) = self.workspace_path(&workspace_id).await {
            let agent_dir =
                crate::workspace::paths::WorkspacePaths::from_dir(ws_path).agent_dir(agent_id);
            if agent_dir.exists() {
                if let Err(e) = tokio::fs::remove_dir_all(&agent_dir).await {
                    log::error!("Failed to remove agent directory: {}", e);
                }
            }
        }

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
        reg.list_definitions(workspace_id)
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
    pub async fn spawn_thread(
        &self,
        agent_id: &str,
        task_id: Option<String>,
    ) -> Result<String, String> {
        // Read agent definition
        let definition = {
            let reg = self.registry.read().await;
            reg.get_agent(agent_id)
                .cloned()
                .ok_or_else(|| format!("Agent definition '{}' not found", agent_id))?
        };

        // Validate the workspace exists. Agents run as local processes, so
        // there is no container to gate on.
        {
            let state = self.workspace_state.read().await;
            if !state.workspaces.contains_key(&definition.workspace_id) {
                return Err(format!("Workspace '{}' not found", definition.workspace_id));
            }
        }

        self.threads
            .spawn_thread(
                agent_id.to_string(),
                definition.workspace_id,
                definition.cli,
                task_id,
            )
            .await
    }

    /// Resume a persisted thread by loading its ACP session.
    pub async fn resume_thread(
        &self,
        thread_id: &str,
        agent_id: &str,
        acp_session_id: &str,
    ) -> Result<(), String> {
        // Read agent definition
        let definition = {
            let reg = self.registry.read().await;
            reg.get_agent(agent_id)
                .cloned()
                .ok_or_else(|| format!("Agent definition '{}' not found", agent_id))?
        };

        // Validate the workspace exists. Agents run as local processes, so
        // there is no container to gate on.
        {
            let state = self.workspace_state.read().await;
            if !state.workspaces.contains_key(&definition.workspace_id) {
                return Err(format!("Workspace '{}' not found", definition.workspace_id));
            }
        }

        // Recover persisted task_id so that task sessions remain callable
        // via complete_task after resume.
        let task_id = {
            let workspace_dir = {
                let state = self.workspace_state.read().await;
                state
                    .workspaces
                    .get(&definition.workspace_id)
                    .map(|ws| ws.path.clone())
            };
            match workspace_dir {
                Some(dir) => crate::agent::thread_manager::ThreadManager::load_from_dir(&dir)
                    .await
                    .ok()
                    .and_then(|mappings| {
                        mappings
                            .into_iter()
                            .find(|m| m.thread_id == thread_id)
                            .and_then(|m| m.task_id)
                    }),
                None => None,
            }
        };

        self.threads
            .resume_thread(
                thread_id.to_string(),
                agent_id.to_string(),
                definition.workspace_id,
                definition.cli,
                acp_session_id.to_string(),
                task_id,
            )
            .await
    }

    /// Delete a thread: kill if running and remove its persisted mapping.
    pub async fn delete_thread(
        &self,
        thread_id: &str,
        workspace_id: &WorkspaceId,
    ) -> Result<(), String> {
        // Kill the thread if it's currently running
        self.threads.kill_thread(thread_id).await?;
        // Re-persist to remove the mapping from threads.json
        self.threads
            .persist_threads_for_workspace(workspace_id)
            .await;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Thread operations (delegated to ThreadManager)
    // -----------------------------------------------------------------------

    /// Enqueue a message for a thread, holding it in the backend queue until the
    /// thread is idle and its prompt loop drains it. Accepts messages in any
    /// state; if the target is dormant, it is resumed (woken) so it can drain.
    ///
    /// Fire-and-forget: returns `Ok(())` once the message is queued (and a wake
    /// initiated if needed) — it does NOT block until the agent reads it.
    pub async fn enqueue_message(
        &self,
        thread_id: &str,
        source: queue::MessageSource,
        content: String,
    ) -> Result<(), String> {
        // Live target: enqueue and let the running prompt loop drain on idle.
        if let Some(ws) = self.threads.live_workspace(thread_id).await {
            self.threads.enqueue(thread_id, &ws, source, content).await?;
            return Ok(());
        }

        // Dormant target: it must be resumable, otherwise the message could
        // never be delivered — reject rather than silently hold it forever.
        let (ws, mapping) = self
            .threads
            .dormant_entry(thread_id)
            .await
            .ok_or_else(|| format!("Thread '{}' not found", thread_id))?;
        let acp_session_id = mapping
            .acp_session_id
            .clone()
            .ok_or_else(|| format!("Thread '{}' is not resumable", thread_id))?;

        // Enqueue first (so the held message is present the instant the resumed
        // prompt loop starts), then wake the thread from dormancy.
        self.threads.enqueue(thread_id, &ws, source, content).await?;
        self.resume_thread(thread_id, &mapping.agent_definition_id, &acp_session_id)
            .await
    }

    pub async fn notify_prompt_loop(&self, thread_id: &str) {
        self.threads.notify_prompt_loop(thread_id).await
    }

    pub async fn list_queue(&self, thread_id: &str) -> Vec<emergent_protocol::QueuedMessageView> {
        self.threads.list_queue(thread_id).await
    }

    pub async fn edit_queued(
        &self,
        thread_id: &str,
        msg_id: &str,
        content: String,
    ) -> Result<Vec<emergent_protocol::QueuedMessageView>, String> {
        self.threads.edit_queued(thread_id, msg_id, content).await
    }

    pub async fn remove_queued(
        &self,
        thread_id: &str,
        msg_id: &str,
    ) -> Result<Vec<emergent_protocol::QueuedMessageView>, String> {
        self.threads.remove_queued(thread_id, msg_id).await
    }

    pub async fn reorder_queue(
        &self,
        thread_id: &str,
        ids: &[String],
    ) -> Result<Vec<emergent_protocol::QueuedMessageView>, String> {
        self.threads.reorder_queue(thread_id, ids).await
    }

    pub async fn clear_queue(&self, thread_id: &str) {
        self.threads.clear_queue(thread_id).await
    }

    pub async fn cancel_prompt(&self, thread_id: &str) -> Result<(), String> {
        self.threads.cancel_prompt(thread_id).await
    }

    /// Kill a thread and clean up topology.
    pub async fn kill_thread(&self, thread_id: &str) -> Result<(), String> {
        self.threads.kill_thread(thread_id).await?;
        self.topology.write().await.remove_node(thread_id);
        Ok(())
    }

    /// Shut down a thread's subprocess but preserve its persisted mapping in
    /// `threads.json`. Used by task-completion teardown so the completed
    /// task's session remains resumable after restart.
    pub async fn shutdown_thread(&self, thread_id: &str) -> Result<(), String> {
        self.threads.shutdown_thread(thread_id).await?;
        self.topology.write().await.remove_node(thread_id);
        Ok(())
    }

    /// Kill all threads (live and dormant) in a workspace without deleting
    /// the workspace's agent definitions.
    pub async fn kill_threads_in_workspace(
        &self,
        workspace_id: &WorkspaceId,
    ) -> Result<(), String> {
        self.threads.kill_threads_in_workspace(workspace_id).await
    }

    /// Borrow the underlying `ThreadManager`. Used by startup code that
    /// needs to hydrate dormant mappings from disk, and by integration
    /// tests that manipulate the dormant map directly.
    pub fn thread_manager(&self) -> &ThreadManager {
        &self.threads
    }

    pub async fn thread_count_by_workspace(&self) -> std::collections::HashMap<WorkspaceId, usize> {
        self.threads.thread_count_by_workspace().await
    }

    pub async fn list_threads(&self, agent_id: &str) -> Vec<ThreadSummary> {
        self.threads.list_threads(agent_id).await
    }

    /// List all conversations (threads) in a workspace, enriched with the
    /// agent's display name. Unions live and dormant threads across every agent
    /// definition in the workspace.
    pub async fn list_conversations(&self, workspace_id: &WorkspaceId) -> Vec<ConversationSummary> {
        let threads = self.threads.list_threads_in_workspace(workspace_id).await;
        let registry = self.registry.read().await;
        threads
            .into_iter()
            .map(|t| {
                let agent_name = registry
                    .get_agent(&t.agent_id)
                    .map(|d| d.name.clone())
                    .unwrap_or_default();
                ConversationSummary {
                    id: t.id,
                    agent_id: t.agent_id,
                    agent_name,
                    status: t.status,
                    task_id: t.task_id,
                }
            })
            .collect()
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

    /// Mark a thread as completing. See `ThreadManager::mark_thread_completing`.
    pub async fn mark_thread_completing(&self, thread_id: &str) -> Result<(), String> {
        self.threads.mark_thread_completing(thread_id).await
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
                thread_id_a: a.to_string(),
                thread_id_b: b.to_string(),
            },
        ));
        Ok(())
    }

    pub async fn disconnect_agents(&self, a: &str, b: &str) {
        self.topology.write().await.disconnect(a, b);
        let _ = self.event_tx.send(Notification::TopologyChanged(
            emergent_protocol::TopologyChangedPayload {
                thread_id_a: a.to_string(),
                thread_id_b: b.to_string(),
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

    /// Return the set of all live (in-memory) thread IDs.
    pub async fn live_thread_ids(&self) -> std::collections::HashSet<String> {
        let threads = self.threads.threads.read().await;
        threads.keys().cloned().collect()
    }

    /// Return the task_id associated with a thread, if any.
    pub async fn get_thread_task_id(&self, thread_id: &str) -> Option<String> {
        let threads = self.threads.threads.read().await;
        let handle_arc = threads.get(thread_id)?;
        let handle = handle_arc.lock().await;
        handle.task_id.clone()
    }

    /// Return the workspace_id for a given thread.
    pub async fn get_thread_workspace_id(&self, thread_id: &str) -> Option<WorkspaceId> {
        let threads = self.threads.threads.read().await;
        let handle_arc = threads.get(thread_id)?;
        let handle = handle_arc.lock().await;
        Some(handle.workspace_id.clone())
    }

    /// Resolve a thread's workspace whether it is live or dormant. Used to
    /// validate that a `send_message` target shares the sender's workspace.
    pub async fn thread_workspace(&self, thread_id: &str) -> Option<WorkspaceId> {
        if let Some(ws) = self.threads.live_workspace(thread_id).await {
            return Some(ws);
        }
        self.threads
            .dormant_entry(thread_id)
            .await
            .map(|(ws, _)| ws)
    }
}

