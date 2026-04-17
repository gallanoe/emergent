use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use emergent_protocol::{
    AgentStatus, ConfigOption, ConfigUpdatePayload, Notification, StatusChangePayload,
    ThreadErrorPayload, ThreadSummary, WorkspaceId,
};
use tokio::sync::{broadcast, oneshot, Mutex, RwLock};

use super::lifecycle::SessionInit;
use super::{lifecycle, AgentCommand, ThreadHandle};

/// Persisted thread-to-session mapping (stored in threads.json).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ThreadMapping {
    pub thread_id: String,
    pub agent_definition_id: String,
    pub acp_session_id: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
}

pub struct ThreadManager {
    pub(crate) threads: Arc<RwLock<HashMap<String, Arc<Mutex<ThreadHandle>>>>>,
    pub(crate) event_tx: broadcast::Sender<Notification>,
    pub(crate) history: Arc<RwLock<HashMap<String, Vec<Notification>>>>,
    pub(crate) token_registry: Arc<crate::mcp::TokenRegistry>,
    pub(crate) mcp_port: std::sync::atomic::AtomicU16,
    pub(crate) workspace_state: crate::workspace::SharedWorkspaceState,
    pub(crate) runtime: crate::runtime::SharedRuntime,
}

impl ThreadManager {
    pub fn new(
        event_tx: broadcast::Sender<Notification>,
        token_registry: Arc<crate::mcp::TokenRegistry>,
        workspace_state: crate::workspace::SharedWorkspaceState,
        runtime: crate::runtime::SharedRuntime,
    ) -> Self {
        let history: Arc<RwLock<HashMap<String, Vec<Notification>>>> =
            Arc::new(RwLock::new(HashMap::new()));

        // Spawn background task to record all notifications into per-thread history
        let history_clone = history.clone();
        let mut recorder_rx: broadcast::Receiver<Notification> = event_tx.subscribe();
        tokio::spawn(async move {
            loop {
                match recorder_rx.recv().await {
                    Ok(notification) => {
                        if let Some(thread_id) = notification.thread_id() {
                            let mut h = history_clone.write().await;
                            h.entry(thread_id.to_string())
                                .or_default()
                                .push(notification);
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        log::warn!("History recorder lagged, missed {} notifications", n);
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });

        Self {
            threads: Arc::new(RwLock::new(HashMap::new())),
            event_tx,
            history,
            token_registry,
            mcp_port: std::sync::atomic::AtomicU16::new(0),
            workspace_state,
            runtime,
        }
    }

    /// Set the MCP HTTP server port (called after HTTP server binds).
    pub fn set_mcp_port(&self, port: u16) {
        self.mcp_port
            .store(port, std::sync::atomic::Ordering::Relaxed);
    }

    /// Generate a short 8-character hex ID from random bytes.
    fn generate_short_id() -> String {
        use std::fmt::Write;
        let mut buf = [0u8; 4];
        getrandom::fill(&mut buf).expect("Failed to generate random bytes");
        let mut id = String::with_capacity(8);
        for byte in &buf {
            write!(id, "{:02x}", byte).unwrap();
        }
        id
    }

    /// Spawn a thread subprocess asynchronously.
    ///
    /// Returns the thread ID immediately. The ACP handshake runs in a background
    /// task and emits `StatusChange(Idle)` or `Error` notifications on completion.
    #[allow(clippy::too_many_arguments)]
    pub async fn spawn_thread(
        &self,
        agent_definition_id: String,
        workspace_id: WorkspaceId,
        container_id: String,
        agent_binary: String,
        role: Option<String>,
        task_id: Option<String>,
    ) -> Result<String, String> {
        let thread_id = Self::generate_short_id();

        log::info!(
            "Spawning thread {} (agent: {}, cli: {}, workspace: {}, container: {})",
            &thread_id,
            &agent_definition_id,
            agent_binary,
            workspace_id,
            container_id
        );

        let threads = self.threads.clone();
        let event_tx = self.event_tx.clone();
        let history = self.history.clone();
        let id = thread_id.clone();
        let ws_state = self.workspace_state.clone();

        let bearer_token = self.token_registry.register(&id, task_id.clone());
        let mcp_port = self.mcp_port.load(std::sync::atomic::Ordering::Relaxed);

        let ws_id_for_persist = workspace_id.clone();
        let threads_for_persist = self.threads.clone();
        let token_registry_for_cleanup = self.token_registry.clone();
        let runtime = self.runtime.read().await;
        let cli_program = runtime.cli_program().to_string();
        let mcp_host_alias = runtime.mcp_host_alias().to_string();
        drop(runtime);

        tokio::spawn(async move {
            match lifecycle::initialize_agent(
                id.clone(),
                agent_definition_id,
                workspace_id,
                container_id,
                agent_binary,
                role,
                task_id,
                SessionInit::New,
                threads,
                event_tx.clone(),
                history,
                mcp_port,
                bearer_token,
                cli_program,
                mcp_host_alias,
            )
            .await
            {
                Ok(()) => {
                    log::info!("Thread {} spawned successfully", &id);
                    // Persist thread mappings after successful init
                    let workspace_dir = {
                        let state = ws_state.read().await;
                        state
                            .workspaces
                            .get(&ws_id_for_persist)
                            .map(|ws| ws.path.clone())
                    };
                    if let Some(dir) = workspace_dir {
                        let mappings =
                            Self::collect_mappings_static(&threads_for_persist, &ws_id_for_persist)
                                .await;
                        if let Err(e) = Self::save_to_dir(&mappings, &dir).await {
                            log::error!("Failed to persist thread mappings: {}", e);
                        }
                    }
                }
                Err(e) => {
                    log::error!("Thread {} failed to initialize: {}", &id, e);
                    // Revoke the bearer token registered before spawn. Otherwise
                    // the token remains valid in the registry for a thread that
                    // does not exist.
                    token_registry_for_cleanup.revoke_agent(&id);
                    let _ = event_tx.send(Notification::Error(ThreadErrorPayload {
                        thread_id: id,
                        message: e,
                    }));
                }
            }
        });

        Ok(thread_id)
    }

    /// Resume a persisted thread by loading its ACP session.
    ///
    /// Re-uses the original thread ID so the frontend can map it back to
    /// the persisted stub.
    #[allow(clippy::too_many_arguments)]
    pub async fn resume_thread(
        &self,
        thread_id: String,
        agent_definition_id: String,
        workspace_id: WorkspaceId,
        container_id: String,
        agent_binary: String,
        role: Option<String>,
        acp_session_id: String,
        task_id: Option<String>,
    ) -> Result<(), String> {
        // Check if thread is already live
        {
            let threads = self.threads.read().await;
            if threads.contains_key(&thread_id) {
                return Err(format!("Thread '{}' is already running", thread_id));
            }
        }

        log::info!(
            "Resuming thread {} (agent: {}, session: {}, workspace: {})",
            &thread_id,
            &agent_definition_id,
            &acp_session_id,
            &workspace_id,
        );

        let threads = self.threads.clone();
        let event_tx = self.event_tx.clone();
        let history = self.history.clone();
        let id = thread_id.clone();

        let bearer_token = self.token_registry.register(&id, task_id.clone());
        let mcp_port = self.mcp_port.load(std::sync::atomic::Ordering::Relaxed);
        let token_registry_for_cleanup = self.token_registry.clone();
        let runtime = self.runtime.read().await;
        let cli_program = runtime.cli_program().to_string();
        let mcp_host_alias = runtime.mcp_host_alias().to_string();
        drop(runtime);

        tokio::spawn(async move {
            match lifecycle::initialize_agent(
                id.clone(),
                agent_definition_id,
                workspace_id,
                container_id,
                agent_binary,
                role,
                task_id,
                SessionInit::Load { acp_session_id },
                threads,
                event_tx.clone(),
                history,
                mcp_port,
                bearer_token,
                cli_program,
                mcp_host_alias,
            )
            .await
            {
                Ok(()) => {
                    log::info!("Thread {} resumed successfully", &id);
                }
                Err(e) => {
                    log::error!("Thread {} failed to resume: {}", &id, e);
                    token_registry_for_cleanup.revoke_agent(&id);
                    let _ = event_tx.send(Notification::Error(ThreadErrorPayload {
                        thread_id: id,
                        message: e,
                    }));
                }
            }
        });

        Ok(())
    }

    /// Queue a user prompt for a thread.
    pub async fn queue_prompt(
        &self,
        thread_id: &str,
        text: String,
        role: Option<String>,
    ) -> Result<oneshot::Receiver<Result<(), String>>, String> {
        let handle_arc = {
            let threads = self.threads.read().await;
            threads
                .get(thread_id)
                .cloned()
                .ok_or_else(|| format!("Thread '{}' not found", thread_id))?
        };

        let mut handle = handle_arc.lock().await;

        if handle.completing {
            return Err(format!(
                "Thread '{}' has completed its task and is shutting down",
                thread_id
            ));
        }
        if handle.pending_prompt.is_some() {
            return Err(format!(
                "Thread '{}' already has a pending prompt",
                thread_id
            ));
        }
        if handle.status != AgentStatus::Idle {
            return Err(format!(
                "Thread '{}' is not idle (current status: {})",
                thread_id, handle.status
            ));
        }

        // Set role on first prompt if provided.
        if !handle.has_prompted {
            if let Some(r) = role {
                handle.role = Some(r);
            }
        }

        let (reply_tx, reply_rx) = oneshot::channel();
        handle.pending_prompt = Some((text, reply_tx));
        handle.prompt_notify.notify_one();

        Ok(reply_rx)
    }

    /// Wake a thread's prompt loop.
    pub async fn notify_prompt_loop(&self, thread_id: &str) {
        let threads = self.threads.read().await;
        if let Some(handle_arc) = threads.get(thread_id) {
            let handle = handle_arc.lock().await;
            handle.prompt_notify.notify_one();
        }
    }

    /// Cancel the current prompt on a thread.
    pub async fn cancel_prompt(&self, thread_id: &str) -> Result<(), String> {
        let handle_arc = {
            let threads = self.threads.read().await;
            threads
                .get(thread_id)
                .cloned()
                .ok_or_else(|| format!("Thread '{}' not found", thread_id))?
        };

        let handle = handle_arc.lock().await;

        if handle.status != AgentStatus::Working {
            return Ok(());
        }

        let (reply_tx, reply_rx) = oneshot::channel();
        handle
            .command_tx
            .send(AgentCommand::Cancel { reply: reply_tx })
            .map_err(|_| "Thread has terminated".to_string())?;

        drop(handle);

        reply_rx
            .await
            .map_err(|_| "Thread terminated during cancel".to_string())?
    }

    /// Shut down a thread's subprocess and remove it from the in-memory map,
    /// but leave its persisted `threads.json` entry intact. Returns the
    /// workspace the thread belonged to, or `None` if the thread was not
    /// found.
    ///
    /// Use this for task-completion teardown, where the process should stop
    /// but the session mapping must remain resumable. Callers that want the
    /// mapping purged from disk should use `kill_thread` instead.
    ///
    /// Does NOT handle topology cleanup — that's the coordinator's job.
    pub async fn shutdown_thread(
        &self,
        thread_id: &str,
    ) -> Result<Option<WorkspaceId>, String> {
        log::info!("Shutting down thread {}", thread_id);

        let _ = self
            .event_tx
            .send(Notification::StatusChange(StatusChangePayload {
                thread_id: thread_id.to_string(),
                status: AgentStatus::Dead.to_string(),
            }));

        let handle_arc = {
            let mut threads = self.threads.write().await;
            match threads.remove(thread_id) {
                Some(h) => h,
                None => return Ok(None),
            }
        };

        let mut handle = handle_arc.lock().await;
        let workspace_id = handle.workspace_id.clone();

        if let Some(loop_handle) = handle.prompt_loop_handle.take() {
            loop_handle.abort();
        }

        let _ = handle.command_tx.send(AgentCommand::Shutdown);

        let _ = handle
            .process
            .shutdown(std::time::Duration::from_secs(2))
            .await;

        drop(handle.thread_handle.take());
        drop(handle);

        self.token_registry.revoke_agent(thread_id);

        Ok(Some(workspace_id))
    }

    /// Kill a thread: shut down its subprocess, remove it from the in-memory
    /// map, and purge its entry from `threads.json`.
    pub async fn kill_thread(&self, thread_id: &str) -> Result<(), String> {
        if let Some(workspace_id) = self.shutdown_thread(thread_id).await? {
            self.persist_threads_for_workspace(&workspace_id).await;
        }
        Ok(())
    }

    /// Kill all threads belonging to a given agent definition.
    pub async fn kill_threads_for_agent(&self, agent_definition_id: &str) -> Result<(), String> {
        let candidates: Vec<(String, Arc<Mutex<ThreadHandle>>)> = {
            let threads = self.threads.read().await;
            threads
                .iter()
                .map(|(id, handle_arc)| (id.clone(), handle_arc.clone()))
                .collect()
        };

        let mut to_kill = Vec::new();
        for (id, handle_arc) in candidates {
            // Use .lock().await so we do not silently skip threads whose
            // mutex is temporarily held by the prompt loop.
            let handle = handle_arc.lock().await;
            if handle.agent_id == agent_definition_id {
                to_kill.push(id);
            }
        }

        for id in to_kill {
            self.kill_thread(&id).await?;
        }

        Ok(())
    }

    /// Count running threads grouped by workspace.
    pub async fn thread_count_by_workspace(&self) -> HashMap<WorkspaceId, usize> {
        let threads = self.threads.read().await;
        let mut counts: HashMap<WorkspaceId, usize> = HashMap::new();
        for handle_arc in threads.values() {
            let handle = handle_arc.lock().await;
            *counts.entry(handle.workspace_id.clone()).or_default() += 1;
        }
        counts
    }

    /// List threads for a specific agent definition.
    pub async fn list_threads(&self, agent_definition_id: &str) -> Vec<ThreadSummary> {
        let threads = self.threads.read().await;
        let mut result = Vec::new();
        for (id, handle_arc) in threads.iter() {
            let handle = handle_arc.lock().await;
            if handle.agent_id == agent_definition_id {
                result.push(ThreadSummary {
                    id: id.clone(),
                    agent_id: handle.agent_id.clone(),
                    status: handle.status.to_string(),
                    workspace_id: handle.workspace_id.clone(),
                    acp_session_id: handle.acp_session_id.clone(),
                });
            }
        }
        result
    }

    /// Get the current config options for a thread.
    pub async fn get_config(&self, thread_id: &str) -> Result<Vec<ConfigOption>, String> {
        let handle_arc = {
            let threads = self.threads.read().await;
            threads
                .get(thread_id)
                .cloned()
                .ok_or_else(|| format!("Thread '{}' not found", thread_id))?
        };
        let handle = handle_arc.lock().await;
        Ok(handle.config_options.clone())
    }

    /// Set a config option on a thread via ACP.
    pub async fn set_config(
        &self,
        thread_id: &str,
        config_id: String,
        value: String,
    ) -> Result<Vec<ConfigOption>, String> {
        let handle_arc = {
            let threads = self.threads.read().await;
            threads
                .get(thread_id)
                .cloned()
                .ok_or_else(|| format!("Thread '{}' not found", thread_id))?
        };

        let (reply_tx, reply_rx) = oneshot::channel();
        {
            let handle = handle_arc.lock().await;
            handle
                .command_tx
                .send(AgentCommand::SetConfig {
                    config_id,
                    value,
                    reply: reply_tx,
                })
                .map_err(|_| "Thread has terminated".to_string())?;
        }

        let new_config = reply_rx
            .await
            .map_err(|_| "Thread terminated during set_config".to_string())??;

        {
            let mut handle = handle_arc.lock().await;
            let old_config = std::mem::replace(&mut handle.config_options, new_config.clone());
            let changes = crate::config::diff_config(&old_config, &new_config);
            if !changes.is_empty() {
                let _ = self
                    .event_tx
                    .send(Notification::ConfigUpdate(ConfigUpdatePayload {
                        thread_id: thread_id.to_string(),
                        config_options: new_config.clone(),
                        changes,
                    }));
            }
        }

        Ok(new_config)
    }

    /// Get notification history for a thread.
    pub async fn get_history(&self, thread_id: &str) -> Result<Vec<Notification>, String> {
        let history = self.history.read().await;
        history
            .get(thread_id)
            .cloned()
            .ok_or_else(|| format!("Thread '{}' not found", thread_id))
    }

    /// Check if a thread is idle.
    pub async fn is_thread_idle(&self, thread_id: &str) -> bool {
        let threads = self.threads.read().await;
        match threads.get(thread_id) {
            Some(h) => h.lock().await.status == AgentStatus::Idle,
            None => false,
        }
    }

    /// Check if a thread has management permissions.
    pub async fn has_management_permissions(&self, thread_id: &str) -> bool {
        let threads = self.threads.read().await;
        match threads.get(thread_id) {
            Some(handle_arc) => handle_arc.lock().await.has_management_permissions,
            None => false,
        }
    }

    /// Mark a thread as completing its task. Blocks further prompts; the
    /// thread itself is torn down separately once the current turn drains.
    /// Returns `Ok(())` even if already marked (idempotent).
    pub async fn mark_thread_completing(&self, thread_id: &str) -> Result<(), String> {
        let threads = self.threads.read().await;
        let handle_arc = threads
            .get(thread_id)
            .ok_or_else(|| format!("Thread '{}' not found", thread_id))?;
        handle_arc.lock().await.completing = true;
        Ok(())
    }

    /// Set management permissions for a thread.
    pub async fn set_management_permissions(
        &self,
        thread_id: &str,
        enabled: bool,
    ) -> Result<(), String> {
        let threads = self.threads.read().await;
        let handle_arc = threads
            .get(thread_id)
            .ok_or_else(|| format!("Thread not found: {}", thread_id))?;
        handle_arc.lock().await.has_management_permissions = enabled;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Persistence
    // -----------------------------------------------------------------------

    /// Persist all thread mappings for a given workspace to `threads.json`.
    pub async fn persist_threads_for_workspace(&self, workspace_id: &WorkspaceId) {
        let workspace_dir = {
            let state = self.workspace_state.read().await;
            match state.workspaces.get(workspace_id) {
                Some(ws) => ws.path.clone(),
                None => return,
            }
        };

        let mappings = Self::collect_mappings_static(&self.threads, workspace_id).await;
        if let Err(e) = Self::save_to_dir(&mappings, &workspace_dir).await {
            log::error!("Failed to persist thread mappings: {}", e);
        }
    }

    /// Collect thread mappings for a workspace (static version for use in spawned tasks).
    async fn collect_mappings_static(
        threads: &RwLock<HashMap<String, Arc<Mutex<ThreadHandle>>>>,
        workspace_id: &WorkspaceId,
    ) -> Vec<ThreadMapping> {
        let threads = threads.read().await;
        let mut mappings = Vec::new();
        for (id, handle_arc) in threads.iter() {
            let handle = handle_arc.lock().await;
            if &handle.workspace_id == workspace_id {
                mappings.push(ThreadMapping {
                    thread_id: id.clone(),
                    agent_definition_id: handle.agent_id.clone(),
                    acp_session_id: handle.acp_session_id.clone(),
                    task_id: handle.task_id.clone(),
                });
            }
        }
        mappings
    }

    async fn save_to_dir(mappings: &[ThreadMapping], workspace_dir: &Path) -> Result<(), String> {
        let json = serde_json::to_string_pretty(mappings)
            .map_err(|e| format!("Failed to serialize thread mappings: {}", e))?;
        let path = workspace_dir.join("threads.json");
        let tmp_path = workspace_dir.join("threads.json.tmp");
        tokio::fs::write(&tmp_path, json)
            .await
            .map_err(|e| format!("Failed to write threads.json.tmp: {}", e))?;
        tokio::fs::rename(&tmp_path, &path)
            .await
            .map_err(|e| format!("Failed to rename threads.json.tmp: {}", e))?;
        Ok(())
    }

    /// Load persisted thread mappings from `threads.json`.
    pub async fn load_from_dir(workspace_dir: &Path) -> Result<Vec<ThreadMapping>, String> {
        let path = workspace_dir.join("threads.json");
        if !path.exists() {
            return Ok(Vec::new());
        }
        let raw = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| format!("Failed to read threads.json: {}", e))?;
        let mappings: Vec<ThreadMapping> = serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse threads.json: {}", e))?;
        Ok(mappings)
    }
}
